import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountsController } from './accounts.controller';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';

describe('AccountsController', () => {
  let controller: AccountsController;
  let queueMock: any;

  beforeEach(async () => {
    queueMock = {
      add: vi.fn().mockResolvedValue({ id: 'job-123' }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [
        {
          provide: getQueueToken('sync'),
          useValue: queueMock,
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

  it('Manual trigger endpoint enqueues correctly and returns a jobId', async () => {
    const res = await controller.triggerSync('ws-1', 'acc-1');
    expect(queueMock.add).toHaveBeenCalledWith(
      'sync-account',
      {
        socialAccountId: 'acc-1',
        workspaceId: 'ws-1',
      },
      expect.any(Object),
    );
    expect(res).toEqual({ queued: true, jobId: 'job-123' });
  });
});
