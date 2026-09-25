import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { cfg } from '../config';

export const encrypt = (plain: string): string => {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cfg.encKey, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
};
export const decrypt = (s: string): string => {
  const [iv, tag, enc] = s.split('.').map((p) => Buffer.from(p, 'base64'));
  const d = createDecipheriv('aes-256-gcm', cfg.encKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
};
export const hmac256 = (key: string, data: string | Buffer, enc: 'hex' | 'base64' | 'base64url' = 'hex') =>
  createHmac('sha256', key).update(data).digest(enc);
export const safeEq = (a: string, b: string): boolean => {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
};
/** Strip control chars and angle brackets; keeps Khmer and other scripts intact. */
export const clean = (s: string, max = 64): string =>
  s.normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
export const newRef = () => randomBytes(16).toString('hex');
export const newTranId = () => 'T' + randomBytes(9).toString('hex'); // 19 chars (PayWay limit 20)

type LookupClaim = { g: string; p: string; s: string; n: string };
export const signLookup = (p: LookupClaim): string => {
  const body = Buffer.from(JSON.stringify({ ...p, e: Date.now() + 15 * 60_000 })).toString('base64url');
  return `${body}.${hmac256(cfg.lookupSecret, body, 'base64url')}`;
};
export const verifyLookup = (t: string): LookupClaim | null => {
  const [body, sig] = t.split('.');
  if (!body || !sig || !safeEq(sig, hmac256(cfg.lookupSecret, body, 'base64url'))) return null;
  try {
    const j = JSON.parse(Buffer.from(body, 'base64url').toString());
    return j.e > Date.now() ? j : null;
  } catch { return null; }
};
