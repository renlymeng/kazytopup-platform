import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards, Module } from '@nestjs/common';
import type { Request } from 'express';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AdminGuard, Roles } from '../auth/auth.module';
import { PaymentsModule, PaymentsService } from '../payments/payments.module';
import { clientIp } from '../common/redis';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminOpsController {
  constructor(private prisma: PrismaService, private payments: PaymentsService) {}

  @Get('stats')
  async stats() {
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const [byStatus, today, failed] = await Promise.all([
      this.prisma.order.groupBy({ by: ['status'], _count: true }),
      this.prisma.order.aggregate({ where: { status: 'COMPLETED', deliveredAt: { gte: since } }, _sum: { amountCents: true }, _count: true }),
      this.prisma.order.count({ where: { status: 'FAILED' } }),
    ]);
    return { byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])), todayRevenueCents: today._sum.amountCents ?? 0, todayOrders: today._count, failed };
  }

  @Get('orders')
  async orders(@Query('status') status?: string, @Query('q') q?: string, @Query('page') page = '1') {
    const where: Prisma.OrderWhereInput = {};
    if (status) {
      if (!(status in OrderStatus)) throw new BadRequestException();
      where.status = status as OrderStatus;
    }
    if (q) {
      const s = q.trim().slice(0, 64);
      where.OR = [{ ref: { startsWith: s.toLowerCase() } }, { playerId: s }, { nickname: { contains: s, mode: 'insensitive' } }, { payment: { tranId: s } }];
    }
    const take = 25, skip = (Math.max(1, Number(page) || 1) - 1) * take;
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip,
        include: { game: { select: { nameEn: true } }, package: { select: { labelEn: true } }, payment: { select: { tranId: true, status: true, paidAt: true } } } }),
      this.prisma.order.count({ where }),
    ]);
    return { rows, total, pages: Math.ceil(total / take) };
  }

  @Get('orders/:id')
  async order(@Param('id') id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: { game: { select: { nameEn: true } }, package: true, payment: true } });
    if (!o) throw new NotFoundException();
    return o;
  }

  // Re-check payment then (re)queue delivery for stuck / failed orders.
  @Post('orders/:id/retry') @Roles('SUPER_ADMIN', 'ADMIN')
  async retry(@Param('id') id: string, @Req() req: Request) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: { payment: true } });
    if (!o) throw new NotFoundException();
    if (o.status === 'PENDING' || o.status === 'EXPIRED') {
      if (!o.payment) throw new BadRequestException();
      const r = await this.payments.settle(o.payment.tranId);
      if (r !== 'paid') throw new BadRequestException(`Payment is not confirmed (${r})`);
    } else if (o.status === 'FAILED' || o.status === 'DELIVERING' || o.status === 'PAID') {
      if (!o.paidAt) throw new BadRequestException('Order was never paid');
      await this.prisma.order.update({ where: { id }, data: { status: 'PAID', lastError: null } });
      await this.payments.enqueueDelivery(id, `-r${Date.now()}`);
    } else throw new BadRequestException('Order already completed');
    await this.prisma.auditLog.create({ data: { adminId: (req as any).admin.id, action: 'order.retry', entity: 'order', entityId: id, ip: clientIp(req) } });
    return { ok: true };
  }

  @Get('audit') @Roles('SUPER_ADMIN')
  audit() {
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { admin: { select: { email: true } } } });
  }
}

@Module({ imports: [PaymentsModule], controllers: [AdminOpsController] })
export class AdminModule {}
