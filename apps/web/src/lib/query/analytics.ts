import { queryOptions } from '@tanstack/react-query';
import { api } from '../api/client';
import { AccountProvider, AccountStatus } from './accounts';

export interface AnalyticsOverviewResponse {
  workspaceId: string;
  accountsConnected: number;
  accountsActive: number;
  accountsRequiringReauth: number;
  totalFollowers: number;
  totalEngagement: number;
  accounts: Array<{
    id: string;
    provider: AccountProvider;
    name: string | null;
    status: AccountStatus;
    latestMetrics: {
      date: string;
      followers: number;
      engagement: number;
    } | null;
  }>;
}

export interface AccountAnalyticsResponse {
  account: {
    id: string;
    provider: AccountProvider;
    name: string | null;
    status: AccountStatus;
  };
  metrics: Array<{
    date: string;
    followers: number;
    engagement: number;
  }>;
}

export const analyticsQueries = {
  overview: (workspaceId: string) =>
    queryOptions({
      queryKey: ['workspaces', workspaceId, 'analytics', 'overview'],
      queryFn: () => api.get<AnalyticsOverviewResponse>(`workspaces/${workspaceId}/analytics/overview`),
      enabled: !!workspaceId,
    }),
  account: (workspaceId: string, accountId: string) =>
    queryOptions({
      queryKey: ['workspaces', workspaceId, 'analytics', 'accounts', accountId],
      queryFn: () => api.get<AccountAnalyticsResponse>(`workspaces/${workspaceId}/analytics/accounts/${accountId}`),
      enabled: !!workspaceId && !!accountId,
    }),
};
