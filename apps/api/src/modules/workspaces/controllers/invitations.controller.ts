import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import { WorkspacesService } from '../services/workspaces.service';
import { AcceptInvitationDto } from '../dto/accept-invitation.dto';

@Controller('v1/invitations')
export class InvitationsController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get('info')
  async getInvitationInfo(@Query('token') token: string) {
    return this.workspacesService.getInvitationInfo(token);
  }

  @Post('accept')
  @UseGuards(AuthGuard)
  async acceptInvitation(
    @CurrentUser() user: any,
    @Body() dto: AcceptInvitationDto,
  ) {
    return this.workspacesService.acceptInvitation(
      user.id,
      user.email,
      dto.token,
    );
  }
}
