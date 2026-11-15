/* eslint-disable */
import { APP_GUARD } from '@nestjs/core';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from './../src/app.module';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { PrismaClient, generateId } from '@agency-os/database';
import { SessionManager } from '@agency-os/session';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { PinoLogger } from 'nestjs-pino';
import * as argon2 from '@node-rs/argon2';
import Redis from 'ioredis';
import {
  EMAIL_DELIVERY_SERVICE,
  MockEmailDeliveryService,
} from '../src/modules/auth/email-delivery.service';
import * as http from 'node:http';
import { createHash } from 'node:crypto';

const BREACHED_TEST_PASSWORD = 'BreachedPassword123!';
const breachedSha1 = createHash('sha1')
  .update(BREACHED_TEST_PASSWORD)
  .digest('hex')
  .toUpperCase();
const breachedPrefix = breachedSha1.slice(0, 5);
const breachedSuffix = breachedSha1.slice(5);

let hibpServer: http.Server;
let hibpBaseUrl: string;

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
    await new Promise<void>((resolve) => {
      hibpServer = http.createServer((req, res) => {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const match = url.pathname.match(/^\/range\/([A-Fa-f0-9]{5})$/);
        if (match) {
          const reqPrefix = match[1].toUpperCase();
          if (reqPrefix === breachedPrefix) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(`${breachedSuffix}:42\n`);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(`00000000000000000000000000000000000:1\n`);
          return;
        }
        res.writeHead(404);
        res.end();
      });

      hibpServer.listen(0, '127.0.0.1', () => {
        const addr = hibpServer.address() as any;
        hibpBaseUrl = `http://127.0.0.1:${addr.port}`;
        process.env.HIBP_API_BASE_URL = hibpBaseUrl;
        resolve();
      });
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalFilters(
      new AllExceptionsFilter(await app.resolve(PinoLogger)),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
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
    const hashedPassword = await argon2.hash('CorrectPassword123!');
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

    if (hibpServer) {
      await new Promise<void>((resolve) => hibpServer.close(() => resolve()));
    }
  });

  let sessionCookie: string;
  let csrfToken: string;

  it('/api/v1/auth/login (POST) - fails with generic message for wrong password and logs INVALID_PASSWORD', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('UnauthorizedException');
    expect(res.body.error.message).toBe('Invalid credentials');

    const requestId = res.body.error.requestId;
    let auditLog = await prisma.auditLog.findFirst({
      where: { requestId, action: 'AUTH_LOGIN_FAILED' },
    });
    for (let i = 0; i < 5 && !auditLog; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      auditLog = await prisma.auditLog.findFirst({
        where: { requestId, action: 'AUTH_LOGIN_FAILED' },
      });
    }
    expect(auditLog).toBeDefined();
    expect(auditLog?.targetType).toBe('User');
    expect(auditLog?.targetId).toBe(testUser.id);
    expect((auditLog?.metadata as any)?.reason).toBe('INVALID_PASSWORD');
    expect(JSON.stringify(auditLog)).not.toContain('wrongpassword');
  });

  it('/api/v1/auth/login (POST) - fails with generic message for wrong email and logs USER_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nonexistent@example.com', password: 'correctpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('UnauthorizedException');
    expect(res.body.error.message).toBe('Invalid credentials');

    const requestId = res.body.error.requestId;
    let auditLog = await prisma.auditLog.findFirst({
      where: { requestId, action: 'AUTH_LOGIN_FAILED' },
    });
    for (let i = 0; i < 5 && !auditLog; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      auditLog = await prisma.auditLog.findFirst({
        where: { requestId, action: 'AUTH_LOGIN_FAILED' },
      });
    }
    expect(auditLog).toBeDefined();
    expect(auditLog?.targetType).toBe('User');
    expect(auditLog?.targetId).toBeNull();
    expect((auditLog?.metadata as any)?.reason).toBe('USER_NOT_FOUND');
    expect(JSON.stringify(auditLog)).not.toContain('correctpassword');
    expect(JSON.stringify(auditLog)).not.toContain('nonexistent@example.com');
  });

  it('/api/v1/auth/login (POST) - success issues valid session and csrf cookies', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: 'CorrectPassword123!' });

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
      .send({ email: testUser.email, password: 'CorrectPassword123!' });

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

  describe('/api/v1/auth/change-password (POST)', () => {
    async function loginAsUser(password = 'CorrectPassword123!') {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password });

      expect(loginRes.status).toBe(200);
      const cookies = loginRes.headers['set-cookie'] as string[];
      const sess = cookies
        .find((c: string) => c.startsWith('session='))!
        .split(';')[0];
      const csrf = cookies
        .find((c: string) => c.startsWith('csrfToken='))!
        .split(';')[0]
        .split('=')[1];
      return { sess, csrf, loginRes };
    }

    it('fails with 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .send({
          currentPassword: 'CorrectPassword123!',
          newPassword: 'NewSecurePassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('No session cookie provided');
    });

    it('fails with 403 when CSRF token is missing or mismatched', async () => {
      const { sess } = await loginAsUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', sess)
        .send({
          currentPassword: 'CorrectPassword123!',
          newPassword: 'NewSecurePassword123!',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe('CSRF token mismatch');
    });

    it('fails with 400 when new password is too short (< 8 chars)', async () => {
      const { sess, csrf } = await loginAsUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', `${sess}; csrfToken=${csrf}`)
        .set('x-csrf-token', csrf)
        .send({
          currentPassword: 'CorrectPassword123!',
          newPassword: 'short',
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('characters');
    });

    it('fails with 401 when current password is wrong', async () => {
      const { sess, csrf } = await loginAsUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', `${sess}; csrfToken=${csrf}`)
        .set('x-csrf-token', csrf)
        .send({
          currentPassword: 'wrongcurrentpassword',
          newPassword: 'NewSecurePassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('fails with 400 when new password is identical to current password', async () => {
      const { sess, csrf } = await loginAsUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', `${sess}; csrfToken=${csrf}`)
        .set('x-csrf-token', csrf)
        .send({
          currentPassword: 'CorrectPassword123!',
          newPassword: 'CorrectPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('cannot be the same');
    });

    it('successfully changes password, preserves active session, revokes other sessions, and allows login with new password', async () => {
      // 1. Device A logs in
      const { sess: sessA, csrf: csrfA } = await loginAsUser();

      // 2. Device B logs in (creates second session)
      const { sess: sessB } = await loginAsUser();

      // Verify Device B can access /me before password change
      const meResBBefore = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', sessB);
      expect(meResBBefore.status).toBe(200);

      // 3. Device A changes password
      const changeRes = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', `${sessA}; csrfToken=${csrfA}`)
        .set('x-csrf-token', csrfA)
        .send({
          currentPassword: 'CorrectPassword123!',
          newPassword: 'BrandNewPassword123!',
        });

      expect(changeRes.status).toBe(200);
      expect(changeRes.body.message).toBe('Password changed successfully');

      // 4. Device A session remains valid
      const meResA = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', sessA);
      expect(meResA.status).toBe(200);
      expect(meResA.body.user.email).toBe(testUser.email);

      // 5. Device B session is revoked (returns 401)
      const meResBAfter = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', sessB);
      expect(meResBAfter.status).toBe(401);
      expect(meResBAfter.body.error.message).toBe('Invalid or expired session');

      // 6. Old password no longer works for login
      const oldLoginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'CorrectPassword123!' });
      expect(oldLoginRes.status).toBe(401);

      // 7. New password works for login
      const newLoginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'BrandNewPassword123!' });
      expect(newLoginRes.status).toBe(200);

      // Restore password back to 'CorrectPassword123!' for any subsequent test runs
      const newCookies = newLoginRes.headers['set-cookie'] as string[];
      const newSess = newCookies
        .find((c) => c.startsWith('session='))!
        .split(';')[0];
      const newCsrf = newCookies
        .find((c) => c.startsWith('csrfToken='))!
        .split(';')[0]
        .split('=')[1];
      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', `${newSess}; csrfToken=${newCsrf}`)
        .set('x-csrf-token', newCsrf)
        .send({
          currentPassword: 'BrandNewPassword123!',
          newPassword: 'CorrectPassword123!',
        });
    });

    it('Scenario M1: returns sessionCleanupDeferred: true when Redis revoke fails, but changes password and rejects stale sessions via AuthGuard epoch check', async () => {
      // 1. Device A logs in
      const { sess: sessA, csrf: csrfA } = await loginAsUser();

      // 2. Device B logs in (second session)
      const { sess: sessB } = await loginAsUser();

      // Verify Device B can access /me before password change
      const meResBBefore = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', sessB);
      expect(meResBBefore.status).toBe(200);

      // Spy on sessionManager.destroyOtherUserSessions to force failure
      const sessionManager = app.get(SessionManager);
      const destroyOtherSpy = jest
        .spyOn(sessionManager, 'destroyOtherUserSessions')
        .mockRejectedValue(new Error('Simulated Redis failure'));

      try {
        // 3. Device A changes password
        const changeRes = await request(app.getHttpServer())
          .post('/api/v1/auth/change-password')
          .set('Cookie', `${sessA}; csrfToken=${csrfA}`)
          .set('x-csrf-token', csrfA)
          .send({
            currentPassword: 'CorrectPassword123!',
            newPassword: 'DeferredPassword123!',
          });

        expect(changeRes.status).toBe(200);
        expect(changeRes.body.sessionCleanupDeferred).toBe(true);
        expect(changeRes.body.message).toContain(
          'terminating other active sessions failed',
        );

        // 4. Stale Device B session is rejected via AuthGuard epoch check (status 401)
        const meResBAfter = await request(app.getHttpServer())
          .get('/api/v1/auth/me')
          .set('Cookie', sessB);
        expect(meResBAfter.status).toBe(401);
        expect(meResBAfter.body.error.message).toBe(
          'Invalid or expired session',
        );

        // 5. Old password no longer works
        const oldLogin = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: testUser.email, password: 'CorrectPassword123!' });
        expect(oldLogin.status).toBe(401);

        // 6. New password works
        const newLogin = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: testUser.email, password: 'DeferredPassword123!' });
        expect(newLogin.status).toBe(200);
      } finally {
        destroyOtherSpy.mockRestore();

        // Restore password back to CorrectPassword123!
        const loginAgain = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: testUser.email, password: 'DeferredPassword123!' });
        if (loginAgain.status === 200) {
          const cookies = loginAgain.headers['set-cookie'] as string[];
          const s = cookies
            .find((c: string) => c.startsWith('session='))!
            .split(';')[0];
          const c = cookies
            .find((c: string) => c.startsWith('csrfToken='))!
            .split(';')[0]
            .split('=')[1];
          await request(app.getHttpServer())
            .post('/api/v1/auth/change-password')
            .set('Cookie', `${s}; csrfToken=${c}`)
            .set('x-csrf-token', c)
            .send({
              currentPassword: 'DeferredPassword123!',
              newPassword: 'CorrectPassword123!',
            });
        }
      }
    });
  });

  describe('/api/v1/auth/sessions/revoke-all (POST)', () => {
    async function loginAsUser(password = 'CorrectPassword123!') {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password });

      expect(loginRes.status).toBe(200);
      const cookies = loginRes.headers['set-cookie'] as string[];
      const sess = cookies
        .find((c: string) => c.startsWith('session='))!
        .split(';')[0];
      const csrf = cookies
        .find((c: string) => c.startsWith('csrfToken='))!
        .split(';')[0]
        .split('=')[1];
      return { sess, csrf, loginRes };
    }

    it('fails with 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).post(
        '/api/v1/auth/sessions/revoke-all',
      );

      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('No session cookie provided');
    });

    it('fails with 403 when CSRF token is missing or mismatched', async () => {
      const { sess } = await loginAsUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/sessions/revoke-all')
        .set('Cookie', sess);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe('CSRF token mismatch');
    });

    it('successfully revokes all active sessions for authenticated user and clears cookies', async () => {
      // 1. Device A logs in
      const { sess: sessA, csrf: csrfA } = await loginAsUser();

      // 2. Device B logs in
      const { sess: sessB } = await loginAsUser();

      // Both can access /me before revocation
      const meResABefore = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', sessA);
      expect(meResABefore.status).toBe(200);

      const meResBBefore = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', sessB);
      expect(meResBBefore.status).toBe(200);

      const userBefore = await prisma.user.findUnique({
        where: { id: testUser.id },
      });
      const initialEpoch = userBefore!.securityEpoch;

      // 3. Device A calls revoke-all
      const revokeRes = await request(app.getHttpServer())
        .post('/api/v1/auth/sessions/revoke-all')
        .set('Cookie', `${sessA}; csrfToken=${csrfA}`)
        .set('x-csrf-token', csrfA);

      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.message).toBe('All sessions revoked successfully');

      // Assert cookies cleared
      const cookies = revokeRes.headers['set-cookie'] as string[];
      expect(cookies).toBeDefined();
      expect(
        cookies.some(
          (c: string) => c.startsWith('session=;') || c.includes('session=;'),
        ),
      ).toBe(true);

      // 4. Device A session is revoked (returns 401)
      const meResAAfter = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', sessA);
      expect(meResAAfter.status).toBe(401);

      // 5. Device B session is revoked (returns 401)
      const meResBAfter = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', sessB);
      expect(meResBAfter.status).toBe(401);

      // 6. DB securityEpoch was incremented
      const userAfter = await prisma.user.findUnique({
        where: { id: testUser.id },
      });
      expect(userAfter!.securityEpoch).toBe(initialEpoch + 1);

      // 7. User can log in again and get fresh valid session
      const { sess: freshSess } = await loginAsUser();
      const meResFresh = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', freshSess);
      expect(meResFresh.status).toBe(200);
      expect(meResFresh.body.user.email).toBe(testUser.email);
    });
  });

  describe('/api/v1/auth/signup (POST) & Tenant Provisioning', () => {
    let signedUpEmail: string;
    let signedUpUser: any;
    let signedUpOrg: any;
    let signedUpWorkspace: any;

    it('Scenario 10, 11 & 13: atomically provisions User, Organization, Workspace, and OWNER member without issuing cookies', async () => {
      const submittedName = 'Alice E2E User';
      signedUpEmail = `signup-${generateId()}@example.com`;

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          name: submittedName,
          email: signedUpEmail,
          password: 'CorrectPassword123!',
          termsAccepted: true,
          organizationName: 'Signup Org E2E',
          workspaceName: 'Signup Workspace E2E',
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        message: 'Registration request received.',
      });

      // Assert zero cookies are set
      expect(res.headers['set-cookie']).toBeUndefined();

      // Verify PostgreSQL database state directly
      signedUpUser = await prisma.user.findUnique({
        where: { email: signedUpEmail },
      });
      expect(signedUpUser).toBeDefined();
      expect(signedUpUser.name).toBe(submittedName);
      expect(signedUpUser.emailVerified).toBe(false);
      expect(signedUpUser.emailVerifiedAt).toBeNull();
      expect(signedUpUser.securityEpoch).toBe(1);
      expect(signedUpUser.termsAcceptedAt).toBeDefined();
      expect(signedUpUser.termsAcceptedAt).not.toBeNull();

      // Verify GET /auth/me for this user returns user.name equal to submitted name
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: signedUpEmail,
          password: 'CorrectPassword123!',
        });
      expect(loginRes.status).toBe(200);
      const cookies = loginRes.headers['set-cookie'] as string[];
      const sessCookie = cookies
        .find((c: string) => c.startsWith('session='))!
        .split(';')[0];
      const meRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', sessCookie);
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.name).toBe(submittedName);

      // Verify email verification token was provisioned in the same database transaction
      const tokenRecord = await prisma.emailVerificationToken.findFirst({
        where: { userId: signedUpUser.id },
      });
      expect(tokenRecord).toBeDefined();
      expect(tokenRecord?.consumedAt).toBeNull();

      signedUpOrg = await prisma.organization.findFirst({
        where: { name: 'Signup Org E2E' },
      });
      expect(signedUpOrg).toBeDefined();

      signedUpWorkspace = await prisma.workspace.findFirst({
        where: {
          organizationId: signedUpOrg.id,
          name: 'Signup Workspace E2E',
        },
      });
      expect(signedUpWorkspace).toBeDefined();

      const member = await prisma.workspaceMember.findFirst({
        where: {
          workspaceId: signedUpWorkspace.id,
          userId: signedUpUser.id,
        },
      });
      expect(member).toBeDefined();
      expect(member?.role).toBe('OWNER');
    });

    it('Scenario 10: provides observable anti-enumeration parity for duplicate email signups', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          name: 'Duplicate E2E User',
          email: signedUpEmail,
          password: 'DifferentPassword456!',
          termsAccepted: true,
        });

      // Identical status and response payload
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        message: 'Registration request received.',
      });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('rejects signup with 400 when name is missing from body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email: `missing-name-${generateId()}@example.com`,
          password: 'ValidPassword123!',
          termsAccepted: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects signup with 400 when name is empty string', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          name: '',
          email: `empty-name-${generateId()}@example.com`,
          password: 'ValidPassword123!',
          termsAccepted: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects signup with 400 when termsAccepted is missing from body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          name: 'Missing Terms User',
          email: `missing-terms-${generateId()}@example.com`,
          password: 'ValidPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects signup with 400 and exact validation message when termsAccepted is false', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          name: 'False Terms User',
          email: `false-terms-${generateId()}@example.com`,
          password: 'ValidPassword123!',
          termsAccepted: false,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(JSON.stringify(res.body)).toContain(
        'You must accept the Terms of Service and Privacy Policy',
      );
    });

    it('Scenario 14: full email verification lifecycle, 403 guard gating, token consumption, and resend parity', async () => {
      // 1. Unverified user logs in successfully (login permits unverified users)
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: signedUpEmail,
          password: 'CorrectPassword123!',
        });

      expect(loginRes.status).toBe(200);
      const cookies = loginRes.headers['set-cookie'] as string[];
      expect(cookies).toBeDefined();
      const sessCookie = cookies
        .find((c: string) => c.startsWith('session='))!
        .split(';')[0];
      const csrfVal = cookies
        .find((c: string) => c.startsWith('csrfToken='))!
        .split(';')[0]
        .split('=')[1];

      // 2. GET /me succeeds and reflects unverified status (emailVerified: false)
      const meRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', sessCookie);

      expect(meRes.status).toBe(200);
      expect(meRes.body.user.name).toBe('Alice E2E User');
      expect(meRes.body.user.email).toBe(signedUpEmail);
      expect(meRes.body.user.emailVerified).toBe(false);

      // 3. Accessing own provisioned workspace route fails with 403 Forbidden because email is not verified
      const workspaceRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${signedUpWorkspace.id}/test-posts`)
        .set('Cookie', `${sessCookie}; csrfToken=${csrfVal}`)
        .set('x-csrf-token', csrfVal)
        .send({});

      expect(workspaceRes.status).toBe(403);
      expect(workspaceRes.body.error.message).toBe(
        'Email verification required to access workspaces',
      );

      // 4. Accessing another workspace also blocked with 403 Forbidden
      const unverifiedOtherWorkspaceRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${generateId()}/test-posts`)
        .set('Cookie', `${sessCookie}; csrfToken=${csrfVal}`)
        .set('x-csrf-token', csrfVal)
        .send({});

      expect(unverifiedOtherWorkspaceRes.status).toBe(403);
      expect(unverifiedOtherWorkspaceRes.body.error.message).toBe(
        'Email verification required to access workspaces',
      );

      // 5. Password change succeeds for unverified accounts
      const changePwRes = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', `${sessCookie}; csrfToken=${csrfVal}`)
        .set('x-csrf-token', csrfVal)
        .send({
          currentPassword: 'CorrectPassword123!',
          newPassword: 'UpdatedUnverifiedPass789!',
        });

      expect(changePwRes.status).toBe(200);
      expect(changePwRes.body.message).toBe('Password changed successfully');

      // 6. Logout succeeds for unverified accounts
      const logoutRes = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', `${sessCookie}; csrfToken=${csrfVal}`)
        .set('x-csrf-token', csrfVal);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.message).toBe('Logged out successfully');

      // 7. Resend verification: invalidates prior active tokens, generates fresh token, sends email
      const resendRes = await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .send({ email: signedUpEmail });

      expect(resendRes.status).toBe(200);
      expect(resendRes.body.message).toBe(
        'If an unverified account exists for this email, a verification link has been sent.',
      );

      // Verify in DB that only 1 unconsumed token exists (newest token wins)
      const activeTokens = await prisma.emailVerificationToken.findMany({
        where: { userId: signedUpUser.id, consumedAt: null },
      });
      expect(activeTokens).toHaveLength(1);

      // 8. Resend verification for non-existent email returns identical generic message (anti-enumeration)
      const resendNonexistentRes = await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .send({ email: 'nonexistent-e2e@example.com' });

      expect(resendNonexistentRes.status).toBe(200);
      expect(resendNonexistentRes.body.message).toBe(
        'If an unverified account exists for this email, a verification link has been sent.',
      );

      // 9. Verify email using the fresh token dispatched to MockEmailDeliveryService
      const emailService = app.get(
        EMAIL_DELIVERY_SERVICE,
      ) as MockEmailDeliveryService;
      const latestEmail = [...emailService.sentEmails]
        .reverse()
        .find((e: any) => e.toEmail === signedUpEmail);
      expect(latestEmail).toBeDefined();
      const rawVerificationToken = latestEmail!.rawToken;

      // Consuming an invalid token fails with 400 Bad Request
      const invalidTokenRes = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: 'c'.repeat(64) });

      expect(invalidTokenRes.status).toBe(400);
      expect(invalidTokenRes.body.error.message).toBe(
        'Invalid or expired verification token',
      );

      // Consuming the valid token succeeds (200 OK)
      const verifyRes = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: rawVerificationToken });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.message).toBe('Email verified successfully.');

      // 10. Direct DB check reflects emailVerified: true and emailVerifiedAt != null
      const verifiedDbUser = await prisma.user.findUnique({
        where: { id: signedUpUser.id },
      });
      expect(verifiedDbUser?.emailVerified).toBe(true);
      expect(verifiedDbUser?.emailVerifiedAt).not.toBeNull();

      // 11. With email verified, login and access workspace route now succeeds (200 OK)
      const verifiedLoginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: signedUpEmail,
          password: 'UpdatedUnverifiedPass789!',
        });

      expect(verifiedLoginRes.status).toBe(200);
      const vCookies = verifiedLoginRes.headers['set-cookie'] as string[];
      expect(vCookies).toBeDefined();
      const vSess = vCookies
        .find((c: string) => c.startsWith('session='))!
        .split(';')[0];
      const vCsrf = vCookies
        .find((c: string) => c.startsWith('csrfToken='))!
        .split(';')[0]
        .split('=')[1];

      const verifiedWorkspaceRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${signedUpWorkspace.id}/test-posts`)
        .set('Cookie', `${vSess}; csrfToken=${vCsrf}`)
        .set('x-csrf-token', vCsrf)
        .send({});

      expect(verifiedWorkspaceRes.status).toBe(200);
      expect(verifiedWorkspaceRes.body.message).toBe('Post created');

      // 12. Cross-tenant access to another workspace is rejected with 403 Forbidden (tenant isolation verified)
      const otherWorkspaceRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${generateId()}/test-posts`)
        .set('Cookie', `${vSess}; csrfToken=${vCsrf}`)
        .set('x-csrf-token', vCsrf)
        .send({});

      expect(otherWorkspaceRes.status).toBe(403);
      expect(otherWorkspaceRes.body.error.message).toBe(
        'User is not a member of this workspace',
      );

      // 13. Replay attack with same token is rejected (400 Bad Request)
      const replayRes = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: rawVerificationToken });

      expect(replayRes.status).toBe(400);
      expect(replayRes.body.error.message).toBe(
        'Invalid or expired verification token',
      );

      // 14. Resend verification for already-verified email returns generic message without re-issuing token
      const resendVerifiedRes = await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .send({ email: signedUpEmail });

      expect(resendVerifiedRes.status).toBe(200);
      expect(resendVerifiedRes.body.message).toBe(
        'If an unverified account exists for this email, a verification link has been sent.',
      );

      // Cleanup signed up user data
      await prisma.emailVerificationToken.deleteMany({
        where: { userId: signedUpUser.id },
      });
      await prisma.workspaceMember.deleteMany({
        where: { userId: signedUpUser.id },
      });
      await prisma.workspace.deleteMany({
        where: { id: signedUpWorkspace.id },
      });
      await prisma.organization.deleteMany({
        where: { id: signedUpOrg.id },
      });
      await prisma.user.deleteMany({
        where: { id: signedUpUser.id },
      });
    });
  });

  describe('Self-Serve Password Reset Flow (e2e)', () => {
    let resetUserEmail: string;
    let resetUser: any;

    beforeEach(async () => {
      resetUserEmail = `reset-user-${generateId()}@example.com`;
      const hashedPassword = await argon2.hash('OriginalPassword123!');
      resetUser = await prisma.user.create({
        data: {
          id: generateId(),
          email: resetUserEmail,
          hashedPassword,
          emailVerified: true,
          securityEpoch: 1,
        },
      });
    });

    afterEach(async () => {
      if (resetUser) {
        await prisma.passwordResetToken.deleteMany({
          where: { userId: resetUser.id },
        });
        await prisma.user.deleteMany({
          where: { id: resetUser.id },
        });
      }
    });

    it('happy path: forgot-password -> consume token -> reset-password -> login with new password works, old password fails', async () => {
      const emailService = app.get(
        EMAIL_DELIVERY_SERVICE,
      ) as MockEmailDeliveryService;
      emailService.sentPasswordResetEmails = [];

      // 1. Request password reset
      const forgotRes = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: resetUserEmail });

      expect(forgotRes.status).toBe(200);
      expect(forgotRes.body.message).toBe(
        'If an account with that email exists, a password reset link has been sent.',
      );

      // Verify simulated email received
      const sentEmail = emailService.sentPasswordResetEmails.find(
        (e: any) => e.toEmail === resetUserEmail,
      );
      expect(sentEmail).toBeDefined();
      const rawToken = sentEmail!.rawToken;

      // 2. Consume token and reset password
      const resetRes = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({
          token: rawToken,
          newPassword: 'MockNewPassword456!',
        });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.message).toBe('Password reset successfully.');

      // Verify token is consumed in database
      const dbTokens = await prisma.passwordResetToken.findMany({
        where: { userId: resetUser.id },
      });
      expect(dbTokens).toHaveLength(1);
      expect(dbTokens[0].consumedAt).not.toBeNull();

      // 3. Login with new password works
      const newLoginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: resetUserEmail,
          password: 'MockNewPassword456!',
        });

      expect(newLoginRes.status).toBe(200);

      // 4. Login with old password fails
      const oldLoginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: resetUserEmail,
          password: 'OriginalPassword123!',
        });

      expect(oldLoginRes.status).toBe(401);
    });

    it('replay case: same reset token cannot be consumed twice (second use -> 400)', async () => {
      const emailService = app.get(
        EMAIL_DELIVERY_SERVICE,
      ) as MockEmailDeliveryService;
      emailService.sentPasswordResetEmails = [];

      // 1. Request password reset
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: resetUserEmail });

      const sentEmail = emailService.sentPasswordResetEmails.find(
        (e: any) => e.toEmail === resetUserEmail,
      );
      const rawToken = sentEmail!.rawToken;

      // 2. First consumption succeeds
      const firstReset = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({
          token: rawToken,
          newPassword: 'MockNewPassword456!',
        });
      expect(firstReset.status).toBe(200);

      // 3. Second consumption fails with 400
      const secondReset = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({
          token: rawToken,
          newPassword: 'MockAnotherPassword789!',
        });

      expect(secondReset.status).toBe(400);
      expect(secondReset.body.error.message).toBe(
        'Invalid or expired reset link',
      );
    });

    it('rejects reset when new password equals current password (400)', async () => {
      const emailService = app.get(
        EMAIL_DELIVERY_SERVICE,
      ) as MockEmailDeliveryService;
      emailService.sentPasswordResetEmails = [];

      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: resetUserEmail });

      const sentEmail = emailService.sentPasswordResetEmails.find(
        (e: any) => e.toEmail === resetUserEmail,
      );
      const rawToken = sentEmail!.rawToken;

      const resetRes = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({
          token: rawToken,
          newPassword: 'OriginalPassword123!',
        });

      expect(resetRes.status).toBe(400);
      expect(resetRes.body.error.message).toBe(
        'New password cannot be the same as the current password',
      );
    });
  });

  describe('Per-Account Login Lockout (e2e)', () => {
    let lockoutUserEmail: string;
    const correctPassword = 'LockoutPassword123!';
    const wrongPassword = 'WrongPassword999!';

    beforeAll(async () => {
      lockoutUserEmail = `lockout-${generateId()}@example.com`;
      const signupRes = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          name: 'Lockout Test User',
          email: lockoutUserEmail,
          password: correctPassword,
          termsAccepted: true,
          organizationName: 'Lockout Org',
          workspaceName: 'Lockout Workspace',
        });
      expect(signupRes.status).toBe(201);

      await prisma.user.update({
        where: { email: lockoutUserEmail },
        data: { emailVerified: true, emailVerifiedAt: new Date() },
      });
    });

    afterAll(async () => {
      const user = await prisma.user.findUnique({
        where: { email: lockoutUserEmail },
      });
      if (user) {
        await prisma.passwordResetToken.deleteMany({
          where: { userId: user.id },
        });
        await prisma.emailVerificationToken.deleteMany({
          where: { userId: user.id },
        });
        await prisma.workspaceMember.deleteMany({
          where: { userId: user.id },
        });
        await prisma.workspace.deleteMany({
          where: { organization: { name: 'Lockout Org' } },
        });
        await prisma.organization.deleteMany({
          where: { name: 'Lockout Org' },
        });
        await prisma.user.delete({ where: { id: user.id } });
      }
    });

    it('enforces lockout journey: 5 wrong attempts lock the account, correct password rejected while locked without disclosure, past lock allows login and clears state', async () => {
      // 1. Attempts 1-4: wrong password -> 401 with standard invalid-credentials body
      for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            email: lockoutUserEmail,
            password: wrongPassword,
          });

        expect(res.status).toBe(401);
        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe('UnauthorizedException');
        expect(res.body.error.message).toBe('Invalid credentials');

        const dbUser = await prisma.user.findUnique({
          where: { email: lockoutUserEmail },
        });
        expect(dbUser!.failedLoginAttempts).toBe(attempt);
        expect(dbUser!.lockedUntil).toBeNull();
      }

      // 2. 5th attempt: wrong password -> 401 with standard invalid-credentials body
      const fifthRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: lockoutUserEmail,
          password: wrongPassword,
        });

      expect(fifthRes.status).toBe(401);
      expect(fifthRes.body.error).toBeDefined();
      expect(fifthRes.body.error.code).toBe('UnauthorizedException');
      expect(fifthRes.body.error.message).toBe('Invalid credentials');

      // Assert user row now has lockedUntil in the future and failedLoginAttempts = 0
      const lockedUser = await prisma.user.findUnique({
        where: { email: lockoutUserEmail },
      });
      expect(lockedUser!.failedLoginAttempts).toBe(0);
      expect(lockedUser!.lockedUntil).not.toBeNull();
      expect(lockedUser!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      // 3. CORRECT-password login immediately after returns 401 (locked) with identical body (no disclosure)
      const correctWhileLockedRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: lockoutUserEmail,
          password: correctPassword,
        });

      expect(correctWhileLockedRes.status).toBe(401);
      expect(correctWhileLockedRes.body.error).toBeDefined();
      expect(correctWhileLockedRes.body.error.code).toBe(
        'UnauthorizedException',
      );
      expect(correctWhileLockedRes.body.error.message).toBe(
        'Invalid credentials',
      );
      expect(correctWhileLockedRes.headers['set-cookie']).toBeUndefined();

      // Ensure locked state did not extend or change
      const stillLockedUser = await prisma.user.findUnique({
        where: { email: lockoutUserEmail },
      });
      expect(stillLockedUser!.failedLoginAttempts).toBe(0);
      expect(stillLockedUser!.lockedUntil).toEqual(lockedUser!.lockedUntil);

      // 4. Via Prisma, set lockedUntil to the past
      await prisma.user.update({
        where: { email: lockoutUserEmail },
        data: {
          lockedUntil: new Date(Date.now() - 60 * 1000), // 1 minute in the past
        },
      });

      // 5. A correct-password login then returns 200 with a session cookie
      const unlockedLoginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: lockoutUserEmail,
          password: correctPassword,
        });

      expect(unlockedLoginRes.status).toBe(200);
      const cookies = unlockedLoginRes.headers['set-cookie'] as string[];
      expect(cookies).toBeDefined();
      const sessCookie = cookies.find((c: string) => c.startsWith('session='));
      expect(sessCookie).toBeDefined();

      // Assert user row afterwards has failedLoginAttempts = 0 and lockedUntil = null
      const cleanUser = await prisma.user.findUnique({
        where: { email: lockoutUserEmail },
      });
      expect(cleanUser!.failedLoginAttempts).toBe(0);
      expect(cleanUser!.lockedUntil).toBeNull();
    });
  });

  describe('Password Security Policy & Breach Checking (e2e)', () => {
    it('rejects signup with non-complex password (missing special char) with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          name: 'NonComplex User',
          email: `policy-noncomplex-${generateId()}@example.com`,
          password: 'Password123',
          termsAccepted: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('BadRequestException');
      expect(res.body.error.message).toBe(
        'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.',
      );
    });

    it('rejects signup with breached password with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          name: 'Breached User',
          email: `policy-breached-${generateId()}@example.com`,
          password: BREACHED_TEST_PASSWORD,
          termsAccepted: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('BadRequestException');
      expect(res.body.error.message).toBe(
        'This password has appeared in a known data breach. Please choose a different password.',
      );
    });

    it('permits signup with compliant, non-breached password with 201', async () => {
      const email = `policy-compliant-${generateId()}@example.com`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          name: 'Compliant User',
          email,
          password: 'CompliantPassword123!',
          termsAccepted: true,
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        message: 'Registration request received.',
      });

      // Cleanup user
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        const members = await prisma.workspaceMember.findMany({
          where: { userId: user.id },
        });
        const workspaceIds = members.map((m: any) => m.workspaceId);
        const workspaces = await prisma.workspace.findMany({
          where: { id: { in: workspaceIds } },
        });
        const orgIds = workspaces.map((w: any) => w.organizationId);

        await prisma.emailVerificationToken.deleteMany({
          where: { userId: user.id },
        });
        await prisma.workspaceMember.deleteMany({
          where: { userId: user.id },
        });
        await prisma.workspace.deleteMany({
          where: { id: { in: workspaceIds } },
        });
        await prisma.organization.deleteMany({
          where: { id: { in: orgIds } },
        });
        await prisma.user.deleteMany({ where: { id: user.id } });
      }
    });
  });
});
