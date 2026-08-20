import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { WorkspaceMemberRepository } from '@agency-os/database';
import { Request } from 'express';

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly memberRepo: WorkspaceMemberRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const workspaceId = request.params.workspaceId as string;
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (!workspaceId) {
      return true; // No workspace context needed for this route
    }

    const membership = await this.memberRepo.findByWorkspaceAndUserId(
      workspaceId,
      user.id,
    );

    if (!membership) {
      throw new ForbiddenException('User is not a member of this workspace');
    }

    request.workspaceRole = membership.role;
    return true;
  }
}
