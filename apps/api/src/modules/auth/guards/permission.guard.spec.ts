import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionGuard, PermissionMatrix } from './permission.guard';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';

describe('PermissionGuard & PermissionMatrix', () => {
  let guard: PermissionGuard;
  let reflector: Reflector;

  const createMockContext = (role?: string): ExecutionContext => {
    const request: any = {
      workspaceRole: role,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionGuard(reflector);
  });

  describe('PermissionMatrix tightening for billing.view', () => {
    it('allows OWNER, MANAGER, and EDITOR for billing.view', () => {
      const allowed = PermissionMatrix['billing.view'];
      expect(allowed).toContain('OWNER');
      expect(allowed).toContain('MANAGER');
      expect(allowed).toContain('EDITOR');
    });

    it('excludes CLIENT_APPROVER and VIEWER from billing.view', () => {
      const allowed = PermissionMatrix['billing.view'];
      expect(allowed).not.toContain('CLIENT_APPROVER');
      expect(allowed).not.toContain('VIEWER');
    });

    it('retains publishing.validate for all 5 roles', () => {
      const allowed = PermissionMatrix['publishing.validate'];
      expect(allowed).toEqual([
        'OWNER',
        'MANAGER',
        'EDITOR',
        'CLIENT_APPROVER',
        'VIEWER',
      ]);
    });
  });

  describe('PermissionGuard execution', () => {
    it('allows access when no permission is required', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockContext('CLIENT_APPROVER');
      expect(guard.canActivate(context)).toBe(true);
    });

    it('throws ForbiddenException when role is missing', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue('billing.view');
      const context = createMockContext(undefined);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('allows access when role is in PermissionMatrix', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue('billing.view');
      const context = createMockContext('EDITOR');
      expect(guard.canActivate(context)).toBe(true);
    });

    it('rejects with ForbiddenException when CLIENT_APPROVER requests billing.view', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue('billing.view');
      const context = createMockContext('CLIENT_APPROVER');
      expect(() => guard.canActivate(context)).toThrow(
        new ForbiddenException('Lacking permission: billing.view'),
      );
    });

    it('rejects with ForbiddenException when VIEWER requests billing.view', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue('billing.view');
      const context = createMockContext('VIEWER');
      expect(() => guard.canActivate(context)).toThrow(
        new ForbiddenException('Lacking permission: billing.view'),
      );
    });
  });
});
