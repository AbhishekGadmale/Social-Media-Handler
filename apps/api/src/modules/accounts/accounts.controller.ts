import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/permission.decorator';
import { AccountsService } from './accounts.service';

import { Throttle } from '@nestjs/throttler';
import { RateLimitPolicies } from '../core/rate-limit.policies';

import { AuditAction } from '@agency-os/database';
import { AuditService } from '../core/audit.service';
import type { Request } from 'express';

@Controller('v1/workspaces/:workspaceId/accounts')
export class AccountsController {
  constructor(
    @InjectQueue('sync') private readonly syncQueue: Queue,
    private readonly accountsService: AccountsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('accounts.view')
  async listAccounts(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    const accounts =
      await this.accountsService.listWorkspaceAccounts(workspaceId);
    return { accounts };
  }

  @Throttle({ default: RateLimitPolicies.expensive })
  @Post(':accountId/sync')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('accounts.view') // Read-triggering, not mutation per spec
  async triggerSync(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Req() req: Request,
  ) {
    const job = await this.syncQueue.add(
      'sync-account',
      {
        socialAccountId: accountId,
        workspaceId,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );

    const userId = (req as any).user?.id;
    this.auditService.logAction({
      action: AuditAction.ACCOUNT_SYNC_TRIGGERED,
      workspaceId,
      actorId: userId,
      targetType: 'SocialAccount',
      targetId: accountId,
      requestId: (req as any).id,
      metadata: { jobId: job.id },
    });

    return { queued: true, jobId: job.id };
  }
}
