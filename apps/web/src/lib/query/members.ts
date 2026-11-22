import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client";

export type WorkspaceRoleType =
  "OWNER" | "MANAGER" | "EDITOR" | "CLIENT_APPROVER" | "VIEWER";

export interface WorkspaceMemberItem {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  role: WorkspaceRoleType;
  clientId?: string | null;
  clientName?: string | null;
  joinedAt: string;
}

export interface WorkspaceInvitationItem {
  id: string;
  email: string;
  role: WorkspaceRoleType;
  clientId?: string | null;
  clientName?: string | null;
  expiresAt: string;
  createdAt: string;
  invitedBy: {
    id: string;
    name: string | null;
    email: string;
  };
}

export interface WorkspaceMembersResponse {
  members: WorkspaceMemberItem[];
  invitations?: WorkspaceInvitationItem[];
}

export interface InvitationInfoResponse {
  workspaceName: string;
  email: string;
  role: WorkspaceRoleType;
  roleFormatted: string;
  expiresAt: string;
}

export const membersQueries = {
  list: (workspaceId: string) =>
    queryOptions({
      queryKey: ["workspaces", workspaceId, "members"],
      queryFn: () =>
        api.get<WorkspaceMembersResponse>(`workspaces/${workspaceId}/members`),
      enabled: !!workspaceId,
    }),
  invitationInfo: (token: string) =>
    queryOptions({
      queryKey: ["invitations", "info", token],
      queryFn: () =>
        api.get<InvitationInfoResponse>(
          `invitations/info?token=${encodeURIComponent(token)}`,
        ),
      enabled: !!token,
      retry: false,
    }),
};
