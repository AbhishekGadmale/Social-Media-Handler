import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkspaceMembersController } from './workspace-members.controller';
import { WorkspaceRole } from '@agency-os/database';

describe('WorkspaceMembersController', () => {
  let controller: WorkspaceMembersController;
  let workspacesServiceMock: any;

  const mockWorkspaceId = 'ws-test-123';
  const mockUser = { id: 'usr-1', email: 'owner@example.com' };

  beforeEach(() => {
    workspacesServiceMock = {
      inviteMember: vi
        .fn()
        .mockResolvedValue({ id: 'inv-1', email: 'test@example.com' }),
      listMembers: vi.fn().mockResolvedValue({ members: [], invitations: [] }),
      revokeInvitation: vi.fn().mockResolvedValue({ success: true }),
      resendInvitation: vi.fn().mockResolvedValue({ success: true }),
      updateMemberRole: vi
        .fn()
        .mockResolvedValue({ id: 'mem-1', role: WorkspaceRole.MANAGER }),
      removeMember: vi.fn().mockResolvedValue({ success: true }),
    };

    controller = new WorkspaceMembersController(workspacesServiceMock);
  });

  it('delegates inviteMember with caller role and user id', async () => {
    const req = { workspaceRole: WorkspaceRole.OWNER } as any;
    const dto = { email: 'invitee@example.com', role: WorkspaceRole.EDITOR };

    const res = await controller.inviteMember(
      mockWorkspaceId,
      mockUser,
      req,
      dto,
    );

    expect(workspacesServiceMock.inviteMember).toHaveBeenCalledWith(
      mockWorkspaceId,
      mockUser.id,
      WorkspaceRole.OWNER,
      dto,
    );
    expect(res).toEqual({ id: 'inv-1', email: 'test@example.com' });
  });

  it('delegates listMembers with caller role', async () => {
    const req = { workspaceRole: WorkspaceRole.MANAGER } as any;

    await controller.listMembers(mockWorkspaceId, req);

    expect(workspacesServiceMock.listMembers).toHaveBeenCalledWith(
      mockWorkspaceId,
      WorkspaceRole.MANAGER,
    );
  });

  it('delegates revokeInvitation', async () => {
    await controller.revokeInvitation(mockWorkspaceId, 'inv-123', mockUser);

    expect(workspacesServiceMock.revokeInvitation).toHaveBeenCalledWith(
      mockWorkspaceId,
      'inv-123',
      mockUser.id,
    );
  });

  it('delegates resendInvitation', async () => {
    await controller.resendInvitation(mockWorkspaceId, 'inv-123', mockUser);

    expect(workspacesServiceMock.resendInvitation).toHaveBeenCalledWith(
      mockWorkspaceId,
      'inv-123',
      mockUser.id,
    );
  });

  it('delegates updateMemberRole with caller role', async () => {
    const req = { workspaceRole: WorkspaceRole.OWNER } as any;
    const dto = { role: WorkspaceRole.MANAGER };

    await controller.updateMemberRole(
      mockWorkspaceId,
      'mem-123',
      mockUser,
      req,
      dto,
    );

    expect(workspacesServiceMock.updateMemberRole).toHaveBeenCalledWith(
      mockWorkspaceId,
      'mem-123',
      mockUser.id,
      WorkspaceRole.OWNER,
      dto,
    );
  });

  it('delegates removeMember with caller role', async () => {
    const req = { workspaceRole: WorkspaceRole.OWNER } as any;

    await controller.removeMember(mockWorkspaceId, 'mem-123', mockUser, req);

    expect(workspacesServiceMock.removeMember).toHaveBeenCalledWith(
      mockWorkspaceId,
      'mem-123',
      mockUser.id,
      WorkspaceRole.OWNER,
    );
  });
});
