import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  ForbiddenException,
  ParseUUIDPipe,
  Logger,
} from '@nestjs/common';
import { ParseSocialProviderPipe } from './pipes/parse-social-provider.pipe';
import { OAuthService } from './oauth.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/permission.decorator';
import type { Request, Response } from 'express';
import { SocialProvider } from '@agency-os/database';

import { OAuthCallbackQueryDto } from './dto/oauth-callback-query.dto';

import { Throttle } from '@nestjs/throttler';
import { RateLimitPolicies } from '../core/rate-limit.policies';

import { AuditAction } from '@agency-os/database';
import { AuditService } from '../core/audit.service';

@Controller()
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly oauthService: OAuthService,
    private readonly auditService: AuditService,
  ) {}

  @Throttle({ default: RateLimitPolicies.expensive })
  @Post('v1/workspaces/:workspaceId/oauth/:provider/connect')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('accounts.connect')
  async connectProvider(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('provider', ParseSocialProviderPipe)
    provider: SocialProvider,
    @Query('scopes') scopesQuery: string | undefined,
    @Req() req: Request,
  ) {
    const userId = req.user!.id;
    const redirectUri = `${req.protocol}://${req.get('host')}/api/v1/oauth/${provider.toLowerCase()}/callback`;
    const requestedScopes = scopesQuery
      ? scopesQuery
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const url = await this.oauthService.generateAuthUrl(
      provider,
      userId,
      workspaceId,
      redirectUri,
      requestedScopes,
    );

    this.auditService.logAction({
      action: AuditAction.OAUTH_CONNECTION_STARTED,
      workspaceId,
      actorId: userId,
      targetType: 'SocialProvider',
      targetId: provider,
      requestId: (req as any).id,
      metadata: { provider },
    });

    return { url };
  }

  @Get('v1/oauth/:provider/callback')
  @UseGuards(AuthGuard) // Only requires AuthGuard, we validate user/workspace via state
  async callbackProvider(
    @Param('provider', ParseSocialProviderPipe)
    provider: SocialProvider,
    @Query() query: OAuthCallbackQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { code, state, error } = query;
    const requestId = (req as any).id;
    const userId = req.user!.id;

    if (error) {
      this.auditService.logAction({
        action: AuditAction.OAUTH_CONNECTION_FAILED,
        actorId: userId,
        targetType: 'SocialProvider',
        targetId: provider,
        requestId,
        metadata: { provider, reason: 'OAUTH_PROVIDER_DENIED' },
      });
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/dashboard?error=oauth_failed`);
    }

    if (!code || !state) {
      throw new ForbiddenException('Missing code or state');
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/api/v1/oauth/${provider.toLowerCase()}/callback`;

    try {
      const { workspaceId, socialAccountId, isNew } =
        await this.oauthService.handleOAuthCallback(
          provider,
          userId,
          state,
          code,
          redirectUri,
        );

      this.auditService.logAction({
        action: isNew
          ? AuditAction.OAUTH_CONNECTION_SUCCEEDED
          : AuditAction.OAUTH_RECONNECTED,
        workspaceId,
        actorId: userId,
        targetType: 'SocialAccount',
        targetId: socialAccountId,
        requestId,
        metadata: { provider },
      });

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/${workspaceId}/accounts`);
    } catch (err: any) {
      this.logger.error('OAuth connection failed', {
        event: 'oauth.connection_failed',
        provider,
        errorClass: err?.name,
        errorCode: err?.statusCode || err?.code,
        errorMessage: err?.message,
      });
      this.auditService.logAction({
        action: AuditAction.OAUTH_CONNECTION_FAILED,
        actorId: userId,
        targetType: 'SocialProvider',
        targetId: provider,
        requestId,
        metadata: {
          provider,
          reason: 'OAUTH_CALLBACK_FAILED',
          errorMessage: err?.message,
        },
      });
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/dashboard?error=oauth_failed`);
    }
  }
}
