import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRepository } from '@agency-os/database';
import { SessionManager } from '@agency-os/session';
import * as argon2 from '@node-rs/argon2';

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
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await argon2.verify(user.hashedPassword, passwordPlain);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const sessionId = await this.sessionManager.createSession(user.id);
    return { sessionId, user };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionManager.destroySession(sessionId);
  }
}
