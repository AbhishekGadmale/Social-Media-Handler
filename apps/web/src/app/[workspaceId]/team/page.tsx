"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authQueries } from "../../../lib/query/auth";
import { clientQueries } from "../../../lib/query/clients";
import {
  membersQueries,
  WorkspaceRoleType,
  WorkspaceMemberItem,
  WorkspaceInvitationItem,
} from "../../../lib/query/members";
import { api, ApiError } from "../../../lib/api/client";
import {
  Users,
  UserPlus,
  Mail,
  Trash2,
  RefreshCw,
  XCircle,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";

const ROLES: { value: WorkspaceRoleType; label: string; helper?: string }[] = [
  {
    value: "OWNER",
    label: "Owner",
    helper: "Full control over workspace and billing",
  },
  {
    value: "MANAGER",
    label: "Manager",
    helper: "Can manage accounts, members, and content",
  },
  {
    value: "EDITOR",
    label: "Editor",
    helper: "Can create, edit, and schedule posts",
  },
  {
    value: "CLIENT_APPROVER",
    label: "Client Approver",
    helper: "Can approve posts, cannot publish",
  },
  {
    value: "VIEWER",
    label: "Viewer",
    helper: "Read-only access across workspace",
  },
];

function getRoleBadge(role: WorkspaceRoleType) {
  switch (role) {
    case "OWNER":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
          Owner
        </span>
      );
    case "MANAGER":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
          Manager
        </span>
      );
    case "EDITOR":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          Editor
        </span>
      );
    case "CLIENT_APPROVER":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          Client Approver
        </span>
      );
    case "VIEWER":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
          Viewer
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
          {role}
        </span>
      );
  }
}

