/* eslint-disable */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Inject } from '@nestjs/common';
import {
  PrismaClient,
  PostStatus,
  Prisma,
  generateId,
  PublishingRepository,
} from '@agency-os/database';
import {
  ProviderRegistry,
  ProviderPublicationInput,
  IObjectStorage,
  IMediaContentSource,
} from '@agency-os/providers';
import { PublishJobData } from './publishing.types';
import { ExecutionValidator } from './execution.validator';
import { TokenService } from './token.service';

@Processor('publish', { concurrency: 5 })
export class PublishingProcessor extends WorkerHost {
  private readonly logger = new Logger(PublishingProcessor.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerRegistry: ProviderRegistry,
    private readonly validator: ExecutionValidator,
    private readonly tokenService: TokenService,
    @Inject('IObjectStorage')
    private readonly storage: IObjectStorage & IMediaContentSource,
  ) {
    super();
  }

  
  private async processDelete(job: Job<any>) {
    const { workspaceId, publicationId } = job.data;
    
    // 1. Authoritative load
    const variant = await this.prisma.postPlatformVariant.findFirst({
      where: { id: publicationId, workspaceId },
      include: { socialAccount: true },
    });
    
    if (!variant) return; // Deleted already
    if (variant.status === 'DELETED') return; // Idempotent
    if (!variant.externalPostId) {
      await this.prisma.postPlatformVariant.update({ where: { id: publicationId }, data: { status: 'DELETED' } });
      return;
    }
    
    // 2. Validate provider
    const provider = this.providerRegistry.get(variant.socialAccount.provider);
    if (!provider || !provider.deletePost) {
      this.logger.error({ msg: 'delete.provider_not_found_or_unsupported', provider: variant.socialAccount.provider });
      throw new Error('Provider does not support deletion');
    }
    
    // 3. Decrypt token
    let credentials;
    try {
      credentials = await this.tokenService.getExecutionCredentials(variant.socialAccountId);
    } catch (err: any) {
      // Mark as unknown or failed depending on the error
      throw err;
    }
    
    // 4. Call provider
    try {
      const res = (await provider.deletePost(credentials, variant.externalPostId)) as any;
      if (res.success) {
        await this.prisma.postPlatformVariant.update({ where: { id: publicationId }, data: { status: 'DELETED' } });
        await this.emitAudit(workspaceId, publicationId, 'PUBLICATION_DELETED_REMOTELY');
      } else {
        if (res.failureCategory === 'AUTH_REQUIRED' || res.failureCategory === 'PERMANENT') {
          // Leave it in UNKNOWN or return to FAILED delete state? Let's mark it UNKNOWN for manual reconciliation
          await this.prisma.postPlatformVariant.update({ where: { id: publicationId }, data: { status: 'UNKNOWN' } });
          await this.emitAudit(workspaceId, publicationId, 'PUBLICATION_DELETE_FAILED', { error: res.message });
        } else {
          throw new Error('Transient failure: ' + res.message); // retry
        }
      }
    } catch (error) {
      throw error; // Let BullMQ retry
    }
  }

