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

    // Architectural Decision (Option A - PR #49):
    // Email verification enforcement is deferred to PR #50.
    // Newly registered users are created with emailVerified: false, but are permitted
    // to access their provisioned workspace during this interim phase.
    // Full email verification lifecycle and 403 gating will be introduced in PR #50.

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
