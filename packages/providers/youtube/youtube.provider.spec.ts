import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { YouTubeProvider } from './youtube.provider';
import { providerRegistry } from '../core/provider-registry';

describe('YouTubeProvider', () => {
  let provider: YouTubeProvider;

  beforeEach(() => {
    process.env.YOUTUBE_CLIENT_ID = 'test-client';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-secret';
    provider = new YouTubeProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws on missing env vars', () => {
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;
    expect(() => new YouTubeProvider()).toThrow('YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET environment variables are required.');
  });

  it('generates correct authorization URL', () => {
    const url = provider.getAuthorizationUrl({
      workspaceId: 'ws-123',
      redirectUri: 'http://localhost/callback',
      state: 'some-state',
      codeChallenge: 'challenge-xyz',
    });

    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('response_type=code');
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%2Fcallback');
    expect(url).toContain('state=some-state');
    expect(url).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.readonly');
    expect(url).toContain('code_challenge=challenge-xyz');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
  });

  it('generates correct authorization URL with allowed scopes', () => {
    const url = provider.getAuthorizationUrl({
      workspaceId: 'ws-123',
      redirectUri: 'http://localhost/callback',
      state: 'some-state',
      requestedScopes: ['https://www.googleapis.com/auth/youtube.upload'],
    });

    expect(url).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.readonly+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.upload');
  });

  it('rejects authorization URL with arbitrary unknown scopes', () => {
    expect(() => provider.getAuthorizationUrl({
      workspaceId: 'ws-123',
      redirectUri: 'http://localhost/callback',
      state: 'some-state',
      requestedScopes: ['https://www.googleapis.com/auth/drive'],
    })).toThrow('Invalid or unauthorized OAuth scope requested');
  });

  it('exchanges authorization code correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'mock-access',
        refresh_token: 'mock-refresh',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/youtube.readonly',
      }),
    });

    const credentials = await provider.exchangeAuthorizationCode({
      code: 'auth-code',
      redirectUri: 'http://localhost/callback',
      codeVerifier: 'verifier-abc',
    });

    expect(credentials.accessToken).toBe('mock-access');
    expect(credentials.refreshToken).toBe('mock-refresh');
    expect(credentials.scopes).toEqual(['https://www.googleapis.com/auth/youtube.readonly']);
    
    // Check fetch args
    const fetchCall = (global.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe('https://oauth2.googleapis.com/token');
    expect(fetchCall[1].method).toBe('POST');
    expect(fetchCall[1].body).toContain('grant_type=authorization_code');
    expect(fetchCall[1].body).toContain('code=auth-code');
    expect(fetchCall[1].body).toContain('code_verifier=verifier-abc');
  });

  it('fetches profiles correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'channel-123',
            snippet: {
              title: 'My YouTube Channel',
              thumbnails: {
                default: { url: 'http://youtube.com/thumb.jpg' },
              },
            },
          },
        ],
      }),
    });

    const profiles = await provider.getProfiles({
      accessToken: 'mock-access',
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe('channel-123');
    expect(profiles[0].name).toBe('My YouTube Channel');
    expect(profiles[0].avatarUrl).toBe('http://youtube.com/thumb.jpg');
    
    const fetchCall = (global.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toContain('mine=true');
  });

  it('getAccountMetrics returns correctly mapped subscriber/view counts from mocked response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'channel-123',
            statistics: {
              subscriberCount: '1500',
              viewCount: '250000',
            },
          },
        ],
      }),
    });

    const metrics = await provider.getAccountMetrics(
      { accessToken: 'mock-access' },
      { id: 'channel-123', name: 'My Channel' }
    );

    expect(metrics.followersCount).toBe(1500);
    expect(metrics.viewCount).toBe(250000);
    expect(metrics.engagement).toBe(0);
  });

  it('resolves capabilities to EXACTLY ACCOUNT_READ and ANALYTICS_READ', async () => {
    const caps = await provider.getCapabilities({
      provider: 'youtube',
      grantedScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    });

    expect(caps).toEqual(['ACCOUNT_READ', 'ANALYTICS_READ']);
  });

  it('omits publishPost, deletePost, getPostMetrics', () => {
    expect(provider.publishPost).toBeUndefined();
    expect(provider.deletePost).toBeUndefined();
    expect(provider.getPostMetrics).toBeUndefined();
  });
});
