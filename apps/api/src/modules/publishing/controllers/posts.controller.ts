import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { PublishingApplicationService } from '../services/publishing-application.service';
import { CreatePostDto, UpdatePostDto } from '../dto/post.dto';
import { RequirePermission } from '../../auth/decorators/permission.decorator';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { WorkspaceGuard } from '../../auth/guards/workspace.guard';
import { PermissionGuard } from '../../auth/guards/permission.guard';

import { CurrentUser } from '../../auth/decorators/user.decorator';

@Controller('v1/workspaces/:workspaceId/posts')
@UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
export class PostsController {
  constructor(
    private readonly publishingService: PublishingApplicationService,
  ) {}

  @Post()
  @RequirePermission('posts.create')
  @HttpCode(201)
  async createDraft(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Body() dto: CreatePostDto,
  ) {
    return this.publishingService.createDraft(workspaceId, user.id, dto);
  }

  @Get()
  @RequirePermission('posts.read')
  async getPosts(
    @Param('workspaceId') workspaceId: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.publishingService.getPosts(
      workspaceId,
      take ? parseInt(take, 10) : 50,
      skip ? parseInt(skip, 10) : 0,
    );
  }

  @Get(':postId')
  @RequirePermission('posts.read')
  async getPostById(
    @Param('workspaceId') workspaceId: string,
    @Param('postId') postId: string,
  ) {
    return this.publishingService.getPostById(workspaceId, postId);
  }

  @Patch(':postId')
  @RequirePermission('posts.update')
  async updateDraft(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('postId') postId: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.publishingService.updateDraft(
      workspaceId,
      user.id,
      postId,
      dto,
    );
  }

  @Delete(':postId')
  @RequirePermission('posts.delete')
  async deletePost(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Param('postId') postId: string,
  ) {
    return this.publishingService.deletePost(workspaceId, user.id, postId);
  }
}
