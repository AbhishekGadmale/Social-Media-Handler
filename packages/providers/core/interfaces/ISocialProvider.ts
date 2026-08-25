import {
  AuthUrlInput,
  OAuthCredentials,
  SocialProfile,
  RawAccountMetrics,
  PostRef,
  RawPostMetrics,
  PublishPayload,
  PublishResult,
  CapabilityContext,
  ProviderCapabilities,
  WebhookRequest,
  NormalizedWebhookEvent,
} from '../types/index.js';

export interface ISocialProvider {
  getAuthorizationUrl(input: AuthUrlInput): string;
  exchangeAuthorizationCode(input: { code: string; redirectUri: string; codeVerifier?: string }): Promise<OAuthCredentials>;
  getProfiles(credentials: OAuthCredentials): Promise<SocialProfile[]>;
  getAccountMetrics?(credentials: OAuthCredentials, account: SocialProfile): Promise<RawAccountMetrics>;
  getPostMetrics?(credentials: OAuthCredentials, post: PostRef): Promise<RawPostMetrics>;
  publishPost?(credentials: OAuthCredentials, payload: PublishPayload): Promise<PublishResult>;
  deletePost?(credentials: OAuthCredentials, externalPostId: string): Promise<void>;
  getCapabilities?(context: CapabilityContext): Promise<ProviderCapabilities>;
  handleWebhook?(request: WebhookRequest): Promise<NormalizedWebhookEvent>;
}

