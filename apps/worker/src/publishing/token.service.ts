import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, SocialAccountStatus } from '@agency-os/database';
import { decrypt, encrypt } from '@agency-os/database/src/crypto/encryption';
import {
  ProviderExecutionCredentials,
  ProviderRegistry,
  providerRegistry,
  OAuthCredentials,
} from '@agency-os/providers';
import type Redis from 'ioredis';
import crypto from 'node:crypto';

export class AuthRequiredError extends Error {
  public readonly isAuthRequired = true;

  constructor(message: string) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  public static readonly REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly LOCK_TTL_MS = 10000; // 10 seconds

  constructor(
    private readonly prisma: PrismaClient,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
    @Optional() private readonly providerRegistryInstance?: ProviderRegistry,
  ) {}

  async getExecutionCredentials(
    socialAccountId: string,
    workspaceId?: string,
  ): Promise<ProviderExecutionCredentials> {
    const where: any = { id: socialAccountId };
    if (workspaceId) {
      where.workspaceId = workspaceId;
    }
    const account = await this.prisma.socialAccount.findFirst({
      where,
      include: { connection: true },
    });

    if (!account || !account.connection) {
      throw new Error(
        `Social account connection not found for id: ${socialAccountId}`,
      );
    }

    const now = Date.now();
    const expiresAtMs = account.connection.expiresAt
      ? account.connection.expiresAt.getTime()
      : null;

    // 1. Freshness check: if token has no expiration (e.g. Meta page token) or expires in > 5m
    if (
      expiresAtMs === null ||
      expiresAtMs > now + TokenService.REFRESH_THRESHOLD_MS
    ) {
      const decryptedToken = decrypt({
        encrypted: account.connection.encryptedAccessToken,
        iv: account.connection.accessTokenIv,
        authTag: account.connection.accessTokenAuthTag,
        keyVersion: account.connection.keyVersion,
      });

      return {
        accessToken: decryptedToken,
      };
    }

    // 2. Token is near expiry or expired: coordinate refresh
    return this.refreshAndGetCredentials(account, socialAccountId);
  }

