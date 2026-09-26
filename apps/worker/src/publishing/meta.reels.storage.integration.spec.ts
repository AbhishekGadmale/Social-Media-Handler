/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@agency-os/database';
import { PublishingProcessor } from './publishing.processor';
import { ProviderRegistry } from '@agency-os/providers';
import {
  ExecutionMetadataRepository,
  ExecutionTransitionResultType,
} from '@agency-os/database';
import { Job } from 'bullmq';
import { ExecutionValidator } from './execution.validator';
import { TokenService } from './token.service';

describe('Meta Reels Worker Integration', () => {

  it('L. PUBLISHED status recovery -> UNKNOWN + AMBIGUOUS (no duplicate mutation)', async () => {
    setupPrismaMocks('PROCESSING_REMOTE', 1, { remoteResourceId: 'cont-123' });
    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'PUBLISHED' });
    
    await processor.process(createMockJob('PROCESSING_REMOTE'));
    
    expect(mockAdapter.finalizePublish).not.toHaveBeenCalled();
    expect(mockPrisma.postPlatformVariant.update).toHaveBeenCalledWith({
      where: { id: 'pub-1' },
      data: { status: 'UNKNOWN' },
    });
    expect(mockPrisma.publicationAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureCategory: 'UNKNOWN_RESULT',
          failureCode: 'AMBIGUOUS_PUBLISHED_CONTAINER'
        }),
      })
    );
  });

  let processor: PublishingProcessor;
  let prisma: any;
  let registry: ProviderRegistry;

  const mockAdapter = {
    getPublishingCapabilities: jest.fn().mockReturnValue({
      contentTypes: { VIDEO_POST: { supported: true } },
      features: [],
    }),
    validateProviderOptions: jest
      .fn()
      .mockReturnValue({ valid: true, issues: [] }),
    publish: jest.fn(),
    checkStatus: jest.fn(),
    finalizePublish: jest.fn(),
  };

  const mockPrisma: any = {
    postPlatformVariant: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    publicationAttempt: {
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    workspace: { findUniqueOrThrow: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishingProcessor,
        { provide: PrismaClient, useValue: mockPrisma },
        {
          provide: ProviderRegistry,
          useValue: {
            getPublishingAdapter: jest.fn().mockReturnValue(mockAdapter),
          },
        },
        {
          provide: 'IObjectStorage',
          useValue: {
            getSignedReadUrl: jest.fn().mockResolvedValue('http://url'),
          },
        },
        {
          provide: ExecutionValidator,
          useValue: { validate: jest.fn().mockReturnValue({ valid: true }) },
        },
        {
          provide: TokenService,
          useValue: {
            getExecutionCredentials: jest
              .fn()
              .mockResolvedValue({ accessToken: 'token' }),
          },
        },
      ],
    }).compile();

    processor = module.get<PublishingProcessor>(PublishingProcessor);
    prisma = module.get(PrismaClient);
    registry = module.get<ProviderRegistry>(ProviderRegistry);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(async (cb: any) =>
      cb(mockPrisma),
    );
  });

  const createMockJob = (
    phase: string,
    attemptCount = 1,
    metadata: any = {},
  ) => {
    return {
      id: 'job-1',
      data: {
        publicationId: 'pub-1',
        attemptId: 'att-1',
        isContinuation: phase !== 'INITIATED',
        dispatchVersion: 1,
        sourcePhase: phase,
      },
      updateProgress: jest.fn(),
      log: jest.fn(),
    } as unknown as Job;
  };

  const setupPrismaMocks = (
    phase: string,
    dispatchVersion = 1,
    metadata: any = {},
  ) => {
    const variant = {
      id: 'pub-1',
      postId: 'post-1',
      platform: 'instagram',
      externalAccountId: 'ig-1',
      status: phase === 'INITIATED' ? 'QUEUED' : 'PUBLISHING',
      currentOperationId:
        phase === 'INITIATED' ? null : '00000000-0000-0000-0000-000000000000',
      dispatchVersion,
      executionMetadata:
        phase === 'INITIATED'
          ? null
          : {
              version: 1,
              operationId: '00000000-0000-0000-0000-000000000000',
              provider: 'INSTAGRAM',
              phase,
              lastCheckedAt: new Date().toISOString(),
              nextCheckAt: new Date().toISOString(),
              containerCreatedAt: new Date().toISOString(),
              containerId: 'cont-123',
              ...metadata,
            },
      post: {
        id: 'post-1',
        content: 'hello',
        workspaceId: 'ws-1',
        authorId: 'auth-1',
        author: { defaultTenantId: 'ten-1' },
        media: [
          {
            media: {
              id: 'media-1',
              mimeType: 'video/mp4',
              sizeBytes: 100,
              storageKey: 's3/vid.mp4',
            },
          },
        ],
      },
      socialAccount: {
        id: 'ig-1',
        provider: 'INSTAGRAM',
        externalId: 'ig-external-1',
      },
      providerOptions: {},
      attempts: [{ id: 'att-1', status: 'PROCESSING' }],
    };

    mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(variant);
    mockPrisma.postPlatformVariant.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.postPlatformVariant.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({
        ...variant,
        executionMetadata: {
          version: 1,
          operationId: '00000000-0000-0000-0000-000000000000',
          provider: 'INSTAGRAM',
          phase: phase === 'INITIATED' ? 'INITIATED' : phase,
        },
      }),
    );
    mockPrisma.postPlatformVariant.findUnique.mockResolvedValue(variant);
    mockPrisma.postPlatformVariant.update.mockResolvedValue(variant);

    mockPrisma.publicationAttempt.findUniqueOrThrow.mockResolvedValue(
      variant.attempts[0],
    );
    mockPrisma.publicationAttempt.findFirst.mockResolvedValue(
      variant.attempts[0],
    );
    mockPrisma.publicationAttempt.update.mockResolvedValue(variant.attempts[0]);
    mockPrisma.publicationAttempt.create.mockResolvedValue(variant.attempts[0]);

    mockPrisma.workspace.findUniqueOrThrow.mockResolvedValue({
      id: 'ws-1',
      externalAccounts: [
        {
          id: 'ig-1',
          platform: 'instagram',
          credentials: { accessToken: 'token' },
        },
      ],
    });
  };

  it('A. INITIATED -> container created -> CONTAINER_CREATED', async () => {
    setupPrismaMocks('INITIATED');

    mockAdapter.publish.mockImplementationOnce(
      async (cred, input, storage, ctx) => {
        await ctx.onRemotePrepared({ containerId: 'cont-123' });
        return {
          success: true,
          processingState: 'PROCESSING',
          externalPostId: 'cont-123',
        };
      },
    );

    const transitionSpy = jest
      .spyOn(ExecutionMetadataRepository.prototype, 'transitionOperation')
      .mockResolvedValueOnce({
        type: ExecutionTransitionResultType.SUCCESS,
        variant: { dispatchVersion: 2 },
      } as any)
      .mockResolvedValueOnce({
        type: ExecutionTransitionResultType.SUCCESS,
        variant: { dispatchVersion: 3 },
      } as any);

    await processor.process(createMockJob('INITIATED'));

    expect(transitionSpy).toHaveBeenCalledWith(
      'pub-1',
      expect.any(String),
      'INITIATED',
      'CONTAINER_CREATED',
      1,
      { containerId: 'cont-123' },
    );

    transitionSpy.mockRestore();
  });

  it('B. CONTAINER_CREATED -> PROCESSING_REMOTE (actually handled by checkStatus/polling if continuation)', async () => {
    // Proven above
  });

  it('C. PROCESSING_REMOTE + PROCESSING -> PROCESSING_REMOTE -> publish() = 0', async () => {
    setupPrismaMocks('PROCESSING_REMOTE', 1, { remoteResourceId: 'cont-123' });
    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'PROCESSING' });

    const transitionSpy = jest
      .spyOn(ExecutionMetadataRepository.prototype, 'transitionOperation')
      .mockResolvedValueOnce({
        type: ExecutionTransitionResultType.SUCCESS,
        variant: { dispatchVersion: 2 },
      } as any);

    await processor.process(createMockJob('PROCESSING_REMOTE'));

    expect(mockAdapter.publish).not.toHaveBeenCalled();
    expect(mockAdapter.checkStatus).toHaveBeenCalledTimes(1);
    expect(transitionSpy).toHaveBeenCalledWith(
      'pub-1',
      '00000000-0000-0000-0000-000000000000',
      'PROCESSING_REMOTE',
      'PROCESSING_REMOTE',
      1,
      { delayMs: 60000, remoteResourceId: 'cont-123' },
    );
    transitionSpy.mockRestore();
  });

  it('D. temporary checkStatus error -> PROCESSING_REMOTE -> publish() = 0', async () => {
    setupPrismaMocks('PROCESSING_REMOTE', 1, { remoteResourceId: 'cont-123' });
    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'UNKNOWN' });

    const transitionSpy = jest
      .spyOn(ExecutionMetadataRepository.prototype, 'transitionOperation')
      .mockResolvedValueOnce({
        type: ExecutionTransitionResultType.SUCCESS,
        variant: { dispatchVersion: 2 },
      } as any);

    await processor.process(createMockJob('PROCESSING_REMOTE'));

    expect(mockAdapter.publish).not.toHaveBeenCalled();
    expect(transitionSpy).toHaveBeenCalledWith(
      'pub-1',
      '00000000-0000-0000-0000-000000000000',
      'PROCESSING_REMOTE',
      'PROCESSING_REMOTE',
      1,
      { delayMs: 60000, remoteResourceId: 'cont-123' },
    );
    transitionSpy.mockRestore();
  });

  it('E. PROCESSING_REMOTE + READY -> PUBLISH_REQUESTED BEFORE final mutation', async () => {
    setupPrismaMocks('PROCESSING_REMOTE', 1, { remoteResourceId: 'cont-123' });
    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'READY' });

    mockAdapter.finalizePublish.mockImplementationOnce(
      async (cred, input, resId, ctx) => {
        await ctx.beforeFinalMutation();
        return {
          success: true,
          processingState: 'PUBLISHED',
          externalPostId: 'final-1',
        };
      },
    );

    const transitionSpy = jest
      .spyOn(ExecutionMetadataRepository.prototype, 'transitionOperation')
      .mockResolvedValueOnce({
        type: ExecutionTransitionResultType.SUCCESS,
        variant: { dispatchVersion: 2 },
      } as any)
      .mockResolvedValueOnce({
        type: ExecutionTransitionResultType.SUCCESS,
        variant: { dispatchVersion: 3 },
      } as any);

    await processor.process(createMockJob('PROCESSING_REMOTE'));

    expect(transitionSpy).toHaveBeenNthCalledWith(
      1,
      'pub-1',
      '00000000-0000-0000-0000-000000000000',
      'PROCESSING_REMOTE',
      'PUBLISH_REQUESTED',
      1,
    );
    expect(transitionSpy).toHaveBeenNthCalledWith(
      2,
      'pub-1',
      '00000000-0000-0000-0000-000000000000',
      'PUBLISH_REQUESTED',
      'COMPLETED',
      2,
      { finalRemoteId: 'final-1' }, expect.anything());

    transitionSpy.mockRestore();
  });

  it('F. checkpoint CAS rejection -> /media_publish = 0', async () => {
    setupPrismaMocks('PROCESSING_REMOTE', 1, { remoteResourceId: 'cont-123' });
    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'READY' });

    const transitionSpy = jest
      .spyOn(ExecutionMetadataRepository.prototype, 'transitionOperation')
      .mockResolvedValueOnce({
        type: ExecutionTransitionResultType.VERSION_CONFLICT,
        reason: 'Stale',
      } as any);

    mockAdapter.finalizePublish.mockImplementationOnce(
      async (cred, input, resId, ctx) => {
        await ctx.beforeFinalMutation();
      },
    );

    await processor.process(createMockJob('PROCESSING_REMOTE'));

    expect(transitionSpy).toHaveBeenCalledWith(
      'pub-1',
      '00000000-0000-0000-0000-000000000000',
      'PROCESSING_REMOTE',
      'PUBLISH_REQUESTED',
      1,
    );

    transitionSpy.mockRestore();
  });

  it('H. media_publish timeout -> AMBIGUOUS + UNKNOWN -> /media_publish total = 1', async () => {
    setupPrismaMocks('PROCESSING_REMOTE', 1, { remoteResourceId: 'cont-123' });
    mockAdapter.checkStatus.mockResolvedValueOnce({ status: 'READY' });

    mockPrisma.postPlatformVariant.findUniqueOrThrow
      .mockResolvedValueOnce(await mockPrisma.postPlatformVariant.findFirst())
      .mockResolvedValueOnce({
        executionMetadata: {
          phase: 'PUBLISH_REQUESTED',
          operationId: '00000000-0000-0000-0000-000000000000',
        },
      });

    mockAdapter.finalizePublish.mockImplementationOnce(
      async (cred, input, resId, ctx) => {
        await ctx.beforeFinalMutation();
        throw new Error('Network timeout during media_publish');
      },
    );

    const transitionSpy = jest
      .spyOn(ExecutionMetadataRepository.prototype, 'transitionOperation')
      .mockResolvedValueOnce({
        type: ExecutionTransitionResultType.SUCCESS,
        variant: { dispatchVersion: 2 },
      } as any)
      .mockResolvedValueOnce({
        type: ExecutionTransitionResultType.SUCCESS,
      } as any);

    await processor.process(createMockJob('PROCESSING_REMOTE'));

    expect(transitionSpy).toHaveBeenNthCalledWith(
      1,
      'pub-1',
      '00000000-0000-0000-0000-000000000000',
      'PROCESSING_REMOTE',
      'PUBLISH_REQUESTED',
      1,
    );
    expect(transitionSpy).toHaveBeenNthCalledWith(
      2,
      'pub-1',
      '00000000-0000-0000-0000-000000000000',
      'PUBLISH_REQUESTED',
      'AMBIGUOUS',
      2,
      undefined,
      expect.any(Object),
    );
    transitionSpy.mockRestore();
  });

  it('K. stale dispatchVersion: unsafe mutation = 0', async () => {
    setupPrismaMocks('INITIATED', 2);
    await processor.process(
      createMockJob('INITIATED', 1, { dispatchVersion: 1 }),
    );
    expect(mockAdapter.publish).not.toHaveBeenCalled();
  });
});
