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

    auditMock = {
      logAction: vi.fn().mockResolvedValue(undefined),
      logActionBestEffort: vi.fn(),
    } as any;
    validatorMock = {} as any;
    const mockEmailDeliveryService = {
      sendVerificationEmail: vi.fn(),
      sendPasswordResetEmail: vi.fn(),
      sendDunningEmail: vi.fn(),
      sendDuplicateSignupEmail: vi.fn(),
      sendAccountLockedEmail: vi.fn(),
      sendApprovalRequestedEmail: vi.fn().mockResolvedValue(undefined),
      sendApprovalDecisionEmail: vi.fn().mockResolvedValue(undefined),
    } as any;
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      setContext: vi.fn(),
    } as any;

    service = new PublishingApplicationService(
      prismaMock,
      auditMock,
      validatorMock,
      mockEmailDeliveryService,
      mockLogger,
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

  // 15. Reconciliation transactional audit integrity & no double-logging
  it('reconcile still uses transactional tx.auditLog.create and does not double-log to AuditService.logAction', async () => {
    const dto = {
      decision: 'CONFIRM_PUBLISHED' as const,
      externalPostId: 'ext-reconcile-unique',
      reason: 'No double-log verification',
    };

    await service.reconcile(workspaceId, authorId, variantId, dto);

    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(auditMock.logAction).not.toHaveBeenCalled();
    expect(auditMock.logActionBestEffort).not.toHaveBeenCalled();
  });
});

