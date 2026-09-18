import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetaProvider } from './meta.provider';
import { ProviderApiError } from '../core/errors/index';

describe('MetaProvider OAuth', () => {
  let provider: MetaProvider;
  
  beforeEach(() => {
    provider = new MetaProvider();
    process.env.META_CLIENT_ID = 'test_client';
    process.env.META_CLIENT_SECRET = 'test_secret';
    global.fetch = vi.fn();
  });

  describe('AUTH', () => {
    it('generates an authorization url with expected scopes', () => {
      const url = provider.getAuthorizationUrl({
        workspaceId: '123',
        redirectUri: 'http://localhost/callback',
        state: 'my_state',
      });
  
      expect(url).toContain('https://www.facebook.com/v20.0/dialog/oauth');
      expect(url).toContain('client_id=test_client');
      expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%2Fcallback');
      expect(url).toContain('state=my_state');
      expect(url).toContain('scope=pages_show_list%2Cpages_read_engagement%2Cpages_manage_posts%2Cinstagram_basic%2Cinstagram_content_publish');
      expect(url).toContain('response_type=code');
      // Secret never appears
      expect(url).not.toContain('test_secret');
    });

    it('fails safely if client id missing', () => {
      delete process.env.META_CLIENT_ID;
      expect(() => provider.getAuthorizationUrl({ workspaceId: '1', redirectUri: 'x', state: 'y' }))
        .toThrow('META_CLIENT_ID is not configured');
    });
  });

  describe('TOKEN', () => {
    it('code exchange success (short-lived then long-lived)', async () => {
      // Mock short-lived exchange
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'short_token' }),
      });
      // Mock long-lived exchange
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'long_token', expires_in: 3600 }),
      });

      const creds = await provider.exchangeAuthorizationCode({
        code: 'valid_code',
        redirectUri: 'http://cb',
      });

      expect(creds.accessToken).toBe('long_token');
      expect(creds.expiresAt).toBeDefined();
      expect(creds.scopes).toContain('pages_manage_posts');
    });

    it('malformed code exchange rejected safely', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Invalid code' } }),
      });

      await expect(provider.exchangeAuthorizationCode({
        code: 'invalid_code',
        redirectUri: 'http://cb',
      })).rejects.toThrow(ProviderApiError);
    });

    it('long-lived exchange failure handled', async () => {
      // Mock short-lived exchange
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'short_token' }),
      });
      // Mock long-lived exchange failure
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'App secret invalid' } }),
      });

      await expect(provider.exchangeAuthorizationCode({
        code: 'valid_code',
        redirectUri: 'http://cb',
      })).rejects.toThrow('Failed to exchange for long-lived token: App secret invalid');
    });
  });

  describe('PAGES & INSTAGRAM', () => {
    it('discovers multiple accounts with proper ids and providers', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'page1',
              name: 'FB Page 1',
              access_token: 'page1_token',
              picture: { data: { url: 'pic1' } }
            },
            {
              id: 'page2',
              name: 'FB Page 2',
              access_token: 'page2_token',
              picture: { data: { url: 'pic2' } },
              instagram_business_account: {
                id: 'ig1',
                name: 'IG Name',
                username: 'ig_user',
                profile_picture_url: 'ig_pic'
              }
            }
          ]
        }),
      });

      const profiles = await provider.getProfiles({ accessToken: 'long_token', scopes: ['pages_manage_posts'] });
      
      // Should result in THREE profiles (Page 1, Page 2, IG 1)
      expect(profiles).toHaveLength(3);

      expect(profiles[0].profile.id).toBe('page1');
      expect(profiles[0].profile.provider).toBe('FACEBOOK');
      expect(profiles[0].credentials?.accessToken).toBe('page1_token');

      expect(profiles[1].profile.id).toBe('page2');
      expect(profiles[1].profile.provider).toBe('FACEBOOK');
      
      expect(profiles[2].profile.id).toBe('ig1');
      expect(profiles[2].profile.provider).toBe('INSTAGRAM');
      expect(profiles[2].credentials?.accessToken).toBe('page2_token'); // Uses page2's token!
    });

    it('handles empty Page list safely', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const profiles = await provider.getProfiles({ accessToken: 'long_token' });
      expect(profiles).toHaveLength(0);
    });

    it('skips pages missing credentials safely', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'page1', name: 'FB Page 1' }, // Missing token
            { id: 'page2', name: 'FB Page 2', access_token: 'valid' }
          ]
        }),
      });

      const profiles = await provider.getProfiles({ accessToken: 'long_token' });
      expect(profiles).toHaveLength(1);
      expect(profiles[0].profile.id).toBe('page2');
    });
  });

  describe('CAPABILITIES', () => {
    it('Facebook POST_PUBLISH with verified permissions', async () => {
      const caps = await provider.getCapabilities({
        provider: 'FACEBOOK',
        grantedScopes: ['pages_manage_posts', 'pages_read_engagement'],
      });
      expect(caps).toContain('POST_PUBLISH');
      expect(caps).toContain('ACCOUNT_READ');
    });

    it('Facebook missing permission -> no POST_PUBLISH', async () => {
      const caps = await provider.getCapabilities({
        provider: 'FACEBOOK',
        grantedScopes: ['pages_read_engagement'],
      });
      expect(caps).not.toContain('POST_PUBLISH');
    });

    it('Instagram POST_PUBLISH with verified permissions', async () => {
      const caps = await provider.getCapabilities({
        provider: 'INSTAGRAM',
        grantedScopes: ['instagram_content_publish'],
      });
      expect(caps).toContain('POST_PUBLISH');
    });
  });
});
