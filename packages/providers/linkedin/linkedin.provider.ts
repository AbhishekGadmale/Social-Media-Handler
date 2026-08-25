import {
  AuthUrlInput,
  OAuthCredentials,
  SocialProfile,
  CapabilityContext,
  ProviderCapabilities,
} from '../core/types/index.js';
import { ISocialProvider } from '../core/interfaces/ISocialProvider.js';
import { resolveCapabilities } from '../core/capability-resolver.js';
import crypto from 'node:crypto';

export class LinkedInProvider implements ISocialProvider {
  private clientId: string;
  private clientSecret: string;
  private authorizeUrl = 'https://www.linkedin.com/oauth/v2/authorization';
  private tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
  private userInfoUrl = 'https://api.linkedin.com/v2/userinfo';

  constructor() {
    this.clientId = process.env.LINKEDIN_CLIENT_ID || 'dummy_client_id';
    this.clientSecret = process.env.LINKEDIN_CLIENT_SECRET || 'dummy_client_secret';
  }

  getAuthorizationUrl(input: AuthUrlInput & { codeChallenge?: string }): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
      scope: 'openid profile email',
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
      throw new Error(`Failed to exchange authorization code: ${error}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      scopes: data.scope ? data.scope.split(' ') : ['openid', 'profile', 'email'],
    };
  }

  async getProfiles(credentials: OAuthCredentials): Promise<SocialProfile[]> {
    const response = await fetch(this.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch user profile: ${error}`);
    }

    const data = await response.json();

    return [
      {
        id: data.sub,
        name: data.name,
        username: data.email, // LinkedIn OpenID userinfo returns email
        avatarUrl: data.picture,
      },
    ];
  }

  async getCapabilities(context: CapabilityContext): Promise<ProviderCapabilities> {
    // For this connection, granted scopes only justify ACCOUNT_READ
    return resolveCapabilities({
      ...context,
      grantedScopes: context.grantedScopes || ['openid', 'profile', 'email'],
    });
  }

  // OMIT publishPost, getAccountMetrics, getPostMetrics, deletePost
}
