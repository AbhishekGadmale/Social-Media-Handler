import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  BillingInterval,
  SubscriptionStatus,
  InvoiceStatus,
} from '@agency-os/database';
import { BillingService } from './billing.service';
import { PLANS } from './billing.config';

describe('BillingService', () => {
  let service: BillingService;
  let prismaMock: any;
  let razorpayServiceMock: any;
  let emailDeliveryServiceMock: any;

  const mockWorkspaceId = 'ws-1111-2222';
  const mockOwnerEmail = 'owner@agency.com';
  const mockFoundingPlan = {
    id: 'plan-founding-id',
    code: 'AGENCY_FOUNDING',
    name: 'Agency (Founding 50)',
    monthlyPricePaise: 299900,
    annualPricePaise: 2999000,
    seats: 10,
    isFounding: true,
  };
  const mockAgencyPlan = {
    id: 'plan-agency-id',
    code: 'AGENCY',
    name: 'Agency',
    monthlyPricePaise: 399900,
    annualPricePaise: 3999000,
    seats: 10,
    isFounding: false,
  };

  beforeEach(() => {
    prismaMock = {
      $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
      plan: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        upsert: vi.fn(),
      },
      subscription: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      invoice: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
      },
      invoiceSequence: {
        upsert: vi.fn(),
      },
      webhookEvent: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      workspace: {
        findUnique: vi.fn(),
      },
      workspaceMember: {
        findFirst: vi.fn(),
      },
    };

    razorpayServiceMock = {
      createSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
      verifyWebhookSignature: vi.fn(),
    };

    emailDeliveryServiceMock = {
      sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
      sendDunningEmail: vi.fn().mockResolvedValue(undefined),
    };

    service = new BillingService(
      prismaMock,
      razorpayServiceMock,
      emailDeliveryServiceMock,
    );
  });

  describe('Plan Seeding', () => {
    it('seeds missing plans into the database', async () => {
      prismaMock.plan.findUnique.mockResolvedValue(null);
      prismaMock.plan.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'new-id', ...data }),
      );

      await service.seedPlans();

      expect(prismaMock.plan.create).toHaveBeenCalledTimes(4);
    });
  });

  describe('Founding-50 Atomic Claim & Concurrency', () => {
    it('successfully claims a founding subscription when count < 50', async () => {
      prismaMock.subscription.findUnique.mockResolvedValue(null);
      prismaMock.subscription.count.mockResolvedValue(49);
      prismaMock.plan.findUnique.mockResolvedValue(mockFoundingPlan);
      prismaMock.subscription.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'sub-new', ...data }),
      );

      const result = await service.claimFoundingSubscription(
        mockWorkspaceId,
        BillingInterval.MONTHLY,
      );

      expect(prismaMock.subscription.count).toHaveBeenCalledWith({
        where: {
          isFounding: true,
          status: {
            in: [
              SubscriptionStatus.ACTIVE,
              SubscriptionStatus.TRIAL,
              SubscriptionStatus.PAST_DUE,
            ],
          },
        },
      });
      expect(result.isFounding).toBe(true);
      expect(result.planId).toBe(mockFoundingPlan.id);
    });

    it('rejects claim with ConflictException when founding count is >= 50', async () => {
      prismaMock.subscription.findUnique.mockResolvedValue(null);
      prismaMock.subscription.count.mockResolvedValue(50);

      await expect(
        service.claimFoundingSubscription(
          mockWorkspaceId,
          BillingInterval.MONTHLY,
        ),
      ).rejects.toThrow(ConflictException);

      expect(prismaMock.subscription.create).not.toHaveBeenCalled();
    });

    it('grandfathering: returns existing active founding subscription without incrementing count', async () => {
      const existing = {
        id: 'sub-existing',
        workspaceId: mockWorkspaceId,
        planId: mockFoundingPlan.id,
        isFounding: true,
        status: SubscriptionStatus.ACTIVE,
      };
      prismaMock.subscription.findUnique.mockResolvedValue(existing);

      const result = await service.claimFoundingSubscription(
        mockWorkspaceId,
        BillingInterval.MONTHLY,
      );

      expect(result).toEqual(existing);
      expect(prismaMock.subscription.count).not.toHaveBeenCalled();
    });

    it('cancellation permanently loses founding status', async () => {
      const activeFounding = {
        id: 'sub-founding',
        workspaceId: mockWorkspaceId,
        razorpaySubscriptionId: 'sub_rzp_123',
        isFounding: true,
        status: SubscriptionStatus.ACTIVE,
      };
      prismaMock.subscription.findUnique.mockResolvedValue(activeFounding);
      prismaMock.subscription.update.mockResolvedValue({
        ...activeFounding,
        isFounding: false,
        status: SubscriptionStatus.CANCELLED,
      });

      const cancelled = await service.cancelSubscription(mockWorkspaceId, true);

      expect(prismaMock.subscription.update).toHaveBeenCalledWith({
        where: { id: activeFounding.id },
        data: {
          isFounding: false,
          cancelAtPeriodEnd: true,
          status: SubscriptionStatus.ACTIVE,
        },
      });
      expect(cancelled.isFounding).toBe(false);
    });
  });

  describe('Sequential Invoicing & 18% GST Math', () => {
    it('creates sequential invoice INV-YYYY-XXXXX with exact paise GST split on subscription.charged', async () => {
      const currentYear = new Date().getFullYear();
      prismaMock.invoiceSequence.upsert.mockResolvedValue({
        year: currentYear,
        lastSequence: 1,
      });

      const subscription = {
        id: 'sub-1',
        workspaceId: mockWorkspaceId,
        status: SubscriptionStatus.ACTIVE,
      };
      prismaMock.subscription.findUnique.mockResolvedValue(subscription);
      prismaMock.invoice.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'inv-1', ...data }),
      );

      // Charged ₹3,999 (399,900 paise)
      const invoice = await service.recordChargedInvoice({
        workspaceId: mockWorkspaceId,
        subscriptionId: subscription.id,
        amountPaise: 399900,
        razorpayPaymentId: 'pay_rzp_123',
        razorpayInvoiceId: 'inv_rzp_123',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      expect(invoice.invoiceNumber).toBe(`INV-${currentYear}-00001`);
      expect(invoice.amountPaise).toBe(399900);
      expect(invoice.baseAmountPaise).toBe(338898);
      expect(invoice.gstAmountPaise).toBe(61002);
      expect(invoice.gstRate).toBe(18);
      expect(invoice.status).toBe(InvoiceStatus.PAID);
    });
  });

  describe('Webhook Processing & Idempotency', () => {
    const validEvent = {
      id: 'event_rzp_12345',
      event: 'subscription.charged',
      payload: {
        subscription: {
          entity: {
            id: 'sub_rzp_123',
            status: 'active',
            current_start: 1700000000,
            current_end: 1702592000,
          },
        },
        payment: {
          entity: {
            id: 'pay_rzp_123',
            amount: 99900, // ₹999 Studio
            status: 'captured',
          },
        },
      },
    };

    it('processes a new webhook event and marks it processed', async () => {
      prismaMock.webhookEvent.findUnique.mockResolvedValue(null);
      prismaMock.webhookEvent.create.mockResolvedValue({
        id: 'wh-db-id',
        eventId: validEvent.id,
        provider: 'RAZORPAY',
        processed: false,
      });
      prismaMock.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        workspaceId: mockWorkspaceId,
        razorpaySubscriptionId: 'sub_rzp_123',
      });
      prismaMock.invoiceSequence.upsert.mockResolvedValue({
        year: 2026,
        lastSequence: 5,
      });
      prismaMock.invoice.create.mockResolvedValue({
        id: 'inv-created',
      });

      const result = await service.processWebhook(validEvent as any);

      expect(result.processed).toBe(true);
      expect(prismaMock.webhookEvent.update).toHaveBeenCalledWith({
        where: { eventId: validEvent.id },
        data: { processed: true },
      });
    });

    it('idempotency: drops replayed webhook event and does not duplicate invoice', async () => {
      prismaMock.webhookEvent.findUnique.mockResolvedValue({
        id: 'wh-db-id',
        eventId: validEvent.id,
        provider: 'RAZORPAY',
        processed: true,
      });

      const result = await service.processWebhook(validEvent as any);

      expect(result.processed).toBe(true);
      expect(result.duplicate).toBe(true);
      expect(prismaMock.invoice.create).not.toHaveBeenCalled();
      expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    });

    it('triggers dunning email to workspace owner on payment.failed', async () => {
      const failedEvent = {
        id: 'event_rzp_fail_999',
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_failed_123',
              error_description: 'Card declined by issuing bank',
            },
          },
          subscription: {
            entity: {
              id: 'sub_rzp_123',
            },
          },
        },
      };

      prismaMock.webhookEvent.findUnique.mockResolvedValue(null);
      prismaMock.webhookEvent.create.mockResolvedValue({
        id: 'wh-fail-id',
        eventId: failedEvent.id,
        provider: 'RAZORPAY',
        processed: false,
      });
      prismaMock.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        workspaceId: mockWorkspaceId,
        razorpaySubscriptionId: 'sub_rzp_123',
        status: SubscriptionStatus.ACTIVE,
      });
      prismaMock.workspaceMember.findFirst.mockResolvedValue({
        user: { email: mockOwnerEmail },
      });

      await service.processWebhook(failedEvent as any);

      expect(emailDeliveryServiceMock.sendDunningEmail).toHaveBeenCalledWith(
        mockOwnerEmail,
        expect.objectContaining({
          reason: 'Card declined by issuing bank',
        }),
      );
    });
  });
});
