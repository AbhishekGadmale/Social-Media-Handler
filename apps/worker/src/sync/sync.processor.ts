import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import {
  PrismaClient,
  SocialAccountStatus,
  SyncRunStatus,
  generateId,
} from '@agency-os/database';
import {
  providerRegistry,
  ProviderCapabilityError,
  ProviderRateLimitError,
  ProviderApiError,
} from '@agency-os/providers';
import { invokeCapability } from '@agency-os/providers';
import { OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { SyncService } from './sync.service';
import { TokenService, AuthRequiredError } from '../publishing/token.service';
import { SyncJobData } from '@agency-os/shared';

@Processor('sync')
export class SyncProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly syncService: SyncService,
    private readonly tokenService: TokenService,
    @InjectPinoLogger(SyncProcessor.name)
    private readonly logger: PinoLogger,
  ) {
    super();
  }

  onModuleInit() {
    this.logger.info(
      { queue: this.worker?.name || 'sync', action: 'worker.started' },
      `Worker successfully started and listening on queue: ${this.worker?.name || 'sync'}`,
    );
  }

  async process(job: Job<SyncJobData>) {
    if (job.name === 'schedule:sync-all') {
      await this.syncService.enqueueSyncAll();
      return;
    }

    const { socialAccountId, workspaceId, correlationId } = job.data || {};

    const jobMeta = {
      jobId: job.id,
      socialAccountId,
      workspaceId,
      ...(correlationId ? { correlationId } : {}),
    };

    this.logger.info(
      {
        ...jobMeta,
        action: 'sync_job_started',
      },
      'Processing sync job',
    );

    const syncRun = await this.prisma.syncRun.create({
      data: {
        id: generateId(),
        status: SyncRunStatus.RUNNING,
      },
    });

    try {
      if (!socialAccountId || !workspaceId) {
        throw new UnrecoverableError(
          `Missing required socialAccountId or workspaceId in job data (received socialAccountId: ${socialAccountId}, workspaceId: ${workspaceId})`,
        );
      }

      const account = await this.prisma.socialAccount.findFirst({
        where: {
          id: socialAccountId,
          workspaceId,
        },
        include: { connection: true },
      });

      if (!account || !account.connection) {
        throw new UnrecoverableError(
          `Account or connection not found for id: ${socialAccountId} in workspace: ${workspaceId}`,
        );
      }

      if (account.status !== SocialAccountStatus.ACTIVE) {
        this.logger.info(
          {
            ...jobMeta,
            action: 'sync_skipped',
            reason: 'not_active',
          },
          'Skipping sync for non-active account',
        );
        await this.completeSyncRun(syncRun.id, SyncRunStatus.SKIPPED, {
          skipped: true,
          reason: 'not_active',
        });
        return;
      }

      // Check & obtain valid execution credentials via TokenService
      let credentials;
      try {
        credentials = await this.tokenService.getExecutionCredentials(
          socialAccountId,
          workspaceId,
        );
      } catch (error: any) {
        if (error instanceof AuthRequiredError) {
          this.logger.info(
            {
              ...jobMeta,
              action: 'sync_skipped',
              reason: 'expired_token',
            },
            'Skipping sync due to expired token requiring reauth',
          );
          await this.completeSyncRun(syncRun.id, SyncRunStatus.SKIPPED, {
            skipped: true,
            reason: 'expired_token',
          });
          return;
        }
        throw error;
      }

      const provider = providerRegistry.get(account.provider.toLowerCase());
      if (!provider) {
        throw new Error(`Provider not found: ${account.provider}`);
      }

      const socialProfile = {
        id: account.externalId,
        name: account.name || '',
      };

      this.logger.info(
        {
          ...jobMeta,
          provider: account.provider,
          action: 'fetch_metrics',
        },
        'token decrypted, calling provider.getAccountMetrics',
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

      this.logger.info(
        {
          ...jobMeta,
          action: 'upsert_metrics',
        },
        'metrics received, upserting AccountMetricDaily',
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

      await this.completeSyncRun(syncRun.id, SyncRunStatus.COMPLETED, {
        followers: metrics.followersCount,
      });

      this.logger.info(
        {
          ...jobMeta,
          action: 'sync_completed',
        },
        'Job completed successfully',
      );
    } catch (error: any) {
      if (error instanceof ProviderCapabilityError) {
        // skipped / no-op
        this.logger.info(
          {
            ...jobMeta,
            action: 'sync_skipped',
            reason: 'capability_unsupported',
            error: error.message,
          },
          'Capability not supported for provider, skipping.',
        );
        await this.completeSyncRun(syncRun.id, SyncRunStatus.SKIPPED, {
          skipped: true,
          reason: 'capability_unsupported',
        });
        return;
      }

      this.logger.error(
        {
          ...jobMeta,
          err: error,
          action: 'sync_failed',
        },
        'Error processing job',
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
        this.logger.warn(
          {
            ...jobMeta,
            retryAfter: error.retryAfter,
            action: 'rate_limit_delay',
          },
          'Provider rate limit exceeded',
        );
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
          this.logger.info(
            {
              ...jobMeta,
              action: 'sync_failed_401',
            },
            '401 Unauthorized, marking account as REAUTH_REQUIRED',
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

      if (error instanceof UnrecoverableError) {
        throw error;
      }

      // Allow transient errors (network, Redis lock, database blips, 5xx) to bubble up so BullMQ can retry
      throw error;
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
