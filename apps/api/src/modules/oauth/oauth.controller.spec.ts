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
  });

  afterEach(() => {
    vi.clearAllMocks();
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
      );
      expect(mockRes.redirect).toHaveBeenCalledWith(
        `http://localhost:3000/${workspaceId}/accounts`,
      );

      // Ensure no sensitive OAuth data (tokens/code) is in redirect URL
      const redirectUrl = mockRes.redirect.mock.calls[0][0];
      expect(redirectUrl).not.toContain('auth-code');
      expect(redirectUrl).not.toContain('valid-state');
      expect(redirectUrl).not.toContain('token');

      expect(mockAuditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OAUTH_CONNECTION_SUCCEEDED',
        }),
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

      expect(mockAuditService.logAction).toHaveBeenCalledWith(
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
      expect(mockAuditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'OAUTH_CONNECTION_FAILED',
          metadata: expect.objectContaining({
            provider: 'YOUTUBE',
            reason: 'OAUTH_CALLBACK_FAILED',
          }),
        }),
      );
    });

    it('throws ForbiddenException if code or state is missing', async () => {
      await expect(
        controller.callbackProvider(
          SocialProvider.YOUTUBE,
          { code: '', state: 'state' },
          mockReq as Request,
          mockRes as Response,
        ),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        controller.callbackProvider(
          SocialProvider.YOUTUBE,
          { code: 'code', state: '' },
          mockReq as Request,
          mockRes as Response,
        ),
      ).rejects.toThrow(ForbiddenException);
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
      expect(mockAuditService.logAction).toHaveBeenCalledWith(
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
