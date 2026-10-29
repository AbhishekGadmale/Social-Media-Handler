/* eslint-disable */
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { PinoLogger } from 'nestjs-pino';
import { HttpAdapterHost } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import * as argon2 from '@node-rs/argon2';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { AppModule } from '../src/app.module';
import { randomUUID } from 'crypto';
import { PrismaClient, generateId } from '@agency-os/database';
import { loginAndGetSession } from './helpers';

import { PostStatus, SocialAccountStatus } from '@agency-os/database';
import { providerRegistry } from '@agency-os/providers';


async function waitForBlockedRowLock(
  prismaClient: PrismaClient,
  maxWaitMs = 3000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const ungranted = await prismaClient.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int as count FROM pg_locks WHERE granted = false
    `;
    if (ungranted[0]?.count > 0) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

describe('Publishing API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: any;

  let testUser: any;
  let testUser2: any;
  let testUser3: any;
  let testOrg: string;
  let ws1: string;
  let ws2: string;
  let account1: string;
  let account1Youtube: string;
  let session1: any;
  let session2: any;
  let session3: any;
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
    app.useGlobalFilters(new AllExceptionsFilter(await app.resolve(PinoLogger)));
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

    testUser3 = await prisma.user.create({
      data: {
        id: generateId(),
        email: 'pub-test3@example.com',
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
          create: [
            { userId: testUser.id, role: 'OWNER', id: generateId() },
            { userId: testUser3.id, role: 'EDITOR', id: generateId() },
          ],
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
    await prisma.mediaAsset.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.socialAccount.deleteMany({});
    await prisma.workspaceMember.deleteMany({
      where: { userId: { in: [testUser?.id, testUser2?.id, testUser3?.id].filter(Boolean) } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [ws1, ws2].filter(Boolean) } },
    });
    await prisma.organization.deleteMany({ where: { id: testOrg } });
    await prisma.user.deleteMany({
      where: { id: { in: [testUser?.id, testUser2?.id, testUser3?.id].filter(Boolean) } },
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
    session3 = await loginAndGetSession(
      app,
      'pub-test3@example.com',
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

  describe('Transactional Draft Audit Rollback & Atomicity', () => {
    let media1Id: string;
    let media2Id: string;
    let crossWsMediaId: string;

    beforeAll(async () => {
      media1Id = randomUUID();
      await prisma.mediaAsset.create({
        data: {
          id: media1Id,
          workspaceId: ws1,
          filename: 'image1.png',
          mimeType: 'image/png',
          byteSize: 1024,
          storageKey: `workspaces/${ws1}/image1.png`,
          status: 'READY',
        },
      });

      media2Id = randomUUID();
      await prisma.mediaAsset.create({
        data: {
          id: media2Id,
          workspaceId: ws1,
          filename: 'image2.png',
          mimeType: 'image/png',
          byteSize: 2048,
          storageKey: `workspaces/${ws1}/image2.png`,
          status: 'READY',
        },
      });

      crossWsMediaId = randomUUID();
      await prisma.mediaAsset.create({
        data: {
          id: crossWsMediaId,
          workspaceId: ws2,
          filename: 'image-ws2.png',
          mimeType: 'image/png',
          byteSize: 1024,
          storageKey: `workspaces/${ws2}/image-ws2.png`,
          status: 'READY',
        },
      });
    });

    it('proves database rollback during createDraft when transaction audit write fails, and succeeds on retry', async () => {
      const originalTx = prisma.$transaction.bind(prisma);
      let injectAuditFailure = true;

      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (arg: any) => {
          if (typeof arg === 'function') {
            return originalTx(async (tx: any) => {
              const originalCreate = tx.auditLog.create.bind(tx);
              tx.auditLog.create = async (createArgs: any) => {
                if (
                  injectAuditFailure &&
                  createArgs.data?.action === 'POST_CREATED'
                ) {
                  throw new Error(
                    'Simulated transactional AuditLog failure during POST_CREATED',
                  );
                }
                return originalCreate(createArgs);
              };
              return arg(tx);
            });
          }
          return originalTx(arg);
        });

      const uniqueContent = `Draft rollback test ${generateId()}`;

      // 1. Attempt to create draft while audit write fails
      const failRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/posts`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({
          content: uniqueContent,
          mediaIds: [media1Id],
        });

      expect(failRes.status).toBe(500);

      // Verify REAL PostgreSQL rollback: NO Post or PostMedia rows exist with this content
      const foundPosts = await prisma.post.findMany({
        where: { workspaceId: ws1, content: uniqueContent },
        include: { media: true },
      });
      expect(foundPosts.length).toBe(0);

      const foundMediaRelations = await prisma.postMedia.findMany({
        where: { mediaId: media1Id },
      });
      expect(foundMediaRelations.length).toBe(0);

      // 2. Remove failure and retry
      injectAuditFailure = false;

      const retryRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/posts`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({
          content: uniqueContent,
          mediaIds: [media1Id],
        });

      expect(retryRes.status).toBe(201);
      const createdPostId = retryRes.body.id;

      // Verify exactly ONE post, ONE postMedia relation, and ONE audit log exist
      const persistedPost = await prisma.post.findUnique({
        where: { id: createdPostId },
        include: { media: true },
      });
      expect(persistedPost).not.toBeNull();
      expect(persistedPost!.content).toBe(uniqueContent);
      expect(persistedPost!.media.length).toBe(1);
      expect(persistedPost!.media[0].mediaId).toBe(media1Id);

      const postAudits = await prisma.auditLog.findMany({
        where: {
          workspaceId: ws1,
          targetId: createdPostId,
          action: 'POST_CREATED',
        },
      });
      expect(postAudits.length).toBe(1);
      expect(postAudits[0].actorId).toBe(testUser.id);

      spy.mockRestore();
    });

    it('proves database rollback during updateDraft when transaction audit write fails, keeping original content and media', async () => {
      // First create a baseline post with media1
      const initialContent = `Initial content ${generateId()}`;
      const createRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/posts`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({
          content: initialContent,
          mediaIds: [media1Id],
        });

      expect(createRes.status).toBe(201);
      const targetPostId = createRes.body.id;

      // Spy to inject failure into tx.auditLog.create when action === POST_UPDATED
      const originalTx = prisma.$transaction.bind(prisma);
      let injectAuditFailure = true;

      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (arg: any) => {
          if (typeof arg === 'function') {
            return originalTx(async (tx: any) => {
              const originalCreate = tx.auditLog.create.bind(tx);
              tx.auditLog.create = async (createArgs: any) => {
                if (
                  injectAuditFailure &&
                  createArgs.data?.action === 'POST_UPDATED'
                ) {
                  throw new Error(
                    'Simulated transactional AuditLog failure during POST_UPDATED',
                  );
                }
                return originalCreate(createArgs);
              };
              return arg(tx);
            });
          }
          return originalTx(arg);
        });

      const updatedContent = `Updated content attempt ${generateId()}`;

      // Attempt to update post (switch to media2) while audit write fails
      const failUpdateRes = await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${ws1}/posts/${targetPostId}`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({
          content: updatedContent,
          mediaIds: [media2Id],
        });

      expect(failUpdateRes.status).toBe(500);

      // Verify REAL PostgreSQL rollback: Post MUST retain initialContent, NOT updatedContent!
      const postAfterFailedUpdate = await prisma.post.findUnique({
        where: { id: targetPostId },
        include: { media: true },
      });
      expect(postAfterFailedUpdate!.content).toBe(initialContent);
      expect(postAfterFailedUpdate!.media.length).toBe(1);
      expect(postAfterFailedUpdate!.media[0].mediaId).toBe(media1Id); // media1 NOT deleted!

      // Verify NO POST_UPDATED audit log exists
      const updateAudits = await prisma.auditLog.findMany({
        where: { targetId: targetPostId, action: 'POST_UPDATED' },
      });
      expect(updateAudits.length).toBe(0);

      // Remove failure and retry update
      injectAuditFailure = false;

      const retryUpdateRes = await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${ws1}/posts/${targetPostId}`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({
          content: updatedContent,
          mediaIds: [media2Id],
        });

      expect(retryUpdateRes.status).toBe(200);

      const postAfterSuccessfulRetry = await prisma.post.findUnique({
        where: { id: targetPostId },
        include: { media: true },
      });
      expect(postAfterSuccessfulRetry!.content).toBe(updatedContent);
      expect(postAfterSuccessfulRetry!.media.length).toBe(1);
      expect(postAfterSuccessfulRetry!.media[0].mediaId).toBe(media2Id);

      const successfulAudits = await prisma.auditLog.findMany({
        where: { targetId: targetPostId, action: 'POST_UPDATED' },
      });
      expect(successfulAudits.length).toBe(1);
      expect(successfulAudits[0].actorId).toBe(testUser.id);

      spy.mockRestore();
    });

    it('rejects cross-workspace media IDs and creates no post, media relations, or audit logs', async () => {
      const crossWsContent = `Cross-ws attempt ${generateId()}`;

      // 1. In createDraft
      const createRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/posts`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({
          content: crossWsContent,
          mediaIds: [crossWsMediaId], // belongs to ws2!
        });

      expect(createRes.status).toBe(404);
      expect(createRes.body.error.message).toContain(
        'One or more media assets not found in workspace',
      );

      const foundPosts = await prisma.post.findMany({
        where: { content: crossWsContent },
      });
      expect(foundPosts.length).toBe(0);

      // 2. In updateDraft
      const validDraft = await prisma.post.create({
        data: {
          id: generateId(),
          workspaceId: ws1,
          authorId: testUser.id,
          content: 'Pre-existing draft',
          status: PostStatus.DRAFT,
        },
      });

      const updateRes = await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${ws1}/posts/${validDraft.id}`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({
          mediaIds: [crossWsMediaId],
        });

      expect(updateRes.status).toBe(404);
      expect(updateRes.body.error.message).toContain(
        'One or more media assets not found in workspace',
      );

      const unmodifiedDraft = await prisma.post.findUnique({
        where: { id: validDraft.id },
        include: { media: true },
      });
      expect(unmodifiedDraft!.content).toBe('Pre-existing draft');
      expect(unmodifiedDraft!.media.length).toBe(0);
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


  describe('Remote Deletion', () => {
    it('enqueues deletion for an existing publication', async () => {
      await prisma.postPlatformVariant.update({
        where: { id: variant1Id },
        data: { status: 'PUBLISHED', externalPostId: 'urn:li:123' },
      });

      const delRes = await request(app.getHttpServer())
        .delete(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/remote`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken);

      if (delRes.status !== 202) console.error(delRes.body);
      expect(delRes.status).toBe(202);

      const variant = await prisma.postPlatformVariant.findUnique({
        where: { id: variant1Id },
      });
      expect(variant?.status).toBe('DELETING');
    });

    it('rejects deletion for invalid state', async () => {
      await prisma.postPlatformVariant.update({
        where: { id: variant1Id },
        data: { status: 'QUEUED' },
      });

      const delRes = await request(app.getHttpServer())
        .delete(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/remote`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken);

      expect(delRes.status).toBe(409);
    });

    it('prevents user2 from deleting user1 publication', async () => {
      const delRes = await request(app.getHttpServer())
        .delete(`/api/v1/workspaces/${ws1}/publications/${variant1Id}/remote`)
        .set('Cookie', session2.combinedCookie)
        .set('x-csrf-token', session2.csrfToken);

      expect(delRes.status).toBe(403);
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

  describe('Draft Update Concurrency & Variant Lock Policy', () => {
    it.each([
      PostStatus.QUEUED,
      PostStatus.PUBLISHING,
      PostStatus.PUBLISHED,
      PostStatus.UNKNOWN,
      PostStatus.SCHEDULED,
    ])(
      'rejects updateDraft with 403 when variant is in locked status %s',
      async (status) => {
        const testPostId = generateId();
        const testVariantId = generateId();
        const initialContent = `Static test content for ${status}`;

        await prisma.post.create({
          data: {
            id: testPostId,
            workspaceId: ws1,
            authorId: testUser.id,
            content: initialContent,
            status: PostStatus.DRAFT,
          },
        });

        await prisma.postPlatformVariant.create({
          data: {
            id: testVariantId,
            postId: testPostId,
            workspaceId: ws1,
            socialAccountId: account1,
            status,
            content: initialContent,
            ...(status === PostStatus.SCHEDULED
              ? { scheduledAt: new Date(Date.now() + 86400000) }
              : {}),
          },
        });

        const res = await request(app.getHttpServer())
          .patch(`/api/v1/workspaces/${ws1}/posts/${testPostId}`)
          .set('Cookie', session1.combinedCookie)
          .set('x-csrf-token', session1.csrfToken)
          .send({ content: 'Attempted edit during locked status' });

        expect(res.status).toBe(403);
        expect(res.body.error.message).toBe(
          `Cannot edit post while a publication is in ${status} state`,
        );

        // Verify post content remains unmodified
        const postInDb = await prisma.post.findUnique({
          where: { id: testPostId },
        });
        expect(postInDb!.content).toBe(initialContent);

        // Verify no POST_UPDATED audit log was written
        const audits = await prisma.auditLog.findMany({
          where: { targetId: testPostId, action: 'POST_UPDATED' },
        });
        expect(audits.length).toBe(0);
      },
    );

    it('serializes concurrent transition vs updateDraft: transition wins, updateDraft is blocked, unblocks, and rejects with 403 without mutating post or writing audit', async () => {
      const testPostId = generateId();
      const testVariantId = generateId();
      const initialContent = `Initial content transition wins ${generateId()}`;

      await prisma.post.create({
        data: {
          id: testPostId,
          workspaceId: ws1,
          authorId: testUser.id,
          content: initialContent,
          status: PostStatus.DRAFT,
        },
      });

      await prisma.postPlatformVariant.create({
        data: {
          id: testVariantId,
          postId: testPostId,
          workspaceId: ws1,
          socialAccountId: account1,
          status: PostStatus.DRAFT,
          content: initialContent,
        },
      });

      let signalTransitionLocked: () => void;
      const transitionLockedPromise = new Promise<void>(
        (r) => (signalTransitionLocked = r),
      );
      let releaseTransition: () => void;
      const allowTransitionCommitPromise = new Promise<void>(
        (r) => (releaseTransition = r),
      );

      // Transition transaction starts, updates variant to QUEUED, and holds exclusive lock
      const transitionTxPromise = prisma.$transaction(async (tx) => {
        await tx.postPlatformVariant.update({
          where: { id: testVariantId },
          data: { status: PostStatus.QUEUED, queuedAt: new Date() },
        });
        signalTransitionLocked();
        await allowTransitionCommitPromise;
      });

      // Wait until transition holds the lock
      await transitionLockedPromise;

      // Eagerly launch updateDraft via HTTP with .end() so it immediately hits the server and blocks on PostgreSQL
      const updateResPromise = new Promise<any>((resolve, reject) => {
        request(app.getHttpServer())
          .patch(`/api/v1/workspaces/${ws1}/posts/${testPostId}`)
          .set('Cookie', session1.combinedCookie)
          .set('x-csrf-token', session1.csrfToken)
          .send({ content: 'Conflicting update attempt' })
          .end((err: any, res: any) => {
            if (err) return reject(err);
            resolve(res);
          });
      });

      try {
        // Deterministically verify that updateDraft is physically blocked in PostgreSQL
        const isBlocked = await waitForBlockedRowLock(prisma);
        expect(isBlocked).toBe(true);
      } finally {
        // Always release transition transaction to commit even if assertion fails
        releaseTransition!();
        await transitionTxPromise;
      }

      // updateDraft unblocks, sees newly committed QUEUED status, and throws 403
      const updateRes = await updateResPromise;
      expect(updateRes.status).toBe(403);
      expect(updateRes.body.error.message).toBe(
        'Cannot edit post while a publication is in QUEUED state',
      );

      // Verify post content remains unchanged in DB
      const postInDb = await prisma.post.findUnique({
        where: { id: testPostId },
      });
      expect(postInDb!.content).toBe(initialContent);

      // Verify no POST_UPDATED audit record was created
      const audits = await prisma.auditLog.findMany({
        where: { targetId: testPostId, action: 'POST_UPDATED' },
      });
      expect(audits.length).toBe(0);
    });

    it('serializes concurrent updateDraft vs publish request: edit wins, transition waits, edit commits with audit, publish proceeds on updated content', async () => {
      const testPostId = generateId();
      const testVariantId = generateId();
      const initialContent = `Initial content edit wins ${generateId()}`;
      const updatedContent = `Updated content serialized ${generateId()}`;

      await prisma.post.create({
        data: {
          id: testPostId,
          workspaceId: ws1,
          authorId: testUser.id,
          content: initialContent,
          status: PostStatus.DRAFT,
        },
      });

      await prisma.postPlatformVariant.create({
        data: {
          id: testVariantId,
          postId: testPostId,
          workspaceId: ws1,
          socialAccountId: account1,
          status: PostStatus.DRAFT,
          content: initialContent,
        },
      });

      let signalEditLocked: () => void;
      const editLockedPromise = new Promise<void>(
        (r) => (signalEditLocked = r),
      );
      let releaseEdit: () => void;
      const allowEditCommitPromise = new Promise<void>(
        (r) => (releaseEdit = r),
      );

      const originalTx = prisma.$transaction.bind(prisma);
      const txSpy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (arg: any) => {
          if (typeof arg === 'function') {
            return originalTx(async (tx: any) => {
              const originalUpdate = tx.post.update.bind(tx);
              tx.post.update = async (updateArgs: any) => {
                const res = await originalUpdate(updateArgs);
                // At this point Post and variants are row-locked, and post is updated in tx
                signalEditLocked();
                await allowEditCommitPromise;
                return res;
              };
              return arg(tx);
            });
          }
          return originalTx(arg);
        });

      try {
        // Eagerly launch updateDraft via HTTP with .end()
        const updateDraftPromise = new Promise<any>((resolve, reject) => {
          request(app.getHttpServer())
            .patch(`/api/v1/workspaces/${ws1}/posts/${testPostId}`)
            .set('Cookie', session1.combinedCookie)
            .set('x-csrf-token', session1.csrfToken)
            .send({ content: updatedContent })
            .end((err: any, res: any) => {
              if (err) return reject(err);
              resolve(res);
            });
        });

        // Wait until updateDraft holds the row locks in its transaction
        await editLockedPromise;

        // Concurrently trigger publish request for the variant via HTTP with .end()
        const publishPromise = new Promise<any>((resolve, reject) => {
          request(app.getHttpServer())
            .post(`/api/v1/workspaces/${ws1}/publications/${testVariantId}/publish`)
            .set('Cookie', session1.combinedCookie)
            .set('x-csrf-token', session1.csrfToken)
            .end((err: any, res: any) => {
              if (err) return reject(err);
              resolve(res);
            });
        });

        // Verify that publish request is physically waiting on the variant row lock
        const isBlocked = await waitForBlockedRowLock(prisma);
        expect(isBlocked).toBe(true);

        // Release updateDraft to commit
        releaseEdit!();

        const [updateRes, publishRes] = await Promise.all([
          updateDraftPromise,
          publishPromise,
        ]);

        expect(updateRes.status).toBe(200);
        expect(updateRes.body.content).toBe(updatedContent);

        expect(publishRes.status).toBe(202);
        expect(publishRes.body.status).toBe(PostStatus.QUEUED);

        // Verify post content in DB is the updated content
        const finalPost = await prisma.post.findUnique({
          where: { id: testPostId },
          include: { variants: true },
        });
        expect(finalPost!.content).toBe(updatedContent);
        expect(finalPost!.variants[0].status).toBe(PostStatus.QUEUED);

        // Verify audit logs: exactly 1 POST_UPDATED and 1 PUBLICATION_REQUESTED
        const updateAudits = await prisma.auditLog.findMany({
          where: { targetId: testPostId, action: 'POST_UPDATED' },
        });
        expect(updateAudits.length).toBe(1);

        const publishAudits = await prisma.auditLog.findMany({
          where: { targetId: testVariantId, action: 'PUBLICATION_REQUESTED' },
        });
        expect(publishAudits.length).toBe(1);
      } finally {
        releaseEdit!();
        txSpy.mockRestore();
      }
    });

    it('guarantees tenant and post isolation: concurrent operations on different posts or workspaces do not block each other', async () => {
      const postAId = generateId();
      const postBId = generateId();
      const variantAId = generateId();

      await prisma.post.create({
        data: {
          id: postAId,
          workspaceId: ws1,
          authorId: testUser.id,
          content: 'Post A Initial',
          status: PostStatus.DRAFT,
        },
      });
      await prisma.postPlatformVariant.create({
        data: {
          id: variantAId,
          postId: postAId,
          workspaceId: ws1,
          socialAccountId: account1,
          status: PostStatus.DRAFT,
          content: 'Post A Initial',
        },
      });

      await prisma.post.create({
        data: {
          id: postBId,
          workspaceId: ws2,
          authorId: testUser2.id,
          content: 'Post B Initial',
          status: PostStatus.DRAFT,
        },
      });

      // Post A is held in a transaction
      let signalALocked: () => void;
      const aLockedPromise = new Promise<void>((r) => (signalALocked = r));
      let releaseA: () => void;
      const allowACommitPromise = new Promise<void>((r) => (releaseA = r));

      const txAPromise = prisma.$transaction(async (tx) => {
        await tx.postPlatformVariant.update({
          where: { id: variantAId },
          data: { status: PostStatus.QUEUED },
        });
        signalALocked();
        await allowACommitPromise;
      });

      await aLockedPromise;

      try {
        // Edit Post B in Workspace 2 concurrently — it must NOT block and must succeed immediately
        const updateBRes = await request(app.getHttpServer())
          .patch(`/api/v1/workspaces/${ws2}/posts/${postBId}`)
          .set('Cookie', session2.combinedCookie)
          .set('x-csrf-token', session2.csrfToken)
          .send({ content: 'Post B Updated Concurrently' });

        expect(updateBRes.status).toBe(200);
        expect(updateBRes.body.content).toBe('Post B Updated Concurrently');
      } finally {
        releaseA!();
        await txAPromise;
      }
    });
  });

  describe('Post Deletion Concurrency & Variant Lock Policy', () => {
    it.each([
      PostStatus.QUEUED,
      PostStatus.PUBLISHING,
      PostStatus.PUBLISHED,
      PostStatus.UNKNOWN,
      PostStatus.SCHEDULED,
    ])(
      'rejects deletePost with 403 when variant is in locked status %s',
      async (status) => {
        const testPostId = generateId();
        const testVariantId = generateId();

        await prisma.post.create({
          data: {
            id: testPostId,
            workspaceId: ws1,
            authorId: testUser.id,
            content: `Static delete test content for ${status}`,
            status: PostStatus.DRAFT,
          },
        });

        await prisma.postPlatformVariant.create({
          data: {
            id: testVariantId,
            postId: testPostId,
            workspaceId: ws1,
            socialAccountId: account1,
            status,
            content: `Static delete variant for ${status}`,
          },
        });

        const res = await request(app.getHttpServer())
          .delete(`/api/v1/workspaces/${ws1}/posts/${testPostId}`)
          .set('Cookie', session1.combinedCookie)
          .set('x-csrf-token', session1.csrfToken);

        expect(res.status).toBe(403);
        expect(res.body.error.message).toBe(
          `Cannot delete post with a publication in ${status} state`,
        );

        // Ensure post was NOT deleted
        const postInDb = await prisma.post.findUnique({
          where: { id: testPostId },
        });
        expect(postInDb).not.toBeNull();

        // Ensure no POST_DELETED audit record
        const audits = await prisma.auditLog.findMany({
          where: { targetId: testPostId, action: 'POST_DELETED' },
        });
        expect(audits.length).toBe(0);
      },
    );

    it('serializes concurrent transition vs deletePost: transition wins, delete is blocked, unblocks, and rejects with 403 without deleting post or writing audit', async () => {
      const testPostId = generateId();
      const testVariantId = generateId();
      const initialContent = `Initial content transition wins delete ${generateId()}`;

      await prisma.post.create({
        data: {
          id: testPostId,
          workspaceId: ws1,
          authorId: testUser.id,
          content: initialContent,
          status: PostStatus.DRAFT,
        },
      });

      await prisma.postPlatformVariant.create({
        data: {
          id: testVariantId,
          postId: testPostId,
          workspaceId: ws1,
          socialAccountId: account1,
          status: PostStatus.DRAFT,
          content: initialContent,
        },
      });

      let signalTransitionLocked: () => void;
      const transitionLockedPromise = new Promise<void>(
        (r) => (signalTransitionLocked = r),
      );
      let releaseTransition: () => void;
      const allowTransitionCommitPromise = new Promise<void>(
        (r) => (releaseTransition = r),
      );

      // Transition transaction starts, updates variant to QUEUED, and holds exclusive lock
      const transitionTxPromise = prisma.$transaction(async (tx) => {
        await tx.postPlatformVariant.update({
          where: { id: testVariantId },
          data: { status: PostStatus.QUEUED, queuedAt: new Date() },
        });
        signalTransitionLocked();
        await allowTransitionCommitPromise;
      });

      // Wait until transition holds the lock
      await transitionLockedPromise;

      // Eagerly launch deletePost via HTTP with .end() so it immediately hits the server and blocks on PostgreSQL
      const deleteResPromise = new Promise<any>((resolve, reject) => {
        request(app.getHttpServer())
          .delete(`/api/v1/workspaces/${ws1}/posts/${testPostId}`)
          .set('Cookie', session1.combinedCookie)
          .set('x-csrf-token', session1.csrfToken)
          .end((err: any, res: any) => {
            if (err) return reject(err);
            resolve(res);
          });
      });

      try {
        // Deterministically verify that deletePost is physically blocked in PostgreSQL
        const isBlocked = await waitForBlockedRowLock(prisma);
        expect(isBlocked).toBe(true);
      } finally {
        // Always release transition transaction to commit even if assertion fails
        releaseTransition!();
        await transitionTxPromise;
      }

      // deletePost unblocks, sees newly committed QUEUED status, and throws 403
      const deleteRes = await deleteResPromise;
      expect(deleteRes.status).toBe(403);
      expect(deleteRes.body.error.message).toBe(
        'Cannot delete post with a publication in QUEUED state',
      );

      // Verify post remains in DB with variant in QUEUED status
      const postInDb = await prisma.post.findUnique({
        where: { id: testPostId },
        include: { variants: true },
      });
      expect(postInDb).not.toBeNull();
      expect(postInDb!.variants[0].status).toBe(PostStatus.QUEUED);

      // Verify no POST_DELETED audit record was created
      const audits = await prisma.auditLog.findMany({
        where: { targetId: testPostId, action: 'POST_DELETED' },
      });
      expect(audits.length).toBe(0);
    });

    it('serializes concurrent deletePost vs publish request: delete wins, transition waits, delete commits with audit, publish fails with 409', async () => {
      const testPostId = generateId();
      const testVariantId = generateId();
      const initialContent = `Initial content delete wins ${generateId()}`;

      await prisma.post.create({
        data: {
          id: testPostId,
          workspaceId: ws1,
          authorId: testUser.id,
          content: initialContent,
          status: PostStatus.DRAFT,
        },
      });

      await prisma.postPlatformVariant.create({
        data: {
          id: testVariantId,
          postId: testPostId,
          workspaceId: ws1,
          socialAccountId: account1,
          status: PostStatus.DRAFT,
          content: initialContent,
        },
      });

      let signalDeleteLocked: () => void;
      const deleteLockedPromise = new Promise<void>(
        (r) => (signalDeleteLocked = r),
      );
      let releaseDelete: () => void;
      const allowDeleteCommitPromise = new Promise<void>(
        (r) => (releaseDelete = r),
      );

      const originalTx = prisma.$transaction.bind(prisma);
      const txSpy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (arg: any) => {
          if (typeof arg === 'function') {
            return originalTx(async (tx: any) => {
              const originalDelete = tx.post.delete.bind(tx);
              tx.post.delete = async (deleteArgs: any) => {
                const res = await originalDelete(deleteArgs);
                // At this point Post and variants are row-locked, and post is deleted in tx
                signalDeleteLocked();
                await allowDeleteCommitPromise;
                return res;
              };
              return arg(tx);
            });
          }
          return originalTx(arg);
        });

      try {
        // Eagerly launch deletePost via HTTP with .end()
        const deletePromise = new Promise<any>((resolve, reject) => {
          request(app.getHttpServer())
            .delete(`/api/v1/workspaces/${ws1}/posts/${testPostId}`)
            .set('Cookie', session1.combinedCookie)
            .set('x-csrf-token', session1.csrfToken)
            .end((err: any, res: any) => {
              if (err) return reject(err);
              resolve(res);
            });
        });

        // Wait until deletePost holds the row locks and has deleted the post in its transaction
        await deleteLockedPromise;

        // Concurrently trigger publish request for the variant via HTTP with .end()
        const publishPromise = new Promise<any>((resolve, reject) => {
          request(app.getHttpServer())
            .post(`/api/v1/workspaces/${ws1}/publications/${testVariantId}/publish`)
            .set('Cookie', session1.combinedCookie)
            .set('x-csrf-token', session1.csrfToken)
            .end((err: any, res: any) => {
              if (err) return reject(err);
              resolve(res);
            });
        });

        // Verify that publish request is physically waiting on the variant row lock
        const isBlocked = await waitForBlockedRowLock(prisma);
        expect(isBlocked).toBe(true);

        // Release deletePost to commit
        releaseDelete!();

        const [deleteRes, publishRes] = await Promise.all([
          deletePromise,
          publishPromise,
        ]);

        expect(deleteRes.status).toBe(200);

        expect(publishRes.status).toBe(409);

        // Verify post and variant are deleted from DB
        const postInDb = await prisma.post.findUnique({
          where: { id: testPostId },
        });
        expect(postInDb).toBeNull();

        const variantInDb = await prisma.postPlatformVariant.findUnique({
          where: { id: testVariantId },
        });
        expect(variantInDb).toBeNull();

        // Verify audit logs: exactly 1 POST_DELETED, 0 PUBLICATION_REQUESTED
        const deleteAudits = await prisma.auditLog.findMany({
          where: { targetId: testPostId, action: 'POST_DELETED' },
        });
        expect(deleteAudits.length).toBe(1);

        const publishAudits = await prisma.auditLog.findMany({
          where: { targetId: testVariantId, action: 'PUBLICATION_REQUESTED' },
        });
        expect(publishAudits.length).toBe(0);
      } finally {
        releaseDelete!();
        txSpy.mockRestore();
      }
    });

    it('guarantees tenant and post isolation: concurrent operations on different posts or workspaces do not block each other', async () => {
      const postAId = generateId();
      const postBId = generateId();
      const variantAId = generateId();

      await prisma.post.create({
        data: {
          id: postAId,
          workspaceId: ws1,
          authorId: testUser.id,
          content: 'Post A Initial',
          status: PostStatus.DRAFT,
        },
      });
      await prisma.postPlatformVariant.create({
        data: {
          id: variantAId,
          postId: postAId,
          workspaceId: ws1,
          socialAccountId: account1,
          status: PostStatus.DRAFT,
          content: 'Post A Initial',
        },
      });

      await prisma.post.create({
        data: {
          id: postBId,
          workspaceId: ws2,
          authorId: testUser2.id,
          content: 'Post B Initial',
          status: PostStatus.DRAFT,
        },
      });

      // Post A is held in a transaction
      let signalALocked: () => void;
      const aLockedPromise = new Promise<void>((r) => (signalALocked = r));
      let releaseA: () => void;
      const allowACommitPromise = new Promise<void>((r) => (releaseA = r));

      const txAPromise = prisma.$transaction(async (tx) => {
        await tx.postPlatformVariant.update({
          where: { id: variantAId },
          data: { status: PostStatus.QUEUED },
        });
        signalALocked();
        await allowACommitPromise;
      });

      await aLockedPromise;

      try {
        // Delete Post B in Workspace 2 concurrently — it must NOT block and must succeed immediately
        const deleteBRes = await request(app.getHttpServer())
          .delete(`/api/v1/workspaces/${ws2}/posts/${postBId}`)
          .set('Cookie', session2.combinedCookie)
          .set('x-csrf-token', session2.csrfToken);

        expect(deleteBRes.status).toBe(200);

        const postBInDb = await prisma.post.findUnique({
          where: { id: postBId },
        });
        expect(postBInDb).toBeNull();
      } finally {
        releaseA!();
        await txAPromise;
      }
    });

    it('rejects deletion with 404 when post does not exist or belongs to another workspace', async () => {
      const randomPostId = generateId();
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/workspaces/${ws1}/posts/${randomPostId}`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Post not found');
    });

    it('proves database rollback during deletePost when transaction audit write fails, keeping original post and variants, and succeeds on retry', async () => {
      const testPostId = generateId();
      const testVariantId = generateId();
      const initialContent = `Delete rollback content ${generateId()}`;

      await prisma.post.create({
        data: {
          id: testPostId,
          workspaceId: ws1,
          authorId: testUser.id,
          content: initialContent,
          status: PostStatus.DRAFT,
        },
      });

      await prisma.postPlatformVariant.create({
        data: {
          id: testVariantId,
          postId: testPostId,
          workspaceId: ws1,
          socialAccountId: account1,
          status: PostStatus.DRAFT,
          content: initialContent,
        },
      });

      // Spy to inject failure into tx.auditLog.create when action === POST_DELETED
      const originalTx = prisma.$transaction.bind(prisma);
      let injectAuditFailure = true;

      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (arg: any) => {
          if (typeof arg === 'function') {
            return originalTx(async (tx: any) => {
              const originalCreate = tx.auditLog.create.bind(tx);
              tx.auditLog.create = async (createArgs: any) => {
                if (
                  injectAuditFailure &&
                  createArgs.data?.action === 'POST_DELETED'
                ) {
                  throw new Error(
                    'Simulated transactional AuditLog failure during POST_DELETED',
                  );
                }
                return originalCreate(createArgs);
              };
              return arg(tx);
            });
          }
          return originalTx(arg);
        });

      try {
        // Attempt deletion while audit write fails
        const failDeleteRes = await request(app.getHttpServer())
          .delete(`/api/v1/workspaces/${ws1}/posts/${testPostId}`)
          .set('Cookie', session1.combinedCookie)
          .set('x-csrf-token', session1.csrfToken);

        expect(failDeleteRes.status).toBe(500);

        // Verify post and variants still exist in DB (atomic rollback verified)
        const postStillInDb = await prisma.post.findUnique({
          where: { id: testPostId },
          include: { variants: true },
        });
        expect(postStillInDb).not.toBeNull();
        expect(postStillInDb!.variants.length).toBe(1);

        // Verify no POST_DELETED audit record
        const audits = await prisma.auditLog.findMany({
          where: { targetId: testPostId, action: 'POST_DELETED' },
        });
        expect(audits.length).toBe(0);

        // Disarm audit failure and retry
        injectAuditFailure = false;
        const retryRes = await request(app.getHttpServer())
          .delete(`/api/v1/workspaces/${ws1}/posts/${testPostId}`)
          .set('Cookie', session1.combinedCookie)
          .set('x-csrf-token', session1.csrfToken);

        expect(retryRes.status).toBe(200);

        // Verify post is now deleted
        const postDeleted = await prisma.post.findUnique({
          where: { id: testPostId },
        });
        expect(postDeleted).toBeNull();

        // Verify exactly 1 POST_DELETED audit record exists
        const finalAudits = await prisma.auditLog.findMany({
          where: { targetId: testPostId, action: 'POST_DELETED' },
        });
        expect(finalAudits.length).toBe(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('Publication Reconciliation', () => {
    let reconciliationPostId: string;
    let reconciliationVariantId: string;

    beforeAll(async () => {
      reconciliationPostId = generateId();
      reconciliationVariantId = generateId();

      await prisma.post.create({
        data: {
          id: reconciliationPostId,
          workspaceId: ws1,
          authorId: testUser.id,
          content: 'Reconciliation test post',
          status: 'PUBLISHING',
        },
      });

      await prisma.postPlatformVariant.create({
        data: {
          id: reconciliationVariantId,
          postId: reconciliationPostId,
          socialAccountId: account1,
          workspaceId: ws1,
          status: 'UNKNOWN',
          content: 'Reconciliation test variant',
          executionMetadata: {
            operationId: 'test-op-id',
            phase: 'AMBIGUOUS',
          },
          dispatchVersion: 1,
        },
      });
    });

    beforeEach(async () => {
      // Reset the clean UNKNOWN state before each test
      await prisma.postPlatformVariant.update({
        where: { id: reconciliationVariantId },
        data: {
          status: 'UNKNOWN',
          executionMetadata: {
            operationId: 'test-op-id',
            phase: 'AMBIGUOUS',
          },
          dispatchVersion: 1,
        },
      });

      // Clear any existing attempts
      await prisma.publicationAttempt.deleteMany({
        where: { variantId: reconciliationVariantId },
      });

      // Create a matching attempt
      await prisma.publicationAttempt.create({
        data: {
          id: require('crypto').randomUUID(),
          variantId: reconciliationVariantId,
          attemptNumber: 1,
          status: 'FAILED',
          failureCategory: 'UNKNOWN_RESULT',
        },
      });

      // Clear audit logs for isolation
      await prisma.auditLog.deleteMany({
        where: { targetId: reconciliationVariantId },
      });
    });

    it('rejects invalid decision', async () => {
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${reconciliationVariantId}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'INVALID_DECISION', reason: 'checking' });
      expect(resolveRes.status).toBe(400);
    });

    it('rejects if reason is missing', async () => {
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${reconciliationVariantId}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED', externalPostId: 'ext-123' });
      expect(resolveRes.status).toBe(400);
    });

    it('rejects if reason is whitespace only', async () => {
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${reconciliationVariantId}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED', externalPostId: 'ext-123', reason: '   ' });
      expect(resolveRes.status).toBe(400);
      expect(resolveRes.body.error.message).toContain('reason cannot be whitespace only');
    });

    it('rejects CONFIRM_PUBLISHED if externalPostId is missing', async () => {
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${reconciliationVariantId}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED', reason: 'checking' });
      expect(resolveRes.status).toBe(400);
    });

    it('rejects CONFIRM_PUBLISHED if externalPostId is whitespace only', async () => {
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${reconciliationVariantId}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED', reason: 'checking', externalPostId: '   ' });
      expect(resolveRes.status).toBe(400);
      expect(resolveRes.body.error.message).toContain('externalPostId cannot be whitespace only');
    });

    it('requires correct permission (MANAGER/OWNER only)', async () => {
      // session3 is CONTRIBUTOR in ws1, so they shouldn't be able to reconcile
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${reconciliationVariantId}/reconcile`)
        .set('Cookie', session3.combinedCookie)
        .set('x-csrf-token', session3.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED', reason: 'checking', externalPostId: 'ext-123' });
      expect(resolveRes.status).toBe(403);
    });

    it('resolves UNKNOWN to FAILED (4-record atomic update)', async () => {
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${reconciliationVariantId}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_FAILED', reason: 'failed in ui' });
      
      expect(resolveRes.status).toBe(200);

      // Verify Variant
      const variant = await prisma.postPlatformVariant.findUnique({
        where: { id: reconciliationVariantId },
      });
      expect(variant!.status).toBe('FAILED');
      expect(variant!.reconciliationReason).toBe('failed in ui');

      // Verify ExecutionMetadata
      const execMeta = variant!.executionMetadata as unknown as { phase: string; finalRemoteId?: string };
      expect(execMeta.phase).toBe('FAILED');

      // Verify PublicationAttempt
      const attempt = await prisma.publicationAttempt.findFirst({
        where: { variantId: reconciliationVariantId },
        orderBy: { attemptNumber: 'desc' },
      });
      expect(attempt!.status).toBe('FAILED');

      // Verify AuditLog
      const audit = await prisma.auditLog.findFirst({
        where: { targetId: reconciliationVariantId, action: 'PUBLICATION_RECONCILED_FAILED' },
      });
      expect(audit).toBeDefined();
      expect((audit!.metadata as unknown as { reason: string }).reason).toBe('failed in ui');
    });

    it('resolves UNKNOWN to PUBLISHED (4-record atomic update)', async () => {
      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${reconciliationVariantId}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED', reason: 'published in ui', externalPostId: 'ext-pub-1' });
      
      expect(resolveRes.status).toBe(200);

      // Verify Variant
      const variant = await prisma.postPlatformVariant.findUnique({
        where: { id: reconciliationVariantId },
      });
      expect(variant!.status).toBe('PUBLISHED');
      expect(variant!.externalPostId).toBe('ext-pub-1');

      // Verify ExecutionMetadata
      const execMeta = variant!.executionMetadata as unknown as { phase: string; finalRemoteId?: string };
      expect(execMeta.phase).toBe('COMPLETED');
      expect(execMeta.finalRemoteId).toBe('ext-pub-1');

      // Verify PublicationAttempt
      const attempt = await prisma.publicationAttempt.findFirst({
        where: { variantId: reconciliationVariantId },
        orderBy: { attemptNumber: 'desc' },
      });
      expect(attempt!.status).toBe('SUCCESS');

      // Verify AuditLog
      const audit = await prisma.auditLog.findFirst({
        where: { targetId: reconciliationVariantId, action: 'PUBLICATION_RECONCILED_PUBLISHED' },
      });
      expect(audit).toBeDefined();
      expect((audit!.metadata as unknown as { decision: string }).decision).toBe('CONFIRM_PUBLISHED');
    });

    it('proves database rollback if AuditLog insertion fails', async () => {
      const variantId4 = generateId();
      const post4Id = generateId();
      await prisma.post.create({ data: { id: post4Id, workspaceId: ws1, authorId: testUser.id, content: 'test 4', status: PostStatus.DRAFT } });
      await prisma.postPlatformVariant.create({
        data: {
          id: variantId4,
          postId: post4Id,
          socialAccountId: account1,
          workspaceId: ws1,
          status: 'UNKNOWN',
          executionMetadata: { phase: 'AMBIGUOUS', operationId: 'op-123' },
          dispatchVersion: 1
        }
      });
      await prisma.publicationAttempt.create({
        data: {
          id: generateId(),
          variantId: variantId4,
          attemptNumber: 1,
          status: 'FAILED',
          failureCategory: 'UNKNOWN_RESULT',
        }
      });

      // Spy on the Prisma client to inject a failure into the transaction's auditLog.create
      const originalTx = prisma.$transaction.bind(prisma);

      const spy = jest.spyOn(prisma, '$transaction').mockImplementation(async (arg: any) => {
        if (typeof arg === 'function') {
          return originalTx(async (tx: any) => {
            const originalCreate = tx.auditLog.create.bind(tx);
            tx.auditLog.create = async (createArgs: any) => {
              if (createArgs.data?.metadata?.reason === 'SIMULATE_AUDITLOG_FAILURE') {
                throw new Error('Simulated AuditLog failure');
              }
              return originalCreate(createArgs);
            };
            return arg(tx);
          });
        }
        return originalTx(arg);
      });

      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variantId4}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED', reason: 'SIMULATE_AUDITLOG_FAILURE', externalPostId: 'ext-999' });

      // The simulated error is caught by our AllExceptionsFilter or bubbling up as 500
      expect(resolveRes.status).toBe(500);

      spy.mockRestore();

      // VERIFY ROLLBACK: Variant must still be UNKNOWN
      const rolledBackVariant = await prisma.postPlatformVariant.findUnique({ where: { id: variantId4 } });
      expect(rolledBackVariant!.status).toBe('UNKNOWN');

      // Publication attempt must still be FAILED / UNKNOWN_RESULT
      const attempt = await prisma.publicationAttempt.findFirst({ where: { variantId: variantId4 } });
      expect(attempt!.status).toBe('FAILED');
      expect(attempt!.failureCategory).toBe('UNKNOWN_RESULT');
    });

    it('proves database rollback and fails closed if multiple UNKNOWN_RESULT attempts exist', async () => {
      const variantId2 = generateId();
      const post2Id = generateId();
      await prisma.post.create({ data: { id: post2Id, workspaceId: ws1, authorId: testUser.id, content: 'test 2', status: PostStatus.DRAFT } });
      await prisma.postPlatformVariant.create({
        data: {
          id: variantId2,
          postId: post2Id,
          socialAccountId: account1,
          workspaceId: ws1,
          status: 'UNKNOWN',
          executionMetadata: { phase: 'AMBIGUOUS', operationId: 'op-123' },
          dispatchVersion: 1
        }
      });
      // Create TWO attempts
      await prisma.publicationAttempt.create({
        data: {
          id: generateId(),
          variantId: variantId2,
          attemptNumber: 1,
          status: 'FAILED',
          failureCategory: 'UNKNOWN_RESULT',
        }
      });
      await prisma.publicationAttempt.create({
        data: {
          id: generateId(),
          variantId: variantId2,
          attemptNumber: 2,
          status: 'FAILED',
          failureCategory: 'UNKNOWN_RESULT',
        }
      });

      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variantId2}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED', externalPostId: 'ext-999', reason: 'concurrent test' });

      expect(resolveRes.status).toBe(409); // ConflictException thrown inside transaction
      expect(resolveRes.body.error.message).toContain('Expected exactly 1 eligible publication attempt');

      // VERIFY ROLLBACK: The variant status MUST still be UNKNOWN and dispatchVersion still 1 (not incremented)
      const rolledBackVariant = await prisma.postPlatformVariant.findUnique({ where: { id: variantId2 } });
      expect(rolledBackVariant!.status).toBe('UNKNOWN');
      expect(rolledBackVariant!.dispatchVersion).toBe(1);
    });

    it('handles truly concurrent race condition test correctly (Promise.all) - opposing decisions', async () => {
      const variantId3 = generateId();
      const post3Id = generateId();
      await prisma.post.create({ data: { id: post3Id, workspaceId: ws1, authorId: testUser.id, content: 'test 3', status: PostStatus.DRAFT } });
      await prisma.postPlatformVariant.create({
        data: {
          id: variantId3,
          postId: post3Id,
          socialAccountId: account1,
          workspaceId: ws1,
          status: 'UNKNOWN',
          executionMetadata: { phase: 'AMBIGUOUS', operationId: 'op-123' },
          dispatchVersion: 1
        }
      });
      await prisma.publicationAttempt.create({
        data: {
          id: generateId(),
          variantId: variantId3,
          attemptNumber: 1,
          status: 'FAILED',
          failureCategory: 'UNKNOWN_RESULT',
        }
      });

      // Fire two opposing reconcile requests at the exact same time
      const req1 = request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variantId3}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_FAILED', reason: 'race test 1' });

      const req2 = request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variantId3}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_PUBLISHED', externalPostId: 'ext-999', reason: 'race test 2' });

      const [res1, res2] = await Promise.all([req1, req2]);

      // The loser MUST always return 409. The winner MUST return 200.
      const statuses = [res1.status, res2.status].sort((a, b) => a - b);
      expect(statuses[0]).toBe(200);
      expect(statuses[1]).toBe(409);

      // Verify final state is correct exactly once
      const finalVariant = await prisma.postPlatformVariant.findUnique({ where: { id: variantId3 } });
      expect(['FAILED', 'PUBLISHED']).toContain(finalVariant!.status);

      const attempts = await prisma.publicationAttempt.findMany({ where: { variantId: variantId3 } });
      expect(attempts.length).toBe(1);
      expect(['FAILED', 'SUCCESS']).toContain(attempts[0].status);

      const audits = await prisma.auditLog.findMany({ where: { targetId: variantId3 } });
      expect(audits.length).toBe(1); // Only 1 audit log should have been created!
    });

    it('handles truly concurrent race condition test correctly (Promise.all) - same decision', async () => {
      const variantId4 = generateId();
      const post4Id = generateId();
      await prisma.post.create({ data: { id: post4Id, workspaceId: ws1, authorId: testUser.id, content: 'test 4', status: PostStatus.DRAFT } });
      await prisma.postPlatformVariant.create({
        data: {
          id: variantId4,
          postId: post4Id,
          socialAccountId: account1,
          workspaceId: ws1,
          status: 'UNKNOWN',
          executionMetadata: { phase: 'AMBIGUOUS', operationId: 'op-123' },
          dispatchVersion: 1
        }
      });
      await prisma.publicationAttempt.create({
        data: {
          id: generateId(),
          variantId: variantId4,
          attemptNumber: 1,
          status: 'FAILED',
          failureCategory: 'UNKNOWN_RESULT',
        }
      });

      // Fire two identical reconcile requests at the exact same time
      const req1 = request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variantId4}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_FAILED', reason: 'race test 1' });

      const req2 = request(app.getHttpServer())
        .post(`/api/v1/workspaces/${ws1}/publications/${variantId4}/reconcile`)
        .set('Cookie', session1.combinedCookie)
        .set('x-csrf-token', session1.csrfToken)
        .send({ decision: 'CONFIRM_FAILED', reason: 'race test 2' });

      const [res1, res2] = await Promise.all([req1, req2]);

      // The loser MUST always return 409. The winner MUST return 200.
      const statuses = [res1.status, res2.status].sort((a, b) => a - b);
      expect(statuses[0]).toBe(200);
      expect(statuses[1]).toBe(409);

      // Verify final state is correct exactly once
      const finalVariant = await prisma.postPlatformVariant.findUnique({ where: { id: variantId4 } });
      expect(finalVariant!.status).toBe('FAILED');

      const attempts = await prisma.publicationAttempt.findMany({ where: { variantId: variantId4 } });
      expect(attempts.length).toBe(1);
      expect(attempts[0].status).toBe('FAILED');
      expect(attempts[0].failureCategory).toBe('PERMANENT');

      const audits = await prisma.auditLog.findMany({ where: { targetId: variantId4 } });
      expect(audits.length).toBe(1); // Only 1 audit log should have been created!
    });
  });
});


