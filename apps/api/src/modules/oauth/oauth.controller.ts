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
} from '@nestjs/common';
import { OAuthService } from './oauth.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/permission.decorator';
import type { Request, Response } from 'express';

@Controller()
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  @Post('v1/workspaces/:workspaceId/oauth/:provider/connect')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('accounts.connect')
  async connectProvider(
    @Param('workspaceId') workspaceId: string,
    @Param('provider') provider: string,
    @Req() req: Request,
  ) {
    const userId = req.user!.id;
    // Base URL is assumed or passed from request, here we use a placeholder or req.protocol + req.get('host')
    // We'll just hardcode callback for now or build it
    const redirectUri = `${req.protocol}://${req.get('host')}/api/v1/oauth/${provider}/callback`;
    const url = await this.oauthService.generateAuthUrl(
      provider,
      userId,
      workspaceId,
      redirectUri,
    );
    return { url };
  }

  @Get('v1/oauth/:provider/callback')
  @UseGuards(AuthGuard) // Only requires AuthGuard, we validate user/workspace via state
  async callbackProvider(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      throw new ForbiddenException('Missing code or state');
    }

    const userId = req.user!.id;
    const redirectUri = `${req.protocol}://${req.get('host')}/api/v1/oauth/${provider}/callback`;

    await this.oauthService.handleOAuthCallback(
      provider,
      userId,
      state,
      code,
      redirectUri,
    );

    // Redirect to some success page or return ok
    res.json({ success: true, message: `${provider} connected successfully` });
  }
}
