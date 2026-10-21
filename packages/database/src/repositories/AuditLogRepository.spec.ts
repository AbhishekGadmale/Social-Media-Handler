/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogRepository, AuditAction } from './AuditLogRepository';

describe('AuditLogRepository', () => {
  let prismaMock: any;
  let txMock: any;
  let repo: AuditLogRepository;

  beforeEach(() => {
    prismaMock = {
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-log-prisma' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    txMock = {
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-log-tx' }),
      },
    };

    repo = new AuditLogRepository(prismaMock);
  });

  it('uses this.prisma when tx is not provided', async () => {
    const data = {
      workspaceId: 'ws-1',
      actorId: 'user-1',
      action: AuditAction.POST_CREATED,
      targetType: 'POST',
      targetId: 'post-1',
      metadata: { postId: 'post-1' },
    };

    const result = await repo.create(data);

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: AuditAction.POST_CREATED,
        targetType: 'POST',
        targetId: 'post-1',
        metadata: { postId: 'post-1' },
      }),
    });
    expect(result).toEqual({ id: 'audit-log-prisma' });
  });

  it('uses tx when transaction client is provided', async () => {
    const data = {
      workspaceId: 'ws-2',
      actorId: 'user-2',
      action: AuditAction.POST_UPDATED,
      targetType: 'POST',
      targetId: 'post-2',
      metadata: { postId: 'post-2' },
    };

    const result = await repo.create(data, txMock);

    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        workspaceId: 'ws-2',
        actorId: 'user-2',
        action: AuditAction.POST_UPDATED,
        targetType: 'POST',
        targetId: 'post-2',
        metadata: { postId: 'post-2' },
      }),
    });
    expect(result).toEqual({ id: 'audit-log-tx' });
  });

  it('queries audit logs by workspace with default pagination', async () => {
    await repo.findByWorkspace('ws-1');

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50,
    });
  });

  it('queries audit logs by workspace with custom pagination', async () => {
    await repo.findByWorkspace('ws-1', 3, 20);

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      orderBy: { createdAt: 'desc' },
      skip: 40,
      take: 20,
    });
  });
});
