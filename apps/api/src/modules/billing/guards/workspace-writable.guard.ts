import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { EntitlementsService } from '../entitlements.service';

@Injectable()
export class WorkspaceWritableGuard implements CanActivate {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const workspaceId = request.params?.workspaceId as string;

    if (!workspaceId) {
      return true;
    }

    await this.entitlementsService.assertWorkspaceWritable(workspaceId);
    return true;
  }
}
