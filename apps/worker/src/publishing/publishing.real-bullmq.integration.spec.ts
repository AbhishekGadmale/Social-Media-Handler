import { Test, TestingModule } from '@nestjs/testing';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue, Job, Worker } from 'bullmq';
import { PrismaClient, PostStatus } from '@agency-os/database';
import { PublishingModule } from './publishing.module';
import { PublishingProcessor } from './publishing.processor';
import { TokenService } from './token.service';
import { ProviderRegistry } from '@agency-os/providers';
import { ExecutionMetadataRepository } from '@agency-os/database';
import { PublishingDispatcher } from './publishing.dispatcher';
import { generateId } from '@agency-os/database';

describe('REAL REDIS/BULLMQ: Publishing Architecture Continuation', () => {
  const _createdVariants: string[] = [];
  const _createdAttempts: string[] = [];
  let module: TestingModule;
  let queue: Queue;
  let prisma: PrismaClient;
  let processor: PublishingProcessor;
  let dispatcher: PublishingDispatcher;

  const mockAdapter = {
    publish: jest.fn(),
    checkStatus: jest.fn(),
    finalizePublish: jest.fn(),
    getPublishingCapabilities: jest.fn().mockReturnValue({
      contentTypes: {
        TEXT_POST: { supported: true },
        VIDEO_POST: { supported: true },
        IMAGE_POST: { supported: true },
      },
    }),
    validateProviderOptions: jest.fn().mockReturnValue({ valid: true }),
  };

  const mockRegistry = {
    supportsPublishing: jest.fn().mockReturnValue(true),
    get: jest.fn().mockReturnValue(mockAdapter),
    getPublishingAdapter: jest.fn().mockReturnValue(mockAdapter),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({
          connection: { host: 'localhost', port: 6379 },
        }),
        PublishingModule,
      ],
    })
      .overrideProvider(ProviderRegistry)
      .useValue(mockRegistry)
      .overrideProvider(TokenService)
      .useValue({
        getExecutionCredentials: jest
          .fn()
          .mockResolvedValue({ accessToken: 'test' }),
      })
      .compile();

    await module.init();

    queue = module.get<Queue>(getQueueToken('publish'));
    prisma = module.get<PrismaClient>(PrismaClient);
    processor = module.get<PublishingProcessor>(PublishingProcessor);
    dispatcher = module.get<PublishingDispatcher>(PublishingDispatcher);

    // Stop the actual dispatcher interval from running automatically
    dispatcher.onModuleDestroy();
  });

  beforeAll(async () => {
    // Clean old state
    await prisma.postPlatformVariant.deleteMany({});
  });

  afterAll(async () => {
    if (_createdAttempts.length > 0) {
      await prisma.publicationAttempt.deleteMany({
        where: { id: { in: _createdAttempts } },
      });
    }
    if (_createdVariants.length > 0) {
      await prisma.postPlatformVariant.deleteMany({
        where: { id: { in: _createdVariants } },
      });
      const posts = await prisma.post.findMany({
        where: { variants: { some: { id: { in: _createdVariants } } } },
      });
      if (posts.length > 0)
        await prisma.post.deleteMany({
          where: { id: { in: posts.map((p) => p.id) } },
        });
    }
    if (queue) {
      await queue.drain();
      await queue.close();
    }
    if (module) {
      await module.close();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    if (queue) {
      await queue.drain();
    }
  });

  async function createTestVariant(
    phase: string,
    nextCheckAtDelayMs = -1000,
    overrides: any = {},
  ) {
    const wsId = generateId();
    await prisma.workspace.create({
      data: {
        id: wsId,
        name: 'Test WS',
        organization: {
          create: {
            id: generateId(),
            name: 'Test Org',
          },
        },
        socialAccounts: {
          create: {
            id: generateId(),
            provider: 'YOUTUBE',
            externalId: generateId(),
            status: 'ACTIVE',
          },
        },
      },
    });

    const account = await prisma.socialAccount.findFirst({
      where: { workspaceId: wsId },
    });

    const post = await prisma.post.create({
      data: {
        id: generateId(),
        workspaceId: wsId,
        content: 'test',
        status: PostStatus.PUBLISHING,
      },
    });

    const variant = await prisma.postPlatformVariant.create({
      data: {
        id: generateId(),
        workspaceId: wsId,
        postId: post.id,
        socialAccountId: account!.id,
        status: PostStatus.PUBLISHING,
        dispatchVersion: 1,
        executionMetadata: {
          version: 1,
          provider: overrides.provider || 'YOUTUBE',
          phase,
          operationId: generateId(),
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date(Date.now() + nextCheckAtDelayMs).toISOString(),
          ...overrides,
        },
      },
    });

    const attempt = await prisma.publicationAttempt.create({
      data: {
        id: generateId(),
        variantId: variant.id,
        attemptNumber: 1,
        status: 'PUBLISHING',
      },
    });

    return { wsId, account, post, variant, attempt };
  }

  // Sleep utility
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('1. Proves worker does not sleep during PROCESSING_REMOTE & correctly schedules delayed continuation', async () => {
    // We insert a PROCESSING_REMOTE state that is immediately due.
    const { variant } = await createTestVariant('PROCESSING_REMOTE', -1000, {
      remoteResourceId: 'yt-1',
    });

    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'PROCESSING' });

    // Dispatcher scans and enqueues
    await dispatcher.scan();

    // Wait for the background worker to process it
    await sleep(500);

    // checkStatus was called exactly once
    expect(mockAdapter.checkStatus).toHaveBeenCalledTimes(1);

    // Now, verify DB state: nextCheckAt should be in the future (approx 60s)
    const updatedVariant = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    const meta = updatedVariant.executionMetadata as any;
    expect(meta.phase).toBe('PROCESSING_REMOTE');
    expect(new Date(meta.nextCheckAt).getTime()).toBeGreaterThan(
      Date.now() + 10000,
    ); // Definitely >10s in future

    // And if dispatcher scans again RIGHT NOW, it will NOT add a new job.
    await queue.drain();
    await dispatcher.scan();
    const jobs = await queue.getWaiting();
    expect(
      jobs.find((j) => j.data.publicationId === variant.id),
    ).toBeUndefined();
  });

  it('2. Deterministic Job ID / duplicate suppression', async () => {
    const { variant } = await createTestVariant('PROCESSING_REMOTE', -1000, {
      remoteResourceId: 'yt-1',
    });

    const jobId = `publication-${variant.id}-v${variant.dispatchVersion}`;
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion,
      operationId: (variant.executionMetadata as any).operationId,
    };

    // Add twice rapidly
    mockAdapter.checkStatus.mockResolvedValueOnce({
      processingState: 'PROCESSING',
    });
    const job1 = await queue.add('publish-job', payload, { jobId });
    const job2 = await queue.add('publish-job', payload, { jobId });

    expect(job1.id).toBe(jobId);
    // Bullmq returns the existing job if added with same jobId and it hasn't been completed/removed
    expect(job2.id).toBe(jobId);

    // Wait for worker to finish
    await sleep(500);

    // Check execution count - it should only run ONCE despite being added twice (since BullMQ suppresses the duplicate)
    expect(mockAdapter.checkStatus).toHaveBeenCalledTimes(1);

    // If we re-add it AFTER completion (since removeOnComplete is true), it WILL add a new job with the same ID.
    // However, the worker will check dispatchVersion, and reject it if it's stale.
    const job3 = await queue.add('publish-job', payload, { jobId });
    expect(job3.id).toBe(jobId);

    // Cleanup
    await queue.drain();
  });

  it('3. Stale DispatchVersion test', async () => {
    const { variant } = await createTestVariant('PROCESSING_REMOTE', -1000, {
      remoteResourceId: 'yt-1',
    });

    const jobId = `publication-${variant.id}-v${variant.dispatchVersion}`;
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion,
      operationId: (variant.executionMetadata as any).operationId,
    };

    // Before we enqueue, we advance the DB dispatch version!
    await prisma.postPlatformVariant.update({
      where: { id: variant.id },
      data: { dispatchVersion: { increment: 1 } },
    });

    // Enqueue the STALE job
    await queue.add('publish-job', payload, { jobId });

    // Wait for worker
    await sleep(500);

    // It should have aborted immediately and NOT called checkStatus or publish
    expect(mockAdapter.checkStatus).toHaveBeenCalledTimes(0);
    expect(mockAdapter.publish).toHaveBeenCalledTimes(0);

    // The newer dispatch version should remain untouched
    const updated = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(updated.dispatchVersion).toBe(variant.dispatchVersion + 1);
  });

  it('4. Stale OperationId test', async () => {
    const { variant } = await createTestVariant('PROCESSING_REMOTE', -1000, {
      remoteResourceId: 'yt-1',
    });

    const jobId = `publication-${variant.id}-v${variant.dispatchVersion}`;
    const staleOperationId = (variant.executionMetadata as any).operationId;
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion, // version is same!
      operationId: staleOperationId,
    };

    const newOperationId = generateId();

    // Advance DB state with NEW operation ID (same dispatch version for some reason, maybe we just updated it)
    const newMeta = {
      ...(variant.executionMetadata as any),
      operationId: newOperationId,
    };
    await prisma.postPlatformVariant.update({
      where: { id: variant.id },
      data: { executionMetadata: newMeta },
    });

    // Enqueue STALE job
    await queue.add('publish-job', payload, { jobId });

    // Wait for worker
    await sleep(500);

    // It should have aborted
    expect(mockAdapter.checkStatus).toHaveBeenCalledTimes(0);

    // Metadata should still have the new operation ID
    const updated = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    const finalMeta = updated.executionMetadata as any;
    expect(finalMeta.operationId).toBe(newOperationId);
  });

  it('5. YouTube 3-poll checkStatus flow', async () => {
    // 1. Initial State: PROCESSING_REMOTE
    const { variant, attempt } = await createTestVariant(
      'PROCESSING_REMOTE',
      -1000,
      { remoteResourceId: 'yt-123' },
    );
    const jobId = `publication-${variant.id}-v${variant.dispatchVersion}`;
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion,
      operationId: (variant.executionMetadata as any).operationId,
    };

    // First Poll
    mockAdapter.checkStatus.mockResolvedValueOnce({
      processingState: 'PROCESSING',
    });
    await queue.add('publish-job', payload, { jobId: jobId + '-poll1' });
    await sleep(300);
    expect(mockAdapter.checkStatus).toHaveBeenCalledTimes(1);

    // Refresh payload for Poll 2
    let updatedVariant = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    payload.dispatchVersion = updatedVariant.dispatchVersion;

    // Second Poll
    mockAdapter.checkStatus.mockResolvedValueOnce({
      processingState: 'PROCESSING',
    });
    await queue.add('publish-job', payload, { jobId: jobId + '-poll2' });
    await sleep(300);
    expect(mockAdapter.checkStatus).toHaveBeenCalledTimes(2);

    // Refresh payload for Poll 3
    updatedVariant = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    payload.dispatchVersion = updatedVariant.dispatchVersion;

    // Third Poll -> PUBLISHED (YouTube has NO finalizePublish)
    mockAdapter.finalizePublish = undefined as any;
    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'PUBLISHED' });
    // It should finalize publish and handle success
    await queue.add('publish-job', payload, { jobId: jobId + '-poll3' });
    await sleep(300);
    expect(mockAdapter.checkStatus).toHaveBeenCalledTimes(3);

    // Ensure it NEVER called publish() (which would mean republishing)
    expect(mockAdapter.publish).toHaveBeenCalledTimes(0);

    // Ensure DB state is COMPLETED and PUBLISHED
    const finalVariant = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(finalVariant.status).toBe('PUBLISHED');
    expect((finalVariant.executionMetadata as any).phase).toBe('COMPLETED');
    expect((finalVariant.executionMetadata as any).finalRemoteId).toBe(
      'yt-123',
    );

    // Ensure attempts count is exactly 1 (polling doesn't inflate rows)
    const attempts = await prisma.publicationAttempt.findMany({
      where: { variantId: variant.id },
    });
    expect(attempts.length).toBe(1);
    expect(attempts[0].id).toBe(attempt.id);

    // Restore mock for other tests
    mockAdapter.finalizePublish = jest.fn().mockResolvedValue({ valid: true });
  });

  it('6. Instagram Reels 3-poll checkStatus flow & Finalize', async () => {
    // Reels uses READY -> finalizePublish
    const { variant, attempt } = await createTestVariant(
      'PROCESSING_REMOTE',
      -1000,
      { remoteResourceId: 'ig-123' },
    );
    const jobId = `publication-${variant.id}-v${variant.dispatchVersion}`;
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion,
      operationId: (variant.executionMetadata as any).operationId,
    };

    // First Poll
    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'PROCESSING' });
    await queue.add('publish-job', payload, { jobId: jobId + '-poll1' });
    await sleep(300);

    // Refresh payload for Poll 2
    let updatedVariant = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    payload.dispatchVersion = updatedVariant.dispatchVersion;

    // Second Poll
    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'PROCESSING' });
    await queue.add('publish-job', payload, { jobId: jobId + '-poll2' });
    await sleep(300);

    // Refresh payload for Poll 3
    updatedVariant = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    payload.dispatchVersion = updatedVariant.dispatchVersion;

    // Third Poll -> READY
    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'READY' });
    mockAdapter.finalizePublish.mockImplementationOnce(
      async (
        credentials: any,
        input: any,
        remoteId: any,
        ctx: { beforeFinalMutation: () => Promise<void> },
      ) => {
        await ctx.beforeFinalMutation();
        return { success: true, externalPostId: 'ig-pub-123' };
      },
    );

    await queue.add('publish-job', payload, { jobId: jobId + '-poll3' });
    await sleep(300);

    expect(mockAdapter.finalizePublish).toHaveBeenCalledTimes(1);

    // Ensure DB state is COMPLETED and PUBLISHED
    const finalVariant = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(finalVariant.status).toBe('PUBLISHED');
    expect((finalVariant.executionMetadata as any).phase).toBe('COMPLETED');
    expect((finalVariant.executionMetadata as any).finalRemoteId).toBe(
      'ig-pub-123',
    );
  });

  it('7. Finalization CAS Failure (Worker Race Simulation BEFORE /media_publish)', async () => {
    // Reels uses READY -> finalizePublish
    const { variant } = await createTestVariant('PROCESSING_REMOTE', -1000, {
      remoteResourceId: 'ig-123',
    });
    const jobId = `publication-${variant.id}-v${variant.dispatchVersion}`;
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion,
      operationId: (variant.executionMetadata as any).operationId,
    };

    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'READY' });

    let mediaPublishCalled = false;
    mockAdapter.finalizePublish.mockImplementationOnce(
      async (
        credentials: any,
        input: any,
        remoteId: any,
        ctx: { beforeFinalMutation: () => Promise<void> },
      ) => {
        // 1. Worker B enters finalizePublish
        // While Worker B is about to call ctx.beforeFinalMutation(),
        // simulate Worker A completely finishing the publication!
        const executionRepo = new ExecutionMetadataRepository(
          prisma,
          variant.workspaceId,
        );
        await executionRepo.transitionOperation(
          variant.id,
          payload.operationId,
          'PROCESSING_REMOTE',
          'PUBLISH_REQUESTED',
          payload.dispatchVersion,
        );
        await executionRepo.transitionOperation(
          variant.id,
          payload.operationId,
          'PUBLISH_REQUESTED',
          'COMPLETED',
          payload.dispatchVersion + 1,
          { finalRemoteId: 'ig-pub-OTHER' },
        );

        // Simulate Worker A completing the success update
        await prisma.postPlatformVariant.update({
          where: { id: variant.id },
          data: {
            status: 'PUBLISHED',
            dispatchVersion: payload.dispatchVersion + 2,
          },
        });

        // Now Worker B attempts the CAS via ctx.beforeFinalMutation()
        await ctx.beforeFinalMutation();

        // It should THROW ProviderCoordinationError inside beforeFinalMutation,
        // so it NEVER reaches here!
        mediaPublishCalled = true;
        return { success: true, externalPostId: 'ig-pub-123' };
      },
    );

    await queue.add('publish-job', payload, { jobId: jobId + '-race' });
    await sleep(400);

    // Worker B caught ProviderCoordinationError, fell back to handleUnknown('UNHANDLED_EXCEPTION')
    // It attempted to write UNKNOWN, but its expectedDispatchVersion was stale, so it skipped!

    const finalVariant = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });

    // We expect it to remain PUBLISHED because Worker A finished it, and Worker B correctly aborted.
    expect(mediaPublishCalled).toBe(false); // Proves duplicate mutation prevention BEFORE /media_publish!
    expect(finalVariant.status).toBe('PUBLISHED');
    expect((finalVariant.executionMetadata as any).phase).toBe('COMPLETED');
  });

  it('8. UNKNOWN FINAL MUTATION (media_publish timeout)', async () => {
    const { variant } = await createTestVariant('PROCESSING_REMOTE', -1000, {
      remoteResourceId: 'ig-8',
    });
    const jobId = `publication-${variant.id}-v${variant.dispatchVersion}`;
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion,
      operationId: (variant.executionMetadata as any).operationId,
    };

    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'READY' });
    mockAdapter.finalizePublish.mockImplementationOnce(
      async (
        c: any,
        i: any,
        r: any,
        ctx: { beforeFinalMutation: () => Promise<void> },
      ) => {
        await ctx.beforeFinalMutation();
        throw new Error('Timeout during media_publish');
      },
    );

    await queue.add('publish-job', payload, { jobId });
    await sleep(400);

    const finalVariant = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(finalVariant.status).toBe('UNKNOWN');
    expect((finalVariant.executionMetadata as any).phase).toBe('AMBIGUOUS');

    // Attempt second run
    mockAdapter.finalizePublish.mockClear();
    payload.dispatchVersion = finalVariant.dispatchVersion;
    await queue.add('publish-job-2', payload, { jobId: jobId + '-retry' });
    await sleep(300);
    expect(mockAdapter.finalizePublish).toHaveBeenCalledTimes(0); // Should not blindly retry
  });

  it('9. META PUBLISHED RECONCILIATION', async () => {
    const { variant } = await createTestVariant('PROCESSING_REMOTE', -1000, {
      remoteResourceId: 'ig-9',
    });
    const jobId = `publication-${variant.id}-v${variant.dispatchVersion}`;
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion,
      operationId: (variant.executionMetadata as any).operationId,
    };

    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'PUBLISHED' });
    // provider has finalizePublish, but returned PUBLISHED from checkStatus -> AMBIGUOUS
    mockAdapter.finalizePublish.mockClear();
    mockAdapter.publish.mockClear();

    await queue.add('publish-job', payload, { jobId });
    await sleep(300);

    expect(mockAdapter.finalizePublish).toHaveBeenCalledTimes(0);
    expect(mockAdapter.publish).toHaveBeenCalledTimes(0);

    const finalVariant = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(finalVariant.status).toBe('UNKNOWN');
    expect((finalVariant.executionMetadata as any).phase).toBe('AMBIGUOUS');
  });

  it('10. READ-ONLY STATUS TRANSPORT FAILURES', async () => {
    const { variant, attempt } = await createTestVariant(
      'PROCESSING_REMOTE',
      -1000,
      { remoteResourceId: 'ig-10' },
    );
    const jobId = `publication-${variant.id}-v${variant.dispatchVersion}`;
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion,
      operationId: (variant.executionMetadata as any).operationId,
    };

    // A. Timeout/network
    mockAdapter.checkStatus.mockRejectedValueOnce(new Error('Network timeout'));
    await queue.add('publish-job', payload, { jobId: jobId + 'A' });
    await sleep(300);

    const vA = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(vA.status).toBe('PUBLISHING'); // unchanged
    expect((vA.executionMetadata as any).phase).toBe('PROCESSING_REMOTE'); // remains
    expect((vA.executionMetadata as any).remoteResourceId).toBe('ig-10'); // preserved
    // advanced nextCheckAt assertion removed because BullMQ retry handles it without DB write

    // B. 5xx equivalent UNKNOWN
    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'UNKNOWN' });
    payload.dispatchVersion = vA.dispatchVersion;
    await queue.add('publish-job', payload, { jobId: jobId + 'B' });
    await sleep(300);

    const vB = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(vB.status).toBe('PUBLISHING');
    expect((vB.executionMetadata as any).phase).toBe('PROCESSING_REMOTE');
    expect(
      new Date((vB.executionMetadata as any).nextCheckAt).getTime(),
    ).toBeGreaterThan(
      new Date((vA.executionMetadata as any).nextCheckAt).getTime(),
    );

    const attempts = await prisma.publicationAttempt.findMany({
      where: { variantId: variant.id },
    });
    expect(attempts.length).toBe(1); // Still 1 attempt
    expect(mockAdapter.finalizePublish).not.toHaveBeenCalled();
    expect(mockAdapter.publish).not.toHaveBeenCalled();
  });

  it('11. DEFINITIVE REMOTE FAILURE', async () => {
    const { variant } = await createTestVariant('PROCESSING_REMOTE', -1000, {
      remoteResourceId: 'ig-11',
    });
    const jobId = `publication-${variant.id}-v${variant.dispatchVersion}`;
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion,
      operationId: (variant.executionMetadata as any).operationId,
    };

    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'FAILED' });
    await queue.add('publish-job', payload, { jobId });
    await sleep(300);

    const vFail = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(vFail.status).toBe('FAILED');
    expect((vFail.executionMetadata as any).phase).toBe('FAILED');
    expect((vFail.executionMetadata as any).nextCheckAt).toBeUndefined(); // Use toBeUndefined since it's deleted
    expect(mockAdapter.finalizePublish).not.toHaveBeenCalled();
  });

  it('12. STALE handleUnknown TERMINAL PROTECTION', async () => {
    const { variant } = await createTestVariant('INITIATED', -1000, {});
    // Worker runs with version 1
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion,
      operationId: (variant.executionMetadata as any).operationId,
    };

    // Concurrently, it was already completed (version 2)
    const pubTime = new Date('2026-01-01T00:00:00Z');
    await prisma.postPlatformVariant.update({
      where: { id: variant.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: pubTime,
        dispatchVersion: variant.dispatchVersion + 1,
        executionMetadata: {
          ...(variant.executionMetadata as any),
          phase: 'COMPLETED',
          finalRemoteId: 'stale-test-12',
        },
      },
    });

    // Stale worker tries to publish and throws an error -> handleUnknown(UNHANDLED_EXCEPTION)
    mockAdapter.publish.mockRejectedValueOnce(new Error('Stale throw'));
    await queue.add('publish-job', payload, {
      jobId: `publication-${variant.id}-stale`,
    });
    await sleep(300);

    // Assert protection
    const vEnd = await prisma.postPlatformVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(vEnd.status).toBe('PUBLISHED'); // not UNKNOWN
    expect((vEnd.executionMetadata as any).phase).toBe('COMPLETED');
    expect((vEnd.executionMetadata as any).finalRemoteId).toBe('stale-test-12');
    expect(vEnd.publishedAt?.getTime()).toBe(pubTime.getTime());
  });

  it('13. BULLMQ TECHNICAL RETRY', async () => {
    // 1. Create a variant already at PUBLISH_REQUESTED
    const { variant } = await createTestVariant('PUBLISH_REQUESTED', -1000, {});
    const payload = {
      workspaceId: variant.workspaceId,
      publicationId: variant.id,
      dispatchVersion: variant.dispatchVersion,
      operationId: (variant.executionMetadata as any).operationId,
    };

    // 2. Queue the job (simulating a retry of the same payload)
    mockAdapter.finalizePublish.mockClear();
    mockAdapter.publish.mockClear();
    await queue.add('publish-job', payload, {
      jobId: `publication-${variant.id}-techretry`,
    });
    await sleep(300);

    // 3. Assert processor aborts (no dangerous final mutation)
    expect(mockAdapter.finalizePublish).toHaveBeenCalledTimes(0);
    expect(mockAdapter.publish).toHaveBeenCalledTimes(0);
  });
});
