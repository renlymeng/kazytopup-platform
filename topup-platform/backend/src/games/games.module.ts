import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Put, Req, UseGuards, Module } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { AdminGuard, Roles } from '../auth/auth.module';
import { assertSupplierCfg } from '../common/supplier';
import { clientIp } from '../common/redis';
import { clean } from '../common/crypto';

const pub = { id: true, slug: true, nameEn: true, nameKm: true, iconUrl: true, bannerUrl: true, hot: true, instant: true,
  idLabelEn: true, idLabelKm: true, idMin: true, idMax: true, idNumeric: true, needsServerId: true, serverMax: true } as const;

/* ------------------------------- Public API ------------------------------ */
@Controller('games')
export class GamesController {
  constructor(private prisma: PrismaService) {}

  // Disabled games are never returned: OFF takes effect on the very next request.
  @Get()
  list() {
    return this.prisma.game.findMany({ where: { enabled: true }, orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }], select: pub });
  }

  @Get(':slug')
  async one(@Param('slug') slug: string) {
    const g = await this.prisma.game.findFirst({
      where: { slug, enabled: true },
      select: { ...pub, packages: { where: { enabled: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, labelEn: true, labelKm: true, priceCents: true } } },
    });
    if (!g) throw new NotFoundException('Game unavailable');
    return g;
  }
}

/* ------------------------------- Admin API ------------------------------- */
class ToggleDto { @IsBoolean() enabled!: boolean; }
class GameDto {
  @Matches(/^[a-z0-9-]{2,40}$/) slug!: string;
  @IsString() @MaxLength(80) @Transform(({ value }) => clean(String(value), 80)) nameEn!: string;
  @IsOptional() @IsString() @MaxLength(80) @Transform(({ value }) => clean(String(value), 80)) nameKm?: string;
  @Matches(/^(\/[\w\-./]+|https:\/\/[\w\-./%?=&]+)$/) iconUrl!: string;
  @IsOptional() @Matches(/^(\/[\w\-./]+|https:\/\/[\w\-./%?=&]+)$/) bannerUrl?: string;
  @IsOptional() @IsBoolean() hot?: boolean;
  @IsOptional() @IsBoolean() instant?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) idMin?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) idMax?: number;
  @IsOptional() @IsBoolean() idNumeric?: boolean;
  @IsOptional() @IsBoolean() needsServerId?: boolean;
  @IsOptional() @IsObject() lookupConfig?: Record<string, unknown>;
  @IsOptional() @IsObject() deliveryConfig?: Record<string, unknown>;
}
class PackageDto {
  @IsString() @MaxLength(80) @Transform(({ value }) => clean(String(value), 80)) labelEn!: string;
  @IsOptional() @IsString() @MaxLength(80) @Transform(({ value }) => clean(String(value), 80)) labelKm?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) priceCents!: number;
  @IsString() @Matches(/^[\w\-.]{1,64}$/) supplierSku!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminGamesController {
  constructor(private prisma: PrismaService) {}
  private audit(req: Request, action: string, entityId: string, meta?: object) {
    return this.prisma.auditLog.create({ data: { adminId: (req as any).admin.id, action, entity: 'game', entityId, meta: meta as any, ip: clientIp(req) } });
  }

  @Get('games')
  list() {
    return this.prisma.game.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      select: { ...pub, enabled: true, sortOrder: true, updatedAt: true, lookupConfig: true, deliveryConfig: true, packages: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  // The ON/OFF switch.
  @Patch('games/:id/toggle') @Roles('SUPER_ADMIN', 'ADMIN')
  async toggle(@Param('id') id: string, @Body() dto: ToggleDto, @Req() req: Request) {
    const g = await this.prisma.game.update({ where: { id }, data: { enabled: dto.enabled }, select: { id: true, slug: true, enabled: true } }).catch(() => null);
    if (!g) throw new NotFoundException();
    await this.audit(req, dto.enabled ? 'game.on' : 'game.off', id, { slug: g.slug });
    return g;
  }

  @Post('games') @Roles('SUPER_ADMIN', 'ADMIN')
  async create(@Body() dto: GameDto, @Req() req: Request) {
    if (dto.lookupConfig) assertSupplierCfg(dto.lookupConfig);
    if (dto.deliveryConfig) assertSupplierCfg(dto.deliveryConfig);
    const g = await this.prisma.game.create({ data: dto as any });
    await this.audit(req, 'game.create', g.id, { slug: g.slug });
    return g;
  }

  @Put('games/:id') @Roles('SUPER_ADMIN', 'ADMIN')
  async update(@Param('id') id: string, @Body() dto: GameDto, @Req() req: Request) {
    if (dto.lookupConfig) assertSupplierCfg(dto.lookupConfig);
    if (dto.deliveryConfig) assertSupplierCfg(dto.deliveryConfig);
    const g = await this.prisma.game.update({ where: { id }, data: dto as any });
    await this.audit(req, 'game.update', id);
    return g;
  }

  @Post('games/:id/packages') @Roles('SUPER_ADMIN', 'ADMIN')
  async addPackage(@Param('id') id: string, @Body() dto: PackageDto, @Req() req: Request) {
    const p = await this.prisma.package.create({ data: { ...dto, gameId: id } });
    await this.audit(req, 'package.create', id, { packageId: p.id });
    return p;
  }

  @Put('packages/:pid') @Roles('SUPER_ADMIN', 'ADMIN')
  async updatePackage(@Param('pid') pid: string, @Body() dto: PackageDto, @Req() req: Request) {
    const p = await this.prisma.package.update({ where: { id: pid }, data: dto });
    await this.audit(req, 'package.update', p.gameId, { packageId: pid });
    return p;
  }
}

@Module({ controllers: [GamesController, AdminGamesController] })
export class GamesModule {}
