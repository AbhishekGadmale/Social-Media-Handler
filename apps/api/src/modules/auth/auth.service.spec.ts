import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService, InvalidCredentialsException } from './auth.service';
import { UserRepository } from '@agency-os/database';
import { SessionManager } from '@agency-os/session';
import * as argon2 from '@node-rs/argon2';

vi.mock('@node-rs/argon2', () => ({
  verify: vi.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let userRepoMock: { findByEmail: any; findById: any };
  let sessionManagerMock: {
    createSession: any;
    destroySession: any;
    destroyAllUserSessions: any;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    userRepoMock = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
    };

    sessionManagerMock = {
      createSession: vi.fn(),
      destroySession: vi.fn(),
      destroyAllUserSessions: vi.fn(),
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

      const result = await service.login('user@example.com', 'mypassword');

      expect(userRepoMock.findByEmail).toHaveBeenCalledWith('user@example.com');
      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$mockedhash',
        'mypassword',
      );
      expect(sessionManagerMock.createSession).toHaveBeenCalledWith(
        'user-valid-1',
      );
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
});
