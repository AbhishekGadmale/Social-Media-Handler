import { ZodSchema, z } from 'zod';
import { IMediaContentSource } from './IMediaContentSource';

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
  | 'DOCUMENT_POST'
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
  externalAccountId: string;
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

export interface ProviderDeleteSuccess { success: true; }
export type ProviderDeleteResult = ProviderDeleteSuccess | ProviderPublishFailure;

export type ProviderPublishResult = ProviderPublishSuccess | ProviderPublishFailure;

export interface ProviderExecutionCredentials {
  accessToken: string;
}

export interface ProviderRemotePreparation {
  containerId?: string;
  // extensible for other preparation metadata later
}

export interface ProviderPublishContext {
  /**
   * Invoked when the provider has completed preliminary remote steps (e.g. creating a container).
   * Used to durably persist the container ID locally before proceeding.
   */
  onRemotePrepared?: (preparation: ProviderRemotePreparation) => Promise<void>;

  /**
   * Invoked immediately before the final non-idempotent remote mutation.
   * If this hook throws, the provider must abort and not perform the remote mutation.
   */
  beforeFinalMutation?: () => Promise<void>;
}

export interface ProviderStatusCheckResult {
  status: 'PROCESSING' | 'READY' | 'PUBLISHED' | 'FAILED' | 'UNKNOWN';
  failureCategory?: 'PERMANENT' | 'RETRYABLE' | 'UNKNOWN_RESULT' | 'RATE_LIMIT' | 'AUTH_REQUIRED' | 'MEDIA_ERROR';
  failureCode?: string;
  message?: string;
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
  deletePost?(credentials: ProviderExecutionCredentials, externalPostId: string): Promise<ProviderDeleteResult>;

  publish(
    credentials: ProviderExecutionCredentials, 
    input: ProviderPublicationInput,
    mediaSource?: IMediaContentSource,
    context?: ProviderPublishContext
  ): Promise<ProviderPublishResult>;

  finalizePublish?(credentials: ProviderExecutionCredentials, input: ProviderPublicationInput, remoteResourceId: string, context?: ProviderPublishContext): Promise<ProviderPublishResult>;

  checkStatus?(credentials: ProviderExecutionCredentials, remoteResourceId: string): Promise<ProviderStatusCheckResult>;
}
