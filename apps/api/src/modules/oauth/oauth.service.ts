import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  Logger,
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
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly socialAccountRepo: SocialAccountRepository,
    @InjectQueue('sync') private readonly syncQueue: Queue,
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
    providerName: SocialProvider,
    userId: string,
    workspaceId: string,
    redirectUri: string,
    requestedScopes?: string[],
  ): Promise<string> {
    const provider = providerRegistry.get(providerName.toLowerCase());
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
      requestedScopes,
      includeGrantedScopes: true,
    });
  }

  async handleOAuthCallback(
    providerName: SocialProvider,
    userId: string,
    state: string,
    code: string,
    redirectUri: string,
  ): Promise<{ workspaceId: string; socialAccountId: string; isNew: boolean }> {
    const provider = providerRegistry.get(providerName.toLowerCase());
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
        externalId: profile.id,
      })) || [];

    // Encrypt tokens separately
    const encAccess = encrypt(credentials.accessToken);
    let encRefresh = null;
    if (credentials.refreshToken) {
      encRefresh = encrypt(credentials.refreshToken);
    }

    // Save to DB
    const { account, isNew } =
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
          grantedScopes: credentials.scopes,
        },
      );

    try {
      await this.syncQueue.add(
        'sync-account',
        {
          socialAccountId: account.id,
          workspaceId,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          jobId: `initial-sync-${account.id}-${Date.now()}`,
        },
      );
      this.logger.log(`Enqueued initial sync job for account ${account.id}`);
    } catch (err) {
      // Do not fail the OAuth connection if the queue add fails
      this.logger.error(
        `Failed to enqueue initial sync for account ${account.id}`,
        err,
      );
    }

    // ... then the service proceeds ...
    return { workspaceId, socialAccountId: account.id, isNew };
  }
}