export default function TeamPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const workspaceId = (params?.workspaceId as string) || "";

  // Auth & Permissions context
  const { data: authData, isLoading: isAuthLoading } = useQuery(
    authQueries.me(),
  );
  const currentMembership = authData?.memberships?.find(
    (m) => m.workspaceId === workspaceId,
  );
  const currentUserId = authData?.user?.id;
  const currentUserRole = currentMembership?.role as
    WorkspaceRoleType | undefined;
  const canManageMembers =
    currentUserRole === "OWNER" || currentUserRole === "MANAGER";
  const isOwner = currentUserRole === "OWNER";

  // Members Query
  const {
    data: membersData,
    isLoading: isMembersLoading,
    error: membersError,
  } = useQuery(membersQueries.list(workspaceId));

  // Clients Query (for client-approver scoping)
  const { data: clientsData } = useQuery({
    ...clientQueries.list(workspaceId),
    enabled: !!workspaceId && canManageMembers,
  });
  const clients = clientsData?.clients || [];

  // Form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRoleType>("EDITOR");
  const [inviteClientId, setInviteClientId] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Row action feedback state
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Invite Mutation
  const inviteMutation = useMutation({
    mutationFn: (payload: {
      email: string;
      role: WorkspaceRoleType;
      clientId?: string;
    }) => api.post(`workspaces/${workspaceId}/members/invitations`, payload),
    onSuccess: () => {
      setInviteEmail("");
      setInviteRole("EDITOR");
      setInviteClientId("");
      setInviteSuccess("Invitation sent successfully.");
      setInviteError(null);
      queryClient.invalidateQueries({
        queryKey: membersQueries.list(workspaceId).queryKey,
      });
    },
    onError: (err: unknown) => {
      setInviteSuccess(null);
      if (err instanceof ApiError) {
        setInviteError(err.message || "Failed to send invitation");
      } else {
        setInviteError("An unexpected error occurred.");
      }
    },
  });

  // Revoke Mutation
  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) =>
      api.post(
        `workspaces/${workspaceId}/members/invitations/${invitationId}/revoke`,
      ),
    onSuccess: () => {
      setActionSuccess("Invitation revoked.");
      setActionError(null);
      queryClient.invalidateQueries({
        queryKey: membersQueries.list(workspaceId).queryKey,
      });
    },
    onError: (err: unknown) => {
      setActionSuccess(null);
      setActionError(
        err instanceof ApiError ? err.message : "Failed to revoke invitation",
      );
    },
  });

  // Resend Mutation
  const resendMutation = useMutation({
    mutationFn: (invitationId: string) =>
      api.post(
        `workspaces/${workspaceId}/members/invitations/${invitationId}/resend`,
      ),
    onSuccess: () => {
      setActionSuccess("Invitation resent.");
      setActionError(null);
      queryClient.invalidateQueries({
        queryKey: membersQueries.list(workspaceId).queryKey,
      });
    },
    onError: (err: unknown) => {
      setActionSuccess(null);
      setActionError(
        err instanceof ApiError ? err.message : "Failed to resend invitation",
      );
    },
  });

  // Update Role Mutation
  const updateRoleMutation = useMutation({
    mutationFn: ({
      memberId,
      role,
      clientId,
    }: {
      memberId: string;
      role: WorkspaceRoleType;
      clientId?: string | null;
    }) =>
      api.patch(`workspaces/${workspaceId}/members/${memberId}`, {
        role,
        ...(clientId !== undefined ? { clientId } : {}),
      }),
    onSuccess: () => {
      setActionSuccess("Member role updated.");
      setActionError(null);
      queryClient.invalidateQueries({
        queryKey: membersQueries.list(workspaceId).queryKey,
      });
    },
    onError: (err: unknown) => {
      setActionSuccess(null);
      setActionError(
        err instanceof ApiError ? err.message : "Failed to update member role",
      );
    },
  });

  // Remove Member Mutation
  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      api.delete(`workspaces/${workspaceId}/members/${memberId}`),
    onSuccess: () => {
      setActionSuccess("Member removed from workspace.");
      setActionError(null);
      queryClient.invalidateQueries({
        queryKey: membersQueries.list(workspaceId).queryKey,
      });
    },
    onError: (err: unknown) => {
      setActionSuccess(null);
      setActionError(
        err instanceof ApiError ? err.message : "Failed to remove member",
      );
    },
  });

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    if (!inviteEmail || !inviteEmail.trim()) {
      setInviteError("Please provide a valid email address.");
      return;
    }
    inviteMutation.mutate({
      email: inviteEmail.trim(),
      role: inviteRole,
      clientId:
        inviteRole === "CLIENT_APPROVER" && inviteClientId
          ? inviteClientId
          : undefined,
    });
  };

  const members = membersData?.members || [];
  const invitations = membersData?.invitations || [];
  const ownerCount = members.filter((m) => m.role === "OWNER").length;

  if (isAuthLoading || isMembersLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto flex items-center justify-center min-h-[300px]">
        <div className="text-gray-500 text-sm font-medium animate-pulse">
          Loading team members...
        </div>
      </div>
    );
  }

  if (membersError) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 flex items-center">
          <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0" />
          <span>
            {membersError instanceof ApiError
              ? membersError.message
              : "Failed to load team members."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="border-b border-gray-200 pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Team & Members
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage workspace members, assign role permissions, and track active
          invitations.
        </p>
      </div>

      {/* Global Action Notifications */}
      {actionSuccess && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800 flex items-center justify-between">
          <div className="flex items-center">
            <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-600 flex-shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button
            onClick={() => setActionSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800 flex items-center justify-between">
          <div className="flex items-center">
            <AlertCircle className="w-4 h-4 mr-2 text-red-600 flex-shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-red-700 hover:text-red-900 text-xs font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Invite Member Section (Only for members.manage: OWNER and MANAGER) */}
      {canManageMembers && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <UserPlus className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-semibold text-gray-900">
                Invite New Member
              </h2>
            </div>
          </div>

          <form onSubmit={handleInviteSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
              <div className="md:col-span-6 space-y-1">
                <label
                  htmlFor="invite-email"
                  className="block text-xs font-medium text-gray-700 uppercase tracking-wider"
                >
                  Email Address
                </label>
                <div className="relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@example.com"
                    required
                    className="block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="md:col-span-4 space-y-1">
                <label
                  htmlFor="invite-role"
                  className="block text-xs font-medium text-gray-700 uppercase tracking-wider"
                >
                  Role
                </label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => {
                    const newRole = e.target.value as WorkspaceRoleType;
                    setInviteRole(newRole);
                    if (newRole !== "CLIENT_APPROVER") {
                      setInviteClientId("");
                    }
                  }}
                  className="block w-full py-2 px-3 border border-gray-300 bg-white rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {ROLES.map((r) => {
                    const isOwnerOption = r.value === "OWNER";
                    const disabled = isOwnerOption && !isOwner;
                    return (
                      <option key={r.value} value={r.value} disabled={disabled}>
                        {r.label} {disabled ? "(Owner only)" : ""}
                      </option>
                    );
                  })}
                </select>
                {inviteRole === "CLIENT_APPROVER" && (
                  <p className="text-xs text-amber-600 font-medium mt-1">
                    Can approve posts, cannot publish
                  </p>
                )}
              </div>

              {inviteRole === "CLIENT_APPROVER" && (
                <div className="md:col-span-12 space-y-1">
                  <label
                    htmlFor="invite-client"
                    className="block text-xs font-medium text-gray-700 uppercase tracking-wider"
                  >
                    Client Scope
                  </label>
                  <select
                    id="invite-client"
                    aria-label="Client Scope"
                    value={inviteClientId}
                    onChange={(e) => setInviteClientId(e.target.value)}
                    className="block w-full max-w-xs py-2 px-3 border border-gray-300 bg-white rounded-md text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">No client selected</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500">
                    No client selected: this approver will see all clients in
                    this workspace.
                  </p>
                </div>
              )}

              <div className="md:col-span-2 md:pt-6">
                <button
                  type="submit"
                  disabled={inviteMutation.isPending}
                  className="w-full inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {inviteMutation.isPending ? "Sending..." : "Send Invite"}
                </button>
              </div>
            </div>

            {inviteSuccess && (
              <p className="text-sm text-emerald-600 font-medium">
                {inviteSuccess}
              </p>
            )}
            {inviteError && (
              <p className="text-sm text-red-600 font-medium">{inviteError}</p>
            )}
          </form>
        </div>
      )}

      {/* Workspace Members Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5 text-gray-700" />
            <h2 className="text-base font-semibold text-gray-900">
              Workspace Members ({members.length})
            </h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs font-medium uppercase tracking-wider">
              <tr>
                <th scope="col" className="px-6 py-3">
                  Member
                </th>
                <th scope="col" className="px-6 py-3">
                  Role
                </th>
                <th scope="col" className="px-6 py-3">
                  Joined
                </th>
                {canManageMembers && (
                  <th scope="col" className="px-6 py-3 text-right">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {members.map((member: WorkspaceMemberItem) => {
                const isTargetOwner = member.role === "OWNER";
                const isSelf = member.userId === currentUserId;
                const isLastOwner = isTargetOwner && ownerCount <= 1;

                // Hierarchy permissions
                // Only Owner can modify Owner's role
                const canModifyThisMemberRole =
                  canManageMembers &&
                  (!isTargetOwner || isOwner) &&
                  !isLastOwner;
                // Only Owner can remove Owner; last owner cannot be removed; self cannot remove
                const canRemoveThisMember =
                  canManageMembers &&
                  !isSelf &&
                  (!isTargetOwner || isOwner) &&
                  !isLastOwner;

                return (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">
                          {member.name || "Anonymous User"}
                          {isSelf && (
                            <span className="ml-2 text-xs font-normal text-gray-500">
                              (You)
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-gray-500">
                          {member.email}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1 items-start">
                        {getRoleBadge(member.role)}
                        {member.role === "CLIENT_APPROVER" && (
                          <span
                            className="text-xs text-gray-500"
                            data-testid={`member-client-${member.id}`}
                          >
                            {member.clientName
                              ? `Client: ${member.clientName}`
                              : "All clients"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                      {new Date(member.joinedAt).toLocaleDateString()}
                    </td>
                    {canManageMembers && (
                      <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                        {/* Role Change Select */}
                        <select
                          value={member.role}
                          disabled={
                            !canModifyThisMemberRole ||
                            updateRoleMutation.isPending
                          }
                          onChange={(e) => {
                            const newRole = e.target.value as WorkspaceRoleType;
                            updateRoleMutation.mutate({
                              memberId: member.id,
                              role: newRole,
                              clientId:
                                newRole === "CLIENT_APPROVER"
                                  ? member.clientId
                                  : null,
                            });
                          }}
                          aria-label={`Change role for ${member.name || member.email}`}
                          className="inline-block py-1 px-2 border border-gray-300 bg-white rounded text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:bg-gray-100"
                        >
                          {ROLES.map((r) => {
                            const isOwnerOption = r.value === "OWNER";
                            const disabled = isOwnerOption && !isOwner;
                            return (
                              <option
                                key={r.value}
                                value={r.value}
                                disabled={disabled}
                              >
                                {r.label}
                              </option>
                            );
                          })}
                        </select>

                        {/* Client Scope Select for CLIENT_APPROVER */}
                        {member.role === "CLIENT_APPROVER" &&
                          clients.length > 0 && (
                            <select
                              value={member.clientId || ""}
                              disabled={
                                !canModifyThisMemberRole ||
                                updateRoleMutation.isPending
                              }
                              onChange={(e) =>
                                updateRoleMutation.mutate({
                                  memberId: member.id,
                                  role: member.role,
                                  clientId: e.target.value
                                    ? e.target.value
                                    : null,
                                })
                              }
                              aria-label={`Assign client for ${member.name || member.email}`}
                              className="inline-block py-1 px-2 border border-gray-300 bg-white rounded text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:bg-gray-100"
                            >
                              <option value="">All clients</option>
                              {clients.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          )}

                        {/* Remove Action */}
                        <button
                          onClick={() => removeMemberMutation.mutate(member.id)}
                          disabled={
                            !canRemoveThisMember ||
                            removeMemberMutation.isPending
                          }
                          title={
                            isSelf
                              ? "You cannot remove yourself"
                              : isLastOwner
                                ? "Cannot remove the last owner"
                                : isTargetOwner && !isOwner
                                  ? "Only an owner can remove an owner"
                                  : "Remove member"
                          }
                          className="inline-flex items-center p-1 border border-transparent rounded text-red-600 hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="sr-only">Remove member</span>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Invitations Section (Only for members.manage) */}
      {canManageMembers && invitations && invitations.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Clock className="w-5 h-5 text-gray-700" />
              <h2 className="text-base font-semibold text-gray-900">
                Pending Invitations ({invitations.length})
              </h2>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs font-medium uppercase tracking-wider">
                <tr>
                  <th scope="col" className="px-6 py-3">
                    Invited Email
                  </th>
                  <th scope="col" className="px-6 py-3">
                    Role
                  </th>
                  <th scope="col" className="px-6 py-3">
                    Invited By
                  </th>
                  <th scope="col" className="px-6 py-3">
                    Expires
                  </th>
                  <th scope="col" className="px-6 py-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {invitations.map((inv: WorkspaceInvitationItem) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                      {inv.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1 items-start">
                        {getRoleBadge(inv.role)}
                        {inv.role === "CLIENT_APPROVER" && (
                          <span className="text-xs text-gray-500">
                            {inv.clientName
                              ? `Client: ${inv.clientName}`
                              : "All clients"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                      {inv.invitedBy.name || inv.invitedBy.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                      <button
                        onClick={() => resendMutation.mutate(inv.id)}
                        disabled={resendMutation.isPending}
                        className="inline-flex items-center px-2 py-1 border border-gray-300 rounded text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                      >
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Resend
                      </button>
                      <button
                        onClick={() => revokeMutation.mutate(inv.id)}
                        disabled={revokeMutation.isPending}
                        className="inline-flex items-center px-2 py-1 border border-transparent rounded text-xs font-medium text-red-600 hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
                      >
                        <XCircle className="w-3 h-3 mr-1" />
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
