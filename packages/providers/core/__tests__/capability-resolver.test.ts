import { describe, it, expect } from 'vitest';
import { resolveCapabilities } from '../capability-resolver.js';

describe('Capability Resolver', () => {
  it('resolves basic read capabilities based on full scopes', () => {
    const caps = resolveCapabilities({
      provider: 'mock',
      grantedScopes: ['read:account', 'read:analytics', 'read:posts', 'write:posts', 'read:comments', 'read:dms', 'manage:webhooks'],
    });

    expect(caps).toContain('ACCOUNT_READ');
    expect(caps).toContain('ANALYTICS_READ');
    expect(caps).toContain('POST_READ');
    expect(caps).toContain('POST_PUBLISH');
    expect(caps).toContain('POST_SCHEDULE');
    expect(caps).toContain('COMMENTS');
    expect(caps).toContain('DMS');
    expect(caps).toContain('WEBHOOKS');
  });

  it('resolves limited capabilities based on partial scopes', () => {
    const caps = resolveCapabilities({
      provider: 'mock',
      grantedScopes: ['read:account', 'write:posts'],
    });

    expect(caps).toContain('ACCOUNT_READ');
    expect(caps).toContain('POST_PUBLISH');
    expect(caps).toContain('POST_SCHEDULE');
    expect(caps).not.toContain('ANALYTICS_READ');
    expect(caps).not.toContain('WEBHOOKS');
  });

  it('downgrades capabilities for personal account types', () => {
    const caps = resolveCapabilities({
      provider: 'mock',
      grantedScopes: ['read:account', 'read:analytics', 'manage:webhooks'],
      accountType: 'personal',
    });

    expect(caps).toContain('ACCOUNT_READ');
    // These should be actively removed for personal accounts
    expect(caps).not.toContain('ANALYTICS_READ');
    expect(caps).not.toContain('WEBHOOKS');
  });

  it('returns empty array if pending approval state is true', () => {
    const caps = resolveCapabilities({
      provider: 'mock',
      grantedScopes: ['read:account', 'write:posts', 'manage:webhooks'],
      pendingApproval: true,
    });

    expect(caps.length).toBe(0);
  });
});
