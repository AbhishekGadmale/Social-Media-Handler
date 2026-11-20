import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvitationsController } from './invitations.controller';

describe('InvitationsController', () => {
  let controller: InvitationsController;
  let workspacesServiceMock: any;

  beforeEach(() => {
    workspacesServiceMock = {
      getInvitationInfo: vi.fn().mockResolvedValue({
        workspaceName: 'Acme',
        email: 'user@example.com',
        role: 'EDITOR',
      }),
      acceptInvitation: vi.fn().mockResolvedValue({
        success: true,
        workspaceId: 'ws-123',
      }),
    };

    controller = new InvitationsController(workspacesServiceMock);
  });

  it('delegates getInvitationInfo with token', async () => {
    const res = await controller.getInvitationInfo('raw-token-123');

    expect(workspacesServiceMock.getInvitationInfo).toHaveBeenCalledWith(
      'raw-token-123',
    );
    expect(res).toEqual({
      workspaceName: 'Acme',
      email: 'user@example.com',
      role: 'EDITOR',
    });
  });

  it('delegates acceptInvitation with user info and token', async () => {
    const mockUser = { id: 'usr-1', email: 'user@example.com' };
    const res = await controller.acceptInvitation(mockUser, {
      token: 'raw-token-123',
    });

    expect(workspacesServiceMock.acceptInvitation).toHaveBeenCalledWith(
      'usr-1',
      'user@example.com',
      'raw-token-123',
    );
    expect(res).toEqual({ success: true, workspaceId: 'ws-123' });
  });
});
