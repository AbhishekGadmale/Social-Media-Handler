/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { SubscriptionStatus } from '@agency-os/database';
import { TrialExpiryProcessor } from './trial-expiry.processor';

describe('TrialExpiryProcessor', () => {
  let processor: TrialExpiryProcessor;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      workspace: {
        findMany: jest.fn(),
      },
      subscription: {
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };

    processor = new TrialExpiryProcessor(prismaMock);
  });

  it('identifies expired trials past grace period with no active subscription', async () => {
    const now = new Date('2026-11-20T00:00:00Z');
    const expiredWorkspace = {
      id: 'ws-expired-1',
      trialEndsAt: new Date('2026-11-15T00:00:00Z'), // 5 days past trial
      subscription: null,
    };
    const activeWorkspace = {
      id: 'ws-active-2',
      trialEndsAt: new Date('2026-11-25T00:00:00Z'), // still active
      subscription: null,
    };
    const paidWorkspace = {
      id: 'ws-paid-3',
      trialEndsAt: new Date('2026-11-10T00:00:00Z'),
      subscription: {
        status: SubscriptionStatus.ACTIVE,
      },
    };

    prismaMock.workspace.findMany.mockResolvedValue([
      expiredWorkspace,
      activeWorkspace,
      paidWorkspace,
    ]);

    const result = await processor.expireTrials(now, 0);

    expect(result.expiredCount).toBe(1);
    expect(result.expiredWorkspaceIds).toContain('ws-expired-1');
  });

  it('respects grace period: does not expire workspaces within grace days', async () => {
    const now = new Date('2026-11-20T00:00:00Z');
    const withinGraceWorkspace = {
      id: 'ws-grace-1',
      trialEndsAt: new Date('2026-11-18T00:00:00Z'), // 2 days past trial
      subscription: null,
    };

    prismaMock.workspace.findMany.mockResolvedValue([withinGraceWorkspace]);

    // Grace days = 3 -> 18 + 3 = 21 > 20 -> NOT expired
    const result = await processor.expireTrials(now, 3);

    expect(result.expiredCount).toBe(0);
    expect(result.expiredWorkspaceIds).toHaveLength(0);
  });

  it('expires workspaces when beyond grace period', async () => {
    const now = new Date('2026-11-25T00:00:00Z');
    const pastGraceWorkspace = {
      id: 'ws-grace-expired-1',
      trialEndsAt: new Date('2026-11-18T00:00:00Z'), // 7 days past trial
      subscription: null,
    };

    prismaMock.workspace.findMany.mockResolvedValue([pastGraceWorkspace]);

    // Grace days = 3 -> 18 + 3 = 21 < 25 -> expired!
    const result = await processor.expireTrials(now, 3);

    expect(result.expiredCount).toBe(1);
    expect(result.expiredWorkspaceIds).toContain('ws-grace-expired-1');
  });
});
