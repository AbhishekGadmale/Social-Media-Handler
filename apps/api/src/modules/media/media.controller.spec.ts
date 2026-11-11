import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { MediaController } from './media.controller';
import { WorkspaceWritableGuard } from '../billing/guards/workspace-writable.guard';

describe('MediaController', () => {
  let controller: MediaController;
  let guard: WorkspaceWritableGuard;
  let mockMediaService: any;
  let entitlementsServiceMock: any;
  let mockReq: any;

  beforeEach(() => {
    mockMediaService = {
      initiateUpload: vi.fn().mockResolvedValue({
        mediaAssetId: 'asset-123',
        uploadUrl: 'https://storage.example.com/upload',
      }),
      completeUpload: vi.fn().mockResolvedValue({
        id: 'asset-123',
        status: 'READY',
      }),
    };

    entitlementsServiceMock = {
      assertWorkspaceWritable: vi.fn(),
    };

    guard = new WorkspaceWritableGuard(entitlementsServiceMock);
    controller = new MediaController(mockMediaService);

    mockReq = {
      user: { id: 'user-123' },
    };
  });

  const createMockContext = (workspaceId?: string) => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          params: { workspaceId },
        }),
      }),
    } as unknown as ExecutionContext;
  };

  const executeGuarded = async <T>(
    workspaceId: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    const ctx = createMockContext(workspaceId);
    await guard.canActivate(ctx);
    return action();
  };

  describe('WorkspaceWritableGuard decoration and enforcement', () => {
    it('decorates initiateUpload and completeUpload with WorkspaceWritableGuard', () => {
      const initiateGuards =
        Reflect.getMetadata(
          '__guards__',
          (MediaController.prototype as any).initiateUpload,
        ) || [];
      const completeGuards =
        Reflect.getMetadata(
          '__guards__',
          (MediaController.prototype as any).completeUpload,
        ) || [];

      expect(initiateGuards).toContain(WorkspaceWritableGuard);
      expect(completeGuards).toContain(WorkspaceWritableGuard);
    });

    it('initiateUpload on a read-only workspace throws ForbiddenException with the exact trial-expired message and MediaService.initiateUpload is NOT called', async () => {
      entitlementsServiceMock.assertWorkspaceWritable.mockRejectedValue(
        new ForbiddenException(
          'Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue.',
        ),
      );

      const dto = {
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        byteSize: 1000,
      };

      await expect(
        executeGuarded('ws-expired', () =>
          controller.initiateUpload('ws-expired', dto as any, mockReq),
        ),
      ).rejects.toThrow(
        new ForbiddenException(
          'Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue.',
        ),
      );

      expect(
        entitlementsServiceMock.assertWorkspaceWritable,
      ).toHaveBeenCalledWith('ws-expired');
      expect(mockMediaService.initiateUpload).not.toHaveBeenCalled();
    });

    it('completeUpload on a read-only workspace throws ForbiddenException with the exact trial-expired message and MediaService.completeUpload is NOT called', async () => {
      entitlementsServiceMock.assertWorkspaceWritable.mockRejectedValue(
        new ForbiddenException(
          'Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue.',
        ),
      );

      await expect(
        executeGuarded('ws-expired', () =>
          controller.completeUpload('ws-expired', 'asset-123', mockReq),
        ),
      ).rejects.toThrow(
        new ForbiddenException(
          'Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue.',
        ),
      );

      expect(
        entitlementsServiceMock.assertWorkspaceWritable,
      ).toHaveBeenCalledWith('ws-expired');
      expect(mockMediaService.completeUpload).not.toHaveBeenCalled();
    });

    it('writable workspace passes through to the service', async () => {
      entitlementsServiceMock.assertWorkspaceWritable.mockResolvedValue(
        undefined,
      );

      const dto = {
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        byteSize: 1000,
      };

      const initiateResult = await executeGuarded('ws-writable', () =>
        controller.initiateUpload('ws-writable', dto as any, mockReq),
      );

      expect(initiateResult).toEqual({
        mediaAssetId: 'asset-123',
        uploadUrl: 'https://storage.example.com/upload',
      });
      expect(mockMediaService.initiateUpload).toHaveBeenCalledWith(
        'ws-writable',
        'user-123',
        dto,
      );

      const completeResult = await executeGuarded('ws-writable', () =>
        controller.completeUpload('ws-writable', 'asset-123', mockReq),
      );

      expect(completeResult).toEqual({
        id: 'asset-123',
        status: 'READY',
      });
      expect(mockMediaService.completeUpload).toHaveBeenCalledWith(
        'ws-writable',
        'asset-123',
        'user-123',
      );
    });
  });
});
