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

  describe('PAGINATION', () => {
    it('discovers profiles across multiple pages', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { id: 'page1', name: 'Page 1', access_token: 'tok1' }
            ],
            paging: { next: 'https://graph.facebook.com/v20.0/me/accounts?cursor=abc&access_token=long_token' }
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { id: 'page2', name: 'Page 2', access_token: 'tok2' }
            ],
            paging: { next: 'https://graph.facebook.com/v20.0/me/accounts?cursor=def&access_token=long_token' }
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { id: 'page3', name: 'Page 3', access_token: 'tok3' }
            ]
          }),
        });

      const profiles = await provider.getProfiles({ accessToken: 'long_token', scopes: [] });
      expect(profiles).toHaveLength(3);
      expect(profiles[0].profile.id).toBe('page1');
      expect(profiles[1].profile.id).toBe('page2');
      expect(profiles[2].profile.id).toBe('page3');

      // Assert redirect: 'error' was passed
      const fetchCalls = (global.fetch as any).mock.calls;
      expect(fetchCalls[0][1].redirect).toBe('error');
    });

    it('rejects external/SSRF URLs in paging.next', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'page1', name: 'Page 1', access_token: 'tok1' }],
          paging: { next: 'https://evil.com/accounts' }
        }),
      });

      await expect(provider.getProfiles({ accessToken: 'long_token', scopes: [] }))
        .rejects.toThrow('Invalid pagination URL');
    });

    it('detects and aborts pagination loops', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'page1', name: 'Page 1', access_token: 'tok1' }],
            paging: { next: 'https://graph.facebook.com/v20.0/me/accounts?cursor=loop&access_token=long_token' }
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'page2', name: 'Page 2', access_token: 'tok2' }],
            paging: { next: 'https://graph.facebook.com/v20.0/me/accounts?cursor=loop&access_token=long_token' }
          }),
        });

      await expect(provider.getProfiles({ accessToken: 'long_token', scopes: [] }))
        .rejects.toThrow('Pagination loop detected');
    });

    it('respects maximum page limits', async () => {
      (global.fetch as any).mockImplementation((url: string) => {
        const u = new URL(url);
        const count = u.searchParams.get('c') ? parseInt(u.searchParams.get('c')!) : 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [{ id: `page${count}`, name: `Page ${count}`, access_token: `tok${count}` }],
            paging: { next: `https://graph.facebook.com/v20.0/me/accounts?c=${count + 1}&access_token=long_token` }
          })
        });
      });

      await expect(provider.getProfiles({ accessToken: 'long_token', scopes: [] }))
        .rejects.toThrow('Maximum pagination limit reached');
    });

    it('deduplicates profiles by external id', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { id: 'page1', name: 'Page 1', access_token: 'tok1' }
            ],
            paging: { next: 'https://graph.facebook.com/v20.0/me/accounts?cursor=abc&access_token=long_token' }
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { id: 'page1', name: 'Page 1 Updated', access_token: 'tok1' },
              { id: 'page2', name: 'Page 2', access_token: 'tok2' }
            ]
          }),
        });

      const profiles = await provider.getProfiles({ accessToken: 'long_token', scopes: [] });
      expect(profiles).toHaveLength(2);
      expect(profiles[0].profile.name).toBe('Page 1');
    });

    it('fails the entire request if a later page fails', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'page1', name: 'Page 1', access_token: 'tok1' }],
            paging: { next: 'https://graph.facebook.com/v20.0/me/accounts?cursor=abc&access_token=long_token' }
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: { message: 'Graph failed' } })
        });

      await expect(provider.getProfiles({ accessToken: 'long_token', scopes: [] }))
        .rejects.toThrow('Failed to fetch user accounts: Graph failed');
    });

    it('runtime SocialProfile object contains no accessToken or refreshToken', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'page1', name: 'Page 1', access_token: 'tok1' }]
        })
      });

      const profiles = await provider.getProfiles({ accessToken: 'long_token', scopes: [] });
      const p = profiles[0].profile as any;
      expect(p.accessToken).toBeUndefined();
      expect(p.access_token).toBeUndefined();
      expect(p.refreshToken).toBeUndefined();
      expect(p.paging).toBeUndefined();
    });

    it('discovers Instagram accounts from later pages', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'page1', name: 'Page 1', access_token: 'tok1' }],
            paging: { next: 'https://graph.facebook.com/v20.0/me/accounts?cursor=abc&access_token=long_token' }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{
              id: 'page2', name: 'Page 2', access_token: 'tok2',
              instagram_business_account: { id: 'ig1', name: 'IG1', username: 'ig1', profile_picture_url: 'pic' }
            }]
          })
        });

      const profiles = await provider.getProfiles({ accessToken: 'long_token', scopes: [] });
      expect(profiles).toHaveLength(3); // page1, page2, ig1
      expect(profiles[2].profile.id).toBe('ig1');
    });

    it('deduplicates Instagram profiles by external id', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{
              id: 'page1', name: 'Page 1', access_token: 'tok1',
              instagram_business_account: { id: 'ig1', name: 'IG1', username: 'ig1', profile_picture_url: 'pic' }
            }],
            paging: { next: 'https://graph.facebook.com/v20.0/me/accounts?cursor=abc&access_token=long_token' }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{
              id: 'page2', name: 'Page 2', access_token: 'tok2',
              instagram_business_account: { id: 'ig1', name: 'IG1', username: 'ig1', profile_picture_url: 'pic' }
            }]
          })
        });

      const profiles = await provider.getProfiles({ accessToken: 'long_token', scopes: [] });
      expect(profiles).toHaveLength(3); // page1, ig1, page2
      const igProfiles = profiles.filter(p => p.profile.provider === 'INSTAGRAM');
      expect(igProfiles).toHaveLength(1);
    });

    it('rejects first-page missing data', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });
      await expect(provider.getProfiles({ accessToken: 'tok', scopes: [] }))
        .rejects.toThrow('Malformed Meta response: data is missing or not an array');
    });

    it('rejects second-page missing data', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: '1', name: 'N', access_token: 'T' }],
            paging: { next: 'https://graph.facebook.com/v20.0/me/accounts?cursor=abc' }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({})
        });
      await expect(provider.getProfiles({ accessToken: 'tok', scopes: [] }))
        .rejects.toThrow('Malformed Meta response: data is missing or not an array');
    });

    it('rejects data non-array', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'not-an-array' })
      });
      await expect(provider.getProfiles({ accessToken: 'tok', scopes: [] }))
        .rejects.toThrow('Malformed Meta response: data is missing or not an array');
    });

    it('rejects paging non-object', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [], paging: 'not-an-object' })
      });
      await expect(provider.getProfiles({ accessToken: 'tok', scopes: [] }))
        .rejects.toThrow('Malformed Meta response: paging is not an object');
    });

    it('rejects paging.next non-string', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [], paging: { next: 123 } })
      });
      await expect(provider.getProfiles({ accessToken: 'tok', scopes: [] }))
        .rejects.toThrow('Malformed Meta response: paging.next is not a string');
    });

    it('valid page without paging succeeds normally', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: '1', name: 'N', access_token: 'T' }] })
      });
      const profiles = await provider.getProfiles({ accessToken: 'tok', scopes: [] });
      expect(profiles).toHaveLength(1);
    });

    it('rejects malformed second-page response', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'page1', name: 'Page 1', access_token: 'tok1' }],
            paging: { next: 'https://graph.facebook.com/v20.0/me/accounts?cursor=abc&access_token=long_token' }
          })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'Bad request' } })
        });

      await expect(provider.getProfiles({ accessToken: 'long_token', scopes: [] }))
        .rejects.toThrow('Failed to fetch user accounts: Bad request');
    });

    it('rejects malformed paging.next URL safely', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'page1', name: 'Page 1', access_token: 'tok1' }],
          paging: { next: 'not-a-url' }
        })
      });

      await expect(provider.getProfiles({ accessToken: 'long_token', scopes: [] }))
        .rejects.toThrow('Invalid pagination URL format');
    });

    it('token-bearing paging.next does not appear in error text', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'page1', name: 'Page 1', access_token: 'tok1' }],
            paging: { next: 'https://graph.facebook.com/v20.0/me/accounts?cursor=abc&access_token=secret_token' }
          })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'Graph failed with token secret_token' } })
        });

      await expect(provider.getProfiles({ accessToken: 'secret_token', scopes: [] }))
        .rejects.toThrow('Failed to fetch user accounts: Graph failed with token ***');
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
