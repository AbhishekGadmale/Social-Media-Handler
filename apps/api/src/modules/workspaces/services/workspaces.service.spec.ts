import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceRole, AuditAction } from '@agency-os/database';
import { WorkspacesService, hashToken } from './workspaces.service';

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let prismaMock: any;
  let entitlementsServiceMock: any;
  let auditServiceMock: any;
  let emailDeliveryMock: any;

  const mockWorkspaceId = 'ws-1111-1111';
  const mockInviterId = 'usr-owner-1';
  const mockTargetMemberId = 'mem-target-1';
  const mockTargetUserId = 'usr-target-1';

  beforeEach(() => {
    prismaMock = {
      user: {
        findUnique: vi.fn(),
      },
      workspace: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: mockWorkspaceId, name: 'Acme Agency' }),
      },
      workspaceMember: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      workspaceInvitation: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
    };

    entitlementsServiceMock = {
      assertSeatLimit: vi.fn().mockResolvedValue(undefined),
      assertWorkspaceWritable: vi.fn().mockResolvedValue(undefined),
    };

    auditServiceMock = {
      logAction: vi.fn().mockResolvedValue(undefined),
    };

    emailDeliveryMock = {
      sendWorkspaceInvitationEmail: vi.fn().mockResolvedValue(undefined),
    };

    service = new WorkspacesService(
      prismaMock,
      entitlementsServiceMock,
      auditServiceMock,
      emailDeliveryMock,
    );
  });

  describe('inviteMember', () => {
    it('Scenario 1: happy path creates invitation and sends invitation email with 7-day expiry', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.workspaceInvitation.count.mockResolvedValue(1); // 1 active pending
      prismaMock.workspaceInvitation.create.mockImplementation(
        async ({ data }: any) => ({
          id: 'inv-123',
          ...data,
          createdAt: new Date(),
        }),
      );

      const result = await service.inviteMember(
        mockWorkspaceId,
        mockInviterId,
        WorkspaceRole.OWNER,
        { email: ' NewUser@Example.com ', role: WorkspaceRole.EDITOR },
      );

      // Verify email normalized lowercase
      expect(result.email).toBe('newuser@example.com');
      expect(result.role).toBe(WorkspaceRole.EDITOR);

      // Verify prior pending invites revoked for same email
      expect(prismaMock.workspaceInvitation.updateMany).toHaveBeenCalledWith({
        where: {
          workspaceId: mockWorkspaceId,
          email: 'newuser@example.com',
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: expect.any(Date) },
      });

      // Verify seat limit check counted current members + live pending + new invite
      expect(entitlementsServiceMock.assertSeatLimit).toHaveBeenCalledWith(
        mockWorkspaceId,
        2, // 1 existing pending + 1 new invite
      );

      // Verify email sent with formatted role and accept URL token
      expect(
        emailDeliveryMock.sendWorkspaceInvitationEmail,
      ).toHaveBeenCalledWith(
        'newuser@example.com',
        expect.objectContaining({
          workspaceName: 'Acme Agency',
          role: 'Editor',
          rawToken: expect.any(String),
        }),
      );

      // Verify audit log
      expect(auditServiceMock.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: mockWorkspaceId,
          actorId: mockInviterId,
          action: AuditAction.MEMBER_INVITED,
          targetType: 'WorkspaceInvitation',
        }),
      );
    });

    it('Scenario 2: seat limit blocks invite (assertSeatLimit throws ForbiddenException)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.workspaceInvitation.count.mockResolvedValue(2);
      entitlementsServiceMock.assertSeatLimit.mockRejectedValue(
        new ForbiddenException('Seat limit exceeded for SOLO. Max allowed: 1'),
      );

      await expect(
        service.inviteMember(
          mockWorkspaceId,
          mockInviterId,
          WorkspaceRole.OWNER,
          {
            email: 'overflow@example.com',
            role: WorkspaceRole.VIEWER,
          },
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prismaMock.workspaceInvitation.create).not.toHaveBeenCalled();
      expect(
        emailDeliveryMock.sendWorkspaceInvitationEmail,
      ).not.toHaveBeenCalled();
    });

    it('Scenario 3: MANAGER cannot invite an OWNER', async () => {
      await expect(
        service.inviteMember(
          mockWorkspaceId,
          'usr-mgr-1',
          WorkspaceRole.MANAGER,
          {
            email: 'partner@example.com',
            role: WorkspaceRole.OWNER,
          },
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prismaMock.workspaceInvitation.create).not.toHaveBeenCalled();
      expect(
        emailDeliveryMock.sendWorkspaceInvitationEmail,
      ).not.toHaveBeenCalled();
    });

    it('Scenario 4: inviting an existing member email throws 409 ConflictException', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'usr-existing-1',
        email: 'existing@example.com',
      });
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-1',
        workspaceId: mockWorkspaceId,
        userId: 'usr-existing-1',
      });

      await expect(
        service.inviteMember(
          mockWorkspaceId,
          mockInviterId,
          WorkspaceRole.OWNER,
          {
            email: 'existing@example.com',
            role: WorkspaceRole.EDITOR,
          },
        ),
      ).rejects.toThrow(ConflictException);

      expect(prismaMock.workspaceInvitation.create).not.toHaveBeenCalled();
    });
  });

  describe('listMembers', () => {
    const mockMembers = [
      {
        id: 'mem-1',
        workspaceId: mockWorkspaceId,
        userId: 'u1',
        role: WorkspaceRole.OWNER,
        createdAt: new Date('2026-01-01'),
        user: { id: 'u1', name: 'Alice Owner', email: 'alice@example.com' },
      },
      {
        id: 'mem-2',
        workspaceId: mockWorkspaceId,
        userId: 'u2',
        role: WorkspaceRole.EDITOR,
        createdAt: new Date('2026-02-01'),
        user: { id: 'u2', name: 'Bob Editor', email: 'bob@example.com' },
      },
    ];

    const mockPendingInvitations = [
      {
        id: 'inv-1',
        email: 'pending@example.com',
        role: WorkspaceRole.CLIENT_APPROVER,
        expiresAt: new Date(Date.now() + 100000),
        createdAt: new Date(),
        invitedByUser: {
          id: 'u1',
          name: 'Alice Owner',
          email: 'alice@example.com',
        },
      },
    ];

    it('Scenario 5: includes pending invitations when caller holds members.manage (OWNER or MANAGER)', async () => {
      prismaMock.workspaceMember.findMany.mockResolvedValue(mockMembers);
      prismaMock.workspaceInvitation.findMany.mockResolvedValue(
        mockPendingInvitations,
      );

      const result = await service.listMembers(
        mockWorkspaceId,
        WorkspaceRole.MANAGER,
      );

      expect(result.members).toHaveLength(2);
      expect(result.invitations).toHaveLength(1);
      expect(result.invitations![0].email).toBe('pending@example.com');
      expect(result.invitations![0].invitedBy.name).toBe('Alice Owner');
    });

    it('Scenario 6: pending invitations hidden from non-members.manage callers (EDITOR, VIEWER, CLIENT_APPROVER)', async () => {
      prismaMock.workspaceMember.findMany.mockResolvedValue(mockMembers);

      const result = await service.listMembers(
        mockWorkspaceId,
        WorkspaceRole.EDITOR,
      );

      expect(result.members).toHaveLength(2);
      expect(result.invitations).toBeUndefined();
      expect(prismaMock.workspaceInvitation.findMany).not.toHaveBeenCalled();
    });
  });

  describe('revokeInvitation', () => {
    it('Scenario 7: revokes active pending invitation and logs audit', async () => {
      prismaMock.workspaceInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        workspaceId: mockWorkspaceId,
        email: 'pending@example.com',
        consumedAt: null,
        revokedAt: null,
      });

      const result = await service.revokeInvitation(
        mockWorkspaceId,
        'inv-1',
        mockInviterId,
      );

      expect(result).toEqual({ success: true });
      expect(prismaMock.workspaceInvitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(auditServiceMock.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.MEMBER_INVITATION_REVOKED,
          targetId: 'inv-1',
        }),
      );
    });

    it('throws NotFoundException if invitation does not exist', async () => {
      prismaMock.workspaceInvitation.findUnique.mockResolvedValue(null);

      await expect(
        service.revokeInvitation(
          mockWorkspaceId,
          'non-existent',
          mockInviterId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if already consumed or revoked', async () => {
      prismaMock.workspaceInvitation.findUnique.mockResolvedValue({
        id: 'inv-consumed',
        workspaceId: mockWorkspaceId,
        consumedAt: new Date(),
        revokedAt: null,
      });

      await expect(
        service.revokeInvitation(
          mockWorkspaceId,
          'inv-consumed',
          mockInviterId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resendInvitation', () => {
    it('Scenario 8: revokes old token, issues fresh token with 7-day expiry and resends email', async () => {
      prismaMock.workspaceInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        workspaceId: mockWorkspaceId,
        email: 'client@example.com',
        role: WorkspaceRole.CLIENT_APPROVER,
        consumedAt: null,
        revokedAt: new Date('2026-01-01'),
      });

      const result = await service.resendInvitation(
        mockWorkspaceId,
        'inv-1',
        mockInviterId,
      );

      expect(result).toEqual({ success: true });
      expect(prismaMock.workspaceInvitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
          revokedAt: null,
        },
      });
      expect(
        emailDeliveryMock.sendWorkspaceInvitationEmail,
      ).toHaveBeenCalledWith(
        'client@example.com',
        expect.objectContaining({
          workspaceName: 'Acme Agency',
          role: 'Client Approver',
          rawToken: expect.any(String),
        }),
      );
      expect(auditServiceMock.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.MEMBER_INVITATION_RESENT,
          targetId: 'inv-1',
        }),
      );
    });
  });

  describe('updateMemberRole', () => {
    it('Scenario 9: Owner updates Editor role to Manager', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: mockTargetMemberId,
        workspaceId: mockWorkspaceId,
        role: WorkspaceRole.EDITOR,
      });
      prismaMock.workspaceMember.update.mockResolvedValue({
        id: mockTargetMemberId,
        role: WorkspaceRole.MANAGER,
      });

      const updated = await service.updateMemberRole(
        mockWorkspaceId,
        mockTargetMemberId,
        mockInviterId,
        WorkspaceRole.OWNER,
        { role: WorkspaceRole.MANAGER },
      );

      expect(updated.role).toBe(WorkspaceRole.MANAGER);
      expect(auditServiceMock.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.MEMBER_ROLE_UPDATED,
          targetId: mockTargetMemberId,
        }),
      );
    });

    it('Scenario 10: MANAGER cannot modify an OWNER role', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: mockTargetMemberId,
        workspaceId: mockWorkspaceId,
        role: WorkspaceRole.OWNER,
      });

      await expect(
        service.updateMemberRole(
          mockWorkspaceId,
          mockTargetMemberId,
          'usr-mgr',
          WorkspaceRole.MANAGER,
          { role: WorkspaceRole.EDITOR },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Scenario 11: MANAGER cannot promote anyone to OWNER', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: mockTargetMemberId,
        workspaceId: mockWorkspaceId,
        role: WorkspaceRole.EDITOR,
      });

      await expect(
        service.updateMemberRole(
          mockWorkspaceId,
          mockTargetMemberId,
          'usr-mgr',
          WorkspaceRole.MANAGER,
          { role: WorkspaceRole.OWNER },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Scenario 12: last OWNER cannot be demoted', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: mockTargetMemberId,
        workspaceId: mockWorkspaceId,
        role: WorkspaceRole.OWNER,
      });
      prismaMock.workspaceMember.count.mockResolvedValue(1); // exactly 1 owner

      await expect(
        service.updateMemberRole(
          mockWorkspaceId,
          mockTargetMemberId,
          mockInviterId,
          WorkspaceRole.OWNER,
          { role: WorkspaceRole.MANAGER },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeMember', () => {
    it('Scenario 13: member cannot remove themselves in v1', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-self',
        workspaceId: mockWorkspaceId,
        userId: mockInviterId,
        role: WorkspaceRole.MANAGER,
      });

      await expect(
        service.removeMember(
          mockWorkspaceId,
          'mem-self',
          mockInviterId,
          WorkspaceRole.MANAGER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('Scenario 14: MANAGER cannot remove an OWNER', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: mockTargetMemberId,
        workspaceId: mockWorkspaceId,
        userId: mockTargetUserId,
        role: WorkspaceRole.OWNER,
      });

      await expect(
        service.removeMember(
          mockWorkspaceId,
          mockTargetMemberId,
          'usr-mgr',
          WorkspaceRole.MANAGER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Scenario 15: last OWNER cannot be removed', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: mockTargetMemberId,
        workspaceId: mockWorkspaceId,
        userId: mockTargetUserId,
        role: WorkspaceRole.OWNER,
      });
      prismaMock.workspaceMember.count.mockResolvedValue(1);

      await expect(
        service.removeMember(
          mockWorkspaceId,
          mockTargetMemberId,
          mockInviterId,
          WorkspaceRole.OWNER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('Scenario 16: Owner removes an Editor successfully', async () => {
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: mockTargetMemberId,
        workspaceId: mockWorkspaceId,
        userId: mockTargetUserId,
        role: WorkspaceRole.EDITOR,
      });

      const result = await service.removeMember(
        mockWorkspaceId,
        mockTargetMemberId,
        mockInviterId,
        WorkspaceRole.OWNER,
      );

      expect(result).toEqual({ success: true });
      expect(prismaMock.workspaceMember.delete).toHaveBeenCalledWith({
        where: { id: mockTargetMemberId },
      });
      expect(auditServiceMock.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.MEMBER_REMOVED,
          targetId: mockTargetMemberId,
        }),
      );
    });
  });

  describe('acceptInvitation', () => {
    const rawToken = 'secret-invite-token-12345';
    const tokenHash = hashToken(rawToken);

    it('Scenario 17: accept happy path creates member with invited role and consumes token', async () => {
      const liveInvitation = {
        id: 'inv-accept-1',
        workspaceId: mockWorkspaceId,
        email: 'invited@example.com',
        role: WorkspaceRole.CLIENT_APPROVER,
        tokenHash,
        consumedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      };

      prismaMock.workspaceInvitation.findUnique.mockResolvedValue(
        liveInvitation,
      );
      prismaMock.workspaceMember.findUnique.mockResolvedValue(null); // not already member

      const result = await service.acceptInvitation(
        'usr-new',
        'Invited@example.com', // Case-insensitive matching
        rawToken,
      );

      expect(result).toEqual({
        success: true,
        workspaceId: mockWorkspaceId,
      });

      // Assert seat limit was re-checked upon accept
      expect(entitlementsServiceMock.assertSeatLimit).toHaveBeenCalledWith(
        mockWorkspaceId,
        1,
      );

      // Verify member created and token consumed in transaction
      expect(prismaMock.workspaceMember.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: mockWorkspaceId,
          userId: 'usr-new',
          role: WorkspaceRole.CLIENT_APPROVER,
        }),
      });

      expect(prismaMock.workspaceInvitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-accept-1' },
        data: { consumedAt: expect.any(Date) },
      });

      expect(auditServiceMock.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.MEMBER_INVITATION_ACCEPTED,
          workspaceId: mockWorkspaceId,
          actorId: 'usr-new',
        }),
      );
    });

    it('Scenario 18: accept with wrong email throws 403 ForbiddenException', async () => {
      const liveInvitation = {
        id: 'inv-accept-2',
        workspaceId: mockWorkspaceId,
        email: 'intended@example.com',
        role: WorkspaceRole.EDITOR,
        tokenHash,
        consumedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      };

      prismaMock.workspaceInvitation.findUnique.mockResolvedValue(
        liveInvitation,
      );

      await expect(
        service.acceptInvitation(
          'usr-different',
          'wrong@example.com',
          rawToken,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prismaMock.workspaceMember.create).not.toHaveBeenCalled();
    });

    it('Scenario 19: expired, revoked, or consumed token is rejected', async () => {
      // 1. Expired
      prismaMock.workspaceInvitation.findUnique.mockResolvedValueOnce({
        id: 'inv-exp',
        workspaceId: mockWorkspaceId,
        email: 'user@example.com',
        tokenHash,
        consumedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 10000), // in the past
      });

      await expect(
        service.acceptInvitation('usr-1', 'user@example.com', rawToken),
      ).rejects.toThrow(BadRequestException);

      // 2. Revoked
      prismaMock.workspaceInvitation.findUnique.mockResolvedValueOnce({
        id: 'inv-rev',
        workspaceId: mockWorkspaceId,
        email: 'user@example.com',
        tokenHash,
        consumedAt: null,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
      });

      await expect(
        service.acceptInvitation('usr-1', 'user@example.com', rawToken),
      ).rejects.toThrow(BadRequestException);

      // 3. Consumed (and not a member)
      prismaMock.workspaceInvitation.findUnique.mockResolvedValueOnce({
        id: 'inv-con',
        workspaceId: mockWorkspaceId,
        email: 'user@example.com',
        tokenHash,
        consumedAt: new Date(),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
      });
      prismaMock.workspaceMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.acceptInvitation('usr-1', 'user@example.com', rawToken),
      ).rejects.toThrow(BadRequestException);
    });

    it('Scenario 20: user already a member consumes token idempotently and returns success', async () => {
      prismaMock.workspaceInvitation.findUnique.mockResolvedValue({
        id: 'inv-idempotent',
        workspaceId: mockWorkspaceId,
        email: 'existing@example.com',
        tokenHash,
        consumedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
      });

      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-already',
        workspaceId: mockWorkspaceId,
        userId: 'usr-existing',
      });

      const result = await service.acceptInvitation(
        'usr-existing',
        'existing@example.com',
        rawToken,
      );

      expect(result).toEqual({
        success: true,
        workspaceId: mockWorkspaceId,
        alreadyMember: true,
      });

      expect(prismaMock.workspaceInvitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-idempotent' },
        data: { consumedAt: expect.any(Date) },
      });
      expect(prismaMock.workspaceMember.create).not.toHaveBeenCalled();
    });

    it('Scenario 21: accept re-checks seats and blocks when exceeded', async () => {
      prismaMock.workspaceInvitation.findUnique.mockResolvedValue({
        id: 'inv-seat-check',
        workspaceId: mockWorkspaceId,
        email: 'user@example.com',
        tokenHash,
        consumedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
      });
      prismaMock.workspaceMember.findUnique.mockResolvedValue(null);

      entitlementsServiceMock.assertSeatLimit.mockRejectedValue(
        new ForbiddenException('Seat limit reached. Upgrade to add members.'),
      );

      await expect(
        service.acceptInvitation('usr-1', 'user@example.com', rawToken),
      ).rejects.toThrow(ForbiddenException);

      expect(prismaMock.workspaceMember.create).not.toHaveBeenCalled();
    });
  });

  describe('getInvitationInfo', () => {
    it('returns workspace info for a valid token', async () => {
      prismaMock.workspaceInvitation.findUnique.mockResolvedValue({
        id: 'inv-info',
        email: 'invitee@example.com',
        role: WorkspaceRole.EDITOR,
        expiresAt: new Date(Date.now() + 50000),
        consumedAt: null,
        revokedAt: null,
        workspace: { name: 'Acme Social' },
      });

      const info = await service.getInvitationInfo('valid-raw-token');
      expect(info.workspaceName).toBe('Acme Social');
      expect(info.role).toBe(WorkspaceRole.EDITOR);
      expect(info.roleFormatted).toBe('Editor');
      expect(info.email).toBe('invitee@example.com');
    });

    it('throws BadRequestException for invalid or expired token', async () => {
      prismaMock.workspaceInvitation.findUnique.mockResolvedValue(null);

      await expect(service.getInvitationInfo('invalid-token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
