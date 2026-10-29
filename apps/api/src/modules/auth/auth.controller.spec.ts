import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService, InvalidCredentialsException } from './auth.service';
import { WorkspaceMemberRepository, AuditAction } from '@agency-os/database';
import { AuditService } from '../core/audit.service';
import { AuthGuard } from './guards/auth.guard';
import type { Request, Response } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let authServiceMock: any;
  let memberRepoMock: any;
  let auditServiceMock: any;
  let reqMock: any;
  let resMock: any;

  beforeEach(async () => {
    authServiceMock = {
      login: vi.fn(),
      logout: vi.fn(),
    };

    memberRepoMock = {
      findMembershipsByUserId: vi.fn(),
    };

    auditServiceMock = {
      logAction: vi.fn(),
      logActionBestEffort: vi.fn(),
    };

    resMock = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    };

    reqMock = {
      id: 'req-auth-123',
      cookies: { session: 'sess-abc-123' },
      user: { id: 'user-auth-1' },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: WorkspaceMemberRepository, useValue: memberRepoMock },
        { provide: AuditService, useValue: auditServiceMock },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('login', () => {
    it('emits AUTH_LOGIN_SUCCEEDED via logActionBestEffort on successful login and does not leak credentials', async () => {
      authServiceMock.login.mockResolvedValueOnce({
        sessionId: 'sess-1',
        user: { id: 'user-auth-1', email: 'test@example.com' },
      });

      const res = await controller.login(
        { email: 'test@example.com', password: 'secretpassword123' },
        reqMock as Request,
        resMock as Response,
      );

      expect(res).toEqual({ message: 'Logged in successfully' });
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledTimes(1);
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_LOGIN_SUCCEEDED,
        actorId: 'user-auth-1',
        targetType: 'User',
        targetId: 'user-auth-1',
        requestId: 'req-auth-123',
      });

      const callArgs = auditServiceMock.logActionBestEffort.mock.calls[0][0];
      const payloadStr = JSON.stringify(callArgs);
      expect(payloadStr).not.toContain('secretpassword123');
      expect(payloadStr).not.toContain('sess-1');
      expect(resMock.cookie).toHaveBeenCalledWith(
        'session',
        'sess-1',
        expect.any(Object),
      );
      expect(resMock.cookie).toHaveBeenCalledWith(
        'csrfToken',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('emits AUTH_LOGIN_FAILED with reason USER_NOT_FOUND and no targetId when account does not exist', async () => {
      authServiceMock.login.mockRejectedValueOnce(
        new InvalidCredentialsException('USER_NOT_FOUND'),
      );

      let caughtError: any;
      try {
        await controller.login(
          { email: 'nonexistent@example.com', password: 'secretpassword123' },
          reqMock as Request,
          resMock as Response,
        );
      } catch (e) {
        caughtError = e;
      }

      expect(caughtError).toBeInstanceOf(InvalidCredentialsException);
      expect(caughtError.getStatus()).toBe(401);
      expect(caughtError.message).toBe('Invalid credentials');
      expect(caughtError.name).toBe('UnauthorizedException');

      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledTimes(1);
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_LOGIN_FAILED,
        targetType: 'User',
        requestId: 'req-auth-123',
        metadata: { reason: 'USER_NOT_FOUND' },
      });

      const callArgs = auditServiceMock.logActionBestEffort.mock.calls[0][0];
      expect(callArgs.targetId).toBeUndefined();
      expect(callArgs.actorId).toBeUndefined();

      const payloadStr = JSON.stringify(callArgs);
      expect(payloadStr).not.toContain('secretpassword123');
      expect(payloadStr).not.toContain('nonexistent@example.com');
    });

    it('emits AUTH_LOGIN_FAILED with reason INVALID_PASSWORD and safe targetId when password verification fails', async () => {
      authServiceMock.login.mockRejectedValueOnce(
        new InvalidCredentialsException('INVALID_PASSWORD', 'user-target-888'),
      );

      let caughtError: any;
      try {
        await controller.login(
          { email: 'validuser@example.com', password: 'wrongpassword' },
          reqMock as Request,
          resMock as Response,
        );
      } catch (e) {
        caughtError = e;
      }

      expect(caughtError).toBeInstanceOf(InvalidCredentialsException);
      expect(caughtError.getStatus()).toBe(401);
      expect(caughtError.message).toBe('Invalid credentials');
      expect(caughtError.name).toBe('UnauthorizedException');

      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledTimes(1);
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_LOGIN_FAILED,
        targetType: 'User',
        targetId: 'user-target-888',
        requestId: 'req-auth-123',
        metadata: { reason: 'INVALID_PASSWORD' },
      });

      const callArgs = auditServiceMock.logActionBestEffort.mock.calls[0][0];
      expect(callArgs.targetId).toBe('user-target-888');
      expect(callArgs.actorId).toBeUndefined();

      const payloadStr = JSON.stringify(callArgs);
      expect(payloadStr).not.toContain('wrongpassword');
      expect(payloadStr).not.toContain('validuser@example.com');
    });

    it('emits AUTH_LOGIN_FAILED with reason INTERNAL_ERROR and preserves original exception on infrastructure error', async () => {
      const dbError = new Error(
        'Database connection lost during query execution',
      );
      authServiceMock.login.mockRejectedValueOnce(dbError);

      await expect(
        controller.login(
          { email: 'user@example.com', password: 'anyPassword123' },
          reqMock as Request,
          resMock as Response,
        ),
      ).rejects.toThrow('Database connection lost during query execution');

      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledTimes(1);
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_LOGIN_FAILED,
        targetType: 'User',
        requestId: 'req-auth-123',
        metadata: { reason: 'INTERNAL_ERROR' },
      });

      const callArgs = auditServiceMock.logActionBestEffort.mock.calls[0][0];
      expect(callArgs.targetId).toBeUndefined();

      const payloadStr = JSON.stringify(callArgs);
      expect(payloadStr).not.toContain('anyPassword123');
      expect(payloadStr).not.toContain('Database connection lost');
    });

    it('invokes logActionBestEffort and propagates InvalidCredentialsException on credential failure', async () => {
      authServiceMock.login.mockRejectedValueOnce(
        new InvalidCredentialsException('INVALID_PASSWORD', 'user-safe-1'),
      );

      await expect(
        controller.login(
          { email: 'user@example.com', password: 'wrong' },
          reqMock as Request,
          resMock as Response,
        ),
      ).rejects.toThrow('Invalid credentials');

      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledTimes(1);
    });
  });

  describe('logout', () => {
    it('emits AUTH_LOGOUT via logActionBestEffort on successful logout', async () => {
      authServiceMock.logout.mockResolvedValueOnce(undefined);

      const res = await controller.logout(
        reqMock as Request,
        resMock as Response,
      );

      expect(res).toEqual({ message: 'Logged out successfully' });
      expect(authServiceMock.logout).toHaveBeenCalledWith('sess-abc-123');
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_LOGOUT,
        actorId: 'user-auth-1',
        targetType: 'User',
        targetId: 'user-auth-1',
        requestId: 'req-auth-123',
      });
      expect(resMock.clearCookie).toHaveBeenCalledWith(
        'session',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
      );
      expect(resMock.clearCookie).toHaveBeenCalledWith(
        'csrfToken',
        expect.objectContaining({ httpOnly: false, sameSite: 'lax' }),
      );
    });
  });
  describe('Secure cookie and TLS enforcement (H2)', () => {
    const origEnv = process.env.NODE_ENV;
    const origAllowInsecure = process.env.ALLOW_INSECURE_HTTP_AUTH;

    afterEach(() => {
      process.env.NODE_ENV = origEnv;
      if (origAllowInsecure !== undefined) {
        process.env.ALLOW_INSECURE_HTTP_AUTH = origAllowInsecure;
      } else {
        delete process.env.ALLOW_INSECURE_HTTP_AUTH;
      }
    });

    it('throws BadRequestException in production when request is unencrypted HTTP before credential verification and side effects (N1)', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_INSECURE_HTTP_AUTH;

      const httpReq = { ...reqMock, secure: false };

      await expect(
        controller.login(
          { email: 'test@example.com', password: 'password123' },
          httpReq as Request,
          resMock as Response,
        ),
      ).rejects.toThrow(BadRequestException);

      // Verify that no credential verification or side effects occurred (N1):
      // 1. authService.login was NOT called (no credential oracle, no session created)
      expect(authServiceMock.login).not.toHaveBeenCalled();
      // 2. No audit event was emitted (neither success nor failure)
      expect(auditServiceMock.logActionBestEffort).not.toHaveBeenCalled();
      // 3. No cookies were issued
      expect(resMock.cookie).not.toHaveBeenCalled();
    });

    it('rejects with BadRequestException without verifying credentials even if invalid credentials are submitted (oracle prevention)', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_INSECURE_HTTP_AUTH;

      const httpReq = { ...reqMock, secure: false };

      await expect(
        controller.login(
          { email: 'nonexistent@example.com', password: 'wrongpassword' },
          httpReq as Request,
          resMock as Response,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(authServiceMock.login).not.toHaveBeenCalled();
      expect(auditServiceMock.logActionBestEffort).not.toHaveBeenCalled();
      expect(resMock.cookie).not.toHaveBeenCalled();
    });

    it('issues cookies with secure: true in production when request is verified HTTPS', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_INSECURE_HTTP_AUTH;

      authServiceMock.login.mockResolvedValueOnce({
        sessionId: 'sess-prod-https',
        user: { id: 'u1', email: 'test@example.com' },
      });

      const httpsReq = { ...reqMock, secure: true };

      await controller.login(
        { email: 'test@example.com', password: 'password123' },
        httpsReq as Request,
        resMock as Response,
      );

      expect(resMock.cookie).toHaveBeenCalledWith(
        'session',
        'sess-prod-https',
        expect.objectContaining({
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
        }),
      );
      expect(resMock.cookie).toHaveBeenCalledWith(
        'csrfToken',
        expect.any(String),
        expect.objectContaining({
          secure: true,
          httpOnly: false,
          sameSite: 'lax',
        }),
      );
    });

    it('issues cookies with secure: false in production when ALLOW_INSECURE_HTTP_AUTH=true test override is enabled', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_INSECURE_HTTP_AUTH = 'true';

      authServiceMock.login.mockResolvedValueOnce({
        sessionId: 'sess-prod-override',
        user: { id: 'u1', email: 'test@example.com' },
      });

      const httpReq = { ...reqMock, secure: false };

      await controller.login(
        { email: 'test@example.com', password: 'password123' },
        httpReq as Request,
        resMock as Response,
      );

      expect(resMock.cookie).toHaveBeenCalledWith(
        'session',
        'sess-prod-override',
        expect.objectContaining({
          secure: false,
          httpOnly: true,
          sameSite: 'lax',
        }),
      );
      expect(resMock.cookie).toHaveBeenCalledWith(
        'csrfToken',
        expect.any(String),
        expect.objectContaining({
          secure: false,
          httpOnly: false,
          sameSite: 'lax',
        }),
      );
    });

    it('issues cookies with secure: false in development/test when request is over HTTP', async () => {
      process.env.NODE_ENV = 'development';

      authServiceMock.login.mockResolvedValueOnce({
        sessionId: 'sess-dev-http',
        user: { id: 'u1', email: 'test@example.com' },
      });

      const httpReq = { ...reqMock, secure: false };

      await controller.login(
        { email: 'test@example.com', password: 'password123' },
        httpReq as Request,
        resMock as Response,
      );

      expect(resMock.cookie).toHaveBeenCalledWith(
        'session',
        'sess-dev-http',
        expect.objectContaining({
          secure: false,
          httpOnly: true,
          sameSite: 'lax',
        }),
      );
    });

    it('issues cookies with secure: true in development/test when request is over HTTPS', async () => {
      process.env.NODE_ENV = 'development';

      authServiceMock.login.mockResolvedValueOnce({
        sessionId: 'sess-dev-https',
        user: { id: 'u1', email: 'test@example.com' },
      });

      const httpsReq = { ...reqMock, secure: true };

      await controller.login(
        { email: 'test@example.com', password: 'password123' },
        httpsReq as Request,
        resMock as Response,
      );

      expect(resMock.cookie).toHaveBeenCalledWith(
        'session',
        'sess-dev-https',
        expect.objectContaining({
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
        }),
      );
    });
  });
});
