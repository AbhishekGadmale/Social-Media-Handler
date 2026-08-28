import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaClient } from '@agency-os/database';
import { NotFoundException } from '@nestjs/common';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      socialAccount: {
        findFirst: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: PrismaClient,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('getAccountAnalytics returns account and metrics safely', async () => {
    prismaMock.socialAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      provider: 'YOUTUBE',
      name: 'Test Channel',
      status: 'ACTIVE',
      metrics: [{ date: new Date(), followers: 100, engagement: 10 }],
    });

    const result = await service.getAccountAnalytics('ws-1', 'acc-1');

    expect(prismaMock.socialAccount.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'acc-1',
        workspaceId: 'ws-1',
      },
      select: expect.objectContaining({
        id: true,
        provider: true,
        metrics: expect.any(Object),
      }),
    });

    expect(result.account.id).toBe('acc-1');
    expect(result.metrics.length).toBe(1);
    expect(result.metrics[0].followers).toBe(100);
  });

  it('getAccountAnalytics throws NotFoundException if account missing or wrong workspace', async () => {
    prismaMock.socialAccount.findFirst.mockResolvedValue(null);

    await expect(service.getAccountAnalytics('ws-1', 'acc-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
