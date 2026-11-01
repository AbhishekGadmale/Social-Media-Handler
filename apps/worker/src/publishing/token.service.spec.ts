/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import {
  PrismaClient,
  SocialAccountRepository,
  SocialAccountStatus,
  SocialProvider,
  assertTestDatabaseUrl,
} from '@agency-os/database';
import { encrypt, decrypt } from '@agency-os/database/src/crypto/encryption';
import { ProviderRegistry, providerRegistry } from '@agency-os/providers';
import { TokenService, AuthRequiredError } from './token.service';

class MockRedis {
  public store = new Map<string, { value: string; expiresAt: number }>();

  async set(
    key: string,
    value: string,
    mode?: string,
    ttl?: number,
    flag?: string,
  ): Promise<string | null> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && existing.expiresAt <= now) {
      this.store.delete(key);
    }
    if (flag === 'NX' && this.store.has(key)) {
      return null;
    }
    const expiresAt = mode === 'PX' && ttl ? now + ttl : Infinity;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (!existing) return null;
    if (existing.expiresAt <= now) {
      this.store.delete(key);
      return null;
    }
    return existing.value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    arg: string,
  ): Promise<number> {
    const current = await this.get(key);
    if (current === arg) {
      await this.del(key);
      return 1;
    }
    return 0;
  }
}

