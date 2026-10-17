import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PublishingApplicationService } from './publishing-application.service';
import { AuditAction, PostStatus } from '@agency-os/database';

describe('PublishingApplicationService - reconcile()', () => {
  let service: PublishingApplicationService;
  let prismaMock: any;
  let txMock: any;
  let auditMock: any;
  let validatorMock: any;

  const workspaceId = 'workspace-1111-1111';
  const authorId = 'user-2222-2222';
  const variantId = 'variant-3333-3333';

  const createBaseVariant = (overrides: Record<string, any> = {}) => ({
    id: variantId,
    postId: 'post-4444-4444',
    socialAccountId: 'acc-5555-5555',
    workspaceId,
    status: PostStatus.UNKNOWN,
    executionMetadata: {
      phase: 'AMBIGUOUS',
      operationId: 'op-orig-123',
      containerId: 'container-orig-456',
      dispatchVersion: 2,
    },
    ...overrides,
  });

  const createBaseAttempt = (overrides: Record<string, any> = {}) => ({
    id: 'attempt-7777-7777',
    variantId,
    attemptNumber: 1,
    status: 'FAILED',
    failureCategory: 'UNKNOWN_RESULT',
    ...overrides,
  });

  beforeEach(() => {
    txMock = {
      postPlatformVariant: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      publicationAttempt: {
        findMany: vi.fn().mockResolvedValue([createBaseAttempt()]),
        update: vi.fn().mockResolvedValue(createBaseAttempt()),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-log-1' }),
      },
    };

    prismaMock = {
      postPlatformVariant: {
        findFirst: vi.fn().mockResolvedValue(createBaseVariant()),
      },
      $transaction: vi.fn().mockImplementation(async (cb: any) => {
        return cb(txMock);
      }),
    };

    auditMock = {} as any;
    validatorMock = {} as any;

    service = new PublishingApplicationService(
      prismaMock,
      auditMock,
      validatorMock,
    );
  });

  // 1. CONFIRM_PUBLISHED happy path
  it('CONFIRM_PUBLISHED happy path: atomically updates variant, executionMetadata, attempt, and audit log', async () => {
    const dto = {
      decision: 'CONFIRM_PUBLISHED' as const,
      externalPostId: 'ext-remote-post-123',
      canonicalUrl: 'https://linkedin.com/feed/update/urn:li:share:123',
      reason: 'Confirmed publication on LinkedIn manually',
    };

    const result = await service.reconcile(
      workspaceId,
      authorId,
      variantId,
      dto,
    );

    // 1. Variant CAS update
    expect(txMock.postPlatformVariant.updateMany).toHaveBeenCalledWith({
      where: {
        id: variantId,
        workspaceId,
        status: PostStatus.UNKNOWN,
      },
      data: expect.objectContaining({
        status: PostStatus.PUBLISHED,
        publishedAt: expect.any(Date),
        reconciledAt: expect.any(Date),
        reconciledBy: authorId,
        reconciliationReason: dto.reason,
        externalPostId: 'ext-remote-post-123',
        canonicalUrl: 'https://linkedin.com/feed/update/urn:li:share:123',
        executionMetadata: {
          phase: 'COMPLETED',
          finalRemoteId: 'ext-remote-post-123',
          operationId: 'op-orig-123',
          containerId: 'container-orig-456',
          dispatchVersion: 2,
        },
      }),
    });

    // 2. PublicationAttempt update
    expect(txMock.publicationAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-7777-7777' },
      data: {
        status: 'SUCCESS',
        failureCategory: null,
        completedAt: expect.any(Date),
      },
    });

    // 3. AuditLog create with enriched metadata
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        workspaceId,
        actorId: authorId,
        action: AuditAction.PUBLICATION_RECONCILED_PUBLISHED,
        targetType: 'PUBLICATION_TARGET',
        targetId: variantId,
        metadata: {
          variantId,
          decision: 'CONFIRM_PUBLISHED',
          reason: dto.reason,
          externalPostId: 'ext-remote-post-123',
          canonicalUrl: 'https://linkedin.com/feed/update/urn:li:share:123',
        },
        createdAt: expect.any(Date),
      },
    });

    // Refreshed variant returned
    expect(result).toBeDefined();
    expect(prismaMock.postPlatformVariant.findFirst).toHaveBeenCalledTimes(2);
  });

  // 2. CONFIRM_FAILED happy path
  it('CONFIRM_FAILED happy path: atomically marks variant and attempt FAILED without fabricating externalPostId', async () => {
    const dto = {
      decision: 'CONFIRM_FAILED' as const,
      reason: 'Confirmed post was never published by provider',
    };

    await service.reconcile(workspaceId, authorId, variantId, dto);

    // 1. Variant CAS update
    expect(txMock.postPlatformVariant.updateMany).toHaveBeenCalledWith({
      where: {
        id: variantId,
        workspaceId,
        status: PostStatus.UNKNOWN,
      },
      data: expect.objectContaining({
        status: PostStatus.FAILED,
        reconciledAt: expect.any(Date),
        reconciledBy: authorId,
        reconciliationReason: dto.reason,
        executionMetadata: {
          phase: 'FAILED',
          operationId: 'op-orig-123',
          containerId: 'container-orig-456',
          dispatchVersion: 2,
        },
      }),
    });

    // 2. PublicationAttempt update
    expect(txMock.publicationAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-7777-7777' },
      data: {
        status: 'FAILED',
        failureCategory: 'PERMANENT',
        completedAt: expect.any(Date),
      },
    });

    // 3. AuditLog create
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        workspaceId,
        actorId: authorId,
        action: AuditAction.PUBLICATION_RECONCILED_FAILED,
        targetType: 'PUBLICATION_TARGET',
        targetId: variantId,
        metadata: {
          variantId,
          decision: 'CONFIRM_FAILED',
          reason: dto.reason,
        },
        createdAt: expect.any(Date),
      },
    });
  });

  it('CONFIRM_FAILED records operator-supplied externalPostId and canonicalUrl in AuditLog but does NOT synthesize publication fields on Variant', async () => {
    const dto = {
      decision: 'CONFIRM_FAILED' as const,
      reason:
        'Operator confirmed failure with provider-assigned trace identifiers',
      externalPostId: 'external-failed-123',
      canonicalUrl: 'https://provider.example/post/failed-123',
    };

    await service.reconcile(workspaceId, authorId, variantId, dto);

    // 1. Variant CAS update:
    // Status is FAILED, executionMetadata.phase is FAILED, but publication fields MUST NOT be synthesized
    expect(txMock.postPlatformVariant.updateMany).toHaveBeenCalledWith({
      where: {
        id: variantId,
        workspaceId,
        status: PostStatus.UNKNOWN,
      },
      data: expect.objectContaining({
        status: PostStatus.FAILED,
        reconciledAt: expect.any(Date),
        reconciledBy: authorId,
        reconciliationReason: dto.reason,
        executionMetadata: {
          phase: 'FAILED',
          operationId: 'op-orig-123',
          containerId: 'container-orig-456',
          dispatchVersion: 2,
        },
      }),
    });

    const updateCall = txMock.postPlatformVariant.updateMany.mock.calls[0][0];
    const updateData = updateCall.data;
    expect(updateData).not.toHaveProperty('externalPostId');
    expect(updateData).not.toHaveProperty('canonicalUrl');
    expect(updateData).not.toHaveProperty('publishedAt');

    // 2. PublicationAttempt update
    expect(txMock.publicationAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-7777-7777' },
      data: {
        status: 'FAILED',
        failureCategory: 'PERMANENT',
        completedAt: expect.any(Date),
      },
    });

    // 3. AuditLog metadata:
    // Records operator-supplied externalPostId and canonicalUrl for traceability
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        workspaceId,
        actorId: authorId,
        action: AuditAction.PUBLICATION_RECONCILED_FAILED,
        targetType: 'PUBLICATION_TARGET',
        targetId: variantId,
        metadata: {
          variantId,
          decision: 'CONFIRM_FAILED',
          reason: dto.reason,
          externalPostId: dto.externalPostId,
          canonicalUrl: dto.canonicalUrl,
        },
        createdAt: expect.any(Date),
      },
    });
  });

  // 3. Missing externalPostId on CONFIRM_PUBLISHED
  it.each([
    { label: 'undefined', value: undefined },
    { label: 'empty string', value: '' },
    { label: 'whitespace only', value: '   ' },
  ])(
    'rejects CONFIRM_PUBLISHED when externalPostId is $label',
    async ({ value }) => {
      const dto = {
        decision: 'CONFIRM_PUBLISHED' as const,
        externalPostId: value,
        reason: 'Missing external identifier',
      };

      await expect(
        service.reconcile(workspaceId, authorId, variantId, dto),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  // 4. Variant not UNKNOWN
  it.each([
    PostStatus.DRAFT,
    PostStatus.SCHEDULED,
    PostStatus.QUEUED,
    PostStatus.PUBLISHING,
    PostStatus.PUBLISHED,
    PostStatus.FAILED,
    PostStatus.DELETING,
    PostStatus.DELETED,
  ])(
    'rejects reconciliation when variant is in %s state',
    async (nonUnknownStatus) => {
      prismaMock.postPlatformVariant.findFirst.mockResolvedValue(
        createBaseVariant({ status: nonUnknownStatus }),
      );

      const dto = {
        decision: 'CONFIRM_FAILED' as const,
        reason: 'Should be rejected',
      };

      await expect(
        service.reconcile(workspaceId, authorId, variantId, dto),
      ).rejects.toThrow(ConflictException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  // 5. executionMetadata.phase not AMBIGUOUS
  it.each([
    { label: 'null metadata', metadata: null },
    { label: 'DISPATCHED phase', metadata: { phase: 'DISPATCHED' } },
    { label: 'COMPLETED phase', metadata: { phase: 'COMPLETED' } },
    { label: 'FAILED phase', metadata: { phase: 'FAILED' } },
    { label: 'missing phase', metadata: { operationId: '123' } },
  ])(
    'rejects reconciliation when executionMetadata has $label',
    async ({ metadata }) => {
      prismaMock.postPlatformVariant.findFirst.mockResolvedValue(
        createBaseVariant({ executionMetadata: metadata }),
      );

      const dto = {
        decision: 'CONFIRM_FAILED' as const,
        reason: 'Should be rejected',
      };

      await expect(
        service.reconcile(workspaceId, authorId, variantId, dto),
      ).rejects.toThrow(ConflictException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  // 6. Zero eligible PublicationAttempts
  it('throws ConflictException if zero eligible PublicationAttempts exist', async () => {
    txMock.publicationAttempt.findMany.mockResolvedValue([]);

    const dto = {
      decision: 'CONFIRM_FAILED' as const,
      reason: 'Checking zero attempts',
    };

    await expect(
      service.reconcile(workspaceId, authorId, variantId, dto),
    ).rejects.toThrow(ConflictException);

    expect(txMock.publicationAttempt.update).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  // 7. Multiple eligible PublicationAttempts
  it('throws ConflictException if multiple eligible PublicationAttempts exist', async () => {
    txMock.publicationAttempt.findMany.mockResolvedValue([
      createBaseAttempt({ id: 'att-1', attemptNumber: 1 }),
      createBaseAttempt({ id: 'att-2', attemptNumber: 2 }),
    ]);

    const dto = {
      decision: 'CONFIRM_FAILED' as const,
      reason: 'Checking multiple attempts',
    };

    await expect(
      service.reconcile(workspaceId, authorId, variantId, dto),
    ).rejects.toThrow(ConflictException);

    expect(txMock.publicationAttempt.update).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  // 8. CAS race (count: 0)
  it('throws ConflictException if CAS updateMany returns count: 0 (concurrency collision)', async () => {
    txMock.postPlatformVariant.updateMany.mockResolvedValue({ count: 0 });

    const dto = {
      decision: 'CONFIRM_FAILED' as const,
      reason: 'Racing reconcile call',
    };

    await expect(
      service.reconcile(workspaceId, authorId, variantId, dto),
    ).rejects.toThrow(ConflictException);

    expect(txMock.publicationAttempt.findMany).not.toHaveBeenCalled();
    expect(txMock.publicationAttempt.update).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  // 9. Transaction callback error propagation
  // NOTE: This unit test verifies transaction callback error propagation and NestJS exception
  // mapping to InternalServerErrorException. It does NOT prove real PostgreSQL database rollback
  // or transaction atomicity (the mocked $transaction behaves as `cb(txMock)`).
  // Real database rollback and atomicity are proven against PostgreSQL in the Jest E2E test:
  //   `apps/api/test/publishing.e2e-spec.ts` -> test 'proves database rollback if AuditLog insertion fails'
  it('propagates transaction callback errors as InternalServerErrorException', async () => {
    txMock.auditLog.create.mockRejectedValue(new Error('Prisma write failure'));

    const dto = {
      decision: 'CONFIRM_FAILED' as const,
      reason: 'Testing transaction callback error propagation',
    };

    await expect(
      service.reconcile(workspaceId, authorId, variantId, dto),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('maps Prisma concurrency codes (P2002, P2034) to ConflictException', async () => {
    const prismaErr: any = new Error('Unique constraint failed');
    prismaErr.code = 'P2002';
    txMock.postPlatformVariant.updateMany.mockRejectedValue(prismaErr);

    const dto = {
      decision: 'CONFIRM_FAILED' as const,
      reason: 'Testing P2002 mapping',
    };

    await expect(
      service.reconcile(workspaceId, authorId, variantId, dto),
    ).rejects.toThrow(ConflictException);
  });

  // 10. Cross-workspace variant isolation
  it('throws NotFoundException when variant does not exist in requested workspace', async () => {
    // WorkspaceScopedRepository returns null if workspaceId does not match
    prismaMock.postPlatformVariant.findFirst.mockResolvedValue(null);

    const dto = {
      decision: 'CONFIRM_FAILED' as const,
      reason: 'Attempting cross-workspace access',
    };

    await expect(
      service.reconcile('wrong-workspace-id', authorId, variantId, dto),
    ).rejects.toThrow(NotFoundException);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // 11. Duplicate reconciliation
  it('rejects duplicate reconciliation against an already PUBLISHED variant', async () => {
    prismaMock.postPlatformVariant.findFirst.mockResolvedValue(
      createBaseVariant({
        status: PostStatus.PUBLISHED,
        publishedAt: new Date(),
        reconciledAt: new Date(),
      }),
    );

    const dto = {
      decision: 'CONFIRM_PUBLISHED' as const,
      externalPostId: 'ext-already-published',
      reason: 'Calling reconcile a second time',
    };

    await expect(
      service.reconcile(workspaceId, authorId, variantId, dto),
    ).rejects.toThrow(ConflictException);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // 12. Metadata preservation
  it('preserves all existing executionMetadata keys (operationId, containerId, dispatchVersion) upon reconciliation', async () => {
    const complexVariant = createBaseVariant({
      executionMetadata: {
        phase: 'AMBIGUOUS',
        operationId: 'op-preserve-789',
        containerId: 'container-preserve-456',
        dispatchVersion: 5,
        customProviderPayload: { tokenScope: 'ugc_write' },
      },
    });
    prismaMock.postPlatformVariant.findFirst.mockResolvedValue(complexVariant);

    const dto = {
      decision: 'CONFIRM_PUBLISHED' as const,
      externalPostId: 'ext-preserved-id',
      reason: 'Preserve metadata test',
    };

    await service.reconcile(workspaceId, authorId, variantId, dto);

    expect(txMock.postPlatformVariant.updateMany).toHaveBeenCalledWith({
      where: expect.any(Object),
      data: expect.objectContaining({
        executionMetadata: {
          phase: 'COMPLETED',
          finalRemoteId: 'ext-preserved-id',
          operationId: 'op-preserve-789',
          containerId: 'container-preserve-456',
          dispatchVersion: 5,
          customProviderPayload: { tokenScope: 'ugc_write' },
        },
      }),
    });
  });

  // 13. Audit attribution
  it('records complete audit attribution (workspace, actor, action, target, metadata)', async () => {
    const dto = {
      decision: 'CONFIRM_PUBLISHED' as const,
      externalPostId: 'ext-audit-attr-1',
      canonicalUrl: 'https://youtube.com/watch?v=123',
      reason: 'Audit attribution verification',
    };

    await service.reconcile(workspaceId, authorId, variantId, dto);

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        workspaceId,
        actorId: authorId,
        targetType: 'PUBLICATION_TARGET',
        targetId: variantId,
        action: AuditAction.PUBLICATION_RECONCILED_PUBLISHED,
        metadata: {
          variantId,
          decision: 'CONFIRM_PUBLISHED',
          reason: dto.reason,
          externalPostId: dto.externalPostId,
          canonicalUrl: dto.canonicalUrl,
        },
        createdAt: expect.any(Date),
      },
    });
  });

  // 14. CAS tenancy defense
  it('enforces workspaceId directly in CAS updateMany WHERE clause as defense-in-depth', async () => {
    const dto = {
      decision: 'CONFIRM_FAILED' as const,
      reason: 'Tenancy defense verification',
    };

    await service.reconcile(workspaceId, authorId, variantId, dto);

    expect(txMock.postPlatformVariant.updateMany).toHaveBeenCalledWith({
      where: {
        id: variantId,
        workspaceId,
        status: PostStatus.UNKNOWN,
      },
      data: expect.any(Object),
    });
  });
});
