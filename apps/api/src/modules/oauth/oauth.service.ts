import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import Redis from 'ioredis';
import {
  SocialAccountRepository,
  encrypt,
  generateId,
  SocialProvider,
} from '@agency-os/database';
import { providerRegistry } from '@agency-os/providers';
import { OAuthStateSchema } from '@agency-os/shared';
import crypto from 'node:crypto';

@Injectable()
export class OAuthService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly socialAccountRepo: SocialAccountRepository,
  ) {}

  private validateProvider(providerName: string): SocialProvider {
    const normalized = providerName.toUpperCase();
    if (!Object.values(SocialProvider).includes(normalized as SocialProvider)) {
      throw new BadRequestException(
        `Provider ${providerName} is not a valid SocialProvider`,
      );
    }
    return normalized as SocialProvider;
  }

  async generateAuthUrl(
    providerName: string,
    userId: string,
    workspaceId: string,
    redirectUri: string,
  ): Promise<string> {
    const provider = providerRegistry.get(providerName);
    if (!provider) {
      throw new BadRequestException(
        `Provider ${providerName} is not supported`,
      );
    }

    const validProviderEnum = this.validateProvider(providerName);

    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const stateData = {
      userId,
      workspaceId,
      provider: validProviderEnum,
      codeVerifier,
      createdAt: new Date().toISOString(),
    };

    // TTL 5 minutes
    await this.redis.set(
      `oauth_state:${state}`,
      JSON.stringify(stateData),
      'EX',
      300,
    );

    return provider.getAuthorizationUrl({
      workspaceId,
      redirectUri,
      state,
      codeChallenge,
    });
  }

  async handleOAuthCallback(
    providerName: string,
    userId: string,
    state: string,
    code: string,
    redirectUri: string,
  ): Promise<void> {
    const provider = providerRegistry.get(providerName);
    if (!provider) {
      throw new BadRequestException(
        `Provider ${providerName} is not supported`,
      );
    }

    const stateKey = `oauth_state:${state}`;
    const stateDataStr = await this.redis.get(stateKey);

    if (!stateDataStr) {
      throw new ForbiddenException('Invalid or expired state');
    }

    // single-use deletion
    await this.redis.del(stateKey);

    const parsed = OAuthStateSchema.safeParse(JSON.parse(stateDataStr));
    if (!parsed.success) {
      throw new ForbiddenException('Invalid or corrupted state data');
    }
    const stateData = parsed.data;
    const validProviderEnum = this.validateProvider(providerName);

    if (stateData.userId !== userId) {
      throw new ForbiddenException('State userId mismatch');
    }

    if (stateData.provider !== validProviderEnum) {
      throw new BadRequestException('State provider mismatch');
    }

    const { workspaceId, codeVerifier } = stateData;

    // Exchange code
    const credentials = await provider.exchangeAuthorizationCode({
      code,
      redirectUri,
      codeVerifier,
    });

    // Get profiles
    const profiles = await provider.getProfiles(credentials);
    if (!profiles.length) {
      throw new BadRequestException(
        `No profiles returned from ${providerName}`,
      );
    }
    const profile = profiles[0];

    // Capabilities
    const capabilities =
      (await provider.getCapabilities?.({
        provider: providerName,
        grantedScopes: credentials.scopes || [],
      })) || [];

    // Encrypt tokens separately
    const encAccess = encrypt(credentials.accessToken);
    let encRefresh = null;
    if (credentials.refreshToken) {
      encRefresh = encrypt(credentials.refreshToken);
    }

    // Save to DB
    await this.socialAccountRepo.upsertWithConnection(
      workspaceId,
      {
        id: generateId(),
        provider: validProviderEnum,
        externalId: profile.id,
        name: profile.name,
        capabilities,
        status: 'ACTIVE',
      },
      {
        id: generateId(),
        encryptedAccessToken: encAccess.encrypted,
        accessTokenIv: encAccess.iv,
        accessTokenAuthTag: encAccess.authTag,
        encryptedRefreshToken: encRefresh ? encRefresh.encrypted : null,
        refreshTokenIv: encRefresh ? encRefresh.iv : null,
        refreshTokenAuthTag: encRefresh ? encRefresh.authTag : null,
        keyVersion: encAccess.keyVersion,
        expiresAt: credentials.expiresAt,
      },
    );
  }
}
