import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { WorkspaceGuard } from '../../auth/guards/workspace.guard';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import { WorkspaceWritableGuard } from '../../billing/guards/workspace-writable.guard';
import { RequirePermission } from '../../auth/decorators/permission.decorator';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import { WorkspacesService } from '../services/workspaces.service';
import { CreateInvitationDto } from '../dto/create-invitation.dto';
import { UpdateMemberRoleDto } from '../dto/update-member-role.dto';

@Controller('v1/workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
export class WorkspaceMembersController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post('invitations')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('members.manage')
  async inviteMember(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Req() req: Request,
    @Body() dto: CreateInvitationDto,
  ) {
    const callerRole = (req as any).workspaceRole;
    return this.workspacesService.inviteMember(
      workspaceId,
      user.id,
      callerRole,
      dto,
    );
  }

  @Get()
  @RequirePermission('workspace.view')
  async listMembers(
    @Param('workspaceId') workspaceId: string,
    @Req() req: Request,
  ) {
    const callerRole = (req as any).workspaceRole;
    return this.workspacesService.listMembers(workspaceId, callerRole);
  }

  @Post('invitations/:invitationId/revoke')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('members.manage')
  async revokeInvitation(
    @Param('workspaceId') workspaceId: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: any,
  ) {
    return this.workspacesService.revokeInvitation(
      workspaceId,
      invitationId,
      user.id,
    );
  }

  @Post('invitations/:invitationId/resend')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('members.manage')
  async resendInvitation(
    @Param('workspaceId') workspaceId: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: any,
  ) {
    return this.workspacesService.resendInvitation(
      workspaceId,
      invitationId,
      user.id,
    );
  }

  @Patch(':memberId')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('members.manage')
  async updateMemberRole(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: any,
    @Req() req: Request,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    const callerRole = (req as any).workspaceRole;
    return this.workspacesService.updateMemberRole(
      workspaceId,
      memberId,
      user.id,
      callerRole,
      dto,
    );
  }

  @Delete(':memberId')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('members.manage')
  async removeMember(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    const callerRole = (req as any).workspaceRole;
    return this.workspacesService.removeMember(
      workspaceId,
      memberId,
      user.id,
      callerRole,
    );
  }
}
