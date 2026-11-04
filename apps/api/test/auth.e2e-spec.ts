/* eslint-disable */
import { APP_GUARD } from '@nestjs/core';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from './../src/app.module';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { PrismaClient, generateId } from '@agency-os/database';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { PinoLogger } from 'nestjs-pino';
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

  describe('/api/v1/auth/change-password (POST)', () => {
    async function loginAsUser(password = 'correctpassword') {
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
          currentPassword: 'correctpassword',
          newPassword: 'newsecurepassword123',
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
          currentPassword: 'correctpassword',
          newPassword: 'newsecurepassword123',
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
          currentPassword: 'correctpassword',
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
          newPassword: 'newsecurepassword123',
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
          currentPassword: 'correctpassword',
          newPassword: 'correctpassword',
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
          currentPassword: 'correctpassword',
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
        .send({ email: testUser.email, password: 'correctpassword' });
      expect(oldLoginRes.status).toBe(401);

      // 7. New password works for login
      const newLoginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'BrandNewPassword123!' });
      expect(newLoginRes.status).toBe(200);

      // Restore password back to 'correctpassword' for any subsequent test runs
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
          newPassword: 'correctpassword',
        });
    });
  });
  describe('/api/v1/auth/signup (POST) & Tenant Provisioning', () => {
    let signedUpEmail: string;
    let signedUpUser: any;
    let signedUpOrg: any;
    let signedUpWorkspace: any;

    it('Scenario 10, 11 & 13: atomically provisions User, Organization, Workspace, and OWNER member without issuing cookies', async () => {
      signedUpEmail = `signup-${generateId()}@example.com`;

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email: signedUpEmail,
          password: 'correctpassword',
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
      expect(signedUpUser.emailVerified).toBe(false);
      expect(signedUpUser.emailVerifiedAt).toBeNull();
      expect(signedUpUser.securityEpoch).toBe(1);


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
          email: signedUpEmail,
          password: 'DifferentPassword456!',
        });

      // Identical status and response payload
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        message: 'Registration request received.',
      });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('Scenario 14: unverified accounts can log in, access their provisioned workspace, and perform actions (Option A: verification enforcement deferred to PR #50)', async () => {
      // 1. Unverified user logs in successfully
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: signedUpEmail,
          password: 'correctpassword',
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
      expect(meRes.body.user.email).toBe(signedUpEmail);
      expect(meRes.body.user.emailVerified).toBe(false);

      // 3. Accessing own provisioned workspace route succeeds (200 OK) under Option A
      const workspaceRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${signedUpWorkspace.id}/test-posts`)
        .set('Cookie', `${sessCookie}; csrfToken=${csrfVal}`)
        .set('x-csrf-token', csrfVal)
        .send({});

      expect(workspaceRes.status).toBe(200);
      expect(workspaceRes.body.message).toBe('Post created');

      // 4. Accessing another workspace where the user is NOT a member is strictly rejected with 403 Forbidden (tenant isolation verified)
      const otherWorkspaceRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${generateId()}/test-posts`)
        .set('Cookie', `${sessCookie}; csrfToken=${csrfVal}`)
        .set('x-csrf-token', csrfVal)
        .send({});

      expect(otherWorkspaceRes.status).toBe(403);
      expect(otherWorkspaceRes.body.error.message).toBe('User is not a member of this workspace');

      // 5. Password change succeeds for unverified accounts
      const changePwRes = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', `${sessCookie}; csrfToken=${csrfVal}`)
        .set('x-csrf-token', csrfVal)
        .send({
          currentPassword: 'correctpassword',
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

      // 7. Verify user remains emailVerified: false and emailVerifiedAt: null in PostgreSQL database
      const dbUser = await prisma.user.findUnique({
        where: { id: signedUpUser.id },
      });
      expect(dbUser?.emailVerified).toBe(false);
      expect(dbUser?.emailVerifiedAt).toBeNull();
      // Security epoch incremented by password change
      expect(dbUser?.securityEpoch).toBe(2);

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
});