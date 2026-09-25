import { Controller, HttpCode, Headers, Injectable, Logger, Module, Post, Req, UnauthorizedException, BadRequestException, RawBodyRequest, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash, createHmac } from 'crypto';
import * as QRCode from 'qrcode';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { cfg } from '../config';
import { PrismaService } from '../prisma.service';
import { hmac256, safeEq } from '../common/crypto';
import { RateLimit } from '../common/redis';
import { DELIVER_OPTS, QueueModule } from '../queue.module';

/* ---------------------------------------------------------------------------
 * ABA PayWay (KHQR) client.
 * Endpoint paths and the field order used for the request hash follow ABA's
 * "Purchase / Generate QR" and "Check Transaction" docs as of writing. Field
 * order in the hash is strict: verify against your merchant's current PayWay
 * documentation in the sandbox before going live (PAYWAY_BASE_URL is env-driven).
 * ------------------------------------------------------------------------- */
@Injectable()
export class PaywayService {
  private sign = (s: string) => createHmac('sha512', cfg.payway.apiKey).update(s).digest('base64');
  private reqTime = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14); // YYYYMMDDHHmmss (UTC)

  private async post(path: string, body: Record<string, unknown>) {
    const res = await fetch(`${cfg.payway.baseUrl}${path}`, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`PAYWAY_HTTP_${res.status}`);
    return res.json() as Promise<any>;
  }

  async createKhqr(o: { tranId: string; amountCents: number; title: string; lifetimeMin: number }) {
    const req_time = this.reqTime();
    const amount = (o.amountCents / 100).toFixed(2);
    const items = Buffer.from(JSON.stringify([{ name: o.title, quantity: 1, price: amount }])).toString('base64');
    const callback_url = Buffer.from(cfg.payway.callbackUrl).toString('base64');
    const f = { first_name: '', last_name: '', email: '', phone: '', purchase_type: 'purchase', payment_option: 'abapay_khqr',
      return_deeplink: '', custom_fields: '', return_params: '', payout: '', qr_image_template: 'template3_color' };
    const currency = cfg.payway.currency;
    const lifetime = o.lifetimeMin;
    const hash = this.sign(
      req_time + cfg.payway.merchantId + o.tranId + amount + items + f.first_name + f.last_name + f.email + f.phone +
      f.purchase_type + f.payment_option + callback_url + f.return_deeplink + currency + f.custom_fields + f.return_params +
      f.payout + lifetime + f.qr_image_template,
    );
    const r = await this.post('/api/payment-gateway/v1/payments/generate-qr', {
      req_time, merchant_id: cfg.payway.merchantId, tran_id: o.tranId, amount, items, currency, callback_url, lifetime, ...f, hash,
    });
    if (!r?.qrString) throw new Error('PAYWAY_NO_QR');
    const qrImage: string = r.qrImage || (await QRCode.toDataURL(r.qrString, { margin: 1, width: 320 }));
    return { qrString: r.qrString as string, qrImage, deeplink: (r.abapay_deeplink as string) ?? null };
  }

  /** Server-to-server truth check. Never trust callback bodies. */
  async check(tranId: string): Promise<{ approved: boolean; amountCents: number; raw: unknown }> {
    const req_time = this.reqTime();
    const hash = this.sign(req_time + cfg.payway.merchantId + tranId);
    const r = await this.post('/api/payment-gateway/v1/payments/check-transaction-2', {
      req_time, merchant_id: cfg.payway.merchantId, tran_id: tranId, hash,
    });
    const d = r?.data ?? {};
    const approved = d.payment_status_code === 0 || String(d.payment_status).toUpperCase() === 'APPROVED';
    const amount = Number(d.original_amount ?? d.payment_amount ?? d.total_amount ?? NaN);
    return { approved, amountCents: Math.round(amount * 100), raw: r };
  }
}

