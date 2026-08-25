import { Test, TestingModule } from '@nestjs/testing';
import { OAuthService } from './oauth.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { SocialAccountRepository } from '@agency-os/database';
import nock from 'nock';
import { vi } from 'vitest';

describe('OAuthService', () => {
  let service: OAuthService;
  let mockRedis: any;
  let mockPrisma: any;

  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.LINKEDIN_CLIENT_ID = 'test-client';
    process.env.LINKEDIN_CLIENT_SECRET = 'test-secret';
    process.env.YOUTUBE_CLIENT_ID = 'test-yt-client';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-yt-secret';
  });

  beforeEach(async () => {
    // Redis mock
    const store: Record<string, string> = {};
    mockRedis = {
      set: vi.fn((key, value) => {
        store[key] = value;
      }),
      get: vi.fn((key) => store[key] || null),
      del: vi.fn((key) => {
        delete store[key];
      }),
    };

    // Repo mock
    const mockUpsertWithConnection = vi
      .fn()
      .mockResolvedValue({ id: 'account-123' });
    mockPrisma = {
      upsertWithConnection: mockUpsertWithConnection,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedis,
        },
        {
          provide: SocialAccountRepository,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
  });

  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  it('Full happy path: connect -> callback with valid code -> account created, tokens encrypted', async () => {
    // 1. Connect
    const url = await service.generateAuthUrl(
      'linkedin',
      'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
      'f3e098a0-2f94-4d89-9e8c-5a9d82136e09',
      'http://localhost/callback',
    );
    expect(url).toContain('https://www.linkedin.com/oauth/v2/authorization');

    // Extract state from URL to simulate callback
    const parsedUrl = new URL(url);
    const state = parsedUrl.searchParams.get('state')!;

    // 2. Mock LinkedIn endpoints
    nock('https://www.linkedin.com').post('/oauth/v2/accessToken').reply(200, {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      scope: 'openid profile email',
    });

    nock('https://api.linkedin.com').get('/v2/userinfo').reply(200, {
      sub: 'li-user-123',
      name: 'LinkedIn User',
      email: 'user@linkedin.com',
      picture: 'http://pic.com/1.jpg',
    });

    // 3. Callback
    await service.handleOAuthCallback(
      'linkedin',
      'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
      state,
      'auth-code-123',
      'http://localhost/callback',
    );

    // 4. Verification
    expect(mockRedis.del).toHaveBeenCalledWith(`oauth_state:${state}`);

    expect(mockPrisma.upsertWithConnection).toHaveBeenCalledWith(
      'f3e098a0-2f94-4d89-9e8c-5a9d82136e09',
      expect.objectContaining({
        provider: 'LINKEDIN',
        externalId: 'li-user-123',
        capabilities: ['ACCOUNT_READ'],
      }),
      expect.any(Object),
    );

    const connCall = mockPrisma.upsertWithConnection.mock.calls[0][2];
    expect(connCall.encryptedAccessToken).toBeDefined();
    expect(connCall.accessTokenIv).toBeDefined();
    expect(connCall.accessTokenAuthTag).toBeDefined();
    expect(connCall.encryptedRefreshToken).toBeDefined();
    expect(connCall.refreshTokenIv).toBeDefined();
    expect(connCall.refreshTokenAuthTag).toBeDefined();
    expect(connCall.keyVersion).toBe(1);

    // Check that access token and refresh token were encrypted independently (different IVs)
    expect(connCall.accessTokenIv).not.toBe(connCall.refreshTokenIv);
    expect(connCall.encryptedAccessToken).not.toContain('mock-access-token');
    expect(connCall.encryptedRefreshToken).not.toContain('mock-refresh-token');
  });

  it('Callback with missing state -> rejected', async () => {
    await expect(
      service.handleOAuthCallback(
        'linkedin',
        'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
        'non-existent-state',
        'code',
        'url',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('Callback with expired state -> rejected', async () => {
    // Simulate expired state by not setting it in our mock store
    await expect(
      service.handleOAuthCallback(
        'linkedin',
        'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
        'expired-state',
        'code',
        'url',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('Callback with state reused twice -> second attempt rejected', async () => {
    const url = await service.generateAuthUrl(
      'linkedin',
      'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
      'f3e098a0-2f94-4d89-9e8c-5a9d82136e09',
      'http://localhost/callback',
    );
    const state = new URL(url).searchParams.get('state')!;

    nock('https://www.linkedin.com')
      .post('/oauth/v2/accessToken')
      .reply(200, { access_token: 't', scope: 'openid profile email' });
    nock('https://api.linkedin.com')
      .get('/v2/userinfo')
      .reply(200, { sub: '123' });

    // First attempt succeeds
    await service.handleOAuthCallback(
      'linkedin',
      'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
      state,
      'code',
      'url',
    );

    // Second attempt fails because state is deleted
    await expect(
      service.handleOAuthCallback(
        'linkedin',
        'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
        state,
        'code',
        'url',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('Callback with mismatched userId -> rejected', async () => {
    const url = await service.generateAuthUrl(
      'linkedin',
      'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
      'f3e098a0-2f94-4d89-9e8c-5a9d82136e09',
      'http://localhost/callback',
    );
    const state = new URL(url).searchParams.get('state')!;

    // Different user attempts to use the state
    await expect(
      service.handleOAuthCallback('linkedin', 'user-2', state, 'code', 'url'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('Callback with malformed state data -> rejected', async () => {
    // Manually write malformed state data into Redis (workspaceId is a number, missing createdAt)
    const badState = 'bad-state-123';
    await mockRedis.set(
      `oauth_state:${badState}`,
      JSON.stringify({
        userId: 'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
        workspaceId: 12345, // Invalid, should be string/uuid
        provider: 'LINKEDIN',
        codeVerifier: 'verifier',
      }),
    );

    await expect(
      service.handleOAuthCallback(
        'linkedin',
        'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
        badState,
        'code',
        'url',
      ),
    ).rejects.toThrow(
      new ForbiddenException('Invalid or corrupted state data'),
    );
  });

  it('Encrypts access and refresh tokens independently with distinct IVs', async () => {
    const url = await service.generateAuthUrl(
      'linkedin',
      'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
      'f3e098a0-2f94-4d89-9e8c-5a9d82136e09',
      'http://localhost/callback',
    );
    const state = new URL(url).searchParams.get('state')!;

    nock('https://www.linkedin.com').post('/oauth/v2/accessToken').reply(200, {
      access_token: 'token1',
      refresh_token: 'token2',
      scope: 'openid',
    });
    nock('https://api.linkedin.com')
      .get('/v2/userinfo')
      .reply(200, { sub: '123' });

    await service.handleOAuthCallback(
      'linkedin',
      'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
      state,
      'code',
      'url',
    );

    const connCall = mockPrisma.upsertWithConnection.mock.calls[0][2];
    expect(connCall.accessTokenIv).toBeDefined();
    expect(connCall.refreshTokenIv).toBeDefined();
    expect(connCall.accessTokenIv).not.toBe(connCall.refreshTokenIv);
  });

  it('Rejects an unknown provider string', async () => {
    await expect(
      service.handleOAuthCallback(
        'fake',
        'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
        'state',
        'code',
        'url',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('Full happy path for YouTube: connect -> callback with valid code -> account created, tokens encrypted', async () => {
    // 1. Connect
    const url = await service.generateAuthUrl(
      'youtube',
      'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
      'f3e098a0-2f94-4d89-9e8c-5a9d82136e09',
      'http://localhost/callback',
    );
    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');

    // Extract state from URL to simulate callback
    const parsedUrl = new URL(url);
    const state = parsedUrl.searchParams.get('state')!;

    // 2. Mock YouTube endpoints
    nock('https://oauth2.googleapis.com').post('/token').reply(200, {
      access_token: 'mock-yt-access-token',
      refresh_token: 'mock-yt-refresh-token',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
    });

    nock('https://youtube.googleapis.com')
      .get('/youtube/v3/channels')
      .query({ part: 'snippet', mine: 'true' })
      .reply(200, {
        items: [
          {
            id: 'yt-channel-123',
            snippet: {
              title: 'YouTube Channel',
              thumbnails: {
                default: { url: 'http://pic.com/yt.jpg' },
              },
            },
          },
        ],
      });

    // 3. Callback
    await service.handleOAuthCallback(
      'youtube',
      'b0e4c6c0-6f0a-47b8-80e9-74f4b4c730e2',
      state,
      'auth-code-123',
      'http://localhost/callback',
    );

    // 4. Verification
    expect(mockRedis.del).toHaveBeenCalledWith(`oauth_state:${state}`);

    expect(mockPrisma.upsertWithConnection).toHaveBeenCalledWith(
      'f3e098a0-2f94-4d89-9e8c-5a9d82136e09',
      expect.objectContaining({
        provider: 'YOUTUBE',
        externalId: 'yt-channel-123',
        capabilities: ['ACCOUNT_READ', 'ANALYTICS_READ'],
      }),
      expect.any(Object),
    );
  });
});
