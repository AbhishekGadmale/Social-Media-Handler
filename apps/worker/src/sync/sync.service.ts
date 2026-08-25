import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaClient, SocialAccountStatus } from '@agency-os/database';

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectQueue('sync') private readonly syncQueue: Queue,
    private readonly prisma: PrismaClient,
  ) {}

  async onModuleInit() {
    // Register the repeatable job
    await this.syncQueue.upsertJobScheduler(
      'schedule:sync-all-job',
      { pattern: '0 3 * * *' },
      {
        name: 'schedule:sync-all',
      },
    );
    this.logger.log('Registered repeatable job schedule:sync-all');
  }

  async enqueueSyncAll() {
    const activeAccounts = await this.prisma.socialAccount.findMany({
      where: {
        status: SocialAccountStatus.ACTIVE,
      },
      select: {
        id: true,
        workspaceId: true,
      },
    });

    for (const account of activeAccounts) {
      await this.syncQueue.add(
        'sync-account',
        {
          socialAccountId: account.id,
          workspaceId: account.workspaceId,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      );
    }

    this.logger.log(`Enqueued ${activeAccounts.length} account sync jobs`);
  }
}
