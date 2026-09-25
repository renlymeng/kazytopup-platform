import { CanActivate, ExecutionContext, Global, HttpException, Inject, Injectable, Module, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { cfg } from '../config';

export const REDIS = 'REDIS';

/** CF-Connecting-IP is only trustworthy when the origin firewall admits Cloudflare ranges only. */
export const clientIp = (req: any): string => {
  const cf = req.headers['cf-connecting-ip'];
  return (cfg.behindCloudflare && typeof cf === 'string' && cf) || req.ip;
};

@Global()
@Module({
  providers: [{ provide: REDIS, useFactory: () => new Redis(cfg.redisUrl, { maxRetriesPerRequest: null }) }],
  exports: [REDIS],
})
export class RedisModule {}

export const RateLimit = (limit: number, windowSec: number, name?: string) =>
  SetMetadata('rl', { limit, windowSec, name });

/** Fixed-window limiter in Redis (needs Redis >= 7 for EXPIRE NX), shared across instances. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS) private redis: Redis, private ref: Reflector) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const m = this.ref.get<{ limit: number; windowSec: number; name?: string }>('rl', ctx.getHandler());
    if (!m) return true;
    const req = ctx.switchToHttp().getRequest();
    const key = `rl:${m.name ?? ctx.getHandler().name}:${clientIp(req)}`;
    const res = await this.redis.multi().incr(key).expire(key, m.windowSec, 'NX').exec();
    if (Number(res?.[0]?.[1] ?? 0) > m.limit) throw new HttpException('Too many requests', 429);
    return true;
  }
}
