/* eslint-disable */
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { PinoLogger } from 'nestjs-pino';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import * as argon2 from '@node-rs/argon2';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { AppModule } from '../src/app.module';
import { PrismaClient, generateId } from '@agency-os/database';
import { loginAndGetSession, authHeaders } from './helpers';
import Redis from 'ioredis';

describe('Reports API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;

  let ownerUser: any;
  let editorUser: any;
  let viewerUser: any;

  let ownerSession: any;
  let editorSession: any;
  let viewerSession: any;

  let testOrg: string;
  let testWorkspace: string;
  let otherWorkspace: string;

  let account1: string;
  let post1: string;
  let variant1: string;

  beforeAll(async () => {
    const { assertTestDatabaseUrl } = require('@agency-os/database');
    assertTestDatabaseUrl(process.env.DATABASE_URL);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(await app.resolve(PinoLogger)));
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = app.get<PrismaClient>(PrismaClient);
    redis = app.get<Redis>('REDIS_CLIENT');

    // Flush any throttler keys in redis
    if (redis) {
      const keys = await redis.keys('throttler:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }

    const hashedPassword = await argon2.hash('password123');

    // 1. Users
    ownerUser = await prisma.user.create({
      data: {
        id: generateId(),
        email: `reports-owner-${generateId()}@example.com`,
        hashedPassword,
        emailVerified: true,
        securityEpoch: 1,
      },
    });

    editorUser = await prisma.user.create({
      data: {
        id: generateId(),
        email: `reports-editor-${generateId()}@example.com`,
        hashedPassword,
        emailVerified: true,
        securityEpoch: 1,
      },
    });

    viewerUser = await prisma.user.create({
      data: {
        id: generateId(),
        email: `reports-viewer-${generateId()}@example.com`,
        hashedPassword,
        emailVerified: true,
        securityEpoch: 1,
      },
    });

    // 2. Org & Workspaces
    testOrg = generateId();
    await prisma.organization.create({
      data: { id: testOrg, name: 'Reports Test Org' },
    });

    testWorkspace = generateId();
    await prisma.workspace.create({
      data: {
        id: testWorkspace,
        organizationId: testOrg,
        name: 'Reports Test Workspace',
      },
    });

    otherWorkspace = generateId();
    await prisma.workspace.create({
      data: {
        id: otherWorkspace,
        organizationId: testOrg,
        name: 'Other Workspace',
      },
    });

    // 3. Memberships
    await prisma.workspaceMember.createMany({
      data: [
        {
          id: generateId(),
          workspaceId: testWorkspace,
          userId: ownerUser.id,
          role: 'OWNER',
        },
        {
          id: generateId(),
          workspaceId: testWorkspace,
          userId: editorUser.id,
          role: 'EDITOR',
        },
        {
          id: generateId(),
          workspaceId: testWorkspace,
          userId: viewerUser.id,
          role: 'VIEWER',
        },
      ],
    });

    // 4. Social Account
    account1 = generateId();
    await prisma.socialAccount.create({
      data: {
        id: account1,
        workspaceId: testWorkspace,
        provider: 'TWITTER',
        externalId: `ext-${generateId()}`,
        name: 'Test Twitter Account',
        capabilities: ['ACCOUNT_READ'],
        status: 'ACTIVE',
      },
    });

    // 5. Daily Metrics
    await prisma.accountMetricDaily.createMany({
      data: [
        {
          id: generateId(),
          socialAccountId: account1,
          date: new Date('2026-10-15T00:00:00.000Z'),
          followers: 500,
          engagement: 50,
        },
        {
          id: generateId(),
          socialAccountId: account1,
          date: new Date('2026-10-25T00:00:00.000Z'),
          followers: 620,
          engagement: 80,
        },
      ],
    });

    // 6. Published Post and Variant
    post1 = generateId();
    await prisma.post.create({
      data: {
        id: post1,
        workspaceId: testWorkspace,
        content: 'Test post content for reports e2e',
        status: 'PUBLISHED',
      },
    });

    variant1 = generateId();
    await prisma.postPlatformVariant.create({
      data: {
        id: variant1,
        post: { connect: { id: post1 } },
        socialAccount: { connect: { id: account1 } },
        workspace: { connect: { id: testWorkspace } },
        status: 'PUBLISHED',
        publishedAt: new Date('2026-10-20T14:30:00.000Z'),
      },
    });

    // 7. Login sessions
    ownerSession = await loginAndGetSession(app, ownerUser.email, 'password123');
    editorSession = await loginAndGetSession(app, editorUser.email, 'password123');
    viewerSession = await loginAndGetSession(app, viewerUser.email, 'password123');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: { workspaceId: { in: [testWorkspace, otherWorkspace] } },
      });
      await prisma.postPlatformVariant.deleteMany({
        where: { id: variant1 },
      });
      await prisma.post.deleteMany({
        where: { id: post1 },
      });
      await prisma.accountMetricDaily.deleteMany({
        where: { socialAccountId: account1 },
      });
      await prisma.socialAccount.deleteMany({
        where: { id: account1 },
      });
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: { in: [testWorkspace, otherWorkspace] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [testWorkspace, otherWorkspace] } },
      });
      await prisma.organization.deleteMany({
        where: { id: testOrg },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [ownerUser?.id, editorUser?.id, viewerUser?.id] } },
      });
    }

    if (app) {
      await app.close();
    }
  });

  describe('GET /api/v1/workspaces/:workspaceId/reports/branding', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get(
        `/api/v1/workspaces/${testWorkspace}/reports/branding`,
      );
      expect(res.status).toBe(401);
    });

    it('returns 403 when user is not a member of the workspace', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${otherWorkspace}/reports/branding`)
        .set(authHeaders(ownerSession));
      expect(res.status).toBe(403);
    });

    it('returns default branding when workspace has no custom branding set', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace}/reports/branding`)
        .set(authHeaders(viewerSession));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        brandDisplayName: null,
        brandLogoUrl: null,
        brandAccentColor: null,
      });
    });
  });

  describe('PUT /api/v1/workspaces/:workspaceId/reports/branding', () => {
    it('returns 403 when EDITOR attempts to update branding (requires branding.manage)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/workspaces/${testWorkspace}/reports/branding`)
        .set(authHeaders(editorSession))
        .send({
          brandDisplayName: 'Editor Agency',
        });
      expect(res.status).toBe(403);
    });

    it('returns 400 when invalid hex color is provided', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/workspaces/${testWorkspace}/reports/branding`)
        .set(authHeaders(ownerSession))
        .send({
          brandDisplayName: 'Valid Name',
          brandAccentColor: 'not-a-hex',
        });
      expect(res.status).toBe(400);
    });

    it('returns 400 when invalid logo URL is provided', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/workspaces/${testWorkspace}/reports/branding`)
        .set(authHeaders(ownerSession))
        .send({
          brandDisplayName: 'Valid Name',
          brandLogoUrl: 'invalid-url',
        });
      expect(res.status).toBe(400);
    });

    it('updates branding successfully when called by OWNER', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/workspaces/${testWorkspace}/reports/branding`)
        .set(authHeaders(ownerSession))
        .send({
          brandDisplayName: 'Bespoke Agency',
          brandLogoUrl: 'https://cdn.example.com/logo.png',
          brandAccentColor: '#3B82F6',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        brandDisplayName: 'Bespoke Agency',
        brandLogoUrl: 'https://cdn.example.com/logo.png',
        brandAccentColor: '#3B82F6',
      });

      // Verify GET branding reflects new state
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace}/reports/branding`)
        .set(authHeaders(viewerSession));
      expect(getRes.status).toBe(200);
      expect(getRes.body.brandDisplayName).toBe('Bespoke Agency');
    });

    it('clears branding fields when empty strings are submitted', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/workspaces/${testWorkspace}/reports/branding`)
        .set(authHeaders(ownerSession))
        .send({
          brandDisplayName: '',
          brandLogoUrl: '',
          brandAccentColor: '',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        brandDisplayName: null,
        brandLogoUrl: null,
        brandAccentColor: null,
      });
    });
  });

  describe('GET /api/v1/workspaces/:workspaceId/reports/client-report', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get(
        `/api/v1/workspaces/${testWorkspace}/reports/client-report?from=2026-10-01&to=2026-10-31`,
      );
      expect(res.status).toBe(401);
    });

    it('returns 403 when VIEWER calls endpoint (requires reports.generate)', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${testWorkspace}/reports/client-report?from=2026-10-01&to=2026-10-31`,
        )
        .set(authHeaders(viewerSession));
      expect(res.status).toBe(403);
    });

    it('returns 400 when from or to query param is missing or malformed', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${testWorkspace}/reports/client-report?from=invalid`)
        .set(authHeaders(editorSession));
      expect(res.status).toBe(400);
    });

    it('returns 400 when from is greater than to', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${testWorkspace}/reports/client-report?from=2026-11-01&to=2026-10-01`,
        )
        .set(authHeaders(editorSession));
      expect(res.status).toBe(400);
    });

    it('generates a valid client report PDF with 200 and attachment header', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${testWorkspace}/reports/client-report?from=2026-10-01&to=2026-10-31`,
        )
        .set(authHeaders(editorSession))
        .responseType('blob');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain(
        `attachment; filename="client-report-${testWorkspace}-2026-10-01-2026-10-31.pdf"`,
      );

      const buf = Buffer.from(res.body);
      expect(buf.subarray(0, 4).toString('utf-8')).toBe('%PDF');

      // Verify audit log entry was created
      const auditEntry = await prisma.auditLog.findFirst({
        where: {
          workspaceId: testWorkspace,
          action: 'REPORT_GENERATED',
        },
      });
      expect(auditEntry).toBeDefined();
      expect(auditEntry?.actorId).toBe(editorUser.id);
    });

    it('filters report by socialAccountId when provided', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${testWorkspace}/reports/client-report?from=2026-10-01&to=2026-10-31&socialAccountId=${account1}`,
        )
        .set(authHeaders(ownerSession))
        .responseType('blob');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      const buf = Buffer.from(res.body);
      expect(buf.subarray(0, 4).toString('utf-8')).toBe('%PDF');
    });

    it('returns 404 when requested socialAccountId does not exist in workspace', async () => {
      const nonExistentAccountId = generateId();
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${testWorkspace}/reports/client-report?from=2026-10-01&to=2026-10-31&socialAccountId=${nonExistentAccountId}`,
        )
        .set(authHeaders(ownerSession));

      expect(res.status).toBe(404);
    });
  });
});
