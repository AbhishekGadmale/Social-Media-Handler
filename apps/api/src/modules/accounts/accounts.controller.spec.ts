import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';
import { AuditService } from '../core/audit.service';
import { AuditAction } from '@agency-os/database';

describe('AccountsController', () => {
  let controller: AccountsController;
  let queueMock: any;
  let accountsServiceMock: any;
  let mockAuditService: any;

  beforeEach(async () => {
    queueMock = {
      add: vi.fn().mockResolvedValue({ id: 'job-123' }),
    } as any;

    accountsServiceMock = {
      listWorkspaceAccounts: vi.fn(),
      getWorkspaceAccount: vi
        .fn()
        .mockResolvedValue({ id: 'acc-1', workspaceId: 'ws-1' }),
    };

    mockAuditService = {
      logAction: vi.fn(),
      logActionBestEffort: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [
        {
          provide: getQueueToken('sync'),
          useValue: queueMock,
        },
        {
          provide: AccountsService,
          useValue: accountsServiceMock,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AccountsController>(AccountsController);
  });

  it('Manual trigger endpoint enqueues correctly and returns a jobId when account belongs to workspace', async () => {
    const res = await controller.triggerSync('ws-1', 'acc-1', {
      id: 'req-1',
      user: { id: 'u-1' },
    } as any);

    expect(accountsServiceMock.getWorkspaceAccount).toHaveBeenCalledWith(
      'ws-1',
      'acc-1',
    );
    expect(queueMock.add).toHaveBeenCalledWith(
      'sync-account',
      {
        socialAccountId: 'acc-1',
        workspaceId: 'ws-1',
        correlationId: 'req-1',
      },
      expect.any(Object),
    );
    expect(mockAuditService.logActionBestEffort).toHaveBeenCalledWith({
      action: AuditAction.ACCOUNT_SYNC_TRIGGERED,
      workspaceId: 'ws-1',
      actorId: 'u-1',
      targetType: 'SocialAccount',
      targetId: 'acc-1',
      requestId: 'req-1',
      metadata: { jobId: 'job-123' },
    });
    expect(res).toEqual({ queued: true, jobId: 'job-123' });
  });

  it('Manual trigger endpoint rejects and does NOT enqueue job when account does not belong to workspace', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    accountsServiceMock.getWorkspaceAccount.mockRejectedValueOnce(
      new NotFoundException('Account not found in workspace'),
    );

    await expect(
      controller.triggerSync('ws-1', 'acc-foreign', {
        id: 'req-2',
        user: { id: 'u-1' },
      } as any),
    ).rejects.toThrow('Account not found in workspace');

    expect(accountsServiceMock.getWorkspaceAccount).toHaveBeenCalledWith(
      'ws-1',
      'acc-foreign',
    );
    expect(queueMock.add).not.toHaveBeenCalled();
  });
});
