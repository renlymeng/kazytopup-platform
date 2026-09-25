import {
  BadRequestException, Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, Inject, Injectable,
  Module, Post, Req, Res, SetMetadata, UnauthorizedException, UseGuards, Global,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { OAuth2Client } from 'google-auth-library';
import { createHash, createHmac, randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import Redis from 'ioredis';
import { Role } from '@prisma/client';
import { cfg } from '../config';
import { decrypt, encrypt, safeEq, clean } from '../common/crypto';
import { RateLimit, REDIS } from '../common/redis';
import { PrismaService } from '../prisma.service';

export const Roles = (...r: Role[]) => SetMetadata('roles', r);
export const MfaSetup = () => SetMetadata('mfaSetup', true);
const isProd = cfg.prod;
const cookieOpts = (maxAgeMs: number) => ({ httpOnly: true, secure: isProd, sameSite: 'strict' as const, path: '/', maxAge: maxAgeMs });
let DUMMY_HASH = '';
argon2.hash(randomUUID()).then((h) => (DUMMY_HASH = h));

/* ------------------------------ Admin guard ------------------------------ */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private jwt: JwtService, private ref: Reflector, @Inject(REDIS) private redis: Redis) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    if (req.method !== 'GET') {
      // CSRF defence in depth on top of SameSite=Strict: mutations must come from our own origin.
      const origin = req.headers.origin as string | undefined;
      if (!origin || !cfg.webOrigin.includes(origin)) throw new ForbiddenException('Bad origin');
    }
    const token = req.cookies?.adm;
    if (!token) throw new UnauthorizedException();
    let p: any;
    try { p = this.jwt.verify(token); } catch { throw new UnauthorizedException(); }
    if (p.typ !== 'admin' || (await this.redis.get(`rev:${p.jti}`))) throw new UnauthorizedException();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (!p.mfa && !this.ref.getAllAndOverride<boolean>('mfaSetup', targets)) throw new ForbiddenException('MFA setup required');
    const roles = this.ref.getAllAndOverride<Role[] | undefined>('roles', targets);
    if (roles && !roles.includes(p.role)) throw new ForbiddenException();
    req.admin = { id: p.sub, email: p.email, role: p.role };
    return true;
  }
}

/* ------------------------------ Member session --------------------------- */
@Injectable()
export class MemberSession {
  constructor(private jwt: JwtService) {}
  userId(req: Request): string | null {
    try {
      const p: any = this.jwt.verify((req as any).cookies?.mem ?? '');
      return p.typ === 'member' ? p.sub : null;
    } catch { return null; }
  }
  issue(res: Response, id: string) {
    res.cookie('mem', this.jwt.sign({ typ: 'member', sub: id }, { expiresIn: '30d' }), cookieOpts(30 * 864e5));
  }
}

/* ------------------------------ Admin auth ------------------------------- */
class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @IsOptional() @Matches(/^\d{6}$/) totp?: string;
}
class CodeDto { @Matches(/^\d{6}$/) code!: string; }

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private prisma: PrismaService, private jwt: JwtService, @Inject(REDIS) private redis: Redis) {}

  private issue(res: Response, u: { id: string; email: string; role: Role }, mfa: boolean) {
    const token = this.jwt.sign({ typ: 'admin', sub: u.id, email: u.email, role: u.role, mfa, jti: randomUUID() }, { expiresIn: '2h' });
    res.cookie('adm', token, cookieOpts(2 * 3600_000));
  }
  private async fail(u: { id: string; failedLogins: number }) {
    const n = u.failedLogins + 1;
    await this.prisma.adminUser.update({
      where: { id: u.id },
      data: { failedLogins: n, lockedUntil: n >= 5 ? new Date(Date.now() + 15 * 60_000) : undefined },
    });
  }

  @Post('login') @HttpCode(200) @RateLimit(8, 300, 'admin-login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const u = await this.prisma.adminUser.findUnique({ where: { email: dto.email.toLowerCase() } });
    const ok = await argon2.verify(u?.passwordHash ?? DUMMY_HASH, dto.password).catch(() => false); // constant-ish time
    const locked = !!u?.lockedUntil && u.lockedUntil > new Date();
    if (!u || locked || !ok) {
      if (u && !locked) await this.fail(u);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (u.mfaEnabled) {
      if (!dto.totp) throw new UnauthorizedException({ message: 'MFA code required', mfaRequired: true });
      const replay = await this.redis.set(`totp:${u.id}:${dto.totp}`, '1', 'EX', 90, 'NX'); // one-time use per code
      if (!replay || !authenticator.check(dto.totp, decrypt(u.mfaSecret!))) {
        await this.fail(u);
        throw new UnauthorizedException('Invalid credentials');
      }
    }
    await this.prisma.adminUser.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null } });
    this.issue(res, u, u.mfaEnabled);
    return { email: u.email, role: u.role, mfa: u.mfaEnabled };
  }

  @Post('logout') @HttpCode(200) @UseGuards(AdminGuard) @MfaSetup()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const p: any = this.jwt.decode((req as any).cookies.adm);
    await this.redis.set(`rev:${p.jti}`, '1', 'EX', 2 * 3600);
    res.clearCookie('adm', { path: '/' });
    return { ok: true };
  }

  @Get('me') @UseGuards(AdminGuard) @MfaSetup()
  async me(@Req() req: Request) {
    const a = (req as any).admin;
    const u = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: a.id } });
    return { email: u.email, role: u.role, mfa: u.mfaEnabled };
  }

  @Post('mfa/setup') @HttpCode(200) @UseGuards(AdminGuard) @MfaSetup()
  async mfaSetup(@Req() req: Request) {
    const a = (req as any).admin;
    const u = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: a.id } });
    if (u.mfaEnabled) throw new ForbiddenException('MFA already enabled');
    const secret = authenticator.generateSecret();
    await this.prisma.adminUser.update({ where: { id: u.id }, data: { mfaSecret: encrypt(secret) } });
    const uri = authenticator.keyuri(u.email, 'TopUp Admin', secret);
    return { otpauth: uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
  }

  @Post('mfa/enable') @HttpCode(200) @UseGuards(AdminGuard) @MfaSetup() @RateLimit(10, 300, 'mfa-enable')
  async mfaEnable(@Req() req: Request, @Body() dto: CodeDto, @Res({ passthrough: true }) res: Response) {
    const a = (req as any).admin;
    const u = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: a.id } });
    if (!u.mfaSecret || u.mfaEnabled) throw new BadRequestException();
    if (!authenticator.check(dto.code, decrypt(u.mfaSecret))) throw new BadRequestException('Invalid code');
    await this.prisma.adminUser.update({ where: { id: u.id }, data: { mfaEnabled: true } });
    this.issue(res, u, true);
    return { ok: true };
  }
}

