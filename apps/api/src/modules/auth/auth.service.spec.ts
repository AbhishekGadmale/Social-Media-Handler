import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService, InvalidCredentialsException } from './auth.service';
import { UserRepository } from '@agency-os/database';
import { SessionManager } from '@agency-os/session';
import * as argon2 from '@node-rs/argon2';

vi.mock('@node-rs/argon2', () => ({
  verify: vi.fn(),
  hash: vi.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let userRepoMock: { findByEmail: any; findById: any; updatePassword: any };
  let sessionManagerMock: {
    createSession: any;
    destroySession: any;
    destroyAllUserSessions: any;
    destroyOtherUserSessions: any;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    userRepoMock = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      updatePassword: vi.fn(),
    };

    sessionManagerMock = {
      createSession: vi.fn(),
      destroySession: vi.fn(),
      destroyAllUserSessions: vi.fn(),
      destroyOtherUserSessions: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserRepository, useValue: userRepoMock },
        { provide: SessionManager, useValue: sessionManagerMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('successfully logs in when credentials are valid and returns sessionId and user', async () => {
      const mockUser = {
        id: 'user-valid-1',
        email: 'user@example.com',
        hashedPassword: '$argon2id$mockedhash',
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

    it('propagates unexpected database/repository error without converting to InvalidCredentialsException', async () => {
      const dbError = new Error(
        'PostgreSQL connection terminated unexpectedly',
      );
      userRepoMock.findByEmail.mockRejectedValueOnce(dbError);

      await expect(
        service.login('test@example.com', 'password123'),
      ).rejects.toThrow('PostgreSQL connection terminated unexpectedly');

      expect(argon2.verify).not.toHaveBeenCalled();
      expect(sessionManagerMock.createSession).not.toHaveBeenCalled();
    });

    it('propagates unexpected session manager error without converting to InvalidCredentialsException', async () => {
      const mockUser = {
        id: 'user-exists-3',
        email: 'existing@example.com',
        hashedPassword: '$argon2id$validuserhash',
      };
      userRepoMock.findByEmail.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);

      const redisError = new Error('Redis connection timed out');
      sessionManagerMock.createSession.mockRejectedValueOnce(redisError);

      await expect(
        service.login('existing@example.com', 'correctpassword'),
      ).rejects.toThrow('Redis connection timed out');
    });

    it('detects in-flight password change and destroys newly created session, throwing INVALID_PASSWORD', async () => {
      const originalUser = {
        id: 'user-race-1',
        email: 'race@example.com',
        hashedPassword: '$argon2id$oldpasswordhash',
      };
      const updatedUser = {
        id: 'user-race-1',
        email: 'race@example.com',
        hashedPassword: '$argon2id$newpasswordhash', // password changed mid-flight!
      };

      userRepoMock.findByEmail.mockResolvedValueOnce(originalUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      sessionManagerMock.createSession.mockResolvedValueOnce(
        'sess-race-created',
      );
      userRepoMock.findById.mockResolvedValueOnce(updatedUser);
      sessionManagerMock.destroySession.mockResolvedValueOnce(undefined);

      await expect(
        service.login('race@example.com', 'oldpassword'),
      ).rejects.toThrow(InvalidCredentialsException);

      // Session created using stale credentials must be immediately destroyed
      expect(sessionManagerMock.destroySession).toHaveBeenCalledWith(
        'sess-race-created',
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
    it('calls destroyAllUserSessions in sessionManager with userId', async () => {
      sessionManagerMock.destroyAllUserSessions.mockResolvedValueOnce(
        undefined,
      );

      await service.revokeAllUserSessions('user-revoke-all-1');

      expect(sessionManagerMock.destroyAllUserSessions).toHaveBeenCalledWith(
        'user-revoke-all-1',
      );
    });

    it('propagates Redis revocation errors', async () => {
      sessionManagerMock.destroyAllUserSessions.mockRejectedValueOnce(
        new Error('Redis connection lost'),
      );

      await expect(
        service.revokeAllUserSessions('user-revoke-all-2'),
      ).rejects.toThrow('Redis connection lost');
    });
  });

  describe('changePassword', () => {
    const userId = 'user-change-pw-1';
    const currentSessionId = 'sess-current-device';
    const mockUser = {
      id: userId,
      email: 'changepw@example.com',
      hashedPassword: '$argon2id$currenthash',
    };

    it('successfully changes password, updates hash in DB, and revokes other sessions', async () => {
      userRepoMock.findById.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$newhash123');
      userRepoMock.updatePassword.mockResolvedValueOnce({
        ...mockUser,
        hashedPassword: '$argon2id$newhash123',
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
      expect(userRepoMock.updatePassword).toHaveBeenCalledWith(
        userId,
        '$argon2id$newhash123',
      );
      expect(sessionManagerMock.destroyOtherUserSessions).toHaveBeenCalledWith(
        userId,
        currentSessionId,
      );
    });

    it('throws InvalidCredentialsException when current password verification fails', async () => {
      userRepoMock.findById.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);

      let caughtError: any;
      try {
        await service.changePassword(
          userId,
          'wrongCurrentPassword',
          'newSecurePassword456',
          currentSessionId,
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(InvalidCredentialsException);
      expect(caughtError.reason).toBe('INVALID_PASSWORD');
      expect(caughtError.resolvedUserId).toBe(userId);
      expect(userRepoMock.updatePassword).not.toHaveBeenCalled();
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

      expect(userRepoMock.updatePassword).not.toHaveBeenCalled();
      expect(
        sessionManagerMock.destroyOtherUserSessions,
      ).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when user does not exist in database', async () => {
      userRepoMock.findById.mockResolvedValueOnce(null);

      await expect(
        service.changePassword(
          'nonexistent-user',
          'currentPassword123',
          'newSecurePassword456',
          currentSessionId,
        ),
      ).rejects.toThrow(/User no longer exists/);

      expect(argon2.verify).not.toHaveBeenCalled();
      expect(userRepoMock.updatePassword).not.toHaveBeenCalled();
    });

    it('propagates database error when updatePassword fails and aborts session revocation', async () => {
      userRepoMock.findById.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$newhash123');
      userRepoMock.updatePassword.mockRejectedValueOnce(
        new Error('PostgreSQL deadlock error'),
      );

      await expect(
        service.changePassword(
          userId,
          'currentPassword123',
          'newSecurePassword456',
          currentSessionId,
        ),
      ).rejects.toThrow('PostgreSQL deadlock error');

      expect(
        sessionManagerMock.destroyOtherUserSessions,
      ).not.toHaveBeenCalled();
    });

    it('propagates Redis error when destroyOtherUserSessions fails', async () => {
      userRepoMock.findById.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$newhash123');
      userRepoMock.updatePassword.mockResolvedValueOnce({
        ...mockUser,
        hashedPassword: '$argon2id$newhash123',
      });
      sessionManagerMock.destroyOtherUserSessions.mockRejectedValueOnce(
        new Error('Redis cluster unreachable'),
      );

      await expect(
        service.changePassword(
          userId,
          'currentPassword123',
          'newSecurePassword456',
          currentSessionId,
        ),
      ).rejects.toThrow('Redis cluster unreachable');
    });
  });
});
