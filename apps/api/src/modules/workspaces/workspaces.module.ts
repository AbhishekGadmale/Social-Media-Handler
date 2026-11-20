import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { WorkspaceMembersController } from './controllers/workspace-members.controller';
import { InvitationsController } from './controllers/invitations.controller';
import { WorkspacesService } from './services/workspaces.service';

@Module({
  imports: [CoreModule, AuthModule, BillingModule],
  controllers: [WorkspaceMembersController, InvitationsController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
