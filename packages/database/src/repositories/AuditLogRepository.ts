import { PrismaClient, Prisma } from "@prisma/client";
import { generateId } from "../id";

export enum AuditAction {
  AUTH_SIGNUP_SUCCEEDED = "AUTH_SIGNUP_SUCCEEDED",
  AUTH_SIGNUP_DUPLICATE_EMAIL = "AUTH_SIGNUP_DUPLICATE_EMAIL",
  AUTH_LOGIN_SUCCEEDED = "AUTH_LOGIN_SUCCEEDED",
  AUTH_LOGIN_FAILED = "AUTH_LOGIN_FAILED",
  AUTH_LOGOUT = "AUTH_LOGOUT",
  AUTH_PASSWORD_CHANGED = "AUTH_PASSWORD_CHANGED",
  AUTH_PASSWORD_CHANGE_FAILED = "AUTH_PASSWORD_CHANGE_FAILED",
  AUTH_REVOKE_ALL_SESSIONS = "AUTH_REVOKE_ALL_SESSIONS",
  AUTH_SESSION_REVOKED = "AUTH_SESSION_REVOKED",
  AUTH_EMAIL_VERIFIED = "AUTH_EMAIL_VERIFIED",
  AUTH_EMAIL_VERIFICATION_FAILED = "AUTH_EMAIL_VERIFICATION_FAILED",
  AUTH_EMAIL_VERIFICATION_RESENT = "AUTH_EMAIL_VERIFICATION_RESENT",
  AUTH_PASSWORD_RESET_REQUESTED = "AUTH_PASSWORD_RESET_REQUESTED",
  AUTH_PASSWORD_RESET_SUCCEEDED = "AUTH_PASSWORD_RESET_SUCCEEDED",
  OAUTH_CONNECTION_STARTED = "OAUTH_CONNECTION_STARTED",
  OAUTH_CONNECTION_SUCCEEDED = "OAUTH_CONNECTION_SUCCEEDED",
  OAUTH_CONNECTION_FAILED = "OAUTH_CONNECTION_FAILED",
  OAUTH_RECONNECTED = "OAUTH_RECONNECTED",
  ACCOUNT_SYNC_TRIGGERED = "ACCOUNT_SYNC_TRIGGERED",
  ACCOUNT_DISCONNECTED = "ACCOUNT_DISCONNECTED",
  META_DATA_DELETION = "META_DATA_DELETION",
  MEDIA_UPLOAD_INITIATED = "MEDIA_UPLOAD_INITIATED",
  MEDIA_UPLOAD_COMPLETED = "MEDIA_UPLOAD_COMPLETED",
  PUBLICATION_RECONCILED_PUBLISHED = "PUBLICATION_RECONCILED_PUBLISHED",
  PUBLICATION_RECONCILED_FAILED = "PUBLICATION_RECONCILED_FAILED",

  // Post CRUD
  POST_CREATED = "POST_CREATED",
  POST_UPDATED = "POST_UPDATED",
  POST_DELETED = "POST_DELETED",

  // Publication Targets
  PUBLICATION_TARGET_ADDED = "PUBLICATION_TARGET_ADDED",
  PUBLICATION_TARGET_UPDATED = "PUBLICATION_TARGET_UPDATED",
  PUBLICATION_TARGET_REMOVED = "PUBLICATION_TARGET_REMOVED",

  // Publication Lifecycle
  PUBLICATION_REQUESTED = "PUBLICATION_REQUESTED",
  PUBLICATION_RETRY_REQUESTED = "PUBLICATION_RETRY_REQUESTED",
  PUBLICATION_SCHEDULED = "PUBLICATION_SCHEDULED",
  PUBLICATION_RESCHEDULED = "PUBLICATION_RESCHEDULED",
  PUBLICATION_UNSCHEDULED = "PUBLICATION_UNSCHEDULED",
  PUBLICATION_CANCELLED = "PUBLICATION_CANCELLED",
  PUBLICATION_DELETE_REQUESTED = "PUBLICATION_DELETE_REQUESTED",

  // Post Approvals
  POST_APPROVAL_REQUESTED = "POST_APPROVAL_REQUESTED",
  POST_APPROVAL_APPROVED = "POST_APPROVAL_APPROVED",
  POST_APPROVAL_CHANGES_REQUESTED = "POST_APPROVAL_CHANGES_REQUESTED",
  POST_APPROVAL_INVALIDATED = "POST_APPROVAL_INVALIDATED",

  // Reports & Branding
  REPORT_GENERATED = "REPORT_GENERATED",
  WORKSPACE_BRANDING_UPDATED = "WORKSPACE_BRANDING_UPDATED",

  // Workspace Members & Invitations
  MEMBER_INVITED = "MEMBER_INVITED",
  MEMBER_INVITATION_REVOKED = "MEMBER_INVITATION_REVOKED",
  MEMBER_INVITATION_RESENT = "MEMBER_INVITATION_RESENT",
  MEMBER_INVITATION_ACCEPTED = "MEMBER_INVITATION_ACCEPTED",
  MEMBER_ROLE_UPDATED = "MEMBER_ROLE_UPDATED",
  MEMBER_REMOVED = "MEMBER_REMOVED",

  // Clients
  CLIENT_CREATED = "CLIENT_CREATED",
  CLIENT_UPDATED = "CLIENT_UPDATED",
  CLIENT_DELETED = "CLIENT_DELETED",
  ACCOUNT_CLIENT_ASSIGNED = "ACCOUNT_CLIENT_ASSIGNED",
}

export interface CreateAuditLogDto {
  workspaceId?: string;
  actorId?: string;
  action: AuditAction;
  targetType: string;
  targetId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

export class AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateAuditLogDto, tx?: Prisma.TransactionClient) {
    // Fire and forget or await depending on the service logic.
    // The repository just provides the DB operation.
    const client = tx ?? this.prisma;
    return client.auditLog.create({
      data: {
        id: generateId(),
        workspaceId: data.workspaceId,
        actorId: data.actorId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        requestId: data.requestId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        metadata: data.metadata || {},
      },
    });
  }

  async findByWorkspace(workspaceId: string, page = 1, pageSize = 50) {
    const skip = (page - 1) * pageSize;
    return this.prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    });
  }

  async findByActionAndConfirmationCode(
    action: string,
    confirmationCode: string,
  ) {
    return this.prisma.auditLog.findFirst({
      where: {
        action,
        metadata: {
          path: ["confirmationCode"],
          equals: confirmationCode,
        },
      },
    });
  }
}
