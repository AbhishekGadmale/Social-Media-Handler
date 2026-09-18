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
  decrypt,
  generateId,
  SocialProvider,
  SocialAccountStatus,
} from '@agency-os/database';
import { providerRegistry } from '@agency-os/providers';
import { OAuthStateSchema } from '@agency-os/shared';
import crypto from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OAuthCallbackResult, DiscoverySession } from './oauth-discovery.types';

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

  async storeDiscovery(session: DiscoverySession): Promise<void> {
    const serialized = JSON.stringify(session);
    const encrypted = encrypt(serialized);
    const key = `oauth:discovery:${session.discoveryId}`;
    await this.redis.set(key, JSON.stringify(encrypted), 'EX', 900);
  }

  async readDiscovery(discoveryId: string): Promise<DiscoverySession | null> {
    const key = `oauth:discovery:${discoveryId}`;
    const dataStr = await this.redis.get(key);
    if (!dataStr) return null;
    try {
      const encrypted = JSON.parse(dataStr);
      const decrypted = decrypt(encrypted);
      return JSON.parse(decrypted) as DiscoverySession;
    } catch {
      return null;
    }
  }

  async claimDiscovery(
    discoveryId: string,
    expectedDataStr: string,
  ): Promise<boolean> {
    const key = `oauth:discovery:${discoveryId}`;
    const script = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;
    const result = await this.redis.eval(script, 1, key, expectedDataStr);
    return result === 1;
  }

  async processDiscoverySelection(
    discoveryId: string,
    workspaceId: string,
    userId: string,
    profileIds: string[],
  ): Promise<Array<{ accountId: string; isNew: boolean; provider: string }>> {
    const key = `oauth:discovery:${discoveryId}`;
    const dataStr = await this.redis.get(key);

    if (!dataStr) {
      throw new ForbiddenException(
        'Discovery session not found or already consumed',
      );
    }

    let session: DiscoverySession;
    try {
      const encrypted = JSON.parse(dataStr);
      const decrypted = decrypt(encrypted);
      session = JSON.parse(decrypted);
    } catch {
      throw new ForbiddenException('Invalid discovery session');
    }

    if (session.userId !== userId || session.workspaceId !== workspaceId) {
      throw new ForbiddenException('Discovery session ownership mismatch');
    }

    const claimed = await this.claimDiscovery(discoveryId, dataStr);
    if (!claimed) {
      throw new ForbiddenException(
        'Discovery session was modified or consumed concurrently',
      );
    }

    // Now we own it. Verify selected IDs.
    const selectedProfiles = session.profiles.filter((p) =>
      profileIds.includes(p.profile.id),
    );
    if (selectedProfiles.length === 0) {
      throw new BadRequestException('No valid profiles selected');
    }

    const provider = providerRegistry.get(session.provider.toLowerCase());
    if (!provider) {
      throw new BadRequestException('Provider not supported');
    }

    // Prepare batch upsert
    const accountsToUpsert = [];

    for (const entry of selectedProfiles) {
      const p = entry.profile;
      const creds = entry.credentials || session.sharedCredentials;

      const capabilities =
        (await provider.getCapabilities?.({
          provider: session.provider,
          grantedScopes: creds.scopes || [],
          externalId: p.id,
        })) || [];

      const encAccess = encrypt(creds.accessToken);
      let encRefresh = null;
      if (creds.refreshToken) {
        encRefresh = encrypt(creds.refreshToken);
      }

      accountsToUpsert.push({
        accountData: {
          id: generateId(),
          provider: session.provider,
          externalId: p.id,
          name: p.name,
          capabilities,
          status: SocialAccountStatus.ACTIVE,
        },
        connectionData: {
          id: generateId(),
          encryptedAccessToken: encAccess.encrypted,
          accessTokenIv: encAccess.iv,
          accessTokenAuthTag: encAccess.authTag,
          encryptedRefreshToken: encRefresh ? encRefresh.encrypted : null,
          refreshTokenIv: encRefresh ? encRefresh.iv : null,
          refreshTokenAuthTag: encRefresh ? encRefresh.authTag : null,
          keyVersion: encAccess.keyVersion,
          expiresAt: creds.expiresAt,
          grantedScopes: creds.scopes,
        },
      });
    }

    try {
      const results = await this.socialAccountRepo.upsertManyWithConnection(
        workspaceId,
        accountsToUpsert,
      );

      // Enqueue sync jobs AFTER successful transaction
      for (const res of results) {
        try {
          await this.syncQueue.add(
            'sync-account',
            {
              socialAccountId: res.account.id,
              workspaceId,
            },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 1000 },
              jobId: `initial-sync-${res.account.id}-${Date.now()}`,
            },
          );
        } catch (err) {
          this.logger.error(
            `Failed to enqueue initial sync for account ${res.account.id}`,
            err,
          );
        }
      }
      return results.map((r) => ({
        accountId: r.account.id,
        isNew: r.isNew,
        provider: session.provider,
      }));
    } catch (err) {
      // Restore on DB failure so user can retry, calculate remaining TTL
      const remainingTtl =
        900 - Math.floor((Date.now() - session.createdAt) / 1000);
      if (remainingTtl > 0) {
        await this.redis.set(key, dataStr, 'EX', remainingTtl, 'NX');
      }
      throw err;
    }
  }

  async handleOAuthCallback(
    providerName: SocialProvider,
    userId: string,
    state: string,
    code: string,
    redirectUri: string,
  ): Promise<OAuthCallbackResult> {
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

    if (profiles.length > 1) {
      const discoveryId = crypto.randomUUID();
      const session: DiscoverySession = {
        discoveryId,
        workspaceId,
        userId,
        provider: validProviderEnum,
        sharedCredentials: credentials,
        profiles: profiles.map((p) => ({ profile: p })),
        createdAt: Date.now(),
      };
      await this.storeDiscovery(session);
      return { requiresSelection: true, workspaceId, discoveryId };
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
          status: SocialAccountStatus.ACTIVE,
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

    return {
      requiresSelection: false,
      workspaceId,
      socialAccountId: account.id,
      isNew,
    };
  }
}