  private async refreshAndGetCredentials(
    account: any,
    socialAccountId: string,
  ): Promise<ProviderExecutionCredentials> {
    const lockKey = `lock:refresh:${socialAccountId}`;
    const lockToken = crypto.randomUUID();
    let lockAcquired = false;

    if (this.redis) {
      let attempts = 0;
      const maxAttempts = 15; // 15 * 200ms = 3000ms max wait
      while (!lockAcquired && attempts < maxAttempts) {
        const res = await this.redis.set(
          lockKey,
          lockToken,
          'PX',
          TokenService.LOCK_TTL_MS,
          'NX',
        );
        if (res === 'OK') {
          lockAcquired = true;
          break;
        }

        attempts++;
        await new Promise((r) => setTimeout(r, 200));

        // Re-read connection from DB: did another worker finish the refresh while we waited?
        const refreshedConnection =
          await this.prisma.socialConnection.findUnique({
            where: { socialAccountId },
          });

        if (
          refreshedConnection?.expiresAt &&
          refreshedConnection.expiresAt.getTime() >
            Date.now() + TokenService.REFRESH_THRESHOLD_MS
        ) {
          const decryptedToken = decrypt({
            encrypted: refreshedConnection.encryptedAccessToken,
            iv: refreshedConnection.accessTokenIv,
            authTag: refreshedConnection.accessTokenAuthTag,
            keyVersion: refreshedConnection.keyVersion,
          });
          return { accessToken: decryptedToken };
        }
      }

      if (!lockAcquired) {
        // Double-check one final time before giving up
        const refreshedConnection =
          await this.prisma.socialConnection.findUnique({
            where: { socialAccountId },
          });
        if (
          refreshedConnection?.expiresAt &&
          refreshedConnection.expiresAt.getTime() >
            Date.now() + TokenService.REFRESH_THRESHOLD_MS
        ) {
          const decryptedToken = decrypt({
            encrypted: refreshedConnection.encryptedAccessToken,
            iv: refreshedConnection.accessTokenIv,
            authTag: refreshedConnection.accessTokenAuthTag,
            keyVersion: refreshedConnection.keyVersion,
          });
          return { accessToken: decryptedToken };
        }
        throw new Error(
          `Token refresh lock acquisition timed out for social account ${socialAccountId}`,
        );
      }
    }

    try {
      // Re-read fresh connection from DB after acquiring lock
      const currentConnection = await this.prisma.socialConnection.findUnique({
        where: { socialAccountId },
      });

      if (!currentConnection) {
        throw new Error(
          `Social account connection missing for id: ${socialAccountId}`,
        );
      }

      // Check if another worker refreshed while we were acquiring the lock
      if (
        currentConnection.expiresAt &&
        currentConnection.expiresAt.getTime() >
          Date.now() + TokenService.REFRESH_THRESHOLD_MS
      ) {
        const decryptedToken = decrypt({
          encrypted: currentConnection.encryptedAccessToken,
          iv: currentConnection.accessTokenIv,
          authTag: currentConnection.accessTokenAuthTag,
          keyVersion: currentConnection.keyVersion,
        });
        return { accessToken: decryptedToken };
      }

      const registry = this.providerRegistryInstance || providerRegistry;
      const provider = registry.get(String(account.provider).toLowerCase());

      const hasRefreshToken = Boolean(currentConnection.encryptedRefreshToken);
      const canRefresh =
        hasRefreshToken && typeof provider?.refreshCredentials === 'function';

      if (!canRefresh || !provider?.refreshCredentials) {
        await this.prisma.socialAccount.update({
          where: { id: socialAccountId },
          data: { status: SocialAccountStatus.REAUTH_REQUIRED },
        });
        throw new AuthRequiredError(
          `Token expired for account ${socialAccountId} (${String(account.provider)}) and cannot be refreshed`,
        );
      }

      const refreshToken = decrypt({
        encrypted: currentConnection.encryptedRefreshToken!,
        iv: currentConnection.refreshTokenIv!,
        authTag: currentConnection.refreshTokenAuthTag!,
        keyVersion: currentConnection.keyVersion,
      });

      let newCreds: OAuthCredentials;
      try {
        newCreds = await provider.refreshCredentials(refreshToken);
      } catch (err: any) {
        const statusCode =
          typeof err?.statusCode === 'number'
            ? (err.statusCode as number)
            : typeof err?.status === 'number'
              ? (err.status as number)
              : undefined;
        const msg = String(err?.message || '').toLowerCase();
        const isAuthInvalid =
          statusCode === 400 ||
          statusCode === 401 ||
          msg.includes('invalid_grant') ||
          msg.includes('invalid_token') ||
          msg.includes('unauthorized') ||
          msg.includes('revoked');

        if (isAuthInvalid) {
          await this.prisma.socialAccount.update({
            where: { id: socialAccountId },
            data: { status: SocialAccountStatus.REAUTH_REQUIRED },
          });
          throw new AuthRequiredError(
            `Failed to refresh token for account ${socialAccountId}: ${String(err?.message || 'Unauthorized')}`,
          );
        }

        // Transient / network / 5xx error: do NOT mark permanently REAUTH_REQUIRED
        throw err;
      }

      const encAccess = encrypt(newCreds.accessToken);

      await this.prisma.$transaction(async (tx) => {
        const updateData: any = {
          encryptedAccessToken: encAccess.encrypted,
          accessTokenIv: encAccess.iv,
          accessTokenAuthTag: encAccess.authTag,
          keyVersion: encAccess.keyVersion,
          expiresAt: newCreds.expiresAt,
        };

        // If provider returned a new/rotated refresh token, encrypt and persist it.
        // If omitted, preserve the existing refresh token.
        if (newCreds.refreshToken) {
          const encRefresh = encrypt(newCreds.refreshToken);
          updateData.encryptedRefreshToken = encRefresh.encrypted;
          updateData.refreshTokenIv = encRefresh.iv;
          updateData.refreshTokenAuthTag = encRefresh.authTag;
        }

        await tx.socialConnection.update({
          where: { socialAccountId },
          data: updateData,
        });

        if (account.status !== SocialAccountStatus.ACTIVE) {
          await tx.socialAccount.update({
            where: { id: socialAccountId },
            data: { status: SocialAccountStatus.ACTIVE },
          });
        }
      });

      return {
        accessToken: newCreds.accessToken,
      };
    } finally {
      if (this.redis && lockAcquired) {
        await this.releaseLock(lockKey, lockToken);
      }
    }
  }

  private async releaseLock(lockKey: string, lockToken: string): Promise<void> {
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      if (typeof this.redis!.eval === 'function') {
        await this.redis!.eval(luaScript, 1, lockKey, lockToken);
      } else {
        const current = await this.redis!.get(lockKey);
        if (current === lockToken) {
          await this.redis!.del(lockKey);
        }
      }
    } catch (err) {
      this.logger.warn(
        { err, lockKey },
        'Failed to release token refresh lock',
      );
    }
  }
}
