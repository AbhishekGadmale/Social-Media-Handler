import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AuthService,
  InvalidCredentialsException,
  ACCOUNT_LOCKOUT_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  UserRepository,
  EmailVerificationTokenRepository,
  PasswordResetTokenRepository,
  AuditAction,
  Prisma,
} from '@agency-os/database';
import { EMAIL_DELIVERY_SERVICE } from './email-delivery.service';
import { PasswordPolicyService } from './password-policy.service';
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
    incrementFailedLoginAttempts: any;
    lockUserAccount: any;
    clearFailedLoginAttempts: any;
    markEmailVerified: any;
  };
  let sessionManagerMock: {
    createSession: any;
    destroySession: any;
    destroyAllUserSessions: any;
    destroyOtherUserSessions: any;
    getUserSessionIds: any;
    getSessionData: any;
  };
  let tokenRepoMock: {
    createToken: any;
    consumeToken: any;
    findByTokenHash: any;
    invalidateActiveUserTokens: any;
  };
  let passwordResetTokenRepoMock: {
    createToken: any;
    consumeToken: any;
    findByTokenHash: any;
    invalidateActiveUserTokens: any;
  };
  let emailDeliveryMock: {
    sendVerificationEmail: any;
    sendPasswordResetEmail: any;
    sendDuplicateSignupEmail: any;
    sendAccountLockedEmail: any;
  };
  let auditServiceMock: {
    logActionBestEffort: any;
  };
  let passwordPolicyServiceMock: {
    assertPasswordAcceptable: any;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    passwordPolicyServiceMock = {
      assertPasswordAcceptable: vi.fn().mockResolvedValue(undefined),
    };

    userRepoMock = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      updatePassword: vi.fn(),
      updatePasswordAndIncrementEpoch: vi.fn(),
      incrementSecurityEpoch: vi.fn(),
      createWithTenantTransaction: vi.fn(),
      incrementFailedLoginAttempts: vi
        .fn()
        .mockResolvedValue({ failedLoginAttempts: 1 }),
      lockUserAccount: vi
        .fn()
        .mockResolvedValue({ failedLoginAttempts: 0, lockedUntil: new Date() }),
      clearFailedLoginAttempts: vi
        .fn()
        .mockResolvedValue({ failedLoginAttempts: 0, lockedUntil: null }),
      markEmailVerified: vi.fn(),
    };

    sessionManagerMock = {
      createSession: vi.fn(),
      destroySession: vi.fn(),
      destroyAllUserSessions: vi.fn(),
      destroyOtherUserSessions: vi.fn(),
      getUserSessionIds: vi.fn(),
      getSessionData: vi.fn(),
    };

    tokenRepoMock = {
      createToken: vi.fn(),
      consumeToken: vi.fn(),
      findByTokenHash: vi.fn(),
      invalidateActiveUserTokens: vi.fn(),
    };

    passwordResetTokenRepoMock = {
      createToken: vi.fn(),
      consumeToken: vi.fn(),
      findByTokenHash: vi.fn(),
      invalidateActiveUserTokens: vi.fn(),
    };

    emailDeliveryMock = {
      sendVerificationEmail: vi.fn(),
      sendPasswordResetEmail: vi.fn(),
      sendDuplicateSignupEmail: vi.fn().mockResolvedValue(undefined),
      sendAccountLockedEmail: vi.fn().mockResolvedValue(undefined),
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
          provide: PasswordResetTokenRepository,
          useValue: passwordResetTokenRepoMock,
        },
        {
          provide: EMAIL_DELIVERY_SERVICE,
          useValue: emailDeliveryMock,
        },
        {
          provide: PasswordPolicyService,
          useValue: passwordPolicyServiceMock,
        },
        { provide: AuditService, useValue: auditServiceMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('signup', () => {
    describe('SignupDto validation', () => {
      it('rejects signup payload when name is missing (400 validation error)', async () => {
        const dto = plainToInstance(SignupDto, {
          email: 'user@example.com',
          password: 'Password123!',
          termsAccepted: true,
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        const nameError = errors.find((e) => e.property === 'name');
        expect(nameError).toBeDefined();
        expect(nameError?.constraints?.isNotEmpty).toBe('Name is required');
      });

      it('rejects signup payload when name is empty string', async () => {
        const dto = plainToInstance(SignupDto, {
          name: '',
          email: 'user@example.com',
          password: 'Password123!',
          termsAccepted: true,
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        const nameError = errors.find((e) => e.property === 'name');
        expect(nameError).toBeDefined();
        expect(nameError?.constraints?.isNotEmpty).toBe('Name is required');
      });

      it('rejects signup payload when termsAccepted is missing (400 validation error)', async () => {
        const dto = plainToInstance(SignupDto, {
          name: 'Jane Doe',
          email: 'user@example.com',
          password: 'Password123!',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        const termsError = errors.find((e) => e.property === 'termsAccepted');
        expect(termsError).toBeDefined();
      });

      it('rejects signup payload when termsAccepted is false with exact message', async () => {
        const dto = plainToInstance(SignupDto, {
          name: 'Jane Doe',
          email: 'user@example.com',
          password: 'Password123!',
          termsAccepted: false,
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        const termsError = errors.find((e) => e.property === 'termsAccepted');
        expect(termsError).toBeDefined();
        expect(termsError?.constraints?.equals).toBe(
          'You must accept the Terms of Service and Privacy Policy',
        );
      });

      it('accepts signup payload when termsAccepted is true', async () => {
        const dto = plainToInstance(SignupDto, {
          name: 'Jane Doe',
          email: 'user@example.com',
          password: 'Password123!',
          termsAccepted: true,
        });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });
    });

    it('successfully provisions user and workspace tenant on new registration', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce(null);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$hashed');
      userRepoMock.createWithTenantTransaction.mockResolvedValueOnce({
        user: { id: 'u-1', email: 'alice@example.com', securityEpoch: 1 },
      });

      const result = await service.signup(
        {
          name: 'Alice Smith',
          email: '  Alice@Example.com  ',
          password: 'Password123!',
          termsAccepted: true,
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
        name: 'Alice Smith',
        email: 'alice@example.com',
        hashedPassword: '$argon2id$hashed',
        organizationName: 'Alice Org',
        workspaceName: 'Alice WS',
        termsAcceptedAt: expect.any(Date),
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
          name: 'Alice Smith',
          email: 'alice@example.com',
          password: 'Password123!',
          termsAccepted: true,
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
        {
          name: 'Race User',
          email: 'race@example.com',
          password: 'Password123!',
          termsAccepted: true,
        },
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
          name: 'Other User',
          email: 'other@example.com',
          password: 'Password123!',
          termsAccepted: true,
        }),
      ).rejects.toThrow(p2002OtherError);
    });

    it('rejects when passwordPolicyService throws complexity BadRequestException and does not create tenant', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce(null);
      passwordPolicyServiceMock.assertPasswordAcceptable.mockRejectedValueOnce(
        new BadRequestException(
          'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.',
        ),
      );

      await expect(
        service.signup({
          name: 'Policy User',
          email: 'policy@example.com',
          password: 'simplepassword',
          termsAccepted: true,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(
        passwordPolicyServiceMock.assertPasswordAcceptable,
      ).toHaveBeenCalledWith('simplepassword');
      expect(userRepoMock.createWithTenantTransaction).not.toHaveBeenCalled();
    });

    it('for duplicate email, does NOT call passwordPolicyService and returns generic response', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce({
        id: 'existing-u-1',
        email: 'duplicate@example.com',
      });
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$dummyhash');

      const result = await service.signup({
        name: 'Duplicate User',
        email: 'duplicate@example.com',
        password: 'any-password',
        termsAccepted: true,
      });

      expect(result).toEqual({ message: 'Registration request received.' });
      expect(
        passwordPolicyServiceMock.assertPasswordAcceptable,
      ).not.toHaveBeenCalled();
      expect(userRepoMock.createWithTenantTransaction).not.toHaveBeenCalled();
    });

    describe('security notifications (duplicate signup email)', () => {
      it('duplicate signup dispatches sendDuplicateSignupEmail once with normalized email and does not call sendVerificationEmail or createWithTenantTransaction', async () => {
        userRepoMock.findByEmail.mockResolvedValueOnce({
          id: 'existing-user-1',
          email: 'alice@example.com',
        });
        vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$dummyhash');

        const result = await service.signup({
          name: 'Alice Duplicate',
          email: '  Alice@Example.com  ',
          password: 'Password123!',
          termsAccepted: true,
        });

        expect(result).toEqual({ message: 'Registration request received.' });
        expect(
          emailDeliveryMock.sendDuplicateSignupEmail,
        ).toHaveBeenCalledTimes(1);
        expect(emailDeliveryMock.sendDuplicateSignupEmail).toHaveBeenCalledWith(
          'alice@example.com',
        );
        expect(emailDeliveryMock.sendVerificationEmail).not.toHaveBeenCalled();
        expect(userRepoMock.createWithTenantTransaction).not.toHaveBeenCalled();
      });

      it('successful signup does not call sendDuplicateSignupEmail', async () => {
        userRepoMock.findByEmail.mockResolvedValueOnce(null);
        vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$hashed');
        userRepoMock.createWithTenantTransaction.mockResolvedValueOnce({
          user: { id: 'u-1', email: 'alice@example.com', securityEpoch: 1 },
        });

        await service.signup({
          name: 'Alice Smith',
          email: 'alice@example.com',
          password: 'Password123!',
          termsAccepted: true,
          organizationName: 'Org',
          workspaceName: 'WS',
        });

        expect(
          emailDeliveryMock.sendDuplicateSignupEmail,
        ).not.toHaveBeenCalled();
      });

      it('duplicate signup returns generic response even if sendDuplicateSignupEmail rejects', async () => {
        userRepoMock.findByEmail.mockResolvedValueOnce({
          id: 'existing-user-1',
          email: 'alice@example.com',
        });
        vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$dummyhash');
        emailDeliveryMock.sendDuplicateSignupEmail.mockRejectedValueOnce(
          new Error('Email service failure'),
        );

        const result = await service.signup({
          name: 'Alice Duplicate',
          email: 'alice@example.com',
          password: 'Password123!',
          termsAccepted: true,
        });

        expect(result).toEqual({ message: 'Registration request received.' });
        expect(emailDeliveryMock.sendDuplicateSignupEmail).toHaveBeenCalledWith(
          'alice@example.com',
        );
      });
    });

    it('signup success carries requestContext ipAddress and userAgent in audit record', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce(null);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$hashed');
      userRepoMock.createWithTenantTransaction.mockResolvedValueOnce({
        user: { id: 'u-ctx-1', email: 'ctx@example.com' },
        organization: { id: 'org-ctx-1' },
        workspace: { id: 'ws-ctx-1' },
      });

      const requestContext = {
        ipAddress: '198.51.100.42',
        userAgent: 'AgencyOS-TestClient/1.0',
      };

      await service.signup(
        {
          name: 'Context User',
          email: 'ctx@example.com',
          password: 'Password123!',
          termsAccepted: true,
        },
        'req-ctx-signup',
        requestContext,
      );

      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_SIGNUP_SUCCEEDED,
        actorId: 'u-ctx-1',
        targetType: 'User',
        targetId: 'u-ctx-1',
        requestId: 'req-ctx-signup',
        ipAddress: '198.51.100.42',
        userAgent: 'AgencyOS-TestClient/1.0',
      });
    });

    it('duplicate email signup carries requestContext ipAddress and userAgent in audit record', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce({
        id: 'existing-u-1',
        email: 'existing@example.com',
      });
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$dummyhash');

      const requestContext = {
        ipAddress: '198.51.100.43',
        userAgent: 'AgencyOS-DuplicateClient/2.0',
      };

      await service.signup(
        {
          name: 'Duplicate User',
          email: 'existing@example.com',
          password: 'Password123!',
          termsAccepted: true,
        },
        'req-ctx-dup',
        requestContext,
      );

      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_SIGNUP_DUPLICATE_EMAIL,
        targetType: 'User',
        requestId: 'req-ctx-dup',
        ipAddress: '198.51.100.43',
        userAgent: 'AgencyOS-DuplicateClient/2.0',
      });
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
        failedLoginAttempts: 0,
        lockedUntil: null,
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
      expect(userRepoMock.incrementFailedLoginAttempts).not.toHaveBeenCalled();
      expect(userRepoMock.lockUserAccount).not.toHaveBeenCalled();
      expect(userRepoMock.clearFailedLoginAttempts).not.toHaveBeenCalled();
    });

    it('throws InvalidCredentialsException with INVALID_PASSWORD and resolvedUserId when password check fails', async () => {
      const mockUser = {
        id: 'user-exists-2',
        email: 'existing@example.com',
        hashedPassword: '$argon2id$validuserhash',
        securityEpoch: 1,
        failedLoginAttempts: 0,
        lockedUntil: null,
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
      expect(userRepoMock.incrementFailedLoginAttempts).toHaveBeenCalledWith(
        'user-exists-2',
      );
      expect(userRepoMock.lockUserAccount).not.toHaveBeenCalled();
      expect(sessionManagerMock.createSession).not.toHaveBeenCalled();
    });

    it('wrong password calls incrementFailedLoginAttempts and throws INVALID_PASSWORD without locking below threshold', async () => {
      const mockUser = {
        id: 'user-fail-1',
        email: 'fail@example.com',
        hashedPassword: '$argon2id$validuserhash',
        securityEpoch: 1,
        failedLoginAttempts: 1,
        lockedUntil: null,
      };
      userRepoMock.findByEmail.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);
      userRepoMock.incrementFailedLoginAttempts.mockResolvedValueOnce({
        ...mockUser,
        failedLoginAttempts: 2,
      });

      let caughtError: any;
      try {
        await service.login('fail@example.com', 'wrongpassword');
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(InvalidCredentialsException);
      expect(caughtError.reason).toBe('INVALID_PASSWORD');
      expect(caughtError.resolvedUserId).toBe('user-fail-1');
      expect(userRepoMock.incrementFailedLoginAttempts).toHaveBeenCalledWith(
        'user-fail-1',
      );
      expect(userRepoMock.lockUserAccount).not.toHaveBeenCalled();
      expect(sessionManagerMock.createSession).not.toHaveBeenCalled();
    });

    it('the failure that reaches threshold (5) calls lockUserAccount with lockedUntil ~15m in future and still throws INVALID_PASSWORD', async () => {
      const mockUser = {
        id: 'user-threshold-1',
        email: 'threshold@example.com',
        hashedPassword: '$argon2id$validuserhash',
        securityEpoch: 1,
        failedLoginAttempts: 4,
        lockedUntil: null,
      };
      userRepoMock.findByEmail.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);
      userRepoMock.incrementFailedLoginAttempts.mockResolvedValueOnce({
        ...mockUser,
        failedLoginAttempts: 5,
      });

      const before = Date.now();
      let caughtError: any;
      try {
        await service.login('threshold@example.com', 'wrongpassword');
      } catch (err) {
        caughtError = err;
      }
      const after = Date.now();

      expect(caughtError).toBeInstanceOf(InvalidCredentialsException);
      expect(caughtError.reason).toBe('INVALID_PASSWORD');
      expect(caughtError.resolvedUserId).toBe('user-threshold-1');
      expect(userRepoMock.incrementFailedLoginAttempts).toHaveBeenCalledWith(
        'user-threshold-1',
      );
      expect(userRepoMock.lockUserAccount).toHaveBeenCalledTimes(1);

      const [lockUserId, lockDate] = userRepoMock.lockUserAccount.mock.calls[0];
      expect(lockUserId).toBe('user-threshold-1');
      expect(lockDate).toBeInstanceOf(Date);
      const expectedLock = before + ACCOUNT_LOCKOUT_MS;
      expect(lockDate.getTime()).toBeGreaterThanOrEqual(expectedLock - 1000);
      expect(lockDate.getTime()).toBeLessThanOrEqual(
        after + ACCOUNT_LOCKOUT_MS + 1000,
      );
      expect(sessionManagerMock.createSession).not.toHaveBeenCalled();
    });

    it('locked account (lockedUntil in future) with CORRECT password throws ACCOUNT_LOCKED without calling argon2.verify or creating session', async () => {
      const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
      const lockedUser = {
        id: 'user-locked-1',
        email: 'locked@example.com',
        hashedPassword: '$argon2id$validuserhash',
        securityEpoch: 1,
        failedLoginAttempts: 0,
        lockedUntil,
      };
      userRepoMock.findByEmail.mockResolvedValueOnce(lockedUser);

      let caughtError: any;
      try {
        await service.login('locked@example.com', 'correctpassword');
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(InvalidCredentialsException);
      expect(caughtError.reason).toBe('ACCOUNT_LOCKED');
      expect(caughtError.resolvedUserId).toBe('user-locked-1');
      expect(caughtError.getStatus()).toBe(401);
      expect(caughtError.message).toBe('Invalid credentials');
      expect(argon2.verify).not.toHaveBeenCalled();
      expect(sessionManagerMock.createSession).not.toHaveBeenCalled();
      expect(userRepoMock.incrementFailedLoginAttempts).not.toHaveBeenCalled();
      expect(userRepoMock.clearFailedLoginAttempts).not.toHaveBeenCalled();
    });

    it('lockedUntil in the PAST with correct password proceeds to successful login (verify called, session created)', async () => {
      const pastLockedUntil = new Date(Date.now() - 5 * 60 * 1000);
      const user = {
        id: 'user-expired-lock-1',
        email: 'expiredlock@example.com',
        hashedPassword: '$argon2id$validuserhash',
        securityEpoch: 1,
        failedLoginAttempts: 0,
        lockedUntil: pastLockedUntil,
      };
      userRepoMock.findByEmail.mockResolvedValueOnce(user);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      sessionManagerMock.createSession.mockResolvedValueOnce('sess-unlocked-1');
      userRepoMock.findById.mockResolvedValueOnce(user);

      const result = await service.login(
        'expiredlock@example.com',
        'correctpassword',
      );

      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$validuserhash',
        'correctpassword',
      );
      expect(userRepoMock.clearFailedLoginAttempts).toHaveBeenCalledWith(
        'user-expired-lock-1',
      );
      expect(sessionManagerMock.createSession).toHaveBeenCalledWith(
        'user-expired-lock-1',
        1,
      );
      expect(result.sessionId).toBe('sess-unlocked-1');
    });

    it('login with requestContext passes ipAddress and userAgent metadata to createSession', async () => {
      const user = {
        id: 'user-ctx-1',
        email: 'ctx@example.com',
        hashedPassword: '$argon2id$validuserhash',
        securityEpoch: 2,
        failedLoginAttempts: 0,
        lockedUntil: null,
      };
      userRepoMock.findByEmail.mockResolvedValueOnce(user);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      sessionManagerMock.createSession.mockResolvedValueOnce('sess-ctx-1');
      userRepoMock.findById.mockResolvedValueOnce(user);

      await service.login('ctx@example.com', 'password', {
        ipAddress: '203.0.113.195',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      });

      expect(sessionManagerMock.createSession).toHaveBeenCalledWith(
        'user-ctx-1',
        2,
        {
          ipAddress: '203.0.113.195',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      );
    });

    it('successful login with failedLoginAttempts > 0 calls clearFailedLoginAttempts', async () => {
      const dirtyUser = {
        id: 'user-dirty-1',
        email: 'dirty@example.com',
        hashedPassword: '$argon2id$validuserhash',
        securityEpoch: 1,
        failedLoginAttempts: 3,
        lockedUntil: null,
      };
      userRepoMock.findByEmail.mockResolvedValueOnce(dirtyUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      sessionManagerMock.createSession.mockResolvedValueOnce('sess-clean-1');
      userRepoMock.findById.mockResolvedValueOnce(dirtyUser);

      await service.login('dirty@example.com', 'correctpassword');

      expect(userRepoMock.clearFailedLoginAttempts).toHaveBeenCalledWith(
        'user-dirty-1',
      );
    });

    it('successful login with clean state (failedLoginAttempts = 0 and lockedUntil = null) does NOT call clearFailedLoginAttempts', async () => {
      const cleanUser = {
        id: 'user-clean-1',
        email: 'clean@example.com',
        hashedPassword: '$argon2id$validuserhash',
        securityEpoch: 1,
        failedLoginAttempts: 0,
        lockedUntil: null,
      };
      userRepoMock.findByEmail.mockResolvedValueOnce(cleanUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      sessionManagerMock.createSession.mockResolvedValueOnce('sess-clean-2');
      userRepoMock.findById.mockResolvedValueOnce(cleanUser);

      await service.login('clean@example.com', 'correctpassword');

      expect(userRepoMock.clearFailedLoginAttempts).not.toHaveBeenCalled();
    });

    it('detects in-flight securityEpoch change and destroys newly created session', async () => {
      const originalUser = {
        id: 'user-race-1',
        email: 'race@example.com',
        hashedPassword: '$argon2id$passwordhash',
        securityEpoch: 1,
        failedLoginAttempts: 0,
        lockedUntil: null,
      };
      const updatedUser = {
        id: 'user-race-1',
        email: 'race@example.com',
        hashedPassword: '$argon2id$passwordhash',
        securityEpoch: 2, // epoch changed mid-flight due to concurrent password change!
        failedLoginAttempts: 0,
        lockedUntil: null,
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
        failedLoginAttempts: 0,
        lockedUntil: null,
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

    describe('security notifications (account locked email)', () => {
      it('login failure reaching threshold (5) calls sendAccountLockedEmail once with user email', async () => {
        const mockUser = {
          id: 'user-threshold-notify',
          email: 'threshold-notify@example.com',
          hashedPassword: '$argon2id$validuserhash',
          securityEpoch: 1,
          failedLoginAttempts: 4,
          lockedUntil: null,
        };
        userRepoMock.findByEmail.mockResolvedValueOnce(mockUser);
        vi.mocked(argon2.verify).mockResolvedValueOnce(false);
        userRepoMock.incrementFailedLoginAttempts.mockResolvedValueOnce({
          ...mockUser,
          failedLoginAttempts: 5,
        });

        await expect(
          service.login('threshold-notify@example.com', 'wrongpassword'),
        ).rejects.toThrow(InvalidCredentialsException);

        expect(emailDeliveryMock.sendAccountLockedEmail).toHaveBeenCalledTimes(
          1,
        );
        expect(emailDeliveryMock.sendAccountLockedEmail).toHaveBeenCalledWith(
          'threshold-notify@example.com',
        );
      });

      it('login failure below threshold does not call sendAccountLockedEmail', async () => {
        const mockUser = {
          id: 'user-below-notify',
          email: 'below-notify@example.com',
          hashedPassword: '$argon2id$validuserhash',
          securityEpoch: 1,
          failedLoginAttempts: 2,
          lockedUntil: null,
        };
        userRepoMock.findByEmail.mockResolvedValueOnce(mockUser);
        vi.mocked(argon2.verify).mockResolvedValueOnce(false);
        userRepoMock.incrementFailedLoginAttempts.mockResolvedValueOnce({
          ...mockUser,
          failedLoginAttempts: 3,
        });

        await expect(
          service.login('below-notify@example.com', 'wrongpassword'),
        ).rejects.toThrow(InvalidCredentialsException);

        expect(emailDeliveryMock.sendAccountLockedEmail).not.toHaveBeenCalled();
      });

      it('subsequent attempt against already locked account (ACCOUNT_LOCKED path) does not call sendAccountLockedEmail again', async () => {
        const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
        const mockUser = {
          id: 'user-already-locked',
          email: 'already-locked@example.com',
          hashedPassword: '$argon2id$validuserhash',
          securityEpoch: 1,
          failedLoginAttempts: 0,
          lockedUntil,
        };
        userRepoMock.findByEmail.mockResolvedValueOnce(mockUser);

        await expect(
          service.login('already-locked@example.com', 'anypassword'),
        ).rejects.toThrow(InvalidCredentialsException);

        expect(emailDeliveryMock.sendAccountLockedEmail).not.toHaveBeenCalled();
      });

      it('threshold login attempt still throws InvalidCredentialsException with reason INVALID_PASSWORD even if sendAccountLockedEmail rejects', async () => {
        const mockUser = {
          id: 'user-threshold-err',
          email: 'threshold-err@example.com',
          hashedPassword: '$argon2id$validuserhash',
          securityEpoch: 1,
          failedLoginAttempts: 4,
          lockedUntil: null,
        };
        userRepoMock.findByEmail.mockResolvedValueOnce(mockUser);
        vi.mocked(argon2.verify).mockResolvedValueOnce(false);
        userRepoMock.incrementFailedLoginAttempts.mockResolvedValueOnce({
          ...mockUser,
          failedLoginAttempts: 5,
        });
        emailDeliveryMock.sendAccountLockedEmail.mockRejectedValueOnce(
          new Error('Email service failure'),
        );

        let caughtError: any;
        try {
          await service.login('threshold-err@example.com', 'wrongpassword');
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(InvalidCredentialsException);
        expect(caughtError.reason).toBe('INVALID_PASSWORD');
        expect(caughtError.resolvedUserId).toBe('user-threshold-err');
        expect(emailDeliveryMock.sendAccountLockedEmail).toHaveBeenCalledWith(
          'threshold-err@example.com',
        );
      });
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

    it('rejects on password policy failure and does NOT call updatePasswordAndIncrementEpoch', async () => {
      userRepoMock.findById.mockResolvedValueOnce(mockUser);
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);
      passwordPolicyServiceMock.assertPasswordAcceptable.mockRejectedValueOnce(
        new BadRequestException(
          'This password has appeared in a known data breach. Please choose a different password.',
        ),
      );

      await expect(
        service.changePassword(
          userId,
          'CurrentPassword123!',
          'BreachedPassword123!',
          currentSessionId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(
        passwordPolicyServiceMock.assertPasswordAcceptable,
      ).toHaveBeenCalledWith('BreachedPassword123!');
      expect(
        userRepoMock.updatePasswordAndIncrementEpoch,
      ).not.toHaveBeenCalled();
      expect(
        sessionManagerMock.destroyOtherUserSessions,
      ).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    const genericMessage =
      'If an account with that email exists, a password reset link has been sent.';

    it('returns generic response and executes dummy argon2 work when user does not exist', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce(null);

      const result = await service.forgotPassword(
        'nonexistent@example.com',
        'req-fp-1',
      );

      expect(userRepoMock.findByEmail).toHaveBeenCalledWith(
        'nonexistent@example.com',
      );
      expect(argon2.hash).toHaveBeenCalled();
      expect(passwordResetTokenRepoMock.createToken).not.toHaveBeenCalled();
      expect(emailDeliveryMock.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_PASSWORD_RESET_REQUESTED,
        targetType: 'User',
        requestId: 'req-fp-1',
      });
      expect(result).toEqual({ message: genericMessage });
    });

    it('creates a token with 1-hour expiry, invalidates prior tokens, sends email, and logs audit when user exists', async () => {
      const mockUser = { id: 'u-123', email: 'user@example.com' };
      userRepoMock.findByEmail.mockResolvedValueOnce(mockUser);
      passwordResetTokenRepoMock.invalidateActiveUserTokens.mockResolvedValueOnce(
        1,
      );
      passwordResetTokenRepoMock.createToken.mockResolvedValueOnce({
        id: 'prt-1',
        tokenHash: 'hash-val',
        userId: 'u-123',
      });

      const before = Date.now();
      const result = await service.forgotPassword(
        '  User@Example.COM  ',
        'req-fp-2',
      );
      const after = Date.now();

      expect(userRepoMock.findByEmail).toHaveBeenCalledWith('user@example.com');
      expect(
        passwordResetTokenRepoMock.invalidateActiveUserTokens,
      ).toHaveBeenCalledWith('u-123');
      expect(passwordResetTokenRepoMock.createToken).toHaveBeenCalledWith(
        'u-123',
        expect.any(String),
        expect.any(Date),
      );

      // Verify 1-hour expiry
      const expiryCall = passwordResetTokenRepoMock.createToken.mock
        .calls[0][2] as Date;
      expect(expiryCall.getTime()).toBeGreaterThanOrEqual(
        before + 59 * 60 * 1000,
      );
      expect(expiryCall.getTime()).toBeLessThanOrEqual(after + 61 * 60 * 1000);

      expect(emailDeliveryMock.sendPasswordResetEmail).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
      );
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_PASSWORD_RESET_REQUESTED,
        targetType: 'User',
        requestId: 'req-fp-2',
      });
      expect(result).toEqual({ message: genericMessage });
    });

    it('does not fail when email delivery throws an error (best-effort)', async () => {
      const mockUser = { id: 'u-123', email: 'user@example.com' };
      userRepoMock.findByEmail.mockResolvedValueOnce(mockUser);
      passwordResetTokenRepoMock.invalidateActiveUserTokens.mockResolvedValueOnce(
        0,
      );
      passwordResetTokenRepoMock.createToken.mockResolvedValueOnce({});
      emailDeliveryMock.sendPasswordResetEmail.mockRejectedValueOnce(
        new Error('Resend down'),
      );

      const result = await service.forgotPassword('user@example.com');

      expect(result).toEqual({ message: genericMessage });
    });
  });

  describe('resetPassword', () => {
    it('throws BadRequestException when token consumption fails (missing/invalid/expired/consumed)', async () => {
      passwordResetTokenRepoMock.consumeToken.mockResolvedValueOnce(null);

      await expect(
        service.resetPassword('invalid-or-expired-token', 'NewPassword123!'),
      ).rejects.toThrow(
        new BadRequestException('Invalid or expired reset link'),
      );

      expect(
        userRepoMock.updatePasswordAndIncrementEpoch,
      ).not.toHaveBeenCalled();
      expect(sessionManagerMock.destroyAllUserSessions).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when new password equals current password', async () => {
      const mockUser = {
        id: 'u-123',
        hashedPassword: '$argon2id$hashedCurrent',
      };
      passwordResetTokenRepoMock.consumeToken.mockResolvedValueOnce({
        token: { id: 'prt-1' },
        user: mockUser,
      });
      vi.mocked(argon2.verify).mockResolvedValueOnce(true);

      await expect(
        service.resetPassword('valid-token', 'CurrentPassword123!'),
      ).rejects.toThrow(
        new BadRequestException(
          'New password cannot be the same as the current password',
        ),
      );

      expect(
        userRepoMock.updatePasswordAndIncrementEpoch,
      ).not.toHaveBeenCalled();
      expect(sessionManagerMock.destroyAllUserSessions).not.toHaveBeenCalled();
    });

    it('successfully consumes token, updates password, increments epoch, and revokes all sessions', async () => {
      const mockUser = {
        id: 'u-123',
        hashedPassword: '$argon2id$hashedOld',
      };
      passwordResetTokenRepoMock.consumeToken.mockResolvedValueOnce({
        token: { id: 'prt-1' },
        user: mockUser,
      });
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$hashedBrandNew');
      userRepoMock.updatePasswordAndIncrementEpoch.mockResolvedValueOnce({
        id: 'u-123',
        securityEpoch: 2,
      });
      userRepoMock.incrementSecurityEpoch.mockResolvedValueOnce({
        id: 'u-123',
        securityEpoch: 3,
      });
      sessionManagerMock.destroyAllUserSessions.mockResolvedValueOnce(
        undefined,
      );

      const result = await service.resetPassword(
        'valid-token',
        'mock-new-password-123!',
        'req-rp-1',
      );

      expect(passwordResetTokenRepoMock.consumeToken).toHaveBeenCalledWith(
        'valid-token',
      );
      expect(argon2.hash).toHaveBeenCalledWith('mock-new-password-123!');
      expect(userRepoMock.updatePasswordAndIncrementEpoch).toHaveBeenCalledWith(
        'u-123',
        '$argon2id$hashedBrandNew',
      );
      expect(userRepoMock.incrementSecurityEpoch).toHaveBeenCalledWith('u-123');
      expect(sessionManagerMock.destroyAllUserSessions).toHaveBeenCalledWith(
        'u-123',
      );
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_PASSWORD_RESET_SUCCEEDED,
        actorId: 'u-123',
        targetType: 'User',
        targetId: 'u-123',
        requestId: 'req-rp-1',
      });
      expect(result).toEqual({ message: 'Password reset successfully.' });
    });

    it('resetPassword success carries requestContext ipAddress and userAgent in audit record', async () => {
      const mockUser = {
        id: 'u-rp-ctx',
        hashedPassword: '$argon2id$hashedOld',
      };
      passwordResetTokenRepoMock.consumeToken.mockResolvedValueOnce({
        token: { id: 'prt-ctx' },
        user: mockUser,
      });
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);
      vi.mocked(argon2.hash).mockResolvedValueOnce('$argon2id$hashedNew');
      userRepoMock.updatePasswordAndIncrementEpoch.mockResolvedValueOnce({
        id: 'u-rp-ctx',
        securityEpoch: 2,
      });

      const requestContext = {
        ipAddress: '198.51.100.44',
        userAgent: 'AgencyOS-ResetClient/3.0',
      };

      await service.resetPassword(
        'valid-token-ctx',
        'ValidNewPassword123!',
        'req-rp-ctx',
        requestContext,
      );

      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith({
        action: AuditAction.AUTH_PASSWORD_RESET_SUCCEEDED,
        actorId: 'u-rp-ctx',
        targetType: 'User',
        targetId: 'u-rp-ctx',
        requestId: 'req-rp-ctx',
        ipAddress: '198.51.100.44',
        userAgent: 'AgencyOS-ResetClient/3.0',
      });
    });

    it('rejects on password policy failure after token consume and does not update password', async () => {
      const mockUser = {
        id: 'u-123',
        hashedPassword: '$argon2id$hashedOld',
      };
      passwordResetTokenRepoMock.consumeToken.mockResolvedValueOnce({
        token: { id: 'prt-1' },
        user: mockUser,
      });
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);
      passwordPolicyServiceMock.assertPasswordAcceptable.mockRejectedValueOnce(
        new BadRequestException(
          'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.',
        ),
      );

      await expect(
        service.resetPassword('valid-token', 'NonCompliantPassword'),
      ).rejects.toThrow(BadRequestException);

      expect(passwordResetTokenRepoMock.consumeToken).toHaveBeenCalledWith(
        'valid-token',
      );
      expect(
        passwordPolicyServiceMock.assertPasswordAcceptable,
      ).toHaveBeenCalledWith('NonCompliantPassword');
      expect(
        userRepoMock.updatePasswordAndIncrementEpoch,
      ).not.toHaveBeenCalled();
      expect(sessionManagerMock.destroyAllUserSessions).not.toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    it('maps stored data, parses UA, marks isCurrent for matching cookie, and sorts newest first', async () => {
      const userId = 'user-list-sessions';
      sessionManagerMock.getUserSessionIds.mockResolvedValueOnce([
        'sess-older',
        'sess-newer',
      ]);

      sessionManagerMock.getSessionData.mockImplementation(
        async (sid: string) => {
          if (sid === 'sess-older') {
            return {
              userId,
              createdAt: '2026-11-16T10:00:00.000Z',
              expiresAt: '2026-11-23T10:00:00.000Z',
              ipAddress: '192.168.1.10',
              userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            };
          }
          if (sid === 'sess-newer') {
            return {
              userId,
              createdAt: '2026-11-16T11:00:00.000Z',
              expiresAt: '2026-11-23T11:00:00.000Z',
              ipAddress: '10.0.0.5',
              userAgent:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            };
          }
          return null;
        },
      );

      const sessions = await service.listSessions(userId, 'sess-newer');

      expect(sessions).toHaveLength(2);
      // Newest first
      expect(sessions[0].sessionId).toBe('sess-newer');
      expect(sessions[0].isCurrent).toBe(true);
      expect(sessions[0].browser).toBe('Safari');
      expect(sessions[0].os).toBe('macOS');
      expect(sessions[0].ipAddress).toBe('10.0.0.5');

      expect(sessions[1].sessionId).toBe('sess-older');
      expect(sessions[1].isCurrent).toBe(false);
      expect(sessions[1].browser).toBe('Google Chrome');
      expect(sessions[1].os).toBe('Windows');
      expect(sessions[1].ipAddress).toBe('192.168.1.10');
    });

    it('skips vanished sessions where getSessionData returns null', async () => {
      const userId = 'user-raced-sessions';
      sessionManagerMock.getUserSessionIds.mockResolvedValueOnce([
        'sess-alive',
        'sess-expired',
      ]);

      sessionManagerMock.getSessionData.mockImplementation(
        async (sid: string) => {
          if (sid === 'sess-alive') {
            return {
              userId,
              createdAt: '2026-11-16T12:00:00.000Z',
              expiresAt: '2026-11-23T12:00:00.000Z',
              ipAddress: '127.0.0.1',
              userAgent: 'curl/8.4.0',
            };
          }
          return null;
        },
      );

      const sessions = await service.listSessions(userId);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('sess-alive');
      expect(sessions[0].browser).toBe('Unknown browser');
      expect(sessions[0].os).toBe('Unknown OS');
    });

    it('returns null IP/UA and Unknown browser/OS for legacy sessions without metadata', async () => {
      const userId = 'user-legacy-sessions';
      sessionManagerMock.getUserSessionIds.mockResolvedValueOnce([
        'sess-legacy',
      ]);

      sessionManagerMock.getSessionData.mockResolvedValueOnce({
        userId,
        createdAt: '2026-11-15T00:00:00.000Z',
        expiresAt: '2026-11-22T00:00:00.000Z',
      });

      const sessions = await service.listSessions(userId);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('sess-legacy');
      expect(sessions[0].ipAddress).toBeNull();
      expect(sessions[0].userAgent).toBeNull();
      expect(sessions[0].browser).toBe('Unknown browser');
      expect(sessions[0].os).toBe('Unknown OS');
    });
  });

  describe('revokeSession', () => {
    it('destroys session when sessionId is owned by the user', async () => {
      const userId = 'user-revoke-owned';
      sessionManagerMock.getUserSessionIds.mockResolvedValueOnce([
        'sess-1',
        'sess-2',
      ]);
      sessionManagerMock.destroySession.mockResolvedValueOnce(undefined);

      await service.revokeSession(userId, 'sess-2');

      expect(sessionManagerMock.destroySession).toHaveBeenCalledWith('sess-2');
    });

    it('throws NotFoundException and does NOT call destroySession when sessionId is not in user sessions', async () => {
      const userId = 'user-revoke-foreign';
      sessionManagerMock.getUserSessionIds.mockResolvedValueOnce(['sess-1']);

      await expect(
        service.revokeSession(userId, 'sess-other-user'),
      ).rejects.toThrow(NotFoundException);

      expect(sessionManagerMock.destroySession).not.toHaveBeenCalled();
    });
  });

  describe('googleSignIn', () => {
    it('existing user gets a session and flips verified flag when unverified', async () => {
      const existingUser = {
        id: 'user-google-1',
        email: 'alice@example.com',
        emailVerified: false,
        securityEpoch: 2,
        failedLoginAttempts: 0,
        lockedUntil: null,
      };
      const verifiedUser = {
        id: 'user-google-1',
        email: 'alice@example.com',
        emailVerified: true,
        securityEpoch: 2,
        failedLoginAttempts: 0,
        lockedUntil: null,
      };

      userRepoMock.findByEmail.mockResolvedValueOnce(existingUser);
      userRepoMock.markEmailVerified.mockResolvedValueOnce(verifiedUser);
      sessionManagerMock.createSession.mockResolvedValueOnce('sess-google-1');

      const result = await service.googleSignIn(
        { email: 'Alice@Example.com', name: 'Alice' },
        false,
        { ipAddress: '1.2.3.4', userAgent: 'TestAgent' },
        'req-1',
      );

      expect(userRepoMock.findByEmail).toHaveBeenCalledWith(
        'alice@example.com',
      );
      expect(userRepoMock.markEmailVerified).toHaveBeenCalledWith(
        'user-google-1',
      );
      expect(sessionManagerMock.createSession).toHaveBeenCalledWith(
        'user-google-1',
        2,
        { ipAddress: '1.2.3.4', userAgent: 'TestAgent' },
      );
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.AUTH_LOGIN_SUCCEEDED,
          actorId: 'user-google-1',
          metadata: { provider: 'GOOGLE' },
        }),
      );
      expect(result).toEqual({
        sessionId: 'sess-google-1',
        user: verifiedUser,
      });
    });

    it('existing verified user gets a session without re-updating emailVerified', async () => {
      const existingUser = {
        id: 'user-google-2',
        email: 'bob@example.com',
        emailVerified: true,
        securityEpoch: 1,
        failedLoginAttempts: 0,
        lockedUntil: null,
      };

      userRepoMock.findByEmail.mockResolvedValueOnce(existingUser);
      sessionManagerMock.createSession.mockResolvedValueOnce('sess-google-2');

      const result = await service.googleSignIn(
        { email: 'bob@example.com', name: 'Bob' },
        false,
      );

      expect(userRepoMock.markEmailVerified).not.toHaveBeenCalled();
      expect(sessionManagerMock.createSession).toHaveBeenCalledWith(
        'user-google-2',
        1,
      );
      expect(result).toEqual({
        sessionId: 'sess-google-2',
        user: existingUser,
      });
    });

    it('unknown email without termsAccepted throws exact BadRequestException', async () => {
      userRepoMock.findByEmail.mockResolvedValueOnce(null);

      await expect(
        service.googleSignIn(
          { email: 'newuser@example.com', name: 'New User' },
          false,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'No account exists for this email. Please sign up first.',
        ),
      );
      await expect(
        service.googleSignIn(
          { email: 'newuser@example.com', name: 'New User' },
          undefined,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'No account exists for this email. Please sign up first.',
        ),
      );

      expect(userRepoMock.createWithTenantTransaction).not.toHaveBeenCalled();
    });

    it('unknown email with termsAccepted provisions via createWithTenantTransaction and returns a session', async () => {
      vi.mocked(argon2.hash).mockResolvedValueOnce(
        '$argon2id$randomGoogleHash',
      );
      userRepoMock.findByEmail.mockResolvedValueOnce(null);
      const provisionedUser = {
        id: 'user-google-new',
        email: 'newuser@example.com',
        name: 'New User',
        emailVerified: true,
        securityEpoch: 1,
      };
      userRepoMock.createWithTenantTransaction.mockResolvedValueOnce({
        user: provisionedUser,
        organization: { id: 'org-1' },
        workspace: { id: 'ws-1' },
        membership: { id: 'mem-1' },
      });
      sessionManagerMock.createSession.mockResolvedValueOnce('sess-google-new');

      const result = await service.googleSignIn(
        { email: 'NewUser@example.com', name: 'New User' },
        true,
        { ipAddress: '5.6.7.8', userAgent: 'Chrome' },
        'req-signup-1',
      );

      expect(userRepoMock.createWithTenantTransaction).toHaveBeenCalledTimes(1);
      const tenantCallArg =
        userRepoMock.createWithTenantTransaction.mock.calls[0][0];
      expect(tenantCallArg.email).toBe('newuser@example.com');
      expect(tenantCallArg.name).toBe('New User');
      expect(tenantCallArg.emailVerified).toBe(true);
      expect(tenantCallArg.emailVerifiedAt).toBeInstanceOf(Date);
      expect(tenantCallArg.termsAcceptedAt).toBeInstanceOf(Date);
      expect(typeof tenantCallArg.hashedPassword).toBe('string');
      // Assert it was called with a hash that is not the raw token
      expect(tenantCallArg.hashedPassword).not.toBe('valid-google-token');
      expect(tenantCallArg.hashedPassword.length).toBeGreaterThan(0);

      expect(sessionManagerMock.createSession).toHaveBeenCalledWith(
        'user-google-new',
        1,
        { ipAddress: '5.6.7.8', userAgent: 'Chrome' },
      );
      expect(auditServiceMock.logActionBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.AUTH_SIGNUP_SUCCEEDED,
          actorId: 'user-google-new',
          metadata: { provider: 'GOOGLE' },
        }),
      );
      expect(result).toEqual({
        sessionId: 'sess-google-new',
        user: provisionedUser,
      });
    });
  });
});
