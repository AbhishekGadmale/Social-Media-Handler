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
} from '@nestjs/common';
import { AuthService } from './auth.service';
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
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = body;
    const requestId = (req as any).id;
    let sessionId: string;
    let user: User;

    try {
      const result = await this.authService.login(email, password);
      sessionId = result.sessionId;
      user = result.user;

      this.auditService.logAction({
        action: AuditAction.AUTH_LOGIN_SUCCEEDED,
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        requestId,
      });
    } catch (e) {
      this.auditService.logAction({
        action: AuditAction.AUTH_LOGIN_FAILED,
        targetType: 'User',
        requestId,
        metadata: { reason: 'invalid_credentials' },
      });
      throw e;
    }

    const csrfToken = crypto.randomBytes(32).toString('hex');

    // Set cookies
    res.cookie('session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.cookie('csrfToken', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
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
      this.auditService.logAction({
        action: AuditAction.AUTH_LOGOUT,
        actorId: user.id,
        targetType: 'User',
        targetId: user.id,
        requestId,
      });
    }

    res.clearCookie('session');
    res.clearCookie('csrfToken');
    return { message: 'Logged out successfully' };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: User) {
    // Return user + workspace memberships
    const memberships = await this.memberRepo.findMembershipsByUserId(user.id);

    // Exclude password

    const { hashedPassword: _hashedPassword, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
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