/* ------------------------------ Member social login ---------------------- */
class GoogleDto { @IsString() @MaxLength(4096) credential!: string; }

@Controller('auth')
export class MemberAuthController {
  private google = new OAuth2Client(cfg.googleClientId);
  constructor(private prisma: PrismaService, private session: MemberSession) {}

  @Post('google') @HttpCode(200) @RateLimit(20, 60, 'auth-google')
  async loginGoogle(@Body() dto: GoogleDto, @Res({ passthrough: true }) res: Response) {
    if (!cfg.googleClientId) throw new BadRequestException('Google login is not configured');
    const t = await this.google.verifyIdToken({ idToken: dto.credential, audience: cfg.googleClientId }).catch(() => null);
    const p = t?.getPayload();
    if (!p?.sub) throw new UnauthorizedException();
    const m = await this.prisma.member.upsert({
      where: { googleId: p.sub }, update: {},
      create: { googleId: p.sub, name: clean(p.name ?? 'Player', 60) },
    });
    this.session.issue(res, m.id);
    return { name: m.name };
  }

  // Telegram Login Widget: https://core.telegram.org/widgets/login#checking-authorization
  @Post('telegram') @HttpCode(200) @RateLimit(20, 60, 'auth-telegram')
  async loginTelegram(@Body() body: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    if (!cfg.telegramBotToken) throw new BadRequestException('Telegram login is not configured');
    const { hash, ...rest } = body ?? {};
    if (!hash || !rest.id || !rest.auth_date) throw new UnauthorizedException();
    const check = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join('\n');
    const secret = createHash('sha256').update(cfg.telegramBotToken).digest();
    if (!safeEq(createHmac('sha256', secret).update(check).digest('hex'), String(hash))) throw new UnauthorizedException();
    if (Date.now() / 1000 - Number(rest.auth_date) > 86400) throw new UnauthorizedException('Login expired');
    const name = clean([rest.first_name, rest.last_name].filter(Boolean).join(' ') || rest.username || 'Player', 60);
    const m = await this.prisma.member.upsert({
      where: { telegramId: String(rest.id) }, update: {}, create: { telegramId: String(rest.id), name },
    });
    this.session.issue(res, m.id);
    return { name: m.name };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const id = this.session.userId(req);
    const m = id ? await this.prisma.member.findUnique({ where: { id } }) : null;
    return { member: m ? { name: m.name } : null };
  }

  @Get('orders')
  async orders(@Req() req: Request) {
    const id = this.session.userId(req);
    if (!id) throw new UnauthorizedException();
    const rows = await this.prisma.order.findMany({
      where: { memberId: id }, orderBy: { createdAt: 'desc' }, take: 30,
      include: { game: { select: { nameEn: true, nameKm: true } }, package: { select: { labelEn: true, labelKm: true } } },
    });
    return rows.map((o) => ({ ref: o.ref, status: o.status, game: o.game, package: o.package, amountCents: o.amountCents, createdAt: o.createdAt }));
  }

  @Post('logout') @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) { res.clearCookie('mem', { path: '/' }); return { ok: true }; }
}

@Global()
@Module({
  imports: [JwtModule.register({ secret: cfg.jwtSecret, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } })],
  controllers: [AdminAuthController, MemberAuthController],
  providers: [AdminGuard, MemberSession],
  exports: [JwtModule, AdminGuard, MemberSession],
})
export class AuthModule {}
