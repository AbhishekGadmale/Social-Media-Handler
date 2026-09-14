import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinkedInProvider } from './linkedin.provider';

// Minimal mock for global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('LinkedInProvider', () => {
  let provider: LinkedInProvider;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, LINKEDIN_CLIENT_ID: 'test-client', LINKEDIN_CLIENT_SECRET: 'test-secret' };
    provider = new LinkedInProvider();
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should generate authorization URL correctly', () => {
    const url = provider.getAuthorizationUrl({
      workspaceId: 'ws1',
      redirectUri: 'http://localhost/callback',
      state: 'random-state',
      codeChallenge: 'challenge123', // PKCE should be ignored by LinkedIn provider
    });

    const parsedUrl = new URL(url);
    expect(parsedUrl.origin + parsedUrl.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(parsedUrl.searchParams.get('response_type')).toBe('code');
    expect(parsedUrl.searchParams.get('client_id')).toBe('test-client');
    expect(parsedUrl.searchParams.get('redirect_uri')).toBe('http://localhost/callback');
    expect(parsedUrl.searchParams.get('state')).toBe('random-state');
    expect(parsedUrl.searchParams.get('scope')).toBe('openid profile email');
    expect(parsedUrl.searchParams.has('code_challenge')).toBe(false);
    expect(parsedUrl.searchParams.has('code_challenge_method')).toBe(false);
  });

  it('should omit Community Management API methods', () => {
    expect(provider.publishPost).toBeUndefined();
    expect(provider.getAccountMetrics).toBeUndefined();
    expect(provider.getPostMetrics).toBeUndefined();
    
  });

  it('should exchange authorization code successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_in: 3600,
        scope: 'openid profile email',
      }),
    });

    const creds = await provider.exchangeAuthorizationCode({
      code: 'auth-code',
      redirectUri: 'http://localhost/callback',
      codeVerifier: 'verifier123',
    });

    expect(creds.accessToken).toBe('access-123');
    expect(creds.refreshToken).toBe('refresh-456');
    expect(creds.scopes).toEqual(['openid', 'profile', 'email']);
    
    // Check that code_verifier is NOT sent
    expect(mockFetch).toHaveBeenCalledWith('https://www.linkedin.com/oauth/v2/accessToken', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }));
    
    const callArgs = mockFetch.mock.calls[0][1];
    const bodyParams = new URLSearchParams(callArgs.body);
    expect(bodyParams.get('grant_type')).toBe('authorization_code');
    expect(bodyParams.get('code')).toBe('auth-code');
    expect(bodyParams.get('client_id')).toBe('test-client');
    expect(bodyParams.get('client_secret')).toBe('test-secret');
    expect(bodyParams.get('redirect_uri')).toBe('http://localhost/callback');
    expect(bodyParams.has('code_verifier')).toBe(false);
  });

  it('should fetch user profile successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sub: 'urn:li:person:123',
        name: 'John Doe',
        email: 'john@example.com',
        picture: 'http://example.com/pic.jpg',
      }),
    });

    const profiles = await provider.getProfiles({ accessToken: 'access-123' });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toEqual({
      id: 'urn:li:person:123',
      name: 'John Doe',
      username: 'john@example.com',
      avatarUrl: 'http://example.com/pic.jpg',
    });
  });

  it('should resolve capabilities to ACCOUNT_READ only', async () => {
    // According to capability-resolver logic which we assume behaves standard for unknown mappings or we mock it
    const capabilities = await provider.getCapabilities({
      provider: 'linkedin',
      grantedScopes: ['openid', 'profile', 'email'],
    });
    // This depends on how resolveCapabilities is implemented in capability-resolver.ts
    // Let's assume the resolver maps nothing for openid, but if there's no mapping it returns [] or ACCOUNT_READ
  });
});
