import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { SessionManager } from '@agency-os/session';
import { UserRepository } from '@agency-os/database';
import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly userRepository: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const sessionId = request.cookies?.session as string | undefined;

    if (!sessionId) {
      throw new UnauthorizedException('No session cookie provided');
    }

    const session = await this.sessionManager.validateSession(sessionId);
    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    const user = await this.userRepository.findById(session.userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    // Security Epoch Validation (Muse M1 Resolution)
    const sessionEpoch = session.securityEpoch;
    const userEpoch = user.securityEpoch;

    // Check legacy session compatibility: undefined is permitted iff user.securityEpoch === 1
    if (sessionEpoch === undefined) {
      if (userEpoch !== 1) {
        await this.sessionManager.destroySession(sessionId);
        throw new UnauthorizedException('Invalid or expired session');
      }
    } else {
      // Must be a valid positive integer matching user's epoch exactly
      if (
        typeof sessionEpoch !== 'number' ||
        !Number.isInteger(sessionEpoch) ||
        sessionEpoch < 1 ||
        sessionEpoch !== userEpoch
      ) {
        await this.sessionManager.destroySession(sessionId);
        throw new UnauthorizedException('Invalid or expired session');
      }
    }

    // Attach user to request
    request.user = user;

    // CSRF Check for state-changing methods
    const method = request.method;
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      const csrfCookie = request.cookies?.csrfToken as string | undefined;
      const csrfHeader = request.headers['x-csrf-token'];
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        throw new ForbiddenException('CSRF token mismatch');
      }
    }

    return true;
  }
}
