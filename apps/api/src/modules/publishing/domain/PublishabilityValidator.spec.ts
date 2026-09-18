import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublishabilityValidator } from './PublishabilityValidator.js';
import { PostStatus, SocialAccountStatus } from '@agency-os/database';
import {
  providerRegistry,
  IPublishingProvider,
  PublishingCapabilities,
  ProviderOptionsValidationResult,
  ProviderExecutionCredentials,
  ProviderPublicationInput,
  ProviderPublishResult,
} from '@agency-os/providers';

// Define a test-only Publishing Provider
class TestPublishingProvider implements IPublishingProvider {
  getPublishingCapabilities(): PublishingCapabilities {
    return {
      contentTypes: {
        TEXT_POST: { supported: true, maxLength: 500 },
        IMAGE_POST: {
          supported: true,
          maxBytes: 5000000,
          mimeTypes: ['image/jpeg', 'image/png'],
        },
        MULTI_IMAGE_POST: { supported: true, maxCount: 4 },
        VIDEO_POST: { supported: false },
        LINK_POST: { supported: true },
        DOCUMENT_POST: {
          supported: true,
          maxCount: 1,
          mimeTypes: ['application/pdf'],
        },
      },
      features: ['TAGS'],
    };
  }
  validateProviderOptions(options: unknown): ProviderOptionsValidationResult {
    const opts = options as any;
    if (opts.fail) {
      return {
        valid: false,
        issues: [{ code: 'PROVIDER_OPTION_INVALID', message: 'Test fail' }],
      };
    }
    return { valid: true, issues: [] };
  }
  async publish(
    credentials: ProviderExecutionCredentials,
    input: ProviderPublicationInput,
  ): Promise<ProviderPublishResult> {
    return { success: true, externalPostId: '123' };
  }

  // Minimal ISocialProvider methods
  getAuthorizationUrl() {
    return 'test';
  }
  async exchangeAuthorizationCode() {
    return { accessToken: 'token' };
  }
  async getProfiles() {
    return [];
  }
}

