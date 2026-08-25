import { PrismaClient, SocialAccount, SocialProvider, SocialAccountStatus } from '@prisma/client';

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
      encryptedRefreshToken: string | null;
      refreshTokenIv: string | null;
      refreshTokenAuthTag: string | null;
      keyVersion: number;
      expiresAt?: Date | null;
    }
  ): Promise<SocialAccount> {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.socialAccount.upsert({
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

      await tx.socialConnection.upsert({
        where: {
          socialAccountId: account.id,
        },
        create: {
          ...connectionData,
          socialAccountId: account.id,
        },
        update: {
          ...connectionData,
        },
      });

      return account;
    });
  }
}
