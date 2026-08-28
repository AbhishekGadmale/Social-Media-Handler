import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let serviceMock: any;

  beforeEach(async () => {
    serviceMock = {
      getWorkspaceOverview: vi.fn(),
      getAccountAnalytics: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        {
          provide: AnalyticsService,
          useValue: serviceMock,
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

  it('Dashboard read endpoint delegates to AnalyticsService.getWorkspaceOverview', async () => {
    serviceMock.getWorkspaceOverview.mockResolvedValue({
      accountsConnected: 1,
    });
    const res = await controller.getOverview('ws-1');
    expect(serviceMock.getWorkspaceOverview).toHaveBeenCalledWith('ws-1');
    expect(res).toEqual({ accountsConnected: 1 });
  });

  it('Account analytics endpoint delegates to AnalyticsService.getAccountAnalytics', async () => {
    serviceMock.getAccountAnalytics.mockResolvedValue({ metrics: [] });
    const res = await controller.getAccountAnalytics('ws-1', 'acc-1');
    expect(serviceMock.getAccountAnalytics).toHaveBeenCalledWith(
      'ws-1',
      'acc-1',
    );
    expect(res).toEqual({ metrics: [] });
  });
});
