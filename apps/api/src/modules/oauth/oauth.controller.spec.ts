import { Test, TestingModule } from '@nestjs/testing';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { vi } from 'vitest';

import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { SocialProvider } from '@agency-os/database';

import { AuditService } from '../core/audit.service';
import { getLoggerToken } from 'nestjs-pino';

describe('OAuthController', () => {
  let controller: OAuthController;
  let mockOAuthService: any;
  let mockAuditService: any;
  let mockReq: any;
  let mockRes: any;

  beforeEach(async () => {
    mockOAuthService = {
      generateAuthUrl: vi.fn(),
      handleOAuthCallback: vi.fn(),
    };

    mockAuditService = {
      logAction: vi.fn(),
      logActionBestEffort: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthController],
      providers: [
        {
          provide: OAuthService,
          useValue: mockOAuthService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: getLoggerToken(OAuthController.name),
          useValue: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            setContext: vi.fn(),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OAuthController>(OAuthController);

    mockReq = {
      id: 'req-1',
      user: { id: 'user-123' },
      protocol: 'http',
      get: vi.fn().mockReturnValue('localhost:3001'),
    };

    mockRes = {
      redirect: vi.fn(),
    };

    process.env.FRONTEND_URL = 'http://localhost:3000';
    delete process.env.API_PUBLIC_URL;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.API_PUBLIC_URL;
  });

  describe('connectProvider', () => {
    it('uses configured API_PUBLIC_URL for redirectUri and ignores Host headers', async () => {
      process.env.API_PUBLIC_URL = 'https://api.agency-os.com';
      mockReq.get.mockReturnValue('attacker.example.com');
      mockOAuthService.generateAuthUrl.mockResolvedValue(
        'https://accounts.google.com/auth',
      );

      const result = await controller.connectProvider(
        'workspace-123',
        SocialProvider.YOUTUBE,
        undefined,
        mockReq as Request,
      );

      expect(mockOAuthService.generateAuthUrl).toHaveBeenCalledWith(
        SocialProvider.YOUTUBE,
        'user-123',
        'workspace-123',
        'https://api.agency-os.com/api/v1/oauth/youtube/callback',
        undefined,
      );
      expect(result).toEqual({ url: 'https://accounts.google.com/auth' });
    });

    it('normalizes trailing slashes in API_PUBLIC_URL', async () => {
      process.env.API_PUBLIC_URL = 'https://api.agency-os.com///';
      mockOAuthService.generateAuthUrl.mockResolvedValue(
        'https://accounts.google.com/auth',
      );

      await controller.connectProvider(
        'workspace-123',
        SocialProvider.YOUTUBE,
        undefined,
        mockReq as Request,
      );

      expect(mockOAuthService.generateAuthUrl).toHaveBeenCalledWith(
        SocialProvider.YOUTUBE,
        'user-123',
        'workspace-123',
        'https://api.agency-os.com/api/v1/oauth/youtube/callback',
        undefined,
      );
    });

    it('falls back to local port in development when API_PUBLIC_URL is unset', async () => {
      delete process.env.API_PUBLIC_URL;
      mockOAuthService.generateAuthUrl.mockResolvedValue(
        'https://accounts.google.com/auth',
      );

      await controller.connectProvider(
        'workspace-123',
        SocialProvider.YOUTUBE,
        undefined,
        mockReq as Request,
      );

      expect(mockOAuthService.generateAuthUrl).toHaveBeenCalledWith(
        SocialProvider.YOUTUBE,
        'user-123',
        'workspace-123',
        'http://localhost:3001/api/v1/oauth/youtube/callback',
        undefined,
      );
    });

    it('maintains consistent callback URI construction across all providers (LinkedIn, YouTube, Meta)', async () => {
      process.env.API_PUBLIC_URL = 'https://api.agency-os.com';
      mockOAuthService.generateAuthUrl.mockResolvedValue(
        'https://provider.auth',
      );

      await controller.connectProvider(
        'workspace-123',
        SocialProvider.LINKEDIN,
        undefined,
        mockReq as Request,
      );
      expect(mockOAuthService.generateAuthUrl).toHaveBeenCalledWith(
        SocialProvider.LINKEDIN,
        'user-123',
        'workspace-123',
        'https://api.agency-os.com/api/v1/oauth/linkedin/callback',
        undefined,
      );

      await controller.connectProvider(
        'workspace-123',
        SocialProvider.FACEBOOK,
        undefined,
        mockReq as Request,
      );
      expect(mockOAuthService.generateAuthUrl).toHaveBeenCalledWith(
        SocialProvider.FACEBOOK,
        'user-123',
        'workspace-123',
        'https://api.agency-os.com/api/v1/oauth/facebook/callback',
        undefined,
      );

      await controller.connectProvider(
        'workspace-123',
        'META' as any,
        undefined,
        mockReq as Request,
      );
      expect(mockOAuthService.generateAuthUrl).toHaveBeenCalledWith(
        'META',
        'user-123',
        'workspace-123',
        'https://api.agency-os.com/api/v1/oauth/meta/callback',
        undefined,
      );
    });
  });

  describe('callbackProvider', () => {
    it('redirects to the correct workspace accounts page on success', async () => {
      const workspaceId = 'workspace-123';
      const socialAccountId = 'account-123';
      mockOAuthService.handleOAuthCallback.mockResolvedValue({
        workspaceId,
        socialAccountId,
        isNew: true,
      });

      await controller.callbackProvider(
        SocialProvider.YOUTUBE,
        { code: 'auth-code', state: 'valid-state' },
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockOAuthService.handleOAuthCallback).toHaveBeenCalledWith(
        SocialProvider.YOUTUBE,
        'user-123',
        'valid-state',
        'auth-code',
        'http://localhost:3001/api/v1/oauth/youtube/callback',
        'req-1',
      );
      expect(mockRes.redirect).toHaveBeenCalledWith(
        `http://localhost:3000/${workspaceId}/accounts`,
      );

      // Ensure no sensitive OAuth data (tokens/code) is in redirect URL
      const redirectUrl = mockRes.redirect.mock.calls[0][0];
      expect(redirectUrl).not.toContain('auth-code');
      expect(redirectUrl).not.toContain('valid-state');
      expect(redirectUrl).not.toContain('token');

      expect(mockAuditService.logActionBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OAUTH_CONNECTION_SUCCEEDED',
        }),
      );
    });

    it('uses configured API_PUBLIC_URL for callback and ignores Host and X-Forwarded-Host', async () => {
      process.env.API_PUBLIC_URL = 'https://api.agency-os.com';
      mockReq.get.mockReturnValue('attacker.example.com');
      mockReq.headers = {
        host: 'attacker.example.com',
        'x-forwarded-host': 'evil.example.com',
      };

      mockOAuthService.handleOAuthCallback.mockResolvedValue({
        workspaceId: 'workspace-123',
        socialAccountId: 'account-123',
        isNew: true,
      });

      await controller.callbackProvider(
        SocialProvider.YOUTUBE,
        { code: 'auth-code', state: 'valid-state' },
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockOAuthService.handleOAuthCallback).toHaveBeenCalledWith(
        SocialProvider.YOUTUBE,
        'user-123',
        'valid-state',
        'auth-code',
        'https://api.agency-os.com/api/v1/oauth/youtube/callback',
        'req-1',
      );
    });

    it('normalizes trailing slashes in API_PUBLIC_URL during callback handling', async () => {
      process.env.API_PUBLIC_URL = 'https://api.agency-os.com///';
      mockOAuthService.handleOAuthCallback.mockResolvedValue({
        workspaceId: 'workspace-123',
        socialAccountId: 'account-123',
        isNew: true,
      });

      await controller.callbackProvider(
        SocialProvider.YOUTUBE,
        { code: 'auth-code', state: 'valid-state' },
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockOAuthService.handleOAuthCallback).toHaveBeenCalledWith(
        SocialProvider.YOUTUBE,
        'user-123',
        'valid-state',
        'auth-code',
        'https://api.agency-os.com/api/v1/oauth/youtube/callback',
        'req-1',
      );
    });

    it('maintains consistent callback URI construction across all providers during callback', async () => {
      process.env.API_PUBLIC_URL = 'https://api.agency-os.com';
      mockOAuthService.handleOAuthCallback.mockResolvedValue({
        workspaceId: 'workspace-123',
        socialAccountId: 'account-123',
        isNew: true,
      });

      await controller.callbackProvider(
        SocialProvider.LINKEDIN,
        { code: 'auth-code', state: 'valid-state' },
        mockReq as Request,
        mockRes as Response,
      );
      expect(mockOAuthService.handleOAuthCallback).toHaveBeenCalledWith(
        SocialProvider.LINKEDIN,
        'user-123',
        'valid-state',
        'auth-code',
        'https://api.agency-os.com/api/v1/oauth/linkedin/callback',
        'req-1',
      );

      await controller.callbackProvider(
        SocialProvider.FACEBOOK,
        { code: 'auth-code', state: 'valid-state' },
        mockReq as Request,
        mockRes as Response,
      );
      expect(mockOAuthService.handleOAuthCallback).toHaveBeenCalledWith(
        SocialProvider.FACEBOOK,
        'user-123',
        'valid-state',
        'auth-code',
        'https://api.agency-os.com/api/v1/oauth/facebook/callback',
        'req-1',
      );

      await controller.callbackProvider(
        'META' as any,
        { code: 'auth-code', state: 'valid-state' },
        mockReq as Request,
        mockRes as Response,
      );
      expect(mockOAuthService.handleOAuthCallback).toHaveBeenCalledWith(
        'META',
        'user-123',
        'valid-state',
        'auth-code',
        'https://api.agency-os.com/api/v1/oauth/meta/callback',
        'req-1',
      );
    });

    it('emits OAUTH_RECONNECTED when account already exists', async () => {
      const workspaceId = 'workspace-123';
      const socialAccountId = 'account-123';
      mockOAuthService.handleOAuthCallback.mockResolvedValue({
        workspaceId,
        socialAccountId,
        isNew: false,
      });

      await controller.callbackProvider(
        SocialProvider.YOUTUBE,
        { code: 'auth-code', state: 'valid-state' },
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockAuditService.logActionBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OAUTH_RECONNECTED',
        }),
      );
    });

    it('redirects to the error page on failure with safe message', async () => {
      mockOAuthService.handleOAuthCallback.mockRejectedValue(
        new ForbiddenException('Invalid state'),
      );

      await controller.callbackProvider(
        SocialProvider.YOUTUBE,
        { code: 'auth-code', state: 'invalid-state' },
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/dashboard?error=oauth_failed',
      );
      expect(mockAuditService.logActionBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OAUTH_CONNECTION_FAILED',
          metadata: expect.objectContaining({
            provider: 'YOUTUBE',
            reason: 'OAUTH_CALLBACK_FAILED',
          }),
        }),
      );
    });

    it('throws ForbiddenException and emits audit failure if code is missing', async () => {
      mockAuditService.logActionBestEffort.mockClear();

      await expect(
        controller.callbackProvider(
          SocialProvider.YOUTUBE,
          { code: '', state: 'sensitive-state-token' },
          mockReq as Request,
          mockRes as Response,
        ),
      ).rejects.toThrow(new ForbiddenException('Missing code or state'));

      expect(mockAuditService.logActionBestEffort).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logActionBestEffort).toHaveBeenCalledWith({
        action: 'OAUTH_CONNECTION_FAILED',
        actorId: 'user-123',
        targetType: 'SocialProvider',
        targetId: SocialProvider.YOUTUBE,
        requestId: 'req-1',
        metadata: {
          provider: SocialProvider.YOUTUBE,
          reason: 'MISSING_CODE',
        },
      });

      // Verify no sensitive state parameter leaked into audit metadata
      const callArg = mockAuditService.logActionBestEffort.mock.calls[0][0];
      expect(JSON.stringify(callArg)).not.toContain('sensitive-state-token');
    });

    it('throws ForbiddenException and emits audit failure if state is missing', async () => {
      mockAuditService.logActionBestEffort.mockClear();

      await expect(
        controller.callbackProvider(
          SocialProvider.YOUTUBE,
          { code: 'sensitive-auth-code', state: '' },
          mockReq as Request,
          mockRes as Response,
        ),
      ).rejects.toThrow(new ForbiddenException('Missing code or state'));

      expect(mockAuditService.logActionBestEffort).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logActionBestEffort).toHaveBeenCalledWith({
        action: 'OAUTH_CONNECTION_FAILED',
        actorId: 'user-123',
        targetType: 'SocialProvider',
        targetId: SocialProvider.YOUTUBE,
        requestId: 'req-1',
        metadata: {
          provider: SocialProvider.YOUTUBE,
          reason: 'MISSING_STATE',
        },
      });

      // Verify no sensitive auth code parameter leaked into audit metadata
      const callArg = mockAuditService.logActionBestEffort.mock.calls[0][0];
      expect(JSON.stringify(callArg)).not.toContain('sensitive-auth-code');
    });

    it('throws ForbiddenException and emits audit failure if both code and state are missing', async () => {
      mockAuditService.logActionBestEffort.mockClear();

      await expect(
        controller.callbackProvider(
          SocialProvider.YOUTUBE,
          { code: '', state: '' },
          mockReq as Request,
          mockRes as Response,
        ),
      ).rejects.toThrow(new ForbiddenException('Missing code or state'));

      expect(mockAuditService.logActionBestEffort).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logActionBestEffort).toHaveBeenCalledWith({
        action: 'OAUTH_CONNECTION_FAILED',
        actorId: 'user-123',
        targetType: 'SocialProvider',
        targetId: SocialProvider.YOUTUBE,
        requestId: 'req-1',
        metadata: {
          provider: SocialProvider.YOUTUBE,
          reason: 'MISSING_CODE_AND_STATE',
        },
      });
    });

    it('emits OAUTH_PROVIDER_DENIED when callback has error in query', async () => {
      await controller.callbackProvider(
        SocialProvider.YOUTUBE,
        { error: 'access_denied' } as any,
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/dashboard?error=oauth_failed',
      );
      expect(mockAuditService.logActionBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OAUTH_CONNECTION_FAILED',
          metadata: {
            provider: SocialProvider.YOUTUBE,
            reason: 'OAUTH_PROVIDER_DENIED',
          },
        }),
      );
    });
  });
});
