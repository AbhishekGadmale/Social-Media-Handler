import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Optional,
  Inject,
  Logger,
} from '@nestjs/common';
import {
  UserRepository,
  EmailVerificationTokenRepository,
  PasswordResetTokenRepository,
  AuditAction,
  Prisma,
} from '@agency-os/database';
import { SessionManager } from '@agency-os/session';
import * as argon2 from '@node-rs/argon2';
import { SignupDto } from './dto/signup.dto';
import { AuditService } from '../core/audit.service';
import {
  EMAIL_DELIVERY_SERVICE,
  type EmailDeliveryService,
} from './email-delivery.service';

export interface ChangePasswordResult {
  success: boolean;
  sessionCleanupDeferred?: boolean;
  message?: string;
}

export type AuthFailureReason =
  'USER_NOT_FOUND' | 'INVALID_PASSWORD' | 'ACCOUNT_LOCKED';

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000;

export class InvalidCredentialsException extends UnauthorizedException {
  readonly reason: AuthFailureReason;
  readonly resolvedUserId?: string;

  constructor(reason: AuthFailureReason, resolvedUserId?: string) {
    super('Invalid credentials');
    this.name = 'UnauthorizedException';
    this.reason = reason;
    this.resolvedUserId = resolvedUserId;
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly DUMMY_ARGON2_INPUT = 'dummy-argon2-timing-mitigation-string';

  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionManager: SessionManager,
    private readonly tokenRepository: EmailVerificationTokenRepository,
    @Inject(EMAIL_DELIVERY_SERVICE)
    private readonly emailDeliveryService: EmailDeliveryService,
    private readonly passwordResetTokenRepo: PasswordResetTokenRepository,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  private async runDummyArgon2Work(): Promise<void> {
    await argon2.hash(this.DUMMY_ARGON2_INPUT);
  }

  /**
   * Registers a new user and atomically provisions their initial tenant organization,
   * workspace, OWNER membership, and initial email verification token.
   * Dispatches the verification email and provides anti-enumeration parity for duplicate emails.
   */
  async signup(
    dto: SignupDto,
    requestId?: string,
  ): Promise<{ message: string }> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    // 1. Initial existence check for anti-enumeration timing mitigation
    const existingUser = await this.userRepository.findByEmail(normalizedEmail);
    if (existingUser) {
      await this.runDummyArgon2Work();
      if (this.auditService) {
        this.auditService.logActionBestEffort({
          action: AuditAction.AUTH_SIGNUP_DUPLICATE_EMAIL,
          targetType: 'User',
          requestId,
        });
      }
      return { message: 'Registration request received.' };
    }

    // 2. Hash password with argon2id
    const hashedPassword = await argon2.hash(dto.password);

    // Generate verification token (32-byte cryptographically secure random token)
    const rawToken = EmailVerificationTokenRepository.generateRawToken();
    const tokenHash = EmailVerificationTokenRepository.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // 3. Atomically provision tenant resources AND verification token in single DB transaction
    try {
      const tenantResult =
        await this.userRepository.createWithTenantTransaction({
          name: dto.name,
          email: normalizedEmail,
          hashedPassword,
          organizationName: dto.organizationName,
          workspaceName: dto.workspaceName,
          termsAcceptedAt: new Date(),
          verificationToken: {
            tokenHash,
            expiresAt,
          },
        });

      // Dispatch verification email (best-effort / resilient)
      try {
        await this.emailDeliveryService.sendVerificationEmail(
          tenantResult.user.email,
          rawToken,
        );
      } catch (emailErr) {
        this.logger.warn(
          `[AuthService.signup] Failed to dispatch verification email to ${tenantResult.user.email}: ${(emailErr as Error).message}`,
        );
      }

      if (this.auditService) {
        this.auditService.logActionBestEffort({
          action: AuditAction.AUTH_SIGNUP_SUCCEEDED,
          actorId: tenantResult.user.id,
          targetType: 'User',
          targetId: tenantResult.user.id,
          requestId,
        });
      }

      return { message: 'Registration request received.' };
    } catch (error: any) {
      // Specifically handle unique constraint collisions on email (e.g. concurrent signup)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = (error.meta?.target as string[] | string) || [];
        const isEmailConflict = Array.isArray(target)
          ? target.includes('email')
          : typeof target === 'string' && target.includes('email');

        if (isEmailConflict) {
          await this.runDummyArgon2Work();
          if (this.auditService) {
            this.auditService.logActionBestEffort({
              action: AuditAction.AUTH_SIGNUP_DUPLICATE_EMAIL,
              targetType: 'User',
              requestId,
            });
          }
          return { message: 'Registration request received.' };
        }
      }
      throw error;
    }
  }

  /**
   * Consumes a single-use email verification token atomically and marks the user's email verified.
   * Throws BadRequestException on missing, invalid, expired, or previously consumed tokens.
   */
  async verifyEmail(
    rawToken: string,
    requestId?: string,
  ): Promise<{ message: string }> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new BadRequestException('Invalid or expired verification token');
    }

    const trimmedToken = rawToken.trim();
    if (trimmedToken.length < 32 || trimmedToken.length > 128) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    const result = await this.tokenRepository.consumeToken(trimmedToken);
    if (!result) {
      if (this.auditService) {
        this.auditService.logActionBestEffort({
          action: AuditAction.AUTH_EMAIL_VERIFICATION_FAILED,
          targetType: 'User',
          requestId,
        });
      }
      throw new BadRequestException('Invalid or expired verification token');
    }

    if (this.auditService) {
      this.auditService.logActionBestEffort({
        action: AuditAction.AUTH_EMAIL_VERIFIED,
        actorId: result.user.id,
        targetType: 'User',
        targetId: result.user.id,
        requestId,
      });
    }

    return { message: 'Email verified successfully.' };
  }

  /**
   * Resends a verification email for unverified accounts.
   * Provides full anti-enumeration parity: returns identical generic message regardless
   * of whether the email exists, is already verified, or does not exist.
   */
  async resendVerification(
    email: string,
    requestId?: string,
  ): Promise<{ message: string }> {
    const genericResponse = {
      message:
        'If an unverified account exists for this email, a verification link has been sent.',
    };

    if (!email || typeof email !== 'string') {
      return genericResponse;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.userRepository.findByEmail(normalizedEmail);

    if (!user) {
      await this.runDummyArgon2Work();
      if (this.auditService) {
        this.auditService.logActionBestEffort({
          action: AuditAction.AUTH_EMAIL_VERIFICATION_RESENT,
          targetType: 'User',
          requestId,
        });
      }
      return genericResponse;
    }

    if (user.emailVerified) {
      // User is already verified; no-op and return generic response to prevent state enumeration
      if (this.auditService) {
        this.auditService.logActionBestEffort({
          action: AuditAction.AUTH_EMAIL_VERIFICATION_RESENT,
          actorId: user.id,
          targetType: 'User',
          targetId: user.id,
          requestId,
        });
      }
      return genericResponse;
    }

    // Invalidate prior active tokens to prevent multi-link confusion
    await this.tokenRepository.invalidateActiveUserTokens(user.id);

    const rawToken = EmailVerificationTokenRepository.generateRawToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await this.tokenRepository.createToken(user.id, rawToken, expiresAt);

    try {
      await this.emailDeliveryService.sendVerificationEmail(
        user.email,
        rawToken,
      );
    } catch (emailErr) {
      this.logger.warn(
        `[AuthService.resendVerification] Failed to dispatch verification email to ${user.email}: ${(emailErr as Error).message}`,
      );
    }

    if (this.auditService) {
      this.auditService.logActionBestEffort({
        action: AuditAction.AUTH_EMAIL_VERIFICATION_RESENT,
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        requestId,
      });
    }

    return genericResponse;
  }

  /**
   * Requests a password reset link for the provided email address.
   * Provides full anti-enumeration parity: returns identical generic message regardless
   * of whether the email exists or not.
   */
  async forgotPassword(
    email: string,
    requestId?: string,
  ): Promise<{ message: string }> {
    const genericResponse = {
      message:
        'If an account with that email exists, a password reset link has been sent.',
    };

    if (!email || typeof email !== 'string') {
      return genericResponse;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.userRepository.findByEmail(normalizedEmail);

    if (!user) {
      await this.runDummyArgon2Work();
      if (this.auditService) {
        this.auditService.logActionBestEffort({
          action: AuditAction.AUTH_PASSWORD_RESET_REQUESTED,
          targetType: 'User',
          requestId,
        });
      }
      return genericResponse;
    }

    // Invalidate prior active reset tokens to prevent multi-link confusion
    await this.passwordResetTokenRepo.invalidateActiveUserTokens(user.id);

    const rawToken = PasswordResetTokenRepository.generateRawToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await this.passwordResetTokenRepo.createToken(user.id, rawToken, expiresAt);

    try {
      await this.emailDeliveryService.sendPasswordResetEmail(
        normalizedEmail,
        rawToken,
      );
    } catch (emailErr) {
      this.logger.warn({
        msg: 'forgot_password.email_delivery_failed',
        userId: user.id,
        error: emailErr instanceof Error ? emailErr.message : String(emailErr),
      });
    }

    if (this.auditService) {
      this.auditService.logActionBestEffort({
        action: AuditAction.AUTH_PASSWORD_RESET_REQUESTED,
        targetType: 'User',
        requestId,
      });
    }

    return genericResponse;
  }

  /**
   * Resets a user's password using a single-use password reset token.
   * Enforces single-use CAS consumption, rejects identical password, hashes new password with argon2id,
   * updates password and increments securityEpoch, and revokes all active user sessions.
   */
  async resetPassword(
    token: string,
    newPasswordPlain: string,
    requestId?: string,
  ): Promise<{ message: string }> {
    const result = await this.passwordResetTokenRepo.consumeToken(token);
    if (!result) {
      throw new BadRequestException('Invalid or expired reset link');
    }

    const isSamePassword = await argon2.verify(
      result.user.hashedPassword,
      newPasswordPlain,
    );
    if (isSamePassword) {
      throw new BadRequestException(
        'New password cannot be the same as the current password',
      );
    }

    const hashedPassword = await argon2.hash(newPasswordPlain);
    await this.userRepository.updatePasswordAndIncrementEpoch(
      result.user.id,
      hashedPassword,
    );

    // Revoke all sessions for the user to invalidate any potentially compromised sessions
    await this.revokeAllUserSessions(result.user.id);

    if (this.auditService) {
      this.auditService.logActionBestEffort({
        action: AuditAction.AUTH_PASSWORD_RESET_SUCCEEDED,
        actorId: result.user.id,
        targetType: 'User',
        targetId: result.user.id,
        requestId,
      });
    }

    return { message: 'Password reset successfully.' };
  }

  async login(
    email: string,
    passwordPlain: string,
  ): Promise<{ sessionId: string; user: any }> {
    const user = await this.userRepository.findByEmail(
      email.trim().toLowerCase(),
    );
    if (!user) {
      throw new InvalidCredentialsException('USER_NOT_FOUND');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new InvalidCredentialsException('ACCOUNT_LOCKED', user.id);
    }

    const isValid = await argon2.verify(user.hashedPassword, passwordPlain);
    if (!isValid) {
      const updated = await this.userRepository.incrementFailedLoginAttempts(
        user.id,
      );
      if (updated.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        await this.userRepository.lockUserAccount(
          user.id,
          new Date(Date.now() + ACCOUNT_LOCKOUT_MS),
        );
      }
      throw new InvalidCredentialsException('INVALID_PASSWORD', user.id);
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.userRepository.clearFailedLoginAttempts(user.id);
    }

    const sessionId = await this.sessionManager.createSession(
      user.id,
      user.securityEpoch,
    );

    // In-flight login race mitigation: verify that the password hash and security epoch did not change
    // while argon2.verify was executing.
    let freshUser;
    try {
      freshUser = await this.userRepository.findById(user.id);
    } catch (err) {
      await this.sessionManager
        .destroySession(sessionId)
        .catch((cleanupErr) => {
          this.logger.warn({
            msg: 'login.session_cleanup_failed',
            sessionId,
            userId: user.id,
            error:
              cleanupErr instanceof Error
                ? cleanupErr.message
                : String(cleanupErr),
          });
        });
      throw err;
    }
    if (
      !freshUser ||
      freshUser.hashedPassword !== user.hashedPassword ||
      freshUser.securityEpoch !== user.securityEpoch
    ) {
      await this.sessionManager.destroySession(sessionId);
      throw new InvalidCredentialsException('INVALID_PASSWORD', user.id);
    }

    return { sessionId, user: freshUser };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionManager.destroySession(sessionId);
  }

  /**
   * Revokes all active sessions for a user (e.g. on security revocation).
   * Increments the user's securityEpoch in the database and revokes all sessions in Redis.
   * @param userId The ID of the user whose sessions should be invalidated.
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.userRepository.incrementSecurityEpoch(userId);
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.sessionManager.destroyAllUserSessions(userId);
        break;
      } catch (err) {
        if (attempt < maxAttempts) {
          const backoffMs = 50 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        } else {
          this.logger.warn({
            msg: 'revoke_all_sessions.redis_cleanup_failed',
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  /**
   * Changes a user's password securely, increments securityEpoch in the database,
   * and revokes all other active sessions while preserving and updating epoch on current session.
   *
   * @param userId The authenticated user ID.
   * @param currentPasswordPlain The user's current password.
   * @param newPasswordPlain The desired new password.
   * @param currentSessionId The session ID of the device making the change.
   */
  async changePassword(
    userId: string,
    currentPasswordPlain: string,
    newPasswordPlain: string,
    currentSessionId: string,
  ): Promise<ChangePasswordResult> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const isValid = await argon2.verify(
      user.hashedPassword,
      currentPasswordPlain,
    );
    if (!isValid) {
      throw new InvalidCredentialsException('INVALID_PASSWORD', userId);
    }

    if (currentPasswordPlain === newPasswordPlain) {
      throw new BadRequestException(
        'New password cannot be the same as the current password',
      );
    }

    const newHashedPassword = await argon2.hash(newPasswordPlain);
    const updatedUser =
      await this.userRepository.updatePasswordAndIncrementEpoch(
        userId,
        newHashedPassword,
      );

    // Revoke all other active sessions while preserving current session and updating its epoch in Redis.
    // Wrap with bounded retry (3 attempts) with short exponential backoff.
    // If Redis cleanup fails after retries, do NOT throw an unhandled error after password has
    // already been changed in the database; return a deferred cleanup result instead.
    // Stale sessions remain strictly guarded by AuthGuard's securityEpoch enforcement.
    let sessionCleanupDeferred = false;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.sessionManager.destroyOtherUserSessions(
          userId,
          currentSessionId,
          updatedUser.securityEpoch,
        );
        sessionCleanupDeferred = false;
        break;
      } catch (err) {
        if (attempt < maxAttempts) {
          const backoffMs = 50 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        } else {
          sessionCleanupDeferred = true;
          this.logger.warn({
            msg: 'password_change.session_cleanup_deferred',
            userId,
            currentSessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    if (sessionCleanupDeferred) {
      return {
        success: true,
        sessionCleanupDeferred: true,
        message:
          'Password changed successfully, but terminating other active sessions failed. Stale sessions will be invalidated on their next request via security epoch enforcement.',
      };
    }

    return {
      success: true,
    };
  }
}
