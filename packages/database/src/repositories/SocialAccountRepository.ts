import { decrypt } from '../crypto/encryption';
import { generateId } from '../id';
import { AuditAction } from './AuditLogRepository';
import { PrismaClient, SocialAccount, SocialProvider, SocialAccountStatus, Prisma } from '@prisma/client';

export class SocialAccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertWithConnection(
    workspaceId: string,
    accountData: {
      provider: SocialProvider;
      externalId: string;
      name?: string | null;
      capabilities: string[];
      status: SocialAccountStatus;
      id: string;
    },
    connectionData: {
      id: string;
      encryptedAccessToken: string;
      accessTokenIv: string;
      accessTokenAuthTag: string;
      encryptedRefreshToken?: string | null;
      refreshTokenIv?: string | null;
      refreshTokenAuthTag?: string | null;
      keyVersion: number;
      expiresAt?: Date | null;
      grantedScopes?: string[];
    },
    tx?: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">
  ): Promise<{ account: SocialAccount; isNew: boolean }> {
    const execute = async (client: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => {
      const existing = await client.socialAccount.findUnique({
        where: {
          provider_externalId: {
            provider: accountData.provider,
            externalId: accountData.externalId,
          },
        },
      });

      const isNew = !existing;

      const account = await client.socialAccount.upsert({
        where: {
          provider_externalId: {
            provider: accountData.provider,
            externalId: accountData.externalId,
          },
        },
        create: {
          id: accountData.id,
          workspaceId,
          provider: accountData.provider,
          externalId: accountData.externalId,
          name: accountData.name,
          capabilities: accountData.capabilities,
          status: accountData.status,
        },
        update: {
          name: accountData.name,
          capabilities: accountData.capabilities,
          status: accountData.status,
        },
      });

        const existingConnection = await client.socialConnection.findUnique({
          where: { socialAccountId: account.id }
        });

        const updateData: Prisma.SocialConnectionUpdateInput = {
          encryptedAccessToken: connectionData.encryptedAccessToken,
          accessTokenIv: connectionData.accessTokenIv,
          accessTokenAuthTag: connectionData.accessTokenAuthTag,
          keyVersion: connectionData.keyVersion,
          expiresAt: connectionData.expiresAt,
        };
        if (connectionData.encryptedRefreshToken) {
          updateData.encryptedRefreshToken = connectionData.encryptedRefreshToken;
          updateData.refreshTokenIv = connectionData.refreshTokenIv;
          updateData.refreshTokenAuthTag = connectionData.refreshTokenAuthTag;
        }
        if (connectionData.grantedScopes) {
          const mergedScopes = new Set(existingConnection?.grantedScopes || []);
          connectionData.grantedScopes.forEach(s => mergedScopes.add(s));
          updateData.grantedScopes = Array.from(mergedScopes);
        }

        await client.socialConnection.upsert({
          where: {
            socialAccountId: account.id,
          },
          create: {
            id: connectionData.id,
            encryptedAccessToken: connectionData.encryptedAccessToken,
            accessTokenIv: connectionData.accessTokenIv,
            accessTokenAuthTag: connectionData.accessTokenAuthTag,
            encryptedRefreshToken: connectionData.encryptedRefreshToken || null,
            refreshTokenIv: connectionData.refreshTokenIv || null,
            refreshTokenAuthTag: connectionData.refreshTokenAuthTag || null,
            keyVersion: connectionData.keyVersion,
            expiresAt: connectionData.expiresAt,
            grantedScopes: connectionData.grantedScopes || [],
            socialAccountId: account.id,
          },
          update: updateData,
        });

      return { account, isNew };
    };

    return tx ? execute(tx) : this.prisma.$transaction(execute);
  }

  async upsertManyWithConnection(
    workspaceId: string,
    accounts: Array<{
      accountData: {
        provider: SocialProvider;
        externalId: string;
        name?: string | null;
        capabilities: string[];
        status: SocialAccountStatus;
        id: string;
      };
      connectionData: {
        id: string;
        encryptedAccessToken: string;
        accessTokenIv: string;
        accessTokenAuthTag: string;
        encryptedRefreshToken?: string | null;
        refreshTokenIv?: string | null;
        refreshTokenAuthTag?: string | null;
        keyVersion: number;
        expiresAt?: Date | null;
        grantedScopes?: string[];
      };
    }>
  ): Promise<Array<{ account: SocialAccount; isNew: boolean }>> {
    return this.prisma.$transaction(async (tx) => {
      const results: Array<{ account: SocialAccount; isNew: boolean }> = [];
      for (const item of accounts) {
        const result = await this.upsertWithConnection(
          workspaceId,
          item.accountData,
          item.connectionData,
          tx
        );
        results.push(result);
      }
      return results;
    });
  }
  async getDecryptedCredentials(socialAccountId: string): Promise<{
    accessToken: string;
    refreshToken?: string | null;
  } | null> {
    const conn = await this.prisma.socialConnection.findUnique({
      where: { socialAccountId },
    });

    if (
      !conn ||
      !conn.encryptedAccessToken ||
      !conn.accessTokenIv ||
      !conn.accessTokenAuthTag
    ) {
      return null;
    }

    const accessToken = decrypt({
      encrypted: conn.encryptedAccessToken,
      iv: conn.accessTokenIv,
      authTag: conn.accessTokenAuthTag,
      keyVersion: conn.keyVersion,
    });

    let refreshToken: string | null = null;
    if (
      conn.encryptedRefreshToken &&
      conn.refreshTokenIv &&
      conn.refreshTokenAuthTag
    ) {
      refreshToken = decrypt({
        encrypted: conn.encryptedRefreshToken,
        iv: conn.refreshTokenIv,
        authTag: conn.refreshTokenAuthTag,
        keyVersion: conn.keyVersion,
      });
    }

    return {
      accessToken,
      refreshToken,
    };
  }

  async disconnect(
    workspaceId: string,
    socialAccountId: string,
    actorId?: string | null,
    metadata?: Record<string, any>,
    requestId?: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const conn = await tx.socialConnection.findUnique({
        where: { socialAccountId },
      });

      if (conn) {
        await tx.socialConnection.update({
          where: { id: conn.id },
          data: {
            encryptedAccessToken: null,
            accessTokenIv: null,
            accessTokenAuthTag: null,
            encryptedRefreshToken: null,
            refreshTokenIv: null,
            refreshTokenAuthTag: null,
            expiresAt: null,
            refreshExpiresAt: null,
          },
        });
      }

      await tx.socialAccount.update({
        where: { id: socialAccountId },
        data: {
          status: SocialAccountStatus.DISCONNECTED,
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId(),
          workspaceId,
          actorId,
          action: AuditAction.ACCOUNT_DISCONNECTED,
          targetType: 'SocialAccount',
          targetId: socialAccountId,
          requestId,
          metadata: metadata || Prisma.JsonNull,
        },
      });
    });
  }
}
