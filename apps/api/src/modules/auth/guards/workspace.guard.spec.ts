import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceGuard } from './workspace.guard';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { WorkspaceRole } from '@agency-os/database';

describe('WorkspaceGuard (403 Enforcement for Unverified Users Restored in PR #51)', () => {
  let guard: WorkspaceGuard;
  let memberRepoMock: {
    findByWorkspaceAndUserId: any;
  };

  const createMockContext = (
    user?: any,
    workspaceId?: string,
  ): { context: ExecutionContext; request: any } => {
    const request: any = {
      user,
      params: {
        ...(workspaceId ? { workspaceId } : {}),
      },
    };
    const context: any = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    };
    return { context, request };
  };

  beforeEach(() => {
    memberRepoMock = {
      findByWorkspaceAndUserId: vi.fn(),
    };
    guard = new WorkspaceGuard(memberRepoMock as any);
  });

  it('rejects with 403 Forbidden when user email is not verified', async () => {
    const user = { id: 'user-1', emailVerified: false };
    const { context } = createMockContext(user, 'ws-123');

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException(
        'Email verification required to access workspaces',
      ),
    );
    expect(memberRepoMock.findByWorkspaceAndUserId).not.toHaveBeenCalled();
  });

  it('allows access when user is authenticated, email is verified, and user is workspace member', async () => {
    const user = { id: 'user-1', emailVerified: true };
    const { context, request } = createMockContext(user, 'ws-123');

    memberRepoMock.findByWorkspaceAndUserId.mockResolvedValueOnce({
      id: 'member-1',
      workspaceId: 'ws-123',
      userId: 'user-1',
      role: WorkspaceRole.OWNER,
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.workspaceRole).toBe(WorkspaceRole.OWNER);
    expect(memberRepoMock.findByWorkspaceAndUserId).toHaveBeenCalledWith(
      'ws-123',
      'user-1',
    );
  });

  it('rejects with 403 Forbidden when user is not attached to request', async () => {
    const { context } = createMockContext(undefined, 'ws-123');

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('User not authenticated'),
    );
  });

  it('rejects with 403 Forbidden when verified user is not a member of the requested workspace (tenant isolation)', async () => {
    const user = { id: 'user-1', emailVerified: true };
    const { context } = createMockContext(user, 'ws-other');

    memberRepoMock.findByWorkspaceAndUserId.mockResolvedValueOnce(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('User is not a member of this workspace'),
    );
  });

  it('rejects unverified user even if no workspaceId param exists on route', async () => {
    const user = { id: 'user-unverified', emailVerified: false };
    const { context } = createMockContext(user);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException(
        'Email verification required to access workspaces',
      ),
    );
  });

  it('returns true if email is verified and no workspaceId param exists on route', async () => {
    const user = { id: 'user-verified', emailVerified: true };
    const { context } = createMockContext(user);

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });
});
