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

    // 1. Freshness check: if token has no expiration (e.g. permanent token) or expires in > 5m
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

    // Check if token cannot be refreshed and is still valid (Blocker 3: Premature REAUTH fix)
    const registry = this.providerRegistryInstance || providerRegistry;
    const provider = registry.get(String(account.provider).toLowerCase());
    const hasRefreshToken = Boolean(account.connection.encryptedRefreshToken);
    const canRefresh =
      hasRefreshToken && typeof provider?.refreshCredentials === 'function';

    if (!canRefresh && expiresAtMs > now) {
      // Token is in the 5-minute pre-expiry window, cannot be refreshed, but is STILL VALID
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

    // 2. Token is near expiry and refreshable, or actually expired: coordinate refresh
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
      const maxAttempts = 50; // 50 * 200ms = 10,000ms max wait (matches 10s Redis Lock TTL)
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
        // Blocker 3: Premature REAUTH fix
        // If the token is still valid (now < expiresAt), return it!
        if (
          currentConnection.expiresAt &&
          currentConnection.expiresAt.getTime() > Date.now()
        ) {
          const decryptedToken = decrypt({
            encrypted: currentConnection.encryptedAccessToken,
            iv: currentConnection.accessTokenIv,
            authTag: currentConnection.accessTokenAuthTag,
            keyVersion: currentConnection.keyVersion,
          });
          return { accessToken: decryptedToken };
        }

        // Only mark REAUTH_REQUIRED if token is actually expired
        await this.prisma.socialAccount.update({
          where: { id: socialAccountId },
          data: { status: SocialAccountStatus.REAUTH_REQUIRED },
        });
        throw new AuthRequiredError(
          `Token expired for account ${socialAccountId} (${String(account.provider)}) and cannot be refreshed`,
        );
      }

      const oldEncryptedRefreshToken = currentConnection.encryptedRefreshToken;

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

        // Blocker 4: Require semantic evidence before treating HTTP 400 as permanent auth failure
        const hasSemanticAuthFailure =
          msg.includes('invalid_grant') ||
          msg.includes('invalid_token') ||
          msg.includes('unauthorized') ||
          msg.includes('revoked') ||
          msg.includes('token_expired') ||
          msg.includes('token has been expired or revoked') ||
          msg.includes('expired');

        const is401 = statusCode === 401;
        const is400WithSemanticAuth =
          statusCode === 400 && hasSemanticAuthFailure;

        // Exclude config errors like invalid_client or bare invalid_request unless accompanied by explicit grant failure
        const isConfigError =
          msg.includes('invalid_client') ||
          (msg.includes('invalid_request') && !hasSemanticAuthFailure);

        const isAuthInvalid =
          (is401 || is400WithSemanticAuth || hasSemanticAuthFailure) &&
          !isConfigError;

        if (isAuthInvalid) {
          // Failure Fencing (Blocker 1): Re-read connection from DB before marking REAUTH_REQUIRED
          const latestConnection =
            await this.prisma.socialConnection.findUnique({
              where: { socialAccountId },
            });

          // Check if another worker refreshed while we were in flight
          const isRefreshedByOther =
            (latestConnection?.encryptedRefreshToken &&
              latestConnection.encryptedRefreshToken !==
                oldEncryptedRefreshToken) ||
            (latestConnection?.expiresAt &&
              latestConnection.expiresAt.getTime() >
                Date.now() + TokenService.REFRESH_THRESHOLD_MS);

          if (
            isRefreshedByOther &&
            latestConnection?.expiresAt &&
            latestConnection.expiresAt.getTime() > Date.now()
          ) {
            const decryptedToken = decrypt({
              encrypted: latestConnection.encryptedAccessToken,
              iv: latestConnection.accessTokenIv,
              authTag: latestConnection.accessTokenAuthTag,
              keyVersion: latestConnection.keyVersion,
            });
            return { accessToken: decryptedToken };
          }

          // Genuine auth failure: Refresh token in DB hasn't changed and token is truly revoked/expired
          await this.prisma.socialAccount.update({
            where: { id: socialAccountId },
            data: { status: SocialAccountStatus.REAUTH_REQUIRED },
          });
          throw new AuthRequiredError(
            `Failed to refresh token for account ${socialAccountId}: ${String(err?.message || 'Unauthorized')}`,
          );
        }

        // Transient / network / 5xx / config error: do NOT mark permanently REAUTH_REQUIRED
        throw err;
      }

      const encAccess = encrypt(newCreds.accessToken);

      const returnedCreds = await this.prisma.$transaction(async (tx) => {
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

        // CAS Fencing (Blocker 1): Compare-and-swap using oldEncryptedRefreshToken
        const casResult = await tx.socialConnection.updateMany({
          where: {
            socialAccountId,
            encryptedRefreshToken: oldEncryptedRefreshToken,
          },
          data: updateData,
        });

        if (casResult.count === 0) {
          // Another worker won the race and updated the connection!
          // Re-read latest connection and return fresh credentials without overwriting
          const latest = await tx.socialConnection.findUnique({
            where: { socialAccountId },
          });
          if (latest) {
            const decryptedLatest = decrypt({
              encrypted: latest.encryptedAccessToken,
              iv: latest.accessTokenIv,
              authTag: latest.accessTokenAuthTag,
              keyVersion: latest.keyVersion,
            });
            return { accessToken: decryptedLatest };
          }
        }

        if (account.status !== SocialAccountStatus.ACTIVE) {
          await tx.socialAccount.update({
            where: { id: socialAccountId },
            data: { status: SocialAccountStatus.ACTIVE },
          });
        }

        return {
          accessToken: newCreds.accessToken,
        };
      });

      return returnedCreds;
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
