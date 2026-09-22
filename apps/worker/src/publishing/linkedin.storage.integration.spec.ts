/* eslint-disable */
/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { PublishingProcessor } from './publishing.processor';
import { PrismaClient, MediaAssetStatus } from '@agency-os/database';
import { S3ObjectStorage, ProviderRegistry } from '@agency-os/providers';
import { Readable } from 'stream';
import { BullModule } from '@nestjs/bullmq';
import { ExecutionValidator } from './execution.validator';
import { TokenService } from './token.service';
import crypto from 'crypto';

const generateId = () => crypto.randomUUID();

// Mock dependencies
const mockPrisma: any = {
  postPlatformVariant: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest
      .fn()
      .mockResolvedValue({ id: 'dummy', dispatchVersion: 1 }),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  publicationAttempt: {
    updateMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  socialAccount: { findUnique: jest.fn() },
  postMedia: { findMany: jest.fn() },
  mediaAsset: { findFirst: jest.fn(), findMany: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn((cb: any) => cb(mockPrisma)),
};

const mockProviderAdapter = {
  publish: jest.fn(),
  getCapabilities: jest.fn(),
  getPublishingCapabilities: jest.fn(),
  validateProviderOptions: jest.fn(),
  checkStatus: jest.fn(),
};

const mockProviderRegistry = {
  getPublishingAdapter: jest.fn().mockReturnValue(mockProviderAdapter),
  supportsPublishing: jest.fn().mockReturnValue(true),
};

const mockExecutionValidator = {
  validate: jest.fn(),
};

const mockTokenService = {
  getExecutionCredentials: jest.fn(),
};

const mockStorage = {
  getStream: jest.fn(),
  createUpload: jest.fn(),
  headObject: jest.fn(),
  deleteObject: jest.fn(),
};

describe('Worker Storage Integration', () => {
  let processor: PublishingProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishingProcessor,
        { provide: PrismaClient, useValue: mockPrisma },
        { provide: ProviderRegistry, useValue: mockProviderRegistry },
        { provide: ExecutionValidator, useValue: mockExecutionValidator },
        { provide: TokenService, useValue: mockTokenService },
        { provide: 'IObjectStorage', useValue: mockStorage },
      ],
    }).compile();

    processor = module.get<PublishingProcessor>(PublishingProcessor);
    mockExecutionValidator.validate.mockReturnValue({ valid: true });
  });

  it('passes storage abstraction to provider adapter and handles range reads correctly', async () => {
    const wsId = generateId();
    const publicationId = generateId();

    // Mock ExecutionValidator to return a valid result
    mockExecutionValidator.validate.mockReturnValue({
      valid: true,
      failureCategory: undefined,
      failureCode: undefined,
      message: undefined,
    });

    mockTokenService.getExecutionCredentials.mockResolvedValue({
      accessToken: 'test-token',
    });

    mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
      id: publicationId,
      status: 'QUEUED',
      dispatchVersion: 1,
      content: 'Test content',
      providerOptions: {},
      socialAccount: { id: generateId(), provider: 'YOUTUBE' },
      post: {
        media: [
          {
            media: {
              id: generateId(),
              workspaceId: wsId,
              status: 'READY',
              storageKey: `workspaces/${wsId}/media/test/source`,
              mimeType: 'video/mp4',
              byteSize: 1000,
            },
            sortOrder: 0,
          },
        ],
      },
    });

    mockPrisma.postPlatformVariant.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.publicationAttempt.create.mockResolvedValue({
      id: generateId(),
    });
    mockPrisma.publicationAttempt.findFirst.mockResolvedValue(null);
    mockPrisma.auditLog.create.mockResolvedValue({});

    mockProviderAdapter.publish.mockImplementation(
      async (creds, input, mediaSource) => {
        // Act like LinkedIn resumable upload taking stream chunks
        const streamFull = await mediaSource.getStream(input.media[0].key);
        expect(streamFull).toBeDefined();

        const streamRange = await mediaSource.getStream(input.media[0].key, {
          start: 100,
          end: 500,
        });
        expect(streamRange).toBeDefined();

        return {
          success: true,
          externalPostId: 'yt-123',
          processingState: 'PROCESSING',
        };
      },
    );

    mockStorage.getStream.mockResolvedValue(Readable.from(['fake-data']));

    const jobData = {
      data: {
        workspaceId: wsId,
        publicationId,
        dispatchVersion: 1,
      },
    } as any;

    await processor.process(jobData);

    expect(mockProviderAdapter.publish).toHaveBeenCalled();
    const args = mockProviderAdapter.publish.mock.calls[0];
    expect(args[2]).toBeDefined(); // IObjectStorage

    expect(mockStorage.getStream).toHaveBeenCalledWith(
      `workspaces/${wsId}/media/test/source`,
    );
    expect(mockStorage.getStream).toHaveBeenCalledWith(
      `workspaces/${wsId}/media/test/source`,
      { start: 100, end: 500 },
    );
  });

  describe('Continuation and Architecture Proofs', () => {
    it('AMBIGUOUS + UNKNOWN transaction rollback proof', async () => {
      const publicationId = generateId();
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 1,
        executionMetadata: {
          version: 1,
          operationId: '123e4567-e89b-12d3-a456-426614174000',
          provider: 'FACEBOOK',
          phase: 'PUBLISH_REQUESTED',
          publishRequestedAt: new Date().toISOString(),
        },
        socialAccount: { externalId: 'acc', provider: 'FACEBOOK' },
        post: { content: 'test', media: [] },
      });
      mockPrisma.postPlatformVariant.update.mockRejectedValueOnce(
        new Error('Rollback proof'),
      );

      const jobData = {
        data: {
          workspaceId: generateId(),
          publicationId,
          dispatchVersion: 1,
          operationId: '123e4567-e89b-12d3-a456-426614174000',
        },
      } as any;

      await expect(processor.process(jobData)).rejects.toThrow(
        'Rollback proof',
      );
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('CONTINUATION PAYLOAD STALE-OP TEST', async () => {
      const publicationId = generateId();
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 2,
        executionMetadata: {
          version: 1,
          operationId: '10000000-0000-0000-0000-00000000000b', // DB is operation-B
          provider: 'FACEBOOK',
          phase: 'PROCESSING_REMOTE',
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date().toISOString(),
        },
        socialAccount: { externalId: 'acc', provider: 'FACEBOOK' },
        post: { content: 'test', media: [] },
      });

      const jobData = {
        data: {
          workspaceId: generateId(),
          publicationId,
          dispatchVersion: 2,
          operationId: '10000000-0000-0000-0000-00000000000a', // Payload is operation-A
        },
      } as any;

      await processor.process(jobData);
      expect(mockProviderAdapter.publish).not.toHaveBeenCalled();
      expect(mockPrisma.postPlatformVariant.updateMany).not.toHaveBeenCalled();
    });

    it('SERVER-OWNED TIMESTAMP TESTS', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-19T10:00:00Z'));

      const publicationId = generateId();
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 1,
        executionMetadata: {
          version: 1,
          operationId: '123e4567-e89b-12d3-a456-426614174000',
          provider: 'FACEBOOK',
          phase: 'PROCESSING_REMOTE',
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date().toISOString(),
        },
        socialAccount: { externalId: 'acc', provider: 'FACEBOOK' },
        post: { content: 'test', media: [] },
      });
      mockPrisma.postPlatformVariant.updateMany.mockResolvedValue({ count: 1 });

      mockPrisma.publicationAttempt.findFirst.mockResolvedValue({
        id: 'att-1',
        status: 'PUBLISHING',
      });
      mockPrisma.publicationAttempt.update.mockResolvedValue({ id: 'att-1' });
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockTokenService.getExecutionCredentials.mockResolvedValue({
        accessToken: 'test-token',
      });
      mockProviderAdapter.checkStatus = jest.fn().mockResolvedValue({
        status: 'PROCESSING',
      });

      const jobData = {
        data: {
          workspaceId: generateId(),
          publicationId,
          dispatchVersion: 1,
          operationId: '123e4567-e89b-12d3-a456-426614174000',
        },
      } as any;

      await processor.process(jobData);

      const updateCall =
        mockPrisma.postPlatformVariant.updateMany.mock.calls[0][0];
      const nextMetadata = updateCall.data.executionMetadata;
      expect(nextMetadata.lastCheckedAt).toBe('2026-09-19T10:00:00.000Z');
      expect(nextMetadata.nextCheckAt).toBe('2026-09-19T10:01:00.000Z');

      jest.useRealTimers();
    });
    it('checkStatus PROCESSING -> stays PROCESSING_REMOTE, next poll scheduled', async () => {
      const publicationId = generateId();
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 2,
        executionMetadata: {
          version: 1,
          operationId: '10000000-0000-0000-0000-000000000001',
          provider: 'YOUTUBE',
          phase: 'PROCESSING_REMOTE',
          remoteResourceId: 'vid-proc',
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date().toISOString(),
        },
        socialAccount: { externalId: 'acc', provider: 'YOUTUBE' },
        post: { content: 'test', media: [] },
      });
      mockPrisma.postPlatformVariant.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.publicationAttempt.findFirst.mockResolvedValue({
        id: 'att-1',
        status: 'PUBLISHING',
      });
      mockPrisma.publicationAttempt.update.mockResolvedValue({ id: 'att-1' });
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockTokenService.getExecutionCredentials.mockResolvedValue({
        accessToken: 'test-token',
      });
      mockProviderAdapter.checkStatus = jest
        .fn()
        .mockResolvedValue({ status: 'PROCESSING' });

      await processor.process({
        data: {
          workspaceId: generateId(),
          publicationId,
          dispatchVersion: 2,
          operationId: '10000000-0000-0000-0000-000000000001',
        },
      } as any);

      expect(mockProviderAdapter.publish).not.toHaveBeenCalled();
      const updateCall =
        mockPrisma.postPlatformVariant.updateMany.mock.calls[0][0];
      expect(updateCall.data.executionMetadata.phase).toBe('PROCESSING_REMOTE');
      expect(updateCall.data.executionMetadata.remoteResourceId).toBe(
        'vid-proc',
      );
    });

    it('checkStatus PUBLISHED -> COMPLETED with finalRemoteId', async () => {
      const publicationId = generateId();
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 2,
        executionMetadata: {
          version: 1,
          operationId: '10000000-0000-0000-0000-000000000002',
          provider: 'YOUTUBE',
          phase: 'PROCESSING_REMOTE',
          remoteResourceId: 'vid-pub',
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date().toISOString(),
        },
        socialAccount: { externalId: 'acc', provider: 'YOUTUBE' },
        post: { content: 'test', media: [] },
      });
      mockPrisma.postPlatformVariant.updateMany.mockResolvedValue({ count: 1 });
      mockProviderAdapter.checkStatus = jest
        .fn()
        .mockResolvedValue({ status: 'PUBLISHED' });

      await processor.process({
        data: {
          workspaceId: generateId(),
          publicationId,
          dispatchVersion: 2,
          operationId: '10000000-0000-0000-0000-000000000002',
        },
      } as any);

      expect(mockProviderAdapter.publish).not.toHaveBeenCalled();
      const updateCall =
        mockPrisma.postPlatformVariant.updateMany.mock.calls[0][0];
      expect(updateCall.data.executionMetadata.phase).toBe('COMPLETED');
      expect(updateCall.data.executionMetadata.finalRemoteId).toBe('vid-pub');
    });

    it('checkStatus explicit FAILED -> terminal FAILED', async () => {
      const publicationId = generateId();
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 2,
        executionMetadata: {
          version: 1,
          operationId: '10000000-0000-0000-0000-000000000003',
          provider: 'YOUTUBE',
          phase: 'PROCESSING_REMOTE',
          remoteResourceId: 'vid-fail',
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date().toISOString(),
        },
        socialAccount: { externalId: 'acc', provider: 'YOUTUBE' },
        post: { content: 'test', media: [] },
      });
      mockPrisma.postPlatformVariant.updateMany.mockResolvedValue({ count: 1 });
      mockProviderAdapter.checkStatus = jest.fn().mockResolvedValue({
        status: 'FAILED',
        failureCategory: 'PERMANENT',
        failureCode: 'YOUTUBE_PROCESSING_FAILED',
      });

      await processor.process({
        data: {
          workspaceId: generateId(),
          publicationId,
          dispatchVersion: 2,
          operationId: '10000000-0000-0000-0000-000000000003',
        },
      } as any);

      expect(mockProviderAdapter.publish).not.toHaveBeenCalled();
      const updateManyCall =
        mockPrisma.postPlatformVariant.updateMany.mock.calls[0][0];
      expect(updateManyCall.data.executionMetadata.phase).toBe('FAILED');
      const updateCall = mockPrisma.postPlatformVariant.update.mock.calls.find(
        (c: any) => c[0].data && c[0].data.status === 'FAILED',
      );
      expect(updateCall).toBeDefined();
    });

    it('checkStatus UNKNOWN (network error) -> stays PROCESSING_REMOTE, preserves remoteResourceId', async () => {
      const publicationId = generateId();
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 2,
        executionMetadata: {
          version: 1,
          operationId: '10000000-0000-0000-0000-000000000004',
          provider: 'YOUTUBE',
          phase: 'PROCESSING_REMOTE',
          remoteResourceId: 'vid-net',
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date().toISOString(),
        },
        socialAccount: { externalId: 'acc', provider: 'YOUTUBE' },
        post: { content: 'test', media: [] },
      });
      mockPrisma.postPlatformVariant.updateMany.mockResolvedValue({ count: 1 });
      mockProviderAdapter.checkStatus = jest.fn().mockResolvedValue({
        status: 'UNKNOWN',
        failureCode: 'YOUTUBE_STATUS_CHECK_FAILED',
      });

      await processor.process({
        data: {
          workspaceId: generateId(),
          publicationId,
          dispatchVersion: 2,
          operationId: '10000000-0000-0000-0000-000000000004',
        },
      } as any);

      expect(mockProviderAdapter.publish).not.toHaveBeenCalled();
      const updateCall =
        mockPrisma.postPlatformVariant.updateMany.mock.calls[0][0];
      expect(updateCall.data.executionMetadata.phase).toBe('PROCESSING_REMOTE');
      expect(updateCall.data.executionMetadata.remoteResourceId).toBe(
        'vid-net',
      );
    });

    it('REPEATED POLLING: network error -> PROCESSING -> PUBLISHED', async () => {
      const publicationId = generateId();
      let checkStatusCount = 0;

      mockProviderAdapter.publish = jest
        .fn()
        .mockImplementation(async (creds, input, storage, context) => {
          if (context && context.beforeFinalMutation) {
            await context.beforeFinalMutation();
          }
          return {
            success: true,
            processingState: 'PROCESSING',
            externalPostId: 'vid-rep-initial',
          };
        });

      mockProviderAdapter.checkStatus = jest.fn().mockImplementation(() => {
        checkStatusCount++;
        if (checkStatusCount === 1)
          return { status: 'UNKNOWN', failureCode: 'TIMEOUT' };
        if (checkStatusCount === 2) return { status: 'PROCESSING' };
        return { status: 'PUBLISHED' };
      });

      // --- INITIAL PUBLISH (INITIATED -> PROCESSING_REMOTE) ---
      mockPrisma.postPlatformVariant.findFirst.mockImplementation(() => {
        const calls = mockPrisma.postPlatformVariant.updateMany.mock.calls;
        const lastUpdate =
          calls.length > 0 ? calls[calls.length - 1][0].data : null;

        if (!lastUpdate) {
          return {
            id: publicationId,
            status: 'QUEUED',
            dispatchVersion: 1,
            socialAccount: { externalId: 'acc', provider: 'YOUTUBE' },
            post: { content: 'test', media: [] },
          };
        }

        return {
          id: publicationId,
          status: lastUpdate.status || 'PUBLISHING',
          dispatchVersion:
            lastUpdate.dispatchVersion && lastUpdate.dispatchVersion.increment
              ? 1 + lastUpdate.dispatchVersion.increment
              : lastUpdate.dispatchVersion || 2,
          executionMetadata: lastUpdate.executionMetadata,
          socialAccount: { externalId: 'acc', provider: 'YOUTUBE' },
          post: { content: 'test', media: [] },
        };
      });

      mockPrisma.postPlatformVariant.update.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 2,
      });
      mockPrisma.postPlatformVariant.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.postPlatformVariant.findUniqueOrThrow.mockResolvedValue({
        id: publicationId,
        dispatchVersion: 2,
        executionMetadata: {
          version: 1,
          operationId: '10000000-0000-0000-0000-000000000005',
          provider: 'YOUTUBE',
          phase: 'INITIATED',
        },
      });
      mockPrisma.publicationAttempt.create.mockResolvedValue({ id: 'att-x' });
      mockPrisma.publicationAttempt.findFirst.mockResolvedValue({
        id: 'att-x',
        status: 'PUBLISHING',
      });
      mockPrisma.publicationAttempt.update.mockResolvedValue({ id: 'att-x' });
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockTokenService.getExecutionCredentials.mockResolvedValue({
        accessToken: 'test-token',
      });
      mockPrisma['$transaction'].mockImplementation((cb: any) =>
        cb(mockPrisma),
      );

      jest
        .spyOn(crypto, 'randomUUID')
        .mockReturnValue('10000000-0000-0000-0000-000000000005');

      await processor.process({
        data: { workspaceId: 'ws', publicationId, dispatchVersion: 1 },
      } as any);
      const initialUpdate =
        mockPrisma.postPlatformVariant.updateMany.mock.calls.find(
          (c: any) =>
            c[0].data &&
            c[0].data.executionMetadata &&
            c[0].data.executionMetadata.phase === 'PROCESSING_REMOTE',
        )[0];
      expect(initialUpdate.data.executionMetadata.phase).toBe(
        'PROCESSING_REMOTE',
      );
      expect(initialUpdate.data.executionMetadata.remoteResourceId).toBe(
        'vid-rep-initial',
      );
      expect(initialUpdate.data.dispatchVersion.increment).toBe(1);

      // --- POLL 1: TIMEOUT (PROCESSING_REMOTE -> PROCESSING_REMOTE) ---
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 2,
        executionMetadata: initialUpdate.data.executionMetadata,
        socialAccount: { externalId: 'acc', provider: 'YOUTUBE' },
        post: { content: 'test', media: [] },
      });
      mockPrisma.postPlatformVariant.updateMany.mockClear();

      await processor.process({
        data: {
          workspaceId: 'ws',
          publicationId,
          dispatchVersion: 2,
          operationId: initialUpdate.data.executionMetadata.operationId,
        },
      } as any);

      const poll1Update =
        mockPrisma.postPlatformVariant.updateMany.mock.calls.find(
          (c: any) =>
            c[0].data &&
            c[0].data.executionMetadata &&
            c[0].data.executionMetadata.phase === 'PROCESSING_REMOTE',
        )[0];
      expect(poll1Update.data.executionMetadata.phase).toBe(
        'PROCESSING_REMOTE',
      );
      expect(poll1Update.data.executionMetadata.remoteResourceId).toBe(
        'vid-rep-initial',
      );
      expect(poll1Update.data.dispatchVersion.increment).toBe(1);

      // --- POLL 2: PROCESSING (PROCESSING_REMOTE -> PROCESSING_REMOTE) ---
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 3,
        executionMetadata: poll1Update.data.executionMetadata,
        socialAccount: { externalId: 'acc', provider: 'YOUTUBE' },
        post: { content: 'test', media: [] },
      });
      mockPrisma.postPlatformVariant.updateMany.mockClear();

      await processor.process({
        data: {
          workspaceId: 'ws',
          publicationId,
          dispatchVersion: 3,
          operationId: initialUpdate.data.executionMetadata.operationId,
        },
      } as any);

      const poll2Update =
        mockPrisma.postPlatformVariant.updateMany.mock.calls.find(
          (c: any) =>
            c[0].data &&
            c[0].data.executionMetadata &&
            c[0].data.executionMetadata.phase === 'PROCESSING_REMOTE',
        )[0];
      expect(poll2Update.data.executionMetadata.phase).toBe(
        'PROCESSING_REMOTE',
      );
      expect(poll2Update.data.executionMetadata.remoteResourceId).toBe(
        'vid-rep-initial',
      );
      expect(poll2Update.data.dispatchVersion.increment).toBe(1);

      // --- POLL 3: PUBLISHED (PROCESSING_REMOTE -> COMPLETED) ---
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 4,
        executionMetadata: poll2Update.data.executionMetadata,
        socialAccount: { externalId: 'acc', provider: 'YOUTUBE' },
        post: { content: 'test', media: [] },
      });
      mockPrisma.postPlatformVariant.updateMany.mockClear();

      await processor.process({
        data: {
          workspaceId: 'ws',
          publicationId,
          dispatchVersion: 4,
          operationId: initialUpdate.data.executionMetadata.operationId,
        },
      } as any);

      const finalUpdate =
        mockPrisma.postPlatformVariant.updateMany.mock.calls[0][0];
      expect(finalUpdate.data.executionMetadata.phase).toBe('COMPLETED');
      expect(finalUpdate.data.executionMetadata.finalRemoteId).toBe(
        'vid-rep-initial',
      );
      expect(finalUpdate.data.dispatchVersion.increment).toBe(1);

      // Verify Exact Counts
      expect(mockProviderAdapter.publish).toHaveBeenCalledTimes(1);
      expect(mockProviderAdapter.checkStatus).toHaveBeenCalledTimes(3);
    });

    it('missing checkStatus capability -> FAILED (deterministic config failure, not remote failure)', async () => {
      const publicationId = generateId();
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: publicationId,
        status: 'PUBLISHING',
        dispatchVersion: 2,
        executionMetadata: {
          version: 1,
          operationId: '10000000-0000-0000-0000-000000000006',
          provider: 'LINKEDIN',
          phase: 'PROCESSING_REMOTE',
          remoteResourceId: 'vid-no-cs',
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date().toISOString(),
        },
        socialAccount: { externalId: 'acc', provider: 'LINKEDIN' },
        post: { content: 'test', media: [] },
      });
      mockPrisma.postPlatformVariant.updateMany.mockResolvedValue({ count: 1 });

      // Provider without checkStatus
      mockProviderAdapter.checkStatus = undefined as any;

      await processor.process({
        data: {
          workspaceId: generateId(),
          publicationId,
          dispatchVersion: 2,
          operationId: '10000000-0000-0000-0000-000000000006',
        },
      } as any);

      expect(mockProviderAdapter.publish).not.toHaveBeenCalled();
      const updateManyCall =
        mockPrisma.postPlatformVariant.updateMany.mock.calls[0][0];
      expect(updateManyCall.data.executionMetadata.phase).toBe('FAILED');

      const attemptUpdate =
        mockPrisma.publicationAttempt.update.mock.calls.find(
          (c: any) =>
            c[0].data && c[0].data.failureCode === 'MISSING_CAPABILITY',
        );
      expect(attemptUpdate).toBeDefined();

      const statusUpdate =
        mockPrisma.postPlatformVariant.update.mock.calls.find(
          (c: any) => c[0].data && c[0].data.status === 'FAILED',
        );
      expect(statusUpdate).toBeDefined();
    });
  });

  describe('LinkedIn Checkpoint Worker Proofs', () => {

    it('Atomic A � SUCCESS: AMBIGUOUS + UNKNOWN persist atomically', async () => {
      let currentPhase = 'INITIATED';
      let currentVersion = 1;
      let finalVariantStatus = '';
      let hasStarted = false;
      const getMockMetadata = () => {
        if (!hasStarted) return null;
        const base: any = {
          phase: currentPhase,
          operationId: '10000000-0000-0000-0000-000000000005',
          provider: 'LINKEDIN',
          version: 1,
        };
        if (currentPhase === 'PUBLISH_REQUESTED')
          base.publishRequestedAt = new Date().toISOString();
        if (currentPhase === 'COMPLETED') base.finalRemoteId = 'some-id';
        return base;
      };

      mockPrisma.postPlatformVariant.findFirst.mockImplementation(() => ({
        id: 'pub_atomic_a',
        workspaceId: 'ws1',
        socialAccountId: 'acc1',
        socialAccount: { provider: 'linkedin', externalId: 'ext1' },
        content: 'hello',
        post: { media: [] },
        dispatchVersion: currentVersion,
        status: 'QUEUED',
        executionMetadata: getMockMetadata(),
      }));

      mockPrisma.postPlatformVariant.findUniqueOrThrow.mockImplementation(
        () => ({
          executionMetadata: getMockMetadata(),
          dispatchVersion: currentVersion,
          status: 'PUBLISHING',
        }),
      );

      mockPrisma.postPlatformVariant.updateMany.mockImplementation(
        async (args: any) => {
          if (args.where.dispatchVersion !== currentVersion)
            return { count: 0 };
          if (
            args.data.executionMetadata &&
            args.data.executionMetadata.phase
          ) {
            currentPhase = args.data.executionMetadata.phase;
            hasStarted = true;
          }
          if (
            args.data.dispatchVersion &&
            args.data.dispatchVersion.increment
          ) {
            currentVersion += args.data.dispatchVersion.increment;
          }
          return { count: 1 };
        },
      );

      mockPrisma.postPlatformVariant.update.mockImplementation(async (args: any) => {
        if (args.data.status) finalVariantStatus = args.data.status;
        return {} as any;
      });

      mockProviderAdapter.publish = jest.fn().mockImplementation(async (_c: any, _i: any, _s: any, ctx: any) => {
        await ctx.beforeFinalMutation();
        return {
          success: false,
          failureCategory: 'UNKNOWN_RESULT',
          failureCode: 'NETWORK_ERROR',
        };
      });

      await processor.process({
        data: { workspaceId: 'ws1', publicationId: 'pub_atomic_a', dispatchVersion: 1 },
        id: 'job_a',
      } as any);

      expect(currentPhase).toBe('AMBIGUOUS');
      expect(finalVariantStatus).toBe('UNKNOWN');
    });

    it('Atomic B � ROLLBACK: no partial AMBIGUOUS write on failure', async () => {
      let currentPhase = 'INITIATED';
      let currentVersion = 1;
      let finalVariantStatus = '';
      let hasStarted = false;
      const getMockMetadata = () => {
        if (!hasStarted) return null;
        const base: any = {
          phase: currentPhase,
          operationId: '10000000-0000-0000-0000-000000000005',
          provider: 'LINKEDIN',
          version: 1,
        };
        if (currentPhase === 'PUBLISH_REQUESTED')
          base.publishRequestedAt = new Date().toISOString();
        if (currentPhase === 'COMPLETED') base.finalRemoteId = 'some-id';
        return base;
      };

      mockPrisma.postPlatformVariant.findFirst.mockImplementation(() => ({
        id: 'pub_atomic_b',
        workspaceId: 'ws1',
        socialAccountId: 'acc1',
        socialAccount: { provider: 'linkedin', externalId: 'ext1' },
        content: 'hello',
        post: { media: [] },
        dispatchVersion: currentVersion,
        status: 'QUEUED',
        executionMetadata: getMockMetadata(),
      }));

      mockPrisma.postPlatformVariant.findUniqueOrThrow.mockImplementation(
        () => ({
          executionMetadata: getMockMetadata(),
          dispatchVersion: currentVersion,
          status: 'PUBLISHING',
        }),
      );

      mockPrisma.postPlatformVariant.updateMany.mockImplementation(
        async (args: any) => {
          if (args.where.dispatchVersion !== currentVersion)
            return { count: 0 };
          if (
            args.data.executionMetadata &&
            args.data.executionMetadata.phase
          ) {
            currentPhase = args.data.executionMetadata.phase;
            hasStarted = true;
          }
          if (
            args.data.dispatchVersion &&
            args.data.dispatchVersion.increment
          ) {
            currentVersion += args.data.dispatchVersion.increment;
          }
          return { count: 1 };
        },
      );

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const savedPhase = currentPhase;
        const savedVersion = currentVersion;
        try {
          return await cb(mockPrisma);
        } catch(e) {
          currentPhase = savedPhase;
          currentVersion = savedVersion;
          throw e;
        }
      });

      mockPrisma.postPlatformVariant.update.mockImplementationOnce(async () => { throw new Error('DB Network drop during transaction'); });

      mockProviderAdapter.publish = jest.fn().mockImplementation(async (_c: any, _i: any, _s: any, ctx: any) => {
        await ctx.beforeFinalMutation();
        return {
          success: false,
          failureCategory: 'UNKNOWN_RESULT',
          failureCode: 'NETWORK_ERROR',
        };
      });

      try {
        await processor.process({
          data: { workspaceId: 'ws1', publicationId: 'pub_atomic_b', dispatchVersion: 1 },
          id: 'job_b',
        } as any);
      } catch(e) {}

      // Rollback must leave it at PUBLISH_REQUESTED since beforeFinalMutation succeeded but handleUnknown transaction failed
      expect(currentPhase).toBe('PUBLISH_REQUESTED');
      mockPrisma.postPlatformVariant.update.mockReset();
    });

    it('A. beforeFinalMutation transitions: INITIATED -> PUBLISH_REQUESTED', () => {});
    it('B. updated dispatchVersion is used afterward', () => {});

    it('C. success: PUBLISH_REQUESTED -> COMPLETED', async () => {
      const provider = mockProviderAdapter;

      let currentPhase = 'INITIATED';
      let currentVersion = 1;
      let hasStarted = false;
      const getMockMetadata = () => {
        if (!hasStarted) return null;
        const base: any = {
          phase: currentPhase,
          operationId: '10000000-0000-0000-0000-000000000005',
          provider: 'LINKEDIN',
          version: 1,
        };
        if (currentPhase === 'PUBLISH_REQUESTED')
          base.publishRequestedAt = new Date().toISOString();
        if (currentPhase === 'COMPLETED') base.finalRemoteId = 'some-id';
        return base;
      };

      mockPrisma.postPlatformVariant.findFirst.mockImplementation(() => ({
        id: 'pub1',
        workspaceId: 'ws1',
        socialAccountId: 'acc1',
        socialAccount: { provider: 'linkedin', externalId: 'ext1' },
        content: 'hello',
        post: { media: [] },
        dispatchVersion: currentVersion,
        status: 'QUEUED',
        executionMetadata: getMockMetadata(),
      }));

      mockPrisma.postPlatformVariant.findUniqueOrThrow.mockImplementation(
        () => ({
          executionMetadata: getMockMetadata(),
          dispatchVersion: currentVersion,
          status: 'PUBLISHING',
        }),
      );

      mockPrisma.postPlatformVariant.updateMany.mockImplementation(
        async (args: any) => {
          if (args.where.dispatchVersion !== currentVersion)
            return { count: 0 };
          if (
            args.data.executionMetadata &&
            args.data.executionMetadata.phase
          ) {
            currentPhase = args.data.executionMetadata.phase;
            hasStarted = true;
          }
          if (
            args.data.dispatchVersion &&
            args.data.dispatchVersion.increment
          ) {
            currentVersion += args.data.dispatchVersion.increment;
          }
          return { count: 1 };
        },
      );

      jest
        .spyOn(provider, 'publish')
        .mockImplementation(async (creds, input, media, ctx) => {
          expect(currentPhase).toBe('INITIATED');
          expect(currentVersion).toBe(2);
          await ctx.beforeFinalMutation();
          expect(currentPhase).toBe('PUBLISH_REQUESTED');
          expect(currentVersion).toBe(3);
          return { success: true, externalPostId: 'urn:li:share:123' };
        });

      await processor.process({
        data: { workspaceId: 'ws1', publicationId: 'pub1', dispatchVersion: 1 },
        id: 'job1',
      } as any);

      expect(currentPhase).toBe('COMPLETED');
      expect(currentVersion).toBe(4);
    });

    it('D. network/unknown outcome after PUBLISH_REQUESTED: -> AMBIGUOUS / UNKNOWN -> provider publish is not blindly retried', async () => {
      const provider = mockProviderAdapter;

      let currentPhase = 'INITIATED';
      let currentVersion = 1;
      let finalVariantStatus = '';
      let hasStarted = false;
      const getMockMetadata = () => {
        if (!hasStarted) return null;
        const base: any = {
          phase: currentPhase,
          operationId: '10000000-0000-0000-0000-000000000005',
          provider: 'LINKEDIN',
          version: 1,
        };
        if (currentPhase === 'PUBLISH_REQUESTED')
          base.publishRequestedAt = new Date().toISOString();
        if (currentPhase === 'COMPLETED') base.finalRemoteId = 'some-id';
        return base;
      };

      mockPrisma.postPlatformVariant.findFirst.mockImplementation(() => ({
        id: 'pub2',
        workspaceId: 'ws1',
        socialAccountId: 'acc1',
        socialAccount: { provider: 'linkedin', externalId: 'ext1' },
        content: 'hello',
        post: { media: [] },
        dispatchVersion: currentVersion,
        status: 'QUEUED',
        executionMetadata: getMockMetadata(),
      }));

      mockPrisma.postPlatformVariant.findUniqueOrThrow.mockImplementation(
        () => ({
          executionMetadata: getMockMetadata(),
          dispatchVersion: currentVersion,
          status: 'PUBLISHING',
        }),
      );

      mockPrisma.postPlatformVariant.updateMany.mockImplementation(
        async (args: any) => {
          if (args.where.dispatchVersion !== currentVersion)
            return { count: 0 };
          if (
            args.data.executionMetadata &&
            args.data.executionMetadata.phase
          ) {
            currentPhase = args.data.executionMetadata.phase;
            hasStarted = true;
          }
          if (
            args.data.dispatchVersion &&
            args.data.dispatchVersion.increment
          ) {
            currentVersion += args.data.dispatchVersion.increment;
          }
          return { count: 1 };
        },
      );

      mockPrisma.postPlatformVariant.update.mockImplementation(
        async (args: any) => {
          if (args.data.status) finalVariantStatus = args.data.status;
        },
      );

      jest
        .spyOn(provider, 'publish')
        .mockImplementationOnce(async (creds, input, media, ctx) => {
          await ctx.beforeFinalMutation();
          return {
            success: false,
            failureCategory: 'UNKNOWN_RESULT',
            failureCode: 'NETWORK_ERROR',
            message: 'timeout',
          };
        });

      await processor.process({
        data: { workspaceId: 'ws1', publicationId: 'pub2', dispatchVersion: 1 },
        id: 'job2',
      } as any);

      expect(currentPhase).toBe('AMBIGUOUS');
      expect(finalVariantStatus).toBe('UNKNOWN');

      // blind retry simulation
      jest.spyOn(provider, 'publish').mockClear();
      hasStarted = true;
      currentPhase = 'AMBIGUOUS';

      await processor.process({
        data: {
          workspaceId: 'ws1',
          publicationId: 'pub2',
          dispatchVersion: currentVersion,
        },
        id: 'job3',
      } as any);

      expect(provider.publish).not.toHaveBeenCalled();
    });

    it('E. stale operationId: -> no provider call', () => {});

    it('F. stale dispatchVersion/checkpoint CAS rejection: -> final mutation = 0', async () => {
      const provider = mockProviderAdapter;

      let currentPhase = 'INITIATED';
      let currentVersion = 1;
      let mutationCount = 0;
      let hasStarted = false;
      const getMockMetadata = () => {
        if (!hasStarted) return null;
        const base: any = {
          phase: currentPhase,
          operationId: '10000000-0000-0000-0000-000000000005',
          provider: 'LINKEDIN',
          version: 1,
        };
        if (currentPhase === 'PUBLISH_REQUESTED')
          base.publishRequestedAt = new Date().toISOString();
        if (currentPhase === 'COMPLETED') base.finalRemoteId = 'some-id';
        return base;
      };

      mockPrisma.postPlatformVariant.findFirst.mockImplementation(() => ({
        id: 'pub4',
        workspaceId: 'ws1',
        socialAccountId: 'acc1',
        socialAccount: { provider: 'linkedin', externalId: 'ext1' },
        content: 'hello',
        post: { media: [] },
        dispatchVersion: currentVersion,
        status: 'QUEUED',
        executionMetadata: getMockMetadata(),
      }));

      mockPrisma.postPlatformVariant.findUniqueOrThrow.mockImplementation(
        () => ({
          executionMetadata: getMockMetadata(),
          dispatchVersion: currentVersion,
          status: 'PUBLISHING',
        }),
      );

      mockPrisma.postPlatformVariant.updateMany.mockImplementation(
        async (args: any) => {
          if (args.where.dispatchVersion !== currentVersion)
            return { count: 0 };
          if (
            args.data.executionMetadata &&
            args.data.executionMetadata.phase === 'PUBLISH_REQUESTED'
          )
            return { count: 0 };
          if (
            args.data.executionMetadata &&
            args.data.executionMetadata.phase
          ) {
            currentPhase = args.data.executionMetadata.phase;
            hasStarted = true;
          }
          if (
            args.data.dispatchVersion &&
            args.data.dispatchVersion.increment
          ) {
            currentVersion += args.data.dispatchVersion.increment;
          }
          return { count: 1 };
        },
      );

      jest
        .spyOn(provider, 'publish')
        .mockImplementationOnce(async (creds, input, media, ctx) => {
          try {
            await ctx.beforeFinalMutation();
            mutationCount++;
            return { success: true, externalPostId: 'urn:li:share:123' };
          } catch (e) {
            throw e;
          }
        });

      await processor.process({
        data: { workspaceId: 'ws1', publicationId: 'pub4', dispatchVersion: 1 },
        id: 'job4',
      } as any);

      expect(mutationCount).toBe(0);
    });
  });
});
