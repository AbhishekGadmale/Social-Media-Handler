import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SyncJobData } from '@agency-os/shared';
import Redis from 'ioredis';
import {
  SocialAccountRepository,
  encrypt,
  decrypt,
  generateId,
  SocialProvider,
  SocialAccountStatus,
  AuditLogRepository,
  AuditAction,
} from '@agency-os/database';
import { providerRegistry } from '@agency-os/providers';
import { OAuthStateSchema } from '@agency-os/shared';
import crypto from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OAuthCallbackResult, DiscoverySession } from './oauth-discovery.types';
import { EntitlementsService } from '../billing/entitlements.service';
import { AuditService } from '../core/audit.service';

@Injectable()
export class OAuthService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly socialAccountRepo: SocialAccountRepository,
    @InjectQueue('sync') private readonly syncQueue: Queue,
    @InjectPinoLogger(OAuthService.name)
    private readonly logger: PinoLogger,
    private readonly entitlementsService: EntitlementsService,
    @Optional() private readonly auditLogRepo?: AuditLogRepository,
    @Optional() private readonly auditService?: AuditService,
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
    correlationId?: string,
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

      const profileProvider = p.provider
        ? (p.provider.toUpperCase() as SocialProvider)
        : session.provider;

      const capabilities =
        (await provider.getCapabilities?.({
          provider: profileProvider,
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
          provider: profileProvider,
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
      // Check social account limit for genuinely new profiles (all-or-nothing)
      let newCount = 0;
      for (const entry of selectedProfiles) {
        const p = entry.profile;
        const profileProvider = p.provider
          ? (p.provider.toUpperCase() as SocialProvider)
          : session.provider;

        const existing =
          await this.socialAccountRepo.findByProviderAndExternalId(
            profileProvider,
            p.id,
          );
        if (!existing) {
          newCount++;
        }
      }

      if (newCount > 0) {
        await this.entitlementsService.assertSocialAccountLimit(
          workspaceId,
          newCount,
        );
      }

      const results = await this.socialAccountRepo.upsertManyWithConnection(
        workspaceId,
        accountsToUpsert,
      );

      // Enqueue sync jobs AFTER successful transaction
      for (const res of results) {
        try {
          const syncPayload: SyncJobData = {
            socialAccountId: res.account.id,
            workspaceId,
            ...(correlationId ? { correlationId } : {}),
          };
          await this.syncQueue.add('sync-account', syncPayload, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            jobId: `initial-sync-${res.account.id}-${Date.now()}`,
          });
        } catch (err) {
          this.logger.error(
            {
              err,
              socialAccountId: res.account.id,
              workspaceId,
              ...(correlationId ? { correlationId } : {}),
            },
            'Failed to enqueue initial sync for account',
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
    correlationId?: string,
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

    await this.entitlementsService.assertWorkspaceWritable(workspaceId);

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
        profiles,
        createdAt: Date.now(),
      };
      await this.storeDiscovery(session);
      return { requiresSelection: true, workspaceId, discoveryId };
    }

    const profile = profiles[0].profile;

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

    // Check social account limit ONLY for new accounts
    const existing = await this.socialAccountRepo.findByProviderAndExternalId(
      validProviderEnum,
      profile.id,
    );
    if (!existing) {
      await this.entitlementsService.assertSocialAccountLimit(workspaceId, 1);
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
      const syncPayload: SyncJobData = {
        socialAccountId: account.id,
        workspaceId,
        ...(correlationId ? { correlationId } : {}),
      };
      await this.syncQueue.add('sync-account', syncPayload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        jobId: `initial-sync-${account.id}-${Date.now()}`,
      });
      this.logger.info(
        {
          socialAccountId: account.id,
          workspaceId,
          provider: validProviderEnum,
          ...(correlationId ? { correlationId } : {}),
        },
        'Enqueued initial sync job for account',
      );
    } catch (err) {
      // Do not fail the OAuth connection if the queue add fails
      this.logger.error(
        {
          err,
          socialAccountId: account.id,
          workspaceId,
          provider: validProviderEnum,
          ...(correlationId ? { correlationId } : {}),
        },
        'Failed to enqueue initial sync for account',
      );
    }

    return {
      requiresSelection: false,
      workspaceId,
      socialAccountId: account.id,
      isNew,
    };
  }

  parseAndVerifySignedRequest(
    signedRequest: string,
    appSecret: string,
  ): { user_id: string; algorithm: string; issued_at?: number } {
    if (!signedRequest || typeof signedRequest !== 'string') {
      throw new BadRequestException('Malformed signed_request');
    }

    const parts = signedRequest.split('.');
    if (parts.length !== 2) {
      throw new BadRequestException(
        'Malformed signed_request: expected signature.payload',
      );
    }

    const [encodedSig, payloadStr] = parts;
    if (!encodedSig || !payloadStr) {
      throw new BadRequestException(
        'Malformed signed_request: missing signature or payload',
      );
    }

    let payload: { user_id?: string; algorithm?: string; issued_at?: number };
    try {
      const payloadJson = Buffer.from(payloadStr, 'base64url').toString('utf8');
      payload = JSON.parse(payloadJson);
    } catch {
      throw new BadRequestException('Invalid signed_request payload JSON');
    }

    if (payload.algorithm?.toUpperCase() !== 'HMAC-SHA256') {
      throw new BadRequestException('Unsupported algorithm in signed_request');
    }

    const sigBuffer = Buffer.from(encodedSig, 'base64url');
    const expectedSigBuffer = crypto
      .createHmac('sha256', appSecret)
      .update(payloadStr)
      .digest();

    if (
      sigBuffer.length !== expectedSigBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedSigBuffer)
    ) {
      throw new BadRequestException('Invalid signed_request signature');
    }

    if (!payload.user_id || typeof payload.user_id !== 'string') {
      throw new BadRequestException(
        'Missing user_id in signed_request payload',
      );
    }

    return {
      user_id: payload.user_id,
      algorithm: payload.algorithm,
      issued_at: payload.issued_at,
    };
  }

  async handleMetaDataDeletion(
    signedRequest: string,
    reqContext?: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<{ url: string; confirmation_code: string }> {
    const appSecret = process.env.META_CLIENT_SECRET;
    if (!appSecret) {
      this.logger.error(
        'Meta app secret (META_CLIENT_SECRET) is not configured',
      );
      throw new InternalServerErrorException(
        'Meta credentials are not configured',
      );
    }

    const { user_id } = this.parseAndVerifySignedRequest(
      signedRequest,
      appSecret,
    );

    const confirmationCode = `del_${crypto.randomBytes(16).toString('hex')}`;
    let accountsDeletedCount = 0;
    let deletedAccountIds: string[] = [];

    if (this.socialAccountRepo) {
      deletedAccountIds =
        await this.socialAccountRepo.deleteByProviderAndExternalId(
          [SocialProvider.FACEBOOK, SocialProvider.INSTAGRAM],
          user_id,
        );
      accountsDeletedCount = deletedAccountIds.length;
    }

    const deletionRecord = {
      confirmationCode,
      userId: user_id,
      status: 'COMPLETED',
      accountsDeleted: accountsDeletedCount,
      requestedAt: new Date().toISOString(),
    };

    // Store in Redis with 90-day TTL (7,776,000 seconds)
    await this.redis.set(
      `meta_data_deletion:${confirmationCode}`,
      JSON.stringify(deletionRecord),
      'EX',
      90 * 24 * 60 * 60,
    );

    if (this.auditService) {
      this.auditService.logActionBestEffort({
        action: AuditAction.META_DATA_DELETION,
        actorId: undefined,
        targetType: 'MetaUser',
        targetId: user_id,
        requestId: reqContext?.requestId,
        ipAddress: reqContext?.ip,
        userAgent: reqContext?.userAgent,
        metadata: {
          confirmationCode,
          accountsDeletedCount,
          deletedAccountIds,
        },
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const statusUrl = `${frontendUrl}/data-deletion?code=${confirmationCode}`;

    this.logger.info(
      {
        userId: user_id,
        confirmationCode,
        accountsDeletedCount,
      },
      'Meta data deletion request executed successfully',
    );

    return {
      url: statusUrl,
      confirmation_code: confirmationCode,
    };
  }

  async getMetaDataDeletionStatus(confirmationCode: string) {
    if (!confirmationCode || typeof confirmationCode !== 'string') {
      throw new BadRequestException('Invalid confirmation code');
    }

    const cached = await this.redis.get(
      `meta_data_deletion:${confirmationCode}`,
    );
    if (cached) {
      try {
        const data = JSON.parse(cached);
        return {
          confirmation_code: data.confirmationCode,
          status: data.status,
          requested_at: data.requestedAt,
          accounts_deleted: data.accountsDeleted,
        };
      } catch {
        // Fall back to database query
      }
    }

    if (this.auditLogRepo) {
      const log = await this.auditLogRepo.findByActionAndConfirmationCode(
        AuditAction.META_DATA_DELETION,
        confirmationCode,
      );

      if (log) {
        return {
          confirmation_code: confirmationCode,
          status: 'COMPLETED',
          requested_at: log.createdAt.toISOString(),
          accounts_deleted: (log.metadata as any)?.accountsDeletedCount ?? 0,
        };
      }
    }

    throw new NotFoundException('Data deletion request not found');
  }
}
