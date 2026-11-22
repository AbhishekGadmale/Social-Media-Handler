import {
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/permission.decorator';
import { AnalyticsService } from './analytics.service';
import type { Request } from 'express';

@Controller('v1/workspaces/:workspaceId/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('analytics.view')
  async getOverview(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req?: Request,
  ) {
    const role = (req as any)?.workspaceRole;
    const clientId = (req as any)?.workspaceClientId;
    const scopeClientId =
      role === 'CLIENT_APPROVER' && clientId ? clientId : undefined;
    return scopeClientId
      ? this.analyticsService.getWorkspaceOverview(workspaceId, scopeClientId)
      : this.analyticsService.getWorkspaceOverview(workspaceId);
  }

  @Get('accounts/:accountId')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('analytics.view')
  async getAccountAnalytics(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Req() req?: Request,
  ) {
    const role = (req as any)?.workspaceRole;
    const clientId = (req as any)?.workspaceClientId;
    const scopeClientId =
      role === 'CLIENT_APPROVER' && clientId ? clientId : undefined;
    return scopeClientId
      ? this.analyticsService.getAccountAnalytics(
          workspaceId,
          accountId,
          scopeClientId,
        )
      : this.analyticsService.getAccountAnalytics(workspaceId, accountId);
  }
}
