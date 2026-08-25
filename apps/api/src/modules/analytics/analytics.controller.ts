import {
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/permission.decorator';
import { PrismaClient } from '@agency-os/database';
import type { Request } from 'express';

@Controller('v1/workspaces/:workspaceId/analytics')
export class AnalyticsController {
  constructor(private readonly prisma: PrismaClient) {}

  @Get('accounts/:accountId')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('analytics.view')
  async getAccountAnalytics(
    @Param('workspaceId') workspaceId: string,
    @Param('accountId') accountId: string,
  ) {
    // Ensure account actually belongs to workspace! Cross-workspace check!
    const account = await this.prisma.socialAccount.findFirst({
      where: {
        id: accountId,
        workspaceId,
      },
    });

    if (!account) {
      throw new NotFoundException('Account not found in workspace');
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setUTCHours(0, 0, 0, 0);

    const metrics = await this.prisma.accountMetricDaily.findMany({
      where: {
        socialAccountId: accountId,
        date: {
          gte: thirtyDaysAgo,
        },
      },
      orderBy: {
        date: 'asc',
      },
      select: {
        date: true,
        followers: true,
        engagement: true,
      },
    });

    return { metrics };
  }
}
