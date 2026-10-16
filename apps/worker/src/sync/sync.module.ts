import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SyncProcessor } from './sync.processor';
import { SyncService } from './sync.service';
import { TokenService } from '../publishing/token.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'sync',
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    }),
  ],
  providers: [SyncProcessor, SyncService, TokenService],
})
export class SyncModule {}
