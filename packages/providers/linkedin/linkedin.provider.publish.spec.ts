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

  it('should advertise TEXT_POST and IMAGE_POST and VIDEO_POST', () => {
    const caps = provider.getPublishingCapabilities();
    expect(caps.contentTypes.TEXT_POST.supported).toBe(true);
    expect(caps.contentTypes.IMAGE_POST.supported).toBe(true);
    expect(caps.contentTypes.VIDEO_POST.supported).toBe(true);
    expect(caps.contentTypes.MULTI_IMAGE_POST.supported).toBe(true);
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



  it('should return VALIDATION error if unsupported media is provided', async () => {
    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'txt', providerOptions: {}, media: [{ mimeType: 'application/pdf', sizeBytes: 100, key: 'test' }] },
      {} as any
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('VALIDATION');
      expect(result.failureCode).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });

  it('should successfully publish a single video post with multipart mock streaming', async () => {
    // 1. Initialize Upload
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: {
          video: 'urn:li:video:111',
          uploadToken: 'token123',
          uploadInstructions: [
            { firstByte: 0, lastByte: 49, uploadUrl: 'https://api.linkedin.com/part1' },
            { firstByte: 50, lastByte: 99, uploadUrl: 'https://api.linkedin.com/part2' }
          ]
        }
      })
    });

    // 2. Upload Part 1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"etag1"' })
    });

    // 3. Upload Part 2
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: 'etag2' })
    });

    // 4. Finalize
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200
    });

    // 5. Poll readiness
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'AVAILABLE' })
    });

    // 6. Create Post
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: new Headers({
        'x-restli-id': 'urn:li:share:vidpost',
        'x-li-uuid': 'req-uuid'
      })
    });

    const mockMediaSource = {
      getStream: vi.fn().mockResolvedValue([Buffer.from('video-data')])
    };

    vi.useFakeTimers();

    const publishPromise = provider.publish(
      { accessToken: 'token' },
      { 
        attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'user123', content: 'Here is a video!', providerOptions: {},
        media: [{ mimeType: 'video/mp4', sizeBytes: 100, key: 's3/video.mp4' }]
      },
      mockMediaSource as any
    );

    await vi.runAllTimersAsync();
    const result = await publishPromise;
    vi.useRealTimers();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.externalPostId).toBe('urn:li:share:vidpost');
    }

    // Verify Initialize Request
    expect(mockFetch).toHaveBeenCalledTimes(6);
    const [initUrl, initOptions] = mockFetch.mock.calls[0];
    expect(initUrl).toBe('https://api.linkedin.com/rest/videos?action=initializeUpload');
    expect(JSON.parse(initOptions.body)).toEqual({
      initializeUploadRequest: { owner: 'urn:li:person:user123', fileSizeBytes: 100, uploadCaptions: false, uploadThumbnail: false }
    });

    // Verify Finalize Request
    const [finUrl, finOptions] = mockFetch.mock.calls[3];
    expect(finUrl).toBe('https://api.linkedin.com/rest/videos?action=finalizeUpload');
    expect(JSON.parse(finOptions.body)).toEqual({
      finalizeUploadRequest: { video: 'urn:li:video:111', uploadToken: 'token123', uploadedPartIds: ['etag1', 'etag2'] }
    });

    // Verify Post Request
    const [postUrl, postOptions] = mockFetch.mock.calls[5];
    expect(postUrl).toBe('https://api.linkedin.com/rest/posts');
    const postBody = JSON.parse(postOptions.body);
    expect(postBody.content.media.id).toBe('urn:li:video:111');

    // Verify IMediaContentSource Range Reads
    expect(mockMediaSource.getStream).toHaveBeenCalledTimes(2);
    expect(mockMediaSource.getStream).toHaveBeenNthCalledWith(1, 's3/video.mp4', { start: 0, end: 49 });
    expect(mockMediaSource.getStream).toHaveBeenNthCalledWith(2, 's3/video.mp4', { start: 50, end: 99 });
  });

  it('should reject missing, null, or non-string uploadToken', async () => {
    const invalidTokens = [undefined, null, 123, {}];
    for (const token of invalidTokens) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: { video: 'urn:li:video:111', uploadToken: token, uploadInstructions: [] }
        })
      });

      const result = await provider.publish(
        { accessToken: 'token' },
        { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'txt', providerOptions: {}, media: [{ mimeType: 'video/mp4', sizeBytes: 100, key: 's3/v.mp4' }] },
        { getStream: vi.fn() } as any
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.failureCode).toBe('INVALID_INITIALIZE_RESPONSE');
      }
    }
  });

  it('should accept empty string uploadToken and pass it to finalizeUpload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: {
          video: 'urn:li:video:empty',
          uploadToken: '',
          uploadInstructions: [
            { firstByte: 0, lastByte: 99, uploadUrl: 'https://api.linkedin.com/part1' }
          ]
        }
      })
    });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ etag: '"etag1"' }) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 }); // finalize
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'AVAILABLE' }) });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 201, headers: new Headers({ 'x-restli-id': 'urn:li:share:empty' })
    });

    vi.useFakeTimers();
    const publishPromise = provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'txt', providerOptions: {}, media: [{ mimeType: 'video/mp4', sizeBytes: 100, key: 's3/v.mp4' }] },
      { getStream: vi.fn().mockResolvedValue([Buffer.from('video-data')]) } as any
    );
    await vi.runAllTimersAsync();
    const result = await publishPromise;
    vi.useRealTimers();

    expect(result.success).toBe(true);
    
    // Verify Finalize Request
    const [finUrl, finOptions] = mockFetch.mock.calls[2];
    expect(finUrl).toBe('https://api.linkedin.com/rest/videos?action=finalizeUpload');
    expect(JSON.parse(finOptions.body)).toEqual({
      finalizeUploadRequest: { video: 'urn:li:video:empty', uploadToken: '', uploadedPartIds: ['etag1'] }
    });
  });

  it('should successfully publish a single image post with mock streaming', async () => {
    // 1. Initialize Upload
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: {
          uploadUrl: 'https://api.linkedin.com/upload',
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

    const mockStream = [Buffer.from('image-data')];
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
    expect(uploadUrl).toBe('https://api.linkedin.com/upload');
    expect(uploadOptions.method).toBe('PUT');
    expect(uploadOptions.body.toString()).toBe('image-data');
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
      json: async () => ({ value: { uploadUrl: 'https://api.linkedin.com/upload/timeout', image: 'urn:li:image:999' } })
    });
    // Upload Bytes
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    // Poll readiness -> always PROCESSING (simulate timeout)
    for (let i = 0; i < 10; i++) {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'PROCESSING' }) });
    }

    const mockMediaSource = { getStream: vi.fn().mockResolvedValue([Buffer.from('image-data')]) };

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

  it('should return TRANSIENT pre-post failure if initialize fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'user', content: 'Video', providerOptions: {}, media: [{ mimeType: 'video/mp4', sizeBytes: 100, key: 's3/video.mp4' }] },
      { getStream: vi.fn() } as any
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('TRANSIENT');
      expect(result.failureCode).toBe('SERVER_ERROR');
    }
  });

  it('should return TRANSIENT pre-post failure if multipart upload fails part way', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: {
          video: 'urn:li:video:111', uploadToken: 'token123',
          uploadInstructions: [
            { firstByte: 0, lastByte: 49, uploadUrl: 'https://api.linkedin.com/part1' },
            { firstByte: 50, lastByte: 99, uploadUrl: 'https://api.linkedin.com/part2' }
          ]
        }
      })
    });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ etag: '"etag1"' }) });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502 });

    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'Video', providerOptions: {}, media: [{ mimeType: 'video/mp4', sizeBytes: 100, key: 's3/vid' }] },
      { getStream: vi.fn().mockResolvedValue([Buffer.from('video-data')]) } as any
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.failureCategory).toBe('TRANSIENT');
    const postCalls = mockFetch.mock.calls.filter(c => c[0] === 'https://api.linkedin.com/rest/posts');
    expect(postCalls.length).toBe(0);
  });

  it('should return PERMANENT failure if finalize fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ value: { video: 'urn:li:video:111', uploadToken: 't', uploadInstructions: [] } })
    });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 }); // Finalize fails

    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'Vid', providerOptions: {}, media: [{ mimeType: 'video/mp4', sizeBytes: 100, key: 's3' }] },
      { getStream: vi.fn() } as any
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.failureCategory).toBe('PERMANENT');
    const postCalls = mockFetch.mock.calls.filter(c => c[0] === 'https://api.linkedin.com/rest/posts');
    expect(postCalls.length).toBe(0);
  });

  it('should return PERMANENT failure if video processing fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { video: 'urn:v', uploadToken: 't', uploadInstructions: [] } }) }); // Init
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 }); // Finalize
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'PROCESSING_FAILED' }) }); // Poll

    vi.useFakeTimers();
    const p = provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'Vid', providerOptions: {}, media: [{ mimeType: 'video/mp4', sizeBytes: 100, key: 's3' }] },
      { getStream: vi.fn() } as any
    );
    await vi.runAllTimersAsync();
    const result = await p;
    vi.useRealTimers();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('PERMANENT');
      expect(result.failureCode).toBe('VIDEO_PROCESSING_FAILED');
    }
    const postCalls = mockFetch.mock.calls.filter(c => c[0] === 'https://api.linkedin.com/rest/posts');
    expect(postCalls.length).toBe(0);
  });

  it('should return TRANSIENT if video readiness times out', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { video: 'urn:v', uploadToken: 't', uploadInstructions: [] } }) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    for (let i = 0; i < 60; i++) {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'PROCESSING' }) });
    }

    vi.useFakeTimers();
    const p = provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'Vid', providerOptions: {}, media: [{ mimeType: 'video/mp4', sizeBytes: 100, key: 's3' }] },
      { getStream: vi.fn() } as any
    );
    await vi.runAllTimersAsync();
    const result = await p;
    vi.useRealTimers();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.failureCategory).toBe('TRANSIENT');
    const postCalls = mockFetch.mock.calls.filter(c => c[0] === 'https://api.linkedin.com/rest/posts');
    expect(postCalls.length).toBe(0);
  });

  it('should return UNKNOWN_RESULT if uncertain response from rest posts', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { video: 'urn:v', uploadToken: 't', uploadInstructions: [] } }) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'AVAILABLE' }) });
    mockFetch.mockRejectedValueOnce(new Error('Network drop after posts')); // Post

    vi.useFakeTimers();
    const p = provider.publish(
      { accessToken: 'token' },
      { attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'Vid', providerOptions: {}, media: [{ mimeType: 'video/mp4', sizeBytes: 100, key: 's3' }] },
      { getStream: vi.fn() } as any
    );
    await vi.runAllTimersAsync();
    const result = await p;
    vi.useRealTimers();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.failureCategory).toBe('UNKNOWN_RESULT');
  });

  it('should successfully publish a multi-image post sequentially and construct payload correctly', async () => {
    // Media 1
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { uploadUrl: 'https://api.linkedin.com/upload/url1', image: 'urn:i1' } }) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 }); // PUT
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'AVAILABLE' }) }); // POLL
    // Media 2
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { uploadUrl: 'https://api.linkedin.com/upload/url2', image: 'urn:i2' } }) });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 }); // PUT
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'AVAILABLE' }) }); // POLL

    // POST /rest/posts
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201, headers: { get: (h) => h === 'x-restli-id' ? 'post_id' : null } });

    const mediaSource = {
      getStream: vi.fn().mockResolvedValue((async function* () { yield Buffer.from('img'); })())
    };

    vi.useFakeTimers();
    const p = provider.publish(
      { accessToken: 'token' },
      { 
        attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'MULTI', providerOptions: {}, 
        
        media: [
          { mimeType: 'image/jpeg', sizeBytes: 100, key: 's3/1.jpg' },
          { mimeType: 'image/png', sizeBytes: 100, key: 's3/2.png' }
        ] 
      },
      mediaSource as any
    );
    await vi.runAllTimersAsync();
    const result = await p;
    vi.useRealTimers();

    expect(result.success).toBe(true);
    
    // Check payload
    const postCall = mockFetch.mock.calls.find(c => c[0] === 'https://api.linkedin.com/rest/posts');
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.content.multiImage.images).toEqual([{ id: 'urn:i1' }, { id: 'urn:i2' }]);
  });

  it('should abort multi-image post early if first image fails before /rest/posts with TRANSIENT error', async () => {
    // Media 1 fails at PUT
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { uploadUrl: 'https://api.linkedin.com/upload/url1', image: 'urn:i1' } }) });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502 }); // PUT fails TRANSIENT

    const mediaSource = {
      getStream: vi.fn().mockResolvedValue((async function* () { yield Buffer.from('img'); })())
    };

    const p = await provider.publish(
      { accessToken: 'token' },
      { 
        attemptId: 'a1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'MULTI', providerOptions: {}, 
        
        media: [
          { mimeType: 'image/jpeg', sizeBytes: 100, key: 's3/1.jpg' },
          { mimeType: 'image/png', sizeBytes: 100, key: 's3/2.png' }
        ] 
      },
      mediaSource as any
    );

    expect(p.success).toBe(false);
    if (!p.success) console.log('FAILURE CODE:', p.failureCode, p.message);
    if (!p.success) expect(p.failureCategory).toBe('TRANSIENT');
    // Ensure media 2 was NOT attempted
    expect(mockFetch).toHaveBeenCalledTimes(2); // 1 INIT + 1 PUT for media 1
  });




  it('should use Readable stream with duplex: half for image upload and include Authorization header on PUT', async () => {
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('chunk');
      }
    };
    const mockMediaSource = { getStream: vi.fn().mockResolvedValue(mockStream) };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ value: { uploadUrl: 'https://api.linkedin.com/upload/url', image: 'urn:li:image:123' } })
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'AVAILABLE' })
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: { get: (name: string) => name === 'x-restli-id' ? 'urn:li:post:abc' : null }
    });

    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: '1', targetId: '1', workspaceId: '1', externalAccountId: 'u', content: 'Testing regression', providerOptions: {}, media: [{ key: '1.jpg', mimeType: 'image/jpeg' }] },
      mockMediaSource as any
    );

    expect(result.success).toBe(true);
    
    // Check the PUT request
    const putCall = mockFetch.mock.calls.find((call: any[]) => call[0] === 'https://api.linkedin.com/upload/url' && call[1] && call[1].method === 'PUT');
    expect(putCall).toBeDefined();
    
    const putOptions = putCall[1];
    
    // 1. Verify duplex: 'half'
    expect(putOptions.duplex).toBe('half');
    
    // 2. Verify body is a stream (not a buffer)
    expect(putOptions.body).toBeDefined();
    expect(Buffer.isBuffer(putOptions.body)).toBe(false);
    
    // 3. Verify Authorization header is present
    const headers = putOptions.headers || {};
    expect(headers['Authorization']).toBe('Bearer token');
  });

  it('should attach Authorization header to every image PUT in a 3-image MULTI_IMAGE_POST (3 image PUTs, 3 authenticated PUTs)', async () => {
    for (let i = 1; i <= 3; i++) {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { uploadUrl: `https://api.linkedin.com/upload/img${i}`, image: `urn:li:image:${i}` } }) });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 }); // PUT
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'AVAILABLE' }) }); // Poll
    }
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201, headers: { get: (h: string) => h === 'x-restli-id' ? 'urn:li:share:multi3' : null } });

    const mediaSource = {
      getStream: vi.fn().mockResolvedValue((async function* () { yield Buffer.from('img-bytes'); })())
    };

    vi.useFakeTimers();
    const p = provider.publish(
      { accessToken: 'secret_token_abc' },
      {
        attemptId: 'a3', targetId: 't3', workspaceId: 'w3', externalAccountId: 'user123', content: 'Three images post', providerOptions: {},
        media: [
          { mimeType: 'image/png', sizeBytes: 100, key: 's3/img1.png' },
          { mimeType: 'image/png', sizeBytes: 200, key: 's3/img2.png' },
          { mimeType: 'image/png', sizeBytes: 300, key: 's3/img3.png' },
        ]
      },
      mediaSource as any
    );
    await vi.runAllTimersAsync();
    const result = await p;
    vi.useRealTimers();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.externalPostId).toBe('urn:li:share:multi3');
    }

    const putCalls = mockFetch.mock.calls.filter((call: any[]) => call[1] && call[1].method === 'PUT' && call[0].includes('upload/img'));
    expect(putCalls.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(putCalls[i][0]).toBe(`https://api.linkedin.com/upload/img${i + 1}`);
      expect(putCalls[i][1].headers['Authorization']).toBe('Bearer secret_token_abc');
      expect(putCalls[i][1].duplex).toBe('half');
    }

    const postCall = mockFetch.mock.calls.find((c: any[]) => c[0] === 'https://api.linkedin.com/rest/posts');
    expect(postCall).toBeDefined();
    const postPayload = JSON.parse(postCall[1].body);
    expect(postPayload.content.multiImage.images).toEqual([
      { id: 'urn:li:image:1' },
      { id: 'urn:li:image:2' },
      { id: 'urn:li:image:3' },
    ]);
  });

  it('should reject untrusted upload host without sending request or leaking token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ value: { uploadUrl: 'https://evil.attacker.com/upload', image: 'urn:li:image:leak' } })
    });

    const mediaSource = { getStream: vi.fn().mockResolvedValue({}) };

    const result = await provider.publish(
      { accessToken: 'super_secret_oauth_token' },
      { attemptId: '1', targetId: '1', workspaceId: '1', externalAccountId: 'u', content: 'Testing leak', providerOptions: {}, media: [{ key: '1.jpg', mimeType: 'image/jpeg' }] },
      mediaSource as any
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('PERMANENT');
      expect(result.failureCode).toBe('INVALID_UPLOAD_URL');
      expect(result.message).not.toContain('super_secret_oauth_token');
    }

    const evilCall = mockFetch.mock.calls.find((call: any[]) => call[0] && call[0].includes('evil.attacker.com'));
    expect(evilCall).toBeUndefined();
  });

  it('should not send Authorization header to video upload URLs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: {
          video: 'urn:li:video:test',
          uploadToken: 'token123',
          uploadInstructions: [
            { firstByte: 0, lastByte: 99, uploadUrl: 'https://api.linkedin.com/video-part1' }
          ]
        }
      })
    });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ etag: '"etag1"' }) }); // part 1 PUT
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 }); // finalizeUpload
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'AVAILABLE' }) }); // poll
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201, headers: new Headers({ 'x-restli-id': 'urn:li:post:vid' }) }); // /rest/posts

    const mockMediaSource = {
      getStream: vi.fn().mockResolvedValue([Buffer.from('video-bytes-chunk')])
    };

    vi.useFakeTimers();
    const p = provider.publish(
      { accessToken: 'video_secret_token' },
      { attemptId: 'v1', targetId: 't1', workspaceId: 'w1', externalAccountId: 'u', content: 'Video test', providerOptions: {}, media: [{ mimeType: 'video/mp4', sizeBytes: 100, key: 's3/v.mp4' }] },
      mockMediaSource as any
    );
    await vi.runAllTimersAsync();
    const result = await p;
    vi.useRealTimers();

    expect(result.success).toBe(true);

    const videoPutCall = mockFetch.mock.calls.find((call: any[]) => call[0] === 'https://api.linkedin.com/video-part1' && call[1]?.method === 'PUT');
    expect(videoPutCall).toBeDefined();
    expect(videoPutCall[1].headers['Authorization']).toBeUndefined();
    expect(videoPutCall[1].headers['authorization']).toBeUndefined();
  });

  it('should reject more than 20 images with MEDIA_COUNT_EXCEEDED', async () => {
    const images = Array.from({ length: 21 }, (_, i) => ({
      mimeType: 'image/png',
      sizeBytes: 100,
      key: `s3/img${i}.png`
    }));

    const result = await provider.publish(
      { accessToken: 'token' },
      { attemptId: '1', targetId: '1', workspaceId: '1', externalAccountId: 'u', content: 'Too many', providerOptions: {}, media: images },
      { getStream: vi.fn() } as any
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failureCategory).toBe('VALIDATION');
      expect(result.failureCode).toBe('MEDIA_COUNT_EXCEEDED');
    }
  });

  it('should successfully publish a 20-image post sequentially with authenticated PUTs', async () => {
    const images = Array.from({ length: 20 }, (_, i) => ({
      mimeType: 'image/png',
      sizeBytes: 100,
      key: `s3/img${i}.png`
    }));

    for (let i = 0; i < 20; i++) {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ value: { uploadUrl: `https://api.linkedin.com/upload/batch${i}`, image: `urn:li:image:batch${i}` } }) });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 }); // PUT
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'AVAILABLE' }) }); // Poll
    }

    mockFetch.mockResolvedValueOnce({ ok: true, status: 201, headers: { get: (h: string) => h === 'x-restli-id' ? 'urn:li:share:twenty' : null } });

    const mediaSource = {
      getStream: vi.fn().mockResolvedValue((async function* () { yield Buffer.from('img'); })())
    };

    vi.useFakeTimers();
    const p = provider.publish(
      { accessToken: 'twenty_token' },
      { attemptId: 'a20', targetId: 't20', workspaceId: 'w20', externalAccountId: 'u', content: '20 images', providerOptions: {}, media: images },
      mediaSource as any
    );
    await vi.runAllTimersAsync();
    const result = await p;
    vi.useRealTimers();

    expect(result.success).toBe(true);

    const putCalls = mockFetch.mock.calls.filter((c: any[]) => c[1]?.method === 'PUT' && c[0].includes('upload/batch'));
    expect(putCalls.length).toBe(20);
    for (const call of putCalls) {
      expect(call[1].headers['Authorization']).toBe('Bearer twenty_token');
    }

    const postCall = mockFetch.mock.calls.find((c: any[]) => c[0] === 'https://api.linkedin.com/rest/posts');
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.content.multiImage.images.length).toBe(20);
  });
});