/* ------------------------ Settlement with idempotency --------------------- */
@Injectable()
export class PaymentsService {
  private log = new Logger('Payments');
  constructor(private prisma: PrismaService, private payway: PaywayService, @InjectQueue('delivery') private queue: Queue) {}

  enqueueDelivery(orderId: string, suffix = '') {
    // jobId makes the enqueue itself idempotent: BullMQ ignores duplicates of a live jobId.
    return this.queue.add('deliver', { orderId }, { ...DELIVER_OPTS, jobId: `deliver-${orderId}${suffix}` });
  }

  /** Safe to call any number of times, from webhooks, polling or the reconciler. */
  async settle(tranId: string): Promise<'paid' | 'pending' | 'review' | 'unknown'> {
    const pay = await this.prisma.payment.findUnique({ where: { tranId } });
    if (!pay) return 'unknown';
    if (pay.status === 'PAID') return 'paid';

    const r = await this.payway.check(tranId);
    if (!r.approved) return 'pending';
    if (r.amountCents !== pay.amountCents) {
      this.log.error(`Amount mismatch for ${tranId}: expected ${pay.amountCents}, got ${r.amountCents}`);
      await this.prisma.payment.update({ where: { id: pay.id }, data: { status: 'REVIEW', raw: r.raw as Prisma.InputJsonValue } });
      return 'review';
    }
    // Compare-and-set: only one caller can move the order to PAID, so credits can never duplicate.
    const won = await this.prisma.$transaction(async (tx) => {
      const u = await tx.order.updateMany({
        where: { id: pay.orderId, status: { in: ['PENDING', 'EXPIRED'] } }, // late payments on expired QR still credit
        data: { status: 'PAID', paidAt: new Date() },
      });
      if (u.count === 0) return false;
      await tx.payment.update({ where: { id: pay.id }, data: { status: 'PAID', paidAt: new Date(), raw: r.raw as Prisma.InputJsonValue } });
      return true;
    });
    if (won) await this.enqueueDelivery(pay.orderId);
    return 'paid';
  }
}

/* ------------------------------ Webhook endpoint -------------------------- */
@Controller('webhooks')
export class WebhooksController {
  private log = new Logger('Webhook');
  constructor(private prisma: PrismaService, private payments: PaymentsService) {}

  @Post('payway') @HttpCode(200) @RateLimit(240, 60, 'webhook')
  async payway(@Req() req: RawBodyRequest<Request>, @Headers('x-signature') sig?: string) {
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException();
    if (cfg.webhookRequireSig) {
      // HMAC-SHA256 over the exact raw bytes, constant-time compare.
      if (!sig || !safeEq(hmac256(cfg.webhookSecret, raw), sig.trim().toLowerCase())) throw new UnauthorizedException('Bad signature');
    }
    let body: any;
    try { body = JSON.parse(raw.toString('utf8')); } catch { throw new BadRequestException(); }
    const tranId = String(body?.tran_id ?? '');
    if (!/^[A-Za-z0-9]{1,20}$/.test(tranId)) throw new BadRequestException();

    // Idempotency ledger: identical deliveries are acknowledged without reprocessing.
    const eventId = createHash('sha256').update(raw).digest('hex');
    try {
      await this.prisma.webhookEvent.create({ data: { provider: 'payway', eventId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: true, duplicate: true };
      throw e;
    }
    try {
      await this.payments.settle(tranId); // re-verifies with PayWay server-to-server
    } catch (e) {
      // release the ledger entry so the provider's retry is processed
      await this.prisma.webhookEvent.delete({ where: { provider_eventId: { provider: 'payway', eventId } } }).catch(() => undefined);
      this.log.error(`settle failed for ${tranId}: ${(e as Error).message}`);
      throw new ServiceUnavailableException();
    }
    return { ok: true };
  }
}

@Module({
  imports: [QueueModule],
  controllers: [WebhooksController],
  providers: [PaywayService, PaymentsService],
  exports: [PaywayService, PaymentsService],
})
export class PaymentsModule {}
