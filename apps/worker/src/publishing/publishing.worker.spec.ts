/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient, PostStatus, generateId } from '@agency-os/database';
import { PublishingProcessor } from './publishing.processor';
import { PublishingDispatcher } from './publishing.dispatcher';
import { ExecutionValidator } from './execution.validator';
import { TokenService } from './token.service';
import {
  ProviderRegistry,
  providerRegistry,
  IPublishingProvider,
  ProviderPublishResult,
  ProviderOptionsValidationResult,
  PublishingCapabilities,
  ProviderExecutionCredentials,
  ProviderPublicationInput,
} from '@agency-os/providers';
import { Queue } from 'bullmq';
import { assertTestDatabaseUrl } from '@agency-os/database';

// --- TEST PUBLISHING PROVIDER ---
class TestPublishingProvider implements IPublishingProvider {
  getPublishingCapabilities(): PublishingCapabilities {
    return {
      contentTypes: {
        TEXT_POST: { supported: true, maxLength: 5000 },
        IMAGE_POST: { supported: true, maxCount: 1 },
        MULTI_IMAGE_POST: { supported: false },
        VIDEO_POST: { supported: true },
        LINK_POST: { supported: true },
      },
      features: [],
    };
  }
  validateProviderOptions(options: unknown): ProviderOptionsValidationResult {
    return { valid: true, issues: [] };
  }
  async publish(
    credentials: ProviderExecutionCredentials,
    input: ProviderPublicationInput,
  ): Promise<ProviderPublishResult> {
    await Promise.resolve();
    if (input.content.includes('trigger-validation-fail')) {
      return {
        success: false,
        failureCategory: 'VALIDATION',
        failureCode: 'BAD_CONTENT',
        message: 'Bad',
      };
    }
    if (input.content.includes('trigger-auth-fail')) {
      return {
        success: false,
        failureCategory: 'AUTH_REQUIRED',
        failureCode: 'TOKEN_EXPIRED',
        message: 'Expired',
      };
    }
    if (input.content.includes('trigger-unknown')) {
      return {
        success: false,
        failureCategory: 'UNKNOWN_RESULT',
        failureCode: 'TIMED_OUT',
        message: 'Timeout',
      };
    }
    if (input.content.includes('trigger-throw')) {
      throw new Error('Unhandled random explosion');
    }
    return {
      success: true,
      externalPostId: 'ext-' + input.targetId,
      publishedAt: new Date(),
    };
  }
}

// Ensure the fake provider is registered globally for tests
providerRegistry.register(
  'LINKEDIN',
  () => new TestPublishingProvider() as any,
);

