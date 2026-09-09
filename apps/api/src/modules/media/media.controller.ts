import {
  Controller,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { MediaService } from './media.service';
import type { InitiateUploadDto } from './media.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/permission.decorator';
import type { Request } from 'express';

@UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
@Controller('v1/workspaces/:workspaceId/media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @RequirePermission('posts.create')
  @Post('uploads')
  async initiateUpload(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: InitiateUploadDto,
    @Req() req: Request,
  ) {
    const userId = req.user!.id;
    return this.mediaService.initiateUpload(workspaceId, userId, dto);
  }

  @RequirePermission('posts.create')
  @Post(':mediaId/complete')
  async completeUpload(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Req() req: Request,
  ) {
    const userId = req.user!.id;
    return this.mediaService.completeUpload(workspaceId, mediaId, userId);
  }
}
