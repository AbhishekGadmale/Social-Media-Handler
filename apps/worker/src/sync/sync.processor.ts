import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import {
  PrismaClient,
  SocialAccountStatus,
  SyncRunStatus,
  generateId,
} from '@agency-os/database';
import { decrypt } from '@agency-os/database/src/crypto/encryption';
import {
  providerRegistry,
  ProviderCapabilityError,
  ProviderRateLimitError,
  ProviderApiError,
} from '@agency-os/providers';
import { invokeCapability } from '@agency-os/providers';
import { Logger, OnModuleInit } from '@nestjs/common';

import { SyncService } from './sync.service';

@Processor('sync')
export class SyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly syncService: SyncService,
  ) {
    super();
  }

  onModuleInit() {
    this.logger.log(
      `Worker successfully started and listening on queue: ${this.worker?.name || 'sync'}`,
    );
  }

  async process(job: Job<any>) {
    if (job.name === 'schedule:sync-all') {
      await this.syncService.enqueueSyncAll();
      return;
    }

    const { socialAccountId, workspaceId } = job.data;

    this.logger.log(
      `Processing sync job ${job.id} for account ${socialAccountId}`,
    );

    const syncRun = await this.prisma.syncRun.create({
      data: {
        id: generateId(),
        status: SyncRunStatus.RUNNING,
      },
    });

    try {
      const account = await this.prisma.socialAccount.findUnique({
        where: { id: socialAccountId },
        include: { connection: true },
      });

      if (!account || !account.connection) {
        throw new Error(
          `Account or connection not found for id: ${socialAccountId}`,
        );
      }

      if (account.status !== SocialAccountStatus.ACTIVE) {
        this.logger.log(
          `Skipping sync for non-active account: ${socialAccountId}`,
        );
        await this.completeSyncRun(syncRun.id, SyncRunStatus.SKIPPED, {
          skipped: true,
          reason: 'not_active',
        });
        return;
      }

      // Check if token expired
      if (
        account.connection.expiresAt &&
        account.connection.expiresAt < new Date()
      ) {
        // mark REAUTH_REQUIRED and skip
        await this.prisma.socialAccount.update({
          where: { id: socialAccountId },
          data: { status: SocialAccountStatus.REAUTH_REQUIRED },
        });
        await this.completeSyncRun(syncRun.id, SyncRunStatus.SKIPPED, {
          skipped: true,
          reason: 'expired_token',
        });
        return;
      }

      this.logger.log(`Job ${job.id}: decrypting access token`);
      const decryptedToken = decrypt({
        encrypted: account.connection.encryptedAccessToken,
        iv: account.connection.accessTokenIv,
        authTag: account.connection.accessTokenAuthTag,
        keyVersion: account.connection.keyVersion,
      });

      const credentials = {
        accessToken: decryptedToken,
      };

      const provider = providerRegistry.get(account.provider.toLowerCase());
      if (!provider) {
        throw new Error(`Provider not found: ${account.provider}`);
      }

      const socialProfile = {
        id: account.externalId,
        name: account.name || '',
      };

      this.logger.log(
        `Job ${job.id}: token decrypted, calling provider.getAccountMetrics`,
      );
      const metrics = await invokeCapability(
        provider,
        'getAccountMetrics',
        credentials,
        socialProfile,
      );

      // Upsert metrics
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      this.logger.log(
        `Job ${job.id}: metrics received, upserting AccountMetricDaily`,
      );
      await this.prisma.accountMetricDaily.upsert({
        where: {
          socialAccountId_date: {
            socialAccountId: account.id,
            date: today,
          },
        },
        update: {
          followers: metrics.followersCount || 0,
          engagement: metrics.engagement || 0,
        },
        create: {
          id: generateId(),
          socialAccountId: account.id,
          date: today,
          followers: metrics.followersCount || 0,
          engagement: metrics.engagement || 0,
        },
      });

      this.logger.log(`Job ${job.id}: upsert complete`);
      await this.completeSyncRun(syncRun.id, SyncRunStatus.COMPLETED, {
        followers: metrics.followersCount,
      });

      this.logger.log(`Job ${job.id} completed successfully`);
    } catch (error: any) {
      if (error instanceof ProviderCapabilityError) {
        // skipped / no-op
        this.logger.log(
          `Capability not supported for provider, skipping. error: ${error.message}`,
        );
        await this.completeSyncRun(syncRun.id, SyncRunStatus.SKIPPED, {
          skipped: true,
          reason: 'capability_unsupported',
        });
        return;
      }

      this.logger.error(
        `Error processing job ${job.id}: ${error.message}`,
        error.stack,
      );

      await this.prisma.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: SyncRunStatus.FAILED,
          error: error.message,
          endedAt: new Date(),
        },
      });

      if (error instanceof ProviderRateLimitError) {
        if (error.retryAfter && job.moveToDelayed) {
          await job.moveToDelayed(
            Date.now() + error.retryAfter * 1000,
            job.token,
          );
          throw new UnrecoverableError('Rate limit exceeded - delayed'); // Prevent immediate retry
        }
        throw error; // Let BullMQ standard retry handle it
      }

      if (error instanceof ProviderApiError) {
        if (error.statusCode === 401) {
          this.logger.log(
            `Job ${job.id}: 401 Unauthorized, marking account as REAUTH_REQUIRED`,
          );
          await this.prisma.socialAccount.update({
            where: { id: socialAccountId },
            data: { status: SocialAccountStatus.REAUTH_REQUIRED },
          });

          await this.completeSyncRun(syncRun.id, SyncRunStatus.FAILED, {
            failed: true,
            reason: 'unauthorized_401',
          });

          return; // Do NOT throw to avoid retrying
        }

        throw error; // Standard backoff retry for other ProviderApiErrors
      }

      // Never let a raw unhandled exception crash the worker process, handle other errors gracefully
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new UnrecoverableError(errorMessage);
    }
  }

  private async completeSyncRun(
    id: string,
    status: SyncRunStatus,
    counts: any,
  ) {
    await this.prisma.syncRun.update({
      where: { id },
      data: {
        status,
        counts,
        endedAt: new Date(),
      },
    });
  }
}
