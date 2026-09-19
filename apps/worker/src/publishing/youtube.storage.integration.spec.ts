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
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'dummy', dispatchVersion: 1 }),
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
        // Act like YouTube resumable upload taking stream chunks
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
          publishRequestedAt: new Date().toISOString()
        },
        socialAccount: { externalId: 'acc', provider: 'FACEBOOK' },
        post: { content: 'test', media: [] }
      });
      mockPrisma.postPlatformVariant.update.mockRejectedValueOnce(new Error('Rollback proof'));
      
      const jobData = {
        data: {
          workspaceId: generateId(),
          publicationId,
          dispatchVersion: 1,
          operationId: '123e4567-e89b-12d3-a456-426614174000',
        },
      } as any;
      
      await expect(processor.process(jobData)).rejects.toThrow('Rollback proof');
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
          operationId: 'operation-B', // DB is operation-B
          provider: 'FACEBOOK',
          phase: 'PROCESSING_REMOTE',
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date().toISOString()
        },
        socialAccount: { externalId: 'acc', provider: 'FACEBOOK' },
        post: { content: 'test', media: [] }
      });
      
      const jobData = {
        data: {
          workspaceId: generateId(),
          publicationId,
          dispatchVersion: 2,
          operationId: 'operation-A', // Payload is operation-A
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
          nextCheckAt: new Date().toISOString()
        },
        socialAccount: { externalId: 'acc', provider: 'FACEBOOK' },
        post: { content: 'test', media: [] }
      });
      mockPrisma.postPlatformVariant.updateMany.mockResolvedValue({ count: 1 });
      
      mockProviderAdapter.publish.mockResolvedValue({
        success: true,
        processingState: 'PROCESSING'
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
      
      const updateCall = mockPrisma.postPlatformVariant.updateMany.mock.calls[0][0];
      const nextMetadata = updateCall.data.executionMetadata;
      
      expect(nextMetadata.lastCheckedAt).toBe('2026-09-19T10:00:00.000Z');
      expect(nextMetadata.nextCheckAt).toBe('2026-09-19T10:01:00.000Z');
      
      jest.useRealTimers();
    });
  });
});