export interface AuthUrlInput {
  workspaceId: string;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
  requestedScopes?: string[];
  includeGrantedScopes?: boolean;
}

export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
}

export interface SocialProfile {
  id: string;
  name: string;
  username?: string;
  avatarUrl?: string;
}

export interface RawAccountMetrics {
  followersCount: number;
  followingCount?: number;
  viewCount?: number;
  engagement?: number;
}

export interface PostRef {
  id: string;
  externalId: string;
}

export interface RawPostMetrics {
  likes: number;
  comments: number;
  shares?: number;
  impressions?: number;
}

export interface PublishPayload {
  text: string;
  mediaUrls?: string[];
}

export interface PublishResult {
  externalPostId: string;
  url?: string;
}

export type Capability =
  | 'ANALYTICS_READ'
  | 'ACCOUNT_READ'
  | 'POST_READ'
  | 'POST_PUBLISH'
  | 'POST_SCHEDULE'
  | 'COMMENTS'
  | 'DMS'
  | 'WEBHOOKS';

export type ProviderCapabilities = Capability[];

export interface CapabilityContext {
  provider: string;
  accountType?: string;
  grantedScopes: string[];
  pendingApproval?: boolean;
  lastApiResponse?: any;
  externalId?: string;
}

export interface WebhookRequest {
  headers: Record<string, string>;
  body: any;
}

export interface NormalizedWebhookEvent {
  type: string;
  payload: any;
  timestamp: Date;
}

