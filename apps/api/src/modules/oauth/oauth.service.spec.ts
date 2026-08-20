import { Test, TestingModule } from '@nestjs/testing';
import { OAuthService } from './oauth.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@agency-os/database';
import nock from 'nock';
import { vi } from 'vitest';

describe('OAuthService', () => {
  let service: OAuthService;
  let mockRedis: any;
  let mockPrisma: any;

  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.LINKEDIN_CLIENT_ID = 'test-client';
    process.env.LINKEDIN_CLIENT_SECRET = 'test-secret';
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

    // Prisma mock
    const mockUpsertAccount = vi.fn().mockResolvedValue({ id: 'account-123' });
    const mockUpsertConnection = vi.fn().mockResolvedValue({ id: 'conn-123' });
    mockPrisma = {
      $transaction: vi.fn(async (cb) => cb(mockPrisma)),
      socialAccount: {
        upsert: mockUpsertAccount,
      },
      socialConnection: {
        upsert: mockUpsertConnection,
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedis,
        },
        {
          provide: PrismaClient,
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
    const url = await service.generateLinkedInAuthUrl('user-1', 'ws-1', 'http://localhost/callback');
    expect(url).toContain('https://www.linkedin.com/oauth/v2/authorization');
    
    // Extract state from URL to simulate callback
    const parsedUrl = new URL(url);
    const state = parsedUrl.searchParams.get('state')!;

    // 2. Mock LinkedIn endpoints
    nock('https://www.linkedin.com')
      .post('/oauth/v2/accessToken')
      .reply(200, {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        scope: 'openid profile email',
      });

    nock('https://api.linkedin.com')
      .get('/v2/userinfo')
      .reply(200, {
        sub: 'li-user-123',
        name: 'LinkedIn User',
        email: 'user@linkedin.com',
        picture: 'http://pic.com/1.jpg',
      });

    // 3. Callback
    await service.handleLinkedInCallback('user-1', state, 'auth-code-123', 'http://localhost/callback');

    // 4. Verification
    expect(mockRedis.del).toHaveBeenCalledWith(`oauth_state:${state}`);
    
    expect(mockPrisma.socialAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        provider: 'LINKEDIN',
        externalId: 'li-user-123',
        capabilities: ['ACCOUNT_READ'],
      }),
    }));

    const connCall = mockPrisma.socialConnection.upsert.mock.calls[0][0];
    expect(connCall.create.encryptedAccessToken).toBeDefined();
    expect(connCall.create.accessTokenIv).toBeDefined();
    expect(connCall.create.accessTokenAuthTag).toBeDefined();
    expect(connCall.create.encryptedRefreshToken).toBeDefined();
    expect(connCall.create.refreshTokenIv).toBeDefined();
    expect(connCall.create.refreshTokenAuthTag).toBeDefined();
    expect(connCall.create.keyVersion).toBe(1);
    
    // Check that access token and refresh token were encrypted independently (different IVs)
    expect(connCall.create.accessTokenIv).not.toBe(connCall.create.refreshTokenIv);
    expect(connCall.create.encryptedAccessToken).not.toContain('mock-access-token');
    expect(connCall.create.encryptedRefreshToken).not.toContain('mock-refresh-token');
  });

  it('Callback with missing state -> rejected', async () => {
    await expect(service.handleLinkedInCallback('user-1', 'non-existent-state', 'code', 'url'))
      .rejects.toThrow(ForbiddenException);
  });

  it('Callback with expired state -> rejected', async () => {
    // Simulate expired state by not setting it in our mock store
    await expect(service.handleLinkedInCallback('user-1', 'expired-state', 'code', 'url'))
      .rejects.toThrow(ForbiddenException);
  });

  it('Callback with state reused twice -> second attempt rejected', async () => {
    const url = await service.generateLinkedInAuthUrl('user-1', 'ws-1', 'http://localhost/callback');
    const state = new URL(url).searchParams.get('state')!;

    nock('https://www.linkedin.com').post('/oauth/v2/accessToken').reply(200, { access_token: 't', scope: 'openid profile email' });
    nock('https://api.linkedin.com').get('/v2/userinfo').reply(200, { sub: '123' });

    // First attempt succeeds
    await service.handleLinkedInCallback('user-1', state, 'code', 'url');

    // Second attempt fails because state is deleted
    await expect(service.handleLinkedInCallback('user-1', state, 'code', 'url'))
      .rejects.toThrow(ForbiddenException);
  });

  it('Callback with mismatched userId -> rejected', async () => {
    const url = await service.generateLinkedInAuthUrl('user-1', 'ws-1', 'http://localhost/callback');
    const state = new URL(url).searchParams.get('state')!;

    // Different user attempts to use the state
    await expect(service.handleLinkedInCallback('user-2', state, 'code', 'url'))
      .rejects.toThrow(ForbiddenException);
  });

  it('Encrypts access and refresh tokens independently with distinct IVs', async () => {
    const url = await service.generateLinkedInAuthUrl('user-1', 'ws-1', 'http://localhost/callback');
    const state = new URL(url).searchParams.get('state')!;

    nock('https://www.linkedin.com').post('/oauth/v2/accessToken').reply(200, {
      access_token: 'token1',
      refresh_token: 'token2',
      scope: 'openid'
    });
    nock('https://api.linkedin.com').get('/v2/userinfo').reply(200, { sub: '123' });

    await service.handleLinkedInCallback('user-1', state, 'code', 'url');

    const connCall = mockPrisma.socialConnection.upsert.mock.calls[0][0];
    expect(connCall.create.accessTokenIv).toBeDefined();
    expect(connCall.create.refreshTokenIv).toBeDefined();
    expect(connCall.create.accessTokenIv).not.toBe(connCall.create.refreshTokenIv);
  });
});
