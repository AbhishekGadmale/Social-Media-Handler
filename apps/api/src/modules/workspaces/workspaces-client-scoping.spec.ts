import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkspacesService } from './services/workspaces.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkspaceRole } from '@agency-os/database';

describe('WorkspacesService Client Scoping', () => {
  let service: WorkspacesService;
  let mockPrisma: any;
  let mockEntitlements: any;
  let mockAudit: any;
  let mockEmailDelivery: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
      },
      workspace: {
        findUnique: vi.fn().mockResolvedValue({ id: 'ws-1', name: 'Test WS' }),
      },
      workspaceMember: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
      },
      workspaceInvitation: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
      },
      client: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(mockPrisma)),
    };

    mockEntitlements = {
      assertSeatLimit: vi.fn().mockResolvedValue(undefined),
    };

    mockAudit = {
      logAction: vi.fn().mockResolvedValue(undefined),
    };

    mockEmailDelivery = {
      sendWorkspaceInvitationEmail: vi.fn().mockResolvedValue(undefined),
    };

    service = new WorkspacesService(
      mockPrisma,
      mockEntitlements,
      mockAudit,
      mockEmailDelivery,
    );
  });

  describe('inviteMember client scoping', () => {
    it('persists clientId on invitation when inviting CLIENT_APPROVER with valid client', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'client-1',
        workspaceId: 'ws-1',
      });
      mockPrisma.workspaceInvitation.create.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-1',
        email: 'client@example.com',
        role: WorkspaceRole.CLIENT_APPROVER,
        clientId: 'client-1',
        expiresAt: new Date(),
        createdAt: new Date(),
      });

      const res = await service.inviteMember(
        'ws-1',
        'owner-1',
        WorkspaceRole.OWNER,
        {
          email: 'client@example.com',
          role: WorkspaceRole.CLIENT_APPROVER,
          clientId: 'client-1',
        },
      );

      expect(mockPrisma.workspaceInvitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientId: 'client-1',
          }),
        }),
      );
      expect(res.clientId).toBe('client-1');
    });

    it('rejects clientId when role is NOT CLIENT_APPROVER with 400 BadRequestException', async () => {
      await expect(
        service.inviteMember('ws-1', 'owner-1', WorkspaceRole.OWNER, {
          email: 'editor@example.com',
          role: WorkspaceRole.EDITOR,
          clientId: 'client-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects with 404 NotFoundException if client does not exist in workspace', async () => {
      mockPrisma.client.findFirst.mockResolvedValue(null);

      await expect(
        service.inviteMember('ws-1', 'owner-1', WorkspaceRole.OWNER, {
          email: 'client@example.com',
          role: WorkspaceRole.CLIENT_APPROVER,
          clientId: 'nonexistent-client',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMemberRole client scoping', () => {
    it('updates clientId when updating CLIENT_APPROVER', async () => {
      mockPrisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-1',
        workspaceId: 'ws-1',
        role: WorkspaceRole.CLIENT_APPROVER,
        clientId: null,
      });
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'client-1',
        workspaceId: 'ws-1',
      });
      mockPrisma.workspaceMember.update.mockResolvedValue({
        id: 'mem-1',
        role: WorkspaceRole.CLIENT_APPROVER,
        clientId: 'client-1',
      });

      const res = await service.updateMemberRole(
        'ws-1',
        'mem-1',
        'owner-1',
        WorkspaceRole.OWNER,
        {
          role: WorkspaceRole.CLIENT_APPROVER,
          clientId: 'client-1',
        },
      );

      expect(mockPrisma.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: 'mem-1' },
        data: {
          role: WorkspaceRole.CLIENT_APPROVER,
          clientId: 'client-1',
        },
      });
      expect(res.clientId).toBe('client-1');
    });

    it('clears clientId when role is changed away from CLIENT_APPROVER', async () => {
      mockPrisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-1',
        workspaceId: 'ws-1',
        role: WorkspaceRole.CLIENT_APPROVER,
        clientId: 'client-1',
      });
      mockPrisma.workspaceMember.update.mockResolvedValue({
        id: 'mem-1',
        role: WorkspaceRole.EDITOR,
        clientId: null,
      });

      await service.updateMemberRole(
        'ws-1',
        'mem-1',
        'owner-1',
        WorkspaceRole.OWNER,
        {
          role: WorkspaceRole.EDITOR,
        },
      );

      expect(mockPrisma.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: 'mem-1' },
        data: {
          role: WorkspaceRole.EDITOR,
          clientId: null,
        },
      });
    });

    it('rejects if clientId is provided when role is non-CLIENT_APPROVER', async () => {
      mockPrisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-1',
        workspaceId: 'ws-1',
        role: WorkspaceRole.CLIENT_APPROVER,
      });

      await expect(
        service.updateMemberRole(
          'ws-1',
          'mem-1',
          'owner-1',
          WorkspaceRole.OWNER,
          {
            role: WorkspaceRole.VIEWER,
            clientId: 'client-1',
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('acceptInvitation client scoping', () => {
    it('copies clientId from invitation to WorkspaceMember', async () => {
      mockPrisma.workspaceInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-1',
        email: 'invited@example.com',
        role: WorkspaceRole.CLIENT_APPROVER,
        clientId: 'client-1',
        expiresAt: new Date(Date.now() + 100000),
        consumedAt: null,
        revokedAt: null,
      });

      mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);

      await service.acceptInvitation(
        'user-1',
        'invited@example.com',
        'raw-token-123',
      );

      expect(mockPrisma.workspaceMember.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: WorkspaceRole.CLIENT_APPROVER,
          clientId: 'client-1',
        }),
      });
    });
  });
});
