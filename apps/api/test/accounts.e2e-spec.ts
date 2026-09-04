/* eslint-disable */
import { APP_GUARD } from '@nestjs/core';
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from './../src/app.module';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { PrismaClient, generateId } from '@agency-os/database';
import { loginAndGetSession } from './helpers';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import * as argon2 from '@node-rs/argon2';
import Redis from 'ioredis';
import { encrypt } from '@agency-os/database/src/crypto/encryption';

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
        email: `test-${generateId()}@example.com`,
        hashedPassword,
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
});
