import { Test, TestingModule } from '@nestjs/testing';
import { SyncProcessor } from './sync.processor';
import { SyncService } from './sync.service';
import {
  PrismaClient,
  SocialAccountStatus,
  SyncRunStatus,
} from '@agency-os/database';
import {
  providerRegistry,
  ProviderCapabilityError,
  ProviderRateLimitError,
  ProviderApiError,
} from '@agency-os/providers';
import * as invokeMod from '@agency-os/providers';
import { Job, UnrecoverableError } from 'bullmq';
import { encrypt } from '@agency-os/database/src/crypto/encryption';

jest.mock('@agency-os/providers', () => {
  const original = jest.requireActual('@agency-os/providers');
  return {
    ...original,
    invokeCapability: jest.fn(),
  };
});

describe('SyncProcessor', () => {
  let processor: SyncProcessor;
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = new PrismaClient();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncProcessor,
        {
          provide: PrismaClient,
          useValue: prisma,
        },
        {
          provide: SyncService,
          useValue: { enqueueSyncAll: jest.fn() },
        },
      ],
    }).compile();

    processor = module.get<SyncProcessor>(SyncProcessor);

    if (
      !process.env.DATABASE_URL ||
      !process.env.DATABASE_URL.includes('test')
    ) {
      throw new Error(
        'SAFETY CHECK FAILED: Tests that clear the database must run against a test database. DATABASE_URL does not contain "test".',
      );
    }

    await prisma.accountMetricDaily.deleteMany({});
    await prisma.syncRun.deleteMany({});
    await prisma.socialConnection.deleteMany({});
    await prisma.socialAccount.deleteMany({});
    await prisma.postPlatformVariant.deleteMany({});
    await prisma.post.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.organization.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const createMockData = async (
    provider: any,
    status = SocialAccountStatus.ACTIVE,
    expiresAt?: Date,
  ) => {
    const org = await prisma.organization.create({
      data: {
        id: crypto.randomUUID(),
        name: 'Test Org',
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        id: crypto.randomUUID(),
        name: 'Test Workspace',
        organizationId: org.id,
      },
    });

    const account = await prisma.socialAccount.create({
      data: {
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        provider,
        externalId: crypto.randomUUID(),
        name: 'Test Account',
        status,
      },
    });

    const token = encrypt('mock-token');

    await prisma.socialConnection.create({
      data: {
        id: crypto.randomUUID(),
        socialAccountId: account.id,
        encryptedAccessToken: token.encrypted,
        accessTokenIv: token.iv,
        accessTokenAuthTag: token.authTag,
        keyVersion: token.keyVersion,
        expiresAt,
      },
    });

    return { workspace, account };
  };

  it('Full sync job: mocked provider returns metrics, confirm AccountMetricDaily row created', async () => {
    const { workspace, account } = await createMockData('YOUTUBE');
    const job = {
      data: { socialAccountId: account.id, workspaceId: workspace.id },
    } as Job<any>;

    (invokeMod.invokeCapability as jest.Mock).mockResolvedValueOnce({
      followersCount: 100,
      engagement: 50,
    });

    await processor.process(job);

    const metrics = await prisma.accountMetricDaily.findFirst({
      where: { socialAccountId: account.id },
    });
    expect(metrics).toBeDefined();
    expect(metrics!.followers).toBe(100);
    expect(metrics!.engagement).toBe(50);

    const syncRun = await prisma.syncRun.findFirst({});
    expect(syncRun!.status).toBe(SyncRunStatus.COMPLETED);
    expect((syncRun!.counts as any).followers).toBe(100);
  });

  it('Running the same sync twice for the same day upserts the same row (no duplicate)', async () => {
    const { workspace, account } = await createMockData('YOUTUBE');
    const job = {
      data: { socialAccountId: account.id, workspaceId: workspace.id },
    } as Job<any>;

    (invokeMod.invokeCapability as jest.Mock).mockResolvedValueOnce({
      followersCount: 100,
      engagement: 50,
    });
    await processor.process(job);

    (invokeMod.invokeCapability as jest.Mock).mockResolvedValueOnce({
      followersCount: 200,
      engagement: 150,
    });
    await processor.process(job);

    const metricsCount = await prisma.accountMetricDaily.count();
    expect(metricsCount).toBe(1);

    const metrics = await prisma.accountMetricDaily.findFirst();
    expect(metrics!.followers).toBe(200);
    expect(metrics!.engagement).toBe(150);
  });

  it('Sync job for a LinkedIn account (no getAccountMetrics) is skipped gracefully', async () => {
    const { workspace, account } = await createMockData('LINKEDIN');
    const job = {
      data: { socialAccountId: account.id, workspaceId: workspace.id },
    } as Job<any>;

    (invokeMod.invokeCapability as jest.Mock).mockRejectedValueOnce(
      new ProviderCapabilityError('getAccountMetrics'),
    );

    await processor.process(job);

    const syncRun = await prisma.syncRun.findFirst();
    expect(syncRun!.status).toBe(SyncRunStatus.SKIPPED);
    expect((syncRun!.counts as any).skipped).toBe(true);
    expect((syncRun!.counts as any).reason).toBe('capability_unsupported');

    const metricsCount = await prisma.accountMetricDaily.count();
    expect(metricsCount).toBe(0);
  });

  it('Expired token with no refresh capability -> REAUTH_REQUIRED, sync skipped', async () => {
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 1);
    const { workspace, account } = await createMockData(
      'YOUTUBE',
      SocialAccountStatus.ACTIVE,
      pastDate,
    );
    const job = {
      data: { socialAccountId: account.id, workspaceId: workspace.id },
    } as Job<any>;

    await processor.process(job);

    const updatedAccount = await prisma.socialAccount.findUnique({
      where: { id: account.id },
    });
    expect(updatedAccount!.status).toBe(SocialAccountStatus.REAUTH_REQUIRED);

    const syncRun = await prisma.syncRun.findFirst();
    expect(syncRun!.status).toBe(SyncRunStatus.SKIPPED);
    expect((syncRun!.counts as any).reason).toBe('expired_token');
  });

  it('ProviderRateLimitError triggers a retry (moveToDelayed)', async () => {
    const { workspace, account } = await createMockData('YOUTUBE');
    const moveToDelayed = jest.fn();
    const job = {
      data: { socialAccountId: account.id, workspaceId: workspace.id },
      moveToDelayed,
      token: 'job-token',
    } as unknown as Job<any>;

    (invokeMod.invokeCapability as jest.Mock).mockRejectedValueOnce(
      new ProviderRateLimitError('Rate limited', 60),
    );

    await expect(processor.process(job)).rejects.toThrow(UnrecoverableError);

    expect(moveToDelayed).toHaveBeenCalled();
    const delayArg = moveToDelayed.mock.calls[0][0];
    expect(delayArg).toBeGreaterThan(Date.now());

    const syncRun = await prisma.syncRun.findFirst();
    expect(syncRun!.status).toBe(SyncRunStatus.FAILED);
    expect(syncRun!.error).toContain('Rate limited');
  });

  it('ProviderApiError with 401 marks account as REAUTH_REQUIRED and skips retry', async () => {
    const { workspace, account } = await createMockData('YOUTUBE');
    const job = {
      data: { socialAccountId: account.id, workspaceId: workspace.id },
      id: 'job-123',
    } as unknown as Job<any>;

    (invokeMod.invokeCapability as jest.Mock).mockRejectedValueOnce(
      new ProviderApiError('Unauthorized', 401),
    );

    // The processor returns without throwing an error for 401, so it shouldn't reject
    await processor.process(job);

    const updatedAccount = await prisma.socialAccount.findUnique({
      where: { id: account.id },
    });
    expect(updatedAccount!.status).toBe(SocialAccountStatus.REAUTH_REQUIRED);

    const syncRun = await prisma.syncRun.findFirst();
    expect(syncRun!.status).toBe(SyncRunStatus.FAILED);
    expect((syncRun!.counts as any).reason).toBe('unauthorized_401');
  });
});
