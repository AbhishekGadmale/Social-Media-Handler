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

export type AuthFailureReason = 'USER_NOT_FOUND' | 'INVALID_PASSWORD';

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
          email: normalizedEmail,
          hashedPassword,
          organizationName: dto.organizationName,
          workspaceName: dto.workspaceName,
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

    const isValid = await argon2.verify(user.hashedPassword, passwordPlain);
    if (!isValid) {
      throw new InvalidCredentialsException('INVALID_PASSWORD', user.id);
    }

    const sessionId = await this.sessionManager.createSession(
      user.id,
      user.securityEpoch,
    );

    // In-flight login race mitigation: verify that the password hash and security epoch did not change
    // while argon2.verify was executing.
    const freshUser = await this.userRepository.findById(user.id);
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
    await this.sessionManager.destroyAllUserSessions(userId);
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
  ): Promise<void> {
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

    // Revoke all other active sessions while preserving current session and updating its epoch in Redis
    await this.sessionManager.destroyOtherUserSessions(
      userId,
      currentSessionId,
      updatedUser.securityEpoch,
    );
  }
}
