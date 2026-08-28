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
