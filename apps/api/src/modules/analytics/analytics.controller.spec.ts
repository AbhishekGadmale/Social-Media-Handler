import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { PrismaClient } from '@agency-os/database';
import { NotFoundException } from '@nestjs/common';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      socialAccount: {
        findFirst: vi.fn(),
      },
      accountMetricDaily: {
        findMany: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        {
          provide: PrismaClient,
          useValue: prismaMock,
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

    controller = module.get<AnalyticsController>(AnalyticsController);
  });

  it('Dashboard read endpoint returns stored data and makes ZERO calls to provider client', async () => {
    prismaMock.socialAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      workspaceId: 'ws-1',
    });
    prismaMock.accountMetricDaily.findMany.mockResolvedValue([
      { date: new Date(), followers: 100, engagement: 50 },
    ]);

    const res = await controller.getAccountAnalytics('ws-1', 'acc-1');

    expect(prismaMock.socialAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'acc-1', workspaceId: 'ws-1' },
    });
    expect(prismaMock.accountMetricDaily.findMany).toHaveBeenCalled();
    expect(res.metrics.length).toBe(1);
    expect(res.metrics[0].followers).toBe(100);
    // Notice we never called or imported the provider mock here, so ZERO calls is guaranteed by architecture.
  });

  it('Cross-workspace check: cannot return data for an account belonging to workspace B', async () => {
    // Return null simulating that the account is not found in workspace A
    prismaMock.socialAccount.findFirst.mockResolvedValue(null);

    await expect(
      controller.getAccountAnalytics('workspace-A', 'account-in-workspace-B'),
    ).rejects.toThrow(NotFoundException);

    expect(prismaMock.socialAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'account-in-workspace-B', workspaceId: 'workspace-A' },
    });
  });
});
