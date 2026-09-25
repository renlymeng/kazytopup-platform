import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { cfg } from './config';

@Module({
  imports: [
    BullModule.forRoot({ connection: new Redis(cfg.redisUrl, { maxRetriesPerRequest: null }) }),
    BullModule.registerQueue({ name: 'delivery' }),
  ],
  exports: [BullModule],
})
export class QueueModule {}

export const DELIVER_OPTS = {
  attempts: 6,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: 1000,
  removeOnFail: false,
};
