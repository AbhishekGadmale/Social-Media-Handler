import { describe, it, expect } from 'vitest';
import { MockLimitedProvider, MockFullProvider } from './fixtures/mock-provider';
import { ProviderCapabilityError } from '../errors/index';
import { invokeCapability } from '../utils/invoke-capability';
import { OAuthCredentials } from '../types/index';

describe('Mock Provider via invokeCapability', () => {
  const credentials: OAuthCredentials = { accessToken: 'test-token' };

  describe('MockFullProvider', () => {
    it('succeeds calling optional methods via invokeCapability', async () => {
      const provider = new MockFullProvider();

      // Invoke getPostMetrics (optional)
      const metrics = await invokeCapability(provider, 'getPostMetrics', credentials, { id: '1', externalId: 'ext-1' });
      expect(metrics.likes).toBe(10);
      expect(metrics.comments).toBe(2);

      // Invoke publishPost (optional)
      const result = await invokeCapability(provider, 'publishPost', credentials, { text: 'Hello' });
      expect(result.externalPostId).toBe('mock_post_1');
    });

    it('succeeds calling required methods via invokeCapability', async () => {
      const provider = new MockFullProvider();
      const profiles = await invokeCapability(provider, 'getProfiles', credentials);
      expect(profiles[0].id).toBe('mock_user_1');
    });
  });

  describe('MockLimitedProvider', () => {
    it('throws ProviderCapabilityError specifically when invoking missing optional method', async () => {
      const provider = new MockLimitedProvider();

      await expect(
        invokeCapability(provider, 'publishPost', credentials, { text: 'Hello' })
      ).rejects.toThrow(ProviderCapabilityError);

      await expect(
        invokeCapability(provider, 'getPostMetrics', credentials, { id: '1', externalId: 'ext-1' })
      ).rejects.toThrow(ProviderCapabilityError);
      
      try {
        await invokeCapability(provider, 'publishPost', credentials, { text: 'Hello' });
        // Should not reach here
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderCapabilityError);
        expect((err as Error).message).toContain('publishPost');
      }
    });

    it('succeeds calling required methods on limited provider', async () => {
      const provider = new MockLimitedProvider();
      
      const profiles = await invokeCapability(provider, 'getProfiles', credentials);
      expect(profiles.length).toBe(1);
      expect(profiles[0].username).toBe('mockuser');
    });
  });
});
