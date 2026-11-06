import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaClient } from '@agency-os/database';
import { TrialExpiryProcessor } from './trial-expiry.processor';
import { TrialExpiryScheduler } from './trial-expiry.scheduler';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'billing',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  providers: [PrismaClient, TrialExpiryProcessor, TrialExpiryScheduler],
  exports: [TrialExpiryProcessor],
})
export class BillingWorkerModule {}
