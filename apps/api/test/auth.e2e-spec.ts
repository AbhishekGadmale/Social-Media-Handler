/* eslint-disable */
import { APP_GUARD } from '@nestjs/core';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from './../src/app.module';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { PrismaClient, generateId } from '@agency-os/database';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import * as argon2 from '@node-rs/argon2';
import Redis from 'ioredis';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;

  let testUser: any; // e2e test payload typing
  let testWorkspaceEditor: string;
  let testWorkspaceViewer: string;
  let testWorkspaceNone: string;
  let testOrg: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
        'SAFETY CHECK FAILED: Tests that clear the database must run against a test database. DATABASE_URL does not contain "test".',
      );
    }

    // Setup Test Data
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

    testWorkspaceViewer = generateId();
    await prisma.workspace.create({
      data: {
        id: testWorkspaceViewer,
        organizationId: testOrg,
        name: 'Workspace Viewer',
      },
    });
    await prisma.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: testWorkspaceViewer,
        userId: testUser.id,
        role: 'VIEWER',
      },
    });

    testWorkspaceNone = generateId();
    await prisma.workspace.create({
      data: {
        id: testWorkspaceNone,
        organizationId: testOrg,
        name: 'Workspace None',
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    if (prisma && testUser) {
      await prisma.workspaceMember.deleteMany({
        where: { userId: testUser.id },
      });
      await prisma.workspace.deleteMany({
        where: {
          id: {
            in: [testWorkspaceEditor, testWorkspaceViewer, testWorkspaceNone],
          },
        },
      });
      await prisma.organization.deleteMany({ where: { id: testOrg } });
      await prisma.user.deleteMany({ where: { id: testUser?.id } });
    }

    // Clear redis
    if (redis) {
      const keys = await redis.keys('session:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }

    if (app) {
      await app.close();
    }
  });

  let sessionCookie: string;
  let csrfToken: string;

  it('/api/v1/auth/login (POST) - fails with generic message for wrong password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('UnauthorizedException');
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('/api/v1/auth/login (POST) - fails with generic message for wrong email', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nonexistent@example.com', password: 'correctpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('/api/v1/auth/login (POST) - success issues valid session and csrf cookies', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: 'correctpassword' });

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as string[];
    expect(cookies).toBeDefined();

    const sessionCookieHeader = cookies.find((c) => c.startsWith('session='));
    const csrfCookieHeader = cookies.find((c) => c.startsWith('csrfToken='));

    expect(sessionCookieHeader).toContain('HttpOnly');
    expect(csrfCookieHeader).not.toContain('HttpOnly'); // CSRF must not be HttpOnly

    sessionCookie = sessionCookieHeader!.split(';')[0];
    csrfToken = csrfCookieHeader!.split(';')[0].split('=')[1];
  });

  it('/api/v1/auth/me (GET) - fails with no cookie', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me');

    expect(res.status).toBe(401);
  });

  it('/api/v1/auth/me (GET) - success with cookie', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(testUser.email);
    expect(res.body.user.hashedPassword).toBeUndefined(); // Should not leak password
  });

  it('/api/v1/workspaces/:workspaceId/test-posts (POST) - Missing CSRF gets 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${testWorkspaceEditor}/test-posts`)
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('CSRF token mismatch');
  });

  it('/api/v1/workspaces/:workspaceId/test-posts (POST) - Success with CSRF as EDITOR', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${testWorkspaceEditor}/test-posts`)
      .set('Cookie', `${sessionCookie}; csrfToken=${csrfToken}`)
      .set('x-csrf-token', csrfToken); // Double submit

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Post created');
  });

  it('/api/v1/workspaces/:workspaceId/test-posts (POST) - Fails as VIEWER (PermissionGuard)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${testWorkspaceViewer}/test-posts`)
      .set('Cookie', `${sessionCookie}; csrfToken=${csrfToken}`)
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('Lacking permission');
  });

  it('/api/v1/workspaces/:workspaceId/test-posts (POST) - Fails if not a member (WorkspaceGuard)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${testWorkspaceNone}/test-posts`)
      .set('Cookie', `${sessionCookie}; csrfToken=${csrfToken}`)
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain(
      'User is not a member of this workspace',
    );
  });

  it('/api/v1/auth/logout (POST) - success and clears redis', async () => {
    // 1. Log in to get a fresh session
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: 'correctpassword' });

    const cookies = loginRes.headers['set-cookie'] as string[];
    const sessionCookieHeader = cookies.find((c) => c.startsWith('session='));
    const csrfCookieHeader = cookies.find((c) => c.startsWith('csrfToken='));
    const tempSessionCookie = sessionCookieHeader!.split(';')[0];
    const tempCsrfToken = csrfCookieHeader!.split(';')[0].split('=')[1];

    // 2. Hit protected route successfully
    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', tempSessionCookie);
    expect(meRes.status).toBe(200);

    // 3. Log out
    const logoutRes = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', `${tempSessionCookie}; csrfToken=${tempCsrfToken}`)
      .set('x-csrf-token', tempCsrfToken);
    expect(logoutRes.status).toBe(200);

    // 4. Hit protected route again with the SAME session cookie and confirm 401
    const checkRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', tempSessionCookie);

    expect(checkRes.status).toBe(401);
    expect(checkRes.body.error.message).toBe('Invalid or expired session');
  });
});
