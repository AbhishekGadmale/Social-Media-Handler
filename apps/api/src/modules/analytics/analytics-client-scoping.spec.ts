import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalyticsService } from './analytics.service';
import { NotFoundException } from '@nestjs/common';

describe('AnalyticsService Client Scoping', () => {
  let service: AnalyticsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      socialAccount: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    service = new AnalyticsService(mockPrisma);
  });

  describe('getWorkspaceOverview scoping', () => {
    it('filters accounts by scopeClientId when provided', async () => {
      mockPrisma.socialAccount.findMany.mockResolvedValue([
        {
          id: 'acc-1',
          provider: 'TWITTER',
          name: 'Twitter Acc',
          status: 'ACTIVE',
          metrics: [],
        },
      ]);

      const res = await service.getWorkspaceOverview('ws-1', 'client-1');

      expect(mockPrisma.socialAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            clientId: 'client-1',
            workspaceId: 'ws-1',
          },
        }),
      );
      expect(res.accountsConnected).toBe(1);
    });
  });

  describe('getAccountAnalytics scoping', () => {
    it('returns analytics if account clientId matches scopeClientId', async () => {
      mockPrisma.socialAccount.findFirst.mockResolvedValue({
        id: 'acc-1',
        clientId: 'client-1',
        provider: 'TWITTER',
        name: 'Account 1',
        status: 'ACTIVE',
        metrics: [],
      });

      const res = await service.getAccountAnalytics(
        'ws-1',
        'acc-1',
        'client-1',
      );
      expect(res.account.id).toBe('acc-1');
    });

    it('throws 404 NotFoundException if account clientId does not match scopeClientId', async () => {
      mockPrisma.socialAccount.findFirst.mockResolvedValue({
        id: 'acc-1',
        clientId: 'client-2',
        provider: 'TWITTER',
        name: 'Account 1',
        status: 'ACTIVE',
        metrics: [],
      });

      await expect(
        service.getAccountAnalytics('ws-1', 'acc-1', 'client-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
