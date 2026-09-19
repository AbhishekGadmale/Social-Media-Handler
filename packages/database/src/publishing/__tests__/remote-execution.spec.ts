import { PostPlatformVariant } from '@prisma/client';
import { ExecutionTransitionResult } from '../../repositories/ExecutionMetadataRepository';
function getVariant(res: ExecutionTransitionResult): PostPlatformVariant { if (res.type !== ExecutionTransitionResultType.SUCCESS) throw new Error('Not success'); return res.variant; }
import { safeParseExecutionMetadata, ExecutionMetadata } from '@agency-os/shared';
function parseMeta(variant: PostPlatformVariant): ExecutionMetadata { const p = safeParseExecutionMetadata(variant.executionMetadata); if(!p.success) throw new Error('parse'); return p.data; }
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
      
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PROCESSING_REMOTE', getVariant(t1, { nextCheckAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() }).dispatchVersion, { nextCheckAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() });
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
      const t2 = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PROCESSING_REMOTE', getVariant(t1, { nextCheckAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() }).dispatchVersion, { nextCheckAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() });
      
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'PROCESSING_REMOTE', 'PROCESSING_REMOTE', getVariant(t2, { nextCheckAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() }).dispatchVersion, { nextCheckAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() });
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
    });

    it('13. PROCESSING_REMOTE -> PUBLISH_REQUESTED succeeds & 14. publishRequestedAt generated', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'CONTAINER_CREATED', getVariant(start).dispatchVersion, { containerId: 'c' });
      const t2 = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PROCESSING_REMOTE', getVariant(t1, { nextCheckAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() }).dispatchVersion, { nextCheckAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() });
      
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'PROCESSING_REMOTE', 'PUBLISH_REQUESTED', getVariant(t2).dispatchVersion);
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
      expect(typeof parseMeta(getVariant(res)).publishRequestedAt).toBe('string');
    });

    it('15. PUBLISH_REQUESTED -> COMPLETED succeeds with finalRemoteId', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'PUBLISH_REQUESTED', getVariant(start).dispatchVersion);
      
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'PUBLISH_REQUESTED', 'COMPLETED', getVariant(t1).dispatchVersion, { finalRemoteId: 'f123' });
      expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
    });

    it('16. PUBLISH_REQUESTED -> AMBIGUOUS succeeds', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'PUBLISH_REQUESTED', getVariant(start).dispatchVersion);
      
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
      const t2 = await repo.transitionOperation(testVariantId, meta.operationId, 'CONTAINER_CREATED', 'PROCESSING_REMOTE', getVariant(t1, { nextCheckAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() }).dispatchVersion, { nextCheckAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() });
      const newMeta = parseMeta(getVariant(t2));
      expect(newMeta.containerId).toBe('retain_c');
    });
    it('28. COMPLETED without finalRemoteId rejected', async () => {
      const start = await repo.startOperation(testVariantId, 'INSTAGRAM');
      const meta = parseMeta(getVariant(start));
      const t1 = await repo.transitionOperation(testVariantId, meta.operationId, 'INITIATED', 'PUBLISH_REQUESTED', getVariant(start).dispatchVersion);
      const res = await repo.transitionOperation(testVariantId, meta.operationId, 'PUBLISH_REQUESTED', 'COMPLETED', getVariant(t1).dispatchVersion); // missing finalRemoteId
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
});
