import { SocialProvider } from '@agency-os/database';
import { OAuthCredentials, SocialProfile } from '@agency-os/providers';

export type OAuthCallbackResult =
  | {
      requiresSelection: false;
      workspaceId: string;
      socialAccountId: string;
      isNew: boolean;
    }
  | { requiresSelection: true; workspaceId: string; discoveryId: string };

export interface DiscoveredOAuthProfile {
  profile: SocialProfile;
  credentials?: OAuthCredentials;
}

export interface DiscoverySession {
  discoveryId: string;
  workspaceId: string;
  userId: string;
  provider: SocialProvider;
  sharedCredentials: OAuthCredentials;
  profiles: DiscoveredOAuthProfile[];
  createdAt: number;
}
