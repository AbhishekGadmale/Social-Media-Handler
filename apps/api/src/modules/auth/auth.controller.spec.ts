import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
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
    });

    it('emits AUTH_LOGIN_FAILED via logActionBestEffort on failed login and propagates error', async () => {
      authServiceMock.login.mockRejectedValueOnce(
        new Error('Invalid credentials'),
      );

      await expect(
        controller.login(
          { email: 'bad@example.com', password: 'wrong' },
          reqMock as Request,
          resMock as Response,
        ),
      ).rejects.toThrow('Invalid credentials');

      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_LOGIN_FAILED,
        targetType: 'User',
        requestId: 'req-auth-123',
        metadata: { reason: 'invalid_credentials' },
      });

      const callArgs = auditServiceMock.logActionBestEffort.mock.calls[0][0];
      const payloadStr = JSON.stringify(callArgs);
      expect(payloadStr).not.toContain('wrong');
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
      expect(resMock.clearCookie).toHaveBeenCalledWith('session');
      expect(resMock.clearCookie).toHaveBeenCalledWith('csrfToken');
    });
  });
});
