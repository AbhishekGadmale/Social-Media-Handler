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

  private sanitizeErrorMessage(msg: string, literalToken?: string): string {
    let safe = (msg || '')
      .replace(/access_token=[^&\s'"]+/g, 'access_token=***')
      .replace(/client_secret=[^&\s'"]+/g, 'client_secret=***')
      .replace(/appsecret_proof=[^&\s'"]+/g, 'appsecret_proof=***')
      .replace(/code=[^&\s'"]+/g, 'code=***');
    if (literalToken) {
      // safely replace literal token
      safe = safe.split(literalToken).join('***');
    }
    return safe;
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 10000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal as any });
      clearTimeout(id);
      return response;
    } catch (err: any) {
      clearTimeout(id);
      throw new ProviderApiError('Network error during Meta API request: ' + this.sanitizeErrorMessage(err.message), 0);
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
    let nextUrl: string | undefined = `${this.baseUrl}/${this.version}/me/accounts?fields=${fields}&access_token=${credentials.accessToken}`;

    const profiles: ProviderProfileResult[] = [];
    const seenFacebookIds = new Set<string>();
    const seenInstagramIds = new Set<string>();
    const visitedUrls = new Set<string>();

    let pageCount = 0;
    const MAX_PAGES = 10;

    while (nextUrl) {
      if (pageCount >= MAX_PAGES) {
        throw new ProviderApiError('Maximum pagination limit reached', 400);
      }

      // Domain validation to prevent SSRF
      let urlObj: URL;
      try {
        urlObj = new URL(nextUrl);
      } catch (err) {
        throw new ProviderApiError('Invalid pagination URL format', 400);
      }

      if (urlObj.origin !== this.baseUrl) {
        throw new ProviderApiError('Invalid pagination URL', 400);
      }

      // Detect loops safely without token leakage
      const urlWithoutToken = new URL(nextUrl);
      urlWithoutToken.searchParams.delete('access_token');
      const safeUrlStr = urlWithoutToken.toString();

      if (visitedUrls.has(safeUrlStr)) {
        throw new ProviderApiError('Pagination loop detected', 400);
      }
      visitedUrls.add(safeUrlStr);
      pageCount++;

      const res = await this.fetchWithTimeout(nextUrl, { method: 'GET', redirect: 'error' });
      const data = await res.json();

      if (!res.ok) {
        let rawMsg = data.error?.message || 'Unknown error';
        throw new ProviderApiError('Failed to fetch user accounts: ' + this.sanitizeErrorMessage(rawMsg, credentials.accessToken), res.status);
      }

      if (!data || typeof data !== 'object') {
        throw new ProviderApiError('Malformed Meta response: not an object', 500);
      }
      if (!data.data || !Array.isArray(data.data)) {
        throw new ProviderApiError('Malformed Meta response: data is missing or not an array', 500);
      }
      if (data.paging && typeof data.paging !== 'object') {
        throw new ProviderApiError('Malformed Meta response: paging is not an object', 500);
      }
      if (data.paging?.next !== undefined && typeof data.paging.next !== 'string') {
        throw new ProviderApiError('Malformed Meta response: paging.next is not a string', 500);
      }

      for (const page of data.data) {
          if (page.id && page.name && page.access_token) {
            if (!seenFacebookIds.has(page.id)) {
              seenFacebookIds.add(page.id);
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
            }

            if (page.instagram_business_account && page.instagram_business_account.id) {
              const ig = page.instagram_business_account;
              if (!seenInstagramIds.has(ig.id)) {
                seenInstagramIds.add(ig.id);
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
        }

      nextUrl = data.paging?.next;
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
