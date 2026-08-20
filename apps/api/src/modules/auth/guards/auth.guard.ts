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
