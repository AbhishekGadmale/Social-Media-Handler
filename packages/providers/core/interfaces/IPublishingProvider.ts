import { ZodSchema, z } from 'zod';

export type ProviderFailureCategory = 
  | 'TRANSIENT'
  | 'RATE_LIMITED'
  | 'AUTH_REQUIRED'
  | 'VALIDATION'
  | 'PERMANENT'
  | 'UNKNOWN_RESULT';

export type PublicationContentType =
  | 'TEXT_POST'
  | 'IMAGE_POST'
  | 'MULTI_IMAGE_POST'
  | 'VIDEO_POST'
  | 'LINK_POST';

export interface ContentConstraint {
  supported: boolean;
  maxLength?: number;
  maxBytes?: number;
  maxCount?: number;
  mimeTypes?: string[];
}

export interface PublishingCapabilities {
  contentTypes: Record<PublicationContentType, ContentConstraint>;
  features: string[]; // e.g. 'TITLE', 'DESCRIPTION', 'TAGS'
}

export interface ProviderValidationIssue {
  code: string;
  field?: string;
  message?: string;
}

export interface ProviderOptionsValidationResult {
  valid: boolean;
  issues: ProviderValidationIssue[];
}

export interface ProviderPublicationInput {
  attemptId: string;
  targetId: string; // The variant UUID
  workspaceId: string;
  content: string; // Normalized common content
  media?: Array<{
    url?: string;
    key?: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  providerOptions: unknown;
}

export interface ProviderPublishSuccess {
  success: true;
  externalPostId: string;
  canonicalUrl?: string;
  publishedAt?: Date;
  providerRequestId?: string;
  processingState?: 'PUBLISHED' | 'PROCESSING';
  safeMetadata?: Record<string, string | number | boolean>;
}

export interface ProviderPublishFailure {
  success: false;
  failureCategory: ProviderFailureCategory;
  failureCode: string;
  message: string;
  retryAfterSeconds?: number;
  providerRequestId?: string;
}

export type ProviderPublishResult = ProviderPublishSuccess | ProviderPublishFailure;

export interface ProviderExecutionCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface IPublishingProvider {
  /**
   * Statically describes the provider's publishing constraints and capabilities.
   */
  getPublishingCapabilities(): PublishingCapabilities;

  /**
   * Validates the provided, untyped provider options against this provider's schema.
   */
  validateProviderOptions(options: unknown): ProviderOptionsValidationResult;

  /**
   * Executes the logical publish operation. 
   * Credentials (e.g. OAuth tokens) are injected by the execution boundary, not passed in the domain input payload.
   */
  publish(
    credentials: ProviderExecutionCredentials, 
    input: ProviderPublicationInput
  ): Promise<ProviderPublishResult>;
}
