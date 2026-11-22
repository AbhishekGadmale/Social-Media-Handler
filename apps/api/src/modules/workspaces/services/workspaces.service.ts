import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import {
  PrismaClient,
  WorkspaceRole,
  AuditAction,
  generateId,
} from '@agency-os/database';
import { EntitlementsService } from '../../billing/entitlements.service';
import {
  EMAIL_DELIVERY_SERVICE,
  type EmailDeliveryService,
} from '../../auth/email-delivery.service';
import { AuditService } from '../../core/audit.service';
import { CreateInvitationDto } from '../dto/create-invitation.dto';
import { UpdateMemberRoleDto } from '../dto/update-member-role.dto';

export function formatRoleName(role: WorkspaceRole): string {
  switch (role) {
    case WorkspaceRole.OWNER:
      return 'Owner';
    case WorkspaceRole.MANAGER:
      return 'Manager';
    case WorkspaceRole.EDITOR:
      return 'Editor';
    case WorkspaceRole.CLIENT_APPROVER:
      return 'Client Approver';
    case WorkspaceRole.VIEWER:
      return 'Viewer';
    default:
      return role;
  }
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateRawToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly entitlementsService: EntitlementsService,
    private readonly audit: AuditService,
    @Inject(EMAIL_DELIVERY_SERVICE)
    private readonly emailDelivery: EmailDeliveryService,
  ) {}

  /**
   * Invites a new member to the workspace via email.
   * Enforces role hierarchy (Managers cannot invite Owners), duplicate membership checks,
   * seat capacity checks, and revokes prior pending invitations for the same email.
   */
  async inviteMember(
    workspaceId: string,
    inviterUserId: string,
    inviterRole: string,
    dto: CreateInvitationDto,
  ) {
    const email = dto.email.trim().toLowerCase();

    // 1. Role hierarchy check: Manager cannot grant Owner role
    if (
      inviterRole === WorkspaceRole.MANAGER &&
      dto.role === WorkspaceRole.OWNER
    ) {
      throw new ForbiddenException('Managers cannot invite an Owner');
    }

    if (dto.clientId) {
      if (dto.role !== WorkspaceRole.CLIENT_APPROVER) {
        throw new BadRequestException(
          'Only client approvers can be scoped to a client',
        );
      }
      const client = await this.prisma.client.findFirst({
        where: { id: dto.clientId, workspaceId },
      });
      if (!client) {
        throw new NotFoundException('Client not found');
      }
    }

    // 2. Existing member check
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      const existingMembership = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: existingUser.id,
          },
        },
      });
      if (existingMembership) {
        throw new ConflictException(
          'User is already a member of this workspace',
        );
      }
    }

    // 3. Revoke existing pending invitations for this email in this workspace
    await this.prisma.workspaceInvitation.updateMany({
      where: {
        workspaceId,
        email,
        consumedAt: null,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    // 4. Seat limit check counting current members + live pending invitations
    const livePendingCount = await this.prisma.workspaceInvitation.count({
      where: {
        workspaceId,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    await this.entitlementsService.assertSeatLimit(
      workspaceId,
      livePendingCount + 1,
    );

    // 5. Generate secure token & expiry (7 days)
    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });
    const workspaceName = workspace?.name || 'Workspace';

    // 6. Persist invitation
    const invitation = await this.prisma.workspaceInvitation.create({
      data: {
        id: generateId(),
        workspaceId,
        email,
        role: dto.role,
        clientId: dto.clientId || null,
        invitedByUserId: inviterUserId,
        tokenHash,
        expiresAt,
      },
    });

    // 7. Send invitation email
    await this.emailDelivery.sendWorkspaceInvitationEmail(email, {
      workspaceName,
      role: formatRoleName(dto.role),
      rawToken,
    });

    // 8. Audit log (never log raw token)
    await this.audit.logAction({
      workspaceId,
      actorId: inviterUserId,
      action: AuditAction.MEMBER_INVITED,
      targetType: 'WorkspaceInvitation',
      targetId: invitation.id,
      metadata: { email, role: dto.role, clientId: invitation.clientId },
    });

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      clientId: invitation.clientId,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    };
  }

  /**
   * Lists workspace members and optionally pending invitations (if caller holds members.manage).
   */
  async listMembers(workspaceId: string, callerRole: string) {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        client: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const formattedMembers = members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      clientId: m.clientId ?? null,
      clientName: m.client?.name ?? null,
      joinedAt: m.createdAt,
    }));

    const canManageMembers =
      callerRole === WorkspaceRole.OWNER ||
      callerRole === WorkspaceRole.MANAGER;

    if (!canManageMembers) {
      return { members: formattedMembers };
    }

    const clientModel = (this.prisma as any).client;
    const [invitations, clients] = await Promise.all([
      this.prisma.workspaceInvitation.findMany({
        where: {
          workspaceId,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: {
          invitedByUser: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      clientModel
        ? clientModel.findMany({
            where: { workspaceId },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const clientMap = new Map(
      (clients as Array<{ id: string; name: string }>).map((c) => [
        c.id,
        c.name,
      ]),
    );

    const formattedInvitations = invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      clientId: inv.clientId ?? null,
      clientName: inv.clientId ? (clientMap.get(inv.clientId) ?? null) : null,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      invitedBy: {
        id: inv.invitedByUser.id,
        name: inv.invitedByUser.name,
        email: inv.invitedByUser.email,
      },
    }));

    return {
      members: formattedMembers,
      invitations: formattedInvitations,
    };
  }

  /**
   * Revokes an existing pending invitation.
   */
  async revokeInvitation(
    workspaceId: string,
    invitationId: string,
    callerUserId: string,
  ) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation || invitation.workspaceId !== workspaceId) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.consumedAt) {
      throw new BadRequestException('Invitation is already consumed');
    }

    if (invitation.revokedAt) {
      throw new BadRequestException('Invitation is already revoked');
    }

    await this.prisma.workspaceInvitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });

    await this.audit.logAction({
      workspaceId,
      actorId: callerUserId,
      action: AuditAction.MEMBER_INVITATION_REVOKED,
      targetType: 'WorkspaceInvitation',
      targetId: invitationId,
      metadata: { email: invitation.email },
    });

    return { success: true };
  }

  /**
   * Resends an invitation by invalidating the old token, issuing a fresh token with 7-day expiry,
   * and resending the invitation email.
   */
  async resendInvitation(
    workspaceId: string,
    invitationId: string,
    callerUserId: string,
  ) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation || invitation.workspaceId !== workspaceId) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.consumedAt) {
      throw new BadRequestException('Cannot resend an accepted invitation');
    }

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.workspaceInvitation.update({
      where: { id: invitationId },
      data: {
        tokenHash,
        expiresAt,
        revokedAt: null,
      },
    });

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });

    await this.emailDelivery.sendWorkspaceInvitationEmail(invitation.email, {
      workspaceName: workspace?.name || 'Workspace',
      role: formatRoleName(invitation.role),
      rawToken,
    });

    await this.audit.logAction({
      workspaceId,
      actorId: callerUserId,
      action: AuditAction.MEMBER_INVITATION_RESENT,
      targetType: 'WorkspaceInvitation',
      targetId: invitationId,
      metadata: { email: invitation.email },
    });

    return { success: true };
  }

  /**
   * Updates a member's role.
   * Only Owners can modify Owners or promote to Owner; last Owner cannot be demoted.
   */
  async updateMemberRole(
    workspaceId: string,
    memberId: string,
    callerUserId: string,
    callerRole: string,
    dto: UpdateMemberRoleDto,
  ) {
    const targetMember = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });

    if (!targetMember || targetMember.workspaceId !== workspaceId) {
      throw new NotFoundException('Member not found');
    }

    // Hierarchy rule 1: only an OWNER may change an OWNER's role
    if (
      targetMember.role === WorkspaceRole.OWNER &&
      callerRole !== WorkspaceRole.OWNER
    ) {
      throw new ForbiddenException("Only an owner can modify an owner's role");
    }

    // Hierarchy rule 2: only an OWNER may promote to OWNER
    if (
      dto.role === WorkspaceRole.OWNER &&
      callerRole !== WorkspaceRole.OWNER
    ) {
      throw new ForbiddenException(
        'Only an owner can promote a member to owner',
      );
    }

    // Hierarchy rule 3: last OWNER cannot be demoted
    if (
      targetMember.role === WorkspaceRole.OWNER &&
      dto.role !== WorkspaceRole.OWNER
    ) {
      const ownerCount = await this.prisma.workspaceMember.count({
        where: {
          workspaceId,
          role: WorkspaceRole.OWNER,
        },
      });

      if (ownerCount <= 1) {
        throw new BadRequestException(
          'Cannot demote the last owner of the workspace',
        );
      }
    }

    let newClientId = targetMember.clientId;

    if (dto.role !== WorkspaceRole.CLIENT_APPROVER) {
      if (dto.clientId) {
        throw new BadRequestException(
          'Only client approvers can be scoped to a client',
        );
      }
      newClientId = null;
    } else if (dto.clientId !== undefined) {
      if (dto.clientId === null) {
        newClientId = null;
      } else {
        const client = await this.prisma.client.findFirst({
          where: { id: dto.clientId, workspaceId },
        });
        if (!client) {
          throw new NotFoundException('Client not found');
        }
        newClientId = dto.clientId;
      }
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: {
        role: dto.role,
        clientId: newClientId,
      },
    });

    await this.audit.logAction({
      workspaceId,
      actorId: callerUserId,
      action: AuditAction.MEMBER_ROLE_UPDATED,
      targetType: 'WorkspaceMember',
      targetId: memberId,
      metadata: {
        oldRole: targetMember.role,
        newRole: dto.role,
        oldClientId: targetMember.clientId,
        newClientId,
      },
    });

    return updated;
  }

  /**
   * Removes a member from the workspace.
   * Hierarchy rules: only an OWNER may remove an OWNER; last OWNER cannot be removed;
   * self-removal is not allowed in v1.
   */
  async removeMember(
    workspaceId: string,
    memberId: string,
    callerUserId: string,
    callerRole: string,
  ) {
    const targetMember = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });

    if (!targetMember || targetMember.workspaceId !== workspaceId) {
      throw new NotFoundException('Member not found');
    }

    // Rule 1: A member cannot remove themselves in v1
    if (targetMember.userId === callerUserId) {
      throw new BadRequestException(
        'Self-removal is not supported in this version',
      );
    }

    // Rule 2: Only an OWNER may remove an OWNER
    if (
      targetMember.role === WorkspaceRole.OWNER &&
      callerRole !== WorkspaceRole.OWNER
    ) {
      throw new ForbiddenException('Only an owner can remove an owner');
    }

    // Rule 3: The last OWNER cannot be removed
    if (targetMember.role === WorkspaceRole.OWNER) {
      const ownerCount = await this.prisma.workspaceMember.count({
        where: {
          workspaceId,
          role: WorkspaceRole.OWNER,
        },
      });

      if (ownerCount <= 1) {
        throw new BadRequestException(
          'Cannot remove the last owner of the workspace',
        );
      }
    }

    await this.prisma.workspaceMember.delete({
      where: { id: memberId },
    });

    await this.audit.logAction({
      workspaceId,
      actorId: callerUserId,
      action: AuditAction.MEMBER_REMOVED,
      targetType: 'WorkspaceMember',
      targetId: memberId,
      metadata: { role: targetMember.role, userId: targetMember.userId },
    });

    return { success: true };
  }

  /**
   * Accepts an invitation token.
   * Authenticated route. Validates token liveness, email match (case-insensitive),
   * idempotent member join, seat capacity check, and consumes the token.
   */
  async acceptInvitation(userId: string, userEmail: string, token: string) {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('Invalid invitation token');
    }

    const tokenHash = hashToken(token.trim());
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash },
      include: { workspace: true },
    });

    if (!invitation) {
      throw new BadRequestException('Invitation is invalid or has expired');
    }

    if (invitation.revokedAt) {
      throw new BadRequestException('This invitation has been revoked');
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    // Email match check (case-insensitive)
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException(
        `This invitation was sent to ${invitation.email}. You are currently signed in as ${userEmail}.`,
      );
    }

    // Check if user is already a member (idempotent success)
    const existingMembership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: invitation.workspaceId,
          userId,
        },
      },
    });

    if (existingMembership) {
      if (!invitation.consumedAt) {
        await this.prisma.workspaceInvitation.update({
          where: { id: invitation.id },
          data: { consumedAt: new Date() },
        });
      }
      return {
        success: true,
        workspaceId: invitation.workspaceId,
        alreadyMember: true,
      };
    }

    // If token already consumed by someone else or previous run without membership
    if (invitation.consumedAt) {
      throw new BadRequestException('This invitation has already been used');
    }

    // Seat limit check via assertSeatLimit(workspaceId, 1)
    await this.entitlementsService.assertSeatLimit(invitation.workspaceId, 1);

    // Create member and consume token atomically
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceMember.create({
        data: {
          id: generateId(),
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
          clientId: invitation.clientId ?? null,
        },
      });

      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { consumedAt: new Date() },
      });
    });

    await this.audit.logAction({
      workspaceId: invitation.workspaceId,
      actorId: userId,
      action: AuditAction.MEMBER_INVITATION_ACCEPTED,
      targetType: 'WorkspaceMember',
      targetId: invitation.id,
      metadata: { role: invitation.role, email: invitation.email },
    });

    return {
      success: true,
      workspaceId: invitation.workspaceId,
    };
  }

  /**
   * Retrieves invitation info for display on the accept page before acceptance.
   * Public/unauthenticated helper.
   */
  async getInvitationInfo(token: string) {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('Invalid invitation token');
    }

    const tokenHash = hashToken(token.trim());
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash },
      include: { workspace: true },
    });

    if (
      !invitation ||
      invitation.revokedAt ||
      invitation.consumedAt ||
      invitation.expiresAt < new Date()
    ) {
      throw new BadRequestException('This invitation is no longer valid');
    }

    return {
      workspaceName: invitation.workspace.name,
      email: invitation.email,
      role: invitation.role,
      roleFormatted: formatRoleName(invitation.role),
      expiresAt: invitation.expiresAt,
    };
  }
}
