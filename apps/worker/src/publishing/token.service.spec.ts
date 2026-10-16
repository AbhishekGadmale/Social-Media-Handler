/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import {
  PrismaClient,
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
  let prisma: PrismaClient;

  beforeAll(() => {
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

      const tokenService = new TokenService(prisma);
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

      const tokenService = new TokenService(prisma);
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

      const tokenService = new TokenService(prisma);
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

      const tokenService = new TokenService(prisma);
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

      const tokenService = new TokenService(prisma);
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

      const tokenService = new TokenService(prisma);
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

      const tokenService = new TokenService(prisma);

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

      const tokenService = new TokenService(prisma);

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

      const tokenService = new TokenService(prisma);

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

      const tokenService = new TokenService(prisma);

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

      const tokenService = new TokenService(prisma);

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

      const tokenService = new TokenService(prisma);

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

      const tokenService = new TokenService(prisma);

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

      const tokenService1 = new TokenService(prisma, mockRedis as any);
      const tokenService2 = new TokenService(prisma, mockRedis as any);

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
      const tokenService = new TokenService(prisma, mockRedis as any);

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

      const tokenService = new TokenService(prisma);

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

      const tokenService = new TokenService(prisma);
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
});