describe('PublishabilityValidator', () => {
  describe('Document Capability', () => {
    it('should evaluate as valid when a document is provided', async () => {
      const docVariant = makeMockVariant({
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'application/pdf',
                sizeBytes: 1000,
              },
            },
          ],
        },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(docVariant);
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(true);
    });

    it('should reject mixed media (images and documents)', async () => {
      const mixedVariant = makeMockVariant({
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'application/pdf',
                sizeBytes: 1000,
              },
            },
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'image/jpeg',
                sizeBytes: 1000,
              },
            },
          ],
        },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(mixedVariant);
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.code === 'CONTENT_TYPE_UNSUPPORTED'),
      ).toBe(true);
    });
  });

  let validator: PublishabilityValidator;
  let mockPrisma: any;

  beforeEach(() => {
    // Register fake provider
    providerRegistry.register(
      'test-publishing',
      () => new TestPublishingProvider(),
    );

    mockPrisma = {
      postPlatformVariant: {
        findFirst: vi.fn(),
      },
    };
    validator = new PublishabilityValidator(mockPrisma);
  });

  function makeMockVariant(overrides: any = {}) {
    return {
      id: 'var-1',
      workspaceId: 'ws-1',
      status: PostStatus.DRAFT,
      content: 'Hello world',
      providerOptions: {},
      scheduledAt: null,
      post: {
        id: 'post-1',
        content: 'Hello world',
        media: [],
      },
      socialAccount: {
        id: 'acc-1',
        provider: 'test-publishing',
        status: SocialAccountStatus.ACTIVE,
        capabilities: ['POST_PUBLISH'],
      },
      ...overrides,
    };
  }

  it('rejects foreign-workspace target (not found)', async () => {
    mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(null);
    const result = await validator.validateTarget('ws-2', 'var-1');
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('TARGET_NOT_FOUND');
  });

  describe('State Validation', () => {
    it('accepts DRAFT', async () => {
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(
        makeMockVariant({ status: PostStatus.DRAFT }),
      );
      const result = await validator.validateTarget('ws-1', 'var-1');
      if (!result.valid) console.log('DRAFT validation issues:', result.issues);
      expect(result.valid).toBe(true);
    });

    it('rejects PUBLISHED', async () => {
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(
        makeMockVariant({ status: PostStatus.PUBLISHED }),
      );
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('PUBLICATION_STATE_INVALID');
    });

    it('rejects UNKNOWN as reconciliation-required', async () => {
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(
        makeMockVariant({ status: PostStatus.UNKNOWN }),
      );
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('PUBLICATION_STATE_INVALID');
      expect(result.issues[0].message).toContain('reconciliation');
    });
  });

  describe('Account Validation', () => {
    it('accepts ACTIVE', async () => {
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(
        makeMockVariant(),
      );
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(true);
    });

    it('rejects REAUTH_REQUIRED', async () => {
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(
        makeMockVariant({
          socialAccount: {
            provider: 'test-publishing',
            status: SocialAccountStatus.REAUTH_REQUIRED,
            capabilities: ['POST_PUBLISH'],
          },
        }),
      );
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('ACCOUNT_NOT_ACTIVE');
    });
  });

  describe('Adapter Support', () => {
    it('rejects non-publishing provider', async () => {
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(
        makeMockVariant({
          socialAccount: {
            provider: 'dummy-non-publishing',
            status: SocialAccountStatus.ACTIVE,
          }, // youtube has no publishing
        }),
      );
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('PROVIDER_PUBLISHING_UNSUPPORTED');
    });
  });

  describe('Content Capability', () => {
    it('accepts supported content type (TEXT_POST)', async () => {
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(
        makeMockVariant(),
      );
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(true);
    });

    it('rejects unsupported content type (VIDEO_POST)', async () => {
      const variant = makeMockVariant({
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'video/mp4',
                byteSize: 1000,
                status: 'READY',
              },
            },
          ],
        },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(variant);
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('CONTENT_TYPE_UNSUPPORTED');
    });
  });

  describe('Media Validation', () => {
    it('rejects foreign-workspace asset', async () => {
      const variant = makeMockVariant({
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-HACKER',
                mimeType: 'image/jpeg',
                byteSize: 1000,
                status: 'READY',
              },
            },
          ],
        },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(variant);
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.code === 'MEDIA_WORKSPACE_MISMATCH'),
      ).toBe(true);
    });

    it('rejects unsupported MIME type', async () => {
      const variant = makeMockVariant({
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'image/gif',
                byteSize: 1000,
                status: 'READY',
              },
            },
          ],
        },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(variant);
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.code === 'MEDIA_TYPE_UNSUPPORTED'),
      ).toBe(true);
    });

    it('rejects excessive size', async () => {
      const variant = makeMockVariant({
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'image/jpeg',
                byteSize: 999999999,
                status: 'READY',
              },
            },
          ],
        },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(variant);
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'MEDIA_TOO_LARGE')).toBe(
        true,
      );
    });

    it('rejects excessive count', async () => {
      const media = Array(5)
        .fill(0)
        .map(() => ({
          media: {
            workspaceId: 'ws-1',
            mimeType: 'image/jpeg',
            byteSize: 1000,
            status: 'READY',
          },
        }));
      const variant = makeMockVariant({
        post: { media },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(variant);
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'MEDIA_COUNT_EXCEEDED')).toBe(
        true,
      );
    });
  });

  describe('Options Validation', () => {
    it('returns normalized issue for invalid options', async () => {
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(
        makeMockVariant({ providerOptions: { fail: true } }),
      );
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.code === 'PROVIDER_OPTION_INVALID'),
      ).toBe(true);
    });
  });

  describe('Scheduling Validation', () => {
    it('accepts future schedule', async () => {
      const future = new Date(Date.now() + 100000);
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(
        makeMockVariant({ status: PostStatus.SCHEDULED, scheduledAt: future }),
      );
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(true);
    });

    it('rejects missing scheduledAt', async () => {
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(
        makeMockVariant({ status: PostStatus.SCHEDULED, scheduledAt: null }),
      );
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'SCHEDULE_REQUIRED')).toBe(
        true,
      );
    });

    it('rejects past schedule', async () => {
      const past = new Date(Date.now() - 100000);
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(
        makeMockVariant({ status: PostStatus.SCHEDULED, scheduledAt: past }),
      );
      const result = await validator.validateTarget('ws-1', 'var-1');
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'SCHEDULE_IN_PAST')).toBe(
        true,
      );
    });
  });

  describe('Multiple Issue Collection', () => {
    it('collects multiple independent issues', async () => {
      // Create a variant with multiple flaws
      const past = new Date(Date.now() - 100000);
      const variant = makeMockVariant({
        status: PostStatus.SCHEDULED,
        scheduledAt: past, // Issue 1: past schedule
        providerOptions: { fail: true }, // Issue 2: invalid options
        socialAccount: {
          provider: 'test-publishing',
          status: SocialAccountStatus.REAUTH_REQUIRED,
          capabilities: ['POST_PUBLISH'],
        }, // Issue 3: inactive account
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-2',
                mimeType: 'image/gif',
                byteSize: 999999999,
                status: 'READY',
              },
            }, // Issue 4,5,6: mismatch, type, size
          ],
        },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(variant);
      const result = await validator.validateTarget('ws-1', 'var-1');

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(6);

      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain('SCHEDULE_IN_PAST');
      expect(codes).toContain('PROVIDER_OPTION_INVALID');
      expect(codes).toContain('ACCOUNT_NOT_ACTIVE');
      expect(codes).toContain('MEDIA_WORKSPACE_MISMATCH');
      expect(codes).toContain('MEDIA_TYPE_UNSUPPORTED');
      expect(codes).toContain('MEDIA_TOO_LARGE');
    });
  });

  describe('Security Boundaries', () => {
    it('never leaks credential data in validation output', async () => {
      const variant = makeMockVariant({
        providerOptions: { secretToken: '12345-SECRET', fail: true },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue(variant);

      const result = await validator.validateTarget('ws-1', 'var-1');
      const jsonStr = JSON.stringify(result);

      expect(result.valid).toBe(false);
      expect(jsonStr).not.toContain('12345-SECRET');
      expect(jsonStr).not.toContain('secretToken');
    });
  });

  describe('Facebook 8MB Boundary Validation', () => {
    it('allows exactly 8MB and rejects 8MB + 1 byte using real MetaProvider capabilities', async () => {
      const facebookAdapter = providerRegistry.getPublishingAdapter('facebook');
      expect(
        facebookAdapter.getPublishingCapabilities().contentTypes.IMAGE_POST
          .maxBytes,
      ).toBe(8 * 1024 * 1024);

      const exact8MB = 8 * 1024 * 1024;
      const over8MB = exact8MB + 1;

      const exactVariant = makeMockVariant({
        socialAccount: {
          provider: 'facebook',
          status: SocialAccountStatus.ACTIVE,
          capabilities: ['POST_PUBLISH'],
        },
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'image/jpeg',
                byteSize: exact8MB,
                status: 'READY',
              },
            },
          ],
        },
      });

      const overVariant = makeMockVariant({
        socialAccount: {
          provider: 'facebook',
          status: SocialAccountStatus.ACTIVE,
          capabilities: ['POST_PUBLISH'],
        },
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'image/jpeg',
                byteSize: over8MB,
                status: 'READY',
              },
            },
          ],
        },
      });

      mockPrisma.postPlatformVariant.findFirst.mockResolvedValueOnce(
        exactVariant,
      );
      const resultExact = await validator.validateTarget('ws-1', 'v1');
      if (!resultExact.valid)
        console.log('Exact 8MB Validation Failed:', resultExact.issues);
      expect(resultExact.valid).toBe(true);

      mockPrisma.postPlatformVariant.findFirst.mockResolvedValueOnce(
        overVariant,
      );
      const resultOver = await validator.validateTarget('ws-1', 'v2');
      expect(resultOver.valid).toBe(false);
      expect(
        resultOver.issues.find((i) => i.code === 'MEDIA_TOO_LARGE'),
      ).toBeDefined();
    });
  });

  describe('Instagram Capability Validation', () => {
    it('accepts exactly one valid image', async () => {
      const variant = makeMockVariant({
        socialAccount: {
          provider: 'instagram',
          status: SocialAccountStatus.ACTIVE,
          capabilities: ['POST_PUBLISH'],
        },
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'image/jpeg',
                byteSize: 1000,
                status: 'READY',
              },
            },
          ],
        },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValueOnce(variant);
      const result = await validator.validateTarget('ws-1', 'v1');
      expect(result.valid).toBe(true);
    });

    it('rejects multiple images', async () => {
      const variant = makeMockVariant({
        socialAccount: {
          provider: 'instagram',
          status: SocialAccountStatus.ACTIVE,
          capabilities: ['POST_PUBLISH'],
        },
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'image/jpeg',
                byteSize: 1000,
                status: 'READY',
              },
            },
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'image/jpeg',
                byteSize: 1000,
                status: 'READY',
              },
            },
          ],
        },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValueOnce(variant);
      const result = await validator.validateTarget('ws-1', 'v1');
      expect(result.valid).toBe(false);
      expect(
        result.issues.find((i) => i.code === 'CONTENT_TYPE_UNSUPPORTED'),
      ).toBeDefined();
    });

    it('rejects text-only', async () => {
      const variant = makeMockVariant({
        socialAccount: {
          provider: 'instagram',
          status: SocialAccountStatus.ACTIVE,
          capabilities: ['POST_PUBLISH'],
        },
        post: { media: [] }, // text-only
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValueOnce(variant);
      const result = await validator.validateTarget('ws-1', 'v1');
      expect(result.valid).toBe(false);
      expect(
        result.issues.find((i) => i.code === 'CONTENT_TYPE_UNSUPPORTED'),
      ).toBeDefined();
    });

    it('rejects video', async () => {
      const variant = makeMockVariant({
        socialAccount: {
          provider: 'instagram',
          status: SocialAccountStatus.ACTIVE,
          capabilities: ['POST_PUBLISH'],
        },
        post: {
          media: [
            {
              media: {
                workspaceId: 'ws-1',
                mimeType: 'video/mp4',
                byteSize: 1000,
                status: 'READY',
              },
            },
          ],
        },
      });
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValueOnce(variant);
      const result = await validator.validateTarget('ws-1', 'v1');
      expect(result.valid).toBe(false);
      expect(
        result.issues.find((i) => i.code === 'CONTENT_TYPE_UNSUPPORTED'),
      ).toBeDefined();
    });
  });
});
