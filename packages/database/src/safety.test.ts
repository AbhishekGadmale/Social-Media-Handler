import { describe, it, expect } from 'vitest';
import { assertTestDatabaseUrl } from './check-test-db';
import { compareFingerprints } from './safety';

describe('Database Safety', () => {
  it('rejects agency_os', () => {
    expect(() => assertTestDatabaseUrl('postgresql://localhost:5432/agency_os?schema=public')).toThrow(/agency_os explicitly rejected/);
  });

  it('rejects missing TEST_DATABASE_URL', () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow(/Database URL is missing/);
    expect(() => assertTestDatabaseUrl('')).toThrow(/Database URL is missing/);
  });

  it('accepts agency_os_test', () => {
    const url = 'postgresql://localhost:5432/agency_os_test?schema=public';
    expect(assertTestDatabaseUrl(url)).toBe(url);
  });

  it('detects count-preserving identity replacement', () => {
    const fp1 = {
      users: 1, orgs: 1, workspaces: 1, members: 1,
      hash: 'hash1'
    };
    const fp2 = {
      users: 1, orgs: 1, workspaces: 1, members: 1,
      hash: 'hash2' // different identities
    };
    expect(compareFingerprints(fp1, fp2)).toBe(false);
  });
});
