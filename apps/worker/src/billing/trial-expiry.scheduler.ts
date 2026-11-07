import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class TrialExpiryScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(TrialExpiryScheduler.name);

  constructor(@InjectQueue('billing') private readonly billingQueue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Repeatable daily job at 00:00 UTC using BullMQ Job Scheduler
      await this.billingQueue.upsertJobScheduler(
        'daily-trial-expiry',
        {
          pattern: '0 0 * * *',
        },
        {
          name: 'trial.expire',
          data: {},
          opts: {
            removeOnComplete: true,
            removeOnFail: false,
          },
        },
      );
      this.logger.log(
        'Registered repeatable daily trial-expiry job in billing queue',
      );
    } catch (err) {
      this.logger.error('Failed to register repeatable trial-expiry job', err);
    }
  }
}
