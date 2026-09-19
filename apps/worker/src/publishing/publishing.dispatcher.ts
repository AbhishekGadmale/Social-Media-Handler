/* eslint-disable */
import { generateId } from '@agency-os/database';
import { safeParseExecutionMetadata } from '@agency-os/shared';
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaClient, PostStatus } from '@agency-os/database';
import { PublishJobData } from './publishing.types';

@Injectable()
export class PublishingDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublishingDispatcher.name);
  private intervalId?: NodeJS.Timeout;
  private readonly SCAN_INTERVAL_MS = 15000;
  private readonly BATCH_SIZE = 100;

  constructor(
    @InjectQueue('publish') private readonly publishQueue: Queue,
    private readonly prisma: PrismaClient,
  ) {}

  onModuleInit() {
    // Start polling loop
    this.intervalId = setInterval(() => this.scan(), this.SCAN_INTERVAL_MS);
    this.logger.log(
      `Publishing dispatcher started with interval ${this.SCAN_INTERVAL_MS}ms`,
    );
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  async scan() {
    try {
      await this.promoteScheduled();
      await this.dispatchQueued();
      await this.dispatchDeleting();
      await this.dispatchContinuations();
      await this.recoverStalePublishing();
    } catch (error) {
      this.logger.error('Error in publishing dispatcher scan loop', error);
    }
  }

  /**
   * Promotes due SCHEDULED publications to QUEUED.
   */
  private async promoteScheduled() {
    const dueSchedules = await this.prisma.postPlatformVariant.findMany({
      where: {
        status: PostStatus.SCHEDULED,
        scheduledAt: {
          lte: new Date(),
        },
      },
      select: { id: true, workspaceId: true },
      take: this.BATCH_SIZE,
    });

    for (const schedule of dueSchedules) {
      // Atomic promotion
      const result = await this.prisma.postPlatformVariant.updateMany({
        where: {
          id: schedule.id,
          status: PostStatus.SCHEDULED,
        },
        data: {
          status: PostStatus.QUEUED,
          queuedAt: new Date(),
          dispatchVersion: { increment: 1 },
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Promoted SCHEDULED publication to QUEUED: ${schedule.id}`,
        );
      }
    }
  }

  /**
   * Scans QUEUED publications and ensures they are in BullMQ.
   */
  
  private async dispatchDeleting() {
    const queuedTargets = await this.prisma.postPlatformVariant.findMany({ where: { status: 'DELETING' }, select: { id: true, workspaceId: true, dispatchVersion: true }, take: this.BATCH_SIZE });
    for (const target of queuedTargets) {
      const jobId = `delete-${target.id}-v${target.dispatchVersion}`;
      const payload = { workspaceId: target.workspaceId, publicationId: target.id };
      try {
        await this.publishQueue.add('publishing.delete', payload, { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: false });
        this.logger.debug({ msg: 'delete.dispatch.enqueued', publicationId: target.id });
      } catch (error: any) { this.logger.error('Failed to enqueue delete', error); }
    }
  }
  private async dispatchQueued() {
    const queuedTargets = await this.prisma.postPlatformVariant.findMany({
      where: {
        status: PostStatus.QUEUED,
      },
      select: {
        id: true,
        workspaceId: true,
        dispatchVersion: true,
      },
      take: this.BATCH_SIZE,
    });

    for (const target of queuedTargets) {
      const jobId = `publication-${target.id}-v${target.dispatchVersion}`;

      const payload: PublishJobData = {
        workspaceId: target.workspaceId,
        publicationId: target.id,
        dispatchVersion: target.dispatchVersion,
      };

      try {
        await this.publishQueue.add('publish-job', payload, {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false,
        });

        this.logger.debug({
          msg: 'publication.dispatch.enqueued',
          publicationId: target.id,
          workspaceId: target.workspaceId,
          dispatchVersion: target.dispatchVersion,
          jobId,
        });
      } catch (error) {
        this.logger.error({
          msg: 'publication.dispatch.redis_failed',
          publicationId: target.id,
          workspaceId: target.workspaceId,
          error: error.message,
        });
        // Leave it QUEUED, next scan will retry
      }
    }
  }

  /**
   * Recovers stuck PUBLISHING targets to UNKNOWN if older than a threshold.
   */
  
  private async dispatchContinuations() {
    const activeVariants = await this.prisma.postPlatformVariant.findMany({
      where: { status: PostStatus.PUBLISHING },
      select: { id: true, workspaceId: true, dispatchVersion: true, executionMetadata: true },
    });

    const now = new Date();
    for (const variant of activeVariants) {
      if (!variant.executionMetadata) continue;
      const meta = variant.executionMetadata as any;
      if (meta.phase === 'PROCESSING_REMOTE' && meta.nextCheckAt) {
        if (new Date(meta.nextCheckAt) <= now) {
          const jobId = `publication-${variant.id}-v${variant.dispatchVersion}`;
          const payload = {
            workspaceId: variant.workspaceId,
            publicationId: variant.id,
            dispatchVersion: variant.dispatchVersion,
            operationId: meta.operationId,
          };
          
          try {
            await this.publishQueue.add('publish-job', payload, {
              jobId,
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: true,
              removeOnFail: false,
            });
            this.logger.log(`Dispatched continuation for ${variant.id}, jobId: ${jobId}`);
          } catch (error) {
            this.logger.error(`Failed to dispatch continuation for ${variant.id}`, error);
          }
        }
      }
    }
  }

  private async recoverStalePublishing() {
    const PUBLISH_STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 mins
    const thresholdDate = new Date(Date.now() - PUBLISH_STALE_TIMEOUT_MS);

    const staleAttempts = await this.prisma.publicationAttempt.findMany({
      where: {
        status: 'PUBLISHING',
        executionHeartbeatAt: {
          lt: thresholdDate,
        },
      },
      select: {
        id: true,
        variantId: true,
        variant: {
          select: { workspaceId: true, executionMetadata: true },
        },
      },
      take: this.BATCH_SIZE,
    });

    for (const attempt of staleAttempts) {
      
      const variantMeta = attempt.variant.executionMetadata;
      if (variantMeta) {
        const parsed = safeParseExecutionMetadata(variantMeta);
        // If parsed is valid AND it's a PROCESSING_REMOTE state (thus strictly has nextCheckAt), we skip generic recovery.
        // If it's malformed (e.g. missing nextCheckAt), safeParse fails, and we fall through to UNKNOWN recovery, avoiding immortal states.
        if (parsed.success && parsed.data.phase === 'PROCESSING_REMOTE') {
          continue; // Dispatcher owns this, due or future, prevent race with queue backlog
        }
      }

      await this.prisma.$transaction(async (tx) => {
        const updateData: any = { status: PostStatus.UNKNOWN };
        if (variantMeta) {
          updateData.executionMetadata = { ...variantMeta, phase: 'AMBIGUOUS' };
          updateData.dispatchVersion = { increment: 1 };
        }
        const updated = await tx.postPlatformVariant.updateMany({
          where: {
            id: attempt.variantId,
            status: PostStatus.PUBLISHING,
          },
          data: updateData,
        });

        if (updated.count > 0) {
          await tx.publicationAttempt.updateMany({
            where: { id: attempt.id, status: 'PUBLISHING' },
            data: {
              status: 'FAILED',
              failureCategory: 'UNKNOWN_RESULT',
              failureCode: 'EXECUTION_STALE',
              completedAt: new Date(),
            },
          });

          await tx.auditLog.create({
            data: {
              id: generateId(),
              workspace: { connect: { id: attempt.variant.workspaceId } },
              action: 'PUBLICATION_UNKNOWN',
              targetType: 'PublicationTarget',
              targetId: attempt.variantId,
              metadata: { reason: 'EXECUTION_STALE' },
            },
          });
          this.logger.warn(
            `Recovered stale execution to UNKNOWN: ${attempt.variantId}`,
          );
        }
      });
    }
  }
}
