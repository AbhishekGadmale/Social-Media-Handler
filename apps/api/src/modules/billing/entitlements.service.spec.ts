import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { SubscriptionStatus } from '@agency-os/database';
import { EntitlementsService } from './entitlements.service';

describe('EntitlementsService', () => {
  let service: EntitlementsService;
  let prismaMock: any;
  const mockWorkspaceId = 'ws-test-123';

  beforeEach(() => {
    prismaMock = {
      workspace: {
        findUnique: vi.fn(),
      },
      workspaceMember: {
        count: vi.fn(),
      },
    };

    service = new EntitlementsService(prismaMock);
  });

  describe('Trial Lifecycle & Grace Periods', () => {
    it('grants full Agency entitlements (10 seats) and write access during active trial', async () => {
      const now = new Date('2026-11-06T12:00:00Z');
      const trialEndsAt = new Date('2026-11-20T12:00:00Z'); // 14 days later

      prismaMock.workspace.findUnique.mockResolvedValue({
        id: mockWorkspaceId,
        trialEndsAt,
        subscription: null,
      });

      const entitlements = await service.getWorkspaceEntitlements(
        mockWorkspaceId,
        now,
      );

      expect(entitlements.isReadOnly).toBe(false);
      expect(entitlements.isTrial).toBe(true);
      expect(entitlements.seats).toBe(10);
      expect(entitlements.planCode).toBe('AGENCY_TRIAL');

      // assertWorkspaceWritable does not throw
      await expect(
        service.assertWorkspaceWritable(mockWorkspaceId, now),
      ).resolves.not.toThrow();
    });

    it('enforces read-only wall when trial is expired and TRIAL_END_GRACE_DAYS is 0', async () => {
      const now = new Date('2026-11-21T12:00:00Z');
      const trialEndsAt = new Date('2026-11-20T12:00:00Z'); // 1 day expired

      prismaMock.workspace.findUnique.mockResolvedValue({
        id: mockWorkspaceId,
        trialEndsAt,
        subscription: null,
      });

      const entitlements = await service.getWorkspaceEntitlements(
        mockWorkspaceId,
        now,
        0,
      );

      expect(entitlements.isReadOnly).toBe(true);
      expect(entitlements.readOnlyReason).toContain('Trial expired');

      await expect(
        service.assertWorkspaceWritable(mockWorkspaceId, now, 0),
      ).rejects.toThrow(ForbiddenException);
    });

    it('honors grace period: remains writable when TRIAL_END_GRACE_DAYS is 3 and within grace', async () => {
      const trialEndsAt = new Date('2026-11-20T12:00:00Z');
      const now = new Date('2026-11-22T12:00:00Z'); // 2 days past trial, but within 3 days grace

      prismaMock.workspace.findUnique.mockResolvedValue({
        id: mockWorkspaceId,
        trialEndsAt,
        subscription: null,
      });

      const entitlements = await service.getWorkspaceEntitlements(
        mockWorkspaceId,
        now,
        3,
      );

      expect(entitlements.isReadOnly).toBe(false);
      await expect(
        service.assertWorkspaceWritable(mockWorkspaceId, now, 3),
      ).resolves.not.toThrow();
    });

    it('blocks access when TRIAL_END_GRACE_DAYS is 3 and beyond grace', async () => {
      const trialEndsAt = new Date('2026-11-20T12:00:00Z');
      const now = new Date('2026-11-24T12:00:00Z'); // 4 days past trial, beyond 3 days grace

      prismaMock.workspace.findUnique.mockResolvedValue({
        id: mockWorkspaceId,
        trialEndsAt,
        subscription: null,
      });

      const entitlements = await service.getWorkspaceEntitlements(
        mockWorkspaceId,
        now,
        3,
      );

      expect(entitlements.isReadOnly).toBe(true);
      await expect(
        service.assertWorkspaceWritable(mockWorkspaceId, now, 3),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Paid Subscriptions & Halted Read-Only Policy', () => {
    it('allows write access for ACTIVE subscription with plan seats (Solo = 1)', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({
        id: mockWorkspaceId,
        trialEndsAt: new Date('2026-10-01T00:00:00Z'),
        subscription: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
          plan: {
            code: 'SOLO',
            seats: 1,
          },
        },
      });

      const entitlements =
        await service.getWorkspaceEntitlements(mockWorkspaceId);

      expect(entitlements.isReadOnly).toBe(false);
      expect(entitlements.seats).toBe(1);
      expect(entitlements.planCode).toBe('SOLO');
    });

    it('renders workspace read-only when subscription status is HALTED', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({
        id: mockWorkspaceId,
        trialEndsAt: new Date('2026-10-01T00:00:00Z'),
        subscription: {
          status: SubscriptionStatus.HALTED,
          currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
          plan: {
            code: 'STUDIO',
            seats: 3,
          },
        },
      });

      const entitlements =
        await service.getWorkspaceEntitlements(mockWorkspaceId);

      expect(entitlements.isReadOnly).toBe(true);
      expect(entitlements.readOnlyReason).toContain('halted');

      await expect(
        service.assertWorkspaceWritable(mockWorkspaceId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows write access during PAST_DUE before period end, blocks after period end', async () => {
      const now = new Date('2026-11-15T00:00:00Z');
      const futureEnd = new Date('2026-11-20T00:00:00Z');
      const pastEnd = new Date('2026-11-10T00:00:00Z');

      // Before period end: writable
      prismaMock.workspace.findUnique.mockResolvedValue({
        id: mockWorkspaceId,
        subscription: {
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: futureEnd,
          plan: { code: 'AGENCY', seats: 10 },
        },
      });

      const writableEntitlements = await service.getWorkspaceEntitlements(
        mockWorkspaceId,
        now,
      );
      expect(writableEntitlements.isReadOnly).toBe(false);

      // After period end: read-only
      prismaMock.workspace.findUnique.mockResolvedValue({
        id: mockWorkspaceId,
        subscription: {
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: pastEnd,
          plan: { code: 'AGENCY', seats: 10 },
        },
      });

      const readOnlyEntitlements = await service.getWorkspaceEntitlements(
        mockWorkspaceId,
        now,
      );
      expect(readOnlyEntitlements.isReadOnly).toBe(true);
    });
  });

  describe('Seat Limits Enforcement', () => {
    it('allows member addition when count is below plan limit', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({
        id: mockWorkspaceId,
        subscription: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
          plan: { code: 'STUDIO', seats: 3 },
        },
      });
      prismaMock.workspaceMember.count.mockResolvedValue(2); // 2 existing, adding 1 = 3 <= 3

      await expect(
        service.assertSeatLimit(mockWorkspaceId, 1),
      ).resolves.not.toThrow();
    });

    it('rejects member addition with ForbiddenException when exceeding plan limit', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({
        id: mockWorkspaceId,
        subscription: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
          plan: { code: 'STUDIO', seats: 3 },
        },
      });
      prismaMock.workspaceMember.count.mockResolvedValue(3); // already 3

      await expect(service.assertSeatLimit(mockWorkspaceId, 1)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
