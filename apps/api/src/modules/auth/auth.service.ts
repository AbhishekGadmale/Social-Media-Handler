import { Injectable, UnauthorizedException } from '@nestjs/common';
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
    return { sessionId, user };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionManager.destroySession(sessionId);
  }

  /**
   * Revokes all active sessions for a user (e.g. on password change or security revocation).
   * @param userId The ID of the user whose sessions should be invalidated.
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.sessionManager.destroyAllUserSessions(userId);
  }
}
