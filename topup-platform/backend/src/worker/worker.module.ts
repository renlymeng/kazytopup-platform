import { InjectQueue, Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaModule, PrismaService } from '../prisma.service';
import { QueueModule } from '../queue.module';
import { PaymentsModule, PaymentsService } from '../payments/payments.module';
import { RedisModule } from '../common/redis';
import { callSupplier, SupplierCfg } from '../common/supplier';

@Processor('delivery', { concurrency: 5 })
export class DeliveryProcessor extends WorkerHost {
  private log = new Logger('Delivery');
  constructor(private prisma: PrismaService, private payments: PaymentsService) { super(); }

  async process(job: Job): Promise<void> {
    if (job.name === 'reconcile') return this.reconcile();
    if (job.name === 'deliver') return this.deliver(job.data.orderId as string);
  }

  private async deliver(orderId: string) {
    const o = await this.prisma.order.findUnique({ where: { id: orderId }, include: { game: true, package: true } });
    if (!o || o.status === 'COMPLETED') return;                       // idempotent: already done
    if (o.status !== 'PAID' && o.status !== 'DELIVERING') return;     // not payable / already failed
    if (!o.game.enabled) throw new Error('GAME_DISABLED');             // maintenance: retry with backoff
    if (!o.game.deliveryConfig) throw new Error('NO_DELIVERY_CONFIG');
    await this.prisma.order.update({ where: { id: o.id }, data: { status: 'DELIVERING', attempts: { increment: 1 } } });
    // order.ref is sent as the supplier's client reference so a retry after a lost response cannot double-credit.
    const r = await callSupplier(o.game.deliveryConfig as unknown as SupplierCfg, {
      ref: o.ref, sku: o.package.supplierSku, playerId: o.playerId, serverId: o.serverId ?? '',
    });
    if (!r.ok) throw new Error('SUPPLIER_REJECTED');
    await this.prisma.order.update({
      where: { id: o.id },
      data: { status: 'COMPLETED', deliveredAt: new Date(), lastError: null, supplierRef: r.result ? String(r.result).slice(0, 80) : null },
    });
  }

  private async reconcile() {
    const now = Date.now();
    // 1) lost webhooks: re-check recent unpaid orders
    const pending = await this.prisma.order.findMany({
      where: { status: 'PENDING', createdAt: { gte: new Date(now - 45 * 60_000) } }, include: { payment: true }, take: 50, orderBy: { createdAt: 'asc' },
    });
    for (const o of pending) if (o.payment) await this.payments.settle(o.payment.tranId).catch((e) => this.log.warn(e.message));
    // 2) expire QR codes that stayed unpaid for 15 minutes beyond their lifetime
    await this.prisma.order.updateMany({ where: { status: 'PENDING', expiresAt: { lt: new Date(now - 15 * 60_000) } }, data: { status: 'EXPIRED' } });
    // 3) paid but never enqueued (crash between commit and enqueue)
    const stuck = await this.prisma.order.findMany({ where: { status: 'PAID', paidAt: { lt: new Date(now - 2 * 60_000) } }, take: 50 });
    for (const o of stuck) await this.payments.enqueueDelivery(o.id);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, err: Error) {
    if (!job || job.name !== 'deliver') return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    this.log.warn(`deliver ${job.data.orderId} attempt ${job.attemptsMade} failed: ${err.message}`);
    if (final)
      await this.prisma.order.updateMany({ where: { id: job.data.orderId, status: { in: ['PAID', 'DELIVERING'] } }, data: { status: 'FAILED', lastError: err.message.slice(0, 200) } });
    else
      await this.prisma.order.updateMany({ where: { id: job.data.orderId }, data: { lastError: err.message.slice(0, 200) } });
  }
}

@Injectable()
class ReconcileScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue('delivery') private q: Queue) {}
  async onApplicationBootstrap() {
    await this.q.upsertJobScheduler('reconcile', { every: 60_000 }, { name: 'reconcile', opts: { removeOnComplete: 10, removeOnFail: 10 } });
  }
}

@Module({ imports: [PrismaModule, RedisModule, QueueModule, PaymentsModule], providers: [DeliveryProcessor, ReconcileScheduler] })
export class WorkerModule {}
