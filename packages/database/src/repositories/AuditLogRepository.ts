import { PrismaClient } from '@prisma/client';
import { generateId } from '../id';

export enum AuditAction {
  AUTH_LOGIN_SUCCEEDED = 'AUTH_LOGIN_SUCCEEDED',
  AUTH_LOGIN_FAILED = 'AUTH_LOGIN_FAILED',
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  OAUTH_CONNECTION_STARTED = 'OAUTH_CONNECTION_STARTED',
  OAUTH_CONNECTION_SUCCEEDED = 'OAUTH_CONNECTION_SUCCEEDED',
  OAUTH_CONNECTION_FAILED = 'OAUTH_CONNECTION_FAILED',
  OAUTH_RECONNECTED = 'OAUTH_RECONNECTED',
  ACCOUNT_SYNC_TRIGGERED = 'ACCOUNT_SYNC_TRIGGERED',
  MEDIA_UPLOAD_INITIATED = 'MEDIA_UPLOAD_INITIATED',
  MEDIA_UPLOAD_COMPLETED = 'MEDIA_UPLOAD_COMPLETED',
  PUBLICATION_RECONCILED_PUBLISHED = 'PUBLICATION_RECONCILED_PUBLISHED',
  PUBLICATION_RECONCILED_FAILED = 'PUBLICATION_RECONCILED_FAILED',

  // Post CRUD
  POST_CREATED = 'POST_CREATED',
  POST_UPDATED = 'POST_UPDATED',
  POST_DELETED = 'POST_DELETED',

  // Publication Targets
  PUBLICATION_TARGET_ADDED = 'PUBLICATION_TARGET_ADDED',
  PUBLICATION_TARGET_UPDATED = 'PUBLICATION_TARGET_UPDATED',
  PUBLICATION_TARGET_REMOVED = 'PUBLICATION_TARGET_REMOVED',

  // Publication Lifecycle
  PUBLICATION_REQUESTED = 'PUBLICATION_REQUESTED',
  PUBLICATION_RETRY_REQUESTED = 'PUBLICATION_RETRY_REQUESTED',
  PUBLICATION_SCHEDULED = 'PUBLICATION_SCHEDULED',
  PUBLICATION_RESCHEDULED = 'PUBLICATION_RESCHEDULED',
  PUBLICATION_UNSCHEDULED = 'PUBLICATION_UNSCHEDULED',
  PUBLICATION_CANCELLED = 'PUBLICATION_CANCELLED',
  PUBLICATION_DELETE_REQUESTED = 'PUBLICATION_DELETE_REQUESTED',
}

export interface CreateAuditLogDto {
  workspaceId?: string;
  actorId?: string;
  action: AuditAction;
  targetType: string;
  targetId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

export class AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateAuditLogDto) {
    // Fire and forget or await depending on the service logic.
    // The repository just provides the DB operation.
    return this.prisma.auditLog.create({
      data: {
        id: generateId(),
        workspaceId: data.workspaceId,
        actorId: data.actorId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        requestId: data.requestId,
        metadata: data.metadata || {},
      },
    });
  }

  async findByWorkspace(workspaceId: string, page = 1, pageSize = 50) {
    const skip = (page - 1) * pageSize;
    return this.prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    });
  }
}
