import { queryOptions } from '@tanstack/react-query';
import { api } from '../api/client';

export interface OAuthDiscoveryProfile {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  provider?: string;
}

export interface OAuthDiscoverySession {
  id: string;
  provider: string;
  profiles: OAuthDiscoveryProfile[];
}

export const oauthQueries = {
  discovery: (workspaceId: string, discoveryId: string) =>
    queryOptions({
      queryKey: ['workspaces', workspaceId, 'oauth', 'discoveries', discoveryId],
      queryFn: () =>
        api.get<OAuthDiscoverySession>(`workspaces/${workspaceId}/oauth/discoveries/${discoveryId}`),
      enabled: !!workspaceId && !!discoveryId,
      retry: false, // Don't retry if session is missing/expired
    }),
};

export const selectOAuthDiscoveryProfiles = (
  workspaceId: string,
  discoveryId: string,
  profileIds: string[]
) =>
  api.post<{ success: boolean }>(`workspaces/${workspaceId}/oauth/discoveries/${discoveryId}/select`, {
    profileIds,
  });
