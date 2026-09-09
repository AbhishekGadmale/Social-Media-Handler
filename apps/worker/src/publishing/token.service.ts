import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@agency-os/database';
import { decrypt } from '@agency-os/database/src/crypto/encryption'; // or whatever the path is
import { ProviderExecutionCredentials } from '@agency-os/providers';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(private readonly prisma: PrismaClient) {}

  async getExecutionCredentials(
    socialAccountId: string,
  ): Promise<ProviderExecutionCredentials> {
    const account = await this.prisma.socialAccount.findUnique({
      where: { id: socialAccountId },
      include: { connection: true },
    });

    if (!account || !account.connection) {
      throw new Error('Social account connection not found');
    }

    if (
      account.connection.expiresAt &&
      account.connection.expiresAt < new Date()
    ) {
      // In a full implementation, we'd exchange refreshToken here.
      // For now, since providers don't have refresh method, we just throw to trigger AUTH_REQUIRED.
      throw new Error('Token is expired and refresh is not implemented yet');
    }

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
}
