/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from './../src/app.module';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { PrismaClient } from '@agency-os/database';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { PinoLogger } from 'nestjs-pino';
import * as http from 'node:http';

describe('Google Sign-In End-to-End Workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokeninfoServer: http.Server;
  let tokeninfoUrl: string;

  const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
  const originalGoogleTokeninfoUrl = process.env.GOOGLE_TOKENINFO_URL;
  const originalAllowInsecure = process.env.ALLOW_INSECURE_HTTP_AUTH;

  const testClientId = 'e2e-google-client-id.apps.googleusercontent.com';
  const createdEmails: string[] = [];

  beforeAll(async () => {
    // 1. Start local stub tokeninfo server on 127.0.0.1 (ephemeral port)
    await new Promise<void>((resolve) => {
      tokeninfoServer = http.createServer((req, res) => {
        let rawBody = '';
        req.on('data', (chunk) => {
          rawBody += chunk;
        });
        req.on('end', () => {
          const params = new URLSearchParams(rawBody);
          const idToken = params.get('id_token');
          const nowSeconds = Math.floor(Date.now() / 1000);

          if (idToken === 'valid-google-token') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                aud: testClientId,
                iss: 'https://accounts.google.com',
                exp: String(nowSeconds + 3600),
                email_verified: 'true',
                email: 'google-new-user-e2e@example.com',
                name: 'Google New User',
              }),
            );
          } else if (idToken === 'valid-google-token-no-terms') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                aud: testClientId,
                iss: 'https://accounts.google.com',
                exp: String(nowSeconds + 3600),
                email_verified: 'true',
                email: 'google-no-terms-e2e@example.com',
                name: 'Google No Terms',
              }),
            );
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error_description: 'Invalid Value' }));
          }
        });
      });

      tokeninfoServer.listen(0, '127.0.0.1', () => {
        const addr = tokeninfoServer.address() as any;
        tokeninfoUrl = `http://127.0.0.1:${addr.port}`;
        process.env.GOOGLE_CLIENT_ID = testClientId;
        process.env.GOOGLE_TOKENINFO_URL = tokeninfoUrl;
        process.env.ALLOW_INSECURE_HTTP_AUTH = 'true';
        resolve();
      });
    });

    // 2. Boot isolated Nest application
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

    if (
      !process.env.DATABASE_URL ||
      !process.env.DATABASE_URL.includes('test')
    ) {
      throw new Error(
        'SAFETY CHECK FAILED: Tests that clear the database must run against a test database. DATABASE_URL does not contain "test".',
      );
    }
  });

  afterAll(async () => {
    // Clean up provisioned test users
    if (prisma && createdEmails.length > 0) {
      for (const email of createdEmails) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (user) {
          const members = await prisma.workspaceMember.findMany({
            where: { userId: user.id },
            select: { workspaceId: true },
          });
          const workspaceIds = members.map((m) => m.workspaceId);
          await prisma.workspaceMember.deleteMany({
            where: { userId: user.id },
          });
          if (workspaceIds.length > 0) {
            const workspaces = await prisma.workspace.findMany({
              where: { id: { in: workspaceIds } },
              select: { organizationId: true },
            });
            const orgIds = workspaces.map((w) => w.organizationId);
            await prisma.workspace.deleteMany({
              where: { id: { in: workspaceIds } },
            });
            if (orgIds.length > 0) {
              await prisma.organization.deleteMany({
                where: { id: { in: orgIds } },
              });
            }
          }
          await prisma.auditLog.deleteMany({
            where: { actorId: user.id },
          });
          await prisma.user.delete({ where: { id: user.id } });
        }
      }
    }

    if (tokeninfoServer) {
      await new Promise<void>((resolve) =>
        tokeninfoServer.close(() => resolve()),
      );
    }

    if (app) {
      await app.close();
    }

    if (originalGoogleClientId !== undefined) {
      process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
    } else {
      delete process.env.GOOGLE_CLIENT_ID;
    }

    if (originalGoogleTokeninfoUrl !== undefined) {
      process.env.GOOGLE_TOKENINFO_URL = originalGoogleTokeninfoUrl;
    } else {
      delete process.env.GOOGLE_TOKENINFO_URL;
    }

    if (originalAllowInsecure !== undefined) {
      process.env.ALLOW_INSECURE_HTTP_AUTH = originalAllowInsecure;
    } else {
      delete process.env.ALLOW_INSECURE_HTTP_AUTH;
    }
  });

  it('valid token for a new email WITH termsAccepted and ageConfirmed provisions user, workspace with trial, and sets session cookie', async () => {
    const email = 'google-new-user-e2e@example.com';
    createdEmails.push(email);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/google')
      .send({
        credential: 'valid-google-token',
        termsAccepted: true,
        ageConfirmed: true,
      })
      .expect(200);

    expect(res.body.message).toBe('Logged in successfully');

    // Assert session cookie is set
    const setCookieHeaders: string[] = res.headers['set-cookie'] || [];
    const sessionCookie = setCookieHeaders.find((c) =>
      c.startsWith('session='),
    );
    const csrfCookie = setCookieHeaders.find((c) => c.startsWith('csrfToken='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(csrfCookie).toBeDefined();

    // Verify user and tenant in database
    const user = await prisma.user.findUnique({
      where: { email },
    });
    expect(user).not.toBeNull();
    expect(user!.emailVerified).toBe(true);
    expect(user!.emailVerifiedAt).not.toBeNull();
    expect(user!.termsAcceptedAt).not.toBeNull();
    expect(user!.ageConfirmedAt).not.toBeNull();
    expect(user!.name).toBe('Google New User');

    // Verify workspace trial
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user!.id },
      include: { workspace: true },
    });
    expect(membership).not.toBeNull();
    expect(membership!.workspace.trialEndsAt).not.toBeNull();
    expect(membership!.workspace.trialEndsAt!.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('same email again logs in successfully without creating duplicate user', async () => {
    const email = 'google-new-user-e2e@example.com';

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/google')
      .send({
        credential: 'valid-google-token',
        termsAccepted: false,
      })
      .expect(200);

    expect(res.body.message).toBe('Logged in successfully');

    const setCookieHeaders: string[] = res.headers['set-cookie'] || [];
    const sessionCookie = setCookieHeaders.find((c) =>
      c.startsWith('session='),
    );
    expect(sessionCookie).toBeDefined();

    // Assert no duplicate users exist
    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(1);
  });

  it('valid token WITHOUT termsAccepted for a new email returns 400 exact message', async () => {
    const email = 'google-no-terms-e2e@example.com';
    createdEmails.push(email);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/google')
      .send({
        credential: 'valid-google-token-no-terms',
        termsAccepted: false,
        ageConfirmed: true,
      })
      .expect(400);

    const errorMessage = res.body?.error?.message || res.body?.message;
    expect(errorMessage).toBe(
      'No account exists for this email. Please sign up first.',
    );

    // Verify user was NOT created
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it('valid token WITH termsAccepted but WITHOUT ageConfirmed for a new email returns 400 and creates no user', async () => {
    const email = 'google-no-terms-e2e@example.com';
    createdEmails.push(email);

    const missingRes = await request(app.getHttpServer())
      .post('/api/v1/auth/google')
      .send({
        credential: 'valid-google-token-no-terms',
        termsAccepted: true,
      })
      .expect(400);

    expect(missingRes.body?.error?.message || missingRes.body?.message).toBe(
      'You must confirm that you are at least 18 years old',
    );

    const falseRes = await request(app.getHttpServer())
      .post('/api/v1/auth/google')
      .send({
        credential: 'valid-google-token-no-terms',
        termsAccepted: true,
        ageConfirmed: false,
      })
      .expect(400);

    expect(falseRes.body?.error?.message || falseRes.body?.message).toBe(
      'You must confirm that you are at least 18 years old',
    );

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it('invalid token returns 401 exact message', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/google')
      .send({
        credential: 'invalid-or-fake-token',
        termsAccepted: true,
      })
      .expect(401);

    const errorMessage = res.body?.error?.message || res.body?.message;
    expect(errorMessage).toBe('Google sign-in failed. Please try again.');
  });
});
