/* eslint-disable */
import { APP_GUARD } from '@nestjs/core';
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from './../src/app.module';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { PrismaClient, generateId, SocialAccountRepository } from '@agency-os/database';
import { loginAndGetSession } from './helpers';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { PinoLogger } from 'nestjs-pino';
import * as argon2 from '@node-rs/argon2';
import Redis from 'ioredis';
import { encrypt } from '@agency-os/database/src/crypto/encryption';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

describe('AccountsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;

  let testUser: any;
  let testWorkspaceEditor: string;
  let testWorkspaceNone: string;
  let testWorkspaceOther: string;
  let testOrg: string;
  let sessionData: any;

  let accountWorkspaceEditor: string;
  let accountWorkspaceOther: string;
  let testWorkspaceOwner: string = '';
  let accountWorkspaceOwner: string = '';

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

      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter(await app.resolve(PinoLogger)));
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
        email: `test-${generateId()}@example.com`,
        hashedPassword,
        emailVerified: true,
        securityEpoch: 1,
      },
    });

    testOrg = generateId();
    await prisma.organization.create({
      data: { id: testOrg, name: 'Test Org' },
    });

    // 1. Workspace Editor (Has accounts.view because EDITOR has it)
    testWorkspaceEditor = generateId();
    await prisma.workspace.create({
      data: {
        id: testWorkspaceEditor,
        organizationId: testOrg,
        name: 'Workspace Editor',
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

    // 3. Workspace Other (User is not a member)
    testWorkspaceOther = generateId();
    await prisma.workspace.create({
      data: {
        id: testWorkspaceOther,
        organizationId: testOrg,
        name: 'Workspace Other',
      },
    });

    // Setup social accounts
    accountWorkspaceEditor = generateId();
    await prisma.socialAccount.create({
      data: {
        id: accountWorkspaceEditor,
        workspaceId: testWorkspaceEditor,
        provider: 'LINKEDIN',
        externalId: 'ext-1',
        name: 'My LinkedIn',
        capabilities: ['ACCOUNT_READ'],
        status: 'ACTIVE',
      },
    });

    const token = encrypt('mock-token');
    await prisma.socialConnection.create({
      data: {
        id: generateId(),
        socialAccountId: accountWorkspaceEditor,
        encryptedAccessToken: token.encrypted,
        accessTokenIv: token.iv,
        accessTokenAuthTag: token.authTag,
        keyVersion: token.keyVersion,
      },
    });

    accountWorkspaceOther = generateId();
    await prisma.socialAccount.create({
      data: {
        id: accountWorkspaceOther,
        workspaceId: testWorkspaceOther,
        provider: 'YOUTUBE',
        externalId: 'ext-2',
        name: 'Other YouTube',
        capabilities: ['ACCOUNT_READ'],
        status: 'ACTIVE',
      },
    });

    const token2 = encrypt('mock-token-2');
    await prisma.socialConnection.create({
      data: {
        id: generateId(),
        socialAccountId: accountWorkspaceOther,
        encryptedAccessToken: token2.encrypted,
        accessTokenIv: token2.iv,
        accessTokenAuthTag: token2.authTag,
        keyVersion: token2.keyVersion,
      },
    });

        // 4. Workspace Owner (Has accounts.disconnect because OWNER has all permissions)
    testWorkspaceOwner = generateId();
    await prisma.workspace.create({
      data: {
        id: testWorkspaceOwner,
        organizationId: testOrg,
        name: 'Workspace Owner',
      },
    });
    await prisma.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: testWorkspaceOwner,
        userId: testUser.id,
        role: 'OWNER',
      },
    });

    accountWorkspaceOwner = generateId();
    await prisma.socialAccount.create({
      data: {
        id: accountWorkspaceOwner,
        workspaceId: testWorkspaceOwner,
        provider: 'LINKEDIN',
        externalId: 'ext-owner-1',
        name: 'Owner LinkedIn',
        capabilities: ['ACCOUNT_READ'],
        status: 'ACTIVE',
      },
    });

    const tokenOwner = encrypt('mock-owner-token');
    await prisma.socialConnection.create({
      data: {
        id: generateId(),
        socialAccountId: accountWorkspaceOwner,
        encryptedAccessToken: tokenOwner.encrypted,
        accessTokenIv: tokenOwner.iv,
        accessTokenAuthTag: tokenOwner.authTag,
        keyVersion: tokenOwner.keyVersion,
      },
    });

    sessionData = await loginAndGetSession(
      app,
      testUser.email,
      'correctpassword',
    );
  });

  afterAll(async () => {
    // Cleanup
    if (prisma && testUser) {
      await prisma.socialConnection.deleteMany({});
      await prisma.socialAccount.deleteMany({});
      await prisma.workspaceMember.deleteMany({
        where: { userId: testUser.id },
      });
      await prisma.workspace.delete({ where: { id: testWorkspaceOwner } }).catch(() => {});
      await prisma.workspace.delete({ where: { id: testWorkspaceEditor } });
      await prisma.workspace.delete({ where: { id: testWorkspaceNone } });
      await prisma.workspace.delete({ where: { id: testWorkspaceOther } });
      await prisma.organization.delete({ where: { id: testOrg } });
      await prisma.user.delete({ where: { id: testUser.id } });
    }

    if (app) {
      await app.close();
    }
  });

  it('GET /api/v1/workspaces/:workspaceId/accounts - fails if unauthenticated', async () => {
    const res = await request(app.getHttpServer()).get(
      `/api/v1/workspaces/${testWorkspaceEditor}/accounts`,
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/workspaces/:workspaceId/accounts - fails if not a member (WorkspaceGuard)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${testWorkspaceNone}/accounts`)
      .set('Cookie', sessionData.combinedCookie)
      .set('x-csrf-token', sessionData.csrfToken);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain(
      'User is not a member of this workspace',
    );
  });

  it('GET /api/v1/workspaces/:workspaceId/accounts - cross-workspace leakage fails', async () => {
    // Even if I am authenticated, if I try to access `testWorkspaceOther`, it should fail
    const res = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${testWorkspaceOther}/accounts`)
      .set('Cookie', sessionData.combinedCookie)
      .set('x-csrf-token', sessionData.csrfToken);
    expect(res.status).toBe(403);
  });

  it('GET /api/v1/workspaces/:workspaceId/accounts - success returns accounts without credentials', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${testWorkspaceEditor}/accounts`)
      .set('Cookie', sessionData.combinedCookie)
      .set('x-csrf-token', sessionData.csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.accounts).toBeDefined();
    expect(res.body.accounts.length).toBe(1);

    const account = res.body.accounts[0];
    expect(account.id).toBe(accountWorkspaceEditor);
    expect(account.workspaceId).toBe(testWorkspaceEditor);
    expect(account.provider).toBe('LINKEDIN');
    expect(account.name).toBe('My LinkedIn');

    // Ensure no credentials leak
    expect(account.encryptedAccessToken).toBeUndefined();
    expect(account.encryptedRefreshToken).toBeUndefined();
    expect(account.accessTokenIv).toBeUndefined();
    expect(account.accessTokenAuthTag).toBeUndefined();
    expect(account.connection).toBeUndefined();
  });

  it('POST /api/v1/workspaces/:workspaceId/accounts/:accountId/sync - fails with 404 and does NOT queue job for cross-workspace account', async () => {
    const syncQueue = app.get<Queue>(getQueueToken('sync'));
    const addSpy = jest.spyOn(syncQueue, 'add');

    const res = await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${testWorkspaceEditor}/accounts/${accountWorkspaceOther}/sync`,
      )
      .set('Cookie', sessionData.combinedCookie)
      .set('x-csrf-token', sessionData.csrfToken);

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Account not found in workspace');
    expect(addSpy).not.toHaveBeenCalled();

    addSpy.mockRestore();
  });

  it('POST /api/v1/workspaces/:workspaceId/accounts/:accountId/sync - fails with 404 and does NOT queue job for non-existent account', async () => {
    const syncQueue = app.get<Queue>(getQueueToken('sync'));
    const addSpy = jest.spyOn(syncQueue, 'add');
    const nonExistentAccountId = generateId();

    const res = await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${testWorkspaceEditor}/accounts/${nonExistentAccountId}/sync`,
      )
      .set('Cookie', sessionData.combinedCookie)
      .set('x-csrf-token', sessionData.csrfToken);

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Account not found in workspace');
    expect(addSpy).not.toHaveBeenCalled();

    addSpy.mockRestore();
  });

  it('POST /api/v1/workspaces/:workspaceId/accounts/:accountId/sync - succeeds for valid same-workspace account and queues job', async () => {
    const syncQueue = app.get<Queue>(getQueueToken('sync'));
    const addSpy = jest.spyOn(syncQueue, 'add');

    const res = await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${testWorkspaceEditor}/accounts/${accountWorkspaceEditor}/sync`,
      )
      .set('Cookie', sessionData.combinedCookie)
      .set('x-csrf-token', sessionData.csrfToken);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      queued: true,
      jobId: expect.any(String),
    });
    expect(addSpy).toHaveBeenCalledWith(
      'sync-account',
      {
        socialAccountId: accountWorkspaceEditor,
        workspaceId: testWorkspaceEditor,
        correlationId: expect.stringMatching(/^[a-zA-Z0-9._-]{1,128}$/),
      },
      expect.any(Object),
    );
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toMatch(/^[a-zA-Z0-9._-]{1,128}$/);
    expect(addSpy.mock.calls[0][1].correlationId).toBe(
      res.headers['x-request-id'],
    );

    addSpy.mockRestore();
  });
  describe('POST /api/v1/workspaces/:workspaceId/accounts/:accountId/disconnect', () => {
    it('fails with 401 if unauthenticated', async () => {
      const res = await request(app.getHttpServer()).post(
        `/api/v1/workspaces/${testWorkspaceOwner}/accounts/${accountWorkspaceOwner}/disconnect`,
      );
      expect(res.status).toBe(401);
    });

    it('fails with 403 if user is not a member of workspace', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${testWorkspaceNone}/accounts/${accountWorkspaceOwner}/disconnect`,
        )
        .set('Cookie', sessionData.combinedCookie)
        .set('x-csrf-token', sessionData.csrfToken);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('User is not a member of this workspace');
    });

    it('fails with 403 if member lacks accounts.disconnect permission (EDITOR)', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${testWorkspaceEditor}/accounts/${accountWorkspaceEditor}/disconnect`,
        )
        .set('Cookie', sessionData.combinedCookie)
        .set('x-csrf-token', sessionData.csrfToken);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('Lacking permission: accounts.disconnect');
    });

    it('fails with 404 for non-existent account ID', async () => {
      const nonExistentId = generateId();
      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${testWorkspaceOwner}/accounts/${nonExistentId}/disconnect`,
        )
        .set('Cookie', sessionData.combinedCookie)
        .set('x-csrf-token', sessionData.csrfToken);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain('Account not found');
    });

    it('fails with 403 for cross-workspace account (tenant isolation)', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${testWorkspaceOwner}/accounts/${accountWorkspaceOther}/disconnect`,
        )
        .set('Cookie', sessionData.combinedCookie)
        .set('x-csrf-token', sessionData.csrfToken);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('Account does not belong to this workspace');
    });

    it('succeeds for OWNER: wipes credentials atomically, marks status DISCONNECTED, and records audit log', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${testWorkspaceOwner}/accounts/${accountWorkspaceOwner}/disconnect`,
        )
        .set('Cookie', sessionData.combinedCookie)
        .set('x-csrf-token', sessionData.csrfToken);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        accountId: accountWorkspaceOwner,
        status: 'DISCONNECTED',
      });

      // Verify SocialAccount status in DB
      const accountInDb = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: accountWorkspaceOwner },
      });
      expect(accountInDb.status).toBe('DISCONNECTED');

      // Verify SocialConnection credentials in DB are completely wiped
      const connInDb = await prisma.socialConnection.findUniqueOrThrow({
        where: { socialAccountId: accountWorkspaceOwner },
      });
      expect(connInDb.encryptedAccessToken).toBeNull();
      expect(connInDb.accessTokenIv).toBeNull();
      expect(connInDb.accessTokenAuthTag).toBeNull();
      expect(connInDb.encryptedRefreshToken).toBeNull();
      expect(connInDb.refreshTokenIv).toBeNull();
      expect(connInDb.refreshTokenAuthTag).toBeNull();
      expect(connInDb.expiresAt).toBeNull();
      expect(connInDb.refreshExpiresAt).toBeNull();

      // Verify AuditLog record in DB
      const auditInDb = await prisma.auditLog.findFirst({
        where: {
          action: 'ACCOUNT_DISCONNECTED',
          targetId: accountWorkspaceOwner,
        },
      });
      expect(auditInDb).toBeDefined();
      expect(auditInDb?.workspaceId).toBe(testWorkspaceOwner);
      expect(auditInDb?.actorId).toBe(testUser.id);
      expect(auditInDb?.targetType).toBe('SocialAccount');
    });

    it('reconnects previously disconnected account via SocialAccountRepository.upsertWithConnection to ACTIVE state', async () => {
      // SocialAccountRepository imported at top level
      const repo = new SocialAccountRepository(prisma);

      const freshToken = encrypt('fresh-reconnected-token');
      const { account: reconnectedAccount } = await repo.upsertWithConnection(
        testWorkspaceOwner,
        {
          id: accountWorkspaceOwner,
          provider: 'LINKEDIN',
          externalId: 'ext-owner-1',
          name: 'Owner LinkedIn Reconnected',
          capabilities: ['ACCOUNT_READ'],
          status: 'ACTIVE' as any,
        },
        {
          id: generateId(),
          encryptedAccessToken: freshToken.encrypted,
          accessTokenIv: freshToken.iv,
          accessTokenAuthTag: freshToken.authTag,
          keyVersion: freshToken.keyVersion,
          expiresAt: new Date(Date.now() + 3600000),
        },
      );

      expect(reconnectedAccount.status).toBe('ACTIVE');

      const reconnectedConn = await prisma.socialConnection.findUniqueOrThrow({
        where: { socialAccountId: accountWorkspaceOwner },
      });
      expect(reconnectedConn.encryptedAccessToken).toBe(freshToken.encrypted);
      expect(reconnectedConn.accessTokenIv).toBe(freshToken.iv);
    });
  });
});
