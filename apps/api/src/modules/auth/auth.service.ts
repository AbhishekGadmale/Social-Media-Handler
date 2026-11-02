import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { UserRepository } from '@agency-os/database';
import { SessionManager } from '@agency-os/session';
import * as argon2 from '@node-rs/argon2';

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
  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionManager: SessionManager,
  ) {}

  async login(
    email: string,
    passwordPlain: string,
  ): Promise<{ sessionId: string; user: any }> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new InvalidCredentialsException('USER_NOT_FOUND');
    }

    const isValid = await argon2.verify(user.hashedPassword, passwordPlain);
    if (!isValid) {
      throw new InvalidCredentialsException('INVALID_PASSWORD', user.id);
    }

    const sessionId = await this.sessionManager.createSession(user.id);

    // In-flight login race mitigation: verify that the password hash did not change
    // while argon2.verify was executing.
    const freshUser = await this.userRepository.findById(user.id);
    if (!freshUser || freshUser.hashedPassword !== user.hashedPassword) {
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
   * @param userId The ID of the user whose sessions should be invalidated.
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.sessionManager.destroyAllUserSessions(userId);
  }

  /**
   * Changes a user's password securely, updates the password hash in the database,
   * and revokes all other active sessions while preserving the current active session.
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
    await this.userRepository.updatePassword(userId, newHashedPassword);

    // Revoke all other active sessions while preserving current session
    await this.sessionManager.destroyOtherUserSessions(
      userId,
      currentSessionId,
    );
  }
}