describe('Publishing Worker (e2e)', () => {
  let moduleRef: TestingModule;
  let processor: PublishingProcessor;
  let dispatcher: PublishingDispatcher;
  let prisma: PrismaClient;
  let mockQueue: any;
  let tokenService: TokenService;

  beforeAll(async () => {
    const url = assertTestDatabaseUrl(
      process.env.TEST_DATABASE_URL ||
        'postgresql://postgres:password@localhost:5432/agency_os_test?schema=public',
    );

    prisma = new PrismaClient({
      datasources: {
        db: {
          url,
        },
      },
    });

    mockQueue = {
      add: jest.fn(),
    };

    tokenService = new TokenService(prisma);
    jest
      .spyOn(tokenService, 'getExecutionCredentials')
      .mockImplementation((accountId) => {
        if (accountId === 'auth-fail-acc')
          return Promise.reject(new Error('Token is expired'));
        return Promise.resolve({ accessToken: 'fake-token' });
      });

    moduleRef = await Test.createTestingModule({
      providers: [
        PublishingProcessor,
        PublishingDispatcher,
        ExecutionValidator,
        { provide: TokenService, useValue: tokenService },
        { provide: PrismaClient, useValue: prisma },
        { provide: 'BullQueue_publish', useValue: mockQueue },
        { provide: ProviderRegistry, useValue: providerRegistry },
        { provide: 'IObjectStorage', useValue: { getStream: jest.fn() } },
      ],
    })
      .overrideProvider(ProviderRegistry)
      .useValue(providerRegistry)
      .compile();

    processor = moduleRef.get(PublishingProcessor);
    dispatcher = moduleRef.get(PublishingDispatcher);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    mockQueue.add.mockClear();
    await prisma.publicationAttempt.deleteMany({});
    await prisma.postPlatformVariant.deleteMany({});
    await prisma.postMedia.deleteMany({});
    await prisma.mediaAsset.deleteMany({});
    await prisma.post.deleteMany({});
    await prisma.socialAccount.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'worker-test' } },
    });
  });

  async function createFixture(
    status: PostStatus = PostStatus.QUEUED,
    content = 'Hello',
  ) {
    const wsId = generateId();
    await prisma.workspace.create({
      data: {
        id: wsId,
        name: 'Worker Test WS',
        organization: { create: { id: generateId(), name: 'Org' } },
      },
    });

    const accountId = generateId();
    await prisma.socialAccount.create({
      data: {
        id: accountId,
        workspaceId: wsId,
        provider: 'LINKEDIN',
        name: 'Test Acc',
        status: 'ACTIVE',
        externalId: generateId(),
        connection: {
          create: {
            encryptedAccessToken: 'enc',
            accessTokenIv: 'iv',
            accessTokenAuthTag: 'tag',
            keyVersion: 1,
            id: generateId(),
          },
        },
      },
    });

    const user = await prisma.user.create({
      data: {
        id: generateId(),
        email: `worker-test-${generateId()}@test.com`,
        hashedPassword: 'hash',
      },
    });

    const postId = generateId();
    await prisma.post.create({
      data: {
        id: postId,
        workspaceId: wsId,
        authorId: user.id,
        content,
        status: PostStatus.QUEUED,
      },
    });

    const variantId = generateId();
    const variant = await prisma.postPlatformVariant.create({
      data: {
        id: variantId,
        postId,
        workspaceId: wsId,
        socialAccountId: accountId,
        status,
        dispatchVersion: 1,
        queuedAt: status === PostStatus.QUEUED ? new Date() : null,
        scheduledAt:
          status === PostStatus.SCHEDULED ? new Date(Date.now() - 1000) : null, // Past due
      },
    });

    return { wsId, accountId, postId, variantId, variant };
  }

  describe('Publishing Dispatcher', () => {
    it('promotes due SCHEDULED to QUEUED and increments dispatchVersion', async () => {
      const { variantId, variant } = await createFixture(PostStatus.SCHEDULED);

      await dispatcher['promoteScheduled']();

      const updated = await prisma.postPlatformVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      expect(updated.status).toBe(PostStatus.QUEUED);
      expect(updated.dispatchVersion).toBe(2);
      expect(updated.queuedAt).not.toBeNull();
    });

    it('enqueues QUEUED targets with deterministic jobId', async () => {
      const { variantId, wsId, variant } = await createFixture(
        PostStatus.QUEUED,
      );

      await dispatcher['dispatchQueued']();

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [name, payload, options] = mockQueue.add.mock.calls[0];
      expect(name).toBe('publish-job');
      expect(payload).toEqual({
        workspaceId: wsId,
        publicationId: variantId,
        dispatchVersion: 1,
      });
      expect(options.jobId).toBe(`publication-${variantId}-v1`);
    });

    it('recovers stale PUBLISHING to UNKNOWN (heartbeat lost)', async () => {
      const { variantId } = await createFixture(PostStatus.PUBLISHING);

      await prisma.publicationAttempt.create({
        data: {
          id: generateId(),
          variantId,
          attemptNumber: 1,
          status: 'PUBLISHING',
          startedAt: new Date(Date.now() - 40 * 60 * 1000),
          executionHeartbeatAt: new Date(Date.now() - 10 * 60 * 1000), // 10 mins ago (stale > 5 mins)
        },
      });

      await dispatcher['recoverStalePublishing']();

      const updated = await prisma.postPlatformVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      expect(updated.status).toBe(PostStatus.UNKNOWN);

      const attempt = await prisma.publicationAttempt.findFirst({
        where: { variantId },
      });
      expect(attempt?.status).toBe('FAILED');
      expect(attempt?.failureCategory).toBe('UNKNOWN_RESULT');
    });

    it('does NOT recover long-running job if heartbeat is recent', async () => {
      const { variantId } = await createFixture(PostStatus.PUBLISHING);

      await prisma.postPlatformVariant.update({
        where: { id: variantId },
        data: { publishingStartedAt: new Date(Date.now() - 40 * 60 * 1000) }, // 40 mins ago
      });

      await prisma.publicationAttempt.create({
        data: {
          id: generateId(),
          variantId,
          attemptNumber: 1,
          status: 'PUBLISHING',
          startedAt: new Date(Date.now() - 40 * 60 * 1000),
          executionHeartbeatAt: new Date(Date.now() - 1 * 60 * 1000), // 1 min ago (active < 5 mins)
        },
      });

      await dispatcher['recoverStalePublishing']();

      const updated = await prisma.postPlatformVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      expect(updated.status).toBe(PostStatus.PUBLISHING);

      const attempt = await prisma.publicationAttempt.findFirst({
        where: { variantId },
      });
      expect(attempt?.status).toBe('PUBLISHING');
    });
  });

  describe('Publishing Processor', () => {
    it('successfully processes a valid job and reaches PUBLISHED', async () => {
      const { variantId, wsId } = await createFixture(PostStatus.QUEUED);

      await processor.process({
        id: 'job-1',
        data: {
          workspaceId: wsId,
          publicationId: variantId,
          dispatchVersion: 1,
        },
      } as any);

      const updated = await prisma.postPlatformVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      expect(updated.status).toBe(PostStatus.PUBLISHED);
      expect(updated.externalPostId).toBe('ext-' + variantId);

      const attempt = await prisma.publicationAttempt.findFirst({
        where: { variantId },
      });
      expect(attempt?.status).toBe('SUCCESS');
    });

    it('no-ops if job is stale (dispatchVersion mismatch)', async () => {
      const { variantId, wsId } = await createFixture(PostStatus.QUEUED);

      await processor.process({
        id: 'job-2',
        data: {
          workspaceId: wsId,
          publicationId: variantId,
          dispatchVersion: 999,
        }, // Mismatch
      } as any);

      const updated = await prisma.postPlatformVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      expect(updated.status).toBe(PostStatus.QUEUED); // Unchanged
      const count = await prisma.publicationAttempt.count({
        where: { variantId },
      });
      expect(count).toBe(0); // No attempt created
    });

    it('transitions to FAILED on execution validation failure', async () => {
      // Content shape is unsupported if empty
      const { variantId, wsId } = await createFixture(PostStatus.QUEUED, '');
      await prisma.post.update({
        where: {
          id: (await prisma.postPlatformVariant.findUnique({
            where: { id: variantId },
          }))!.postId,
        },
        data: { content: '' },
      });

      await processor.process({
        id: 'job-3',
        data: {
          workspaceId: wsId,
          publicationId: variantId,
          dispatchVersion: 1,
        },
      } as any);

      const updated = await prisma.postPlatformVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      expect(updated.status).toBe(PostStatus.FAILED);

      const attempt = await prisma.publicationAttempt.findFirst({
        where: { variantId },
      });
      expect(attempt?.failureCategory).toBe('VALIDATION');
    });

    it('transitions to UNKNOWN on unhandled exception from provider', async () => {
      const { variantId, wsId } = await createFixture(
        PostStatus.QUEUED,
        'trigger-throw',
      );

      await processor.process({
        id: 'job-4',
        data: {
          workspaceId: wsId,
          publicationId: variantId,
          dispatchVersion: 1,
        },
      } as any);

      const updated = await prisma.postPlatformVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      expect(updated.status).toBe(PostStatus.UNKNOWN);

      const attempt = await prisma.publicationAttempt.findFirst({
        where: { variantId },
      });
      expect(attempt?.failureCategory).toBe('UNKNOWN_RESULT');
    });

    it('handles atomic claim correctly (two workers race)', async () => {
      const { variantId, wsId } = await createFixture(PostStatus.QUEUED);

      // Simulate first worker winning
      await prisma.postPlatformVariant.update({
        where: { id: variantId },
        data: { status: PostStatus.PUBLISHING },
      });

      // Second worker tries to process the SAME QUEUED job
      await processor.process({
        id: 'job-5',
        data: {
          workspaceId: wsId,
          publicationId: variantId,
          dispatchVersion: 1,
        },
      } as any);

      // Should NO-OP because status is no longer QUEUED
      const count = await prisma.publicationAttempt.count({
        where: { variantId },
      });
      expect(count).toBe(0);
    });

    it('sanitizes providerResponse and prevents leakage of arbitrary data', async () => {
      const { variantId, wsId } = await createFixture(
        PostStatus.QUEUED,
        'trigger-leak',
      );

      // Intercept provider publish to return a leaky response
      const adapter = moduleRef
        .get(ProviderRegistry)
        .getPublishingAdapter('LINKEDIN');
      jest.spyOn(adapter, 'publish').mockImplementationOnce(async () => {
        await Promise.resolve();
        await Promise.resolve();
        return {
          success: false,
          failureCategory: 'AUTH_REQUIRED',
          failureCode: 'TEST_LEAK',
          message: 'message containing SECRET_TEST_VALUE',
          // The leaky fields
          accessToken: 'SECRET_TEST_VALUE_TOKEN',
          refreshToken: 'SECRET_TEST_VALUE_REFRESH',
          authorization: 'Bearer SECRET_TEST_VALUE',
          cookie: 'session=SECRET_TEST_VALUE',
          oauthCode: 'SECRET_TEST_VALUE_CODE',
          oauthState: 'SECRET_TEST_VALUE_STATE',
          clientSecret: 'SECRET_TEST_VALUE_SECRET',
          nested: {
            arbitrary: 'SECRET_TEST_VALUE_ARBITRARY',
          },
        } as any;
      });

      await processor.process({
        id: 'job-leak',
        data: {
          workspaceId: wsId,
          publicationId: variantId,
          dispatchVersion: 1,
        },
      } as any);

      const attempt = await prisma.publicationAttempt.findFirstOrThrow({
        where: { variantId },
      });

      const serialized = JSON.stringify(attempt.providerResponse);
      expect(serialized).not.toContain('SECRET_TEST_VALUE');
    });
  });
});
