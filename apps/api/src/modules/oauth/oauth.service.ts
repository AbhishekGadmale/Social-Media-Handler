import { Injectable, Inject, ForbiddenException, BadRequestException } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaClient, encrypt, generateId } from '@agency-os/database';
import { LinkedInProvider } from '@agency-os/providers';
import crypto from 'node:crypto';

@Injectable()
export class OAuthService {
  private linkedInProvider: LinkedInProvider;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly prisma: PrismaClient,
  ) {
    this.linkedInProvider = new LinkedInProvider();
  }

  async generateLinkedInAuthUrl(userId: string, workspaceId: string, redirectUri: string): Promise<string> {
    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const stateData = {
      userId,
      workspaceId,
      provider: 'LINKEDIN',
      codeVerifier,
      createdAt: new Date().toISOString(),
    };

    // TTL 5 minutes
    await this.redis.set(`oauth_state:${state}`, JSON.stringify(stateData), 'EX', 300);

    return this.linkedInProvider.getAuthorizationUrl({
      workspaceId,
      redirectUri,
      state,
      codeChallenge,
    });
  }

  async handleLinkedInCallback(userId: string, state: string, code: string, redirectUri: string): Promise<void> {
    const stateKey = `oauth_state:${state}`;
    const stateDataStr = await this.redis.get(stateKey);

    if (!stateDataStr) {
      throw new ForbiddenException('Invalid or expired state');
    }

    // single-use deletion
    await this.redis.del(stateKey);

    const stateData = JSON.parse(stateDataStr);

    if (stateData.userId !== userId) {
      throw new ForbiddenException('State userId mismatch');
    }

    const { workspaceId, codeVerifier } = stateData;

    // Exchange code
    const credentials = await this.linkedInProvider.exchangeAuthorizationCode({
      code,
      redirectUri,
      codeVerifier,
    });

    // Get profiles
    const profiles = await this.linkedInProvider.getProfiles(credentials);
    if (!profiles.length) {
      throw new BadRequestException('No profiles returned from LinkedIn');
    }
    const profile = profiles[0];

    // Capabilities
    const capabilities = await this.linkedInProvider.getCapabilities({
      provider: 'linkedin',
      grantedScopes: credentials.scopes || [],
    });

    // Encrypt tokens separately
    const encAccess = encrypt(credentials.accessToken);
    let encRefresh = null;
    if (credentials.refreshToken) {
      encRefresh = encrypt(credentials.refreshToken);
    }

    // Save to DB
    await this.prisma.$transaction(async (tx) => {
      // Upsert SocialAccount
      const account = await tx.socialAccount.upsert({
        where: {
          provider_externalId: {
            provider: 'LINKEDIN',
            externalId: profile.id,
          },
        },
        create: {
          id: generateId(),
          workspaceId,
          provider: 'LINKEDIN',
          externalId: profile.id,
          name: profile.name,
          capabilities,
          status: 'ACTIVE',
        },
        update: {
          name: profile.name,
          capabilities,
          status: 'ACTIVE',
        },
      });

      // Upsert SocialConnection
      await tx.socialConnection.upsert({
        where: {
          socialAccountId: account.id,
        },
        create: {
          id: generateId(),
          socialAccountId: account.id,
          encryptedAccessToken: encAccess.encrypted,
          accessTokenIv: encAccess.iv,
          accessTokenAuthTag: encAccess.authTag,
          encryptedRefreshToken: encRefresh ? encRefresh.encrypted : null,
          refreshTokenIv: encRefresh ? encRefresh.iv : null,
          refreshTokenAuthTag: encRefresh ? encRefresh.authTag : null,
          keyVersion: encAccess.keyVersion,
          expiresAt: credentials.expiresAt,
        },
        update: {
          encryptedAccessToken: encAccess.encrypted,
          accessTokenIv: encAccess.iv,
          accessTokenAuthTag: encAccess.authTag,
          encryptedRefreshToken: encRefresh ? encRefresh.encrypted : null,
          refreshTokenIv: encRefresh ? encRefresh.iv : null,
          refreshTokenAuthTag: encRefresh ? encRefresh.authTag : null,
          keyVersion: encAccess.keyVersion,
          expiresAt: credentials.expiresAt,
        },
      });
    });
  }
}
