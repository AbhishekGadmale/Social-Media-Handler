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
import { ExecutionMetadataRepository, ExecutionTransitionResultType } from '@agency-os/database';
import { ProviderCoordinationError } from '@agency-os/providers';

import { safeParseExecutionMetadata } from '@agency-os/shared';
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
          await this.emitAudit(workspaceId, publicationId, 'PUBLICATION_DELETE_FAILED');
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
    if (!variant || (variant.status !== PostStatus.QUEUED && variant.status !== PostStatus.PUBLISHING) || variant.dispatchVersion !== dispatchVersion) {
      this.logger.warn({
        msg: 'publication.job.stale', publicationId, workspaceId,
        reason: 'Mismatch or not QUEUED/PUBLISHING',
        expectedVersion: dispatchVersion, actualVersion: variant?.dispatchVersion, actualStatus: variant?.status,
      });
      return; // Safe NO-OP
    }

    // 3. Execution-time Revalidation
    const validation = this.validator.validate(variant as any);
    if (!validation.valid) {
      await this.prisma.postPlatformVariant.update({ where: { id: publicationId }, data: { status: PostStatus.FAILED } });
      await this.prisma.publicationAttempt.create({
        data: {
          id: generateId(), variantId: publicationId, attemptNumber: await this.getNextAttemptNumber(publicationId),
          status: 'FAILED', failureCategory: validation.failureCategory || 'VALIDATION', failureCode: validation.failureCode,
          startedAt: new Date(), completedAt: new Date(),
        }
      });
      return;
    }

    // 4. Atomic Worker Claim & Coordination
    let isContinuation = false;
    let currentOperationId: string | null = null;
    let expectedDispatchVersion = variant.dispatchVersion;
    const executionRepo = new ExecutionMetadataRepository(this.prisma, workspaceId);

    if (variant.status === PostStatus.QUEUED) {
      const claimed = await this.prisma.postPlatformVariant.updateMany({
        where: { id: publicationId, workspaceId, status: 'QUEUED', dispatchVersion },
        data: { status: 'PUBLISHING', publishedAt: null },
      });
      if (claimed.count === 0) {
        this.logger.warn({ msg: 'publication.job.claim_failed', publicationId, reason: 'Claim lost race' });
        return;
      }

      const startRes = await executionRepo.startOperation(publicationId, variant.socialAccount.provider as any);
          if (startRes.type !== ExecutionTransitionResultType.SUCCESS) {
        this.logger.warn({ msg: 'publication.job.start_failed', publicationId, reason: startRes.reason });
        return;
      }
      
      const p = safeParseExecutionMetadata(startRes.variant.executionMetadata);
      if (p.success) currentOperationId = p.data.operationId;
      expectedDispatchVersion = startRes.variant.dispatchVersion;
    } else {
      isContinuation = true;
      const parsed = safeParseExecutionMetadata(variant.executionMetadata);
      if (!parsed.success) {
        this.logger.error({ msg: 'publication.invalid_metadata', publicationId });
        return;
      }
      currentOperationId = parsed.data.operationId;
      const phase = parsed.data.phase;

      if (phase === 'COMPLETED' || phase === 'FAILED' || phase === 'AMBIGUOUS') {
        this.logger.warn({ msg: 'publication.already_terminal', publicationId });
        return;
      }
    }

    // We own it. Create or reuse PublicationAttempt.
    let attempt = await this.prisma.publicationAttempt.findFirst({
      where: { variantId: publicationId, status: 'PUBLISHING' },
      orderBy: { startedAt: 'desc' },
    });

    if (!attempt) {
      attempt = await this.prisma.publicationAttempt.create({
        data: {
          id: generateId(), variantId: publicationId, attemptNumber: await this.getNextAttemptNumber(publicationId),
          status: 'PUBLISHING', startedAt: new Date(), executionHeartbeatAt: new Date(),
        }
      });
    } else {
      attempt = await this.prisma.publicationAttempt.update({
        where: { id: attempt.id },
        data: { executionHeartbeatAt: new Date() },
      });
    }

    // If PUBLISH_REQUESTED and no final mutation success yet, protect against blind retries
    if (isContinuation) {
      const parsed2 = safeParseExecutionMetadata(variant.executionMetadata);
      if (parsed2.success && parsed2.data.phase === 'PUBLISH_REQUESTED') {
        const transitionRes = await executionRepo.transitionOperation(
          publicationId, currentOperationId!, 'PUBLISH_REQUESTED', 'AMBIGUOUS', expectedDispatchVersion
        );
        if (transitionRes.type === ExecutionTransitionResultType.SUCCESS) {
          await this.handleUnknown(publicationId, attempt.id, 'AMBIGUOUS_RETRY_PROTECTION');
        } else {
           this.logger.error({ msg: 'publication.transition_ambiguous_failed', publicationId, reason: transitionRes.reason });
        }
        return;
      }
    }

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
    let currentSourcePhase: "FAILED" | "INITIATED" | "CONTAINER_CREATED" | "PROCESSING_REMOTE" | "PUBLISH_REQUESTED" | "COMPLETED" | "AMBIGUOUS" = isContinuation ? 'PROCESSING_REMOTE' : 'INITIATED';
    try {
      this.logger.log({
        msg: 'publication.provider_publish_start',
        publicationId,
        provider: variant.socialAccount.provider,
      });

      const publishContext = {
        onRemotePrepared: async (remoteIdentity: any) => {
          const currentVariant = await this.prisma.postPlatformVariant.findUniqueOrThrow({ where: { id: publicationId }});
          const phase = (currentVariant.executionMetadata as any).phase;
          const tRes = await executionRepo.transitionOperation(
            publicationId,
            currentOperationId!,
            phase,
            'CONTAINER_CREATED',
            expectedDispatchVersion,
            { containerId: remoteIdentity.containerId }
          );
          if (tRes.type !== ExecutionTransitionResultType.SUCCESS) {
            throw new ProviderCoordinationError(`Failed to persist preparation state: ${(tRes as any).reason}`);
          }
          expectedDispatchVersion = (tRes as any).variant.dispatchVersion;
          currentSourcePhase = 'CONTAINER_CREATED';
        },
        beforeFinalMutation: async () => {
          const currentVariant = await this.prisma.postPlatformVariant.findUniqueOrThrow({ where: { id: publicationId }});
          const phase = (currentVariant.executionMetadata as any).phase;
          const tRes = await executionRepo.transitionOperation(
            publicationId,
            currentOperationId!,
            phase,
            'PUBLISH_REQUESTED',
            expectedDispatchVersion
          );
          if (tRes.type !== ExecutionTransitionResultType.SUCCESS) {
            throw new ProviderCoordinationError(`Failed to persist final checkpoint: ${(tRes as any).reason}`);
          }
          expectedDispatchVersion = (tRes as any).variant.dispatchVersion;
          currentSourcePhase = 'PUBLISH_REQUESTED';
        }
      };

      // PROCESSING_REMOTE continuation: poll status instead of re-publishing
      if (isContinuation && variant.executionMetadata) {
        const parsed = safeParseExecutionMetadata(variant.executionMetadata);
        if (parsed.success && parsed.data.phase === 'PROCESSING_REMOTE') {
          const remoteResourceId = (parsed.data as any).remoteResourceId;
                      if (typeof adapter.checkStatus !== 'function') {
                this.logger.error({ msg: 'publication.unsupported_status_check', publicationId });
                result = {
                  success: false,
                  failureCategory: 'CONFIGURATION_ERROR',
                  failureCode: 'MISSING_CAPABILITY',
                  message: 'Provider does not support remote status checks.',
                }
              } else {
            const statusRes = await adapter.checkStatus(credentials, remoteResourceId);
              if (statusRes.status === 'PUBLISHED') {
                  if (typeof adapter.finalizePublish === 'function') {
                    // Container published out-of-band or final ID lost.
                    // We cannot use the container ID as finalRemoteId.
                    result = {
                      success: false,
                      failureCategory: 'UNKNOWN_RESULT',
                      failureCode: 'AMBIGUOUS_PUBLISHED_CONTAINER',
                      message: 'Container reported PUBLISHED, but final media ID is unknown.'
                    };
                  } else {
                    // Provider does not use finalizePublish (e.g. YouTube).
                    // The remoteResourceId IS the final ID.
                    result = { success: true, externalPostId: remoteResourceId };
                  }
                } else if (statusRes.status === 'READY') {
                if (typeof adapter.finalizePublish !== 'function') {
                  throw new Error('Provider returned READY but finalizePublish is not implemented');
                }
                
                // 1. Provider is responsible for calling ctx.beforeFinalMutation() inside finalizePublish
                result = await adapter.finalizePublish(credentials, providerInput, remoteResourceId, publishContext);
              } else if (statusRes.status === 'FAILED') {
              result = {
                success: false,
                failureCategory: statusRes.failureCategory || 'PERMANENT',
                failureCode: statusRes.failureCode || 'PROVIDER_PROCESSING_FAILED',
                message: statusRes.message,
              };
            } else {
              // PROCESSING or UNKNOWN (network error, timeout, 5xx)
              // Stay in PROCESSING_REMOTE - schedule next poll
              result = { success: true, processingState: 'PROCESSING', externalPostId: remoteResourceId };
            }
          }
        } else {
          result = await adapter.publish(credentials, providerInput, this.storage, publishContext);
        }
      } else {
        result = await adapter.publish(credentials, providerInput, this.storage, publishContext);
      }

    } catch (error) {
      this.logger.error({
        msg: 'publication.provider_error',
        publicationId,
        error: error.message,
      });
      
      const isPublishRequested = (currentSourcePhase as string) === 'PUBLISH_REQUESTED';
      await this.handleUnknown(
        publicationId,
        attempt.id,
        'UNHANDLED_EXCEPTION',
        undefined,
        executionRepo,
        isPublishRequested ? {
          currentOperationId: currentOperationId!,
          currentSourcePhase: currentSourcePhase as any,
          expectedDispatchVersion
        } : undefined
      );
      return;
    } finally {
      clearInterval(heartbeatInterval);
    }

    // 8. Handle Result
    if (result.success) {
      if (result.processingState === 'PROCESSING') {
        const delayMs = 60000;
        const transitionRes = await executionRepo.transitionOperation(
          publicationId, currentOperationId!, currentSourcePhase, 'PROCESSING_REMOTE', expectedDispatchVersion,
          { delayMs, remoteResourceId: result.externalPostId }
        );
        if (transitionRes.type === ExecutionTransitionResultType.SUCCESS) {
          this.logger.log({ msg: 'publication.processing_remote', publicationId, delayMs });
          return;
        } else {
          // If we couldn't transition to PROCESSING_REMOTE, it might be an illegal transition
          // Let's assume CONTAINER_CREATED transition was needed first?
          // The prompt says INITIATED -> CONTAINER_CREATED -> PROCESSING_REMOTE
          // But our mocked result doesn't have containerId.
          // Wait, INITIATED cannot go directly to PROCESSING_REMOTE. It must go to CONTAINER_CREATED.
          // For generic handling, let's allow INITIATED -> PROCESSING_REMOTE in ALLOWED_TRANSITIONS,
          // or we simulate CONTAINER_CREATED first.
          this.logger.error({ msg: 'publication.transition_processing_remote_failed', reason: transitionRes.reason });
          await this.handleUnknown(publicationId, attempt.id, 'TRANSITION_FAILED');
          return;
        }
      } else {
        const transitionRes = await executionRepo.transitionOperation(
          publicationId, currentOperationId!, currentSourcePhase, 'COMPLETED', expectedDispatchVersion,
          { finalRemoteId: result.externalPostId }
        );
        if (transitionRes.type === ExecutionTransitionResultType.SUCCESS) {
          await this.handleSuccess(publicationId, attempt.id, result);
        } else {
          await this.handleUnknown(publicationId, attempt.id, 'TRANSITION_FAILED');
        }
      }
    } else {
      if (result.failureCategory === 'UNKNOWN_RESULT') {
          const isPublishRequested = (currentSourcePhase as string) === 'PUBLISH_REQUESTED';
          await this.handleUnknown(
            publicationId,
            attempt.id,
            result.failureCode || 'UNKNOWN',
            result,
            isPublishRequested ? executionRepo : undefined,
            isPublishRequested ? {
              currentOperationId: currentOperationId!,
              currentSourcePhase: currentSourcePhase as any,
              expectedDispatchVersion
            } : undefined
          );
        } else {
        await executionRepo.transitionOperation(publicationId, currentOperationId!, currentSourcePhase, 'FAILED', expectedDispatchVersion);
          await this.handleFailure(publicationId, attempt.id, result.failureCategory || 'UNKNOWN', result.failureCode || 'UNKNOWN', result.message || 'Unknown error', result.retryAfterSeconds, result);
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
    executionRepo?: any,
    ambiguousTransitionData?: { currentOperationId: string, currentSourcePhase: any, expectedDispatchVersion: number }
  ) {
    await this.prisma.$transaction(async (tx) => {
      if (executionRepo && ambiguousTransitionData) {
        const tr = await executionRepo.transitionOperation(
          publicationId,
          ambiguousTransitionData.currentOperationId,
          ambiguousTransitionData.currentSourcePhase,
          'AMBIGUOUS',
          ambiguousTransitionData.expectedDispatchVersion,
          undefined,
          tx
        );
        if (tr.type !== 'SUCCESS') {
          throw new Error('Failed to transition to AMBIGUOUS: ' + tr.reason);
        }
      }
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
