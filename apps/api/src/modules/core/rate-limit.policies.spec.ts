import { RateLimitPolicies } from './rate-limit.policies';
import { describe, it, expect } from 'vitest';

describe('RateLimitPolicies', () => {
  it('should export standard rate limit profiles', () => {
    expect(RateLimitPolicies.baseline.limit).toBeGreaterThan(0);
    expect(RateLimitPolicies.auth.limit).toBeGreaterThan(0);
    expect(RateLimitPolicies.expensive.limit).toBeGreaterThan(0);
  });

  it('should relax auth limit in test environment', () => {
    // The policy dynamically uses process.env.NODE_ENV
    // Since we are running in vitest, NODE_ENV is 'test'
    expect(RateLimitPolicies.auth.limit).toBe(1000);
  });
});
