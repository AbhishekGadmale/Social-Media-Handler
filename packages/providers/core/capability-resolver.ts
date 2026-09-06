import { CapabilityContext, ProviderCapabilities, Capability } from './types/index';

/**
 * Pure function to resolve the effective capabilities of a social provider.
 * Output is safe to store (OBSERVED/CACHEABLE state).
 */
export function resolveCapabilities(input: CapabilityContext): ProviderCapabilities {
  const capabilities: Set<Capability> = new Set();

  if (input.pendingApproval) {
    // If pending approval, we can't do much. Maybe just basic read.
    return [];
  }

  const { grantedScopes, accountType } = input;

  // Basic capability mapping based on typical OAuth scopes.
  // This would normally be extended per-provider, but the core resolver
  // provides a foundational strict mapping.
  
  if (grantedScopes.includes('read:account') || grantedScopes.includes('profile')) {
    capabilities.add('ACCOUNT_READ');
  }

  if (grantedScopes.includes('read:analytics') || grantedScopes.includes('insights')) {
    capabilities.add('ANALYTICS_READ');
  }

  if (grantedScopes.includes('read:posts') || grantedScopes.includes('stream')) {
    capabilities.add('POST_READ');
  }

  if (grantedScopes.includes('write:posts') || grantedScopes.includes('publish')) {
    capabilities.add('POST_PUBLISH');
    capabilities.add('POST_SCHEDULE'); // Often goes together with publish
  }

  if (grantedScopes.includes('read:comments') || grantedScopes.includes('manage:comments')) {
    capabilities.add('COMMENTS');
  }

  if (grantedScopes.includes('read:dms') || grantedScopes.includes('messages')) {
    capabilities.add('DMS');
  }
  
  if (grantedScopes.includes('manage:webhooks')) {
    capabilities.add('WEBHOOKS');
  }

  // Account type specific logic (e.g. Creator vs Business accounts on some platforms)
  if (accountType === 'personal') {
    // Personal accounts usually don't have analytics or webhooks
    capabilities.delete('ANALYTICS_READ');
    capabilities.delete('WEBHOOKS');
  }

  return Array.from(capabilities);
}
