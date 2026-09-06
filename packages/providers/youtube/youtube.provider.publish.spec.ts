import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { YouTubeProvider } from './youtube.provider';
import { Readable } from 'stream';
import { google } from 'googleapis';

vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        OAuth2: vi.fn().mockImplementation(() => ({
          setCredentials: vi.fn(),
        })),
      },
      youtube: vi.fn().mockReturnValue({
        videos: {
          insert: vi.fn().mockResolvedValue({
            data: { id: 'fake-youtube-id' }
          })
        }
      }),
    },
  };
});

describe('YouTubeProvider Publishing', () => {
  let provider: YouTubeProvider;

  beforeEach(() => {
    process.env.YOUTUBE_CLIENT_ID = 'test-client';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-secret';
    provider = new YouTubeProvider();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fails if no mediaSource is provided (MEDIA_STORAGE_BLOCKER)', async () => {
    const res = await provider.publish(
      { accessToken: 'fake-token' },
      { attemptId: '1', targetId: '2', workspaceId: 'ws-1', content: 'hello', media: [{ key: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 100 }], providerOptions: {} },
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.failureCode).toBe('MEDIA_STORAGE_BLOCKER');
    }
  });

  it('can publish with mediaSource', async () => {
    const mediaSource = {
      getStream: vi.fn().mockResolvedValue(new Readable({ read() {} }))
    };
    
    const res = await provider.publish(
      { accessToken: 'fake-token' },
      {
        attemptId: '1',
        targetId: '2',
        workspaceId: 'ws-1',
        content: 'hello',
        media: [{ key: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 100 }],
        providerOptions: {}
      },
      mediaSource
    );
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.externalPostId).toBe('fake-youtube-id');
      expect(res.processingState).toBe('PROCESSING');
      expect(res.canonicalUrl).toBe('https://www.youtube.com/watch?v=fake-youtube-id');
    }
  });

  it('returns rate limit error on quota exceeded (403)', async () => {
    const mockInsert = vi.fn().mockRejectedValue({ code: 403, errors: [{ reason: 'quotaExceeded' }] });
    vi.mocked(google.youtube).mockReturnValueOnce({
      videos: { insert: mockInsert }
    } as any);

    const mediaSource = { getStream: vi.fn().mockResolvedValue(new Readable({ read() {} })) };
    
    const res = await provider.publish(
      { accessToken: 'fake-token' },
      { attemptId: '1', targetId: '2', workspaceId: 'ws-1', content: 'hello', media: [{ key: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 100 }], providerOptions: {} },
      mediaSource
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.failureCategory).toBe('RATE_LIMITED');
      expect(res.failureCode).toBe('YOUTUBE_QUOTA_EXHAUSTED');
    }
  });
  
  it('returns PROVIDER_SCOPE_REQUIRED on insufficientPermissions (403)', async () => {
    const mockInsert = vi.fn().mockRejectedValue({ code: 403, errors: [{ reason: 'insufficientPermissions' }] });
    vi.mocked(google.youtube).mockReturnValueOnce({
      videos: { insert: mockInsert }
    } as any);

    const mediaSource = { getStream: vi.fn().mockResolvedValue(new Readable({ read() {} })) };
    
    const res = await provider.publish(
      { accessToken: 'fake-token' },
      { attemptId: '1', targetId: '2', workspaceId: 'ws-1', content: 'hello', media: [{ key: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 100 }], providerOptions: {} },
      mediaSource
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.failureCategory).toBe('AUTH_REQUIRED');
      expect(res.failureCode).toBe('PROVIDER_SCOPE_REQUIRED');
    }
  });

  it('returns generic forbidden on unknown 403', async () => {
    const mockInsert = vi.fn().mockRejectedValue({ code: 403, errors: [{ reason: 'someOtherReason' }] });
    vi.mocked(google.youtube).mockReturnValueOnce({
      videos: { insert: mockInsert }
    } as any);

    const mediaSource = { getStream: vi.fn().mockResolvedValue(new Readable({ read() {} })) };
    
    const res = await provider.publish(
      { accessToken: 'fake-token' },
      { attemptId: '1', targetId: '2', workspaceId: 'ws-1', content: 'hello', media: [{ key: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 100 }], providerOptions: {} },
      mediaSource
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.failureCategory).toBe('AUTH_REQUIRED');
      expect(res.failureCode).toBe('YOUTUBE_UPLOAD_FORBIDDEN');
    }
  });

  it('returns YOUTUBE_AUTH_REQUIRED on 401', async () => {
    const mockInsert = vi.fn().mockRejectedValue({ code: 401 });
    vi.mocked(google.youtube).mockReturnValueOnce({
      videos: { insert: mockInsert }
    } as any);

    const mediaSource = { getStream: vi.fn().mockResolvedValue(new Readable({ read() {} })) };
    
    const res = await provider.publish(
      { accessToken: 'fake-token' },
      { attemptId: '1', targetId: '2', workspaceId: 'ws-1', content: 'hello', media: [{ key: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 100 }], providerOptions: {} },
      mediaSource
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.failureCategory).toBe('AUTH_REQUIRED');
      expect(res.failureCode).toBe('YOUTUBE_AUTH_REQUIRED');
    }
  });

  it('returns RATE_LIMITED on 429', async () => {
    const mockInsert = vi.fn().mockRejectedValue({ code: 429, response: { headers: { 'retry-after': '60' } } });
    vi.mocked(google.youtube).mockReturnValueOnce({
      videos: { insert: mockInsert }
    } as any);

    const mediaSource = { getStream: vi.fn().mockResolvedValue(new Readable({ read() {} })) };
    
    const res = await provider.publish(
      { accessToken: 'fake-token' },
      { attemptId: '1', targetId: '2', workspaceId: 'ws-1', content: 'hello', media: [{ key: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 100 }], providerOptions: {} },
      mediaSource
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.failureCategory).toBe('RATE_LIMITED');
      expect(res.failureCode).toBe('YOUTUBE_RATE_LIMITED');
      expect(res.retryAfterSeconds).toBe(60);
    }
  });

  it('returns YOUTUBE_INVALID_METADATA on 400', async () => {
    const mockInsert = vi.fn().mockRejectedValue({ code: 400 });
    vi.mocked(google.youtube).mockReturnValueOnce({
      videos: { insert: mockInsert }
    } as any);

    const mediaSource = { getStream: vi.fn().mockResolvedValue(new Readable({ read() {} })) };
    
    const res = await provider.publish(
      { accessToken: 'fake-token' },
      { attemptId: '1', targetId: '2', workspaceId: 'ws-1', content: 'hello', media: [{ key: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 100 }], providerOptions: {} },
      mediaSource
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.failureCategory).toBe('VALIDATION');
      expect(res.failureCode).toBe('YOUTUBE_INVALID_METADATA');
    }
  });

  it('returns unknown result on 5xx', async () => {
    const mockInsert = vi.fn().mockRejectedValue({ code: 503 });
    vi.mocked(google.youtube).mockReturnValueOnce({
      videos: { insert: mockInsert }
    } as any);

    const mediaSource = {
      getStream: vi.fn().mockResolvedValue(new Readable({ read() {} }))
    };
    
    const res = await provider.publish(
      { accessToken: 'fake-token' },
      { attemptId: '1', targetId: '2', workspaceId: 'ws-1', content: 'hello', media: [{ key: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 100 }], providerOptions: {} },
      mediaSource
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.failureCategory).toBe('UNKNOWN_RESULT');
      expect(res.failureCode).toBe('YOUTUBE_UPLOAD_OUTCOME_UNKNOWN');
    }
  });
  
  it('does not leak raw provider error secrets', async () => {
    const secretError = new Error('Some error with sensitive SECRET_ACCESS_TOKEN');
    (secretError as any).code = 500;
    
    const mockInsert = vi.fn().mockRejectedValue(secretError);
    vi.mocked(google.youtube).mockReturnValueOnce({
      videos: { insert: mockInsert }
    } as any);

    const mediaSource = { getStream: vi.fn().mockResolvedValue(new Readable({ read() {} })) };
    
    const res = await provider.publish(
      { accessToken: 'fake-token' },
      { attemptId: '1', targetId: '2', workspaceId: 'ws-1', content: 'hello', media: [{ key: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 100 }], providerOptions: {} },
      mediaSource
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.failureCategory).toBe('UNKNOWN_RESULT');
      // Ensure the raw message is NOT passed through directly
      expect(res.message).not.toContain('SECRET_ACCESS_TOKEN');
      expect((res as any).rawError).toBeUndefined(); // Should not include rawError
    }
  });
});
