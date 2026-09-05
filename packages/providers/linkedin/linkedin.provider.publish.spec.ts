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

  it('should advertise TEXT_POST and IMAGE_POST', () => {
    const caps = provider.getPublishingCapabilities();
    expect(caps.contentTypes.TEXT_POST.supported).toBe(true);
    expect(caps.contentTypes.IMAGE_POST.supported).toBe(true);
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

  it('should return VALIDATION error if more than one image is provided', async () => {
    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'txt', providerOptions: {}, media: [{ mimeType: 'image/jpeg', sizeBytes: 100 }, { mimeType: 'image/png', sizeBytes: 200 }] }
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('VALIDATION');
      expect(result.failureCode).toBe('MEDIA_COUNT_EXCEEDED');
    }
  });

  it('should return VALIDATION error if non-image media is provided', async () => {
    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'txt', providerOptions: {}, media: [{ mimeType: 'video/mp4', sizeBytes: 100 }] }
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('VALIDATION');
      expect(result.failureCode).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });

  it('should successfully publish a single image post with mock streaming', async () => {
    // 1. Initialize Upload
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: {
          uploadUrl: 'https://mock.upload.url',
          image: 'urn:li:image:999'
        }
      })
    });

    // 2. Upload Bytes
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200
    });

    // 3. Poll readiness
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'AVAILABLE' })
    });

    // 4. Create Post
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: new Headers({
        'x-restli-id': 'urn:li:share:imgpost',
        'x-li-uuid': 'req-uuid'
      })
    });

    const mockStream = { mock: 'stream' };
    const mockMediaSource = {
      getStream: vi.fn().mockResolvedValue(mockStream)
    };

    const result = await provider.publish(
      { accessToken: 'token' },
      { 
        attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'user123', content: 'Here is an image!', providerOptions: {},
        media: [{ mimeType: 'image/png', sizeBytes: 100, key: 's3/image.png' }]
      },
      mockMediaSource as any
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.externalPostId).toBe('urn:li:share:imgpost');
    }

    // Verify Initialize Request
    expect(mockFetch).toHaveBeenCalledTimes(4);
    const [initUrl, initOptions] = mockFetch.mock.calls[0];
    expect(initUrl).toBe('https://api.linkedin.com/rest/images?action=initializeUpload');
    expect(initOptions.method).toBe('POST');
    expect(JSON.parse(initOptions.body)).toEqual({ initializeUploadRequest: { owner: 'urn:li:person:user123' }});
    
    // Verify Upload Request
    const [uploadUrl, uploadOptions] = mockFetch.mock.calls[1];
    expect(uploadUrl).toBe('https://mock.upload.url');
    expect(uploadOptions.method).toBe('PUT');
    expect(uploadOptions.body).toBe(mockStream);
    expect(uploadOptions.headers['Content-Type']).toBe('image/png');
    
    // Verify Poll Request
    const [pollUrl] = mockFetch.mock.calls[2];
    expect(pollUrl).toBe('https://api.linkedin.com/rest/images/urn%3Ali%3Aimage%3A999');

    // Verify Post Request
    const [postUrl, postOptions] = mockFetch.mock.calls[3];
    expect(postUrl).toBe('https://api.linkedin.com/rest/posts');
    const postBody = JSON.parse(postOptions.body);
    expect(postBody.content.media.id).toBe('urn:li:image:999');
  });

  it('should safely return TRANSIENT if image poll times out before post mutation', async () => {
    vi.useFakeTimers();
    // Initialize Upload
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ value: { uploadUrl: 'url', image: 'urn:li:image:999' } })
    });
    // Upload Bytes
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    // Poll readiness -> always PROCESSING (simulate timeout)
    for (let i = 0; i < 10; i++) {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'PROCESSING' }) });
    }

    const mockMediaSource = { getStream: vi.fn().mockResolvedValue({}) };

    const publishPromise = provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'txt', providerOptions: {}, media: [{ mimeType: 'image/png', sizeBytes: 100, key: 's3/image.png' }] },
      mockMediaSource as any
    );
    // advance timers to trigger all timeouts
    await vi.runAllTimersAsync();
    const result = await publishPromise;
    vi.useRealTimers();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('TRANSIENT');
      expect(result.failureCode).toBe('IMAGE_PROCESSING_TIMEOUT');
    }
    // ensure no POST /rest/posts was called
    const postCalls = mockFetch.mock.calls.filter(c => c[0] === 'https://api.linkedin.com/rest/posts');
    expect(postCalls.length).toBe(0);
  });
});
