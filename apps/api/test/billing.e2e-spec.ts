/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { PrismaClient, generateId, WorkspaceRole } from '@agency-os/database';
import { loginAndGetSession, authHeaders } from './helpers';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { PinoLogger } from 'nestjs-pino';
import * as argon2 from '@node-rs/argon2';
import Redis from 'ioredis';

describe('BillingController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;

  let testUser: any;
  let testWorkspace: any;
  let testOrg: any;
  let sessionData: any;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'dummy_webhook_secret_12345';

  beforeEach(async () => {
    if (redis) {
      const keys = await redis.keys('throttler:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter(await app.resolve(PinoLogger)));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = app.get<PrismaClient>(PrismaClient);
    redis = app.get<Redis>('REDIS_CLIENT');

    // Create test user and workspace
    const orgId = generateId();
    const wsId = generateId();
    const userId = generateId();

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
    if (testWorkspace?.id) {
      await prisma.invoice.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await prisma.subscription.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await prisma.workspace.deleteMany({ where: { id: testWorkspace.id } });
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

  describe('Webhook Endpoint (/api/v1/billing/webhook)', () => {
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

    it('successfully ingests valid webhook and handles deduplication', async () => {
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

  describe('Workspace Billing & Entitlements (/api/v1/workspaces/:workspaceId/billing)', () => {
    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing`)
        .expect(401);
    });

    it('returns billing status and Agency entitlements during active trial', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing`)
        .set(authHeaders(sessionData))
        .expect(200);

      expect(res.body.workspaceId).toBe(testWorkspace.id);
      expect(res.body.entitlements.isReadOnly).toBe(false);
      expect(res.body.entitlements.isTrial).toBe(true);
      expect(res.body.entitlements.seats).toBe(10);
      expect(res.body.entitlements.planCode).toBe('AGENCY_TRIAL');
    });

    it('subscribes to Studio plan', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${testWorkspace.id}/billing/subscribe`)
        .set(authHeaders(sessionData))
        .send({ planCode: 'STUDIO', interval: 'MONTHLY' })
        .expect(200);

      expect(res.body.workspaceId).toBe(testWorkspace.id);
      expect(res.body.isFounding).toBe(false);
    });
  });
});