  async process(job: Job<any>) {
    if (job.name === 'publishing.delete') return this.processDelete(job);

    const { workspaceId, publicationId, dispatchVersion } = job.data;
    const repo = new PublishingRepository(this.prisma, workspaceId);

    this.logger.debug({
      msg: 'publication.job.started',
      workspaceId,
      publicationId,
      dispatchVersion,
      jobId: job.id,
    });

    // 1. Authoritative load
    const variant = await this.prisma.postPlatformVariant.findFirst({
      where: {
        id: publicationId,
        workspaceId,
      },
      include: {
        post: {
          include: {
            media: { include: { media: true }, orderBy: { sortOrder: 'asc' } },
          },
        },
        socialAccount: true,
      },
    });

    // 2. Stale job verification
    if (
      !variant ||
      variant.status !== PostStatus.QUEUED ||
      variant.dispatchVersion !== dispatchVersion
    ) {
      this.logger.warn({
        msg: 'publication.job.stale',
        publicationId,
        workspaceId,
        reason: 'Mismatch or not QUEUED',
        expectedVersion: dispatchVersion,
        actualVersion: variant?.dispatchVersion,
        actualStatus: variant?.status,
      });
      return; // Safe NO-OP
    }

    // 3. Execution-time Revalidation
    const validation = this.validator.validate(variant as any);
    if (!validation.valid) {
      this.logger.warn({
        msg: 'publication.job.validation_failed',
        publicationId,
        failureCategory: validation.failureCategory,
        failureCode: validation.failureCode,
      });

      // Atomic fail
      await this.prisma.postPlatformVariant.update({
        where: { id: publicationId },
        data: { status: PostStatus.FAILED },
      });

      // Let's create an attempt for this failure
      await this.prisma.publicationAttempt.create({
        data: {
          id: generateId(),
          variantId: publicationId,
          attemptNumber: await this.getNextAttemptNumber(publicationId),
          status: 'FAILED',
          failureCategory: validation.failureCategory || 'VALIDATION',
          failureCode: validation.failureCode,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      return;
    }

    // 4. Atomic Worker Claim (QUEUED -> PUBLISHING)
    const claimed = await this.prisma.postPlatformVariant.updateMany({
      where: {
        id: publicationId,
        workspaceId,
        status: 'QUEUED',
        dispatchVersion,
      },
      data: {
        status: 'PUBLISHING',
        dispatchVersion: { increment: 1 },
        publishedAt: null,
      },
    });
    if (claimed.count === 0) {
      this.logger.warn({
        msg: 'publication.job.claim_failed',
        publicationId,
        reason: 'Claim lost race',
      });
      return;
    }

    // We own it. Create PublicationAttempt.
    const attemptNumber = await this.getNextAttemptNumber(publicationId);
    const attempt = await this.prisma.publicationAttempt.create({
      data: {
        id: generateId(),
        variantId: publicationId,
        attemptNumber,
        status: 'PUBLISHING',
        startedAt: new Date(),
        executionHeartbeatAt: new Date(),
      },
    });

    this.logger.log({
      msg: 'publication.claimed',
      publicationId,
      attemptId: attempt.id,
    });

    // Emit business audit event
    await this.emitAudit(workspaceId, publicationId, 'PUBLICATION_STARTED');

    // 5. Credential Acquisition
    let credentials;
    try {
      credentials = await this.tokenService.getExecutionCredentials(
        variant.socialAccountId,
      );
    } catch (error) {
      await this.handleFailure(
        publicationId,
        attempt.id,
        'AUTH_REQUIRED',
        'CREDENTIALS_UNAVAILABLE',
        error.message,
      );
      return;
    }

    const providerInput: ProviderPublicationInput = {
      attemptId: attempt.id,
      targetId: publicationId,
      workspaceId,
      externalAccountId: variant.socialAccount.externalId,
      content: variant.content || variant.post.content || '',
      media: variant.post.media.map((m) => ({
        key: m.media.storageKey,
        mimeType: m.media.mimeType,
        sizeBytes: Number(m.media.byteSize),
      })),
      providerOptions: variant.providerOptions,
    };

    // 7. Invoke Provider
    const adapter = this.providerRegistry.getPublishingAdapter(
      variant.socialAccount.provider,
    );

    const PUBLISH_HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
    const heartbeatInterval = setInterval(async () => {
      try {
        const res = await this.prisma.publicationAttempt.updateMany({
          where: { id: attempt.id, status: 'PUBLISHING' },
          data: { executionHeartbeatAt: new Date() },
        });
        if (res.count === 0) {
          this.logger.warn(`Heartbeat update failed for attempt ${attempt.id}`);
        }
      } catch (err) {
        this.logger.error(
          `Error during heartbeat for attempt ${attempt.id}: ${err.message}`,
        );
      }
    }, PUBLISH_HEARTBEAT_INTERVAL_MS);

    let result;
    try {
      this.logger.log({
        msg: 'publication.provider_publish_start',
        publicationId,
        provider: variant.socialAccount.provider,
      });
      result = await adapter.publish(credentials, providerInput, this.storage);
    } catch (error) {
      this.logger.error({
        msg: 'publication.provider_error',
        publicationId,
        error: error.message,
      });
      await this.handleUnknown(
        publicationId,
        attempt.id,
        'UNHANDLED_EXCEPTION',
      );
      return;
    } finally {
      clearInterval(heartbeatInterval);
    }

    // 8. Handle Result
    if (result.success) {
      await this.handleSuccess(publicationId, attempt.id, result);
    } else {
      if (result.failureCategory === 'UNKNOWN_RESULT') {
        await this.handleUnknown(
          publicationId,
          attempt.id,
          result.failureCode,
          result,
        );
      } else {
        await this.handleFailure(
          publicationId,
          attempt.id,
          result.failureCategory,
          result.failureCode,
          result.message,
          result.retryAfterSeconds,
          result, // rawResult
        );
      }
    }
  }

  private async getNextAttemptNumber(variantId: string): Promise<number> {
    const lastAttempt = await this.prisma.publicationAttempt.findFirst({
      where: { variantId },
      orderBy: { attemptNumber: 'desc' },
    });
    return lastAttempt ? lastAttempt.attemptNumber + 1 : 1;
  }

  private sanitizeProviderResponse(raw: any): any {
    if (!raw || typeof raw !== 'object') return null;
    return {
      providerRequestId: raw.providerRequestId,
      externalPostId: raw.externalPostId,
      canonicalUrl: raw.canonicalUrl,
      processingState: raw.processingState,
      safeErrorCode: raw.safeErrorCode,
      retryAfterSeconds: raw.retryAfterSeconds,
    };
  }

  private async handleSuccess(
    publicationId: string,
    attemptId: string,
    result: any,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.postPlatformVariant.update({
        where: { id: publicationId },
        data: {
          status: PostStatus.PUBLISHED,
          publishedAt: result.publishedAt || new Date(),
          externalPostId: result.externalPostId,
          canonicalUrl: result.canonicalUrl,
          providerProcessingState: result.processingState || null,
        },
      });
      await tx.publicationAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'SUCCESS',
          completedAt: new Date(),
        },
      });
    });

    this.logger.log({ msg: 'publication.succeeded', publicationId });
    const variant = await this.prisma.postPlatformVariant.findUnique({
      where: { id: publicationId },
    });
    if (variant)
      await this.emitAudit(
        variant.workspaceId,
        publicationId,
        'PUBLICATION_SUCCEEDED',
      );
  }

  private async handleFailure(
    publicationId: string,
    attemptId: string,
    category: any,
    code: string,
    message: string,
    retryAfter?: number,
    rawResult?: any,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.postPlatformVariant.update({
        where: { id: publicationId },
        data: {
          status: PostStatus.FAILED,
        },
      });
      await tx.publicationAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'FAILED',
          failureCategory: category,
          failureCode: code,
          completedAt: new Date(),
          providerResponse: rawResult
            ? this.sanitizeProviderResponse(rawResult)
            : null,
        },
      });
    });

    this.logger.warn({
      msg: 'publication.failed',
      publicationId,
      category,
      code,
    });
    const variant = await this.prisma.postPlatformVariant.findUnique({
      where: { id: publicationId },
    });
    if (variant)
      await this.emitAudit(
        variant.workspaceId,
        publicationId,
        'PUBLICATION_FAILED',
      );
  }

  private async handleUnknown(
    publicationId: string,
    attemptId: string,
    code: string,
    rawResult?: any,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.postPlatformVariant.update({
        where: { id: publicationId },
        data: {
          status: PostStatus.UNKNOWN,
        },
      });
      await tx.publicationAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'FAILED',
          failureCategory: 'UNKNOWN_RESULT',
          failureCode: code,
          completedAt: new Date(),
          providerResponse: rawResult
            ? this.sanitizeProviderResponse(rawResult)
            : { message: 'Unhandled exception' },
        },
      });
    });

    this.logger.warn({ msg: 'publication.unknown', publicationId, code });
    const variant = await this.prisma.postPlatformVariant.findUnique({
      where: { id: publicationId },
    });
    if (variant)
      await this.emitAudit(
        variant.workspaceId,
        publicationId,
        'PUBLICATION_UNKNOWN',
      );
  }

  private async emitAudit(
    workspaceId: string,
    targetId: string,
    event: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        id: generateId(),
        workspace: { connect: { id: workspaceId } },
        action: event,
        targetType: 'PublicationTarget',
        targetId,
        metadata: {},
      },
    });
  }
}
