import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthService, InvalidCredentialsException } from './auth.service';
import type { Response, Request } from 'express';
import { AuthGuard } from './guards/auth.guard';
import { WorkspaceGuard } from './guards/workspace.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermission } from './decorators/permission.decorator';
import { CurrentUser } from './decorators/user.decorator';
import type { User } from '@agency-os/database';
import { WorkspaceMemberRepository } from '@agency-os/database';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import * as crypto from 'crypto';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';

import { RateLimitPolicies } from '../core/rate-limit.policies';

import { AuditAction } from '@agency-os/database';
import { AuditService } from '../core/audit.service';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly memberRepo: WorkspaceMemberRepository,
    private readonly auditService: AuditService,
  ) {}

  @Throttle({ default: RateLimitPolicies.auth })
  @Post('signup')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() body: SignupDto, @Req() req: Request) {
    const isProduction = process.env.NODE_ENV === 'production';
    const isSecureRequest = Boolean(req.secure);
    const allowInsecureHttp = process.env.ALLOW_INSECURE_HTTP_AUTH === 'true';

    if (isProduction && !isSecureRequest && !allowInsecureHttp) {
      throw new BadRequestException(
        'HTTPS is required for registration in production environments. Please configure TLS on your reverse proxy or custom domain.',
      );
    }

    const requestId = (req as any).id;
    return this.authService.signup(body, requestId);
  }

  @Throttle({ default: RateLimitPolicies.auth })
  @Post('verify-email')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: VerifyEmailDto, @Req() req: Request) {
    const isProduction = process.env.NODE_ENV === 'production';
    const isSecureRequest = Boolean(req.secure);
    const allowInsecureHttp = process.env.ALLOW_INSECURE_HTTP_AUTH === 'true';

    if (isProduction && !isSecureRequest && !allowInsecureHttp) {
      throw new BadRequestException(
        'HTTPS is required for email verification in production environments. Please configure TLS on your reverse proxy or custom domain.',
      );
    }

    const requestId = (req as any).id;
    return this.authService.verifyEmail(body.token, requestId);
  }

  @Throttle({ default: RateLimitPolicies.auth })
  @Post('resend-verification')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @HttpCode(HttpStatus.OK)
  async resendVerification(
    @Body() body: ResendVerificationDto,
    @Req() req: Request,
  ) {
    const isProduction = process.env.NODE_ENV === 'production';
    const isSecureRequest = Boolean(req.secure);
    const allowInsecureHttp = process.env.ALLOW_INSECURE_HTTP_AUTH === 'true';

    if (isProduction && !isSecureRequest && !allowInsecureHttp) {
      throw new BadRequestException(
        'HTTPS is required for verification resend in production environments. Please configure TLS on your reverse proxy or custom domain.',
      );
    }

    const requestId = (req as any).id;
    return this.authService.resendVerification(body.email, requestId);
  }

  private clearSessionCookies(req: Request, res: Response): void {
    const isSecureRequest = Boolean(req.secure);
    res.clearCookie('session', {
      httpOnly: true,
      secure: isSecureRequest,
      sameSite: 'lax',
    });
    res.clearCookie('csrfToken', {
      httpOnly: false,
      secure: isSecureRequest,
      sameSite: 'lax',
    });
  }

  @Throttle({ default: RateLimitPolicies.auth })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isProduction = process.env.NODE_ENV === 'production';
    const isSecureRequest = Boolean(req.secure);
    const allowInsecureHttp = process.env.ALLOW_INSECURE_HTTP_AUTH === 'true';

    // In production/staging, authentication requires a verified HTTPS connection.
    // Reject unencrypted HTTP requests before credential verification, session creation,
    // audit logging, or cookie issuance to prevent credential oracles and side effects,
    // unless the explicit, test-only override ALLOW_INSECURE_HTTP_AUTH=true is set.
    if (isProduction && !isSecureRequest && !allowInsecureHttp) {
      throw new BadRequestException(
        'HTTPS is required for authentication in production environments. Please configure TLS on your reverse proxy or custom domain.',
      );
    }

    const { email, password } = body;
    const requestId = (req as any).id;
    let sessionId: string;
    let user: User;

    try {
      const result = await this.authService.login(email, password);
      sessionId = result.sessionId;
      user = result.user;

      this.auditService.logActionBestEffort({
        action: AuditAction.AUTH_LOGIN_SUCCEEDED,
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        requestId,
      });
    } catch (e) {
      if (e instanceof InvalidCredentialsException) {
        this.auditService.logActionBestEffort({
          action: AuditAction.AUTH_LOGIN_FAILED,
          targetType: 'User',
          ...(e.resolvedUserId ? { targetId: e.resolvedUserId } : {}),
          requestId,
          metadata: { reason: e.reason },
        });
      } else {
        this.auditService.logActionBestEffort({
          action: AuditAction.AUTH_LOGIN_FAILED,
          targetType: 'User',
          requestId,
          metadata: { reason: 'INTERNAL_ERROR' },
        });
      }
      throw e;
    }

    const csrfToken = crypto.randomBytes(32).toString('hex');
    const secureCookie = isSecureRequest;

    // Set cookies
    res.cookie('session', sessionId, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.cookie('csrfToken', csrfToken, {
      httpOnly: false,
      secure: secureCookie,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { message: 'Logged in successfully' };
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionId = req.cookies?.session as string | undefined;
    const requestId = (req as any).id;
    const user = (req as any).user as User | undefined;

    if (sessionId) {
      await this.authService.logout(sessionId);
    }

    if (user) {
      this.auditService.logActionBestEffort({
        action: AuditAction.AUTH_LOGOUT,
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        requestId,
      });
    }

    this.clearSessionCookies(req, res);
    return { message: 'Logged out successfully' };
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: RateLimitPolicies.auth })
  @Post('change-password')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: ChangePasswordDto,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    const { currentPassword, newPassword } = body;
    const sessionId = req.cookies?.session as string;
    const requestId = (req as any).id;

    try {
      const result = await this.authService.changePassword(
        user.id,
        currentPassword,
        newPassword,
        sessionId,
      );

      this.auditService.logActionBestEffort({
        action: AuditAction.AUTH_PASSWORD_CHANGED,
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        requestId,
        metadata: result?.sessionCleanupDeferred
          ? { sessionCleanupDeferred: true }
          : undefined,
      });

      if (result?.sessionCleanupDeferred) {
        return {
          message:
            result.message ||
            'Password changed successfully, but terminating other active sessions failed. Stale sessions will be invalidated on their next request via security epoch enforcement.',
          sessionCleanupDeferred: true,
        };
      }

      return { message: 'Password changed successfully' };
    } catch (e) {
      this.auditService.logActionBestEffort({
        action: AuditAction.AUTH_PASSWORD_CHANGE_FAILED,
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        requestId,
        metadata: {
          reason:
            e instanceof InvalidCredentialsException
              ? e.reason
              : e instanceof Error
                ? e.message
                : 'UNKNOWN_ERROR',
        },
      });
      throw e;
    }
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: RateLimitPolicies.auth })
  @Post('sessions/revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAllSessions(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const requestId = (req as any).id;

    await this.authService.revokeAllUserSessions(user.id);

    this.auditService.logActionBestEffort({
      action: AuditAction.AUTH_REVOKE_ALL_SESSIONS,
      actorId: user.id,
      targetType: 'User',
      targetId: user.id,
      requestId,
    });

    this.clearSessionCookies(req, res);

    return { message: 'All sessions revoked successfully' };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: User) {
    // Return user + workspace memberships
    const memberships = await this.memberRepo.findMembershipsByUserId(user.id);

    // Exclude password

    const { hashedPassword: _hashedPassword, ...userWithoutPassword } = user;

    return {
      user: {
        ...userWithoutPassword,
        emailVerified: Boolean(user.emailVerified),
      },
      memberships,
    };
  }
}

// A test controller to verify Workspace and Permission guards
@Controller('v1/workspaces')
export class WorkspaceTestController {
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('posts.create/edit')
  @Post(':workspaceId/test-posts')
  @HttpCode(HttpStatus.OK)
  createPost() {
    return { message: 'Post created' };
  }
}
