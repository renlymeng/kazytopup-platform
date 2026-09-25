import 'dotenv/config';
const req = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var ${k}`);
  return v;
};
const encKey = Buffer.from(req('ENCRYPTION_KEY'), 'hex');
if (encKey.length !== 32) throw new Error('ENCRYPTION_KEY must be 64 hex chars');

export const cfg = {
  prod: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),
  webOrigin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
  behindCloudflare: process.env.BEHIND_CLOUDFLARE === 'true',
  redisUrl: req('REDIS_URL'),
  jwtSecret: req('JWT_SECRET'),
  encKey,
  lookupSecret: req('LOOKUP_TOKEN_SECRET'),
  webhookSecret: req('WEBHOOK_HMAC_SECRET'),
  webhookRequireSig: process.env.WEBHOOK_REQUIRE_SIGNATURE !== 'false',
  payway: {
    baseUrl: req('PAYWAY_BASE_URL'),
    merchantId: req('PAYWAY_MERCHANT_ID'),
    apiKey: req('PAYWAY_API_KEY'),
    callbackUrl: req('PAYWAY_CALLBACK_URL'),
    currency: process.env.PAYWAY_CURRENCY ?? 'USD',
  },
  supplierHosts: (process.env.SUPPLIER_HOST_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  orderTtlMin: 10,
};
