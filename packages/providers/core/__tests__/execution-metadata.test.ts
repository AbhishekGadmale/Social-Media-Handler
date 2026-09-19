import { describe, it, expect } from 'vitest';
import {
  ExecutionMetadataSchema,
  parseExecutionMetadata,
  safeParseExecutionMetadata,
} from '../types/execution-metadata';

describe('ExecutionMetadataSchema', () => {
  const validV1 = {
    version: 1,
    operationId: '123e4567-e89b-12d3-a456-426614174000',
    provider: 'INSTAGRAM',
    phase: 'INITIATED',
  };

  it('accepts valid V1 metadata', () => {
    const result = safeParseExecutionMetadata(validV1);
    expect(result.success).toBe(true);
  });

  it('rejects invalid version', () => {
    const invalid = { ...validV1, version: 2 };
    expect(safeParseExecutionMetadata(invalid).success).toBe(false);
  });

  it('requires a valid UUID for operationId', () => {
    const invalid = { ...validV1, operationId: 'not-a-uuid' };
    expect(safeParseExecutionMetadata(invalid).success).toBe(false);
  });

  it('rejects invalid provider', () => {
    const invalid = { ...validV1, provider: 'MYSPACE' };
    expect(safeParseExecutionMetadata(invalid).success).toBe(false);
  });

  it('rejects invalid phase', () => {
    const invalid = { ...validV1, phase: 'UNKNOWN_PHASE' };
    expect(safeParseExecutionMetadata(invalid).success).toBe(false);
  });

  it('accepts valid optional datetimes', () => {
    const withDates = {
      ...validV1,
      containerCreatedAt: '2026-09-19T10:00:00.000Z',
    };
    expect(safeParseExecutionMetadata(withDates).success).toBe(true);
  });

  it('rejects invalid datetimes', () => {
    const invalid = { ...validV1, containerCreatedAt: 'yesterday' };
    expect(safeParseExecutionMetadata(invalid).success).toBe(false);
  });

  it('rejects unknown fields (strict mode)', () => {
    const withSecrets = {
      ...validV1,
      accessToken: 'secret_token_123',
    };
    expect(safeParseExecutionMetadata(withSecrets).success).toBe(false);
  });

  it('rejects signedUrl', () => {
    const withSignedUrl = {
      ...validV1,
      signedUrl: 'https://s3.example.com/video?signature=123',
    };
    expect(safeParseExecutionMetadata(withSignedUrl).success).toBe(false);
  });

  it('rejects kind (removed)', () => {
    const withKind = {
      ...validV1,
      kind: 'REEL_PUBLISH',
    };
    expect(safeParseExecutionMetadata(withKind).success).toBe(false);
  });

  it('parseExecutionMetadata throws on error', () => {
    expect(() => parseExecutionMetadata({ version: 2 })).toThrow();
  });
});
