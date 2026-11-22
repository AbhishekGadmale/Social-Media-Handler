import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client";

export interface ClientItem {
  id: string;
  workspaceId: string;
  name: string;
  brandDisplayName: string | null;
  brandLogoUrl: string | null;
  brandAccentColor: string | null;
  createdAt: string;
  updatedAt: string;
  accountCount: number;
  scopedMemberCount: number;
}

export interface ClientsResponse {
  clients: ClientItem[];
}

export interface CreateClientPayload {
  name: string;
  brandDisplayName?: string;
  brandLogoUrl?: string;
  brandAccentColor?: string;
}

export interface UpdateClientPayload {
  name?: string;
  brandDisplayName?: string;
  brandLogoUrl?: string;
  brandAccentColor?: string;
}

export const clientQueries = {
  list: (workspaceId: string) =>
    queryOptions({
      queryKey: ["workspaces", workspaceId, "clients"],
      queryFn: () =>
        api.get<ClientsResponse>(`workspaces/${workspaceId}/clients`),
      enabled: !!workspaceId,
    }),
  detail: (workspaceId: string, clientId: string) =>
    queryOptions({
      queryKey: ["workspaces", workspaceId, "clients", clientId],
      queryFn: () =>
        api.get<ClientItem>(`workspaces/${workspaceId}/clients/${clientId}`),
      enabled: !!workspaceId && !!clientId,
    }),
};

export const clientMutations = {
  create: (workspaceId: string, payload: CreateClientPayload) =>
    api.post<ClientItem>(`workspaces/${workspaceId}/clients`, payload),
  update: (
    workspaceId: string,
    clientId: string,
    payload: UpdateClientPayload,
  ) =>
    api.patch<ClientItem>(
      `workspaces/${workspaceId}/clients/${clientId}`,
      payload,
    ),
  delete: (workspaceId: string, clientId: string) =>
    api.delete<{ success: boolean }>(
      `workspaces/${workspaceId}/clients/${clientId}`,
    ),
  assignAccountClient: (
    workspaceId: string,
    accountId: string,
    clientId: string | null,
  ) =>
    api.patch(`workspaces/${workspaceId}/accounts/${accountId}/client`, {
      clientId,
    }),
};
