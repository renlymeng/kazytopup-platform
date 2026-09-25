import { BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode, Inject, Injectable, Module, NotFoundException, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import Redis from 'ioredis';
import { cfg } from '../config';
import { PrismaService } from '../prisma.service';
import { MemberSession } from '../auth/auth.module';
import { PaymentsModule, PaymentsService, PaywayService } from '../payments/payments.module';
import { clean, newRef, newTranId, verifyLookup } from '../common/crypto';
import { RateLimit, REDIS } from '../common/redis';

class CreateOrderDto {
  @Matches(/^[a-z0-9-]{2,40}$/) game!: string;
  @IsString() @MaxLength(40) packageId!: string;
  @Matches(/^[A-Za-z0-9_-]{1,30}$/) playerId!: string;
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,10}$/) serverId?: string;
  @IsString() @MaxLength(1024) lookupToken!: string;
  @IsOptional() @IsString() @MaxLength(64) @Transform(({ value }) => clean(String(value), 64)) contact?: string;
}

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService, private payway: PaywayService, private payments: PaymentsService,
    @Inject(REDIS) private redis: Redis) {}

  private view(o: any, p: any) {
    return { ref: o.ref, status: o.status, amountCents: o.amountCents, currency: o.currency, expiresAt: o.expiresAt,
      nickname: o.nickname, qrImage: p?.qrImage ?? null, qrString: p?.qrString ?? null, deeplink: p?.deeplink ?? null };
  }

  async create(dto: CreateOrderDto, memberId: string | null, idemKey?: string) {
    if (idemKey) {
      const ex = await this.prisma.order.findUnique({ where: { idempotencyKey: idemKey }, include: { payment: true } });
      if (ex) return this.view(ex, ex.payment);
    }
    const game = await this.prisma.game.findFirst({ where: { slug: dto.game, enabled: true } });
    if (!game) throw new NotFoundException('This game is currently unavailable'); // OFF switch enforced server-side
    const claim = verifyLookup(dto.lookupToken);
    const serverId = game.needsServerId ? dto.serverId ?? '' : '';
    if (!claim || claim.g !== game.id || claim.p !== dto.playerId || claim.s !== serverId)
      throw new BadRequestException('Please verify the Player ID again');
    const pkg = await this.prisma.package.findFirst({ where: { id: dto.packageId, gameId: game.id, enabled: true } });
    if (!pkg) throw new NotFoundException('Package unavailable');

    const tranId = newTranId();
    const order = await this.prisma.order.create({
      data: {
        ref: newRef(), idempotencyKey: idemKey, gameId: game.id, packageId: pkg.id, memberId,
        playerId: dto.playerId, serverId: serverId || null, nickname: claim.n, contact: dto.contact || null,
        amountCents: pkg.priceCents, currency: cfg.payway.currency, // price always comes from the DB, never the client
        expiresAt: new Date(Date.now() + cfg.orderTtlMin * 60_000),
        payment: { create: { tranId, amountCents: pkg.priceCents } },
      },
      include: { payment: true },
    }).catch((e) => { if (e?.code === 'P2002') throw new ConflictException('Duplicate request'); throw e; });

    try {
      const qr = await this.payway.createKhqr({ tranId, amountCents: pkg.priceCents, title: `${game.nameEn} ${pkg.labelEn}`.slice(0, 60), lifetimeMin: cfg.orderTtlMin });
      const payment = await this.prisma.payment.update({ where: { id: order.payment!.id }, data: qr });
      return this.view(order, payment);
    } catch {
      await this.prisma.order.update({ where: { id: order.id }, data: { status: 'FAILED', lastError: 'QR_CREATE_FAILED' } });
      throw new ServiceUnavailableException('Payment provider is unavailable, please try again');
    }
  }

  async status(ref: string) {
    const o = await this.prisma.order.findUnique({ where: { ref }, include: { payment: true, game: true, package: true } });
    if (!o) throw new NotFoundException();
    // Opportunistic settlement (max once / 5s / order) so buyers see "paid" even if the webhook is late.
    if (o.status === 'PENDING' && o.payment && (await this.redis.set(`chk:${ref}`, '1', 'EX', 5, 'NX'))) {
      await this.payments.settle(o.payment.tranId).catch(() => undefined);
      const fresh = await this.prisma.order.findUniqueOrThrow({ where: { ref } });
      o.status = fresh.status;
    }
    return { ref: o.ref, status: o.status, nickname: o.nickname, amountCents: o.amountCents, currency: o.currency, expiresAt: o.expiresAt,
      game: { nameEn: o.game.nameEn, nameKm: o.game.nameKm }, package: { labelEn: o.package.labelEn, labelKm: o.package.labelKm } };
  }
}

@Controller('orders')
export class OrdersController {
  constructor(private svc: OrdersService, private session: MemberSession) {}

  @Post() @HttpCode(201) @RateLimit(10, 60, 'order-create')
  create(@Body() dto: CreateOrderDto, @Req() req: Request, @Headers('idempotency-key') key?: string) {
    if (key !== undefined && !/^[\w-]{8,64}$/.test(key)) throw new BadRequestException('Bad Idempotency-Key');
    return this.svc.create(dto, this.session.userId(req), key);
  }

  @Get(':ref') @RateLimit(90, 60, 'order-status')
  status(@Param('ref') ref: string) {
    if (!/^[a-f0-9]{32}$/.test(ref)) throw new NotFoundException();
    return this.svc.status(ref);
  }
}

@Module({ imports: [PaymentsModule], controllers: [OrdersController], providers: [OrdersService] })
export class OrdersModule {}
