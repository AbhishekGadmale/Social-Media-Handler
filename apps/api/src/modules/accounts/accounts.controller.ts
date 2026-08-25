import { Controller, Post, Param, UseGuards, Req } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/permission.decorator';

@Controller('v1/workspaces/:workspaceId/accounts')
export class AccountsController {
  constructor(@InjectQueue('sync') private readonly syncQueue: Queue) {}

  @Post(':accountId/sync')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('accounts.view') // Read-triggering, not mutation per spec
  async triggerSync(
    @Param('workspaceId') workspaceId: string,
    @Param('accountId') accountId: string,
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
    return { queued: true, jobId: job.id };
  }
}
