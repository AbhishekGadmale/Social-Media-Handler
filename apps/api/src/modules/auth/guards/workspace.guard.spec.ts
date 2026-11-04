import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceGuard } from './workspace.guard';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { WorkspaceRole } from '@agency-os/database';

describe('WorkspaceGuard (Option A: Email Verification Enforcement Deferred to PR #50)', () => {
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

  it('allows access when user is authenticated, emailVerified is false, and user is workspace member (Option A)', async () => {
    const user = { id: 'user-unverified', emailVerified: false };
    const { context, request } = createMockContext(user, 'ws-123');

    memberRepoMock.findByWorkspaceAndUserId.mockResolvedValueOnce({
      id: 'member-1',
      workspaceId: 'ws-123',
      userId: 'user-unverified',
      role: WorkspaceRole.OWNER,
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.workspaceRole).toBe(WorkspaceRole.OWNER);
    expect(memberRepoMock.findByWorkspaceAndUserId).toHaveBeenCalledWith(
      'ws-123',
      'user-unverified',
    );
  });

  it('allows access when user is authenticated, emailVerified is true, and user is workspace member', async () => {
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

  it('rejects with 403 Forbidden when user is not a member of the requested workspace (tenant isolation)', async () => {
    const user = { id: 'user-unverified', emailVerified: false };
    const { context } = createMockContext(user, 'ws-other');

    memberRepoMock.findByWorkspaceAndUserId.mockResolvedValueOnce(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('User is not a member of this workspace'),
    );
  });

  it('returns true if no workspaceId param exists on route', async () => {
    const user = { id: 'user-unverified', emailVerified: false };
    const { context } = createMockContext(user);

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(memberRepoMock.findByWorkspaceAndUserId).not.toHaveBeenCalled();
  });
});
