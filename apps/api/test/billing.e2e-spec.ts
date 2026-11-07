/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
const request = require('supertest');
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaClient, generateId, WorkspaceRole, SubscriptionStatus } from '@agency-os/database';
import { loginAndGetSession, authHeaders } from './helpers';
import * as argon2 from '@node-rs/argon2';
import Redis from 'ioredis';
import { NEST_APP_OPTIONS, configureApp } from '../src/main';
import { RazorpayService } from '../src/modules/billing/razorpay.service';
import { BillingService } from '../src/modules/billing/billing.service';

jest.setTimeout(30000);

describe('BillingController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let razorpayService: RazorpayService;
  let billingService: BillingService;

  let testUser: any;
  let testWorkspace: any;
  let testOrg: any;
  let sessionData: any;
  let foundingPlan: any;
  let webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'dummy_webhook_secret_12345';
  const createdWorkspaceIds: string[] = [];

  beforeEach(async () => {
    if (redis) {
      const keys = await redis.keys('throttler:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }

    if (razorpayService) {
      jest.spyOn(razorpayService, 'createPlan').mockImplementation(async (input: any) => ({
        id: `plan_rzp_mock_${input.item.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      }));
      jest.spyOn(razorpayService, 'createSubscription').mockImplementation(async (input: any) => ({
        id: `sub_rzp_mock_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        status: 'created',
        short_url: 'https://rzp.io/i/sub_mock_url',
      }));
      jest.spyOn(razorpayService, 'cancelSubscription').mockImplementation(async (subId: string, atCycleEnd: boolean) => ({
        id: subId,
        status: 'cancelled',
      }));
    }
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Uses shared NEST_APP_OPTIONS ({ bufferLogs: true, rawBody: true }) and configureApp helper from main.ts (F1)
    app = moduleFixture.createNestApplication(NEST_APP_OPTIONS);
    await configureApp(app);
    await app.init();

    prisma = app.get<PrismaClient>(PrismaClient);
    redis = app.get<Redis>('REDIS_CLIENT');
    razorpayService = app.get<RazorpayService>(RazorpayService);
    billingService = app.get<BillingService>(BillingService);
    webhookSecret = (razorpayService as any).webhookSecret || webhookSecret;

    jest.spyOn(razorpayService, 'createPlan').mockImplementation(async (input: any) => ({
      id: `plan_rzp_mock_${input.item.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
    }));
    jest.spyOn(razorpayService, 'createSubscription').mockImplementation(async (input: any) => ({
      id: `sub_rzp_mock_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      status: 'created',
      short_url: 'https://rzp.io/i/sub_mock_url',
    }));
    jest.spyOn(razorpayService, 'cancelSubscription').mockImplementation(async (subId: string, atCycleEnd: boolean) => ({
      id: subId,
      status: 'cancelled',
    }));

    await billingService.seedPlans();
    foundingPlan = await prisma.plan.findUnique({
      where: { code: 'AGENCY_FOUNDING' },
    });

    const orgId = generateId();
    const wsId = generateId();
    const userId = generateId();
    createdWorkspaceIds.push(wsId);

    testOrg = await prisma.organization.create({
      data: { id: orgId, name: 'Billing Test Org' },
    });

    testWorkspace = await prisma.workspace.create({
      data: {
        id: wsId,
        organizationId: orgId,
        name: 'Billing Test Workspace',
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

    const hashedPassword = await argon2.hash('password');
    testUser = await prisma.user.create({
      data: {
        id: userId,
        email: `billing-${Date.now()}@test.com`,
        hashedPassword,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        securityEpoch: 1,
      },
    });

    await prisma.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: wsId,
        userId,
        role: WorkspaceRole.OWNER,
      },
    });

    sessionData = await loginAndGetSession(app, testUser.email, 'password');
  });

  afterAll(async () => {
    if (createdWorkspaceIds.length > 0) {
      await prisma.workspace.deleteMany({
        where: { id: { in: createdWorkspaceIds } },
      });
    }
    if (testOrg?.id) {
      await prisma.organization.deleteMany({ where: { id: testOrg.id } });
    }
    if (testUser?.id) {
      await prisma.user.deleteMany({ where: { id: testUser.id } });
    }
    if (app) {
      await app.close();
    }
  });

  describe('Webhook Endpoint (/api/v1/billing/webhook) [F1]', () => {
    it('returns 400 when x-razorpay-signature header is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/billing/webhook')
        .send({ event: 'subscription.charged' })
        .expect(400);
    });

    it('returns 400 when x-razorpay-signature is invalid', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/billing/webhook')
        .set('x-razorpay-signature', 'badsignature123')
        .send({ event: 'subscription.charged' })
        .expect(400);
    });

    it('successfully ingests valid webhook and handles deduplication using raw body', async () => {
      const eventPayload = {
        id: `evt_${Date.now()}_test`,
        entity: 'event',
        event: 'subscription.charged',
        payload: {
          subscription: {
            entity: {
              id: 'sub_test_e2e_123',
              status: 'active',
              current_start: Math.floor(Date.now() / 1000),
              current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            },
          },
          payment: {
            entity: {
              id: `pay_${Date.now()}_test`,
              amount: 99900, // ₹999
              status: 'captured',
            },
          },
        },
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      // First delivery -> 200 OK
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/billing/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);

      expect(res1.body.status).toBe('ok');
      expect(res1.body.eventId).toBe(eventPayload.id);

      // Replayed delivery -> 200 OK with duplicate: true
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/billing/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);

      expect(res2.body.duplicate).toBe(true);
    });
  });

  describe('Subscription Lifecycle & Razorpay Integration [F2, F5]', () => {
    it('proves MONTHLY subscribe calls Razorpay with monthly plan, returns short_url, and webhook activates it', async () => {
      const studioPlan = await prisma.plan.findUnique({ where: { code: 'STUDIO' } });
      expect(studioPlan?.razorpayPlanId).toBeDefined();
      expect(studioPlan?.razorpayAnnualPlanId).toBeDefined();

      // 1. Subscribe to Studio plan (MONTHLY)
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${testWorkspace.id}/billing/subscribe`)
        .set(authHeaders(sessionData))
        .send({ planCode: 'STUDIO', interval: 'MONTHLY' })
        .expect(200);

      expect(res.body.workspaceId).toBe(testWorkspace.id);
      expect(res.body.razorpaySubscriptionId).toBeDefined();
      expect(res.body.razorpaySubscriptionId).toContain('sub_rzp_mock');
      expect(res.body.razorpayPlanId).toBe(studioPlan!.razorpayPlanId);
      expect(res.body.billingInterval).toBe('MONTHLY');
      expect(res.body.status).toBe(SubscriptionStatus.TRIAL);
      expect(res.body.short_url).toBe('https://rzp.io/i/sub_mock_url');
      expect(res.body.shortUrl).toBe('https://rzp.io/i/sub_mock_url');

      const rzpSubId = res.body.razorpaySubscriptionId;

      // 2. Incoming subscription.authenticated webhook from Razorpay
      const authEventPayload = {
        id: `evt_auth_${Date.now()}`,
        entity: 'event',
        event: 'subscription.authenticated',
        payload: {
          subscription: {
            entity: {
              id: rzpSubId,
              status: 'active',
              current_start: Math.floor(Date.now() / 1000),
              current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            },
          },
        },
      };

      const rawBody = JSON.stringify(authEventPayload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      await request(app.getHttpServer())
        .post('/api/v1/billing/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);

      // 3. Assert local subscription flipped to ACTIVE
      const updatedSub = await prisma.subscription.findUnique({
        where: { workspaceId: testWorkspace.id },
      });
      expect(updatedSub?.status).toBe(SubscriptionStatus.ACTIVE);
      expect(updatedSub?.razorpaySubscriptionId).toBe(rzpSubId);
      expect(updatedSub?.razorpayPlanId).toBe(studioPlan!.razorpayPlanId);
    });

    it('proves ANNUAL subscribe calls Razorpay with yearly plan, totalCount 10, and returns short_url [F5]', async () => {
      const studioPlan = await prisma.plan.findUnique({ where: { code: 'STUDIO' } });
      const annualWsId = generateId();
      createdWorkspaceIds.push(annualWsId);

      await prisma.workspace.create({
        data: {
          id: annualWsId,
          organizationId: testOrg.id,
          name: 'Annual Billing Test Workspace',
        },
      });
      await prisma.workspaceMember.create({
        data: {
          id: generateId(),
          workspaceId: annualWsId,
          userId: testUser.id,
          role: WorkspaceRole.OWNER,
        },
      });

      const createSubSpy = jest.spyOn(razorpayService, 'createSubscription');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${annualWsId}/billing/subscribe`)
        .set(authHeaders(sessionData))
        .send({ planCode: 'STUDIO', interval: 'ANNUAL' })
        .expect(200);

      expect(res.body.workspaceId).toBe(annualWsId);
      expect(res.body.billingInterval).toBe('ANNUAL');
      expect(res.body.razorpayPlanId).toBe(studioPlan!.razorpayAnnualPlanId);
      expect(res.body.short_url).toBe('https://rzp.io/i/sub_mock_url');
      expect(res.body.shortUrl).toBe('https://rzp.io/i/sub_mock_url');

      expect(createSubSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: studioPlan!.razorpayAnnualPlanId,
          totalCount: 10,
          notes: expect.objectContaining({
            workspaceId: annualWsId,
            planCode: 'STUDIO',
            interval: 'ANNUAL',
          }),
        }),
      );

      const savedSub = await prisma.subscription.findUnique({
        where: { workspaceId: annualWsId },
      });
      expect(savedSub?.billingInterval).toBe('ANNUAL');
      expect(savedSub?.razorpayPlanId).toBe(studioPlan!.razorpayAnnualPlanId);
    });
  });

  describe('Founding-50 Real PostgreSQL Concurrency Lock [F3]', () => {
    it('when count is 49 and 2 parallel requests hit: exactly 1 succeeds, 1 gets 409 conflict', async () => {
      // Clean previous founding subscriptions from test workspaces
      await prisma.subscription.deleteMany({ where: { isFounding: true } });

      // Fast batch pre-seed of 49 founding subscriptions in Postgres
      const dummyWorkspaces = [];
      const dummySubscriptions = [];
      for (let i = 0; i < 49; i++) {
        const dId = generateId();
        createdWorkspaceIds.push(dId);
        dummyWorkspaces.push({
          id: dId,
          organizationId: testOrg.id,
          name: `Founding Seat ${i + 1}`,
        });
        dummySubscriptions.push({
          id: generateId(),
          workspaceId: dId,
          planId: foundingPlan.id,
          isFounding: true,
          status: SubscriptionStatus.ACTIVE,
          billingInterval: 'MONTHLY' as const,
        });
      }

      await prisma.workspace.createMany({ data: dummyWorkspaces });
      await prisma.subscription.createMany({ data: dummySubscriptions });

      // Verify count is 49
      const preCount = await prisma.subscription.count({
        where: {
          isFounding: true,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE] },
        },
      });
      expect(preCount).toBe(49);

      // Create two candidate workspaces for testUser
      const wsCandidate1 = generateId();
      const wsCandidate2 = generateId();
      createdWorkspaceIds.push(wsCandidate1, wsCandidate2);

      await prisma.workspace.createMany({
        data: [
          { id: wsCandidate1, organizationId: testOrg.id, name: 'Candidate 1' },
          { id: wsCandidate2, organizationId: testOrg.id, name: 'Candidate 2' },
        ],
      });
      await prisma.workspaceMember.createMany({
        data: [
          { id: generateId(), workspaceId: wsCandidate1, userId: testUser.id, role: WorkspaceRole.OWNER },
          { id: generateId(), workspaceId: wsCandidate2, userId: testUser.id, role: WorkspaceRole.OWNER },
        ],
      });

      // Fire 2 concurrent claims
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/workspaces/${wsCandidate1}/billing/subscribe`)
          .set(authHeaders(sessionData))
          .send({ planCode: 'AGENCY_FOUNDING', interval: 'MONTHLY' }),
        request(app.getHttpServer())
          .post(`/api/v1/workspaces/${wsCandidate2}/billing/subscribe`)
          .set(authHeaders(sessionData))
          .send({ planCode: 'AGENCY_FOUNDING', interval: 'MONTHLY' }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);

      const conflictRes = resA.status === 409 ? resA : resB;
      const conflictMessage =
        conflictRes.body.error?.message || conflictRes.body.message;
      expect(conflictMessage).toContain('FOUNDING_PLAN_SOLD_OUT');

      const successRes = resA.status === 200 ? resA : resB;
      expect(successRes.body.short_url).toBe('https://rzp.io/i/sub_mock_url');
      expect(successRes.body.shortUrl).toBe('https://rzp.io/i/sub_mock_url');

      // Assert total count in database is strictly 50
      const postCount = await prisma.subscription.count({
        where: {
          isFounding: true,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE] },
        },
      });
      expect(postCount).toBe(50);
    });
  });

  describe('Webhook Concurrency & Idempotent Invoicing [F4]', () => {
    it('concurrent duplicate webhook delivery creates exactly one invoice and returns 200 for both', async () => {
      const eventId = `evt_concurrent_${Date.now()}`;
      const paymentId = `pay_concurrent_${Date.now()}`;
      const subId = `sub_rzp_concurrent_${Date.now()}`;

      // Reset subscription for testWorkspace
      await prisma.subscription.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await prisma.subscription.create({
        data: {
          id: generateId(),
          workspaceId: testWorkspace.id,
          planId: foundingPlan.id,
          razorpaySubscriptionId: subId,
          status: SubscriptionStatus.ACTIVE,
        },
      });

      const eventPayload = {
        id: eventId,
        entity: 'event',
        event: 'subscription.charged',
        payload: {
          subscription: {
            entity: {
              id: subId,
              status: 'active',
              current_start: Math.floor(Date.now() / 1000),
              current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            },
          },
          payment: {
            entity: {
              id: paymentId,
              amount: 299900, // ₹2,999
              status: 'captured',
            },
          },
        },
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/billing/webhook')
          .set('x-razorpay-signature', signature)
          .set('Content-Type', 'application/json')
          .send(rawBody),
        request(app.getHttpServer())
          .post('/api/v1/billing/webhook')
          .set('x-razorpay-signature', signature)
          .set('Content-Type', 'application/json')
          .send(rawBody),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Verify exactly one invoice was recorded for this paymentId
      const invoices = await prisma.invoice.findMany({
        where: { razorpayPaymentId: paymentId },
      });
      expect(invoices.length).toBe(1);
      expect(invoices[0].amountPaise).toBe(299900);
    });

    it('crash recovery: re-processing an uncompleted event does not duplicate invoices', async () => {
      const eventId = `evt_crash_${Date.now()}`;
      const paymentId = `pay_crash_${Date.now()}`;
      const subId = `sub_rzp_crash_${Date.now()}`;

      await prisma.subscription.deleteMany({ where: { workspaceId: testWorkspace.id } });
      const sub = await prisma.subscription.create({
        data: {
          id: generateId(),
          workspaceId: testWorkspace.id,
          planId: foundingPlan.id,
          razorpaySubscriptionId: subId,
          status: SubscriptionStatus.ACTIVE,
        },
      });

      // Pre-seed an invoice simulating completion before crash
      const preInvoice = await prisma.invoice.create({
        data: {
          id: generateId(),
          workspaceId: testWorkspace.id,
          subscriptionId: sub.id,
          invoiceNumber: `INV-CRASH-${Date.now()}`,
          amountPaise: 299900,
          baseAmountPaise: 254153,
          gstAmountPaise: 45747,
          gstRate: 18,
          gstin: '27TESTGSTIN0001',
          razorpayPaymentId: paymentId,
          status: 'PAID',
        },
      });

      // Pre-seed webhook event record with processed: false simulating crash before marking processed
      await prisma.webhookEvent.create({
        data: {
          id: generateId(),
          eventId,
          provider: 'RAZORPAY',
          payload: {},
          processed: false,
        },
      });

      const eventPayload = {
        id: eventId,
        entity: 'event',
        event: 'subscription.charged',
        payload: {
          subscription: {
            entity: {
              id: subId,
              status: 'active',
            },
          },
          payment: {
            entity: {
              id: paymentId,
              amount: 299900,
            },
          },
        },
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      const res = await request(app.getHttpServer())
        .post('/api/v1/billing/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);

      expect(res.body.status).toBe('ok');

      // Verify only 1 invoice exists for that paymentId
      const invoices = await prisma.invoice.findMany({
        where: { razorpayPaymentId: paymentId },
      });
      expect(invoices.length).toBe(1);
      expect(invoices[0].id).toBe(preInvoice.id);

      // Verify webhook event is now marked processed
      const evt = await prisma.webhookEvent.findUnique({ where: { eventId } });
      expect(evt?.processed).toBe(true);
    });
  });

  describe('Workspace Billing & Entitlements (/api/v1/workspaces/:workspaceId/billing)', () => {
    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing`)
        .expect(401);
    });

    it('returns billing status and entitlements', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing`)
        .set(authHeaders(sessionData))
        .expect(200);

      expect(res.body.workspaceId).toBe(testWorkspace.id);
      expect(res.body.entitlements.isReadOnly).toBe(false);
    });
  });

  describe('Subscription Cancellation (/api/v1/workspaces/:workspaceId/billing/cancel)', () => {
    it('cancels subscription at period end and retains access until cycle ends', async () => {
      const cancelSpy = jest.spyOn(razorpayService, 'cancelSubscription');

      const subId = `sub_cancel_${Date.now()}`;
      await prisma.subscription.upsert({
        where: { workspaceId: testWorkspace.id },
        update: {
          razorpaySubscriptionId: subId,
          status: SubscriptionStatus.ACTIVE,
          isFounding: true,
          cancelAtPeriodEnd: false,
        },
        create: {
          id: generateId(),
          workspaceId: testWorkspace.id,
          planId: foundingPlan.id,
          razorpaySubscriptionId: subId,
          status: SubscriptionStatus.ACTIVE,
          isFounding: true,
          cancelAtPeriodEnd: false,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${testWorkspace.id}/billing/cancel`)
        .set(authHeaders(sessionData))
        .send({ cancelAtPeriodEnd: true })
        .expect(200);

      expect(res.body.cancelAtPeriodEnd).toBe(true);
      expect(res.body.isFounding).toBe(false);
      expect(res.body.status).toBe(SubscriptionStatus.ACTIVE);
      expect(cancelSpy).toHaveBeenCalledWith(subId, true);

      const billingStatusRes = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing`)
        .set(authHeaders(sessionData))
        .expect(200);

      expect(billingStatusRes.body.entitlements.isReadOnly).toBe(false);
      expect(billingStatusRes.body.subscription.cancelAtPeriodEnd).toBe(true);
    });
  });

  describe('Plans API (/api/v1/workspaces/:workspaceId/billing/plans)', () => {
    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing/plans`)
        .expect(401);
    });

    it('returns 4 plans with integer paise prices and foundingAvailable flag', async () => {
      // Clean all founding subscriptions to ensure availability
      await prisma.subscription.deleteMany({ where: { isFounding: true } });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing/plans`)
        .set(authHeaders(sessionData))
        .expect(200);

      expect(Array.isArray(res.body.plans)).toBe(true);
      expect(res.body.plans.length).toBe(4);
      expect(res.body.foundingAvailable).toBe(true);

      const solo = res.body.plans.find((p: any) => p.code === 'SOLO');
      expect(solo).toBeDefined();
      expect(solo.monthlyPricePaise).toBe(49900);
      expect(solo.annualPricePaise).toBe(499000);
      expect(solo.seats).toBe(1);

      const studio = res.body.plans.find((p: any) => p.code === 'STUDIO');
      expect(studio).toBeDefined();
      expect(studio.monthlyPricePaise).toBe(99900);
      expect(studio.annualPricePaise).toBe(999000);
      expect(studio.seats).toBe(3);

      const agency = res.body.plans.find((p: any) => p.code === 'AGENCY');
      expect(agency).toBeDefined();
      expect(agency.monthlyPricePaise).toBe(399900);
      expect(agency.annualPricePaise).toBe(3999000);

      const founding = res.body.plans.find((p: any) => p.code === 'AGENCY_FOUNDING');
      expect(founding).toBeDefined();
      expect(founding.monthlyPricePaise).toBe(299900);
      expect(founding.annualPricePaise).toBe(2999000);
    });

    it('marks foundingAvailable as false when 50 active founding seats exist', async () => {
      const dummyWorkspaces = [];
      const dummySubs = [];
      for (let i = 0; i < 50; i++) {
        const id = generateId();
        createdWorkspaceIds.push(id);
        dummyWorkspaces.push({
          id,
          organizationId: testOrg.id,
          name: `Founding Holder ${i}`,
        });
        dummySubs.push({
          id: generateId(),
          workspaceId: id,
          planId: foundingPlan.id,
          isFounding: true,
          status: SubscriptionStatus.ACTIVE,
        });
      }
      await prisma.workspace.createMany({ data: dummyWorkspaces });
      await prisma.subscription.createMany({ data: dummySubs });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing/plans`)
        .set(authHeaders(sessionData))
        .expect(200);

      expect(res.body.foundingAvailable).toBe(false);

      await prisma.subscription.deleteMany({
        where: { workspaceId: { in: dummyWorkspaces.map((w) => w.id) } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: dummyWorkspaces.map((w) => w.id) } },
      });
    });
  });

  describe('Invoices API (/api/v1/workspaces/:workspaceId/billing/invoices)', () => {
    it('returns workspace invoices newest first with subscription/plan details in paise', async () => {
      const invoiceWsId = generateId();
      createdWorkspaceIds.push(invoiceWsId);

      await prisma.workspace.create({
        data: {
          id: invoiceWsId,
          organizationId: testOrg.id,
          name: 'Invoices Test Workspace',
        },
      });
      await prisma.workspaceMember.create({
        data: {
          id: generateId(),
          workspaceId: invoiceWsId,
          userId: testUser.id,
          role: WorkspaceRole.OWNER,
        },
      });

      const now = Date.now();
      const inv1 = await prisma.invoice.create({
        data: {
          id: generateId(),
          workspaceId: invoiceWsId,
          invoiceNumber: `INV-E2E-OLD-${now}`,
          amountPaise: 49900,
          baseAmountPaise: 42288,
          gstAmountPaise: 7612,
          gstRate: 18,
          gstin: '27TESTGSTIN0001',
          razorpayPaymentId: `pay_old_${now}`,
          status: 'PAID',
          createdAt: new Date(now - 10000),
        },
      });

      const inv2 = await prisma.invoice.create({
        data: {
          id: generateId(),
          workspaceId: invoiceWsId,
          invoiceNumber: `INV-E2E-NEW-${now}`,
          amountPaise: 99900,
          baseAmountPaise: 84661,
          gstAmountPaise: 15239,
          gstRate: 18,
          gstin: '27TESTGSTIN0001',
          razorpayPaymentId: `pay_new_${now}`,
          status: 'PAID',
          createdAt: new Date(now),
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${invoiceWsId}/billing/invoices`)
        .set(authHeaders(sessionData))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].id).toBe(inv2.id);
      expect(res.body[1].id).toBe(inv1.id);
      expect(res.body[0].amountPaise).toBe(99900);
      expect(res.body[0].invoiceNumber).toBe(`INV-E2E-NEW-${now}`);
    });
  });

  describe('PDF Invoice Generation & Tenant Isolation (/api/v1/workspaces/:workspaceId/billing/invoices/:invoiceId/pdf)', () => {
    let testInvoice: any;
    let otherWorkspace: any;
    let otherInvoice: any;

    beforeAll(async () => {
      const otherWsId = generateId();
      createdWorkspaceIds.push(otherWsId);

      otherWorkspace = await prisma.workspace.create({
        data: {
          id: otherWsId,
          organizationId: testOrg.id,
          name: 'Other Tenant Workspace',
        },
      });

      testInvoice = await prisma.invoice.create({
        data: {
          id: generateId(),
          workspaceId: testWorkspace.id,
          invoiceNumber: `INV-PDF-${Date.now()}`,
          amountPaise: 299900,
          baseAmountPaise: 254153,
          gstAmountPaise: 45747,
          gstRate: 18,
          gstin: '27AABCU9603R1ZM',
          razorpayPaymentId: `pay_pdf_${Date.now()}`,
          status: 'PAID',
        },
      });

      otherInvoice = await prisma.invoice.create({
        data: {
          id: generateId(),
          workspaceId: otherWorkspace.id,
          invoiceNumber: `INV-OTHER-${Date.now()}`,
          amountPaise: 99900,
          baseAmountPaise: 84661,
          gstAmountPaise: 15239,
          gstRate: 18,
          gstin: '27AABCU9603R1ZM',
          razorpayPaymentId: `pay_other_${Date.now()}`,
          status: 'PAID',
        },
      });
    });

    it('streams generated PDF with correct headers and content', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing/invoices/${testInvoice.id}/pdf`)
        .set(authHeaders(sessionData))
        .buffer(true)
        .parse((response: any, callback: any) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `inline; filename="invoice-${testInvoice.invoiceNumber}.pdf"`,
      );
      expect(Number(res.headers['content-length'])).toBeGreaterThan(0);

      const buffer: Buffer = res.body;
      expect(buffer.subarray(0, 5).toString('utf-8')).toBe('%PDF-');
    });

    it('returns 400 when invoiceId is not a valid UUID', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing/invoices/not-a-valid-uuid/pdf`)
        .set(authHeaders(sessionData))
        .expect(400);
    });

    it('returns 404 when invoice does not exist', async () => {
      const nonExistentUuid = generateId();
      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing/invoices/${nonExistentUuid}/pdf`)
        .set(authHeaders(sessionData))
        .expect(404);
    });

    it('returns 404 (NOT 403) for tenant isolation when accessing another workspace invoice', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing/invoices/${otherInvoice.id}/pdf`)
        .set(authHeaders(sessionData))
        .expect(404);

      expect(res.body.message || res.body.error?.message).toContain('not found');
    });
  });
});
