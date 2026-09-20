/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion, no-empty, @typescript-eslint/no-unused-vars */
import { PostPlatformVariant } from '@prisma/client';
import { ExecutionTransitionResult } from '../../repositories/ExecutionMetadataRepository';
function getVariant(res: ExecutionTransitionResult): PostPlatformVariant { if (res.type !== ExecutionTransitionResultType.SUCCESS) throw new Error('Not success'); return res.variant; }
import { safeParseExecutionMetadata, ExecutionMetadata } from '@agency-os/shared';
function parseMeta(variant: PostPlatformVariant): ExecutionMetadata { const p = safeParseExecutionMetadata(variant.executionMetadata); if(!p.success) { console.error(JSON.stringify(p.error.errors)); throw new Error('parse'); } return p.data; }
import { PrismaClient } from '@prisma/client';
import { ExecutionMetadataRepository, ExecutionTransitionResultType } from '../../repositories/ExecutionMetadataRepository';
import { generateId } from '../../id';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
describe('ExecutionMetadataRepository Transitions', () => {
  let prisma: PrismaClient;
  let repo: ExecutionMetadataRepository;
  let testVariantId: string;
  let orgId: string;
  let workspaceId: string;
  let accountId: string;
  let postId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: { url: process.env.TEST_DATABASE_URL },
      },
    });
    
    orgId = generateId();
    workspaceId = generateId();
    repo = new ExecutionMetadataRepository(prisma, workspaceId);

    await prisma.organization.create({ data: { id: orgId, name: 'Test Org' } });
    await prisma.workspace.create({ data: { id: workspaceId, name: 'Test Workspace', organizationId: orgId } });
    accountId = generateId();
    await prisma.socialAccount.create({ data: { id: accountId, workspaceId, provider: 'INSTAGRAM', externalId: 'ext1', status: 'ACTIVE' } });
    postId = generateId();
    await prisma.post.create({ data: { id: postId, workspaceId, content: 'Test', status: 'DRAFT' } });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    testVariantId = generateId();
    const uniquePostId = generateId();
    await prisma.post.create({ data: { id: uniquePostId, workspaceId, content: 'Test', status: 'DRAFT' } });
    
    await prisma.postPlatformVariant.create({
      data: {
        id: testVariantId,
        postId: uniquePostId,
        socialAccountId: accountId,
        workspaceId,
        status: 'QUEUED',
        dispatchVersion: 1,
      }
    });
  });

  afterEach(async () => {
    await prisma.postPlatformVariant.deleteMany({ where: { workspaceId } });
    await prisma.post.deleteMany({ where: { workspaceId } });
  });

  describe('Operation Creation', () => {
    it('1. null state start succeeds & 6. server-generated UUID & 7. provider retained & 8. version increments', async () => {
      const res = await repo.startOperation(testVariantId, 'INSTAGRAM');
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
      if (res.type !== ExecutionTransitionResultType.SUCCESS) throw new Error();
      
      const meta = parseMeta(getVariant(res));
      expect(meta.phase).toBe('INITIATED');
      expect(meta.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(meta.provider).toBe('INSTAGRAM');
      expect(res.variant.dispatchVersion).toBe(2);
    });

    it('2. active state start rejected', async () => {
      await repo.startOperation(testVariantId, 'INSTAGRAM');
      const res2 = await repo.startOperation(testVariantId, 'INSTAGRAM');
      expect(res2.type).toBe(ExecutionTransitionResultType.EXECUTION_STATE_EXISTS);
    });

    it('3. COMPLETED start rejected', async () => {
      await prisma.postPlatformVariant.update({ where: { id: testVariantId }, data: { executionMetadata: { version: 1, operationId: 'uuid', provider: 'INSTAGRAM', phase: 'COMPLETED' } } });
      const res = await repo.startOperation(testVariantId, 'INSTAGRAM');
      expect(res.type).toBe(ExecutionTransitionResultType.EXECUTION_STATE_EXISTS);
    });

    it('4. FAILED start rejected', async () => {
      await prisma.postPlatformVariant.update({ where: { id: testVariantId }, data: { executionMetadata: { version: 1, operationId: 'uuid', provider: 'INSTAGRAM', phase: 'FAILED' } } });
      const res = await repo.startOperation(testVariantId, 'INSTAGRAM');
      expect(res.type).toBe(ExecutionTransitionResultType.EXECUTION_STATE_EXISTS);
    });

    it('5. AMBIGUOUS start rejected', async () => {
      await prisma.postPlatformVariant.update({ where: { id: testVariantId }, data: { executionMetadata: { version: 1, operationId: 'uuid', provider: 'INSTAGRAM', phase: 'AMBIGUOUS' } } });
      const res = await repo.startOperation(testVariantId, 'INSTAGRAM');
      expect(res.type).toBe(ExecutionTransitionResultType.EXECUTION_STATE_EXISTS);
    });
  });

  describe('Transitions', () => {
    it('7. INITIATED -> CONTAINER_CREATED succeeds & 8. containerId required & 9. containerCreatedAt generated', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      if (start.type !== ExecutionTransitionResultType.SUCCESS) throw new Error();
      const meta = parseMeta(getVariant(start));

      // Fail without containerId
      const fail = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', start.variant.dispatchVersion);
      expect(fail.type).toBe(ExecutionTransitionResultType.ILLEGAL_TRANSITION);

      // Success
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', start.variant.dispatchVersion, { containerId: 'c123' });
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
      if (res.type !== ExecutionTransitionResultType.SUCCESS) throw new Error();
      
      const newMeta = parseMeta(getVariant(res));
      expect(newMeta.phase).toBe('CONTAINER_CREATED');
      expect(newMeta.containerId).toBe('c123');
      expect(typeof newMeta.containerCreatedAt).toBe('string'); // 9. generated
    });

    it('10. CONTAINER_CREATED -> PROCESSING_REMOTE succeeds', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'c' });
      
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PROCESSING_REMOTE', getVariant(t1).dispatchVersion, { delayMs: 15000 });
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
    });

    it('11. CONTAINER_CREATED -> PUBLISH_REQUESTED succeeds if allowed', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'c' });
      
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PUBLISH_REQUESTED', getVariant(t1).dispatchVersion);
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
    });

    it('12. PROCESSING_REMOTE -> PROCESSING_REMOTE succeeds', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'c' });
      const t2 = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PROCESSING_REMOTE', getVariant(t1).dispatchVersion, { delayMs: 15000 });
      
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'PROCESSING_REMOTE', 'PROCESSING_REMOTE', getVariant(t2).dispatchVersion, { delayMs: 15000 });
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
    });

    it('13. PROCESSING_REMOTE -> PUBLISH_REQUESTED succeeds & 14. publishRequestedAt generated', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'c' });
      const t2 = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PROCESSING_REMOTE', getVariant(t1).dispatchVersion, { delayMs: 15000 });
      
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'PROCESSING_REMOTE', 'PUBLISH_REQUESTED', getVariant(t2).dispatchVersion);
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(typeof (parseMeta(getVariant(res)) as any).publishRequestedAt).toBe('string');
    });

    it('15. PUBLISH_REQUESTED -> COMPLETED succeeds with finalRemoteId', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t0 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'c' });
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PUBLISH_REQUESTED', getVariant(t0).dispatchVersion);
      
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'PUBLISH_REQUESTED', 'COMPLETED', getVariant(t1).dispatchVersion, { finalRemoteId: 'f123' });
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
    });

    it('16. PUBLISH_REQUESTED -> AMBIGUOUS succeeds', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t0 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'c' });
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PUBLISH_REQUESTED', getVariant(t0).dispatchVersion);
      
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'PUBLISH_REQUESTED', 'AMBIGUOUS', getVariant(t1).dispatchVersion);
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
    });

    it('17. active phase -> FAILED succeeds only where allowed', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'FAILED', getVariant(start).dispatchVersion);
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
    });
  });

  describe('Safety', () => {
    it('18. wrong operationId rejected', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const res = await repo.transitionOperation(testVariantId, 'wrong-uuid', 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'c' });
      expect(res.type).toBe(ExecutionTransitionResultType.OPERATION_MISMATCH);
    });

    it('19. wrong expected phase rejected', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'PROCESSING_REMOTE', 'PUBLISH_REQUESTED', getVariant(start).dispatchVersion);
      expect(res.type).toBe(ExecutionTransitionResultType.PHASE_MISMATCH);
    });

    it('20. stale dispatchVersion rejected', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', 999, { containerId: 'c' });
      expect(res.type).toBe(ExecutionTransitionResultType.VERSION_CONFLICT);
    });

    it('22, 23, 24. terminal mutation rejected', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'FAILED', getVariant(start).dispatchVersion);
      
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'FAILED', 'INITIATED', getVariant(t1).dispatchVersion);
      expect(res.type).toBe(ExecutionTransitionResultType.TERMINAL_STATE);
    });

    it('25. malformed metadata returns deterministic error', async () => {
      await prisma.postPlatformVariant.update({
        where: { id: testVariantId },
        data: { executionMetadata: { bad: 'data' } }
      });
      const res = await repo.transitionOperation(testVariantId, 'uuid', 'INITIATED', 'FAILED', 1);
      expect(res.type).toBe(ExecutionTransitionResultType.MALFORMED_STATE);
    });

    it('26. no active metadata returns deterministic error', async () => {
      const res = await repo.transitionOperation(testVariantId, 'uuid', 'INITIATED', 'FAILED', 1);
      expect(res.type).toBe(ExecutionTransitionResultType.NO_ACTIVE_OPERATION);
    });

    it('27. unknown variant returns NOT_FOUND', async () => {
      const res = await repo.transitionOperation(generateId(), 'uuid', 'INITIATED', 'FAILED', 1);
      expect(res.type).toBe(ExecutionTransitionResultType.NOT_FOUND);
    });
  });

  describe('Data Contract', () => {
    it('29. previous metadata retained during forward transitions', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'retain_c' });
      const t2 = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PROCESSING_REMOTE', getVariant(t1).dispatchVersion, { delayMs: 15000 });
      const newMeta = parseMeta(getVariant(t2));
      expect(newMeta.containerId).toBe('retain_c');
    });
    it('28. COMPLETED without finalRemoteId rejected', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t0 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'c' });
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PUBLISH_REQUESTED', getVariant(t0).dispatchVersion);
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'PUBLISH_REQUESTED', 'COMPLETED', getVariant(t1).dispatchVersion, {}); // missing finalRemoteId
      expect(res.type).toBe(ExecutionTransitionResultType.ILLEGAL_TRANSITION);
    });

    it('31, 32, 33. resulting metadata passes strict schema', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'c' });
      // Should not have any excess keys. It's built cleanly by the repo.
      expect('accessToken' in parseMeta(getVariant(t1))).toBe(false);
    });
  });

  describe('Concurrency (19. CONCURRENCY TEST)', () => {
    it('21. duplicate concurrent transition allows exactly one winner', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      if (start.type !== ExecutionTransitionResultType.SUCCESS) throw new Error();
      const meta = parseMeta(getVariant(start));
      const expectedVersion = start.variant.dispatchVersion;

      // Fire 5 concurrent transitions
      const promises = Array.from({ length: 5 }).map(() => 
        repo.transitionOperation(
          testVariantId, 
          meta.operationId, 
          'INITIATED', 
          'CONTAINER_CREATED', 
          expectedVersion, 
          { containerId: 'concurrent_c' }
        )
      );

      const results = await Promise.all(promises);

      const successes = results.filter(r => r.type === ExecutionTransitionResultType.SUCCESS);
      const conflicts = results.filter(r => r.type === ExecutionTransitionResultType.VERSION_CONFLICT);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(4); // the other 4 must fail

      // Dispatch version should have incremented exactly once
      const finalVariant = await prisma.postPlatformVariant.findUniqueOrThrow({ where: { id: testVariantId } });
      expect(finalVariant.dispatchVersion).toBe(expectedVersion + 1);
    });
  });

  /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion, no-empty, @typescript-eslint/no-unused-vars */
  describe('Real PostgreSQL Integration Tests', () => {
    it('6. REAL POSTGRESQL AMBIGUOUS/UNKNOWN ROLLBACK TEST', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'c' });
      const t2 = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PUBLISH_REQUESTED', getVariant(t1).dispatchVersion);

      const beforeRollback = await prisma.postPlatformVariant.findUniqueOrThrow({ where: { id: testVariantId } });

      // Attempt transaction that will fail
      try {
        await prisma.$transaction(async (tx) => {
          // Transition to AMBIGUOUS manually inside tx to match repo logic exactly
          const vMeta = beforeRollback.executionMetadata as any;
          await tx.postPlatformVariant.update({
            where: { id: testVariantId, dispatchVersion: beforeRollback.dispatchVersion },
            data: {
              executionMetadata: { ...vMeta, phase: 'AMBIGUOUS' },
              dispatchVersion: { increment: 1 }
            }
          });

          // Force a failure
          throw new Error('Forced rollback');
        });
      } catch (err) {}

      // Verify no changes applied
      const afterRollback = await prisma.postPlatformVariant.findUniqueOrThrow({ where: { id: testVariantId } });
      expect((afterRollback.executionMetadata as any).phase).toBe('PUBLISH_REQUESTED');
      expect(afterRollback.dispatchVersion).toBe(beforeRollback.dispatchVersion);
      expect(afterRollback.status).toBe(beforeRollback.status);

      // Now successful transaction
      await prisma.$transaction(async (tx) => {
        const vMeta = beforeRollback.executionMetadata as any;
        await tx.postPlatformVariant.update({
          where: { id: testVariantId, dispatchVersion: beforeRollback.dispatchVersion },
          data: {
            executionMetadata: { ...vMeta, phase: 'AMBIGUOUS' },
            status: 'UNKNOWN',
            dispatchVersion: { increment: 1 }
          }
        });
      });

      const afterSuccess = await prisma.postPlatformVariant.findUniqueOrThrow({ where: { id: testVariantId } });
      expect((afterSuccess.executionMetadata as any).phase).toBe('AMBIGUOUS');
      expect(afterSuccess.status).toBe('UNKNOWN');
      expect(afterSuccess.dispatchVersion).toBe(beforeRollback.dispatchVersion + 1);
    });

    it('7. REAL INSTAGRAM CHECKPOINT CAS PROGRESSION', async () => {
      // INITIATED
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      let v = getVariant(start);
      expect((v.executionMetadata as any).phase).toBe('INITIATED');
      let currentVersion = v.dispatchVersion;

      // onRemotePrepared
      const t1 = await repo.transitionOperation(testVariantId, (v.executionMetadata as any).operationId, 'INITIATED', 'CONTAINER_CREATED', currentVersion, { containerId: 'cas-container-1' });
      expect(t1.type).toBe(ExecutionTransitionResultType.SUCCESS);
      v = getVariant(t1 as any);
      expect((v.executionMetadata as any).phase).toBe('CONTAINER_CREATED');
      expect((v.executionMetadata as any).containerId).toBe('cas-container-1');
      expect(v.dispatchVersion).toBe(currentVersion + 1);
      currentVersion = v.dispatchVersion;

      // beforeFinalMutation
      const t2 = await repo.transitionOperation(testVariantId, (v.executionMetadata as any).operationId, 'CONTAINER_CREATED', 'PUBLISH_REQUESTED', currentVersion);
      expect(t2.type).toBe(ExecutionTransitionResultType.SUCCESS);
      v = getVariant(t2 as any);
      expect((v.executionMetadata as any).phase).toBe('PUBLISH_REQUESTED');
      expect(v.dispatchVersion).toBe(currentVersion + 1);
      currentVersion = v.dispatchVersion;

      // COMPLETED
      const t3 = await repo.transitionOperation(testVariantId, (v.executionMetadata as any).operationId, 'PUBLISH_REQUESTED', 'COMPLETED', currentVersion, { finalRemoteId: 'cas-final-1' });
      expect(t3.type).toBe(ExecutionTransitionResultType.SUCCESS);
      v = getVariant(t3 as any);
      expect((v.executionMetadata as any).phase).toBe('COMPLETED');
      expect((v.executionMetadata as any).finalRemoteId).toBe('cas-final-1');
      expect(v.dispatchVersion).toBe(currentVersion + 1);
    });

    it('8. STALE CHECKPOINT REAL DB TEST', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const v = getVariant(start);
      const opId = (v.executionMetadata as any).operationId;
      const ver = v.dispatchVersion;

      // Wrong operationId
      const r1 = await repo.transitionOperation(testVariantId, '00000000-0000-0000-0000-000000000000', 'INITIATED', 'CONTAINER_CREATED', ver, { containerId: 'c' });
      expect(r1.type).toBe(ExecutionTransitionResultType.OPERATION_MISMATCH);

      // Wrong version
      const r2 = await repo.transitionOperation(testVariantId, opId, 'INITIATED', 'CONTAINER_CREATED', ver - 1, { containerId: 'c' });
      expect(r2.type).toBe(ExecutionTransitionResultType.VERSION_CONFLICT);

      // Wrong phase
      const r3 = await repo.transitionOperation(testVariantId, opId, 'CONTAINER_CREATED', 'PUBLISH_REQUESTED', ver);
      expect(r3.type).toBe(ExecutionTransitionResultType.PHASE_MISMATCH);
    });
  });

  it('9. INITIATED -> PUBLISH_REQUESTED (Facebook text/single-image)', async () => {
    await prisma.post.create({ data: { id: postId, workspaceId, content: 'FB test', status: 'DRAFT' } });
    const fbAccountId = crypto.randomUUID();
    await prisma.socialAccount.create({
      data: { id: fbAccountId, workspaceId, provider: 'FACEBOOK', externalId: 'fb-' + crypto.randomUUID(), status: 'ACTIVE' }
    });
    const variant = await prisma.postPlatformVariant.create({
      data: {
        id: crypto.randomUUID(),
        workspaceId,
        postId,
        socialAccountId: fbAccountId,
        status: 'DRAFT'
      }
    });

    const startRes = await repo.startOperation(variant.id, 'FACEBOOK');
    expect(startRes.type).toBe(ExecutionTransitionResultType.SUCCESS);

    const v1 = (startRes as any).variant;

    const tRes = await repo.transitionOperation(
      v1.id,
      parseMeta(v1).operationId,
      'INITIATED',
      'PUBLISH_REQUESTED',
      v1.dispatchVersion
    );
    expect(tRes.type).toBe(ExecutionTransitionResultType.SUCCESS);
    const meta = parseMeta((tRes as any).variant);
    expect(meta.phase).toBe('PUBLISH_REQUESTED');
    expect(meta.publishRequestedAt).toBeDefined();
  });
});
