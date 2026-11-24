import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaAssetStatus } from '@agency-os/database';

describe('MediaService.getPreviewUrl', () => {
  let service: MediaService;
  let mockStorage: any;
  let mockPrisma: any;
  let mockAudit: any;
  let mockLogger: any;

  beforeEach(() => {
    mockStorage = {
      createUpload: vi.fn(),
      headObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      getSignedReadUrl: vi
        .fn()
        .mockResolvedValue('https://storage.example.com/signed-read-url'),
    };

    mockPrisma = {
      mediaAsset: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
    };

    mockAudit = {
      logActionBestEffort: vi.fn(),
    };

    mockLogger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    service = new MediaService(mockStorage, mockPrisma, mockAudit, mockLogger);
  });

  it('happy path: returns signed URL and expiresAt for a READY asset with 10-minute TTL', async () => {
    const asset = {
      id: 'asset-123',
      workspaceId: 'ws-123',
      status: MediaAssetStatus.READY,
      storageKey: 'workspaces/ws-123/media/asset-123/source',
    };
    mockPrisma.mediaAsset.findFirst.mockResolvedValue(asset);

    const result = await service.getPreviewUrl('ws-123', 'asset-123');

    expect(mockPrisma.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: { id: 'asset-123', workspaceId: 'ws-123' },
    });
    expect(mockStorage.getSignedReadUrl).toHaveBeenCalledWith(
      'workspaces/ws-123/media/asset-123/source',
      600,
    );
    expect(result.url).toBe('https://storage.example.com/signed-read-url');
    expect(result.expiresAt).toBeInstanceOf(Date);
    // expiresAt should be approximately 10 minutes (600s) from now
    const now = Date.now();
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(now + 590 * 1000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(now + 610 * 1000);
  });

  it('cross-workspace or unknown asset id throws NotFoundException', async () => {
    mockPrisma.mediaAsset.findFirst.mockResolvedValue(null);

    await expect(
      service.getPreviewUrl('ws-other', 'asset-123'),
    ).rejects.toThrow(
      new NotFoundException('Media asset not found in this workspace'),
    );
    expect(mockStorage.getSignedReadUrl).not.toHaveBeenCalled();
  });

  it('non-READY asset (UPLOADING) throws ConflictException', async () => {
    const asset = {
      id: 'asset-123',
      workspaceId: 'ws-123',
      status: MediaAssetStatus.UPLOADING,
      storageKey: 'workspaces/ws-123/media/uploads/asset-123',
    };
    mockPrisma.mediaAsset.findFirst.mockResolvedValue(asset);

    await expect(service.getPreviewUrl('ws-123', 'asset-123')).rejects.toThrow(
      ConflictException,
    );
    expect(mockStorage.getSignedReadUrl).not.toHaveBeenCalled();
  });

  it('non-READY asset (PROCESSING) throws ConflictException', async () => {
    const asset = {
      id: 'asset-123',
      workspaceId: 'ws-123',
      status: MediaAssetStatus.PROCESSING,
      storageKey: 'workspaces/ws-123/media/uploads/asset-123',
    };
    mockPrisma.mediaAsset.findFirst.mockResolvedValue(asset);

    await expect(service.getPreviewUrl('ws-123', 'asset-123')).rejects.toThrow(
      ConflictException,
    );
  });

  it('non-READY asset (FAILED) throws ConflictException', async () => {
    const asset = {
      id: 'asset-123',
      workspaceId: 'ws-123',
      status: MediaAssetStatus.FAILED,
      storageKey: 'workspaces/ws-123/media/uploads/asset-123',
    };
    mockPrisma.mediaAsset.findFirst.mockResolvedValue(asset);

    await expect(service.getPreviewUrl('ws-123', 'asset-123')).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws InternalServerErrorException if storage lacks getSignedReadUrl capability', async () => {
    const asset = {
      id: 'asset-123',
      workspaceId: 'ws-123',
      status: MediaAssetStatus.READY,
      storageKey: 'workspaces/ws-123/media/asset-123/source',
    };
    mockPrisma.mediaAsset.findFirst.mockResolvedValue(asset);
    delete mockStorage.getSignedReadUrl;

    await expect(service.getPreviewUrl('ws-123', 'asset-123')).rejects.toThrow(
      new InternalServerErrorException(
        'Storage provider does not support signed read URLs',
      ),
    );
  });
});
