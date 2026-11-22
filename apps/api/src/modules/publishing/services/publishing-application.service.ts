/* eslint-disable */
import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaClient } from '@agency-os/database';
import { AuditService } from '../../core/audit.service';
import { PublishabilityValidator } from '../domain/PublishabilityValidator';
import {
  PublishingRepository,
  AuditAction,
  ApprovalStatus,
} from '@agency-os/database';
import { generateId } from '@agency-os/database';
import { PostStatus, Prisma } from '@agency-os/database';
import { ExecutionMetadata, ExecutionPhase } from '@agency-os/shared';
import { CreatePostDto, UpdatePostDto } from '../dto/post.dto';
import {
  AddPublicationTargetDto,
  UpdatePublicationTargetDto,
  SchedulePublicationDto,
} from '../dto/publication.dto';
import {
  EMAIL_DELIVERY_SERVICE,
  type EmailDeliveryService,
} from '../../auth/email-delivery.service';

@Injectable()
export class PublishingApplicationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly validator: PublishabilityValidator,
    @Inject(EMAIL_DELIVERY_SERVICE)
    private readonly emailDeliveryService: EmailDeliveryService,
    @InjectPinoLogger(PublishingApplicationService.name)
    private readonly logger: PinoLogger,
  ) {}

  private getRepo(workspaceId: string) {
    return new PublishingRepository(this.prisma, workspaceId);
  }

  private async invalidateApprovalIfActive(
    workspaceId: string,
    authorId: string,
    postId: string,
    reason: string,
  ): Promise<boolean> {
    const repo = this.getRepo(workspaceId);
    const post = (await repo.posts.findById(postId)) as any;
    if (
      post &&
      (post.approvalStatus === ApprovalStatus.PENDING ||
        post.approvalStatus === ApprovalStatus.APPROVED)
    ) {
      await repo.posts.update({
        where: { id: postId },
        data: {
          approvalStatus: ApprovalStatus.NOT_SUBMITTED,
          approvalDecidedById: null,
          approvalDecidedAt: null,
          approvalComment: null,
        },
      });
      await this.audit.logAction({
        workspaceId,
        actorId: authorId,
        action: AuditAction.POST_APPROVAL_INVALIDATED,
        targetType: 'POST',
        targetId: postId,
        metadata: { postId, reason },
      });
      return true;
    }
    return false;
  }

  private async assertPostCanPublish(
    repo: PublishingRepository,
    postId: string,
  ) {
    const post = (await repo.posts.findById(postId)) as any;
    if (!post) throw new NotFoundException('Post not found');
    if (post.approvalStatus === ApprovalStatus.PENDING) {
      throw new ConflictException(
        'Post is pending approval and cannot be published yet.',
      );
    }
    if (post.approvalStatus === ApprovalStatus.CHANGES_REQUESTED) {
      throw new ConflictException(
        'Changes were requested for this post. Edit it and resubmit for approval before publishing.',
      );
    }
  }

  // --- DRAFTS --- //

  async createDraft(workspaceId: string, authorId: string, dto: CreatePostDto) {
    // Verify media belongs to workspace
    if (dto.mediaIds?.length) {
      const media = await this.prisma.mediaAsset.findMany({
        where: { id: { in: dto.mediaIds }, workspaceId },
      });
      if (media.length !== dto.mediaIds.length) {
        throw new NotFoundException(
          'One or more media assets not found in workspace',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const post = await tx.post.create({
        data: {
          id: generateId(),
          workspaceId,
          authorId,
          content: dto.content || '',
          status: PostStatus.DRAFT,
          media: {
            create:
              dto.mediaIds?.map((mediaId, index) => ({
                id: generateId(),
                mediaId,
                sortOrder: index,
              })) || [],
          },
        },
        include: { media: true, variants: true },
      });

      await this.audit.logAction(
        {
          workspaceId,
          actorId: authorId,
          action: AuditAction.POST_CREATED,
          targetType: 'POST',
          targetId: post.id,
          metadata: { postId: post.id },
        },
        tx,
      );

      return post;
    });
  }

  async getPosts(
    workspaceId: string,
    take = 50,
    skip = 0,
    scopeClientId?: string,
  ) {
    const repo = this.getRepo(workspaceId);
    return repo.posts.findMany({
      take,
      skip,
      where: scopeClientId
        ? {
            variants: {
              some: {
                socialAccount: {
                  clientId: scopeClientId,
                },
              },
            },
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        media: { orderBy: { sortOrder: 'asc' }, include: { media: true } },
        variants: { include: { socialAccount: true } },
      },
    });
  }

  async getPostById(
    workspaceId: string,
    postId: string,
    scopeClientId?: string,
  ) {
    const repo = this.getRepo(workspaceId);
    const post: any = await repo.posts.findById(postId, {
      include: {
        media: { orderBy: { sortOrder: 'asc' }, include: { media: true } },
        variants: { include: { socialAccount: true } },
      },
    });
    if (!post) throw new NotFoundException('Post not found');

    if (
      scopeClientId &&
      !post.variants?.some(
        (v: any) => v.socialAccount?.clientId === scopeClientId,
      )
    ) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  async updateDraft(
    workspaceId: string,
    authorId: string,
    postId: string,
    dto: UpdatePostDto,
  ) {
    if (dto.mediaIds) {
      const media = await this.prisma.mediaAsset.findMany({
        where: { id: { in: dto.mediaIds }, workspaceId },
      });
      if (media.length !== dto.mediaIds.length) {
        throw new NotFoundException(
          'One or more media assets not found in workspace',
        );
      }
    }

    const repo = this.getRepo(workspaceId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const postRows = await repo.lockPostForUpdate(tx, postId);
      if (!postRows || postRows.length === 0) {
        throw new NotFoundException('Post not found');
      }

      const variantRows = await repo.lockVariantsForUpdate(tx, postId);
      const lockedVariant = variantRows.find((v: any) =>
        [
          PostStatus.QUEUED,
          PostStatus.PUBLISHING,
          PostStatus.PUBLISHED,
          PostStatus.UNKNOWN,
          PostStatus.SCHEDULED,
        ].includes(v.status),
      );

      if (lockedVariant) {
        throw new ForbiddenException(
          `Cannot edit post while a publication is in ${lockedVariant.status} state`,
        );
      }

      const post = await tx.post.findUnique({
        where: { id: postId, workspaceId },
      });
      if (!post) throw new NotFoundException('Post not found');

      const data: any = {};
      if (dto.content !== undefined) data.content = dto.content;

      if (dto.mediaIds) {
        await tx.postMedia.deleteMany({ where: { postId } });
        data.media = {
          create: dto.mediaIds.map((mediaId, index) => ({
            id: generateId(),
            mediaId,
            sortOrder: index,
          })),
        };
      }

      let invalidated = false;
      if (
        post.approvalStatus === ApprovalStatus.PENDING ||
        post.approvalStatus === ApprovalStatus.APPROVED
      ) {
        data.approvalStatus = ApprovalStatus.NOT_SUBMITTED;
        data.approvalDecidedById = null;
        data.approvalDecidedAt = null;
        data.approvalComment = null;
        invalidated = true;
      }

      const res = await tx.post.update({
        where: { id: postId, workspaceId },
        data,
        include: {
          media: { orderBy: { sortOrder: 'asc' }, include: { media: true } },
          variants: { include: { socialAccount: true } },
        },
      });

      if (invalidated) {
        await this.audit.logAction(
          {
            workspaceId,
            actorId: authorId,
            action: AuditAction.POST_APPROVAL_INVALIDATED,
            targetType: 'POST',
            targetId: postId,
            metadata: { postId, reason: 'draft_updated' },
          },
          tx,
        );
      }

      await this.audit.logAction(
        {
          workspaceId,
          actorId: authorId,
          action: AuditAction.POST_UPDATED,
          targetType: 'POST',
          targetId: postId,
          metadata: { postId },
        },
        tx,
      );

      return res;
    });

    return updated;
  }

  async deletePost(workspaceId: string, authorId: string, postId: string) {
    const repo = this.getRepo(workspaceId);

    return this.prisma.$transaction(async (tx) => {
      const postRows = await repo.lockPostForUpdate(tx, postId);
      if (!postRows || postRows.length === 0) {
        throw new NotFoundException('Post not found');
      }

      const variantRows = await repo.lockVariantsForUpdate(tx, postId);
      const unsafeVariant = variantRows.find((v: any) =>
        [
          PostStatus.QUEUED,
          PostStatus.PUBLISHING,
          PostStatus.PUBLISHED,
          PostStatus.UNKNOWN,
          PostStatus.SCHEDULED,
        ].includes(v.status),
      );

      if (unsafeVariant) {
        throw new ForbiddenException(
          `Cannot delete post with a publication in ${unsafeVariant.status} state`,
        );
      }

      await tx.post.delete({
        where: { id: postId, workspaceId },
      });

      await this.audit.logAction(
        {
          workspaceId,
          actorId: authorId,
          action: AuditAction.POST_DELETED,
          targetType: 'POST',
          targetId: postId,
          metadata: { postId },
        },
        tx,
      );

      return true;
    });
  }

  // --- PUBLICATIONS (TARGETS) --- //

  async addTarget(
    workspaceId: string,
    authorId: string,
    postId: string,
    dto: AddPublicationTargetDto,
  ) {
    this.logger.debug(
      { workspaceId, postId, action: 'target.add_requested' },
      'Adding publication target',
    );
    const post = await this.getPostById(workspaceId, postId);

    const account = await this.prisma.socialAccount.findFirst({
      where: { id: dto.socialAccountId, workspaceId },
    });
    if (!account) throw new NotFoundException('Social account not found');

    const existing = post.variants.find(
      (v: any) => v.socialAccountId === dto.socialAccountId,
    );
    if (existing)
      throw new ConflictException('PUBLICATION_TARGET_ALREADY_EXISTS');

    const repo = this.getRepo(workspaceId);
    const variant = await repo.variants.create({
      data: {
        post: { connect: { id: postId } },
        id: generateId(),
        socialAccount: { connect: { id: dto.socialAccountId } },
        status: PostStatus.DRAFT,
        content: dto.content,
        providerOptions: dto.providerOptions || Prisma.JsonNull,
      } as any,
    });

    await this.audit.logAction({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_TARGET_ADDED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variant.id,
      metadata: {
        postId,
        variantId: variant.id,
        socialAccountId: dto.socialAccountId,
      },
    });
    await this.invalidateApprovalIfActive(
      workspaceId,
      authorId,
      postId,
      'target_added',
    );
    return repo.variants.findById(variant.id, {
      include: { socialAccount: true },
    });
  }

  async updateTarget(
    workspaceId: string,
    authorId: string,
    variantId: string,
    dto: UpdatePublicationTargetDto,
  ) {
    const repo = this.getRepo(workspaceId);
    const variant = (await repo.variants.findById(variantId)) as any;
    if (!variant) throw new NotFoundException('Publication not found');

    if (
      [
        PostStatus.QUEUED,
        PostStatus.PUBLISHING,
        PostStatus.PUBLISHED,
        PostStatus.UNKNOWN,
        PostStatus.SCHEDULED,
      ].includes(variant.status)
    ) {
      throw new ForbiddenException(
        `Cannot update target in ${variant.status} state`,
      );
    }

    const updated = await repo.variants.update({
      where: { id: variantId },
      data: {
        content: dto.content !== undefined ? dto.content : variant.content,
        providerOptions:
          dto.providerOptions !== undefined
            ? dto.providerOptions || Prisma.JsonNull
            : variant.providerOptions || Prisma.JsonNull,
      },
    });

    await this.audit.logAction({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_TARGET_UPDATED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { postId: variant.postId, variantId },
    });
    await this.invalidateApprovalIfActive(
      workspaceId,
      authorId,
      variant.postId,
      'target_updated',
    );
    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  async removeTarget(workspaceId: string, authorId: string, variantId: string) {
    const repo = this.getRepo(workspaceId);
    const variant = (await repo.variants.findById(variantId)) as any;
    if (!variant) throw new NotFoundException('Publication not found');

    if (
      [
        PostStatus.QUEUED,
        PostStatus.PUBLISHING,
        PostStatus.PUBLISHED,
        PostStatus.UNKNOWN,
        PostStatus.SCHEDULED,
      ].includes(variant.status)
    ) {
      throw new ForbiddenException(
        `Cannot remove target in ${variant.status} state`,
      );
    }

    await this.invalidateApprovalIfActive(
      workspaceId,
      authorId,
      variant.postId,
      'target_removed',
    );
    await repo.variants.delete({ where: { id: variantId } });
    await this.audit.logAction({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_TARGET_REMOVED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { postId: variant.postId, variantId },
    });
    return true;
  }

  // --- LIFECYCLE COMMANDS --- //

  async validateTarget(
    workspaceId: string,
    variantId: string,
    isRetry = false,
    scopeClientId?: string,
  ) {
    if (scopeClientId) {
      const variant = await this.prisma.postPlatformVariant.findFirst({
        where: { id: variantId, workspaceId },
        include: { socialAccount: true },
      });
      if (!variant || variant.socialAccount?.clientId !== scopeClientId) {
        throw new NotFoundException('Publication target not found');
      }
    }

    const result = await this.validator.validateTarget(
      workspaceId,
      variantId,
      isRetry,
    );
    return result;
  }

  async requestPublish(
    workspaceId: string,
    authorId: string,
    variantId: string,
  ) {
    const repo = this.getRepo(workspaceId);
    const variant = (await repo.variants.findById(variantId)) as any;
    if (!variant) throw new NotFoundException('Publication not found');

    await this.assertPostCanPublish(repo, variant.postId);

    const validation = await this.validateTarget(workspaceId, variantId);
    if (!validation.valid) {
      this.logger.warn(
        {
          workspaceId,
          variantId,
          issues: validation.issues,
          action: 'publication.validation_failed',
        },
        'Validation failed for publication target',
      );
      throw new UnprocessableEntityException({
        message: 'PUBLISHABILITY_FAILED',
        issues: validation.issues,
      });
    }

    const success = await repo.queueForPublishing(variantId);
    if (!success) {
      throw new ConflictException(
        'PUBLICATION_STATE_INVALID or concurrent transition',
      );
    }

    await this.audit.logAction({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_REQUESTED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId },
    });
    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  async requestRemoteDelete(
    workspaceId: string,
    authorId: string,
    variantId: string,
  ) {
    const repo = this.getRepo(workspaceId);
    const variant = (await repo.variants.findById(variantId)) as any;
    if (!variant) throw new NotFoundException('Publication not found');
    if (variant.status === 'DELETED') return variant;
    if (!variant.externalPostId)
      throw new UnprocessableEntityException(
        'Cannot delete publication without an external ID',
      );
    const success = await repo.queueForDeletion(variantId);
    if (!success)
      throw new ConflictException('Cannot delete variant in this state');
    await this.audit.logAction({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_DELETE_REQUESTED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { publicationId: variantId },
    });
    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  async requestRetry(workspaceId: string, authorId: string, variantId: string) {
    const repo = this.getRepo(workspaceId);
    const variant = (await repo.variants.findById(variantId)) as any;
    if (!variant) throw new NotFoundException('Publication not found');

    await this.assertPostCanPublish(repo, variant.postId);

    const validation = await this.validateTarget(workspaceId, variantId, true);
    if (!validation.valid) {
      throw new UnprocessableEntityException({
        message: 'PUBLISHABILITY_FAILED',
        issues: validation.issues,
      });
    }

    const success = await repo.transitionVariantState(
      variantId,
      PostStatus.FAILED,
      PostStatus.QUEUED,
      { queuedAt: new Date() },
    );
    if (!success) {
      throw new ConflictException(
        'PUBLICATION_STATE_INVALID or concurrent transition',
      );
    }

    await this.audit.logAction({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_RETRY_REQUESTED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId },
    });
    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  async schedule(
    workspaceId: string,
    authorId: string,
    variantId: string,
    dto: SchedulePublicationDto,
  ) {
    const repo = this.getRepo(workspaceId);

    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt <= new Date()) {
      throw new UnprocessableEntityException(
        'Scheduled time must be in the future',
      );
    }

    const variant = (await repo.variants.findById(variantId)) as any;
    if (!variant || variant.status !== PostStatus.DRAFT) {
      throw new ConflictException('Only DRAFT can be scheduled directly');
    }

    await this.assertPostCanPublish(repo, variant.postId);

    const success = await repo.transitionVariantState(
      variantId,
      PostStatus.DRAFT,
      PostStatus.SCHEDULED,
      { scheduledAt },
    );
    if (!success) throw new ConflictException('Transition failed');

    // re-validate after setting state
    const validation = await this.validateTarget(workspaceId, variantId);
    if (!validation.valid) {
      // rollback
      await repo.transitionVariantState(
        variantId,
        PostStatus.SCHEDULED,
        PostStatus.DRAFT,
        { scheduledAt: null },
      );
      throw new UnprocessableEntityException({
        message: 'PUBLISHABILITY_FAILED',
        issues: validation.issues,
      });
    }

    await this.audit.logAction({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_SCHEDULED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId, scheduledAt: scheduledAt.toISOString() },
    });
    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  async reschedule(
    workspaceId: string,
    authorId: string,
    variantId: string,
    dto: SchedulePublicationDto,
  ) {
    const repo = this.getRepo(workspaceId);
    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt <= new Date()) {
      throw new UnprocessableEntityException(
        'Scheduled time must be in the future',
      );
    }

    const variant = (await repo.variants.findById(variantId)) as any;
    if (!variant || variant.status !== PostStatus.SCHEDULED) {
      throw new ConflictException('Target is not SCHEDULED');
    }

    await this.assertPostCanPublish(repo, variant.postId);

    const success = await repo.transitionVariantState(
      variantId,
      PostStatus.SCHEDULED,
      PostStatus.SCHEDULED,
      { scheduledAt },
    );
    if (!success) throw new ConflictException('Reschedule failed');

    await this.audit.logAction({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_RESCHEDULED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId, scheduledAt: scheduledAt.toISOString() },
    });
    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  async unschedule(workspaceId: string, authorId: string, variantId: string) {
    const repo = this.getRepo(workspaceId);
    const success = await repo.unschedule(variantId);
    if (!success) throw new ConflictException('Target is not SCHEDULED');

    await this.audit.logAction({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_UNSCHEDULED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId },
    });
    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  async cancelQueued(workspaceId: string, authorId: string, variantId: string) {
    const repo = this.getRepo(workspaceId);
    const success = await repo.cancelQueued(variantId);
    if (!success) throw new ConflictException('Target is not QUEUED');

    await this.audit.logAction({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_CANCELLED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId },
    });
    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  async reconcile(
    workspaceId: string,
    authorId: string,
    variantId: string,
    dto: {
      decision: 'CONFIRM_PUBLISHED' | 'CONFIRM_FAILED';
      externalPostId?: string;
      canonicalUrl?: string;
      reason: string;
    },
  ) {
    const repo = this.getRepo(workspaceId);
    const variant = await repo.variants.findById(variantId);
    if (!variant) throw new NotFoundException('Publication not found');

    if (variant.status !== PostStatus.UNKNOWN) {
      throw new ConflictException(
        `Cannot reconcile target in ${variant.status} state`,
      );
    }

    const now = new Date();
    const updateData: Prisma.PostPlatformVariantUpdateInput = {
      reconciledAt: now,
      reconciledBy: authorId,
      reconciliationReason: dto.reason,
      status:
        dto.decision === 'CONFIRM_PUBLISHED'
          ? PostStatus.PUBLISHED
          : PostStatus.FAILED,
    };

    const execMeta = variant.executionMetadata as ExecutionMetadata | null;
    if (!execMeta || execMeta.phase !== 'AMBIGUOUS') {
      throw new ConflictException(
        'Reconciliation requires executionMetadata in AMBIGUOUS phase',
      );
    }

    let nextExecMeta: ExecutionMetadata;
    const { phase, ...rest } = execMeta;

    if (dto.decision === 'CONFIRM_PUBLISHED') {
      if (!dto.externalPostId || dto.externalPostId.trim() === '') {
        throw new UnprocessableEntityException(
          'externalPostId is required for CONFIRM_PUBLISHED',
        );
      }
      updateData.publishedAt = now;
      updateData.externalPostId = dto.externalPostId;
      if (dto.canonicalUrl) updateData.canonicalUrl = dto.canonicalUrl;

      nextExecMeta = {
        ...rest,
        phase: 'COMPLETED',
        finalRemoteId: dto.externalPostId,
      };
    } else {
      nextExecMeta = {
        ...rest,
        phase: 'FAILED',
      };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. Variant CAS
        const updated = await tx.postPlatformVariant.updateMany({
          where: {
            id: variantId,
            workspaceId,
            status: PostStatus.UNKNOWN,
          },
          data: {
            ...updateData,
            executionMetadata: nextExecMeta as Prisma.InputJsonValue,
          },
        });

        if (updated.count === 0) {
          throw new ConflictException(
            'Reconciliation failed due to concurrent modification',
          );
        }

        // 2. Publication Attempt sync
        const attempts = await tx.publicationAttempt.findMany({
          where: {
            variantId,
            status: 'FAILED',
            failureCategory: 'UNKNOWN_RESULT',
          },
        });

        if (attempts.length !== 1) {
          throw new ConflictException(
            `Expected exactly 1 eligible publication attempt, found ${attempts.length}`,
          );
        }

        const attempt = attempts[0];

        await tx.publicationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: dto.decision === 'CONFIRM_PUBLISHED' ? 'SUCCESS' : 'FAILED',
            failureCategory:
              dto.decision === 'CONFIRM_PUBLISHED' ? null : 'PERMANENT',
            completedAt: now,
          },
        });

        // 3. Audit Log
        await tx.auditLog.create({
          data: {
            id: generateId(),
            workspaceId,
            action:
              dto.decision === 'CONFIRM_PUBLISHED'
                ? AuditAction.PUBLICATION_RECONCILED_PUBLISHED
                : AuditAction.PUBLICATION_RECONCILED_FAILED,
            metadata: {
              variantId,
              decision: dto.decision,
              reason: dto.reason,
              ...(dto.externalPostId && { externalPostId: dto.externalPostId }),
              ...(dto.canonicalUrl && { canonicalUrl: dto.canonicalUrl }),
            },
            actorId: authorId,
            targetType: 'PUBLICATION_TARGET',
            targetId: variantId,
            createdAt: now,
          },
        });
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      if (err?.code === 'P2002' || err?.code === 'P2034')
        throw new ConflictException('Concurrent transaction conflict');
      throw new InternalServerErrorException(
        'Failed to execute reconciliation transaction',
      );
    }

    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  // --- APPROVALS --- //

  async requestApproval(workspaceId: string, userId: string, postId: string) {
    const repo = this.getRepo(workspaceId);
    const post = (await repo.posts.findById(postId, {
      include: { variants: true },
    })) as any;
    if (!post) throw new NotFoundException('Post not found');

    if (post.approvalStatus === ApprovalStatus.PENDING) {
      throw new ConflictException('Post is already pending approval.');
    }
    if (post.approvalStatus === ApprovalStatus.APPROVED) {
      throw new ConflictException('Post is already approved.');
    }

    if (post.variants?.some((v: any) => v.status !== PostStatus.DRAFT)) {
      throw new ConflictException(
        'Only a draft post can be sent for approval.',
      );
    }

    const now = new Date();
    await repo.posts.update({
      where: { id: postId },
      data: {
        approvalStatus: ApprovalStatus.PENDING,
        approvalRequestedById: userId,
        approvalRequestedAt: now,
        approvalDecidedById: null,
        approvalDecidedAt: null,
        approvalComment: null,
      },
    });

    await this.audit.logAction({
      workspaceId,
      actorId: userId,
      action: AuditAction.POST_APPROVAL_REQUESTED,
      targetType: 'POST',
      targetId: postId,
      metadata: { postId },
    });

    // Email dispatch to approvers (fire-and-forget)
    const postWithVariants: any = await repo.posts.findById(postId, {
      include: { variants: { include: { socialAccount: true } } },
    });
    const postTargetClientIds = new Set(
      postWithVariants?.variants
        ?.map((v: any) => v.socialAccount?.clientId)
        .filter(Boolean) as string[],
    );

    const approvers = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        role: { in: ['OWNER', 'MANAGER', 'CLIENT_APPROVER'] },
        userId: { not: userId },
      },
      include: { user: true },
    });

    const contentPreview = (post.content || '').slice(0, 140);
    for (const member of approvers) {
      if (member.role === 'CLIENT_APPROVER' && member.clientId) {
        if (!postTargetClientIds.has(member.clientId)) {
          continue;
        }
      }
      if (member.user?.email) {
        this.emailDeliveryService
          .sendApprovalRequestedEmail(member.user.email, contentPreview)
          .catch((err) => {
            this.logger.warn(
              { err, toEmail: member.user.email, postId },
              'Failed to dispatch approval requested email notification',
            );
          });
      }
    }

    return repo.posts.findById(postId, {
      include: {
        media: { orderBy: { sortOrder: 'asc' }, include: { media: true } },
        variants: { include: { socialAccount: true } },
      },
    });
  }

  async approvePost(
    workspaceId: string,
    userId: string,
    postId: string,
    scopeClientId?: string,
  ) {
    const repo = this.getRepo(workspaceId);
    const post = (await repo.posts.findById(postId, {
      include: { variants: { include: { socialAccount: true } } },
    })) as any;
    if (!post) throw new NotFoundException('Post not found');

    if (
      scopeClientId &&
      !post.variants?.some(
        (v: any) => v.socialAccount?.clientId === scopeClientId,
      )
    ) {
      throw new NotFoundException('Post not found');
    }

    if (post.approvalStatus !== ApprovalStatus.PENDING) {
      throw new ConflictException('Post is not pending approval.');
    }

    const now = new Date();
    await repo.posts.update({
      where: { id: postId },
      data: {
        approvalStatus: ApprovalStatus.APPROVED,
        approvalDecidedById: userId,
        approvalDecidedAt: now,
        approvalComment: null,
      },
    });

    await this.audit.logAction({
      workspaceId,
      actorId: userId,
      action: AuditAction.POST_APPROVAL_APPROVED,
      targetType: 'POST',
      targetId: postId,
      metadata: { postId },
    });

    // Email dispatch to author if exists and not approver (fire-and-forget)
    if (post.authorId && post.authorId !== userId) {
      const author = await this.prisma.user.findUnique({
        where: { id: post.authorId },
      });
      if (author?.email) {
        const contentPreview = (post.content || '').slice(0, 140);
        this.emailDeliveryService
          .sendApprovalDecisionEmail(author.email, contentPreview, 'APPROVED')
          .catch((err) => {
            this.logger.warn(
              { err, toEmail: author.email, postId },
              'Failed to dispatch approval decision email notification',
            );
          });
      }
    }

    return repo.posts.findById(postId, {
      include: {
        media: { orderBy: { sortOrder: 'asc' }, include: { media: true } },
        variants: { include: { socialAccount: true } },
      },
    });
  }

  async requestChanges(
    workspaceId: string,
    userId: string,
    postId: string,
    comment: string,
    scopeClientId?: string,
  ) {
    const repo = this.getRepo(workspaceId);
    const post = (await repo.posts.findById(postId, {
      include: { variants: { include: { socialAccount: true } } },
    })) as any;
    if (!post) throw new NotFoundException('Post not found');

    if (
      scopeClientId &&
      !post.variants?.some(
        (v: any) => v.socialAccount?.clientId === scopeClientId,
      )
    ) {
      throw new NotFoundException('Post not found');
    }

    if (post.approvalStatus !== ApprovalStatus.PENDING) {
      throw new ConflictException('Post is not pending approval.');
    }

    const now = new Date();
    await repo.posts.update({
      where: { id: postId },
      data: {
        approvalStatus: ApprovalStatus.CHANGES_REQUESTED,
        approvalDecidedById: userId,
        approvalDecidedAt: now,
        approvalComment: comment,
      },
    });

    await this.audit.logAction({
      workspaceId,
      actorId: userId,
      action: AuditAction.POST_APPROVAL_CHANGES_REQUESTED,
      targetType: 'POST',
      targetId: postId,
      metadata: { postId, comment },
    });

    // Email dispatch to author if exists and not reviewer (fire-and-forget)
    if (post.authorId && post.authorId !== userId) {
      const author = await this.prisma.user.findUnique({
        where: { id: post.authorId },
      });
      if (author?.email) {
        const contentPreview = (post.content || '').slice(0, 140);
        this.emailDeliveryService
          .sendApprovalDecisionEmail(
            author.email,
            contentPreview,
            'CHANGES_REQUESTED',
            comment,
          )
          .catch((err) => {
            this.logger.warn(
              { err, toEmail: author.email, postId },
              'Failed to dispatch approval decision email notification',
            );
          });
      }
    }

    return repo.posts.findById(postId, {
      include: {
        media: { orderBy: { sortOrder: 'asc' }, include: { media: true } },
        variants: { include: { socialAccount: true } },
      },
    });
  }
}
