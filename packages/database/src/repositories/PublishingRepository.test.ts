import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, PostStatus, FailureCategory } from '@prisma/client';
import { PublishingRepository } from './PublishingRepository';
import { generateId } from '../id';

const prisma = new PrismaClient();

describe('PublishingRepository', () => {
  let workspace1: string;
  let workspace2: string;
  let user: string;
  let repo1: PublishingRepository;
  let repo2: PublishingRepository;
  let account1: string;

  beforeAll(async () => {
    user = generateId();
    await prisma.user.create({
      data: {
        id: user,
        email: `pub-test-${Date.now()}@example.com`,
        hashedPassword: 'hash',
      },
    });

    const org = generateId();
    await prisma.organization.create({
      data: { id: org, name: 'Pub Org' },
    });

    workspace1 = generateId();
    await prisma.workspace.create({
      data: { id: workspace1, name: 'Workspace 1', organizationId: org },
    });

    workspace2 = generateId();
    await prisma.workspace.create({
      data: { id: workspace2, name: 'Workspace 2', organizationId: org },
    });

    account1 = generateId();
    await prisma.socialAccount.create({
      data: {
        id: account1,
        workspaceId: workspace1,
        provider: 'YOUTUBE',
        externalId: `yt-${Date.now()}`,
        status: 'ACTIVE',
      },
    });

    repo1 = new PublishingRepository(prisma, workspace1);
    repo2 = new PublishingRepository(prisma, workspace2);
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: [workspace1, workspace2] } } });
    await prisma.user.delete({ where: { id: user } });
    await prisma.$disconnect();
  });

  it('creates content and variants atomically and isolates by tenant', async () => {
    const post = await repo1.createContentWithVariants(
      {
        id: generateId(),
        content: 'Test Content',
        status: PostStatus.DRAFT,
      },
      [
        {
          id: generateId(),
          socialAccountId: account1,
          status: PostStatus.DRAFT,
        },
      ]
    );

    expect(post.workspaceId).toBe(workspace1);
    expect(post.variants).toHaveLength(1);
    expect(post.variants[0].workspaceId).toBe(workspace1);

    // Tenant isolation: repo2 should not find this post
    const foundInRepo2 = await repo2.posts.findUnique({ where: { id: post.id } });
    expect(foundInRepo2).toBeNull();
  });

  it('performs atomic conditional transition (worker claim idempotency)', async () => {
    const variantId = generateId();
    await repo1.createContentWithVariants(
      {
        id: generateId(),
        content: 'Transition Test',
        status: PostStatus.DRAFT,
      },
      [
        {
          id: variantId,
          socialAccountId: account1,
          status: PostStatus.QUEUED,
        },
      ]
    );

    // Attempt transition from QUEUED to PUBLISHING
    const success = await repo1.transitionVariantState(variantId, PostStatus.QUEUED, PostStatus.PUBLISHING, {
      publishingStartedAt: new Date(),
    });

    expect(success).toBe(true);

    const variant = await repo1.variants.findUnique({ where: { id: variantId } });
    expect(variant?.status).toBe(PostStatus.PUBLISHING);
    expect(variant?.publishingStartedAt).not.toBeNull();

    // Second attempt (e.g. concurrent worker) expects QUEUED, should fail
    const concurrentSuccess = await repo1.transitionVariantState(variantId, PostStatus.QUEUED, PostStatus.PUBLISHING);
    expect(concurrentSuccess).toBe(false);
  });

  it('guarantees API command idempotency via queueForPublishing', async () => {
    const variantId = generateId();
    await repo1.createContentWithVariants(
      {
        id: generateId(),
        content: 'Command Idempotency Test',
        status: PostStatus.DRAFT,
      },
      [
        {
          id: variantId,
          socialAccountId: account1,
          status: PostStatus.DRAFT,
        },
      ]
    );

    // First API request to publish
    const success1 = await repo1.queueForPublishing(variantId);
    expect(success1).toBe(true);

    // Concurrent duplicate API request
    const success2 = await repo1.queueForPublishing(variantId);
    expect(success2).toBe(false);
  });

  it('enforces attempt uniqueness and creates attempts', async () => {
    const variantId = generateId();
    await repo1.createContentWithVariants(
      {
        id: generateId(),
        content: 'Attempt Test',
        status: PostStatus.PUBLISHING,
      },
      [
        {
          id: variantId,
          socialAccountId: account1,
          status: PostStatus.PUBLISHING,
        },
      ]
    );

    const attempt1 = await repo1.appendAttempt(variantId, 1, 'FAILED', FailureCategory.TRANSIENT, '500');
    expect(attempt1.variantId).toBe(variantId);
    expect(attempt1.attemptNumber).toBe(1);

    // Attempting same attemptNumber should throw Prisma unique constraint violation
    await expect(repo1.appendAttempt(variantId, 1, 'FAILED')).rejects.toThrow();

    // Next attempt number is valid
    const attempt2 = await repo1.appendAttempt(variantId, 2, 'SUCCESS');
    expect(attempt2.attemptNumber).toBe(2);
  });
});
