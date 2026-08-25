import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SyncProcessor } from './sync.processor';
import { SyncService } from './sync.service';

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
  providers: [SyncProcessor, SyncService],
})
export class SyncModule {}
