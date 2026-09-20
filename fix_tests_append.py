import codecs

path = 'packages/database/src/publishing/__tests__/remote-execution.spec.ts'
with codecs.open(path, 'r', 'utf-8') as f:
    text = f.read()

new_tests = '''
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
});
'''

text = text.replace('});\n});', '});\n' + new_tests)

with codecs.open(path, 'w', 'utf-8') as f:
    f.write(text)
