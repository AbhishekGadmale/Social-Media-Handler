import { describe, it, expect } from 'vitest';
import { safeParseExecutionMetadata } from '@agency-os/shared';

describe('ExecutionMetadataSchema', () => {
  const base = {
    version: 1,
    operationId: '123e4567-e89b-12d3-a456-426614174000',
    provider: 'FACEBOOK',
  };

  it('PROCESSING_REMOTE without nextCheckAt rejected', () => {
    const res = safeParseExecutionMetadata({ ...base, phase: 'PROCESSING_REMOTE', lastCheckedAt: new Date().toISOString() });
    expect(res.success).toBe(false);
  });

  it('PROCESSING_REMOTE without lastCheckedAt rejected', () => {
    const res = safeParseExecutionMetadata({ ...base, phase: 'PROCESSING_REMOTE', nextCheckAt: new Date().toISOString() });
    expect(res.success).toBe(false);
  });

  it('valid PROCESSING_REMOTE accepted', () => {
    const res = safeParseExecutionMetadata({ ...base, phase: 'PROCESSING_REMOTE', lastCheckedAt: new Date().toISOString(), nextCheckAt: new Date().toISOString() });
    expect(res.success).toBe(true);
  });

  it('CONTAINER_CREATED missing containerId rejected', () => {
    const res = safeParseExecutionMetadata({ ...base, phase: 'CONTAINER_CREATED', containerCreatedAt: new Date().toISOString() });
    expect(res.success).toBe(false);
  });

  it('PUBLISH_REQUESTED missing publishRequestedAt rejected', () => {
    const res = safeParseExecutionMetadata({ ...base, phase: 'PUBLISH_REQUESTED' });
    expect(res.success).toBe(false);
  });

  it('COMPLETED missing finalRemoteId rejected', () => {
    const res = safeParseExecutionMetadata({ ...base, phase: 'COMPLETED' });
    expect(res.success).toBe(false);
  });
});
