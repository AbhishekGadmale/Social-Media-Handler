import { describe, it, expect, beforeEach } from 'vitest';
import { MetaProvider } from './meta.provider';
import { providerRegistry } from '../core/provider-registry';

describe('MetaProvider OAuth', () => {
  let provider: MetaProvider;

  beforeEach(() => {
    provider = new MetaProvider();
  });

  it('generates an authorization url with expected scopes', () => {
    process.env.META_CLIENT_ID = 'my_client';
    const url = provider.getAuthorizationUrl({
      workspaceId: '123',
      redirectUri: 'http://localhost/callback',
      state: 'my_state',
    });

    expect(url).toContain('https://www.facebook.com/v19.0/dialog/oauth');
    expect(url).toContain('client_id=my_client');
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%2Fcallback');
    expect(url).toContain('state=my_state');
    expect(url).toContain('scope=pages_show_list%2Cpages_read_engagement%2Cpages_manage_posts%2Cinstagram_basic%2Cinstagram_content_publish');
  });

  it('exchanges authorization code successfully', async () => {
    const creds = await provider.exchangeAuthorizationCode({
      code: 'valid_code',
      redirectUri: '...',
    });
    expect(creds.accessToken).toBe('mock_long_lived_user_token');
    expect(creds.scopes).toContain('pages_manage_posts');
  });

  it('throws on invalid authorization code', async () => {
    await expect(provider.exchangeAuthorizationCode({
      code: 'invalid_code',
      redirectUri: '...',
    })).rejects.toThrow('Invalid authorization code');
  });

  it('discovers multiple accounts via getProfiles', async () => {
    const creds = await provider.exchangeAuthorizationCode({ code: 'valid_code', redirectUri: '...' });
    const profiles = await provider.getProfiles(creds);

    expect(profiles).toHaveLength(3);

    const pageIds = profiles.map(p => p.id);
    expect(pageIds).toContain('page_123');
    expect(pageIds).toContain('ig_456');
    expect(pageIds).toContain('page_789');

    // No duplicate IDs
    const uniqueIds = new Set(pageIds);
    expect(uniqueIds.size).toBe(3);
  });

  it('handles empty account discovery safely', async () => {
    const profiles = await provider.getProfiles({ accessToken: 'mock_empty' });
    expect(profiles).toHaveLength(0);
  });

  it('resolves capabilities correctly for Facebook Pages', async () => {
    const context = {
      provider: 'facebook',
      externalId: 'page_123',
      grantedScopes: ['pages_show_list', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish']
    };

    const cap = await provider.getCapabilities(context);
    expect(cap).toContain('ACCOUNT_READ');
    expect(cap).toContain('POST_PUBLISH');
  });

  it('resolves capabilities correctly for Instagram Professional accounts', async () => {
    const context = {
      provider: 'instagram',
      externalId: 'ig_456',
      grantedScopes: ['pages_show_list', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish']
    };

    const cap = await provider.getCapabilities(context);
    expect(cap).toContain('ACCOUNT_READ');
    expect(cap).toContain('POST_PUBLISH');
  });

  it('rejects POST_PUBLISH for Facebook Page if missing permission', async () => {
    const context = {
      provider: 'facebook',
      externalId: 'page_123',
      grantedScopes: ['pages_show_list'] // Missing pages_manage_posts
    };

    const cap = await provider.getCapabilities(context);
    expect(cap).toContain('ACCOUNT_READ');
    expect(cap).not.toContain('POST_PUBLISH');
  });

  it('provider registry handles facebook and instagram accurately', () => {
    const fb = providerRegistry.get('facebook');
    const ig = providerRegistry.get('instagram');
    expect(fb).toBeInstanceOf(MetaProvider);
    expect(ig).toBeInstanceOf(MetaProvider);
  });
});
