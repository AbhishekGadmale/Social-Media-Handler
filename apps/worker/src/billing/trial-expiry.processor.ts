import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaClient, SubscriptionStatus } from '@agency-os/database';

@Processor('billing')
@Injectable()
export class TrialExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(TrialExpiryProcessor.name);

  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async process(job: Job): Promise<any> {
    if (job.name === 'trial.expire') {
      const graceDays =
        parseInt(process.env.TRIAL_END_GRACE_DAYS || '0', 10) || 0;
      this.logger.log(
        `Billing trial expiry scan started (graceDays=${graceDays})`,
      );
      return this.expireTrials(new Date(), graceDays);
    }
    return { skipped: true };
  }

  /**
   * Scans and flips expired trials (trialEndsAt + grace passed, no active subscription)
   * to read-only. Does not delete any data.
   */
  async expireTrials(
    now: Date = new Date(),
    graceDays = 0,
  ): Promise<{
    expiredCount: number;
    expiredWorkspaceIds: string[];
  }> {
    const graceMs = graceDays * 24 * 60 * 60 * 1000;
    const workspaces = await this.prisma.workspace.findMany({
      where: {
        trialEndsAt: { not: null },
      },
      include: {
        subscription: true,
      },
    });

    const expiredWorkspaceIds: string[] = [];

    for (const ws of workspaces) {
      if (!ws.trialEndsAt) continue;

      const expiryWithGrace = ws.trialEndsAt.getTime() + graceMs;
      const isPastGrace = now.getTime() > expiryWithGrace;

      if (!isPastGrace) continue;

      // Check if workspace has an active subscription
      const sub = ws.subscription;
      if (sub && sub.status === SubscriptionStatus.ACTIVE) {
        continue;
      }

      // If subscription exists and is TRIAL, flip to EXPIRED
      if (sub && sub.status === SubscriptionStatus.TRIAL) {
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { status: SubscriptionStatus.EXPIRED },
        });
      }

      expiredWorkspaceIds.push(ws.id);
      this.logger.warn(
        `Workspace trial expired: workspaceId=${ws.id}, trialEndsAt=${ws.trialEndsAt.toISOString()}`,
      );
    }

    this.logger.log(
      `Billing trial expiry completed: ${expiredWorkspaceIds.length} workspaces expired`,
    );

    return {
      expiredCount: expiredWorkspaceIds.length,
      expiredWorkspaceIds,
    };
  }
}
