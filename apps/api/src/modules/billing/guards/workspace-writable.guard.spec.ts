import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { WorkspaceWritableGuard } from './workspace-writable.guard';

describe('WorkspaceWritableGuard', () => {
  let guard: WorkspaceWritableGuard;
  let entitlementsServiceMock: any;

  beforeEach(() => {
    entitlementsServiceMock = {
      assertWorkspaceWritable: vi.fn(),
    };
    guard = new WorkspaceWritableGuard(entitlementsServiceMock);
  });

  const createMockContext = (workspaceId?: string) => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          params: { workspaceId },
        }),
      }),
    } as unknown as ExecutionContext;
  };

  it('allows access when workspaceId is not in route params', async () => {
    const ctx = createMockContext(undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(
      entitlementsServiceMock.assertWorkspaceWritable,
    ).not.toHaveBeenCalled();
  });

  it('allows access when entitlementsService confirms workspace is writable', async () => {
    const ctx = createMockContext('ws-active');
    entitlementsServiceMock.assertWorkspaceWritable.mockResolvedValue(
      undefined,
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(
      entitlementsServiceMock.assertWorkspaceWritable,
    ).toHaveBeenCalledWith('ws-active');
  });

  it('throws ForbiddenException when entitlementsService rejects read-only workspace', async () => {
    const ctx = createMockContext('ws-expired');
    entitlementsServiceMock.assertWorkspaceWritable.mockRejectedValue(
      new ForbiddenException(
        'Workspace is in read-only mode due to expired trial.',
      ),
    );

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(
      entitlementsServiceMock.assertWorkspaceWritable,
    ).toHaveBeenCalledWith('ws-expired');
  });
});
