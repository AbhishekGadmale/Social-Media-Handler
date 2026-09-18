import {
  AuthUrlInput,
  OAuthCredentials,
  SocialProfile,
  CapabilityContext,
  ProviderCapabilities,
} from '../core/types/index';
import { ISocialProvider } from '../core/interfaces/ISocialProvider';

export class MetaProvider implements ISocialProvider {
  getAuthorizationUrl(input: AuthUrlInput): string {
    const scopes = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'instagram_basic',
      'instagram_content_publish',
    ].join(',');

    const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    url.searchParams.append('client_id', process.env.META_CLIENT_ID || 'mock_client');
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
    if (input.code === 'invalid_code') {
      throw new Error('Invalid authorization code');
    }

    return {
      accessToken: 'mock_long_lived_user_token',
      scopes: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
        'instagram_basic',
        'instagram_content_publish',
      ],
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60),
    };
  }

  async getProfiles(credentials: OAuthCredentials): Promise<SocialProfile[]> {
    if (!credentials.accessToken) {
      throw new Error('Access token required to fetch profiles');
    }

    if (credentials.accessToken === 'mock_long_lived_user_token') {
      return [
        {
          id: 'page_123',
          name: 'My Facebook Page',
          username: 'myfbpage',
          avatarUrl: 'https://graph.facebook.com/page_123/picture',
          provider: 'facebook',
        },
        {
          id: 'ig_456',
          name: 'My IG Professional',
          username: 'myigprof',
          avatarUrl: 'https://graph.facebook.com/ig_456/picture',
          provider: 'instagram',
        },
        {
          id: 'page_789',
          name: 'My Second Page (No IG)',
          username: 'myfbpage2',
          avatarUrl: 'https://graph.facebook.com/page_789/picture',
          provider: 'facebook',
        }
      ];
    }

    if (credentials.accessToken === 'mock_empty') {
      return [];
    }

    throw new Error('Graph API error');
  }

  async getCapabilities(context: CapabilityContext): Promise<ProviderCapabilities> {
    const hasFbPublish = context.grantedScopes.includes('pages_manage_posts');
    const hasIgPublish = context.grantedScopes.includes('instagram_content_publish');

    const capabilities: any[] = ['ACCOUNT_READ'];

    if (context.externalId && context.externalId.startsWith('page_') && hasFbPublish) {
      capabilities.push('POST_PUBLISH');
    }

    if (context.externalId && context.externalId.startsWith('ig_') && hasIgPublish) {
      capabilities.push('POST_PUBLISH');
    }

    return capabilities;
  }
}
