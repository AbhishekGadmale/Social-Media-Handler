import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { PublishingApplicationService } from '../services/publishing-application.service';
import {
  AddPublicationTargetDto,
  UpdatePublicationTargetDto,
  SchedulePublicationDto,
  ReconcilePublicationDto,
} from '../dto/publication.dto';
import { RequirePermission } from '../../auth/decorators/permission.decorator';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { WorkspaceGuard } from '../../auth/guards/workspace.guard';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import { WorkspaceWritableGuard } from '../../billing/guards/workspace-writable.guard';

import { CurrentUser } from '../../auth/decorators/user.decorator';

@Controller('v1/workspaces/:workspaceId')
@UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
export class PublicationsController {
  constructor(
    private readonly publishingService: PublishingApplicationService,
  ) {}

  @Post('posts/:postId/publications')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('posts.update')
  @HttpCode(201)
  async addTarget(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('postId') postId: string,
    @Body() dto: AddPublicationTargetDto,
  ) {
    return this.publishingService.addTarget(workspaceId, user.id, postId, dto);
  }

  @Patch('publications/:publicationId')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('posts.update')
  async updateTarget(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('publicationId') publicationId: string,
    @Body() dto: UpdatePublicationTargetDto,
  ) {
    return this.publishingService.updateTarget(
      workspaceId,
      user.id,
      publicationId,
      dto,
    );
  }

  @Delete('publications/:publicationId')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('posts.update')
  async removeTarget(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('publicationId') publicationId: string,
  ) {
    return this.publishingService.removeTarget(
      workspaceId,
      user.id,
      publicationId,
    );
  }

  @Delete('publications/:publicationId/remote')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('posts.delete')
  @HttpCode(202)
  async requestRemoteDelete(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('publicationId') publicationId: string,
  ) {
    return this.publishingService.requestRemoteDelete(
      workspaceId,
      user.id,
      publicationId,
    );
  }

  @Post('publications/:publicationId/validate')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('publishing.validate')
  @HttpCode(200)
  async validateTarget(
    @Param('workspaceId') workspaceId: string,
    @Param('publicationId') publicationId: string,
  ) {
    return this.publishingService.validateTarget(workspaceId, publicationId);
  }

  @Post('publications/:publicationId/publish')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('publishing.publish')
  @HttpCode(202)
  async publishTarget(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('publicationId') publicationId: string,
  ) {
    return this.publishingService.requestPublish(
      workspaceId,
      user.id,
      publicationId,
    );
  }

  @Post('publications/:publicationId/retry')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('publishing.retry')
  @HttpCode(202)
  async retryTarget(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('publicationId') publicationId: string,
  ) {
    return this.publishingService.requestRetry(
      workspaceId,
      user.id,
      publicationId,
    );
  }

  @Post('publications/:publicationId/schedule')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('publishing.schedule')
  @HttpCode(202)
  async scheduleTarget(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('publicationId') publicationId: string,
    @Body() dto: SchedulePublicationDto,
  ) {
    return this.publishingService.schedule(
      workspaceId,
      user.id,
      publicationId,
      dto,
    );
  }

  @Post('publications/:publicationId/reschedule')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('publishing.schedule')
  @HttpCode(200)
  async rescheduleTarget(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('publicationId') publicationId: string,
    @Body() dto: SchedulePublicationDto,
  ) {
    return this.publishingService.reschedule(
      workspaceId,
      user.id,
      publicationId,
      dto,
    );
  }

  @Post('publications/:publicationId/unschedule')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('publishing.schedule')
  @HttpCode(200)
  async unscheduleTarget(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('publicationId') publicationId: string,
  ) {
    return this.publishingService.unschedule(
      workspaceId,
      user.id,
      publicationId,
    );
  }

  @Post('publications/:publicationId/cancel')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('publishing.cancel')
  @HttpCode(200)
  async cancelTarget(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('publicationId') publicationId: string,
  ) {
    return this.publishingService.cancelQueued(
      workspaceId,
      user.id,
      publicationId,
    );
  }

  @Post('publications/:publicationId/reconcile')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('publishing.reconcile')
  @HttpCode(200)
  async reconcileTarget(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('publicationId') publicationId: string,
    @Body() dto: ReconcilePublicationDto,
  ) {
    return this.publishingService.reconcile(
      workspaceId,
      user.id,
      publicationId,
      dto,
    );
  }
}
