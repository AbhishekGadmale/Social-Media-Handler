/* eslint-disable */
import { INestApplication } from '@nestjs/common';
const request = require('supertest');
import * as crypto from 'crypto';
import { PrismaClient, generateId, WorkspaceRole, SubscriptionStatus } from '@agency-os/database';
import { loginAndGetSession, authHeaders } from './helpers';
import * as argon2 from '@node-rs/argon2';
import Redis from 'ioredis';
import { createNestApp } from '../src/main';
import { RazorpayService } from '../src/modules/billing/razorpay.service';
import { BillingService } from '../src/modules/billing/billing.service';

process.env.TOKEN_ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'dummy_webhook_secret_12345';
  const createdWorkspaceIds: string[] = [];

  beforeEach(async () => {
    if (redis) {
      const keys = await redis.keys('throttler:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  });

  beforeAll(async () => {
    // Instantiate app using the real production bootstrap factory from main.ts (F1)
    app = await createNestApp();
    await app.init();

    prisma = app.get<PrismaClient>(PrismaClient);
    redis = app.get<Redis>('REDIS_CLIENT');
    razorpayService = app.get<RazorpayService>(RazorpayService);
    billingService = app.get<BillingService>(BillingService);

    // Mock outgoing Razorpay HTTP calls so tests do not rely on live Razorpay API
    jest.spyOn(razorpayService, 'createPlan').mockImplementation(async (input: any) => ({
      id: `plan_rzp_mock_${input.item.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
    }));
    jest.spyOn(razorpayService, 'createSubscription').mockImplementation(async (input: any) => ({
      id: `sub_rzp_mock_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      status: 'created',
    }));

    // Seed default plans
    await billingService.seedPlans();
    foundingPlan = await prisma.plan.findUnique({
      where: { code: 'AGENCY_FOUNDING' },
    });

    // Create test user and workspace
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
      await prisma.invoice.deleteMany({
        where: { workspaceId: { in: createdWorkspaceIds } },
      });
      await prisma.subscription.deleteMany({
        where: { workspaceId: { in: createdWorkspaceIds } },
      });
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: { in: createdWorkspaceIds } },
      });
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

  describe('Subscription Lifecycle & Razorpay Integration [F2]', () => {
    it('proves subscribe calls Razorpay, stores razorpaySubscriptionId, and webhook activates it', async () => {
      // 1. Subscribe to Studio plan
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${testWorkspace.id}/billing/subscribe`)
        .set(authHeaders(sessionData))
        .send({ planCode: 'STUDIO', interval: 'MONTHLY' })
        .expect(200);

      expect(res.body.workspaceId).toBe(testWorkspace.id);
      expect(res.body.razorpaySubscriptionId).toBeDefined();
      expect(res.body.razorpaySubscriptionId).toContain('sub_rzp_mock');
      expect(res.body.status).toBe(SubscriptionStatus.TRIAL);

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
    });
  });

  describe('Founding-50 Real PostgreSQL Concurrency Lock [F3]', () => {
    it('when count is 49 and 2 parallel requests hit: exactly 1 succeeds, 1 gets 409 conflict', async () => {
      // Pre-seed 49 founding subscriptions in Postgres
      // First clean any prior founding subscriptions
      await prisma.subscription.deleteMany({ where: { isFounding: true } });

      const dummyWsIds: string[] = [];
      for (let i = 0; i < 49; i++) {
        const dId = generateId();
        dummyWsIds.push(dId);
        createdWorkspaceIds.push(dId);
        await prisma.workspace.create({
          data: {
            id: dId,
            organizationId: testOrg.id,
            name: `Founding Seat ${i + 1}`,
          },
        });
        await prisma.subscription.create({
          data: {
            id: generateId(),
            workspaceId: dId,
            planId: foundingPlan.id,
            isFounding: true,
            status: SubscriptionStatus.ACTIVE,
            billingInterval: 'MONTHLY',
          },
        });
      }

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

      await prisma.workspace.create({
        data: { id: wsCandidate1, organizationId: testOrg.id, name: 'Candidate 1' },
      });
      await prisma.workspaceMember.create({
        data: { id: generateId(), workspaceId: wsCandidate1, userId: testUser.id, role: WorkspaceRole.OWNER },
      });

      await prisma.workspace.create({
        data: { id: wsCandidate2, organizationId: testOrg.id, name: 'Candidate 2' },
      });
      await prisma.workspaceMember.create({
        data: { id: generateId(), workspaceId: wsCandidate2, userId: testUser.id, role: WorkspaceRole.OWNER },
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
      expect(conflictRes.body.message).toContain('FOUNDING_PLAN_SOLD_OUT');

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
});
