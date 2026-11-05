import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuthService, InvalidCredentialsException } from './auth.service';
import {
  UserRepository,
  EmailVerificationTokenRepository,
  AuditAction,
  Prisma,
} from '@agency-os/database';
import { EMAIL_DELIVERY_SERVICE } from './email-delivery.service';
import { SessionManager } from '@agency-os/session';
import { AuditService } from '../core/audit.service';
import * as argon2 from '@node-rs/argon2';

vi.mock('@node-rs/argon2', () => ({
  verify: vi.fn(),
  hash: vi.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let userRepoMock: {
    findByEmail: any;
    findById: any;
    updatePassword: any;
    updatePasswordAndIncrementEpoch: any;
    incrementSecurityEpoch: any;
    createWithTenantTransaction: any;
  };
  let sessionManagerMock: {
    createSession: any;
    destroySession: any;
    destroyAllUserSessions: any;
    destroyOtherUserSessions: any;
  };
  let tokenRepoMock: {
    createToken: any;
    consumeToken: any;
    findByTokenHash: any;
    invalidateActiveUserTokens: any;
  };
  let emailDeliveryMock: {
    sendVerificationEmail: any;
  };
  let auditServiceMock: {
    logActionBestEffort: any;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    userRepoMock = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      updatePassword: vi.fn(),
      updatePasswordAndIncrementEpoch: vi.fn(),
      incrementSecurityEpoch: vi.fn(),
      createWithTenantTransaction: vi.fn(),
    };

    sessionManagerMock = {
      createSession: vi.fn(),
      destroySession: vi.fn(),
      destroyAllUserSessions: vi.fn(),
      destroyOtherUserSessions: vi.fn(),
    };

    tokenRepoMock = {
      createToken: vi.fn(),
      consumeToken: vi.fn(),
      findByTokenHash: vi.fn(),
      invalidateActiveUserTokens: vi.fn(),
    };

    emailDeliveryMock = {
      sendVerificationEmail: vi.fn(),
    };

    auditServiceMock = {
      logActionBestEffort: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserRepository, useValue: userRepoMock },
        { provide: SessionManager, useValue: sessionManagerMock },
        {
          provide: EmailVerificationTokenRepository,
          useValue: tokenRepoMock,
        },
        {
          provide: EMAIL_DELIVERY_SERVICE,
          useValue: emailDeliveryMock,
        },
        { provide: AuditService, useValue: auditServiceMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('signup', () => {
    it('successfully provisions user and workspace tenant on new registration', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce(null);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$hashed');
      userRepoMock.createWithTenantTransaction.mockResolvedValueOnce({
        user: { id: 'u-1', email: 'alice@example.com', securityEpoch: 1 },
      });

      const result = await service.signup(
        {
          email: '  Alice@Example.com  ',
          password: 'Password123!',
          organizationName: 'Alice Org',
          workspaceName: 'Alice WS',
        },
        'req-123',
      );

      expect(userRepoMock.findByEmail).toHaveBeenCalledWith(
        'alice@example.com',
      );
      expect(argon2.hash).toHaveBeenCalledWith('Password123!');
      expect(userRepoMock.createWithTenantTransaction).toHaveBeenCalledWith({
        email: 'alice@example.com',
        hashedPassword: '$argon2id$hashed',
        organizationName: 'Alice Org',
        workspaceName: 'Alice WS',
        verificationToken: {
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        },
      });
      expect(emailDeliveryMock.sendVerificationEmail).toHaveBeenCalledWith(
        'alice@example.com',
        expect.any(String),
      );
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_SIGNUP_SUCCEEDED,
        actorId: 'u-1',
        targetType: 'User',
        targetId: 'u-1',
        requestId: 'req-123',
      });
      expect(result).toEqual({ message: 'Registration request received.' });
    });

    it('returns identical 201 message and performs dummy argon2 work for duplicate email (anti-enumeration)', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce({
        id: 'existing-user-1',
        email: 'alice@example.com',
      });
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$dummyhash');

      const result = await service.signup(
        {
          email: 'alice@example.com',
          password: 'Password123!',
        },
        'req-duplicate',
      );

      // Verifies dummy argon2 execution
      expect(argon2.hash).toHaveBeenCalledWith(
        'dummy-argon2-timing-mitigation-string',
      );
      // Assert no tenant provisioning transaction was executed
      expect(userRepoMock.createWithTenantTransaction).not.toHaveBeenCalled();
      // Audit log records duplicate attempt
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_SIGNUP_DUPLICATE_EMAIL,
        targetType: 'User',
        requestId: 'req-duplicate',
      });
      // Identical response body
      expect(result).toEqual({ message: 'Registration request received.' });
    });

    it('catches concurrent P2002 email collisions, performs dummy work, and returns identical message', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce(null);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$hashed');

      const p2002EmailError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`email`)',
        {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['email'] },
        },
      );
      userRepoMock.createWithTenantTransaction.mockRejectedValueOnce(
        p2002EmailError,
      );

      const result = await service.signup(
        { email: 'race@example.com', password: 'Password123!' },
        'req-race',
      );

      // Dummy work performed on race conflict
      expect(argon2.hash).toHaveBeenCalledWith(
        'dummy-argon2-timing-mitigation-string',
      );
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_SIGNUP_DUPLICATE_EMAIL,
        targetType: 'User',
        requestId: 'req-race',
      });
      expect(result).toEqual({ message: 'Registration request received.' });
    });

    it('rethrows P2002 errors targeting fields other than email', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce(null);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$hashed');

      const p2002OtherError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`slug`)',
        {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['slug'] },
        },
      );
      userRepoMock.createWithTenantTransaction.mockRejectedValueOnce(
        p2002OtherError,
      );

      await expect(
        service.signup({
          email: 'other@example.com',
          password: 'Password123!',
        }),
      ).rejects.toThrow(p2002OtherError);
    });
  });

  describe('verifyEmail', () => {
    it('successfully consumes a valid verification token and records audit event', async () => {
      const validToken = 'a'.repeat(64);
      tokenRepoMock.consumeToken.mockResolvedValueOnce({
        token: { id: 'evt-1', consumedAt: new Date() },
        user: {
          id: 'user-verified-1',
          email: 'verified@example.com',
          emailVerified: true,
        },
      });

      const result = await service.verifyEmail(validToken, 'req-verify-1');

      expect(tokenRepoMock.consumeToken).toHaveBeenCalledWith(validToken);
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_EMAIL_VERIFIED,
        actorId: 'user-verified-1',
        targetType: 'User',
        targetId: 'user-verified-1',
        requestId: 'req-verify-1',
      });
      expect(result).toEqual({ message: 'Email verified successfully.' });
    });

    it('throws BadRequestException and logs failure when consumeToken returns null (expired or already consumed)', async () => {
      const expiredToken = 'b'.repeat(64);
      tokenRepoMock.consumeToken.mockResolvedValueOnce(null);

      await expect(
        service.verifyEmail(expiredToken, 'req-verify-fail'),
      ).rejects.toThrow(BadRequestException);

      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_EMAIL_VERIFICATION_FAILED,
        targetType: 'User',
        requestId: 'req-verify-fail',
      });
    });

    it('throws BadRequestException for malformed or short tokens without hitting token repository', async () => {
      await expect(service.verifyEmail('')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.verifyEmail('too-short')).rejects.toThrow(
        BadRequestException,
      );
      expect(tokenRepoMock.consumeToken).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification', () => {
    it('invalidates prior tokens, creates new token, and dispatches email for unverified user', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce({
        id: 'user-unverified-1',
        email: 'unverified@example.com',
        emailVerified: false,
      });

      const result = await service.resendVerification(
        '  Unverified@Example.com  ',
        'req-resend-1',
      );

      expect(userRepoMock.findByEmail).toHaveBeenCalledWith(
        'unverified@example.com',
      );
      expect(tokenRepoMock.invalidateActiveUserTokens).toHaveBeenCalledWith(
        'user-unverified-1',
      );
      expect(tokenRepoMock.createToken).toHaveBeenCalledWith(
        'user-unverified-1',
        expect.any(String),
        expect.any(Date),
      );
      expect(emailDeliveryMock.sendVerificationEmail).toHaveBeenCalledWith(
        'unverified@example.com',
        expect.any(String),
      );
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_EMAIL_VERIFICATION_RESENT,
        actorId: 'user-unverified-1',
        targetType: 'User',
        targetId: 'user-unverified-1',
        requestId: 'req-resend-1',
      });
      expect(result).toEqual({
        message:
          'If an unverified account exists for this email, a verification link has been sent.',
      });
    });

    it('returns generic message and does not send email when user is already verified', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce({
        id: 'user-already-verified',
        email: 'verified@example.com',
        emailVerified: true,
      });

      const result = await service.resendVerification(
        'verified@example.com',
        'req-resend-verified',
      );

      expect(tokenRepoMock.invalidateActiveUserTokens).not.toHaveBeenCalled();
      expect(tokenRepoMock.createToken).not.toHaveBeenCalled();
      expect(emailDeliveryMock.sendVerificationEmail).not.toHaveBeenCalled();
      expect(result).toEqual({
        message:
          'If an unverified account exists for this email, a verification link has been sent.',
      });
    });

    it('runs dummy argon2 work and returns generic message when user does not exist (anti-enumeration)', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce(null);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$dummy');

      const result = await service.resendVerification(
        'nonexistent@example.com',
        'req-resend-nonexistent',
      );

      expect(argon2.hash).toHaveBeenCalledWith(
        'dummy-argon2-timing-mitigation-string',
      );
      expect(tokenRepoMock.createToken).not.toHaveBeenCalled();
      expect(emailDeliveryMock.sendVerificationEmail).not.toHaveBeenCalled();
      expect(result).toEqual({
        message:
          'If an unverified account exists for this email, a verification link has been sent.',
      });
    });
  });

  describe('login', () => {
    it('Scenario 9: passes user.securityEpoch to createSession on successful login', async () => {
      const mockUser = {
        id: 'user-valid-1',
        email: 'user@example.com',
        hashedPassword: '$argon2id$mockedhash',
        securityEpoch: 3,
      };
      userRepoMock.findByEmail.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      sessionManagerMock.createSession.mockResolvedValueOnce('sess-valid-123');
      userRepoMock.findById.mockResolvedValueOnce(mockUser);

      const result = await service.login('user@example.com', 'mypassword');

      expect(userRepoMock.findByEmail).toHaveBeenCalledWith('user@example.com');
      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$mockedhash',
        'mypassword',
      );
      expect(sessionManagerMock.createSession).toHaveBeenCalledWith(
        'user-valid-1',
        3,
      );
      expect(userRepoMock.findById).toHaveBeenCalledWith('user-valid-1');
      expect(result).toEqual({
        sessionId: 'sess-valid-123',
        user: mockUser,
      });
    });

    it('throws InvalidCredentialsException with USER_NOT_FOUND when user does not exist', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce(null);

      let caughtError: any;
      try {
        await service.login('nonexistent@example.com', 'password123');
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(InvalidCredentialsException);
      expect(caughtError.reason).toBe('USER_NOT_FOUND');
      expect(caughtError.resolvedUserId).toBeUndefined();
      expect(caughtError.getStatus()).toBe(401);
      expect(caughtError.message).toBe('Invalid credentials');
      expect(caughtError.name).toBe('UnauthorizedException');
      expect(argon2.verify).not.toHaveBeenCalled();
      expect(sessionManagerMock.createSession).not.toHaveBeenCalled();
    });

    it('throws InvalidCredentialsException with INVALID_PASSWORD and resolvedUserId when password check fails', async () => {
      const mockUser = {
        id: 'user-exists-2',
        email: 'existing@example.com',
        hashedPassword: '$argon2id$validuserhash',
        securityEpoch: 1,
      };
      userRepoMock.findByEmail.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);

      let caughtError: any;
      try {
        await service.login('existing@example.com', 'wrongpassword');
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(InvalidCredentialsException);
      expect(caughtError.reason).toBe('INVALID_PASSWORD');
      expect(caughtError.resolvedUserId).toBe('user-exists-2');
      expect(caughtError.getStatus()).toBe(401);
      expect(caughtError.message).toBe('Invalid credentials');
      expect(caughtError.name).toBe('UnauthorizedException');
      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$validuserhash',
        'wrongpassword',
      );
      expect(sessionManagerMock.createSession).not.toHaveBeenCalled();
    });

    it('detects in-flight securityEpoch change and destroys newly created session', async () => {
      const originalUser = {
        id: 'user-race-1',
        email: 'race@example.com',
        hashedPassword: '$argon2id$passwordhash',
        securityEpoch: 1,
      };
      const updatedUser = {
        id: 'user-race-1',
        email: 'race@example.com',
        hashedPassword: '$argon2id$passwordhash',
        securityEpoch: 2, // epoch changed mid-flight due to concurrent password change!
      };

      userRepoMock.findByEmail.mockResolvedValueOnce(originalUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      sessionManagerMock.createSession.mockResolvedValueOnce(
        'sess-race-created',
      );
      userRepoMock.findById.mockResolvedValueOnce(updatedUser);
      sessionManagerMock.destroySession.mockResolvedValueOnce(undefined);

      await expect(
        service.login('race@example.com', 'password'),
      ).rejects.toThrow(InvalidCredentialsException);

      expect(sessionManagerMock.destroySession).toHaveBeenCalledWith(
        'sess-race-created',
      );
    });

    it('Scenario M2: destroys newly created session when findById re-read throws an error', async () => {
      const originalUser = {
        id: 'user-reread-err-1',
        email: 'reread@example.com',
        hashedPassword: '$argon2id$passwordhash',
        securityEpoch: 1,
      };

      userRepoMock.findByEmail.mockResolvedValueOnce(originalUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      sessionManagerMock.createSession.mockResolvedValueOnce(
        'sess-to-be-destroyed',
      );
      userRepoMock.findById.mockRejectedValueOnce(
        new Error('Postgres connection pool exhausted'),
      );
      sessionManagerMock.destroySession.mockResolvedValueOnce(undefined);

      await expect(
        service.login('reread@example.com', 'password'),
      ).rejects.toThrow('Postgres connection pool exhausted');

      expect(sessionManagerMock.destroySession).toHaveBeenCalledWith(
        'sess-to-be-destroyed',
      );
    });
  });

  describe('logout', () => {
    it('destroys session in sessionManager', async () => {
      sessionManagerMock.destroySession.mockResolvedValueOnce(undefined);

      await service.logout('sess-12345');

      expect(sessionManagerMock.destroySession).toHaveBeenCalledWith(
        'sess-12345',
      );
    });
  });

  describe('revokeAllUserSessions', () => {
    it('increments securityEpoch in DB and calls destroyAllUserSessions in sessionManager', async () => {
      userRepoMock.incrementSecurityEpoch.mockResolvedValueOnce({
        id: 'user-revoke-all-1',
        securityEpoch: 2,
      });
      sessionManagerMock.destroyAllUserSessions.mockResolvedValueOnce(
        undefined,
      );

      await service.revokeAllUserSessions('user-revoke-all-1');

      expect(userRepoMock.incrementSecurityEpoch).toHaveBeenCalledWith(
        'user-revoke-all-1',
      );
      expect(sessionManagerMock.destroyAllUserSessions).toHaveBeenCalledWith(
        'user-revoke-all-1',
      );
    });

    it('retries destroyAllUserSessions when Redis encounters a transient failure', async () => {
      userRepoMock.incrementSecurityEpoch.mockResolvedValueOnce({
        id: 'user-revoke-all-1',
        securityEpoch: 2,
      });
      sessionManagerMock.destroyAllUserSessions
        .mockRejectedValueOnce(new Error('Transient Redis timeout'))
        .mockResolvedValueOnce(undefined);

      await service.revokeAllUserSessions('user-revoke-all-1');

      expect(userRepoMock.incrementSecurityEpoch).toHaveBeenCalledWith(
        'user-revoke-all-1',
      );
      expect(sessionManagerMock.destroyAllUserSessions).toHaveBeenCalledTimes(
        2,
      );
    });

    it('does not throw when destroyAllUserSessions fails all retries (DB epoch already incremented)', async () => {
      userRepoMock.incrementSecurityEpoch.mockResolvedValueOnce({
        id: 'user-revoke-all-1',
        securityEpoch: 2,
      });
      sessionManagerMock.destroyAllUserSessions.mockRejectedValue(
        new Error('Persistent Redis down'),
      );

      await expect(
        service.revokeAllUserSessions('user-revoke-all-1'),
      ).resolves.toBeUndefined();

      expect(sessionManagerMock.destroyAllUserSessions).toHaveBeenCalledTimes(
        3,
      );
    });
  });

  describe('changePassword', () => {
    const userId = 'user-change-pw-1';
    const currentSessionId = 'sess-current-device';
    const mockUser = {
      id: userId,
      email: 'changepw@example.com',
      hashedPassword: '$argon2id$currenthash',
      securityEpoch: 1,
    };

    it('Scenario 7: increments securityEpoch in DB and updates current session epoch in Redis', async () => {
      userRepoMock.findById.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$newhash123');
      userRepoMock.updatePasswordAndIncrementEpoch.mockResolvedValueOnce({
        ...mockUser,
        hashedPassword: '$argon2id$newhash123',
        securityEpoch: 2,
      });
      sessionManagerMock.destroyOtherUserSessions.mockResolvedValueOnce(2);

      await service.changePassword(
        userId,
        'currentPassword123',
        'newSecurePassword456',
        currentSessionId,
      );

      expect(userRepoMock.findById).toHaveBeenCalledWith(userId);
      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$currenthash',
        'currentPassword123',
      );
      expect(argon2.hash).toHaveBeenCalledWith('newSecurePassword456');
      expect(userRepoMock.updatePasswordAndIncrementEpoch).toHaveBeenCalledWith(
        userId,
        '$argon2id$newhash123',
      );
      expect(sessionManagerMock.destroyOtherUserSessions).toHaveBeenCalledWith(
        userId,
        currentSessionId,
        2,
      );
    });

    it('Scenario 8: retries destroyOtherUserSessions and reports sessionCleanupDeferred: true without throwing when Redis fails all retries', async () => {
      userRepoMock.findById.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$newhash123');
      userRepoMock.updatePasswordAndIncrementEpoch.mockResolvedValueOnce({
        ...mockUser,
        hashedPassword: '$argon2id$newhash123',
        securityEpoch: 2,
      });
      sessionManagerMock.destroyOtherUserSessions.mockRejectedValue(
        new Error('Redis connection dropped'),
      );

      const result = await service.changePassword(
        userId,
        'currentPassword123',
        'newSecurePassword456',
        currentSessionId,
      );

      expect(sessionManagerMock.destroyOtherUserSessions).toHaveBeenCalledTimes(
        3,
      );
      expect(result).toEqual({
        success: true,
        sessionCleanupDeferred: true,
        message: expect.stringContaining(
          'terminating other active sessions failed',
        ),
      });
    });

    it('retries destroyOtherUserSessions and returns success: true when retry succeeds', async () => {
      userRepoMock.findById.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$newhash123');
      userRepoMock.updatePasswordAndIncrementEpoch.mockResolvedValueOnce({
        ...mockUser,
        hashedPassword: '$argon2id$newhash123',
        securityEpoch: 2,
      });
      sessionManagerMock.destroyOtherUserSessions
        .mockRejectedValueOnce(new Error('Temporary Redis timeout'))
        .mockResolvedValueOnce(1);

      const result = await service.changePassword(
        userId,
        'currentPassword123',
        'newSecurePassword456',
        currentSessionId,
      );

      expect(sessionManagerMock.destroyOtherUserSessions).toHaveBeenCalledTimes(
        2,
      );
      expect(result).toEqual({
        success: true,
      });
    });

    it('throws InvalidCredentialsException when current password verification fails', async () => {
      userRepoMock.findById.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);

      await expect(
        service.changePassword(
          userId,
          'wrongCurrentPassword',
          'newSecurePassword456',
          currentSessionId,
        ),
      ).rejects.toThrow(InvalidCredentialsException);

      expect(
        userRepoMock.updatePasswordAndIncrementEpoch,
      ).not.toHaveBeenCalled();
      expect(
        sessionManagerMock.destroyOtherUserSessions,
      ).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when new password is identical to current password', async () => {
      userRepoMock.findById.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);

      await expect(
        service.changePassword(
          userId,
          'samePassword123',
          'samePassword123',
          currentSessionId,
        ),
      ).rejects.toThrow(
        /New password cannot be the same as the current password/,
      );

      expect(
        userRepoMock.updatePasswordAndIncrementEpoch,
      ).not.toHaveBeenCalled();
      expect(
        sessionManagerMock.destroyOtherUserSessions,
      ).not.toHaveBeenCalled();
    });
  });
});