describe('PublishingApplicationService - Audit Logging Coverage', () => {
  let service: PublishingApplicationService;
  let prismaMock: any;
  let txMock: any;
  let auditMock: any;
  let validatorMock: any;
  let repoMock: any;

  const workspaceId = 'workspace-1111-1111';
  const authorId = 'user-2222-2222';
  const postId = 'post-4444-4444';
  const variantId = 'variant-3333-3333';
  const socialAccountId = 'account-5555-5555';

  beforeEach(() => {
    txMock = {
      postMedia: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      post: {
        create: vi.fn().mockResolvedValue({
          id: postId,
          workspaceId,
          authorId,
          content: 'Draft content',
          status: PostStatus.DRAFT,
          media: [],
          variants: [],
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: postId,
          workspaceId,
          approvalStatus: 'NOT_SUBMITTED',
        }),
        update: vi.fn().mockResolvedValue({
          id: postId,
          workspaceId,
          content: 'Updated content',
        }),
        delete: vi.fn().mockResolvedValue({ id: postId }),
      },
    };

    prismaMock = {
      post: {
        create: vi.fn().mockResolvedValue({
          id: postId,
          workspaceId,
          authorId,
          content: 'Draft content',
          status: PostStatus.DRAFT,
          media: [],
          variants: [],
        }),
      },
      mediaAsset: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      socialAccount: {
        findFirst: vi.fn().mockResolvedValue({
          id: socialAccountId,
          workspaceId,
        }),
      },
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(txMock)),
    };

    auditMock = {
      logAction: vi.fn().mockResolvedValue(undefined),
      logActionBestEffort: vi.fn(),
    };

    validatorMock = {
      validateTarget: vi.fn().mockResolvedValue({ valid: true, issues: [] }),
    };

    repoMock = {
      posts: {
        findById: vi.fn().mockResolvedValue({
          id: postId,
          workspaceId,
          variants: [],
        }),
        update: vi.fn().mockResolvedValue({ id: postId }),
        delete: vi.fn().mockResolvedValue({ id: postId }),
      },
      variants: {
        findById: vi.fn().mockResolvedValue({
          id: variantId,
          postId,
          socialAccountId,
          status: PostStatus.DRAFT,
          content: 'Variant content',
          socialAccount: { id: socialAccountId },
        }),
        create: vi.fn().mockResolvedValue({
          id: variantId,
          postId,
          socialAccountId,
          status: PostStatus.DRAFT,
        }),
        update: vi.fn().mockResolvedValue({
          id: variantId,
          postId,
          content: 'Updated variant content',
        }),
        delete: vi.fn().mockResolvedValue({ id: variantId }),
      },
      queueForPublishing: vi.fn().mockResolvedValue(true),
      queueForDeletion: vi.fn().mockResolvedValue(true),
      transitionVariantState: vi.fn().mockResolvedValue(true),
      unschedule: vi.fn().mockResolvedValue(true),
      cancelQueued: vi.fn().mockResolvedValue(true),
      lockPostForUpdate: vi.fn().mockResolvedValue([{ id: postId }]),
      lockVariantsForUpdate: vi.fn().mockResolvedValue([]),
    };

    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      setContext: vi.fn(),
    } as any;

    const mockEmailDeliveryService = {
      sendVerificationEmail: vi.fn(),
      sendPasswordResetEmail: vi.fn(),
      sendDunningEmail: vi.fn(),
      sendDuplicateSignupEmail: vi.fn(),
      sendAccountLockedEmail: vi.fn(),
      sendApprovalRequestedEmail: vi.fn().mockResolvedValue(undefined),
      sendApprovalDecisionEmail: vi.fn().mockResolvedValue(undefined),
    } as any;

    service = new PublishingApplicationService(
      prismaMock,
      auditMock,
      validatorMock,
      mockEmailDeliveryService,
      mockLogger,
    );
    (service as any).getRepo = vi.fn().mockReturnValue(repoMock);
  });

  // 1. POST_CREATED
  it('emits POST_CREATED with correct attribution on createDraft inside transaction', async () => {
    await service.createDraft(workspaceId, authorId, { content: 'New post' });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.post.create).toHaveBeenCalledTimes(1);
    expect(auditMock.logAction).toHaveBeenCalledWith(
      {
        workspaceId,
        actorId: authorId,
        action: AuditAction.POST_CREATED,
        targetType: 'POST',
        targetId: postId,
        metadata: { postId },
      },
      txMock,
    );
  });

  it('throws NotFoundException when post is not found during in-transaction lock in updateDraft', async () => {
    repoMock.lockPostForUpdate.mockResolvedValueOnce([]);

    await expect(
      service.updateDraft(workspaceId, authorId, postId, {
        content: 'Updated',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it.each([
    PostStatus.QUEUED,
    PostStatus.PUBLISHING,
    PostStatus.PUBLISHED,
    PostStatus.UNKNOWN,
    PostStatus.SCHEDULED,
  ])(
    'throws ForbiddenException when variant is in locked status %s during updateDraft',
    async (status) => {
      repoMock.lockVariantsForUpdate.mockResolvedValueOnce([
        { id: variantId, status },
      ]);

      await expect(
        service.updateDraft(workspaceId, authorId, postId, {
          content: 'Updated',
        }),
      ).rejects.toThrow(
        `Cannot edit post while a publication is in ${status} state`,
      );
    },
  );

  // 2. POST_UPDATED
  it('emits POST_UPDATED with correct attribution on updateDraft inside transaction', async () => {
    await service.updateDraft(workspaceId, authorId, postId, {
      content: 'Updated',
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.post.update).toHaveBeenCalledTimes(1);
    expect(auditMock.logAction).toHaveBeenCalledWith(
      {
        workspaceId,
        actorId: authorId,
        action: AuditAction.POST_UPDATED,
        targetType: 'POST',
        targetId: postId,
        metadata: { postId },
      },
      txMock,
    );
  });

  // 3. POST_DELETED
  it('emits POST_DELETED with correct attribution on deletePost inside transaction', async () => {
    const res = await service.deletePost(workspaceId, authorId, postId);

    expect(res).toBe(true);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(repoMock.lockPostForUpdate).toHaveBeenCalledWith(txMock, postId);
    expect(repoMock.lockVariantsForUpdate).toHaveBeenCalledWith(txMock, postId);
    expect(txMock.post.delete).toHaveBeenCalledWith({
      where: { id: postId, workspaceId },
    });
    expect(auditMock.logAction).toHaveBeenCalledWith(
      {
        workspaceId,
        actorId: authorId,
        action: AuditAction.POST_DELETED,
        targetType: 'POST',
        targetId: postId,
        metadata: { postId },
      },
      txMock,
    );
  });

  it('throws NotFoundException when post is not found during in-transaction lock in deletePost', async () => {
    repoMock.lockPostForUpdate.mockResolvedValueOnce([]);

    await expect(
      service.deletePost(workspaceId, authorId, postId),
    ).rejects.toThrow(NotFoundException);
  });

  it.each([
    PostStatus.QUEUED,
    PostStatus.PUBLISHING,
    PostStatus.PUBLISHED,
    PostStatus.UNKNOWN,
    PostStatus.SCHEDULED,
  ])(
    'throws ForbiddenException when variant is in locked status %s during deletePost',
    async (status) => {
      repoMock.lockVariantsForUpdate.mockResolvedValueOnce([
        { id: variantId, status },
      ]);

      await expect(
        service.deletePost(workspaceId, authorId, postId),
      ).rejects.toThrow(
        `Cannot delete post with a publication in ${status} state`,
      );
    },
  );

  it('allows deletePost when variant is in safe status DRAFT or FAILED', async () => {
    for (const safeStatus of [PostStatus.DRAFT, PostStatus.FAILED]) {
      repoMock.lockVariantsForUpdate.mockResolvedValueOnce([
        { id: variantId, status: safeStatus },
      ]);

      const res = await service.deletePost(workspaceId, authorId, postId);
      expect(res).toBe(true);
    }
  });

  // 4. PUBLICATION_TARGET_ADDED
  it('emits PUBLICATION_TARGET_ADDED with correct attribution on addTarget', async () => {
    await service.addTarget(workspaceId, authorId, postId, { socialAccountId });

    expect(auditMock.logAction).toHaveBeenCalledWith({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_TARGET_ADDED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: {
        postId,
        variantId,
        socialAccountId,
      },
    });
  });

  // 5. PUBLICATION_TARGET_UPDATED
  it('emits PUBLICATION_TARGET_UPDATED with correct attribution on updateTarget', async () => {
    await service.updateTarget(workspaceId, authorId, variantId, {
      content: 'New variant content',
    });

    expect(auditMock.logAction).toHaveBeenCalledWith({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_TARGET_UPDATED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { postId, variantId },
    });
  });

  // 6. PUBLICATION_TARGET_REMOVED
  it('emits PUBLICATION_TARGET_REMOVED with correct attribution on removeTarget', async () => {
    await service.removeTarget(workspaceId, authorId, variantId);

    expect(auditMock.logAction).toHaveBeenCalledWith({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_TARGET_REMOVED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { postId, variantId },
    });
  });

  // 7. PUBLICATION_REQUESTED
  it('emits PUBLICATION_REQUESTED with correct attribution on requestPublish', async () => {
    await service.requestPublish(workspaceId, authorId, variantId);

    expect(auditMock.logAction).toHaveBeenCalledWith({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_REQUESTED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId },
    });
  });

  // 8. PUBLICATION_RETRY_REQUESTED
  it('emits PUBLICATION_RETRY_REQUESTED with correct attribution on requestRetry', async () => {
    await service.requestRetry(workspaceId, authorId, variantId);

    expect(auditMock.logAction).toHaveBeenCalledWith({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_RETRY_REQUESTED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId },
    });
  });

  // 9. PUBLICATION_SCHEDULED
  it('emits PUBLICATION_SCHEDULED with correct attribution and ISO date on schedule', async () => {
    const futureDate = new Date(Date.now() + 86400000);
    await service.schedule(workspaceId, authorId, variantId, {
      scheduledAt: futureDate.toISOString(),
    });

    expect(auditMock.logAction).toHaveBeenCalledWith({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_SCHEDULED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId, scheduledAt: futureDate.toISOString() },
    });
  });

  // 10. PUBLICATION_RESCHEDULED
  it('emits PUBLICATION_RESCHEDULED with correct attribution and ISO date on reschedule', async () => {
    repoMock.variants.findById.mockResolvedValueOnce({
      id: variantId,
      status: PostStatus.SCHEDULED,
    });
    const futureDate = new Date(Date.now() + 172800000);
    await service.reschedule(workspaceId, authorId, variantId, {
      scheduledAt: futureDate.toISOString(),
    });

    expect(auditMock.logAction).toHaveBeenCalledWith({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_RESCHEDULED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId, scheduledAt: futureDate.toISOString() },
    });
  });

  // 11. PUBLICATION_UNSCHEDULED
  it('emits PUBLICATION_UNSCHEDULED with correct attribution on unschedule', async () => {
    await service.unschedule(workspaceId, authorId, variantId);

    expect(auditMock.logAction).toHaveBeenCalledWith({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_UNSCHEDULED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId },
    });
  });

  // 12. PUBLICATION_CANCELLED
  it('emits PUBLICATION_CANCELLED with correct attribution on cancelQueued', async () => {
    await service.cancelQueued(workspaceId, authorId, variantId);

    expect(auditMock.logAction).toHaveBeenCalledWith({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_CANCELLED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { variantId },
    });
  });

  // 13. PUBLICATION_DELETE_REQUESTED
  it('emits typed PUBLICATION_DELETE_REQUESTED with correct attribution on requestRemoteDelete', async () => {
    repoMock.variants.findById.mockResolvedValue({
      id: variantId,
      status: PostStatus.PUBLISHED,
      externalPostId: 'ext-remote-del-1',
    });

    await service.requestRemoteDelete(workspaceId, authorId, variantId);

    expect(auditMock.logAction).toHaveBeenCalledWith({
      workspaceId,
      actorId: authorId,
      action: AuditAction.PUBLICATION_DELETE_REQUESTED,
      targetType: 'PUBLICATION_TARGET',
      targetId: variantId,
      metadata: { publicationId: variantId },
    });
  });

  // 15-18. Security, tenancy, and metadata integrity
  it('verifies metadata does not contain sensitive tokens, passwords, or secrets', async () => {
    await service.createDraft(workspaceId, authorId, {
      content: 'Secret post',
    });

    const callArgs = auditMock.logAction.mock.calls[0][0];
    const metadataStr = JSON.stringify(callArgs.metadata);

    expect(metadataStr).not.toContain('token');
    expect(metadataStr).not.toContain('password');
    expect(metadataStr).not.toContain('secret');
    expect(metadataStr).not.toContain('cookie');
    expect(callArgs.workspaceId).toBe(workspaceId);
    expect(callArgs.actorId).toBe(authorId);
  });

  // 19-20. Error propagation on awaited logAction failure
  it('propagates rejection when audit.logAction fails after domain mutation', async () => {
    auditMock.logAction.mockRejectedValueOnce(
      new Error('Audit DB write failed'),
    );

    await expect(
      service.createDraft(workspaceId, authorId, { content: 'Failing audit' }),
    ).rejects.toThrow('Audit DB write failed');
  });

  it('propagates rejection when audit.logAction fails during updateDraft', async () => {
    auditMock.logAction.mockRejectedValueOnce(
      new Error('Audit DB write failed during update'),
    );

    await expect(
      service.updateDraft(workspaceId, authorId, postId, {
        content: 'Failing update audit',
      }),
    ).rejects.toThrow('Audit DB write failed during update');
  });

  it('propagates rejection when audit.logAction fails during deletePost', async () => {
    auditMock.logAction.mockRejectedValueOnce(
      new Error('Audit DB write failed during delete'),
    );

    await expect(
      service.deletePost(workspaceId, authorId, postId),
    ).rejects.toThrow('Audit DB write failed during delete');
  });

  describe('Client Approvals Workflow', () => {
    let approvalEmailMock: any;

    beforeEach(() => {
      approvalEmailMock = {
        sendApprovalRequestedEmail: vi.fn().mockResolvedValue(undefined),
        sendApprovalDecisionEmail: vi.fn().mockResolvedValue(undefined),
      };
      (service as any).emailDeliveryService = approvalEmailMock;
      prismaMock.workspaceMember = {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'mem-1',
            userId: 'user-manager',
            role: 'MANAGER',
            user: { email: 'manager@agency.io' },
          },
          {
            id: 'mem-2',
            userId: 'user-client',
            role: 'CLIENT_APPROVER',
            user: { email: 'client@agency.io' },
          },
        ]),
      };
      prismaMock.user = {
        findUnique: vi.fn().mockResolvedValue({
          id: authorId,
          email: 'author@agency.io',
        }),
      };
    });

    describe('requestApproval', () => {
      it('successfully transitions from NOT_SUBMITTED to PENDING, audits, and dispatches email to approvers', async () => {
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          content: 'Hello world approval test',
          approvalStatus: 'NOT_SUBMITTED',
          variants: [{ id: variantId, status: PostStatus.DRAFT }],
        });

        await service.requestApproval(workspaceId, authorId, postId);

        expect(repoMock.posts.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: postId },
            data: expect.objectContaining({
              approvalStatus: 'PENDING',
              approvalRequestedById: authorId,
              approvalDecidedById: null,
              approvalDecidedAt: null,
              approvalComment: null,
            }),
          }),
        );

        expect(auditMock.logAction).toHaveBeenCalledWith(
          expect.objectContaining({
            workspaceId,
            actorId: authorId,
            action: AuditAction.POST_APPROVAL_REQUESTED,
            targetType: 'POST',
            targetId: postId,
          }),
        );

        expect(
          approvalEmailMock.sendApprovalRequestedEmail,
        ).toHaveBeenCalledTimes(2);
        expect(
          approvalEmailMock.sendApprovalRequestedEmail,
        ).toHaveBeenCalledWith(
          'manager@agency.io',
          'Hello world approval test',
        );
        expect(
          approvalEmailMock.sendApprovalRequestedEmail,
        ).toHaveBeenCalledWith('client@agency.io', 'Hello world approval test');
      });

      it('successfully transitions from CHANGES_REQUESTED to PENDING and clears comment', async () => {
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          content: 'Revised post',
          approvalStatus: 'CHANGES_REQUESTED',
          approvalComment: 'Fix typo',
          variants: [{ id: variantId, status: PostStatus.DRAFT }],
        });

        await service.requestApproval(workspaceId, authorId, postId);

        expect(repoMock.posts.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: postId },
            data: expect.objectContaining({
              approvalStatus: 'PENDING',
              approvalComment: null,
            }),
          }),
        );
      });

      it('throws ConflictException if post is already PENDING', async () => {
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'PENDING',
          variants: [{ id: variantId, status: PostStatus.DRAFT }],
        });

        await expect(
          service.requestApproval(workspaceId, authorId, postId),
        ).rejects.toThrow('Post is already pending approval.');
      });

      it('throws ConflictException if post is already APPROVED', async () => {
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'APPROVED',
          variants: [{ id: variantId, status: PostStatus.DRAFT }],
        });

        await expect(
          service.requestApproval(workspaceId, authorId, postId),
        ).rejects.toThrow('Post is already approved.');
      });

      it('throws ConflictException if any variant has left DRAFT', async () => {
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'NOT_SUBMITTED',
          variants: [
            { id: 'v1', status: PostStatus.DRAFT },
            { id: 'v2', status: PostStatus.SCHEDULED },
          ],
        });

        await expect(
          service.requestApproval(workspaceId, authorId, postId),
        ).rejects.toThrow('Only a draft post can be sent for approval.');
      });
    });

    describe('approvePost', () => {
      it('throws ConflictException if post is not PENDING', async () => {
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'NOT_SUBMITTED',
        });

        await expect(
          service.approvePost(workspaceId, 'reviewer-1', postId),
        ).rejects.toThrow('Post is not pending approval.');
      });

      it('transitions from PENDING to APPROVED, audits, and notifies author', async () => {
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          content: 'Great copy',
          authorId,
          approvalStatus: 'PENDING',
        });

        await service.approvePost(workspaceId, 'reviewer-1', postId);

        expect(repoMock.posts.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: postId },
            data: expect.objectContaining({
              approvalStatus: 'APPROVED',
              approvalDecidedById: 'reviewer-1',
              approvalComment: null,
            }),
          }),
        );

        expect(auditMock.logAction).toHaveBeenCalledWith(
          expect.objectContaining({
            workspaceId,
            actorId: 'reviewer-1',
            action: AuditAction.POST_APPROVAL_APPROVED,
            targetType: 'POST',
            targetId: postId,
          }),
        );

        expect(
          approvalEmailMock.sendApprovalDecisionEmail,
        ).toHaveBeenCalledWith('author@agency.io', 'Great copy', 'APPROVED');
      });

      it('does not send decision email if approver is the author', async () => {
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          content: 'Self-approval',
          authorId,
          approvalStatus: 'PENDING',
        });

        await service.approvePost(workspaceId, authorId, postId);

        expect(
          approvalEmailMock.sendApprovalDecisionEmail,
        ).not.toHaveBeenCalled();
      });
    });

    describe('requestChanges', () => {
      it('throws ConflictException if post is not PENDING', async () => {
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'APPROVED',
        });

        await expect(
          service.requestChanges(
            workspaceId,
            'reviewer-1',
            postId,
            'Need changes',
          ),
        ).rejects.toThrow('Post is not pending approval.');
      });

      it('transitions from PENDING to CHANGES_REQUESTED, audits with comment, and notifies author', async () => {
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          content: 'Draft content needing edit',
          authorId,
          approvalStatus: 'PENDING',
        });

        await service.requestChanges(
          workspaceId,
          'reviewer-1',
          postId,
          'Please update the hashtags',
        );

        expect(repoMock.posts.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: postId },
            data: expect.objectContaining({
              approvalStatus: 'CHANGES_REQUESTED',
              approvalDecidedById: 'reviewer-1',
              approvalComment: 'Please update the hashtags',
            }),
          }),
        );

        expect(auditMock.logAction).toHaveBeenCalledWith(
          expect.objectContaining({
            workspaceId,
            actorId: 'reviewer-1',
            action: AuditAction.POST_APPROVAL_CHANGES_REQUESTED,
            targetType: 'POST',
            targetId: postId,
            metadata: { postId, comment: 'Please update the hashtags' },
          }),
        );

        expect(
          approvalEmailMock.sendApprovalDecisionEmail,
        ).toHaveBeenCalledWith(
          'author@agency.io',
          'Draft content needing edit',
          'CHANGES_REQUESTED',
          'Please update the hashtags',
        );
      });
    });

    describe('Publishing Gate', () => {
      it('blocks requestPublish if post is PENDING approval', async () => {
        repoMock.variants.findById.mockResolvedValueOnce({
          id: variantId,
          postId,
        });
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'PENDING',
        });

        await expect(
          service.requestPublish(workspaceId, authorId, variantId),
        ).rejects.toThrow(
          'Post is pending approval and cannot be published yet.',
        );
      });

      it('blocks requestPublish if post is CHANGES_REQUESTED', async () => {
        repoMock.variants.findById.mockResolvedValueOnce({
          id: variantId,
          postId,
        });
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'CHANGES_REQUESTED',
        });

        await expect(
          service.requestPublish(workspaceId, authorId, variantId),
        ).rejects.toThrow(
          'Changes were requested for this post. Edit it and resubmit for approval before publishing.',
        );
      });

      it('blocks schedule if post is PENDING', async () => {
        repoMock.variants.findById.mockResolvedValueOnce({
          id: variantId,
          postId,
          status: PostStatus.DRAFT,
        });
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'PENDING',
        });

        const futureDate = new Date(Date.now() + 3600000).toISOString();
        await expect(
          service.schedule(workspaceId, authorId, variantId, {
            scheduledAt: futureDate,
          }),
        ).rejects.toThrow(
          'Post is pending approval and cannot be published yet.',
        );
      });

      it('blocks reschedule if post is CHANGES_REQUESTED', async () => {
        repoMock.variants.findById.mockResolvedValueOnce({
          id: variantId,
          postId,
          status: PostStatus.SCHEDULED,
        });
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'CHANGES_REQUESTED',
        });

        const futureDate = new Date(Date.now() + 3600000).toISOString();
        await expect(
          service.reschedule(workspaceId, authorId, variantId, {
            scheduledAt: futureDate,
          }),
        ).rejects.toThrow(
          'Changes were requested for this post. Edit it and resubmit for approval before publishing.',
        );
      });

      it('blocks requestRetry if post is PENDING', async () => {
        repoMock.variants.findById.mockResolvedValueOnce({
          id: variantId,
          postId,
          status: PostStatus.FAILED,
        });
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'PENDING',
        });

        await expect(
          service.requestRetry(workspaceId, authorId, variantId),
        ).rejects.toThrow(
          'Post is pending approval and cannot be published yet.',
        );
      });
    });

    describe('Edit Invalidation', () => {
      it('invalidates approval on updateDraft when post is APPROVED', async () => {
        txMock.post.findUnique.mockResolvedValueOnce({
          id: postId,
          workspaceId,
          approvalStatus: 'APPROVED',
          approvalDecidedById: 'decider-1',
          approvalDecidedAt: new Date(),
        });

        await service.updateDraft(workspaceId, authorId, postId, {
          content: 'New content after approval',
        });

        expect(txMock.post.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: postId, workspaceId },
            data: expect.objectContaining({
              approvalStatus: 'NOT_SUBMITTED',
              approvalDecidedById: null,
              approvalDecidedAt: null,
              approvalComment: null,
            }),
          }),
        );

        expect(auditMock.logAction).toHaveBeenCalledWith(
          expect.objectContaining({
            workspaceId,
            actorId: authorId,
            action: AuditAction.POST_APPROVAL_INVALIDATED,
            targetType: 'POST',
            targetId: postId,
            metadata: { postId, reason: 'draft_updated' },
          }),
          txMock,
        );
      });

      it('invalidates approval on addTarget when post is APPROVED', async () => {
        repoMock.posts.findById.mockResolvedValue({
          id: postId,
          approvalStatus: 'APPROVED',
          variants: [],
        });

        await service.addTarget(workspaceId, authorId, postId, {
          socialAccountId,
          content: 'Target content',
        });

        expect(repoMock.posts.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: postId },
            data: expect.objectContaining({
              approvalStatus: 'NOT_SUBMITTED',
            }),
          }),
        );

        expect(auditMock.logAction).toHaveBeenCalledWith(
          expect.objectContaining({
            workspaceId,
            actorId: authorId,
            action: AuditAction.POST_APPROVAL_INVALIDATED,
            targetType: 'POST',
            targetId: postId,
            metadata: { postId, reason: 'target_added' },
          }),
        );
      });

      it('invalidates approval on updateTarget when post is APPROVED', async () => {
        repoMock.variants.findById.mockResolvedValueOnce({
          id: variantId,
          postId,
          status: PostStatus.DRAFT,
          content: 'Old variant content',
        });
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'APPROVED',
        });

        await service.updateTarget(workspaceId, authorId, variantId, {
          content: 'New variant content',
        });

        expect(repoMock.posts.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: postId },
            data: expect.objectContaining({
              approvalStatus: 'NOT_SUBMITTED',
            }),
          }),
        );

        expect(auditMock.logAction).toHaveBeenCalledWith(
          expect.objectContaining({
            workspaceId,
            actorId: authorId,
            action: AuditAction.POST_APPROVAL_INVALIDATED,
            targetType: 'POST',
            targetId: postId,
            metadata: { postId, reason: 'target_updated' },
          }),
        );
      });

      it('invalidates approval on removeTarget when post is APPROVED', async () => {
        repoMock.variants.findById.mockResolvedValueOnce({
          id: variantId,
          postId,
          status: PostStatus.DRAFT,
        });
        repoMock.posts.findById.mockResolvedValueOnce({
          id: postId,
          approvalStatus: 'APPROVED',
        });

        await service.removeTarget(workspaceId, authorId, variantId);

        expect(repoMock.posts.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: postId },
            data: expect.objectContaining({
              approvalStatus: 'NOT_SUBMITTED',
            }),
          }),
        );

        expect(auditMock.logAction).toHaveBeenCalledWith(
          expect.objectContaining({
            workspaceId,
            actorId: authorId,
            action: AuditAction.POST_APPROVAL_INVALIDATED,
            targetType: 'POST',
            targetId: postId,
            metadata: { postId, reason: 'target_removed' },
          }),
        );
      });
    });
  });
});
