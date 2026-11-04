import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceGuard } from './workspace.guard';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { WorkspaceRole } from '@agency-os/database';

describe('WorkspaceGuard (Unverified Account Gating)', () => {
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
  });

  it('rejects with 403 Forbidden when user is unverified (emailVerified: false)', async () => {
    const user = { id: 'user-unverified', emailVerified: false };
    const { context } = createMockContext(user, 'ws-123');

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException(
        'Email verification required to access workspaces',
      ),
    );

    // Assert database membership lookup is never reached
    expect(memberRepoMock.findByWorkspaceAndUserId).not.toHaveBeenCalled();
  });

  it('rejects with 403 Forbidden when user is not attached to request', async () => {
    const { context } = createMockContext(undefined, 'ws-123');

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('User not authenticated'),
    );
  });

  it('rejects with 403 Forbidden when user is verified but not a member of the requested workspace', async () => {
    const user = { id: 'user-1', emailVerified: true };
    const { context } = createMockContext(user, 'ws-other');

    memberRepoMock.findByWorkspaceAndUserId.mockResolvedValueOnce(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('User is not a member of this workspace'),
    );
  });

  it('returns true if no workspaceId param exists on route and user is verified', async () => {
    const user = { id: 'user-1', emailVerified: true };
    const { context } = createMockContext(user);

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(memberRepoMock.findByWorkspaceAndUserId).not.toHaveBeenCalled();
  });
});
