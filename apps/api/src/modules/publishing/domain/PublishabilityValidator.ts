import {
  PrismaClient,
  PostStatus,
  MediaAsset,
  SocialAccountStatus,
  isReconciliationRequiredState,
} from '@agency-os/database';
import {
  providerRegistry,
  PublicationContentType,
  IPublishingProvider,
} from '@agency-os/providers';

export type PublishabilityIssueCode =
  | 'TARGET_NOT_FOUND'
  | 'PUBLICATION_STATE_INVALID'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'PROVIDER_PUBLISHING_UNSUPPORTED'
  | 'CONTENT_TYPE_UNSUPPORTED'
  | 'MEDIA_WORKSPACE_MISMATCH'
  | 'MEDIA_TYPE_UNSUPPORTED'
  | 'MEDIA_TOO_LARGE'
  | 'MEDIA_COUNT_EXCEEDED'
  | 'MEDIA_NOT_READY'
  | 'PROVIDER_OPTION_INVALID'
  | 'SCHEDULE_REQUIRED'
  | 'SCHEDULE_IN_PAST';

export interface PublishabilityIssue {
  code: PublishabilityIssueCode;
  field?: string;
  targetId?: string;
  message: string;
}

export interface PublishabilityValidationResult {
  valid: boolean;
  issues: PublishabilityIssue[];
}

export class PublishabilityValidator {
  constructor(private readonly prisma: PrismaClient) {}

