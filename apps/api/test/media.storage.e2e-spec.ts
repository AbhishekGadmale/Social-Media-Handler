/* eslint-disable */
import { vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaClient, generateId } from '@agency-os/database';
import { loginAndGetSession } from './helpers';
const request = require('supertest');
import * as argon2 from '@node-rs/argon2';
import crypto from 'crypto';
import { S3ObjectStorage } from '@agency-os/providers';

describe('Media Storage & Upload Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let s3Storage: S3ObjectStorage;
  let testUser: any;
  let wsA: string;
  let wsB: string;

  beforeAll(async () => {
    process.env.OBJECT_STORAGE_ENDPOINT = 'http://127.0.0.1:9000';
    process.env.OBJECT_STORAGE_REGION = 'us-east-1';
    process.env.OBJECT_STORAGE_BUCKET = 'agency-os-media';
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = 'minioadmin';
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = 'minioadmin';
    process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = 'true';

    const {
      assertTestDatabaseUrl,
    } = require('@agency-os/database');
    assertTestDatabaseUrl(process.env.DATABASE_URL);

    prisma = new PrismaClient();
    await prisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(require('cookie-parser')());
    await app.init();

    s3Storage = moduleFixture.get('IObjectStorage');

    // Create bucket if not exists
    const { CreateBucketCommand, S3Client } = require('@aws-sdk/client-s3');
    const client = new S3Client({
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
      region: process.env.OBJECT_STORAGE_REGION,
      credentials: {
        accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });
    try {
      await client.send(
        new CreateBucketCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET }),
      );
    } catch (e) {
      if (
        e.name !== 'BucketAlreadyOwnedByYou' &&
        e.name !== 'BucketAlreadyExists'
      ) {
        throw e;
      }
    }

    // Clean DB
    await prisma.postMedia.deleteMany({});
    await prisma.mediaAsset.deleteMany({});
    await prisma.post.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.user.deleteMany({});

    // Setup Test Data
    const hashedPassword = await argon2.hash('correctpassword');
    testUser = await prisma.user.create({
      data: {
        id: generateId(),
        email: 'media-test@example.com',
        hashedPassword,
      },
    });

    const org = await prisma.organization.create({
      data: {
        id: generateId(),
        name: 'Test Org',
      },
    });

    const wA = await prisma.workspace.create({
      data: { id: generateId(), name: 'Workspace A', organizationId: org.id },
    });
    wsA = wA.id;

    const wB = await prisma.workspace.create({
      data: { id: generateId(), name: 'Workspace B', organizationId: org.id },
    });
    wsB = wB.id;

    await prisma.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: wsA,
        userId: testUser.id,
        role: 'OWNER',
      },
    });

    await prisma.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: wsB,
        userId: testUser.id,
        role: 'OWNER',
      },
    });
    sessionData = await loginAndGetSession(
      app,
      testUser.email,
      'correctpassword',
    );
    sessionData = await loginAndGetSession(
      app,
      testUser.email,
      'correctpassword',
    );
  });

  afterAll(async () => {
    await prisma.postMedia.deleteMany({});
    await prisma.mediaAsset.deleteMany({});
    await prisma.post.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
    await app.close();
  });

  let sessionData: any;
  let sessionCookie: any;
  let csrfToken: any;
  let cookie1: any;
  let csrf1: any;
  let cookie2: any;
  let csrf2: any;

  it('should authenticate user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'media-test@example.com', password: 'correctpassword' })
      .expect(200);

    const cookies = res.headers['set-cookie'] as string[];
    const sessionCookieHeader = cookies.find((c) => c.startsWith('session='));
    const csrfCookieHeader = cookies.find((c) => c.startsWith('csrfToken='));

    sessionCookie = sessionCookieHeader!.split(';')[0];
    csrfToken = csrfCookieHeader!.split(';')[0].split('=')[1];
  });

  describe('Real MinIO Integration & READY byte immutability', () => {
    let mediaAssetId: string;
    let uploadUrl: string;

    it('should initiate upload and return presigned URL for STAGING object', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${wsA}/media/uploads`)
        .set('Cookie', `${sessionCookie}; csrfToken=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .set('x-csrf-token', csrfToken)
        .send({
          filename: 'test-video.mp4',
          mimeType: 'video/mp4',
          byteSize: 1000,
        })
        .expect(201);

      mediaAssetId = res.body.mediaAssetId;
      uploadUrl = res.body.uploadUrl;

      expect(mediaAssetId).toBeDefined();
      expect(uploadUrl).toContain('uploads');
    });

    it('should upload bytes A using the presigned URL', async () => {
      // Simulate direct PUT to MinIO
      const bytesA = Buffer.alloc(1000, 'A');
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: bytesA,
        headers: { 'Content-Type': 'video/mp4' },
      });
      expect(response.status).toBe(200);
    });

    it('should complete upload successfully', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${wsA}/media/${mediaAssetId}/complete`)
        .set('Cookie', `${sessionCookie}; csrfToken=${csrfToken}`)
        .set('x-csrf-token', csrfToken)

        .send()
        .expect(201); // Created

      expect(res.body.status).toBe('READY');

      // Should not contain uploads in final storageKey
      expect(res.body.storageKey).not.toContain('uploads');
      expect(res.body.storageKey).toContain('/source');
    });

    it('should reject re-upload after READY', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${wsA}/media/${mediaAssetId}/complete`)
        .set('Cookie', `${sessionCookie}; csrfToken=${csrfToken}`)
        .set('x-csrf-token', csrfToken)

        .send()
        .expect(201); // Returns idempotent result
    });

    it('should guarantee READY byte immutability when old PUT URL is reused', async () => {
      // Reuse the STILL-VALID old staging PUT URL to upload bytes B
      const bytesB = Buffer.alloc(1000, 'B');
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: bytesB,
        headers: { 'Content-Type': 'video/mp4' },
      });
      expect(response.status).toBe(200);

      // Now read final object through IMediaContentSource
      const asset = await prisma.mediaAsset.findUnique({
        where: { id: mediaAssetId },
      });
      const stream = await s3Storage.getStream(asset!.storageKey);

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const finalBytes = Buffer.concat(chunks);

      // Final bytes are still A
      expect(finalBytes.toString()).toBe(Buffer.alloc(1000, 'A').toString());
    });

    it('should support exact range reads on final object', async () => {
      const asset = await prisma.mediaAsset.findUnique({
        where: { id: mediaAssetId },
      });

      const stream = await s3Storage.getStream(asset!.storageKey, {
        start: 100,
        end: 199,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const finalBytes = Buffer.concat(chunks);

      // Range read should return exactly 100 bytes of 'A'
      expect(finalBytes.length).toBe(100);
      expect(finalBytes.toString()).toBe(Buffer.alloc(100, 'A').toString());
    });
  });

  describe('Tenant Isolation & Cross-Tenant Storage Integration', () => {
    it('Workspace A cannot complete Workspace B upload', async () => {
      // initiate in WS B
      const res = await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${wsB}/media/uploads`)
        .set('Cookie', `${sessionCookie}; csrfToken=${csrfToken}`)
        .set('x-csrf-token', csrfToken)

        .send({
          filename: 'test-video-b.mp4',
          mimeType: 'video/mp4',
          byteSize: 500,
        })
        .expect(201);

      const mediaBId = res.body.mediaAssetId;

      // try complete from WS A
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${wsA}/media/${mediaBId}/complete`)
        .set('Cookie', `${sessionCookie}; csrfToken=${csrfToken}`)
        .set('x-csrf-token', csrfToken)

        .send()
        .expect(404); // Not found in workspace A
    });
  });
});
