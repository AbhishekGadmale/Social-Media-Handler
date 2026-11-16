/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from './../src/app.module';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { PrismaClient, generateId } from '@agency-os/database';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { PinoLogger } from 'nestjs-pino';
import * as http from 'node:http';

describe('Turnstile Verification on Signup (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let siteverifyServer: http.Server;
  let siteverifyUrl: string;

  const originalTurnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalTurnstileUrl = process.env.TURNSTILE_SITEVERIFY_URL;
  const originalAllowInsecure = process.env.ALLOW_INSECURE_HTTP_AUTH;
  const originalBreachCheck = process.env.PASSWORD_BREACH_CHECK_ENABLED;

  const createdEmails: string[] = [];
  const testPassword = 'TurnstileSecure#2026!Pass';

  beforeAll(async () => {
    // 1. Start local stub siteverify server on 127.0.0.1 (ephemeral port)
    await new Promise<void>((resolve) => {
      siteverifyServer = http.createServer((req, res) => {
        let rawBody = '';
        req.on('data', (chunk) => {
          rawBody += chunk;
        });
        req.on('end', () => {
          const params = new URLSearchParams(rawBody);
          const responseToken = params.get('response');
          if (responseToken === 'valid-test-token') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
                'error-codes': ['invalid-input-response'],
              }),
            );
          }
        });
      });

      siteverifyServer.listen(0, '127.0.0.1', () => {
        const addr = siteverifyServer.address() as any;
        siteverifyUrl = `http://127.0.0.1:${addr.port}`;
        process.env.TURNSTILE_SECRET_KEY = 'e2e-test-secret';
        process.env.TURNSTILE_SITEVERIFY_URL = siteverifyUrl;
        process.env.ALLOW_INSECURE_HTTP_AUTH = 'true';
        process.env.PASSWORD_BREACH_CHECK_ENABLED = 'false';
        resolve();
      });
    });

    // 2. Boot its own Nest application
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
    // Clean up provisioned users and associated records
    if (prisma && createdEmails.length > 0) {
      for (const email of createdEmails) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (user) {
          await prisma.emailVerificationToken.deleteMany({
            where: { userId: user.id },
          });
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
          await prisma.user.delete({ where: { id: user.id } });
        }
      }
    }

    if (app) {
      await app.close();
    }

    if (siteverifyServer) {
      await new Promise<void>((resolve) => siteverifyServer.close(() => resolve()));
    }

    // Restore environment variables
    if (originalTurnstileSecret !== undefined) {
      process.env.TURNSTILE_SECRET_KEY = originalTurnstileSecret;
    } else {
      delete process.env.TURNSTILE_SECRET_KEY;
    }

    if (originalTurnstileUrl !== undefined) {
      process.env.TURNSTILE_SITEVERIFY_URL = originalTurnstileUrl;
    } else {
      delete process.env.TURNSTILE_SITEVERIFY_URL;
    }

    if (originalAllowInsecure !== undefined) {
      process.env.ALLOW_INSECURE_HTTP_AUTH = originalAllowInsecure;
    } else {
      delete process.env.ALLOW_INSECURE_HTTP_AUTH;
    }

    if (originalBreachCheck !== undefined) {
      process.env.PASSWORD_BREACH_CHECK_ENABLED = originalBreachCheck;
    } else {
      delete process.env.PASSWORD_BREACH_CHECK_ENABLED;
    }
  });

  it('(a) rejects signup when turnstileToken is omitted (400 Bot verification failed)', async () => {
    const email = `no-token-${generateId()}@example.com`;

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'No Token User',
        email,
        password: testPassword,
        termsAccepted: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('BadRequestException');
    expect(res.body.error.message).toBe(
      'Bot verification failed. Please try again.',
    );
  });

  it('(b) rejects signup when turnstileToken is invalid (400 Bot verification failed)', async () => {
    const email = `wrong-token-${generateId()}@example.com`;

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'Wrong Token User',
        email,
        password: testPassword,
        termsAccepted: true,
        turnstileToken: 'wrong-token',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('BadRequestException');
    expect(res.body.error.message).toBe(
      'Bot verification failed. Please try again.',
    );
  });

  it('(c) accepts signup when turnstileToken is valid (201 Registration request received)', async () => {
    const email = `valid-token-${generateId()}@example.com`;
    createdEmails.push(email);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'Valid Turnstile User',
        email,
        password: testPassword,
        termsAccepted: true,
        organizationName: 'Turnstile Org',
        workspaceName: 'Turnstile Workspace',
        turnstileToken: 'valid-test-token',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      message: 'Registration request received.',
    });

    // Verify user was provisioned
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeDefined();
    expect(user?.email).toBe(email);
  });
});
