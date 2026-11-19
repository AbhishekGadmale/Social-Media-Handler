import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PostsController } from './posts.controller';
import { WorkspaceWritableGuard } from '../../billing/guards/workspace-writable.guard';
import { PERMISSION_KEY } from '../../auth/decorators/permission.decorator';

describe('PostsController', () => {
  let controller: PostsController;
  let mockPublishingService: any;

  beforeEach(() => {
    mockPublishingService = {
      createDraft: vi.fn(),
      getPosts: vi.fn(),
      getPostById: vi.fn(),
      updateDraft: vi.fn(),
      deletePost: vi.fn(),
      requestApproval: vi.fn(),
      approvePost: vi.fn(),
      requestChanges: vi.fn(),
    };
    controller = new PostsController(mockPublishingService);
  });

  describe('WorkspaceWritableGuard decoration and enforcement', () => {
    it('decorates deletePost with WorkspaceWritableGuard', () => {
      const guards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PostsController.prototype as any).deletePost,
        ) || [];
      expect(guards).toContain(WorkspaceWritableGuard);
    });

    it('preserves WorkspaceWritableGuard on createDraft and updateDraft (regression)', () => {
      const createGuards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PostsController.prototype as any).createDraft,
        ) || [];
      const updateGuards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PostsController.prototype as any).updateDraft,
        ) || [];

      expect(createGuards).toContain(WorkspaceWritableGuard);
      expect(updateGuards).toContain(WorkspaceWritableGuard);
    });

    it('decorates approval routes with WorkspaceWritableGuard', () => {
      const reqApprGuards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PostsController.prototype as any).requestApproval,
        ) || [];
      const approveGuards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PostsController.prototype as any).approvePost,
        ) || [];
      const reqChangesGuards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PostsController.prototype as any).requestChanges,
        ) || [];

      expect(reqApprGuards).toContain(WorkspaceWritableGuard);
      expect(approveGuards).toContain(WorkspaceWritableGuard);
      expect(reqChangesGuards).toContain(WorkspaceWritableGuard);
    });
  });

  describe('Permission Requirements', () => {
    it('requires posts.update for requestApproval', () => {
      const permission = Reflect.getMetadata(
        PERMISSION_KEY,
        (PostsController.prototype as any).requestApproval,
      );
      expect(permission).toBe('posts.update');
    });

    it('requires posts.approve for approvePost and requestChanges', () => {
      const approvePerm = Reflect.getMetadata(
        PERMISSION_KEY,
        (PostsController.prototype as any).approvePost,
      );
      const changesPerm = Reflect.getMetadata(
        PERMISSION_KEY,
        (PostsController.prototype as any).requestChanges,
      );
      expect(approvePerm).toBe('posts.approve');
      expect(changesPerm).toBe('posts.approve');
    });
  });

  describe('Approval Endpoint Delegations', () => {
    it('delegates requestApproval to publishingService', async () => {
      mockPublishingService.requestApproval.mockResolvedValueOnce({
        id: 'p1',
        approvalStatus: 'PENDING',
      });

      const res = await controller.requestApproval('ws-1', { id: 'u-1' }, 'p1');

      expect(mockPublishingService.requestApproval).toHaveBeenCalledWith(
        'ws-1',
        'u-1',
        'p1',
      );
      expect(res).toEqual({ id: 'p1', approvalStatus: 'PENDING' });
    });

    it('delegates approvePost to publishingService', async () => {
      mockPublishingService.approvePost.mockResolvedValueOnce({
        id: 'p1',
        approvalStatus: 'APPROVED',
      });

      const res = await controller.approvePost('ws-1', { id: 'u-1' }, 'p1');

      expect(mockPublishingService.approvePost).toHaveBeenCalledWith(
        'ws-1',
        'u-1',
        'p1',
      );
      expect(res).toEqual({ id: 'p1', approvalStatus: 'APPROVED' });
    });

    it('delegates requestChanges to publishingService with comment', async () => {
      mockPublishingService.requestChanges.mockResolvedValueOnce({
        id: 'p1',
        approvalStatus: 'CHANGES_REQUESTED',
      });

      const res = await controller.requestChanges('ws-1', { id: 'u-1' }, 'p1', {
        comment: 'Please refine text',
      });

      expect(mockPublishingService.requestChanges).toHaveBeenCalledWith(
        'ws-1',
        'u-1',
        'p1',
        'Please refine text',
      );
      expect(res).toEqual({ id: 'p1', approvalStatus: 'CHANGES_REQUESTED' });
    });
  });
});
