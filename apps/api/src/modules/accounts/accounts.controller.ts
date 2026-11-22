import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
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
import { WorkspaceWritableGuard } from '../billing/guards/workspace-writable.guard';
import { RequirePermission } from '../auth/decorators/permission.decorator';
import { CurrentUser } from '../auth/decorators/user.decorator';
import { AccountsService } from './accounts.service';
import { AssignAccountClientDto } from './dto/assign-account-client.dto';

import { Throttle } from '@nestjs/throttler';
import { RateLimitPolicies } from '../core/rate-limit.policies';

import { AuditAction } from '@agency-os/database';
import { SyncJobData } from '@agency-os/shared';
import { AuditService } from '../core/audit.service';
import { extractCorrelationId } from '../core/correlation-id.utils';
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
  async listAccounts(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req?: Request,
  ) {
    const role = (req as any)?.workspaceRole;
    const clientId = (req as any)?.workspaceClientId;
    const scopeClientId =
      role === 'CLIENT_APPROVER' && clientId ? clientId : undefined;
    const accounts = await this.accountsService.listWorkspaceAccounts(
      workspaceId,
      scopeClientId,
    );
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
    const role = (req as any).workspaceRole;
    const clientId = (req as any).workspaceClientId;
    const scopeClientId =
      role === 'CLIENT_APPROVER' && clientId ? clientId : undefined;
    if (scopeClientId) {
      await this.accountsService.getWorkspaceAccount(
        workspaceId,
        accountId,
        scopeClientId,
      );
    } else {
      await this.accountsService.getWorkspaceAccount(workspaceId, accountId);
    }

    const correlationId = extractCorrelationId(req);

    const payload: SyncJobData = {
      socialAccountId: accountId,
      workspaceId,
      ...(correlationId ? { correlationId } : {}),
    };

    const job = await this.syncQueue.add('sync-account', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });

    const userId = (req as any).user?.id;
    this.auditService.logActionBestEffort({
      action: AuditAction.ACCOUNT_SYNC_TRIGGERED,
      workspaceId,
      actorId: userId,
      targetType: 'SocialAccount',
      targetId: accountId,
      requestId: (req as any).id,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
      metadata: { jobId: job.id },
    });

    return { queued: true, jobId: job.id };
  }

  @Throttle({ default: RateLimitPolicies.expensive })
  @Post(':accountId/disconnect')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('accounts.disconnect')
  async disconnectAccount(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id;
    const requestId = (req as any).id;
    return this.accountsService.disconnectAccount(
      workspaceId,
      accountId,
      userId,
      requestId,
    );
  }

  @Patch(':accountId/client')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard, WorkspaceWritableGuard)
  @RequirePermission('clients.manage')
  async assignClient(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @CurrentUser() user: any,
    @Body() dto: AssignAccountClientDto,
  ) {
    return this.accountsService.assignClient(
      workspaceId,
      accountId,
      dto.clientId ?? null,
      user.id,
    );
  }
}
