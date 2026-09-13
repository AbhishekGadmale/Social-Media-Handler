/* eslint-disable */
import { Injectable } from '@nestjs/common';
import { ProviderRegistry, PublicationContentType } from '@agency-os/providers';
import { PostStatus, SocialAccountStatus } from '@agency-os/database';

export interface ExecutionValidationResult {
  valid: boolean;
  failureCategory?: 'VALIDATION' | 'AUTH_REQUIRED' | 'PERMANENT';
  failureCode?: string;
}

@Injectable()
export class ExecutionValidator {
  constructor(private readonly providerRegistry: ProviderRegistry) {}

  validate(variant: any): ExecutionValidationResult {
    // 1. Account Active
    if (
      !variant.socialAccount ||
      variant.socialAccount.status !== SocialAccountStatus.ACTIVE
    ) {
      return {
        valid: false,
        failureCategory: 'AUTH_REQUIRED',
        failureCode: 'ACCOUNT_NOT_ACTIVE',
      };
    }

    const providerName = variant.socialAccount.provider;
    if (!this.providerRegistry.supportsPublishing(providerName as string)) {
      return {
        valid: false,
        failureCategory: 'VALIDATION',
        failureCode: 'PROVIDER_PUBLISHING_UNSUPPORTED',
      };
    }

    const adapter = this.providerRegistry.getPublishingAdapter(
      providerName as string,
    );
    const capabilities = adapter.getPublishingCapabilities();

    // 2. Options validation
    const optionsResult = adapter.validateProviderOptions(
      variant.providerOptions || {},
    );
    if (!optionsResult.valid) {
      return {
        valid: false,
        failureCategory: 'VALIDATION',
        failureCode: 'PROVIDER_OPTION_INVALID',
      };
    }

    // 3. Media status & size
    const textContent = variant.content || variant.post.content;
    const mediaCount = variant.post.media?.length || 0;

    let contentType: PublicationContentType | null = null;
    const hasLink = /https?:\/\//i.test(textContent || '');

      if (mediaCount > 0) {
      const allImages = variant.post.media.every(
        (m: { media: { mimeType: string } }) =>
          m.media.mimeType.startsWith('image/'),
      );
      const allVideos = variant.post.media.every(
        (m: { media: { mimeType: string } }) =>
          m.media.mimeType.startsWith('video/'),
      );
      const allPdfs = variant.post.media.every(
        (m: { media: { mimeType: string } }) =>
          m.media.mimeType === 'application/pdf',
      );

      if (allImages)
        contentType = mediaCount === 1 ? 'IMAGE_POST' : 'MULTI_IMAGE_POST';
      else if (allVideos && mediaCount === 1) contentType = 'VIDEO_POST';
      else if (allPdfs && mediaCount === 1) contentType = 'DOCUMENT_POST';
    } else if (hasLink) {
      contentType = 'LINK_POST';
    } else if (textContent) {
      contentType = 'TEXT_POST';
    }

    if (!contentType) {
      return {
        valid: false,
        failureCategory: 'VALIDATION',
        failureCode: 'CONTENT_SHAPE_UNSUPPORTED',
      };
    }

    const constraint = capabilities.contentTypes[contentType];
    if (!constraint || !constraint.supported) {
      return {
        valid: false,
        failureCategory: 'VALIDATION',
        failureCode: 'CONTENT_TYPE_UNSUPPORTED',
      };
    }

    for (const pm of variant.post.media || []) {
      if (pm.media.status !== 'READY') {
        return {
          valid: false,
          failureCategory: 'VALIDATION',
          failureCode: 'MEDIA_NOT_READY',
        };
      }
      if (
        constraint.mimeTypes &&
        !constraint.mimeTypes.includes(pm.media.mimeType)
      ) {
        return {
          valid: false,
          failureCategory: 'VALIDATION',
          failureCode: 'MEDIA_TYPE_UNSUPPORTED',
        };
      }
      if (
        constraint.maxBytes &&
        Number(pm.media.byteSize) > constraint.maxBytes
      ) {
        return {
          valid: false,
          failureCategory: 'VALIDATION',
          failureCode: 'MEDIA_TOO_LARGE',
        };
      }
    }

    return { valid: true };
  }
}
