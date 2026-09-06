import { ISocialProvider } from '../../interfaces/ISocialProvider';
import {
  AuthUrlInput,
  OAuthCredentials,
  SocialProfile,
  RawAccountMetrics,
} from '../../types/index';

export class MockLimitedProvider implements ISocialProvider {
  getAuthorizationUrl(input: AuthUrlInput): string {
    return `https://mock.provider.com/auth?client_id=123&redirect_uri=${encodeURIComponent(
      input.redirectUri
    )}&state=${input.state}`;
  }

  async exchangeAuthorizationCode(input: { code: string; redirectUri: string }): Promise<OAuthCredentials> {
    if (input.code === 'bad_code') {
      throw new Error('Invalid code'); // This could be mapped to a ProviderAuthError
    }
    return {
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      scopes: ['read:account'],
    };
  }

  async getProfiles(credentials: OAuthCredentials): Promise<SocialProfile[]> {
    return [
      {
        id: 'mock_user_1',
        name: 'Mock User',
        username: 'mockuser',
      },
    ];
  }

  async getAccountMetrics(credentials: OAuthCredentials, account: SocialProfile): Promise<RawAccountMetrics> {
    return {
      followersCount: 1000,
      followingCount: 500,
      engagement: 50,
    };
  }

  // Notice: publishPost, deletePost, getPostMetrics, getCapabilities, handleWebhook are INTENTIONALLY OMITTED.
  // This validates the optional method mechanism.
}

export class MockFullProvider implements ISocialProvider {
  getAuthorizationUrl(input: AuthUrlInput): string {
    return 'https://mock.provider.com/auth';
  }

  async exchangeAuthorizationCode(input: { code: string; redirectUri: string }): Promise<OAuthCredentials> {
    return { accessToken: 'mock_access_token' };
  }

  async getProfiles(credentials: OAuthCredentials): Promise<SocialProfile[]> {
    return [{ id: 'mock_user_1', name: 'Mock User' }];
  }

  async getAccountMetrics(credentials: OAuthCredentials, account: SocialProfile): Promise<RawAccountMetrics> {
    return { followersCount: 100 };
  }

  async publishPost(credentials: OAuthCredentials, payload: any) {
    return { externalPostId: 'mock_post_1' };
  }

  async deletePost(credentials: OAuthCredentials, externalPostId: string): Promise<void> {
    // Delete successful
  }

  async getPostMetrics(credentials: OAuthCredentials, post: any) {
    return { likes: 10, comments: 2 };
  }

  async getCapabilities(context: any) {
    return ['ACCOUNT_READ', 'POST_PUBLISH'] as any;
  }

  async handleWebhook(request: any) {
    return { type: 'mock_event', payload: {}, timestamp: new Date() };
  }
}
