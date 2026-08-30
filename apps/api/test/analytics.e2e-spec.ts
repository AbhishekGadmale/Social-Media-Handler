import { APP_GUARD } from '@nestjs/core';
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { PrismaClient, generateId } from '@agency-os/database';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import * as argon2 from '@node-rs/argon2';
import Redis from 'ioredis';
import { encrypt } from '@agency-os/database/src/crypto/encryption';

describe('AnalyticsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;

  let testUser: any;
  let testWorkspaceEditor: string;
  let testWorkspaceNone: string;
  let testWorkspaceOther: string;
  let testOrg: string;
  let sessionCookie: string;
  let csrfToken: string;

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
    })
      .overrideProvider(APP_GUARD)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get<PrismaClient>(PrismaClient);
    redis = app.get<Redis>('REDIS_CLIENT');

    if (
      !process.env.DATABASE_URL ||
      !process.env.DATABASE_URL.includes('test')
    ) {
      throw new Error(
        'SAFETY CHECK FAILED: Tests must run against a test database.',
      );
    }

    const hashedPassword = await argon2.hash('correctpassword');
    testUser = await prisma.user.create({
      data: {
        id: generateId(),
        email: `test-analytics-${generateId()}@example.com`,
        hashedPassword,
      },
    });

    testOrg = generateId();
    await prisma.organization.create({
      data: { id: testOrg, name: 'Test Org Analytics' },
    });

    // 1. Workspace Editor
    testWorkspaceEditor = generateId();
    await prisma.workspace.create({
      data: {
        id: testWorkspaceEditor,
        organizationId: testOrg,
        name: 'Workspace Editor Analytics',
      },
    });
    await prisma.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: testWorkspaceEditor,
        userId: testUser.id,
        role: 'EDITOR',
      },
    });

    // 2. Workspace None (No membership)
    testWorkspaceNone = generateId();
    await prisma.workspace.create({
      data: {
        id: testWorkspaceNone,
        organizationId: testOrg,
        name: 'Workspace None',
      },
    });

    // Setup social accounts & metrics
    const account1 = generateId();
    await prisma.socialAccount.create({
      data: {
        id: account1,
        workspaceId: testWorkspaceEditor,
        provider: 'LINKEDIN',
        externalId: 'ext-11',
        name: 'LinkedIn Acc 1',
        capabilities: ['ACCOUNT_READ'],
        status: 'ACTIVE',
      },
    });

    const token = encrypt('mock-token');
    await prisma.socialConnection.create({
      data: {
        id: generateId(),
        socialAccountId: account1,
        encryptedAccessToken: token.encrypted,
        accessTokenIv: token.iv,
        accessTokenAuthTag: token.authTag,
        keyVersion: token.keyVersion,
      },
    });

    // Create metrics for account 1
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    yesterday.setUTCHours(0, 0, 0, 0);

    await prisma.accountMetricDaily.createMany({
      data: [
        {
          id: generateId(),
          socialAccountId: account1,
          date: yesterday,
          followers: 100,
          engagement: 10,
        },
        {
          id: generateId(),
          socialAccountId: account1,
          date: today,
          followers: 110,
          engagement: 15,
        }, // latest
      ],
    });

    const account2 = generateId();
    await prisma.socialAccount.create({
      data: {
        id: account2,
        workspaceId: testWorkspaceEditor,
        provider: 'YOUTUBE',
        externalId: 'ext-22',
        name: 'YouTube Acc 2',
        capabilities: ['ACCOUNT_READ'],
        status: 'REAUTH_REQUIRED',
      },
    });

    await prisma.accountMetricDaily.createMany({
      data: [
        {
          id: generateId(),
          socialAccountId: account2,
          date: today,
          followers: 500,
          engagement: 20,
        },
      ],
    });

    const account3Empty = generateId();
    await prisma.socialAccount.create({
      data: {
        id: account3Empty,
        workspaceId: testWorkspaceEditor,
        provider: 'TWITTER',
        externalId: 'ext-33',
        name: 'Twitter Acc 3 (No Metrics)',
        capabilities: ['ACCOUNT_READ'],
        status: 'ACTIVE',
      },
    });

    // Login to get session
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: 'correctpassword' });

    if (loginRes.status !== 200) {
      console.log('ANALYTICS LOGIN FAILED:', loginRes.status, loginRes.body);
    }
    const cookies = loginRes.headers['set-cookie'] as any as string[];
    const sessionCookieHeader = cookies.find((c) => c.startsWith('session='));
    const csrfCookieHeader = cookies.find((c) => c.startsWith('csrfToken='));
    sessionCookie = sessionCookieHeader!.split(';')[0];
    csrfToken = csrfCookieHeader!.split(';')[0].split('=')[1];
  });

  afterAll(async () => {
    // Cleanup
    if (prisma && testUser) {
      await prisma.accountMetricDaily.deleteMany({});
      await prisma.socialConnection.deleteMany({});
      await prisma.socialAccount.deleteMany({});
      await prisma.workspaceMember.deleteMany({
        where: { userId: testUser.id },
      });
      await prisma.workspace.delete({ where: { id: testWorkspaceEditor } });
      await prisma.workspace.delete({ where: { id: testWorkspaceNone } });
      await prisma.organization.delete({ where: { id: testOrg } });
      await prisma.user.delete({ where: { id: testUser.id } });
    }

    if (app) {
      await app.close();
    }
  });

  it('GET /api/v1/workspaces/:workspaceId/analytics/overview - fails if unauthenticated', async () => {
    const res = await request(app.getHttpServer()).get(
      `/api/v1/workspaces/${testWorkspaceEditor}/analytics/overview`,
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/workspaces/:workspaceId/analytics/overview - fails if not a member', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${testWorkspaceNone}/analytics/overview`)
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(403);
  });

  it('GET /api/v1/workspaces/:workspaceId/analytics/overview - success returns valid overview', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${testWorkspaceEditor}/analytics/overview`)
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe(testWorkspaceEditor);
    expect(res.body.accountsConnected).toBe(3);
    expect(res.body.accountsActive).toBe(2);
    expect(res.body.accountsRequiringReauth).toBe(1);

    // Aggregation checks
    // Account 1 latest is 110 followers, 15 engagement
    // Account 2 latest is 500 followers, 20 engagement
    // Account 3 has no metrics -> 0
    expect(res.body.totalFollowers).toBe(610);
    expect(res.body.totalEngagement).toBe(35);

    expect(res.body.accounts.length).toBe(3);

    // Ensure no secrets
    const anyAccount = res.body.accounts[0];
    expect(anyAccount.encryptedAccessToken).toBeUndefined();
    expect(anyAccount.connection).toBeUndefined();
  });
});
