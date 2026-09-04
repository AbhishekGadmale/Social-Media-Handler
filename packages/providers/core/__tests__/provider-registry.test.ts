import { describe, it, expect } from 'vitest';
import { ProviderRegistry, providerRegistry } from '../provider-registry';
import { LinkedInProvider } from '../../linkedin/linkedin.provider';
import { YouTubeProvider } from '../../youtube/youtube.provider';
import { ProviderCapabilityError } from '../errors';

describe('ProviderRegistry', () => {
  it('should register and resolve providers case-insensitively', () => {
    const registry = new ProviderRegistry();
    registry.register('LINKEDIN', () => new LinkedInProvider());
    
    expect(registry.get('LINKEDIN')).toBeDefined();
    expect(registry.get('linkedin')).toBeDefined();
    expect(registry.get('LiNkEdIn')).toBeDefined();
    
    // Exact same instance
    expect(registry.get('LINKEDIN')).toBe(registry.get('linkedin'));
  });

  it('should support publishing check case-insensitively', () => {
    const registry = new ProviderRegistry();
    registry.register('LINKEDIN', () => new LinkedInProvider());
    
    expect(registry.supportsPublishing('LINKEDIN')).toBe(true);
    expect(registry.supportsPublishing('linkedin')).toBe(true);
  });

  it('should throw when getting an unknown provider', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.getOrThrow('UNKNOWN')).toThrow(/not found in registry/);
  });

  it('should throw ProviderCapabilityError if publishing not supported', () => {
    const registry = new ProviderRegistry();
    // Registering a dummy provider that doesn't support publishing
    registry.register('DUMMY', () => ({
      getCapabilities: async () => [],
    }) as any);
    
    expect(registry.supportsPublishing('dummy')).toBe(false);
    expect(() => registry.getPublishingAdapter('dummy')).toThrow(ProviderCapabilityError);
  });

  describe('global providerRegistry', () => {
    it('should have linkedin and youtube registered', () => {
      expect(providerRegistry.get('linkedin')).toBeInstanceOf(LinkedInProvider);
      expect(providerRegistry.get('youtube')).toBeInstanceOf(YouTubeProvider);
    });
  });
});
