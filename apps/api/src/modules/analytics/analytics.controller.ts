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
  async getOverview(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    const overview =
      await this.analyticsService.getWorkspaceOverview(workspaceId);
    return overview;
  }

  @Get('accounts/:accountId')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('analytics.view')
  async getAccountAnalytics(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.analyticsService.getAccountAnalytics(workspaceId, accountId);
  }
}
