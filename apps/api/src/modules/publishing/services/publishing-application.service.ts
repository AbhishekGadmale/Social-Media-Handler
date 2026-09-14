/* eslint-disable */
import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaClient } from '@agency-os/database';
import { AuditService } from '../../core/audit.service';
import { PublishabilityValidator } from '../domain/PublishabilityValidator';
import { PublishingRepository, AuditAction } from '@agency-os/database';
import { generateId } from '@agency-os/database';
import { PostStatus, Prisma } from '@agency-os/database';
import { CreatePostDto, UpdatePostDto } from '../dto/post.dto';
import {
  AddPublicationTargetDto,
  UpdatePublicationTargetDto,
  SchedulePublicationDto,
} from '../dto/publication.dto';

@Injectable()
export class PublishingApplicationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly validator: PublishabilityValidator,
  ) {}

  private getRepo(workspaceId: string) {
    return new PublishingRepository(this.prisma, workspaceId);
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

    const post = await this.prisma.post.create({
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

    // await this.audit.log(workspaceId, 'POST_CREATED', { postId: post.id }, authorId);
    return post;
  }

  async getPosts(workspaceId: string, take = 50, skip = 0) {
    const repo = this.getRepo(workspaceId);
    return repo.posts.findMany({
      take,
      skip,
      orderBy: { createdAt: 'desc' },
      include: {
        media: { orderBy: { sortOrder: 'asc' }, include: { media: true } },
        variants: { include: { socialAccount: true } },
      },
    });
  }

  async getPostById(workspaceId: string, postId: string) {
    const repo = this.getRepo(workspaceId);
    const post: any = await repo.posts.findById(postId, {
      include: {
        media: { orderBy: { sortOrder: 'asc' }, include: { media: true } },
        variants: { include: { socialAccount: true } },
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async updateDraft(
    workspaceId: string,
    authorId: string,
    postId: string,
    dto: UpdatePostDto,
  ) {
    const repo = this.getRepo(workspaceId);
    const post: any = (await repo.posts.findById(postId, {
      include: { variants: true },
    })) as any;

    if (!post) throw new NotFoundException('Post not found');

    const lockedVariant = post.variants.find((v: any) =>
      [
        PostStatus.QUEUED,
        PostStatus.PUBLISHING,
        PostStatus.PUBLISHED,
        PostStatus.UNKNOWN,
        PostStatus.SCHEDULED,
      ].includes(v.status),
    );
    console.log(
      'Post:',
      post.id,
      'Variants:',
      post.variants.map((v: any) => v.status),
    );
    if (lockedVariant) {
      throw new ForbiddenException(
        `Cannot edit post while a publication is in ${lockedVariant.status} state`,
      );
    }

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

    const updated = await this.prisma.$transaction(async (tx) => {
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

      return tx.post.update({
        where: { id: postId, workspaceId },
        data,
        include: {
          media: { orderBy: { sortOrder: 'asc' }, include: { media: true } },
          variants: { include: { socialAccount: true } },
        },
      });
    });

    // await this.audit.log(workspaceId, 'POST_UPDATED', { postId }, authorId);
    return updated;
  }

  async deletePost(workspaceId: string, authorId: string, postId: string) {
    const repo = this.getRepo(workspaceId);
    const post: any = (await repo.posts.findById(postId, {
      include: { variants: true },
    })) as any;
    if (!post) throw new NotFoundException('Post not found');

    const unsafeVariant = post.variants.find((v: any) =>
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

    await repo.posts.delete({ where: { id: postId } });
    // await this.audit.log(workspaceId, 'POST_DELETED', { postId }, authorId);
    return true;
  }

  // --- PUBLICATIONS (TARGETS) --- //

  async addTarget(
    workspaceId: string,
    authorId: string,
    postId: string,
    dto: AddPublicationTargetDto,
  ) {
    console.error('SERVICE ADD TARGET:', { workspaceId, postId, dto });
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

    // await this.audit.log(workspaceId, 'PUBLICATION_TARGET_ADDED', { postId, variantId: variant.id }, authorId);
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

    // await this.audit.log(workspaceId, 'PUBLICATION_TARGET_UPDATED', { postId: variant.postId, variantId }, authorId);
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

    await repo.variants.delete({ where: { id: variantId } });
    // await this.audit.log(workspaceId, 'PUBLICATION_TARGET_REMOVED', { postId: variant.postId, variantId }, authorId);
    return true;
  }

  // --- LIFECYCLE COMMANDS --- //

  async validateTarget(
    workspaceId: string,
    variantId: string,
    isRetry = false,
  ) {
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

    const validation = await this.validateTarget(workspaceId, variantId);
    if (!validation.valid) {
      console.error('Validation failed:', JSON.stringify(validation.issues, null, 2));
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

    // await this.audit.log(workspaceId, 'PUBLICATION_REQUESTED', { variantId }, authorId);
    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  async requestRemoteDelete(workspaceId: string, authorId: string, variantId: string) {
    const repo = this.getRepo(workspaceId);
    const variant = (await repo.variants.findById(variantId)) as any;
    if (!variant) throw new NotFoundException('Publication not found');
    if (variant.status === 'DELETED') return variant;
    if (!variant.externalPostId) throw new UnprocessableEntityException('Cannot delete publication without an external ID');
    const success = await repo.queueForDeletion(variantId);
    if (!success) throw new ConflictException('Cannot delete variant in this state');
    return repo.variants.findById(variantId, { include: { socialAccount: true } });
  }

  async requestRetry(workspaceId: string, authorId: string, variantId: string) {
    const repo = this.getRepo(workspaceId);

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

    // await this.audit.log(workspaceId, 'PUBLICATION_RETRY_REQUESTED', { variantId }, authorId);
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

    // await this.audit.log(workspaceId, 'PUBLICATION_SCHEDULED', { variantId, scheduledAt }, authorId);
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

    const success = await repo.transitionVariantState(
      variantId,
      PostStatus.SCHEDULED,
      PostStatus.SCHEDULED,
      { scheduledAt },
    );
    if (!success) throw new ConflictException('Reschedule failed');

    // await this.audit.log(workspaceId, 'PUBLICATION_RESCHEDULED', { variantId, scheduledAt }, authorId);
    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  async unschedule(workspaceId: string, authorId: string, variantId: string) {
    const repo = this.getRepo(workspaceId);
    const success = await repo.unschedule(variantId);
    if (!success) throw new ConflictException('Target is not SCHEDULED');

    // await this.audit.log(workspaceId, 'PUBLICATION_UNSCHEDULED', { variantId }, authorId);
    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }

  async cancelQueued(workspaceId: string, authorId: string, variantId: string) {
    const repo = this.getRepo(workspaceId);
    const success = await repo.cancelQueued(variantId);
    if (!success) throw new ConflictException('Target is not QUEUED');

    // await this.audit.log(workspaceId, 'PUBLICATION_CANCELLED', { variantId }, authorId);
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
    const variant = (await repo.variants.findById(variantId)) as any;
    if (!variant) throw new NotFoundException('Publication not found');

    if (variant.status !== PostStatus.UNKNOWN) {
      if (
        variant.status === PostStatus.PUBLISHED &&
        dto.decision === 'CONFIRM_PUBLISHED'
      ) {
        return variant; // Idempotent
      }
      if (
        variant.status === PostStatus.FAILED &&
        dto.decision === 'CONFIRM_FAILED'
      ) {
        return variant; // Idempotent
      }
      throw new ConflictException(
        `Cannot reconcile target in ${variant.status} state`,
      );
    }

    const now = new Date();
    const updateData: any = {
      reconciledAt: now,
      reconciledBy: authorId,
      reconciliationReason: dto.reason,
    };

    let targetStatus: PostStatus;
    if (dto.decision === 'CONFIRM_PUBLISHED') {
      targetStatus = PostStatus.PUBLISHED;
      updateData.publishedAt = now;
      if (dto.externalPostId) updateData.externalPostId = dto.externalPostId;
      if (dto.canonicalUrl) updateData.canonicalUrl = dto.canonicalUrl;
    } else {
      targetStatus = PostStatus.FAILED;
    }

    const success = await repo.transitionVariantState(
      variantId,
      PostStatus.UNKNOWN,
      targetStatus,
      updateData,
    );

    if (!success) {
      throw new ConflictException(
        'Reconciliation failed due to concurrent modification',
      );
    }

    await this.audit.logAction({
      workspaceId,
      action:
        dto.decision === 'CONFIRM_PUBLISHED'
          ? AuditAction.PUBLICATION_RECONCILED_PUBLISHED
          : AuditAction.PUBLICATION_RECONCILED_FAILED,
      metadata: { variantId, decision: dto.decision, reason: dto.reason },
      actorId: authorId,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
    });

    return repo.variants.findById(variantId, {
      include: { socialAccount: true },
    });
  }
}
