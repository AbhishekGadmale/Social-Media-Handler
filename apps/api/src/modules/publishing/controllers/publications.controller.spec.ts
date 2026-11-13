import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PublicationsController } from './publications.controller';
import { ExecutionMetadataInterceptor } from '../../core/interceptors/execution-metadata.interceptor';
import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AddPublicationTargetDto } from '../dto/publication.dto';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../../auth/decorators/permission.decorator';
import { PermissionMatrix } from '../../auth/guards/permission.guard';
import { WorkspaceWritableGuard } from '../../billing/guards/workspace-writable.guard';

describe('PublicationsController Security & Interceptor', () => {
  let controller: PublicationsController;
  let interceptor: ExecutionMetadataInterceptor;

  const mockService = {
    addTarget: vi.fn().mockResolvedValue({
      id: 'variant-1',
      status: 'QUEUED',
      executionMetadata: { version: 1, operationId: 'internal' },
    }),
    updateTarget: vi.fn().mockResolvedValue({
      id: 'variant-1',
      status: 'QUEUED',
      executionMetadata: { version: 1, operationId: 'internal' },
    }),
    reconcile: vi.fn().mockResolvedValue({
      id: 'variant-1',
      status: 'PUBLISHED',
    }),
  } as any;

  beforeEach(() => {
    controller = new PublicationsController(mockService);
    interceptor = new ExecutionMetadataInterceptor();
  });

  it('rejects executionMetadata from AddPublicationTargetDto injection', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    const maliciousPayload = {
      socialAccountId: '33333333-3333-3333-3333-333333333333',
      content: 'Hello',
      executionMetadata: { version: 1, operationId: 'attacker-uuid' },
    };

    let error: any;
    try {
      await pipe.transform(maliciousPayload, {
        type: 'body',
        metatype: AddPublicationTargetDto,
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.response.message).toContain(
      'property executionMetadata should not exist',
    );
  });

  it('does not leak executionMetadata in controller response via interceptor', async () => {
    const res = await controller.addTarget(
      'workspace-1',
      { id: 'user-1' } as any,
      'post-1',
      {
        socialAccountId: '33333333-3333-3333-3333-333333333333',
      },
    );

    const { of } = await import('rxjs');
    const callHandler: any = { handle: () => of(res) };
    const intercepted: any = await new Promise((resolve) =>
      interceptor.intercept({} as any, callHandler).subscribe(resolve),
    );

    expect(intercepted.id).toBe('variant-1');
    expect(intercepted.status).toBe('QUEUED');
    expect(intercepted.executionMetadata).toBeUndefined(); // Stripped!
  });

  describe('Reconcile endpoint RBAC & delegation', () => {
    it('is decorated with publishing.reconcile and not publishing.publish', () => {
      const reflector = new Reflector();
      const requiredPermission = reflector.get<string>(
        PERMISSION_KEY,
        // eslint-disable-next-line @typescript-eslint/unbound-method
        controller.reconcileTarget,
      );

      expect(requiredPermission).toBe('publishing.reconcile');
      expect(requiredPermission).not.toBe('publishing.publish');
    });

    it('enforces PermissionMatrix: OWNER and MANAGER allowed, EDITOR not allowed', () => {
      const allowedRoles = PermissionMatrix['publishing.reconcile'];
      expect(allowedRoles).toBeDefined();
      expect(allowedRoles).toContain('OWNER');
      expect(allowedRoles).toContain('MANAGER');
      expect(allowedRoles).not.toContain('EDITOR');
      expect(allowedRoles).not.toContain('CLIENT_APPROVER');
      expect(allowedRoles).not.toContain('VIEWER');

      // Contrast with publishing.publish which permits EDITOR
      expect(PermissionMatrix['publishing.publish']).toContain('EDITOR');
    });

    it('delegates reconcileTarget to PublishingApplicationService.reconcile', async () => {
      mockService.reconcile = vi
        .fn()
        .mockResolvedValue({ id: 'variant-1', status: 'PUBLISHED' });
      const dto = {
        decision: 'CONFIRM_PUBLISHED' as const,
        externalPostId: 'ext-123',
        reason: 'Operator verified',
      };

      const result = await controller.reconcileTarget(
        'workspace-1',
        { id: 'user-1' } as any,
        'variant-1',
        dto,
      );

      expect(mockService.reconcile).toHaveBeenCalledWith(
        'workspace-1',
        'user-1',
        'variant-1',
        dto,
      );
      expect(result).toEqual({ id: 'variant-1', status: 'PUBLISHED' });
    });
  });

  describe('WorkspaceWritableGuard decoration and enforcement', () => {
    it('decorates removeTarget with WorkspaceWritableGuard', () => {
      const guards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PublicationsController.prototype as any).removeTarget,
        ) || [];
      expect(guards).toContain(WorkspaceWritableGuard);
    });

    it('decorates requestRemoteDelete with WorkspaceWritableGuard', () => {
      const guards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PublicationsController.prototype as any).requestRemoteDelete,
        ) || [];
      expect(guards).toContain(WorkspaceWritableGuard);
    });

    it('decorates validateTarget with WorkspaceWritableGuard', () => {
      const guards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PublicationsController.prototype as any).validateTarget,
        ) || [];
      expect(guards).toContain(WorkspaceWritableGuard);
    });

    it('decorates unscheduleTarget with WorkspaceWritableGuard', () => {
      const guards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PublicationsController.prototype as any).unscheduleTarget,
        ) || [];
      expect(guards).toContain(WorkspaceWritableGuard);
    });

    it('decorates cancelTarget with WorkspaceWritableGuard', () => {
      const guards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PublicationsController.prototype as any).cancelTarget,
        ) || [];
      expect(guards).toContain(WorkspaceWritableGuard);
    });

    it('decorates reconcileTarget with WorkspaceWritableGuard', () => {
      const guards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (PublicationsController.prototype as any).reconcileTarget,
        ) || [];
      expect(guards).toContain(WorkspaceWritableGuard);
    });

    it('preserves WorkspaceWritableGuard on the six previously guarded handlers (regression)', () => {
      const previouslyGuardedMethods = [
        'addTarget',
        'updateTarget',
        'publishTarget',
        'retryTarget',
        'scheduleTarget',
        'rescheduleTarget',
      ] as const;

      for (const method of previouslyGuardedMethods) {
        const guards =
          Reflect.getMetadata(
            GUARDS_METADATA,
            (PublicationsController.prototype as any)[method],
          ) || [];
        expect(guards).toContain(WorkspaceWritableGuard);
      }
    });
  });
});
