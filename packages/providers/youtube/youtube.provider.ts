import {
  AuthUrlInput,
  OAuthCredentials,
  SocialProfile,
  ProviderProfileResult,
  RawAccountMetrics,
  CapabilityContext,
  ProviderCapabilities,
} from '../core/types/index';
import { ISocialProvider } from '../core/interfaces/ISocialProvider';
import { 
  IPublishingProvider, 
  ProviderOptionsValidationResult, 
  ProviderPublicationInput, 
  ProviderPublishResult, 
  PublishingCapabilities,
  ProviderExecutionCredentials
} from '../core/interfaces/IPublishingProvider';
import { IMediaContentSource } from '../core/interfaces/IMediaContentSource';
import { resolveCapabilities } from '../core/capability-resolver';
import { ProviderApiError, ProviderCapabilityError } from '../core/errors/index';
import { z } from 'zod';
import { google } from 'googleapis';

export const YouTubeProviderOptionsSchema = z.object({
  privacyStatus: z.enum(['public', 'private', 'unlisted']).default('private'),
  categoryId: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).strict();

export class YouTubeProvider implements ISocialProvider, IPublishingProvider {
  private clientId: string;
  private clientSecret: string;
  private authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  private tokenUrl = 'https://oauth2.googleapis.com/token';
  private channelsUrl = 'https://youtube.googleapis.com/youtube/v3/channels';

  constructor() {
    if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
      throw new Error('YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET environment variables are required.');
    }
    this.clientId = process.env.YOUTUBE_CLIENT_ID;
    this.clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  }

  getAuthorizationUrl(input: AuthUrlInput & { codeChallenge?: string }): string {
    const ALLOWED_SCOPES = [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.upload'
    ];
    
    const scopes = new Set(['https://www.googleapis.com/auth/youtube.readonly']);
    if (input.requestedScopes) {
      input.requestedScopes.forEach(s => {
        if (!ALLOWED_SCOPES.includes(s)) {
          throw new Error(`Invalid or unauthorized OAuth scope requested: ${s}`);
        }
        scopes.add(s);
      });
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
      scope: Array.from(scopes).join(' '),
      access_type: 'offline', // needed to get a refresh token
      prompt: 'consent',
    });

    if (input.includeGrantedScopes) {
      params.append('include_granted_scopes', 'true');
    }

    if (input.codeChallenge) {
      params.append('code_challenge', input.codeChallenge);
      params.append('code_challenge_method', 'S256');
    }

    return `${this.authorizeUrl}?${params.toString()}`;
  }

  async exchangeAuthorizationCode(input: { code: string; redirectUri: string; codeVerifier?: string }): Promise<OAuthCredentials> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    if (input.codeVerifier) {
      params.append('code_verifier', input.codeVerifier);
    }

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderApiError(`Failed to exchange authorization code: ${error}`, response.status);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      scopes: data.scope ? data.scope.split(' ') : ['https://www.googleapis.com/auth/youtube.readonly'],
    };
  }

  async getProfiles(credentials: OAuthCredentials): Promise<ProviderProfileResult[]> {
    const url = new URL(this.channelsUrl);
    url.searchParams.append('part', 'snippet');
    url.searchParams.append('mine', 'true');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderApiError(`Failed to fetch YouTube channels: ${error}`, response.status);
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      return [];
    }

    return data.items.map((item: any) => ({
      profile: {
        id: item.id,
        name: item.snippet?.title || 'Unknown Channel',
        avatarUrl: item.snippet?.thumbnails?.default?.url,
      },
      provider: 'youtube',
    }));
  }

  async getAccountMetrics(credentials: OAuthCredentials, account: SocialProfile): Promise<RawAccountMetrics> {
    const url = new URL(this.channelsUrl);
    url.searchParams.append('part', 'statistics');
    url.searchParams.append('id', account.id);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
        },
        signal: controller.signal as any,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new ProviderApiError(`Failed to fetch YouTube channel statistics: ${error}`, response.status);
      }

      const data = await response.json();

      if (!data.items || data.items.length === 0) {
        return { followersCount: 0 };
      }

      const stats = data.items[0].statistics;
      return {
        followersCount: parseInt(stats.subscriberCount || '0', 10),
        viewCount: parseInt(stats.viewCount || '0', 10),
        engagement: 0,
      };
    } catch (error: any) {
      if (error.name === 'AbortError' || error.type === 'aborted') {
        throw new Error(`YouTube API request timed out after 10s for channel ${account.id}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getCapabilities(context: CapabilityContext): Promise<ProviderCapabilities> {
    const scopes = context.grantedScopes || [];
    const capabilities: ProviderCapabilities = [];
    if (scopes.includes('https://www.googleapis.com/auth/youtube.readonly')) {
      capabilities.push('ACCOUNT_READ', 'ANALYTICS_READ');
    }
    if (scopes.includes('https://www.googleapis.com/auth/youtube.upload')) {
      capabilities.push('POST_PUBLISH');
    }
    return capabilities;
  }

  getPublishingCapabilities(): PublishingCapabilities {
    return {
      contentTypes: {
        VIDEO_POST: {
          supported: true,
          maxLength: 5000,
          maxBytes: 256 * 1024 * 1024 * 1024, // 256 GB
          maxCount: 1,
          mimeTypes: ['video/*'], // Simplest representation per prompt
        },
        TEXT_POST: { supported: false },
        IMAGE_POST: { supported: false },
        MULTI_IMAGE_POST: { supported: false },
        LINK_POST: { supported: false },
        DOCUMENT_POST: { supported: false },
      },
      features: ['TITLE', 'DESCRIPTION', 'PRIVACY_STATUS', 'TAGS', 'CATEGORY'],
    };
  }

  validateProviderOptions(options: unknown): ProviderOptionsValidationResult {
    const result = YouTubeProviderOptionsSchema.safeParse(options || {});
    if (!result.success) {
      return {
        valid: false,
        issues: result.error.errors.map(e => ({
          code: 'INVALID_OPTION',
          field: e.path.join('.'),
          message: e.message,
        })),
      };
    }
    return { valid: true, issues: [] };
  }

  async publish(
    credentials: ProviderExecutionCredentials,
    input: ProviderPublicationInput,
    mediaSource?: IMediaContentSource
  ): Promise<ProviderPublishResult> {
    if (!mediaSource) {
      return {
        success: false,
        failureCategory: 'PERMANENT',
        failureCode: 'MEDIA_STORAGE_BLOCKER',
        message: 'No media storage source provided to access video bytes.',
      };
    }

    if (!input.media || input.media.length === 0) {
      return {
        success: false,
        failureCategory: 'VALIDATION',
        failureCode: 'MEDIA_REQUIRED',
        message: 'YouTube requires exactly one video.',
      };
    }

    if (input.media.length > 1) {
      return {
        success: false,
        failureCategory: 'VALIDATION',
        failureCode: 'MULTIPLE_MEDIA_UNSUPPORTED',
        message: 'YouTube only supports uploading a single video per post.',
      };
    }

    const asset = input.media[0];
    if (!asset.key) {
      return {
        success: false,
        failureCategory: 'VALIDATION',
        failureCode: 'MEDIA_KEY_MISSING',
        message: 'Media asset missing storage key.',
      };
    }

    const options = YouTubeProviderOptionsSchema.parse(input.providerOptions || {});

    // Authorize youtube client
    const oauth2Client = new google.auth.OAuth2(this.clientId, this.clientSecret);
    oauth2Client.setCredentials({ access_token: credentials.accessToken });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    let stream;
    try {
      stream = await mediaSource.getStream(asset.key);
    } catch (e: any) {
      const errorName = e.name || e.code || '';
      
      if (errorName === 'NoSuchKey' || errorName === 'NotFound') {
        return {
          success: false,
          failureCategory: 'PERMANENT',
          failureCode: 'MEDIA_OBJECT_NOT_FOUND',
          message: 'The media file could not be found in storage. It may have been deleted or not uploaded correctly.',
        };
      }

      // Generic storage unavailable (could be timeout, etc)
      return {
        success: false,
        failureCategory: 'TRANSIENT',
        failureCode: 'MEDIA_STORAGE_UNAVAILABLE',
        message: 'Could not connect to storage to retrieve media.',
      };
    }

    try {
      // Split content into title and description if we wanted to? No, the title should be provided.
      // Usually Title is a specific feature, but in this architecture `content` is the standard.
      // Let's use `content` for description, and maybe the first line for title? 
      // The prompt says: "Target MVP capability: YouTube VIDEO_POST + title + description + privacy status..."
      // But ProviderPublicationInput only has `content`. Where does title come from?
      // "authoritative title, authoritative description". Wait, if title is required, we can extract from content or pass it in providerOptions?
      // Wait, let's check PostPlatformVariant schema if it has a title.
      // No, it just has `content`. Let's use `content` up to 100 chars for title, and the rest for description. Or if providerOptions has title.
      const lines = input.content ? input.content.split('\n') : ['Untitled Video'];
      const title = (options as any).title || lines[0].substring(0, 100);
      const description = input.content || '';

      const res = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title,
            description,
            categoryId: options.categoryId,
            tags: options.tags,
          },
          status: {
            privacyStatus: options.privacyStatus,
          },
        },
        media: {
          mimeType: asset.mimeType,
          body: stream, // Consumes stream directly
        },
      });

      if (!res.data.id) {
        return {
          success: false,
          failureCategory: 'UNKNOWN_RESULT',
          failureCode: 'NO_VIDEO_ID',
          message: 'YouTube accepted the request but returned no video ID.',
        };
      }

      return {
        success: true,
        externalPostId: res.data.id,
        canonicalUrl: `https://www.youtube.com/watch?v=${res.data.id}`,
        processingState: 'PROCESSING', // videos are always processing initially
      };
    } catch (error: any) {
      // Reason extraction from googleapis
      const reason = error.errors?.[0]?.reason || error.reason;
      const status = error.code || error.status;

      // 401 Unauthorized
      if (status === 401) {
        return {
          success: false,
          failureCategory: 'AUTH_REQUIRED',
          failureCode: 'YOUTUBE_AUTH_REQUIRED',
          message: 'Invalid or expired authorization. Please reconnect your account.',
        };
      }

      // 429 Too Many Requests
      if (status === 429) {
        return {
          success: false,
          failureCategory: 'RATE_LIMITED',
          failureCode: 'YOUTUBE_RATE_LIMITED',
          message: 'YouTube rate limit exceeded.',
          retryAfterSeconds: error.response?.headers?.['retry-after'] ? parseInt(error.response.headers['retry-after'], 10) : undefined,
        };
      }

      // 403 Forbidden
      if (status === 403) {
        if (reason === 'quotaExceeded') {
          return {
            success: false,
            failureCategory: 'RATE_LIMITED',
            failureCode: 'YOUTUBE_QUOTA_EXHAUSTED',
            message: 'YouTube API quota exhausted.',
          };
        }
        if (reason === 'insufficientPermissions') {
          return {
            success: false,
            failureCategory: 'AUTH_REQUIRED',
            failureCode: 'PROVIDER_SCOPE_REQUIRED',
            message: 'Insufficient permissions. Please reconnect and grant YouTube publish access.',
          };
        }
        
        // generic forbidden
        return {
          success: false,
          failureCategory: 'AUTH_REQUIRED', // Conservative classification
          failureCode: 'YOUTUBE_UPLOAD_FORBIDDEN',
          message: 'Upload forbidden by YouTube (could be channel restriction or permission issue).',
        };
      }

      // 400 Bad Request / Validation
      if (status >= 400 && status < 500) {
        return {
          success: false,
          failureCategory: 'VALIDATION',
          failureCode: 'YOUTUBE_INVALID_METADATA',
          message: 'YouTube rejected the video metadata or format.',
        };
      }

      // 5xx or network errors -> UNKNOWN_RESULT
      return {
        success: false,
        failureCategory: 'UNKNOWN_RESULT',
        failureCode: 'YOUTUBE_UPLOAD_OUTCOME_UNKNOWN',
        message: 'Unknown outcome due to network or server error. Cannot safely retry without verification.',
      };
    }
  }
}