describe('TokenService', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn(),
  } as any;
  let prisma: PrismaClient;

  beforeAll(() => {
    process.env.LINKEDIN_CLIENT_ID =
      process.env.LINKEDIN_CLIENT_ID || 'test-linkedin-client-id';
    process.env.LINKEDIN_CLIENT_SECRET =
      process.env.LINKEDIN_CLIENT_SECRET || 'test-linkedin-client-secret';
    assertTestDatabaseUrl(process.env.DATABASE_URL);
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.accountMetricDaily.deleteMany({});
    await prisma.syncRun.deleteMany({});
    await prisma.socialConnection.deleteMany({});
    await prisma.postPlatformVariant.deleteMany({});
    await prisma.post.deleteMany({});
    await prisma.socialAccount.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.organization.deleteMany({});
  });

  async function createAccountWithConnection(options: {
    provider: SocialProvider;
    status?: SocialAccountStatus;
    accessToken: string;
    expiresAt?: Date | null;
    refreshToken?: string | null;
  }) {
    const ws = await prisma.workspace.create({
      data: {
        id: crypto.randomUUID(),
        name: 'Test Workspace',
        organization: {
          create: {
            id: crypto.randomUUID(),
            name: 'Test Org',
          },
        },
      },
    });

    const account = await prisma.socialAccount.create({
      data: {
        id: crypto.randomUUID(),
        workspaceId: ws.id,
        provider: options.provider,
        externalId: crypto.randomUUID(),
        name: 'Test Account',
        status: options.status ?? SocialAccountStatus.ACTIVE,
      },
    });

    const encAccess = encrypt(options.accessToken);
    const encRefresh = options.refreshToken
      ? encrypt(options.refreshToken)
      : null;

    const connection = await prisma.socialConnection.create({
      data: {
        id: crypto.randomUUID(),
        socialAccountId: account.id,
        encryptedAccessToken: encAccess.encrypted,
        accessTokenIv: encAccess.iv,
        accessTokenAuthTag: encAccess.authTag,
        keyVersion: encAccess.keyVersion,
        encryptedRefreshToken: encRefresh ? encRefresh.encrypted : null,
        refreshTokenIv: encRefresh ? encRefresh.iv : null,
        refreshTokenAuthTag: encRefresh ? encRefresh.authTag : null,
        expiresAt: options.expiresAt,
      },
    });

    return { workspace: ws, account, connection };
  }

  describe('Freshness & In-Memory Token Retrieval', () => {
    it('returns decrypted token without refresh when token has >5m validity remaining', async () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour ahead
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'fresh-access-token',
        refreshToken: 'valid-refresh-token',
        expiresAt,
      });

      const ytProvider = providerRegistry.get('youtube');
      const refreshSpy = jest.spyOn(ytProvider as any, 'refreshCredentials');

      const tokenService = new TokenService(prisma, mockLogger);
      const creds = await tokenService.getExecutionCredentials(account.id);

      expect(creds.accessToken).toBe('fresh-access-token');
      expect(refreshSpy).not.toHaveBeenCalled();

      refreshSpy.mockRestore();
    });

    it('returns decrypted token without refresh when token is perpetual (expiresAt is null)', async () => {
      const { account } = await createAccountWithConnection({
        provider: 'INSTAGRAM',
        accessToken: 'perpetual-page-token',
        expiresAt: null,
      });

      const tokenService = new TokenService(prisma, mockLogger);
      const creds = await tokenService.getExecutionCredentials(account.id);

      expect(creds.accessToken).toBe('perpetual-page-token');
    });
  });

  describe('Preemptive Token Refresh (< 5 minutes validity or expired)', () => {
    it('refreshes expiring token (<5m remaining) and updates DB with new ciphertext', async () => {
      const expiringSoon = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes ahead (<5m threshold)
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expiring-access-token',
        refreshToken: 'original-refresh-token',
        expiresAt: expiringSoon,
      });

      const ytProvider = providerRegistry.get('youtube');
      const newExpiry = new Date(Date.now() + 3600 * 1000);
      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockResolvedValueOnce({
          accessToken: 'refreshed-access-token-123',
          refreshToken: 'original-refresh-token',
          expiresAt: newExpiry,
          tokenType: 'Bearer',
        });

      const tokenService = new TokenService(prisma, mockLogger);
      const creds = await tokenService.getExecutionCredentials(account.id);

      expect(refreshSpy).toHaveBeenCalledWith('original-refresh-token');
      expect(creds.accessToken).toBe('refreshed-access-token-123');

      // Verify connection in DB was updated with new encrypted token and new expiry
      const updatedConn = await prisma.socialConnection.findUniqueOrThrow({
        where: { socialAccountId: account.id },
      });
      const decrypted = decrypt({
        encrypted: updatedConn.encryptedAccessToken,
        iv: updatedConn.accessTokenIv,
        authTag: updatedConn.accessTokenAuthTag,
        keyVersion: updatedConn.keyVersion,
      });
      expect(decrypted).toBe('refreshed-access-token-123');
      expect(updatedConn.expiresAt?.getTime()).toBe(newExpiry.getTime());

      refreshSpy.mockRestore();
    });

    it('preserves existing refresh token when provider does not return a new one', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token',
        refreshToken: 'preserve-me-refresh-token',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockResolvedValueOnce({
          accessToken: 'new-token-no-refresh',
          expiresAt: new Date(Date.now() + 3600 * 1000),
          tokenType: 'Bearer',
        });

      const tokenService = new TokenService(prisma, mockLogger);
      await tokenService.getExecutionCredentials(account.id);

      const updatedConn = await prisma.socialConnection.findUniqueOrThrow({
        where: { socialAccountId: account.id },
      });
      const decryptedRefresh = decrypt({
        encrypted: updatedConn.encryptedRefreshToken!,
        iv: updatedConn.refreshTokenIv!,
        authTag: updatedConn.refreshTokenAuthTag!,
        keyVersion: updatedConn.keyVersion,
      });
      expect(decryptedRefresh).toBe('preserve-me-refresh-token');

      refreshSpy.mockRestore();
    });

    it('persists rotated refresh token when provider returns a new refresh token', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'LINKEDIN',
        accessToken: 'expired-token',
        refreshToken: 'old-refresh-token',
        expiresAt: expiredDate,
      });

      const liProvider = providerRegistry.get('linkedin');
      const refreshSpy = jest
        .spyOn(liProvider as any, 'refreshCredentials')
        .mockResolvedValueOnce({
          accessToken: 'new-linkedin-access-token',
          refreshToken: 'brand-new-rotated-refresh-token',
          expiresAt: new Date(Date.now() + 3600 * 1000),
          tokenType: 'Bearer',
        });

      const tokenService = new TokenService(prisma, mockLogger);
      await tokenService.getExecutionCredentials(account.id);

      const updatedConn = await prisma.socialConnection.findUniqueOrThrow({
        where: { socialAccountId: account.id },
      });
      const decryptedRefresh = decrypt({
        encrypted: updatedConn.encryptedRefreshToken!,
        iv: updatedConn.refreshTokenIv!,
        authTag: updatedConn.refreshTokenAuthTag!,
        keyVersion: updatedConn.keyVersion,
      });
      expect(decryptedRefresh).toBe('brand-new-rotated-refresh-token');

      refreshSpy.mockRestore();
    });

    it('returns valid token and keeps account ACTIVE when token expires in <5m on non-refreshable account (e.g. Meta)', async () => {
      const expiringInTwoMinutes = new Date(Date.now() + 2 * 60 * 1000); // 2 min validity (<5m threshold)
      const { account } = await createAccountWithConnection({
        provider: 'INSTAGRAM',
        accessToken: 'still-valid-meta-token',
        refreshToken: null,
        expiresAt: expiringInTwoMinutes,
      });

      const tokenService = new TokenService(prisma, mockLogger);
      const creds = await tokenService.getExecutionCredentials(account.id);

      expect(creds.accessToken).toBe('still-valid-meta-token');

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.ACTIVE);
    });
  });

  describe('Error Classification & Failure Modes', () => {
    it('marks account REAUTH_REQUIRED and throws AuthRequiredError on 400 invalid_grant', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token',
        refreshToken: 'revoked-refresh-token',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error(
        'invalid_grant: Token has been expired or revoked',
      );
      error.statusCode = 400;
      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockRejectedValueOnce(error);

      const tokenService = new TokenService(prisma, mockLogger);

      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow(AuthRequiredError);

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.REAUTH_REQUIRED);

      refreshSpy.mockRestore();
    });

    it('rethrows transient 500 error without marking account as REAUTH_REQUIRED', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error('Google OAuth 500 Internal Server Error');
      error.statusCode = 500;
      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockRejectedValueOnce(error);

      const tokenService = new TokenService(prisma, mockLogger);

      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow('Google OAuth 500');

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.ACTIVE);

      refreshSpy.mockRestore();
    });

    it('marks account REAUTH_REQUIRED when provider does not support refresh (Meta)', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'INSTAGRAM',
        accessToken: 'expired-meta-token',
        refreshToken: null,
        expiresAt: expiredDate,
      });

      const tokenService = new TokenService(prisma, mockLogger);

      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow(AuthRequiredError);

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.REAUTH_REQUIRED);
    });

    it('marks account REAUTH_REQUIRED when refresh token is missing from connection', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token',
        refreshToken: null,
        expiresAt: expiredDate,
      });

      const tokenService = new TokenService(prisma, mockLogger);

      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow(AuthRequiredError);

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.REAUTH_REQUIRED);
    });

    it('rethrows bare HTTP 400 error without marking account as REAUTH_REQUIRED', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error('Bad Request');
      error.statusCode = 400;
      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockRejectedValueOnce(error);

      const tokenService = new TokenService(prisma, mockLogger);

      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow('Bad Request');

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.ACTIVE);

      refreshSpy.mockRestore();
    });

    it('rethrows HTTP 400 invalid_client config error without marking account as REAUTH_REQUIRED', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error(
        'invalid_client: Unauthorized client credentials',
      );
      error.statusCode = 400;
      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockRejectedValueOnce(error);

      const tokenService = new TokenService(prisma, mockLogger);

      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow('invalid_client');

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.ACTIVE);

      refreshSpy.mockRestore();
    });

    it('rethrows HTTP 400 generic invalid_request config error without marking account as REAUTH_REQUIRED', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error('invalid_request: Missing parameter');
      error.statusCode = 400;
      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockRejectedValueOnce(error);

      const tokenService = new TokenService(prisma, mockLogger);

      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow('invalid_request');

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.ACTIVE);

      refreshSpy.mockRestore();
    });
  });

  describe('Redis Distributed Locking & Concurrency', () => {
    it('concurrent calls for same expired account: locks, calls refresh EXACTLY ONCE, both receive fresh credentials', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: expiredDate,
      });

      const mockRedis = new MockRedis();
      const ytProvider = providerRegistry.get('youtube');
      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockImplementation(async () => {
          // Add small artificial delay so second worker hits the lock
          await new Promise((r) => setTimeout(r, 100));
          return {
            accessToken: 'concurrent-refreshed-token',
            refreshToken: 'valid-refresh-token',
            expiresAt: new Date(Date.now() + 3600 * 1000),
            tokenType: 'Bearer',
          };
        });

      const tokenService1 = new TokenService(
        prisma,
        mockLogger,
        mockRedis as any,
      );
      const tokenService2 = new TokenService(
        prisma,
        mockLogger,
        mockRedis as any,
      );

      // Launch both simultaneously
      const [res1, res2] = await Promise.all([
        tokenService1.getExecutionCredentials(account.id),
        tokenService2.getExecutionCredentials(account.id),
      ]);

      expect(res1.accessToken).toBe('concurrent-refreshed-token');
      expect(res2.accessToken).toBe('concurrent-refreshed-token');
      expect(refreshSpy).toHaveBeenCalledTimes(1);

      refreshSpy.mockRestore();
    });

    it('safe lock release: worker does NOT delete lock held by another worker if TTL expired', async () => {
      const mockRedis = new MockRedis();
      const tokenService = new TokenService(
        prisma,
        mockLogger,
        mockRedis as any,
      );

      const lockKey = 'lock:refresh:test-account-123';
      const tokenWorkerB = 'token-worker-b';

      // Simulate Worker B currently holding the lock
      await mockRedis.set(lockKey, tokenWorkerB, 'PX', 10000);

      // Worker A attempts to release with Worker A's token
      const tokenWorkerA = 'token-worker-a';
      await (tokenService as any).releaseLock(lockKey, tokenWorkerA);

      // Lock should STILL be held by Worker B
      const current = await mockRedis.get(lockKey);
      expect(current).toBe(tokenWorkerB);

      // Now release with Worker B's token
      await (tokenService as any).releaseLock(lockKey, tokenWorkerB);
      expect(await mockRedis.get(lockKey)).toBeNull();
    });

    it('failure fencing: stale worker getting 400 invalid_grant does NOT mark REAUTH_REQUIRED if another worker refreshed credentials in DB', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token',
        refreshToken: 'stale-refresh-token',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error('invalid_grant: Token has been revoked');
      error.statusCode = 400;

      // When stale worker calls refresh, another worker has ALREADY updated the DB with new rotated refresh token & fresh access token
      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockImplementation(async () => {
          // Simulate Worker A updating DB while Worker B was calling refresh
          const encNewAccess = encrypt('fresh-token-from-worker-a');
          const encNewRefresh = encrypt('rotated-refresh-token-from-worker-a');
          await prisma.socialConnection.update({
            where: { socialAccountId: account.id },
            data: {
              encryptedAccessToken: encNewAccess.encrypted,
              accessTokenIv: encNewAccess.iv,
              accessTokenAuthTag: encNewAccess.authTag,
              keyVersion: encNewAccess.keyVersion,
              encryptedRefreshToken: encNewRefresh.encrypted,
              refreshTokenIv: encNewRefresh.iv,
              refreshTokenAuthTag: encNewRefresh.authTag,
              expiresAt: new Date(Date.now() + 3600 * 1000),
            },
          });
          // Stale worker call fails with 400 invalid_grant
          throw error;
        });

      const tokenService = new TokenService(prisma, mockLogger);

      // Stale worker should not mark REAUTH_REQUIRED, but instead recover and return fresh token from DB
      const creds = await tokenService.getExecutionCredentials(account.id);

      expect(creds.accessToken).toBe('fresh-token-from-worker-a');

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.ACTIVE);

      refreshSpy.mockRestore();
    });

    it('CAS fencing: worker does not overwrite newer rotated refresh token when CAS update conflict occurs', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'LINKEDIN',
        accessToken: 'expired-token',
        refreshToken: 'original-refresh-token',
        expiresAt: expiredDate,
      });

      const liProvider = providerRegistry.get('linkedin');
      const refreshSpy = jest
        .spyOn(liProvider as any, 'refreshCredentials')
        .mockImplementation(async () => {
          // While Worker B was calling refresh, Worker A already completed and updated DB with newer rotated token
          const encNewAccess = encrypt('worker-a-fresh-access-token');
          const encNewRefresh = encrypt('worker-a-new-rotated-refresh-token');
          await prisma.socialConnection.update({
            where: { socialAccountId: account.id },
            data: {
              encryptedAccessToken: encNewAccess.encrypted,
              accessTokenIv: encNewAccess.iv,
              accessTokenAuthTag: encNewAccess.authTag,
              keyVersion: encNewAccess.keyVersion,
              encryptedRefreshToken: encNewRefresh.encrypted,
              refreshTokenIv: encNewRefresh.iv,
              refreshTokenAuthTag: encNewRefresh.authTag,
              expiresAt: new Date(Date.now() + 3600 * 1000),
            },
          });

          // Worker B gets its own credentials response based on old refresh token
          return {
            accessToken: 'worker-b-stale-access-token',
            refreshToken: 'worker-b-stale-rotated-refresh-token',
            expiresAt: new Date(Date.now() + 3600 * 1000),
            tokenType: 'Bearer',
          };
        });

      const tokenService = new TokenService(prisma, mockLogger);
      const creds = await tokenService.getExecutionCredentials(account.id);

      // CAS should prevent Worker B from overwriting Worker A's credentials, and return Worker A's token
      expect(creds.accessToken).toBe('worker-a-fresh-access-token');

      const connInDb = await prisma.socialConnection.findUniqueOrThrow({
        where: { socialAccountId: account.id },
      });
      const decryptedRefresh = decrypt({
        encrypted: connInDb.encryptedRefreshToken!,
        iv: connInDb.refreshTokenIv!,
        authTag: connInDb.refreshTokenAuthTag!,
        keyVersion: connInDb.keyVersion,
      });
      expect(decryptedRefresh).toBe('worker-a-new-rotated-refresh-token');

      refreshSpy.mockRestore();
    });
  });

  describe('Token Refresh REAUTH_REQUIRED CAS TOCTOU Fencing', () => {
    it('1. genuine permanent refresh failure: unchanged snapshot transitions account to REAUTH_REQUIRED and throws AuthRequiredError', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token-1',
        refreshToken: 'valid-refresh-token-1',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error('invalid_grant: token has been revoked');
      error.statusCode = 400;
      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockRejectedValueOnce(error);

      const tokenService = new TokenService(prisma, mockLogger);
      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow(AuthRequiredError);

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.REAUTH_REQUIRED);

      refreshSpy.mockRestore();
    });

    it('2. concurrent successful refresh: DB has newer credentials -> stale worker receives invalid_grant, account remains ACTIVE, fresh access token returned', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token-2',
        refreshToken: 'stale-refresh-token-2',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error('invalid_grant: Bad Request');
      error.statusCode = 400;

      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockImplementation(async () => {
          // Simulate Worker A completing refresh while Worker B was in flight
          const encNewAccess = encrypt('fresh-token-from-worker-a-2');
          const encNewRefresh = encrypt(
            'rotated-refresh-token-from-worker-a-2',
          );
          await prisma.socialConnection.update({
            where: { socialAccountId: account.id },
            data: {
              encryptedAccessToken: encNewAccess.encrypted,
              accessTokenIv: encNewAccess.iv,
              accessTokenAuthTag: encNewAccess.authTag,
              keyVersion: encNewAccess.keyVersion,
              encryptedRefreshToken: encNewRefresh.encrypted,
              refreshTokenIv: encNewRefresh.iv,
              refreshTokenAuthTag: encNewRefresh.authTag,
              expiresAt: new Date(Date.now() + 3600 * 1000),
            },
          });
          throw error;
        });

      const tokenService = new TokenService(prisma, mockLogger);
      const creds = await tokenService.getExecutionCredentials(account.id);

      expect(creds.accessToken).toBe('fresh-token-from-worker-a-2');

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.ACTIVE);

      refreshSpy.mockRestore();
    });

    it('3. concurrent manual OAuth reconnect: DB connection updatedAt/tokens changed -> account remains ACTIVE, stale failure does NOT set REAUTH_REQUIRED', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token-3',
        refreshToken: 'stale-refresh-token-3',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error('invalid_grant: Token expired or revoked');
      error.statusCode = 400;

      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockImplementation(async () => {
          // Simulate user manually reconnecting in UI, writing new tokens and future expiresAt
          const encReconnected = encrypt('user-reconnected-access-token-3');
          const encReconnectedRefresh = encrypt(
            'user-reconnected-refresh-token-3',
          );
          await prisma.socialConnection.update({
            where: { socialAccountId: account.id },
            data: {
              encryptedAccessToken: encReconnected.encrypted,
              accessTokenIv: encReconnected.iv,
              accessTokenAuthTag: encReconnected.authTag,
              keyVersion: encReconnected.keyVersion,
              encryptedRefreshToken: encReconnectedRefresh.encrypted,
              refreshTokenIv: encReconnectedRefresh.iv,
              refreshTokenAuthTag: encReconnectedRefresh.authTag,
              expiresAt: new Date(Date.now() + 7200 * 1000),
            },
          });
          throw error;
        });

      const tokenService = new TokenService(prisma, mockLogger);
      const creds = await tokenService.getExecutionCredentials(account.id);

      expect(creds.accessToken).toBe('user-reconnected-access-token-3');

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.ACTIVE);

      refreshSpy.mockRestore();
    });

    it('4. refresh-token rotation: encryptedRefreshToken no longer matches failed snapshot -> stale failure cannot mutate account status', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token-4',
        refreshToken: 'old-refresh-token-4',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error('invalid_grant: Stale refresh token');
      error.statusCode = 400;

      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockImplementation(async () => {
          // Rotate refresh token in DB, but expiresAt remains in the past
          const encRotatedRefresh = encrypt('new-rotated-refresh-token-4');
          await prisma.socialConnection.update({
            where: { socialAccountId: account.id },
            data: {
              encryptedRefreshToken: encRotatedRefresh.encrypted,
              refreshTokenIv: encRotatedRefresh.iv,
              refreshTokenAuthTag: encRotatedRefresh.authTag,
            },
          });
          throw error;
        });

      const tokenService = new TokenService(prisma, mockLogger);
      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow(AuthRequiredError);

      // Status must NOT be changed to REAUTH_REQUIRED because credential snapshot changed
      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.ACTIVE);

      refreshSpy.mockRestore();
    });

    it('5. disconnect race: latest account status DISCONNECTED -> stale failure leaves DISCONNECTED unchanged', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token-5',
        refreshToken: 'refresh-token-5',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error('invalid_grant: Disconnected account');
      error.statusCode = 400;

      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockImplementation(async () => {
          // User disconnected account while refresh was in flight
          await prisma.socialAccount.update({
            where: { id: account.id },
            data: { status: SocialAccountStatus.DISCONNECTED },
          });
          throw error;
        });

      const tokenService = new TokenService(prisma, mockLogger);
      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow(AuthRequiredError);

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      // Crucial: Must NOT be resurrected to REAUTH_REQUIRED
      expect(updatedAccount.status).toBe(SocialAccountStatus.DISCONNECTED);

      refreshSpy.mockRestore();
    });

    it('6. genuine invalid_grant regression: unchanged snapshot still transitions to REAUTH_REQUIRED', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'LINKEDIN',
        accessToken: 'expired-token-6',
        refreshToken: 'valid-refresh-token-6',
        expiresAt: expiredDate,
      });

      const liProvider = providerRegistry.get('linkedin');
      const error: any = new Error('invalid_grant: Refresh token has expired');
      error.statusCode = 400;

      const refreshSpy = jest
        .spyOn(liProvider as any, 'refreshCredentials')
        .mockRejectedValueOnce(error);

      const tokenService = new TokenService(prisma, mockLogger);
      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow(AuthRequiredError);

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.REAUTH_REQUIRED);

      refreshSpy.mockRestore();
    });

    it('7. non-refreshable expired token: unchanged snapshot transitions to REAUTH_REQUIRED', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'INSTAGRAM',
        accessToken: 'expired-token-7',
        refreshToken: null,
        expiresAt: expiredDate,
      });

      const tokenService = new TokenService(prisma, mockLogger);
      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow(AuthRequiredError);

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.REAUTH_REQUIRED);
    });

    it('8. non-refreshable expired token + concurrent reconnect: stale worker must not overwrite ACTIVE', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account, connection } = await createAccountWithConnection({
        provider: 'INSTAGRAM',
        accessToken: 'expired-token-8',
        refreshToken: null,
        expiresAt: expiredDate,
      });

      // User reconnects concurrently in UI:
      const encReconnected = encrypt('reconnected-instagram-token-8');
      await prisma.socialConnection.update({
        where: { socialAccountId: account.id },
        data: {
          encryptedAccessToken: encReconnected.encrypted,
          accessTokenIv: encReconnected.iv,
          accessTokenAuthTag: encReconnected.authTag,
          keyVersion: encReconnected.keyVersion,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        },
      });

      const tokenService = new TokenService(prisma, mockLogger);
      // Stale worker executes handlePermanentAuthFailure with the old snapshot connection
      const creds = await (tokenService as any).handlePermanentAuthFailure({
        socialAccountId: account.id,
        workspaceId: account.workspaceId,
        accountProvider: 'INSTAGRAM',
        snapshotConnection: connection,
        snapshotAccount: account,
        errorMessage: 'Token expired and cannot be refreshed',
      });

      expect(creds.accessToken).toBe('reconnected-instagram-token-8');

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(updatedAccount.status).toBe(SocialAccountStatus.ACTIVE);
    });

    it('9. account CAS conflict: updateMany returns count 0 -> no blind fallback update, latest state preserved', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        accessToken: 'expired-token-9',
        refreshToken: 'valid-refresh-token-9',
        expiresAt: expiredDate,
      });

      const ytProvider = providerRegistry.get('youtube');
      const error: any = new Error('invalid_grant: token revoked');
      error.statusCode = 400;

      const refreshSpy = jest
        .spyOn(ytProvider as any, 'refreshCredentials')
        .mockRejectedValueOnce(error);

      // Intercept the prisma transaction to simulate a concurrent CAS conflict on SocialAccount
      const origTx = prisma.$transaction.bind(prisma);
      const txSpy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (cb: any) => {
          return origTx(async (tx: any) => {
            tx.socialAccount.updateMany = jest
              .fn()
              .mockResolvedValue({ count: 0 });
            return cb(tx);
          });
        });

      const tokenService = new TokenService(prisma, mockLogger);
      await expect(
        tokenService.getExecutionCredentials(account.id),
      ).rejects.toThrow(AuthRequiredError);

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      // The account must NOT have been updated to REAUTH_REQUIRED because CAS count was 0
      expect(updatedAccount.status).toBe(SocialAccountStatus.ACTIVE);

      txSpy.mockRestore();
      refreshSpy.mockRestore();
    });

    it('10. no stale ACTIVE restoration: helper must never force ACTIVE merely because stale worker found changed state', async () => {
      const expiredDate = new Date(Date.now() - 60 * 1000);
      const { account, connection } = await createAccountWithConnection({
        provider: 'YOUTUBE',
        status: SocialAccountStatus.REAUTH_REQUIRED,
        accessToken: 'expired-token-10',
        refreshToken: 'old-refresh-token-10',
        expiresAt: expiredDate,
      });

      // Another actor changed connection in DB, but the token is STILL expired
      const encNewAccess = encrypt('still-expired-token-10');
      await prisma.socialConnection.update({
        where: { socialAccountId: account.id },
        data: {
          encryptedAccessToken: encNewAccess.encrypted,
          accessTokenIv: encNewAccess.iv,
          accessTokenAuthTag: encNewAccess.authTag,
          keyVersion: encNewAccess.keyVersion,
          expiresAt: new Date(Date.now() - 30 * 1000), // Still in the past
        },
      });

      const tokenService = new TokenService(prisma, mockLogger);
      // Stale worker executes handlePermanentAuthFailure with the old snapshot connection
      await expect(
        (tokenService as any).handlePermanentAuthFailure({
          socialAccountId: account.id,
          workspaceId: account.workspaceId,
          accountProvider: 'YOUTUBE',
          snapshotConnection: connection,
          snapshotAccount: account,
          errorMessage: 'Stale worker failure',
        }),
      ).rejects.toThrow(AuthRequiredError);

      const updatedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      // Must remain REAUTH_REQUIRED, must NOT be forced to ACTIVE
      expect(updatedAccount.status).toBe(SocialAccountStatus.REAUTH_REQUIRED);
    });

    it('11. CAS conflict recheck DISCONNECTED guard: never returns recovered credentials when recheckAccount is DISCONNECTED', async () => {
      const futureDate = new Date(Date.now() + 3600 * 1000);
      const { account, connection } = await createAccountWithConnection({
        provider: 'INSTAGRAM',
        accessToken: 'instagram-token-11',
        refreshToken: null,
        expiresAt: futureDate,
      });

      // Intercept prisma.$transaction to simulate concurrent disconnect between initial read and CAS:
      // When updateMany runs, simulate CAS conflict (count: 0) and mark the account DISCONNECTED in DB
      const origTx = prisma.$transaction.bind(prisma);
      const txSpy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (cb: any) => {
          return origTx(async (tx: any) => {
            tx.socialAccount.updateMany = jest
              .fn()
              .mockImplementation(async () => {
                // Concurrently mark the account DISCONNECTED in the DB before CAS completes
                await prisma.socialAccount.update({
                  where: { id: account.id },
                  data: { status: SocialAccountStatus.DISCONNECTED },
                });
                // CAS fails because status is DISCONNECTED / updatedAt changed
                return { count: 0 };
              });
            return cb(tx);
          });
        });

      try {
        const tokenService = new TokenService(prisma, mockLogger);
        await expect(
          (tokenService as any).handlePermanentAuthFailure({
            socialAccountId: account.id,
            workspaceId: account.workspaceId,
            accountProvider: 'INSTAGRAM',
            snapshotConnection: connection,
            snapshotAccount: account,
            errorMessage: 'OAuth token revoked by user',
          }),
        ).rejects.toThrow(`Account ${account.id} (INSTAGRAM) is disconnected`);

        // Verify the persisted state in DB is preserved as DISCONNECTED (never mutated to REAUTH_REQUIRED)
        const persistedAccount = await prisma.socialAccount.findUniqueOrThrow({
          where: { id: account.id },
        });
        expect(persistedAccount.status).toBe(SocialAccountStatus.DISCONNECTED);
      } finally {
        txSpy.mockRestore();
      }
    });

    it('12. repository integration: concurrent OAuth reconnect via SocialAccountRepository.upsertWithConnection wins over stale failure', async () => {
      const socialAccountRepo = new SocialAccountRepository(prisma);

      // 1. Create workspace
      const ws = await prisma.workspace.create({
        data: {
          id: crypto.randomUUID(),
          name: 'Repo Integration Workspace',
          organization: {
            create: {
              id: crypto.randomUUID(),
              name: 'Repo Integration Org',
            },
          },
        },
      });

      const socialAccountId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const externalId = 'repo-test-external-id-12';
      const initialEnc = encrypt('initial-expired-token-12');
      const expiredDate = new Date(Date.now() - 120 * 1000);

      // 2. Initial connect via real SocialAccountRepository
      const { account: initialAccount } =
        await socialAccountRepo.upsertWithConnection(
          ws.id,
          {
            id: socialAccountId,
            provider: SocialProvider.LINKEDIN,
            externalId,
            name: 'LinkedIn Test Account',
            capabilities: ['PUBLISH'],
            status: SocialAccountStatus.ACTIVE,
          },
          {
            id: connectionId,
            encryptedAccessToken: initialEnc.encrypted,
            accessTokenIv: initialEnc.iv,
            accessTokenAuthTag: initialEnc.authTag,
            keyVersion: initialEnc.keyVersion,
            expiresAt: expiredDate,
          },
        );

      // 3. Worker reads initial snapshot before failure
      const initialConnection = await prisma.socialConnection.findUniqueOrThrow(
        {
          where: { socialAccountId: initialAccount.id },
        },
      );

      // 4. Concurrently, user re-authenticates in the dashboard via SocialAccountRepository.upsertWithConnection
      const reconnectedEnc = encrypt('reconnected-valid-token-12');
      const futureExpiresAt = new Date(Date.now() + 7200 * 1000); // 2 hours in future

      await socialAccountRepo.upsertWithConnection(
        ws.id,
        {
          id: socialAccountId,
          provider: SocialProvider.LINKEDIN,
          externalId,
          name: 'LinkedIn Test Account Reconnected',
          capabilities: ['PUBLISH', 'ANALYTICS'],
          status: SocialAccountStatus.ACTIVE,
        },
        {
          id: connectionId,
          encryptedAccessToken: reconnectedEnc.encrypted,
          accessTokenIv: reconnectedEnc.iv,
          accessTokenAuthTag: reconnectedEnc.authTag,
          keyVersion: reconnectedEnc.keyVersion,
          expiresAt: futureExpiresAt,
          grantedScopes: ['r_liteprofile', 'w_member_social'],
        },
      );

      // 5. Stale worker attempts to handle permanent failure using the old expired snapshot
      const tokenService = new TokenService(prisma, mockLogger);
      const recoveredCreds = await (
        tokenService as any
      ).handlePermanentAuthFailure({
        socialAccountId: initialAccount.id,
        workspaceId: ws.id,
        accountProvider: SocialProvider.LINKEDIN,
        snapshotConnection: initialConnection,
        snapshotAccount: initialAccount,
        errorMessage: 'Stale worker encountered expired token',
      });

      // 6. Assertions:
      // Worker safely recovers the new credentials written by upsertWithConnection
      expect(recoveredCreds).toBeDefined();
      expect(recoveredCreds.accessToken).toBe('reconnected-valid-token-12');

      // Database state check: account remains ACTIVE, never degraded to REAUTH_REQUIRED
      const persistedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: initialAccount.id },
        include: { connection: true },
      });
      expect(persistedAccount.status).toBe(SocialAccountStatus.ACTIVE);
      expect(persistedAccount.name).toBe('LinkedIn Test Account Reconnected');
      expect(persistedAccount.connection?.expiresAt?.getTime()).toBe(
        futureExpiresAt.getTime(),
      );
      expect(persistedAccount.connection?.grantedScopes).toEqual(
        expect.arrayContaining(['r_liteprofile', 'w_member_social']),
      );
    });

    it('13. repository integration: reconnect via upsertWithConnection on REAUTH_REQUIRED account restores ACTIVE and recovers credentials', async () => {
      const socialAccountRepo = new SocialAccountRepository(prisma);

      const ws = await prisma.workspace.create({
        data: {
          id: crypto.randomUUID(),
          name: 'Repo Integration Workspace 13',
          organization: {
            create: {
              id: crypto.randomUUID(),
              name: 'Repo Integration Org 13',
            },
          },
        },
      });

      const socialAccountId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const externalId = 'repo-test-external-id-13';
      const initialEnc = encrypt('reauth-req-old-token-13');
      const expiredDate = new Date(Date.now() - 3600 * 1000);

      // 1. Account starts in REAUTH_REQUIRED state
      const { account: initialAccount } =
        await socialAccountRepo.upsertWithConnection(
          ws.id,
          {
            id: socialAccountId,
            provider: SocialProvider.YOUTUBE,
            externalId,
            name: 'YouTube Account Needs Reauth',
            capabilities: ['PUBLISH'],
            status: SocialAccountStatus.REAUTH_REQUIRED,
          },
          {
            id: connectionId,
            encryptedAccessToken: initialEnc.encrypted,
            accessTokenIv: initialEnc.iv,
            accessTokenAuthTag: initialEnc.authTag,
            keyVersion: initialEnc.keyVersion,
            expiresAt: expiredDate,
          },
        );

      const staleSnapshotConnection =
        await prisma.socialConnection.findUniqueOrThrow({
          where: { socialAccountId: initialAccount.id },
        });

      // 2. User successfully reconnects via SocialAccountRepository.upsertWithConnection
      const reconnectedEnc = encrypt('reconnected-fresh-yt-token-13');
      const rotatedRefreshEnc = encrypt('reconnected-fresh-yt-refresh-13');
      const validUntil = new Date(Date.now() + 3600 * 1000);

      await socialAccountRepo.upsertWithConnection(
        ws.id,
        {
          id: socialAccountId,
          provider: SocialProvider.YOUTUBE,
          externalId,
          name: 'YouTube Account Restored',
          capabilities: ['PUBLISH', 'ANALYTICS'],
          status: SocialAccountStatus.ACTIVE,
        },
        {
          id: connectionId,
          encryptedAccessToken: reconnectedEnc.encrypted,
          accessTokenIv: reconnectedEnc.iv,
          accessTokenAuthTag: reconnectedEnc.authTag,
          encryptedRefreshToken: rotatedRefreshEnc.encrypted,
          refreshTokenIv: rotatedRefreshEnc.iv,
          refreshTokenAuthTag: rotatedRefreshEnc.authTag,
          keyVersion: reconnectedEnc.keyVersion,
          expiresAt: validUntil,
        },
      );

      // 3. Concurrently, a lingering stale failure handler fires with the old snapshot
      const tokenService = new TokenService(prisma, mockLogger);
      const creds = await (tokenService as any).handlePermanentAuthFailure({
        socialAccountId: initialAccount.id,
        workspaceId: ws.id,
        accountProvider: SocialProvider.YOUTUBE,
        snapshotConnection: staleSnapshotConnection,
        snapshotAccount: initialAccount,
        errorMessage: 'Stale refresh failure on superseded credentials',
      });

      // 4. Assertions:
      expect(creds.accessToken).toBe('reconnected-fresh-yt-token-13');

      const persistedAccount = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: initialAccount.id },
        include: { connection: true },
      });
      // The account must be ACTIVE (restored by upsertWithConnection, not reverted by stale failure)
      expect(persistedAccount.status).toBe(SocialAccountStatus.ACTIVE);
      expect(persistedAccount.name).toBe('YouTube Account Restored');
    });

    it('14. CAS-conflict recheck reconnect recovery: recovers valid credentials when OAuth reconnect races after initial read but before CAS update', async () => {
      const socialAccountRepo = new SocialAccountRepository(prisma);

      // 1. Create workspace
      const ws = await prisma.workspace.create({
        data: {
          id: crypto.randomUUID(),
          name: 'Repo Integration Workspace 14',
          organization: {
            create: {
              id: crypto.randomUUID(),
              name: 'Repo Integration Org 14',
            },
          },
        },
      });

      const socialAccountId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const externalId = 'repo-test-external-id-14';
      const initialEnc = encrypt('initial-expired-token-14');
      const expiredDate = new Date(Date.now() - 120 * 1000);

      // 2. Initial connect with expired token
      const { account: initialAccount } =
        await socialAccountRepo.upsertWithConnection(
          ws.id,
          {
            id: socialAccountId,
            provider: SocialProvider.LINKEDIN,
            externalId,
            name: 'LinkedIn Test Account 14',
            capabilities: ['PUBLISH'],
            status: SocialAccountStatus.ACTIVE,
          },
          {
            id: connectionId,
            encryptedAccessToken: initialEnc.encrypted,
            accessTokenIv: initialEnc.iv,
            accessTokenAuthTag: initialEnc.authTag,
            keyVersion: initialEnc.keyVersion,
            expiresAt: expiredDate,
          },
        );

      // 3. Worker reads initial snapshot before failure
      const initialConnection = await prisma.socialConnection.findUniqueOrThrow(
        {
          where: { socialAccountId: initialAccount.id },
        },
      );

      const reconnectedEnc = encrypt('reconnected-cas-recheck-token-14');
      const futureExpiresAt = new Date(Date.now() + 7200 * 1000); // 2 hours in future

      // Intercept prisma.$transaction to orchestrate the precise race:
      // The worker reads the unchanged snapshot (Step 1-3), bypassing Step 4.
      // Then, right before the CAS status update executes, concurrent OAuth reconnect occurs.
      const origTx = prisma.$transaction.bind(prisma);
      let intercepted = false;
      const txSpy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(async (cb: any) => {
          if (intercepted) {
            return origTx(cb);
          }
          intercepted = true;
          return origTx(async (tx: any) => {
            const origUpdateMany = tx.socialAccount.updateMany.bind(
              tx.socialAccount,
            );
            tx.socialAccount.updateMany = jest
              .fn()
              .mockImplementation(async (...args: any[]) => {
                // Concurrently re-authenticate via real SocialAccountRepository
                await socialAccountRepo.upsertWithConnection(
                  ws.id,
                  {
                    id: socialAccountId,
                    provider: SocialProvider.LINKEDIN,
                    externalId,
                    name: 'LinkedIn Reconnected via CAS Recheck',
                    capabilities: ['PUBLISH', 'ANALYTICS'],
                    status: SocialAccountStatus.ACTIVE,
                  },
                  {
                    id: connectionId,
                    encryptedAccessToken: reconnectedEnc.encrypted,
                    accessTokenIv: reconnectedEnc.iv,
                    accessTokenAuthTag: reconnectedEnc.authTag,
                    keyVersion: reconnectedEnc.keyVersion,
                    expiresAt: futureExpiresAt,
                    grantedScopes: ['r_liteprofile', 'w_member_social'],
                  },
                );

                // Execute real updateMany: because SocialAccount.updatedAt was touched in DB
                // by upsertWithConnection, CAS updatedAt condition naturally returns { count: 0 }
                return origUpdateMany(...args);
              });
            return cb(tx);
          });
        });

      try {
        const tokenService = new TokenService(prisma, mockLogger);
        const recoveredCreds = await (
          tokenService as any
        ).handlePermanentAuthFailure({
          socialAccountId: initialAccount.id,
          workspaceId: ws.id,
          accountProvider: SocialProvider.LINKEDIN,
          snapshotConnection: initialConnection,
          snapshotAccount: initialAccount,
          errorMessage: 'Stale worker failure during concurrent reconnect',
        });

        // 4. Assertions:
        // Worker must recover the newly persisted credentials from the CAS recheck branch
        expect(recoveredCreds).toBeDefined();
        expect(recoveredCreds.accessToken).toBe(
          'reconnected-cas-recheck-token-14',
        );

        // Database state verification: account remains ACTIVE, never degraded to REAUTH_REQUIRED
        const persistedAccount = await prisma.socialAccount.findUniqueOrThrow({
          where: { id: initialAccount.id },
          include: { connection: true },
        });
        expect(persistedAccount.status).toBe(SocialAccountStatus.ACTIVE);
        expect(persistedAccount.name).toBe(
          'LinkedIn Reconnected via CAS Recheck',
        );
        expect(persistedAccount.connection?.expiresAt?.getTime()).toBe(
          futureExpiresAt.getTime(),
        );
        expect(persistedAccount.connection?.grantedScopes).toEqual(
          expect.arrayContaining(['r_liteprofile', 'w_member_social']),
        );
      } finally {
        txSpy.mockRestore();
      }
    });
  });
});