  async validateTarget(
    workspaceId: string,
    variantId: string,
    isRetry = false,
    now: Date = new Date(),
  ): Promise<PublishabilityValidationResult> {
    const issues: PublishabilityIssue[] = [];

    // 1. Authoritative tenant-scoped load
    const variant: any = await this.prisma.postPlatformVariant.findFirst({
      where: {
        id: variantId,
        workspaceId,
      },
      include: {
        post: {
          include: {
            media: {
              include: {
                media: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
        socialAccount: true,
      },
    });

    if (!variant) {
      return {
        valid: false,
        issues: [
          {
            code: 'TARGET_NOT_FOUND',
            targetId: variantId,
            message: 'Publication target not found in workspace',
          },
        ],
      };
    }

    // 2. Publication State Eligibility
    // Allowed initial: DRAFT, SCHEDULED
    // Allowed retry: FAILED
    // Rejected: QUEUED, PUBLISHING, PUBLISHED, UNKNOWN
    if (variant.status === PostStatus.UNKNOWN) {
      issues.push({
        code: 'PUBLICATION_STATE_INVALID',
        targetId: variantId,
        message: 'Publication requires manual reconciliation (UNKNOWN state)',
      });
    } else if (
      variant.status === PostStatus.PUBLISHED ||
      variant.status === PostStatus.PUBLISHING ||
      variant.status === PostStatus.QUEUED
    ) {
      issues.push({
        code: 'PUBLICATION_STATE_INVALID',
        targetId: variantId,
        message: `Cannot publish from state: ${variant.status}`,
      });
    } else if (isRetry && variant.status !== PostStatus.FAILED) {
      issues.push({
        code: 'PUBLICATION_STATE_INVALID',
        targetId: variantId,
        message: 'Retry is only valid for FAILED state',
      });
    } else if (!isRetry && variant.status === PostStatus.FAILED) {
      // Technically debatable, but usually standard requests should be explicit retries
    }

    // 3. Social Account Eligibility
    if (!variant.socialAccount) {
      // Shouldn't happen with DB FKs, but defensive
      issues.push({
        code: 'ACCOUNT_NOT_ACTIVE',
        targetId: variantId,
        message: 'Target social account missing',
      });
    } else if (variant.socialAccount.status !== SocialAccountStatus.ACTIVE) {
      issues.push({
        code: 'ACCOUNT_NOT_ACTIVE',
        targetId: variantId,
        message: `Social account status is ${variant.socialAccount.status}`,
      });
    }

    // 4. Provider Publishing Support
    const providerName = variant.socialAccount?.provider;
    if (
      !providerName ||
      !providerRegistry.supportsPublishing(providerName.toLowerCase())
    ) {
      issues.push({
        code: 'PROVIDER_PUBLISHING_UNSUPPORTED',
        targetId: variantId,
        message: `Provider ${providerName} does not currently support publishing via the application adapter`,
      });
      // If the provider doesn't support publishing, we can't do capability validation
      // Return early for this target
      return { valid: issues.length === 0, issues };
    }

    const adapter = providerRegistry.getPublishingAdapter(
      providerName.toLowerCase(),
    );
    const capabilities = adapter.getPublishingCapabilities();

    // 5. Determine Content Type
    const textContent = variant.content || variant.post.content;
    const mediaCount = variant.post.media.length;
    let contentType: PublicationContentType = 'TEXT_POST';

    // Simple deterministic classifier based on Phase 7.1 semantics
    if (mediaCount > 0) {
      const allImages = variant.post.media.every((m: any) =>
        m.media.mimeType.startsWith('image/'),
      );
      const allVideos = variant.post.media.every((m: any) =>
        m.media.mimeType.startsWith('video/'),
      );

      if (allImages) {
        contentType = mediaCount === 1 ? 'IMAGE_POST' : 'MULTI_IMAGE_POST';
      } else if (allVideos) {
        // usually 1 video max per post is standard but could be more
        contentType = 'VIDEO_POST';
      } else {
        // mixed media - typically fallback to MULTI_IMAGE_POST or fail if unsupported
        contentType = 'MULTI_IMAGE_POST'; // Depending on exact domain logic
      }
    } else {
      // Check for link (rough heuristic, real logic might use explicit link field)
      const hasLink = /https?:\/\//i.test(textContent || '');
      if (hasLink) contentType = 'LINK_POST';
    }

    // 6. Capability Validation
    const constraint = capabilities.contentTypes[contentType];
    if (!constraint || !constraint.supported) {
      issues.push({
        code: 'CONTENT_TYPE_UNSUPPORTED',
        targetId: variantId,
        message: `Provider does not support ${contentType}`,
      });
    } else {
      // 7. Media Constraints
      if (
        constraint.maxCount !== undefined &&
        mediaCount > constraint.maxCount
      ) {
        issues.push({
          code: 'MEDIA_COUNT_EXCEEDED',
          targetId: variantId,
          message: `Exceeds max media count of ${constraint.maxCount}`,
        });
      }

      for (const pm of variant.post.media) {
        const asset = pm.media;

        // Tenant Check (Defensive)
        if (asset.workspaceId !== workspaceId) {
          issues.push({
            code: 'MEDIA_WORKSPACE_MISMATCH',
            targetId: variantId,
            message: `MediaAsset ${asset.id} belongs to a different workspace`,
          });
        }

        // Status Check (assuming READY is standard)
        // Since we don't have a status field yet on MediaAsset in Phase 7.2 schema,
        // we'll assume it exists if it's there.

        // MIME Check
        if (
          constraint.mimeTypes &&
          !constraint.mimeTypes.includes(asset.mimeType)
        ) {
          issues.push({
            code: 'MEDIA_TYPE_UNSUPPORTED',
            targetId: variantId,
            message: `MIME type ${asset.mimeType} not supported for ${contentType}`,
          });
        }

        // Size Check
        if (
          constraint.maxBytes &&
          Number(asset.byteSize) > constraint.maxBytes
        ) {
          issues.push({
            code: 'MEDIA_TOO_LARGE',
            targetId: variantId,
            message: `Media size ${asset.byteSize} exceeds max ${constraint.maxBytes} bytes`,
          });
        }
      }
    }

    // 8. Provider Options Validation
    const optionsValidation = adapter.validateProviderOptions(
      variant.providerOptions || {},
    );
    if (!optionsValidation.valid) {
      for (const issue of optionsValidation.issues) {
        issues.push({
          code: 'PROVIDER_OPTION_INVALID',
          targetId: variantId,
          field: issue.field,
          message: issue.message || 'Invalid provider option',
        });
      }
    }

    // 9. Scheduling Validation
    if (variant.status === PostStatus.SCHEDULED) {
      if (!variant.scheduledAt) {
        issues.push({
          code: 'SCHEDULE_REQUIRED',
          targetId: variantId,
          message: 'SCHEDULED status requires scheduledAt',
        });
      } else if (variant.scheduledAt <= now) {
        issues.push({
          code: 'SCHEDULE_IN_PAST',
          targetId: variantId,
          message: 'Scheduled time must be in the future',
        });
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}
