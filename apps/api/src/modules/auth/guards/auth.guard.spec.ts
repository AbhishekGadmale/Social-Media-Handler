import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthGuard } from './auth.guard';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';

describe('AuthGuard (Security Epoch Enforcement)', () => {
  let guard: AuthGuard;
  let sessionManagerMock: {
    validateSession: any;
    destroySession: any;
  };
  let userRepoMock: {
    findById: any;
  };

  const createMockContext = (
    cookies: Record<string, string> = {},
    headers: Record<string, string> = {},
    method = 'GET',
  ): { context: ExecutionContext; request: any } => {
    const request: any = {
      cookies,
      headers,
      method,
    };
    const context: any = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    };
    return { context, request };
  };

  beforeEach(() => {
    sessionManagerMock = {
      validateSession: vi.fn(),
      destroySession: vi.fn().mockResolvedValue(undefined),
    };
    userRepoMock = {
      findById: vi.fn(),
    };
    guard = new AuthGuard(sessionManagerMock as any, userRepoMock as any);
  });

  it('Scenario 1: allows request when session.securityEpoch strictly equals user.securityEpoch', async () => {
    const { context, request } = createMockContext({ session: 'sess-valid' });
    sessionManagerMock.validateSession.mockResolvedValueOnce({
      userId: 'user-1',
      securityEpoch: 2,
    });
    userRepoMock.findById.mockResolvedValueOnce({
      id: 'user-1',
      securityEpoch: 2,
      emailVerified: true,
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.user).toBeDefined();
    expect(request.user.id).toBe('user-1');
    expect(sessionManagerMock.destroySession).not.toHaveBeenCalled();
  });

  it('Scenario 2: rejects with 401 and destroys session when session.securityEpoch < user.securityEpoch (stale session)', async () => {
    const { context } = createMockContext({ session: 'sess-stale' });
    sessionManagerMock.validateSession.mockResolvedValueOnce({
      userId: 'user-1',
      securityEpoch: 1, // Stale epoch from before password change
    });
    userRepoMock.findById.mockResolvedValueOnce({
      id: 'user-1',
      securityEpoch: 2, // User has incremented epoch in DB
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid or expired session'),
    );
    expect(sessionManagerMock.destroySession).toHaveBeenCalledWith(
      'sess-stale',
    );
  });

  it('Scenario 3: rejects with 401 and destroys session when session.securityEpoch > user.securityEpoch (anomalous/tampered epoch)', async () => {
    const { context } = createMockContext({ session: 'sess-anomalous' });
    sessionManagerMock.validateSession.mockResolvedValueOnce({
      userId: 'user-1',
      securityEpoch: 5, // Higher than DB
    });
    userRepoMock.findById.mockResolvedValueOnce({
      id: 'user-1',
      securityEpoch: 2,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid or expired session'),
    );
    expect(sessionManagerMock.destroySession).toHaveBeenCalledWith(
      'sess-anomalous',
    );
  });

  it('Scenario 4: permits legacy session (securityEpoch undefined) if and only if user.securityEpoch === 1', async () => {
    const { context, request } = createMockContext({
      session: 'sess-legacy-1',
    });
    sessionManagerMock.validateSession.mockResolvedValueOnce({
      userId: 'user-1',
      securityEpoch: undefined, // Legacy session created before migration
    });
    userRepoMock.findById.mockResolvedValueOnce({
      id: 'user-1',
      securityEpoch: 1, // Base initial epoch
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.user.id).toBe('user-1');
    expect(sessionManagerMock.destroySession).not.toHaveBeenCalled();
  });

  it('Scenario 5: rejects legacy session (securityEpoch undefined) when user.securityEpoch > 1', async () => {
    const { context } = createMockContext({ session: 'sess-legacy-stale' });
    sessionManagerMock.validateSession.mockResolvedValueOnce({
      userId: 'user-1',
      securityEpoch: undefined, // Legacy session lacking epoch
    });
    userRepoMock.findById.mockResolvedValueOnce({
      id: 'user-1',
      securityEpoch: 3, // User has undergone password changes
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid or expired session'),
    );
    expect(sessionManagerMock.destroySession).toHaveBeenCalledWith(
      'sess-legacy-stale',
    );
  });

  it('Scenario 6: fails closed on malformed epoch values without defaulting to 1', async () => {
    const malformedValues = [null, -1, 0, '1', NaN, 1.5, {}, []];

    for (const malformedVal of malformedValues) {
      const { context } = createMockContext({ session: 'sess-malformed' });
      sessionManagerMock.validateSession.mockResolvedValueOnce({
        userId: 'user-1',
        securityEpoch: malformedVal,
      });
      userRepoMock.findById.mockResolvedValueOnce({
        id: 'user-1',
        securityEpoch: 1,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid or expired session'),
      );
      expect(sessionManagerMock.destroySession).toHaveBeenCalledWith(
        'sess-malformed',
      );
      vi.clearAllMocks();
    }
  });

  it('rejects with 401 when no session cookie is provided', async () => {
    const { context } = createMockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('No session cookie provided'),
    );
  });

  it('rejects with 401 when session does not exist in Redis', async () => {
    const { context } = createMockContext({ session: 'sess-expired' });
    sessionManagerMock.validateSession.mockResolvedValueOnce(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid or expired session'),
    );
  });

  it('rejects with 401 when user no longer exists in database', async () => {
    const { context } = createMockContext({ session: 'sess-deleted-user' });
    sessionManagerMock.validateSession.mockResolvedValueOnce({
      userId: 'user-deleted',
      securityEpoch: 1,
    });
    userRepoMock.findById.mockResolvedValueOnce(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('User no longer exists'),
    );
  });

  it('validates CSRF token on mutating requests (POST, PUT, PATCH, DELETE)', async () => {
    const csrfToken = 'valid-csrf-token';
    const { context } = createMockContext(
      { session: 'sess-valid', csrfToken },
      { 'x-csrf-token': csrfToken },
      'POST',
    );
    sessionManagerMock.validateSession.mockResolvedValueOnce({
      userId: 'user-1',
      securityEpoch: 1,
    });
    userRepoMock.findById.mockResolvedValueOnce({
      id: 'user-1',
      securityEpoch: 1,
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('throws ForbiddenException on CSRF token mismatch on mutating requests', async () => {
    const { context } = createMockContext(
      { session: 'sess-valid', csrfToken: 'token-a' },
      { 'x-csrf-token': 'token-b' },
      'POST',
    );
    sessionManagerMock.validateSession.mockResolvedValueOnce({
      userId: 'user-1',
      securityEpoch: 1,
    });
    userRepoMock.findById.mockResolvedValueOnce({
      id: 'user-1',
      securityEpoch: 1,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('CSRF token mismatch'),
    );
  });
});
