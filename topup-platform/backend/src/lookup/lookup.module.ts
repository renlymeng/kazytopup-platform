import { BadRequestException, Body, Controller, HttpCode, Inject, Injectable, Module, NotFoundException, Post, ServiceUnavailableException } from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';
import Redis from 'ioredis';
import { PrismaService } from '../prisma.service';
import { RateLimit, REDIS } from '../common/redis';
import { callSupplier, SupplierCfg } from '../common/supplier';
import { clean, signLookup } from '../common/crypto';

class LookupDto {
  @Matches(/^[a-z0-9-]{2,40}$/) game!: string;
  @Matches(/^[A-Za-z0-9_-]{1,30}$/) playerId!: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,10}$/) serverId?: string;
}

@Injectable()
export class LookupService {
  constructor(private prisma: PrismaService, @Inject(REDIS) private redis: Redis) {}

  async lookup(dto: LookupDto) {
    const g = await this.prisma.game.findFirst({ where: { slug: dto.game, enabled: true } });
    if (!g) throw new NotFoundException('Game unavailable');
    const idOk = dto.playerId.length >= g.idMin && dto.playerId.length <= g.idMax && (!g.idNumeric || /^\d+$/.test(dto.playerId));
    if (!idOk) throw new BadRequestException('Invalid Player ID');
    if (g.needsServerId && (!dto.serverId || dto.serverId.length > g.serverMax)) throw new BadRequestException('Server ID required');
    const serverId = g.needsServerId ? dto.serverId! : '';
    if (!g.lookupConfig) throw new ServiceUnavailableException('Nickname verification is not available for this game');

    const key = `lk:${g.id}:${dto.playerId}:${serverId}`;
    const cached = await this.redis.get(key);
    let nickname: string;
    if (cached === '!') throw new NotFoundException('Player not found');
    if (cached) nickname = cached;
    else {
      try {
        const r = await callSupplier(g.lookupConfig as unknown as SupplierCfg, { playerId: dto.playerId, serverId });
        nickname = r.ok && typeof r.result === 'string' ? clean(r.result) : '';
      } catch {
        throw new ServiceUnavailableException('Verification service is busy, try again shortly');
      }
      if (!nickname) {
        await this.redis.set(key, '!', 'EX', 60); // negative cache limits hammering the publisher
        throw new NotFoundException('Player not found');
      }
      await this.redis.set(key, nickname, 'EX', 300);
    }
    return { nickname, lookupToken: signLookup({ g: g.id, p: dto.playerId, s: serverId, n: nickname }) };
  }
}

@Controller('lookup')
export class LookupController {
  constructor(private svc: LookupService) {}
  @Post() @HttpCode(200) @RateLimit(12, 60, 'lookup')
  run(@Body() dto: LookupDto) { return this.svc.lookup(dto); }
}

@Module({ controllers: [LookupController], providers: [LookupService] })
export class LookupModule {}
