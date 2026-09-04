import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinkedInProvider } from './linkedin.provider';

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('LinkedInProvider Publishing', () => {
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

  it('should advertise only TEXT_POST', () => {
    const caps = provider.getPublishingCapabilities();
    expect(caps.contentTypes.TEXT_POST.supported).toBe(true);
    expect(caps.contentTypes.IMAGE_POST.supported).toBe(false);
    expect(caps.contentTypes.VIDEO_POST.supported).toBe(false);
    expect(caps.contentTypes.MULTI_IMAGE_POST.supported).toBe(false);
    expect(caps.contentTypes.LINK_POST.supported).toBe(false);
  });

  it('should validate provider options correctly', () => {
    expect(provider.validateProviderOptions({}).valid).toBe(true);
  });

  it('should return VALIDATION error if externalAccountId is missing', async () => {
    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: '', content: 'hello', providerOptions: {} }
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('VALIDATION');
      expect(result.failureCode).toBe('MISSING_AUTHOR');
    }
  });

  it('should return VALIDATION error if content is missing', async () => {
    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'user1', content: '', providerOptions: {} }
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('VALIDATION');
      expect(result.failureCode).toBe('MISSING_CONTENT');
    }
  });

  it('should successfully publish a text post and construct the correct request', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 201,
      headers: new Headers({
        'x-restli-id': 'urn:li:share:123',
        'x-li-uuid': 'req-uuid'
      })
    });

    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'user123', content: 'Hello LinkedIn!', providerOptions: {} }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.externalPostId).toBe('urn:li:share:123');
      expect(result.providerRequestId).toBe('req-uuid');
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.linkedin.com/rest/posts');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      'Authorization': 'Bearer token',
      'Linkedin-Version': '202608',
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    });

    const body = JSON.parse(options.body);
    expect(body).toEqual({
      author: 'urn:li:person:user123',
      commentary: 'Hello LinkedIn!',
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false
    });
  });

  it('should map 401 to AUTH_REQUIRED', async () => {
    mockFetch.mockResolvedValueOnce({ status: 401, headers: new Headers() });
    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'txt', providerOptions: {} }
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.failureCategory).toBe('AUTH_REQUIRED');
  });

  it('should map 403 to AUTH_REQUIRED', async () => {
    mockFetch.mockResolvedValueOnce({ status: 403, headers: new Headers() });
    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'txt', providerOptions: {} }
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('AUTH_REQUIRED');
      expect(result.failureCode).toBe('FORBIDDEN');
    }
  });

  it('should map 429 to RATE_LIMITED', async () => {
    mockFetch.mockResolvedValueOnce({ status: 429, headers: new Headers() });
    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'txt', providerOptions: {} }
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.failureCategory).toBe('RATE_LIMITED');
  });

  it('should map timeout/fetch error to UNKNOWN_RESULT', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));
    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'txt', providerOptions: {} }
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('UNKNOWN_RESULT');
      expect(result.failureCode).toBe('NETWORK_ERROR');
    }
  });
});
