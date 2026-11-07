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
    razorpayPlanId: 'plan_founding_monthly_123',
    razorpayAnnualPlanId: 'plan_founding_annual_456',
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
      $queryRaw: vi.fn().mockResolvedValue([]),
      plan: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
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
        findFirst: vi.fn(),
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
      createPlan: vi.fn().mockImplementation((p: any) =>
        Promise.resolve({
          id: `plan_${p.item.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_123`,
        }),
      ),
      createSubscription: vi.fn().mockImplementation((s: any) =>
        Promise.resolve({
          id: 'sub_rzp_mock_123',
          short_url: 'https://rzp.io/i/sub_mock_123',
        }),
      ),
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
    it('seeds missing plans into the database and creates both monthly and yearly plans in Razorpay', async () => {
      prismaMock.plan.findUnique.mockResolvedValue(null);
      prismaMock.plan.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'new-id', ...data }),
      );

      await service.seedPlans();

      // 4 plans * 2 intervals (monthly + yearly) = 8 Razorpay plans
      expect(razorpayServiceMock.createPlan).toHaveBeenCalledTimes(8);
      expect(prismaMock.plan.create).toHaveBeenCalledTimes(4);

      // Verify monthly and annual creation for Studio plan
      expect(razorpayServiceMock.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          period: 'monthly',
          interval: 1,
          item: expect.objectContaining({
            name: 'Studio (Monthly)',
            amount: 99900,
          }),
        }),
      );
      expect(razorpayServiceMock.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          period: 'yearly',
          interval: 1,
          item: expect.objectContaining({
            name: 'Studio (Annual)',
            amount: 999000,
          }),
        }),
      );

      // Verify monthly and annual creation for Founding plan
      expect(razorpayServiceMock.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          period: 'monthly',
          interval: 1,
          item: expect.objectContaining({
            name: 'Agency (Founding 50) (Monthly)',
            amount: 299900,
          }),
        }),
      );
      expect(razorpayServiceMock.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          period: 'yearly',
          interval: 1,
          item: expect.objectContaining({
            name: 'Agency (Founding 50) (Annual)',
            amount: 2999000,
          }),
        }),
      );

      // Assert both plan IDs are stored on creation
      expect(prismaMock.plan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          code: 'STUDIO',
          razorpayPlanId: expect.stringContaining('monthly'),
          razorpayAnnualPlanId: expect.stringContaining('annual'),
        }),
      });
    });

    it('idempotency: does not call Razorpay if plan already has both razorpayPlanId and razorpayAnnualPlanId', async () => {
      prismaMock.plan.findUnique.mockResolvedValue({
        id: 'existing-id',
        code: 'STUDIO',
        razorpayPlanId: 'plan_studio_existing',
        razorpayAnnualPlanId: 'plan_studio_annual_existing',
      });

      await service.seedPlans();

      expect(razorpayServiceMock.createPlan).not.toHaveBeenCalled();
      expect(prismaMock.plan.create).not.toHaveBeenCalled();
    });

    it('partial idempotency: creates missing annual plan if only monthly plan exists', async () => {
      prismaMock.plan.findUnique.mockImplementation(({ where }: any) => {
        if (where.code === 'STUDIO') {
          return Promise.resolve({
            id: 'existing-studio-id',
            code: 'STUDIO',
            razorpayPlanId: 'plan_studio_existing',
            razorpayAnnualPlanId: null,
          });
        }
        return Promise.resolve({
          id: 'existing-other-id',
          code: where.code,
          razorpayPlanId: 'plan_other_monthly',
          razorpayAnnualPlanId: 'plan_other_annual',
        });
      });

      await service.seedPlans();

      expect(razorpayServiceMock.createPlan).toHaveBeenCalledTimes(1);
      expect(razorpayServiceMock.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          period: 'yearly',
          item: expect.objectContaining({
            name: 'Studio (Annual)',
            amount: 999000,
          }),
        }),
      );
      expect(prismaMock.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'existing-studio-id' },
          data: expect.objectContaining({
            razorpayAnnualPlanId: expect.any(String),
          }),
        }),
      );
    });
  });

  describe('Subscription Creation with Razorpay', () => {
    it('calls Razorpay createSubscription for MONTHLY interval with monthly plan and totalCount 120, exposing short_url', async () => {
      prismaMock.plan.findUnique.mockResolvedValue({
        id: 'plan-studio-id',
        code: 'STUDIO',
        razorpayPlanId: 'plan_studio_monthly_123',
        razorpayAnnualPlanId: 'plan_studio_annual_456',
      });
      prismaMock.subscription.findUnique.mockResolvedValue(null);
      prismaMock.subscription.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'sub-local-1', ...data }),
      );

      const sub = await service.createSubscription(
        mockWorkspaceId,
        'STUDIO',
        BillingInterval.MONTHLY,
      );

      expect(razorpayServiceMock.createSubscription).toHaveBeenCalledWith({
        planId: 'plan_studio_monthly_123',
        totalCount: 120,
        notes: {
          workspaceId: mockWorkspaceId,
          planCode: 'STUDIO',
          interval: BillingInterval.MONTHLY,
        },
      });
      expect(sub.razorpaySubscriptionId).toBe('sub_rzp_mock_123');
      expect(sub.razorpayPlanId).toBe('plan_studio_monthly_123');
      expect(sub.status).toBe(SubscriptionStatus.TRIAL);
      expect(sub.short_url).toBe('https://rzp.io/i/sub_mock_123');
      expect(sub.shortUrl).toBe('https://rzp.io/i/sub_mock_123');
    });

    it('calls Razorpay createSubscription for ANNUAL interval with yearly plan and totalCount 10, exposing short_url', async () => {
      prismaMock.plan.findUnique.mockResolvedValue({
        id: 'plan-studio-id',
        code: 'STUDIO',
        razorpayPlanId: 'plan_studio_monthly_123',
        razorpayAnnualPlanId: 'plan_studio_annual_456',
      });
      prismaMock.subscription.findUnique.mockResolvedValue(null);
      prismaMock.subscription.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'sub-local-2', ...data }),
      );

      const sub = await service.createSubscription(
        mockWorkspaceId,
        'STUDIO',
        BillingInterval.ANNUAL,
      );

      expect(razorpayServiceMock.createSubscription).toHaveBeenCalledWith({
        planId: 'plan_studio_annual_456',
        totalCount: 10,
        notes: {
          workspaceId: mockWorkspaceId,
          planCode: 'STUDIO',
          interval: BillingInterval.ANNUAL,
        },
      });
      expect(sub.razorpaySubscriptionId).toBe('sub_rzp_mock_123');
      expect(sub.razorpayPlanId).toBe('plan_studio_annual_456');
      expect(sub.status).toBe(SubscriptionStatus.TRIAL);
      expect(sub.short_url).toBe('https://rzp.io/i/sub_mock_123');
      expect(sub.shortUrl).toBe('https://rzp.io/i/sub_mock_123');
    });

    it('returns local subscription without short_url if Razorpay response has no short_url', async () => {
      prismaMock.plan.findUnique.mockResolvedValue({
        id: 'plan-studio-id',
        code: 'STUDIO',
        razorpayPlanId: 'plan_studio_monthly_123',
        razorpayAnnualPlanId: 'plan_studio_annual_456',
      });
      razorpayServiceMock.createSubscription.mockResolvedValue({
        id: 'sub_rzp_mock_no_url',
      });
      prismaMock.subscription.findUnique.mockResolvedValue(null);
      prismaMock.subscription.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'sub-local-3', ...data }),
      );

      const sub = await service.createSubscription(
        mockWorkspaceId,
        'STUDIO',
        BillingInterval.MONTHLY,
      );

      expect(sub.razorpaySubscriptionId).toBe('sub_rzp_mock_no_url');
      expect(sub.short_url).toBeUndefined();
      expect(sub.shortUrl).toBeUndefined();
    });

    it('fails fast and commits NO local subscription state if Razorpay createSubscription fails', async () => {
      prismaMock.plan.findUnique.mockResolvedValue({
        id: 'plan-studio-id',
        code: 'STUDIO',
        razorpayPlanId: 'plan_studio_monthly_123',
        razorpayAnnualPlanId: 'plan_studio_annual_456',
      });
      razorpayServiceMock.createSubscription.mockRejectedValue(
        new Error('Razorpay API error 500'),
      );

      await expect(
        service.createSubscription(
          mockWorkspaceId,
          'STUDIO',
          BillingInterval.MONTHLY,
        ),
      ).rejects.toThrow('Razorpay API error 500');

      expect(prismaMock.subscription.create).not.toHaveBeenCalled();
      expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    });
  });

  describe('Founding-50 Lock & Concurrency', () => {
    it('successfully claims a founding subscription when count < 50 with row-level lock (MONTHLY)', async () => {
      prismaMock.subscription.findUnique.mockResolvedValue(null);
      prismaMock.subscription.count.mockResolvedValue(49);
      prismaMock.plan.findUnique.mockResolvedValue({
        ...mockFoundingPlan,
        razorpayPlanId: 'plan_founding_monthly_123',
        razorpayAnnualPlanId: 'plan_founding_annual_456',
      });
      prismaMock.subscription.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'sub-new', ...data }),
      );

      const result = await service.claimFoundingSubscription(
        mockWorkspaceId,
        BillingInterval.MONTHLY,
      );

      expect(prismaMock.$queryRaw).toHaveBeenCalled();
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
      expect(razorpayServiceMock.createSubscription).toHaveBeenCalledWith({
        planId: 'plan_founding_monthly_123',
        totalCount: 120,
        notes: {
          workspaceId: mockWorkspaceId,
          planCode: 'AGENCY_FOUNDING',
          interval: BillingInterval.MONTHLY,
        },
      });
      expect(result.isFounding).toBe(true);
      expect(result.planId).toBe(mockFoundingPlan.id);
      expect(result.razorpaySubscriptionId).toBe('sub_rzp_mock_123');
      expect(result.razorpayPlanId).toBe('plan_founding_monthly_123');
      expect(result.short_url).toBe('https://rzp.io/i/sub_mock_123');
    });

    it('successfully claims a founding subscription for ANNUAL interval with annual plan and totalCount 10', async () => {
      prismaMock.subscription.findUnique.mockResolvedValue(null);
      prismaMock.subscription.count.mockResolvedValue(49);
      prismaMock.plan.findUnique.mockResolvedValue({
        ...mockFoundingPlan,
        razorpayPlanId: 'plan_founding_monthly_123',
        razorpayAnnualPlanId: 'plan_founding_annual_456',
      });
      prismaMock.subscription.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'sub-new-annual', ...data }),
      );

      const result = await service.claimFoundingSubscription(
        mockWorkspaceId,
        BillingInterval.ANNUAL,
      );

      expect(razorpayServiceMock.createSubscription).toHaveBeenCalledWith({
        planId: 'plan_founding_annual_456',
        totalCount: 10,
        notes: {
          workspaceId: mockWorkspaceId,
          planCode: 'AGENCY_FOUNDING',
          interval: BillingInterval.ANNUAL,
        },
      });
      expect(result.isFounding).toBe(true);
      expect(result.razorpaySubscriptionId).toBe('sub_rzp_mock_123');
      expect(result.razorpayPlanId).toBe('plan_founding_annual_456');
      expect(result.billingInterval).toBe(BillingInterval.ANNUAL);
      expect(result.short_url).toBe('https://rzp.io/i/sub_mock_123');
    });

    it('rejects claim with ConflictException (FOUNDING_PLAN_SOLD_OUT) when founding count is >= 50', async () => {
      prismaMock.subscription.findUnique.mockResolvedValue(null);
      prismaMock.subscription.count.mockResolvedValue(50);
      prismaMock.plan.findUnique.mockResolvedValue({
        ...mockFoundingPlan,
        razorpayPlanId: 'plan_founding_123',
      });

      await expect(
        service.claimFoundingSubscription(
          mockWorkspaceId,
          BillingInterval.MONTHLY,
        ),
      ).rejects.toThrow(/FOUNDING_PLAN_SOLD_OUT/);

      expect(razorpayServiceMock.createSubscription).not.toHaveBeenCalled();
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

    it('idempotency: returns existing invoice without consuming new sequence if razorpayPaymentId already exists', async () => {
      const existingInvoice = {
        id: 'inv-existing-1',
        invoiceNumber: 'INV-2026-00001',
        amountPaise: 399900,
        razorpayPaymentId: 'pay_rzp_duplicate',
      };
      prismaMock.invoice.findUnique.mockResolvedValue(existingInvoice);

      const result = await service.recordChargedInvoice({
        workspaceId: mockWorkspaceId,
        amountPaise: 399900,
        razorpayPaymentId: 'pay_rzp_duplicate',
      });

      expect(result).toEqual(existingInvoice);
      expect(prismaMock.invoiceSequence.upsert).not.toHaveBeenCalled();
      expect(prismaMock.invoice.create).not.toHaveBeenCalled();
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

    it('crash recovery: re-processes idempotently when webhook event exists but processed is false', async () => {
      // Simulate crash between invoice creation and marking processed:
      // First webhookEvent.create throws P2002 because record exists
      prismaMock.webhookEvent.create.mockRejectedValue({
        code: 'P2002',
        message: 'Unique constraint failed on the fields: (`eventId`)',
      });
      // But processed is false
      prismaMock.webhookEvent.findUnique.mockResolvedValue({
        id: 'wh-crashed-id',
        eventId: validEvent.id,
        provider: 'RAZORPAY',
        processed: false,
      });

      prismaMock.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        workspaceId: mockWorkspaceId,
        razorpaySubscriptionId: 'sub_rzp_123',
      });
      // Invoice already created prior to crash
      prismaMock.invoice.findUnique.mockResolvedValue({
        id: 'inv-existing-crashed',
        invoiceNumber: 'INV-2026-00001',
      });

      const result = await service.processWebhook(validEvent as any);

      expect(result.processed).toBe(true);
      // Invoice was found and not re-created
      expect(prismaMock.invoice.create).not.toHaveBeenCalled();
      // Marked as processed
      expect(prismaMock.webhookEvent.update).toHaveBeenCalledWith({
        where: { eventId: validEvent.id },
        data: { processed: true },
      });
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

  describe('getPlansWithAvailability', () => {
    it('returns plans and foundingAvailable: true when count < 50', async () => {
      prismaMock.plan.findMany.mockResolvedValue([
        { code: 'SOLO', monthlyPricePaise: 49900 },
        { code: 'STUDIO', monthlyPricePaise: 99900 },
      ]);
      prismaMock.subscription.count.mockResolvedValue(15);

      const result = await service.getPlansWithAvailability();

      expect(result.foundingAvailable).toBe(true);
      expect(result.plans).toHaveLength(2);
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
    });

    it('returns foundingAvailable: false when count >= 50', async () => {
      prismaMock.plan.findMany.mockResolvedValue([]);
      prismaMock.subscription.count.mockResolvedValue(50);

      const result = await service.getPlansWithAvailability();

      expect(result.foundingAvailable).toBe(false);
    });
  });

  describe('getWorkspaceInvoices', () => {
    it('fetches invoices ordered by createdAt desc with plan included', async () => {
      const mockInvoices = [
        { id: 'inv-1', invoiceNumber: 'INV-2026-00001', createdAt: new Date() },
      ];
      prismaMock.invoice.findMany.mockResolvedValue(mockInvoices);

      const result = await service.getWorkspaceInvoices(mockWorkspaceId);

      expect(prismaMock.invoice.findMany).toHaveBeenCalledWith({
        where: { workspaceId: mockWorkspaceId },
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: {
            include: {
              plan: true,
            },
          },
        },
      });
      expect(result).toEqual(mockInvoices);
    });
  });

  describe('getInvoiceRecord', () => {
    it('returns invoice when found for workspace', async () => {
      const mockInvoice = {
        id: 'inv-1',
        workspaceId: mockWorkspaceId,
        invoiceNumber: 'INV-2026-00001',
      };
      prismaMock.invoice.findFirst.mockResolvedValue(mockInvoice);

      const result = await service.getInvoiceRecord(mockWorkspaceId, 'inv-1');

      expect(prismaMock.invoice.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'inv-1',
          workspaceId: mockWorkspaceId,
        },
        include: {
          workspace: true,
          subscription: {
            include: {
              plan: true,
            },
          },
        },
      });
      expect(result).toEqual(mockInvoice);
    });

    it('throws 404 NotFoundException when invoice does not exist or belongs to another workspace', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.getInvoiceRecord(mockWorkspaceId, 'inv-foreign'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
