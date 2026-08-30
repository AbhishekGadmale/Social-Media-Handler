import { PrismaClient, Post, PostPlatformVariant, PublicationAttempt, PostStatus, Prisma, FailureCategory } from '@prisma/client';
import { WorkspaceScopedRepository } from './WorkspaceScopedRepository.js';
import { assertPublicationTransition } from '../publishing/state-machine.js';
import { generateId } from '../id.js';

export class PublishingRepository {
  public readonly posts: WorkspaceScopedRepository<PrismaClient['post'], Post, Prisma.PostWhereInput, Prisma.PostCreateInput, Prisma.PostUpdateInput>;
  public readonly variants: WorkspaceScopedRepository<PrismaClient['postPlatformVariant'], PostPlatformVariant, Prisma.PostPlatformVariantWhereInput, Prisma.PostPlatformVariantCreateInput, Prisma.PostPlatformVariantUpdateInput>;

  constructor(
    protected prisma: PrismaClient,
    public readonly workspaceId: string
  ) {
    this.posts = new WorkspaceScopedRepository(prisma, prisma.post, workspaceId);
    this.variants = new WorkspaceScopedRepository(prisma, prisma.postPlatformVariant, workspaceId);
  }

  /**
   * Safely create a Post and its associated Variants in a single transaction.
   */
  async createContentWithVariants(
    data: Omit<Prisma.PostUncheckedCreateWithoutVariantsInput, 'workspaceId'>,
    variantData: Omit<Prisma.PostPlatformVariantUncheckedCreateWithoutPostInput, 'workspaceId'>[]
  ): Promise<Post & { variants: PostPlatformVariant[] }> {
    return this.prisma.post.create({
      data: {
        ...data,
        workspaceId: this.workspaceId,
        variants: {
          create: variantData.map((v) => ({
            ...v,
            workspaceId: this.workspaceId,
          })),
        },
      },
      include: { variants: true },
    });
  }

  /**
   * Atomically transitions a variant's state if the current state matches the expected state.
   */
  async transitionVariantState(
    variantId: string,
    expectedCurrentState: PostStatus,
    newState: PostStatus,
    updateData: Partial<Prisma.PostPlatformVariantUpdateInput> = {}
  ): Promise<boolean> {
    assertPublicationTransition(expectedCurrentState, newState);

    const result = await this.prisma.postPlatformVariant.updateMany({
      where: {
        id: variantId,
        workspaceId: this.workspaceId,
        status: expectedCurrentState,
      },
      data: {
        ...updateData,
        status: newState,
      },
    });

    return result.count === 1;
  }

  /**
   * Append a new PublicationAttempt safely.
   */
  async appendAttempt(
    variantId: string,
    attemptNumber: number,
    status: string,
    failureCategory?: FailureCategory,
    failureCode?: string,
    providerResponse?: Prisma.InputJsonValue
  ): Promise<PublicationAttempt> {
    // We fetch variant first to ensure tenant isolation check passes
    const variant = await this.prisma.postPlatformVariant.findFirst({
      where: { id: variantId, workspaceId: this.workspaceId },
    });
    if (!variant) throw new Error('Variant not found or access denied');

    return this.prisma.publicationAttempt.create({
      data: {
        id: generateId(),
        variantId,
        attemptNumber,
        status,
        failureCategory,
        failureCode,
        providerResponse,
      },
    });
  }

  /**
   * Set terminal state for an attempt.
   */
  async completeAttempt(
    attemptId: string,
    status: string,
    failureCategory?: FailureCategory,
    failureCode?: string,
    providerResponse?: Prisma.InputJsonValue
  ): Promise<PublicationAttempt> {
    // Because publication attempts don't have workspaceId on them directly,
    // we use a nested write or ensure we only update within workspace.
    const attempt = await this.prisma.publicationAttempt.findFirst({
      where: {
        id: attemptId,
        variant: {
          workspaceId: this.workspaceId,
        },
      },
    });

    if (!attempt) throw new Error('Attempt not found or access denied');

    return this.prisma.publicationAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        failureCategory,
        failureCode,
        providerResponse,
        completedAt: new Date(),
      },
    });
  }
}
