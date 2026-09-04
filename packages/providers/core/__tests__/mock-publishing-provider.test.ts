import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { IPublishingProvider, ProviderOptionsValidationResult, ProviderPublicationInput, ProviderPublishResult, PublishingCapabilities, ProviderExecutionCredentials } from '../interfaces/IPublishingProvider';
import { ISocialProvider } from '../interfaces/ISocialProvider';
import { providerRegistry } from '../provider-registry';
import { ProviderCapabilityError } from '../errors/index';

// Define Zod schema for mock options
const MockOptionsSchema = z.object({
  notifyFollowers: z.boolean().default(true),
  tags: z.array(z.string()).max(5).optional(),
}).strict();

// Mock Provider implementing BOTH interfaces for testing
class MockFullProvider implements ISocialProvider, IPublishingProvider {
  getAuthorizationUrl() { return 'http://mock'; }
  async exchangeAuthorizationCode() { return { accessToken: 'token' }; }
  async getProfiles() { return []; }

  getPublishingCapabilities(): PublishingCapabilities {
    return {
      contentTypes: {
        TEXT_POST: { supported: true, maxLength: 280 },
        IMAGE_POST: { supported: true, maxCount: 4, mimeTypes: ['image/jpeg', 'image/png'] },
        MULTI_IMAGE_POST: { supported: true, maxCount: 4 },
        VIDEO_POST: { supported: false },
        LINK_POST: { supported: true },
      },
      features: ['TAGS'],
    };
  }

  validateProviderOptions(options: unknown): ProviderOptionsValidationResult {
    const result = MockOptionsSchema.safeParse(options);
    if (result.success) {
      return { valid: true, issues: [] };
    }
    return {
      valid: false,
      issues: result.error.errors.map(e => ({
        code: 'PROVIDER_OPTION_INVALID',
        field: e.path.join('.'),
        message: e.message
      }))
    };
  }

  async publish(credentials: ProviderExecutionCredentials, input: ProviderPublicationInput): Promise<ProviderPublishResult> {
    if (!credentials.accessToken) {
      return {
        success: false,
        failureCategory: 'AUTH_REQUIRED',
        failureCode: 'NO_TOKEN',
        message: 'Missing access token'
      };
    }

    if (input.content === 'FAIL_TRANSIENT') {
      return {
        success: false,
        failureCategory: 'TRANSIENT',
        failureCode: '500_INTERNAL',
        message: 'Simulated failure',
        retryAfterSeconds: 60
      };
    }

    return {
      success: true,
        externalPostId: `mock-post-${input.targetId}`,
        canonicalUrl: `https://mock.com/post/${input.targetId}`,
        publishedAt: new Date(),
        processingState: 'PUBLISHED'
    };
  }
}

// Partial Mock that does NOT implement publishing
class MockBasicProvider implements ISocialProvider {
  getAuthorizationUrl() { return 'http://mock'; }
  async exchangeAuthorizationCode() { return { accessToken: 'token' }; }
  async getProfiles() { return []; }
}

describe('PublishingProvider Contracts & Registry', () => {
  beforeEach(() => {
    providerRegistry.register('mock-full', () => new MockFullProvider());
    providerRegistry.register('mock-basic', () => new MockBasicProvider());
  });

  describe('ProviderRegistry Publishing Capabilities', () => {
    it('correctly identifies providers with publishing support', () => {
      expect(providerRegistry.supportsPublishing('mock-full')).toBe(true);
    });

    it('correctly identifies providers without publishing support', () => {
      expect(providerRegistry.supportsPublishing('mock-basic')).toBe(false);
    });

    it('returns publishing adapter safely for supported provider', () => {
      const adapter = providerRegistry.getPublishingAdapter('mock-full');
      expect(adapter).toBeDefined();
      expect(adapter.getPublishingCapabilities().features).toContain('TAGS');
    });

    it('throws domain error when requesting publishing adapter for unsupported provider', () => {
      expect(() => providerRegistry.getPublishingAdapter('mock-basic'))
        .toThrow(ProviderCapabilityError);
      expect(() => providerRegistry.getPublishingAdapter('mock-basic'))
        .toThrow('Provider does not support capability: PUBLISHING');
    });
  });

  describe('IPublishingProvider implementation', () => {
    let adapter: IPublishingProvider;
    
    beforeEach(() => {
      adapter = providerRegistry.getPublishingAdapter('mock-full');
    });

    it('exposes strongly typed capabilities and constraints', () => {
      const caps = adapter.getPublishingCapabilities();
      expect(caps.contentTypes.TEXT_POST.supported).toBe(true);
      expect(caps.contentTypes.TEXT_POST.maxLength).toBe(280);
      expect(caps.contentTypes.VIDEO_POST.supported).toBe(false);
    });

    it('validates provider options according to Zod schema (valid)', () => {
      const validOpts = { notifyFollowers: false, tags: ['a', 'b'] };
      const res = adapter.validateProviderOptions(validOpts);
      expect(res.valid).toBe(true);
      expect(res.issues).toHaveLength(0);
    });

    it('validates provider options according to Zod schema (invalid fields)', () => {
      const invalidOpts = { notifyFollowers: false, tags: ['a', 'b', 'c', 'd', 'e', 'f'], extra: 'bad' };
      const res = adapter.validateProviderOptions(invalidOpts);
      expect(res.valid).toBe(false);
      expect(res.issues.length).toBeGreaterThan(0);
      expect(res.issues[0].code).toBe('PROVIDER_OPTION_INVALID');
    });

    it('returns normalized success response on publish', async () => {
      const input: ProviderPublicationInput = {
        attemptId: 'a1', targetId: 't1', workspaceId: 'w1', content: 'Hello World', providerOptions: {}, externalAccountId: 'ext-1'
      };
      const res = await adapter.publish({ accessToken: 'valid' }, input);
      
      expect(res.success).toBe(true);
      if (res.success) { // Type guard
        expect(res.externalPostId).toBe('mock-post-t1');
        expect(res.processingState).toBe('PUBLISHED');
      }
    });

    it('returns normalized failure taxonomy on error', async () => {
      const input: ProviderPublicationInput = {
        attemptId: 'a2', targetId: 't2', workspaceId: 'w2', content: 'FAIL_TRANSIENT', providerOptions: {}, externalAccountId: 'ext-2'
      };
      const res = await adapter.publish({ accessToken: 'valid' }, input);
      
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.failureCategory).toBe('TRANSIENT');
        expect(res.retryAfterSeconds).toBe(60);
      }
    });
  });
});
