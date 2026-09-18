import {
  AuthUrlInput,
  OAuthCredentials,
  CapabilityContext,
  ProviderCapabilities,
  ProviderProfileResult,
} from '../core/types/index';
import { ISocialProvider } from '../core/interfaces/ISocialProvider';
import { ProviderApiError } from '../core/errors/index';

export class MetaProvider implements ISocialProvider {
  private readonly version = 'v20.0';
  private readonly baseUrl = 'https://graph.facebook.com';
  
  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 10000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal as any });
      clearTimeout(id);
      return response;
    } catch (err: any) {
      clearTimeout(id);
      throw new ProviderApiError('Network error during Meta API request: ' + err.message, 0);
    }
  }

  getAuthorizationUrl(input: AuthUrlInput): string {
    const scopes = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'instagram_basic',
      'instagram_content_publish',
    ].join(',');

    const clientId = process.env.META_CLIENT_ID;
    if (!clientId) throw new Error('META_CLIENT_ID is not configured');

    const url = new URL(`https://www.facebook.com/${this.version}/dialog/oauth`);
    url.searchParams.append('client_id', clientId);
    url.searchParams.append('redirect_uri', input.redirectUri);
    url.searchParams.append('state', input.state);
    url.searchParams.append('scope', scopes);
    url.searchParams.append('response_type', 'code');

    return url.toString();
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OAuthCredentials> {
    const clientId = process.env.META_CLIENT_ID;
    const clientSecret = process.env.META_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Meta credentials are not configured');

    const tokenUrl = new URL(`${this.baseUrl}/${this.version}/oauth/access_token`);
    tokenUrl.searchParams.append('client_id', clientId);
    tokenUrl.searchParams.append('client_secret', clientSecret);
    tokenUrl.searchParams.append('redirect_uri', input.redirectUri);
    tokenUrl.searchParams.append('code', input.code);

    const tokenRes = await this.fetchWithTimeout(tokenUrl.toString(), { method: 'GET' });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      throw new ProviderApiError(
        'Failed to exchange authorization code: ' + (tokenData.error?.message || 'Unknown error'),
        tokenRes.status
      );
    }

    const shortLivedToken = tokenData.access_token;
    if (!shortLivedToken) throw new ProviderApiError('No access token returned', 500);

    const exchangeUrl = new URL(`${this.baseUrl}/${this.version}/oauth/access_token`);
    exchangeUrl.searchParams.append('grant_type', 'fb_exchange_token');
    exchangeUrl.searchParams.append('client_id', clientId);
    exchangeUrl.searchParams.append('client_secret', clientSecret);
    exchangeUrl.searchParams.append('fb_exchange_token', shortLivedToken);

    const exchangeRes = await this.fetchWithTimeout(exchangeUrl.toString(), { method: 'GET' });
    const exchangeData = await exchangeRes.json();

    if (!exchangeRes.ok) {
      throw new ProviderApiError(
        'Failed to exchange for long-lived token: ' + (exchangeData.error?.message || 'Unknown error'),
        exchangeRes.status
      );
    }

    const longLivedToken = exchangeData.access_token;
    if (!longLivedToken) throw new ProviderApiError('No long-lived access token returned', 500);

    return {
      accessToken: longLivedToken,
      expiresAt: exchangeData.expires_in ? new Date(Date.now() + exchangeData.expires_in * 1000) : undefined,
      scopes: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
        'instagram_basic',
        'instagram_content_publish',
      ]
    };
  }

  async getProfiles(credentials: OAuthCredentials): Promise<ProviderProfileResult[]> {
    if (!credentials.accessToken) {
      throw new Error('Access token required to fetch profiles');
    }

    const fields = 'id,name,access_token,picture.type(large),instagram_business_account{id,name,username,profile_picture_url}';
    const accountsUrl = new URL(`${this.baseUrl}/${this.version}/me/accounts`);
    accountsUrl.searchParams.append('fields', fields);
    accountsUrl.searchParams.append('access_token', credentials.accessToken);

    const res = await this.fetchWithTimeout(accountsUrl.toString(), { method: 'GET' });
    const data = await res.json();

    if (!res.ok) {
      let safeMessage = data.error?.message || 'Unknown error';
      safeMessage = safeMessage.replace(credentials.accessToken, '***');
      throw new ProviderApiError('Failed to fetch user accounts: ' + safeMessage, res.status);
    }

    const profiles: ProviderProfileResult[] = [];

    if (!data.data || !Array.isArray(data.data)) {
      return profiles;
    }

    for (const page of data.data) {
      if (page.id && page.name && page.access_token) {
        profiles.push({
          profile: {
            id: page.id,
            name: page.name,
            avatarUrl: page.picture?.data?.url,
            provider: 'FACEBOOK',
          },
          credentials: {
            accessToken: page.access_token,
            scopes: credentials.scopes,
          }
        });

        if (page.instagram_business_account && page.instagram_business_account.id) {
          const ig = page.instagram_business_account;
          profiles.push({
            profile: {
              id: ig.id,
              name: ig.name || ig.username || 'Instagram Account',
              username: ig.username,
              avatarUrl: ig.profile_picture_url,
              provider: 'INSTAGRAM',
            },
            credentials: {
              accessToken: page.access_token,
              scopes: credentials.scopes,
            }
          });
        }
      }
    }

    return profiles;
  }

  async getCapabilities(context: CapabilityContext): Promise<ProviderCapabilities> {
    const capabilities: ProviderCapabilities = ['ACCOUNT_READ'];
    const scopes = context.grantedScopes || [];
    
    if (context.provider === 'FACEBOOK' && scopes.includes('pages_manage_posts')) {
      capabilities.push('POST_PUBLISH');
    }
    
    if (context.provider === 'INSTAGRAM' && scopes.includes('instagram_content_publish')) {
      capabilities.push('POST_PUBLISH');
    }

    return capabilities;
  }
}
