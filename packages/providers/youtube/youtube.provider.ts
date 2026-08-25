import {
  AuthUrlInput,
  OAuthCredentials,
  SocialProfile,
  RawAccountMetrics,
  CapabilityContext,
  ProviderCapabilities,
} from '../core/types/index.js';
import { ISocialProvider } from '../core/interfaces/ISocialProvider.js';
import { resolveCapabilities } from '../core/capability-resolver.js';
import { ProviderApiError } from '../core/errors/index.js';

/**
 * Note on YouTube Quota Limits:
 * YouTube Data API quota is shared per Google Cloud project across ALL connected channels,
 * not per-token like LinkedIn. This is important for the sync scheduler implementation
 * in Phase 5 to consider (e.g. batching or staggering syncs to avoid quota exhaustion).
 */
export class YouTubeProvider implements ISocialProvider {
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
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'offline', // needed to get a refresh token
      prompt: 'consent',
    });

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

  async getProfiles(credentials: OAuthCredentials): Promise<SocialProfile[]> {
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
      id: item.id,
      name: item.snippet?.title || 'Unknown Channel',
      avatarUrl: item.snippet?.thumbnails?.default?.url,
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
        signal: controller.signal as any, // Node fetch accepts this
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
    return capabilities;
  }

  // OMIT publishPost, getPostMetrics, deletePost
}
