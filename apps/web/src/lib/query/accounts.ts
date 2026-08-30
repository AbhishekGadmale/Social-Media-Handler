import { queryOptions } from '@tanstack/react-query';
import { api } from '../api/client';

export type AccountProvider = 'YOUTUBE' | 'GOOGLE' | string;
export type AccountStatus = 'ACTIVE' | 'REAUTH_REQUIRED' | 'DISCONNECTED' | 'ERROR' | string;

export interface ConnectedAccount {
  id: string;
  workspaceId: string;
  provider: AccountProvider;
  externalId: string;
  name: string;
  capabilities: string[];
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AccountsResponse {
  accounts: ConnectedAccount[];
}

export const accountQueries = {
  list: (workspaceId: string) =>
    queryOptions({
      queryKey: ['workspaces', workspaceId, 'accounts'],
      queryFn: () => api.get<AccountsResponse>(`workspaces/${workspaceId}/accounts`),
      enabled: !!workspaceId,
    }),
};
