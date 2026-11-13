import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PostsController } from './posts.controller';
import { WorkspaceWritableGuard } from '../../billing/guards/workspace-writable.guard';

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
  });
});
