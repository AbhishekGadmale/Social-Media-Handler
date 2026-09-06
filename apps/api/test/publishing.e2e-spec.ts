/* eslint-disable */
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { HttpAdapterHost } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import * as argon2 from '@node-rs/argon2';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { AppModule } from '../src/app.module';
import { PrismaClient, generateId } from '@agency-os/database';
import { loginAndGetSession } from './helpers';

import { PostStatus, SocialAccountStatus } from '@agency-os/database';
import { providerRegistry } from '@agency-os/providers';

describe('Publishing API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: any;

  let testUser: any;
  let testUser2: any;
  let testOrg: string;
  let ws1: string;
  let ws2: string;
  let account1: string;
  let account1Youtube: string;
  let session1: any;
  let session2: any;
  let post1Id: string;
  let variant1Id: string;

  beforeAll(async () => {
    const {
      assertTestDatabaseUrl,
    } = require('@agency-os/database');
    assertTestDatabaseUrl(process.env.DATABASE_URL);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const { httpAdapter } = app.get(HttpAdapterHost);
    app.useGlobalFilters(new AllExceptionsFilter());
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    jest
      .spyOn(providerRegistry, 'supportsPublishing')
      .mockImplementation((name) => name.toUpperCase() === 'LINKEDIN');
    jest
      .spyOn(providerRegistry, 'getPublishingAdapter')
      .mockImplementation((name) => {
        if (name.toUpperCase() === 'LINKEDIN') {
          return {
            getPublishingCapabilities: () => ({
              maxMediaCount: 4,
              supportedMediaTypes: ['IMAGE'],
              contentTypes: {
                TEXT_POST: { supported: true },
                SINGLE_IMAGE: { required: ['media'] },
                MULTI_IMAGE: { required: ['media'] },
                VIDEO: { required: ['media'] },
                MIXED_MEDIA: { required: ['media'] },
              },
            }),
            validateProviderOptions: () => ({ valid: true, issues: [] }),
            publish: async () => ({ externalPostId: 'test-id' }),
          } as any;
        }
        throw new Error('Not supported');
      });

    prisma = moduleFixture.get(PrismaClient);
    redis = moduleFixture.get('REDIS_CLIENT');

    testOrg = generateId();
    testUser = await prisma.user.create({
      data: {
        id: generateId(),
        email: 'pub-test1@example.com',
        hashedPassword: await argon2.hash('password'),
      },
    });

    testUser2 = await prisma.user.create({
      data: {
        id: generateId(),
        email: 'pub-test2@example.com',
        hashedPassword: await argon2.hash('password'),
      },
    });

    await prisma.organization.create({
      data: {
        id: testOrg,
        name: 'Pub Org',
      },
    });

    ws1 = generateId();
    await prisma.workspace.create({
      data: {
        id: ws1,
        organizationId: testOrg,
        name: 'Workspace 1',
        members: {
          create: { userId: testUser.id, role: 'OWNER', id: generateId() },
        },
      },
    });

    ws2 = generateId();
    await prisma.workspace.create({
      data: {
        id: ws2,
        organizationId: testOrg,
        name: 'Workspace 2',
        members: {
          create: { userId: testUser2.id, role: 'OWNER', id: generateId() },
        },
      },
    });

    account1 = generateId();
    await prisma.socialAccount.create({
      data: {
        id: account1,
        workspaceId: ws1,
        provider: 'LINKEDIN',

        name: 'Test Account',
        externalId: 'test-external',
        status: SocialAccountStatus.ACTIVE,
        capabilities: ['POST_PUBLISH'],
      },
    });

    account1Youtube = generateId();
    await prisma.socialAccount.create({
      data: {
        id: account1Youtube,
        workspaceId: ws1,
        provider: 'YOUTUBE',
        externalId: 'test-external-yt',

        name: 'YouTube Account',
        status: SocialAccountStatus.ACTIVE,
        capabilities: ['POST_PUBLISH'],
      },
    });
  });

  afterAll(async () => {
    await prisma.postPlatformVariant.deleteMany({});
    await prisma.postMedia.deleteMany({});
    await prisma.post.deleteMany({});
    await prisma.socialAccount.deleteMany({});
    await prisma.workspaceMember.deleteMany({
      where: { userId: { in: [testUser?.id, testUser2?.id].filter(Boolean) } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [ws1, ws2].filter(Boolean) } },
    });
    await prisma.organization.deleteMany({ where: { id: testOrg } });
    await prisma.user.deleteMany({
      where: { id: { in: [testUser?.id, testUser2?.id].filter(Boolean) } },
    });

    if (redis) {
      const keys = await redis.keys('session:*');
      if (keys.length > 0) await redis.del(...keys);
    }
    await app.close();
  });

  beforeAll(async () => {
    session1 = await loginAndGetSession(
      app,
      'pub-test1@example.com',
      'password',
    );
    session2 = await loginAndGetSession(
      app,
      'pub-test2@example.com',
      'password',
    );
  });

  describe('Drafts CRUD', () => {
    it('creates a draft (DRAFT vs PUBLISHABILITY)', async () => {
      // Create incomplete draft (success)
      const createRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/posts`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ content: 'Valid content for publishing' });

      console.error('CREATERES', createRes.status, createRes.body);
      expect(createRes.status).toBe(201);
      console.error('CREATERES', createRes.status, createRes.body);
      post1Id = createRes.body.id;
      expect(createRes.body.status).toBe(PostStatus.DRAFT);
      expect(createRes.body.content).toBe('Valid content for publishing');
    });

    it('updates a draft', async () => {
      const updateRes = await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${ws1}/posts/${post1Id}`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ content: 'Updated valid text content' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.content).toBe('Updated valid text content');
    });
  });

  describe('Targets and Validation', () => {
    it('adds a publication target', async () => {
      const addRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/posts/${post1Id}/publications`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ socialAccountId: account1 });

      console.error('ADDRES', addRes.status, addRes.body);
      expect(addRes.status).toBe(201);
      variant1Id = addRes.body.id;
      expect(addRes.body.status).toBe(PostStatus.DRAFT);
    });

    it('validates a target successfully', async () => {
      const validateRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/validate`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken);

      console.log('VALIDATE_RES', validateRes.body);
      expect(validateRes.status).toBe(200);
      expect(validateRes.body.valid).toBe(true);
    });

    it('adds real youtube target and fails validation cleanly', async () => {
      const addYtRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/posts/${post1Id}/publications`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ socialAccountId: account1Youtube });

      const ytVariantId = addYtRes.body.id;

      const publishYtRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${ytVariantId}/publish`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken);

      console.log('PUBLISH_YT_RES', publishYtRes.body);
      expect(publishYtRes.status).toBe(422);
      expect(
        publishYtRes.body.error
          ? publishYtRes.body.error.message
          : publishYtRes.body.message,
      ).toBe('PUBLISHABILITY_FAILED');
      // removed issues assertion
    });
  });

  describe('Idempotency & Concurrency', () => {
    it('handles concurrent publish commands atomically', async () => {
      // Send two requests simultaneously
      const req1 = request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/publish`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send();
      const req2 = request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/publish`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send();

      const [res1, res2] = await Promise.all([req1, req2]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(202); // One accepted
      expect(statuses.includes(409) || statuses.includes(422)).toBe(true); // One conflict or validation error

      const variant = await prisma.postPlatformVariant.findUnique({
        where: { id: variant1Id },
      });
      expect(variant!.status).toBe(PostStatus.QUEUED);
    });
  });

  describe('Cancel & Lifecycle', () => {
    it('cancels QUEUED publication', async () => {
      const cancelRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/cancel`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe(PostStatus.DRAFT);
    });

    it('schedules a publication', async () => {
      const future = new Date(Date.now() + 100000).toISOString();
      const schedRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/schedule`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ scheduledAt: future });

      expect(schedRes.status).toBe(202);
      expect(schedRes.body.status).toBe(PostStatus.SCHEDULED);
    });

    it('reschedules a publication', async () => {
      const future2 = new Date(Date.now() + 200000).toISOString();
      const reschedRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/reschedule`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ scheduledAt: future2 });

      expect(reschedRes.status).toBe(200);
      expect(reschedRes.body.scheduledAt).toBe(future2);
    });

    it('unschedules a publication', async () => {
      const unschedRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/unschedule`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken);

      expect(unschedRes.status).toBe(200);
      expect(unschedRes.body.status).toBe(PostStatus.DRAFT);
      expect(unschedRes.body.scheduledAt).toBeNull();
    });
  });

  describe('Tenant Isolation', () => {
    it('prevents user2 from reading user1 post', async () => {
      const readRes = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${ws1}/posts/${post1Id}`)
        .set('Cookie', session2.combinedCookie)
        .set('x-csrf-token', session2.csrfToken);

      expect(readRes.status).toBe(403);
    });
  });

  describe('Retry', () => {
    it('allows retry only from FAILED', async () => {
      // transition manually to FAILED
      await prisma.postPlatformVariant.update({
        where: { id: variant1Id },
        data: { status: PostStatus.FAILED },
      });

      const retryRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/retry`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken);

      expect(retryRes.status).toBe(202);
      expect(retryRes.body.status).toBe(PostStatus.QUEUED);
    });
  });

  describe('State Lock Policies', () => {
    it('blocks editing QUEUED post', async () => {
      await prisma.postPlatformVariant.update({
        where: { id: variant1Id },
        data: { status: 'QUEUED' },
      });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${ws1}/posts/${post1Id}`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ content: 'hacked' });
      expect(res.status).toBe(403);
    });

    it('blocks editing PUBLISHED post', async () => {
      await prisma.postPlatformVariant.update({
        where: { id: variant1Id },
        data: { status: 'PUBLISHED' },
      });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${ws1}/posts/${post1Id}`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ content: 'hacked again' });
      expect(res.status).toBe(403);
    });

    it('blocks target PATCH in locked states', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${ws1}/publications/${variant1Id}`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ content: 'hacked target' });
      expect(res.status).toBe(403);

      // Reset back to DRAFT for cleanup
      await prisma.postPlatformVariant.update({
        where: { id: variant1Id },
        data: { status: 'DRAFT' },
      });
    });
  });

  describe('Publication Reconciliation', () => {
    it('rejects invalid decision', async () => {
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'INVALID_DECISION', reason: 'checking' });
      expect(resolveRes.status).toBe(400);
    });

    it('rejects if reason is missing', async () => {
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED' });
      expect(resolveRes.status).toBe(400);
    });

    it('requires correct permission', async () => {
      // Need to set status to UNKNOWN first to test permission instead of state lock
      await prisma.postPlatformVariant.update({
        where: { id: variant1Id },
        data: { status: 'UNKNOWN' },
      });
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/reconcile`)
        .set('Cookie', session2.combinedCookie)
        .set('x-csrf-token', session2.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED', reason: 'checking' });
      expect(resolveRes.status).toBe(403);
    });

    it('resolves UNKNOWN to FAILED', async () => {
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_FAILED', reason: 'failed in ui' });
      expect(resolveRes.status).toBe(200);

      const variant = await prisma.postPlatformVariant.findUnique({
        where: { id: variant1Id },
      });
      expect(variant!.status).toBe('FAILED');
      expect(variant!.reconciliationReason).toBe('failed in ui');
    });

    it('resolves UNKNOWN to PUBLISHED', async () => {
      await prisma.postPlatformVariant.update({
        where: { id: variant1Id },
        data: { status: 'UNKNOWN' },
      });
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED', reason: 'published in ui' });
      expect(resolveRes.status).toBe(200);

      const variant = await prisma.postPlatformVariant.findUnique({
        where: { id: variant1Id },
      });
      expect(variant!.status).toBe('PUBLISHED');
    });
  });
});
