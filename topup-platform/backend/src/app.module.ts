import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma.service';
import { RateLimitGuard, RedisModule } from './common/redis';
import { QueueModule } from './queue.module';
import { AuthModule } from './auth/auth.module';
import { GamesModule } from './games/games.module';
import { LookupModule } from './lookup/lookup.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [PrismaModule, RedisModule, QueueModule, AuthModule, GamesModule, LookupModule, OrdersModule, PaymentsModule, AdminModule],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule {}
