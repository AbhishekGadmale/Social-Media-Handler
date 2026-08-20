import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/permission.decorator';

export const PermissionMatrix: Record<string, string[]> = {
  'workspace.view': ['OWNER', 'MANAGER', 'EDITOR', 'CLIENT_APPROVER', 'VIEWER'],
  'members.manage': ['OWNER', 'MANAGER'],
  'accounts.view': ['OWNER', 'MANAGER', 'EDITOR', 'CLIENT_APPROVER', 'VIEWER'],
  'accounts.connect': ['OWNER', 'MANAGER'],
  'accounts.disconnect': ['OWNER', 'MANAGER'],
  'analytics.view': ['OWNER', 'MANAGER', 'EDITOR', 'CLIENT_APPROVER', 'VIEWER'],
  'posts.create/edit': ['OWNER', 'MANAGER', 'EDITOR'],
  'posts.publish': ['OWNER', 'MANAGER', 'EDITOR'],
  'posts.approve': ['OWNER', 'MANAGER', 'CLIENT_APPROVER'],
  'audit.view': ['OWNER', 'MANAGER'],
};

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<import('express').Request>();
    const role = request.workspaceRole;

    if (!role) {
      throw new ForbiddenException('Workspace role not found');
    }

    const allowedRoles = PermissionMatrix[requiredPermission];
    if (!allowedRoles || !allowedRoles.includes(role)) {
      throw new ForbiddenException(`Lacking permission: ${requiredPermission}`);
    }

    return true;
  }
}
