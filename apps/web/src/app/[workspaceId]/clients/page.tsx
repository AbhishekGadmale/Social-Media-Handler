"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authQueries } from "../../../lib/query/auth";
import { canViewClients, canManageClients } from "../../../lib/permissions";
import {
  clientQueries,
  clientMutations,
  ClientItem,
  CreateClientPayload,
  UpdateClientPayload,
} from "../../../lib/query/clients";
import { ApiError } from "../../../lib/api/client";
import {
  Building2,
  Plus,
  Edit2,
  Trash2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Users,
  Share2,
  X,
} from "lucide-react";
import { Button } from "../../../components/ui/button";

export default function ClientsPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const workspaceId = (params?.workspaceId as string) || "";

  const { data: authData, isLoading: isAuthLoading } = useQuery(
    authQueries.me(),
  );
  const currentMembership = authData?.memberships?.find(
    (m) => m.workspaceId === workspaceId,
  );
  const currentRole = currentMembership?.role;
  const canView = canViewClients(currentRole);
  const canManage = canManageClients(currentRole);

  const {
    data: clientsData,
    isLoading: isClientsLoading,
    error: clientsError,
    refetch,
  } = useQuery(clientQueries.list(workspaceId));

  // Modal / Form state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientItem | null>(null);
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null);

  // Form inputs
  const [formData, setFormData] = useState<{
    name: string;
    brandDisplayName: string;
    brandLogoUrl: string;
    brandAccentColor: string;
  }>({
    name: "",
    brandDisplayName: "",
    brandLogoUrl: "",
    brandAccentColor: "",
  });

  // Action status banners
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const openCreateModal = () => {
    setFormData({
      name: "",
      brandDisplayName: "",
      brandLogoUrl: "",
      brandAccentColor: "",
    });
    setFormError(null);
    setIsCreateOpen(true);
  };

  const openEditModal = (client: ClientItem) => {
    setEditingClient(client);
    setFormData({
      name: client.name,
      brandDisplayName: client.brandDisplayName || "",
      brandLogoUrl: client.brandLogoUrl || "",
      brandAccentColor: client.brandAccentColor || "",
    });
    setFormError(null);
  };

  const createMutation = useMutation({
    mutationFn: (payload: CreateClientPayload) =>
      clientMutations.create(workspaceId, payload),
    onSuccess: () => {
      setIsCreateOpen(false);
      setActionSuccess("Client created successfully.");
      setActionError(null);
      queryClient.invalidateQueries({
        queryKey: clientQueries.list(workspaceId).queryKey,
      });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setFormError(err.message || "Failed to create client.");
      } else {
        setFormError("An unexpected error occurred.");
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      clientId,
      payload,
    }: {
      clientId: string;
      payload: UpdateClientPayload;
    }) => clientMutations.update(workspaceId, clientId, payload),
    onSuccess: () => {
      setEditingClient(null);
      setActionSuccess("Client updated successfully.");
      setActionError(null);
      queryClient.invalidateQueries({
        queryKey: clientQueries.list(workspaceId).queryKey,
      });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setFormError(err.message || "Failed to update client.");
      } else {
        setFormError("An unexpected error occurred.");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (clientId: string) =>
      clientMutations.delete(workspaceId, clientId),
    onSuccess: () => {
      setDeletingClientId(null);
      setActionSuccess("Client deleted successfully.");
      setActionError(null);
      queryClient.invalidateQueries({
        queryKey: clientQueries.list(workspaceId).queryKey,
      });
    },
    onError: (err: unknown) => {
      setDeletingClientId(null);
      if (err instanceof ApiError) {
        setActionError(err.message || "Failed to delete client.");
      } else {
        setActionError("Failed to delete client.");
      }
    },
  });

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formData.name.trim()) {
      setFormError("Client name is required.");
      return;
    }

    const payload = {
      name: formData.name.trim(),
      brandDisplayName: formData.brandDisplayName.trim() || undefined,
      brandLogoUrl: formData.brandLogoUrl.trim() || undefined,
      brandAccentColor: formData.brandAccentColor.trim() || undefined,
    };

    if (editingClient) {
      updateMutation.mutate({ clientId: editingClient.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  if (isAuthLoading || isClientsLoading) {
    return (
      <div
        className="p-8 max-w-6xl mx-auto flex items-center justify-center min-h-[300px]"
        role="status"
        aria-label="Loading clients"
      >
        <div className="text-gray-500 text-sm font-medium animate-pulse flex items-center">
          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          Loading clients...
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex flex-col items-center text-center">
          <AlertCircle
            className="w-10 h-10 text-red-500 mb-3"
            aria-hidden="true"
          />
          <h3 className="text-lg font-medium text-red-800">Access Denied</h3>
          <p className="mt-2 text-sm text-red-700 max-w-md">
            You do not have permission to view clients in this workspace.
            Clients are managed by your agency.
          </p>
        </div>
      </div>
    );
  }

  if (clientsError) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 flex items-center justify-between">
          <div className="flex items-center">
            <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0" />
            <span>
              {clientsError instanceof ApiError
                ? clientsError.message
                : "Failed to load clients."}
            </span>
          </div>
          <button
            onClick={() => refetch()}
            className="text-xs font-semibold underline hover:text-red-900"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const clients = clientsData?.clients || [];

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="border-b border-gray-200 pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Clients
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Organize social accounts by client, manage client approver
            visibility, and configure white-label branding.
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreateModal} className="flex items-center">
            <Plus className="w-4 h-4 mr-2" />
            New Client
          </Button>
        )}
      </div>

      {/* Action Notifications */}
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

      {/* Clients List / Grid */}
      {clients.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-12 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <Building2 className="w-8 h-8 text-gray-400" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No clients yet</h3>
          <p className="mt-2 text-sm text-gray-500 max-w-sm">
            Create your first client to group accounts, scope approver access,
            and set white-label report branding.
          </p>
          {canManage && (
            <div className="mt-6">
              <Button onClick={openCreateModal}>
                <Plus className="w-4 h-4 mr-2" />
                New Client
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          aria-label="Clients list"
        >
          {clients.map((client) => (
            <div
              key={client.id}
              className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col justify-between space-y-4"
              data-testid={`client-card-${client.id}`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    {client.brandLogoUrl ? (
                      <img
                        src={client.brandLogoUrl}
                        alt={`${client.name} logo`}
                        className="w-10 h-10 rounded object-cover border border-gray-200"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm">
                        {client.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h3 className="font-semibold text-gray-900 text-base">
                        {client.name}
                      </h3>
                      {client.brandDisplayName && (
                        <p className="text-xs text-gray-500">
                          Brand: {client.brandDisplayName}
                        </p>
                      )}
                    </div>
                  </div>

                  {client.brandAccentColor && (
                    <div
                      className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0"
                      style={{ backgroundColor: client.brandAccentColor }}
                      title={`Accent Color: ${client.brandAccentColor}`}
                    />
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-3 text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1 bg-gray-50 px-2.5 py-1 rounded-md border border-gray-200">
                    <Share2 className="w-3.5 h-3.5 text-gray-500" />
                    {client.accountCount}{" "}
                    {client.accountCount === 1 ? "account" : "accounts"}
                  </span>
                  <span className="inline-flex items-center gap-1 bg-gray-50 px-2.5 py-1 rounded-md border border-gray-200">
                    <Users className="w-3.5 h-3.5 text-gray-500" />
                    {client.scopedMemberCount}{" "}
                    {client.scopedMemberCount === 1 ? "approver" : "approvers"}
                  </span>
                </div>
              </div>

              {canManage && (
                <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-2">
                  {deletingClientId === client.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-600 font-medium">
                        Delete client?
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs px-2"
                        onClick={() => deleteMutation.mutate(client.id)}
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending ? "Deleting..." : "Confirm"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2"
                        onClick={() => setDeletingClientId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs font-medium"
                        onClick={() => openEditModal(client)}
                      >
                        <Edit2 className="w-3.5 h-3.5 mr-1.5" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                        onClick={() => setDeletingClientId(client.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {(isCreateOpen || editingClient) && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingClient ? "Edit Client" : "New Client"}
              </h3>
              <button
                onClick={() => {
                  setIsCreateOpen(false);
                  setEditingClient(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="rounded-md bg-red-50 p-3 text-xs text-red-700 border border-red-200 flex items-center">
                <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 uppercase tracking-wider mb-1">
                  Client Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="e.g. Acme Corporation"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 uppercase tracking-wider mb-1">
                  Brand Display Name
                </label>
                <input
                  type="text"
                  value={formData.brandDisplayName}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      brandDisplayName: e.target.value,
                    })
                  }
                  placeholder="e.g. Acme Brand"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Used as header brand in client PDF reports. Overrides
                  workspace branding.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 uppercase tracking-wider mb-1">
                  Brand Logo URL
                </label>
                <input
                  type="url"
                  value={formData.brandLogoUrl}
                  onChange={(e) =>
                    setFormData({ ...formData, brandLogoUrl: e.target.value })
                  }
                  placeholder="https://example.com/logo.png"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 uppercase tracking-wider mb-1">
                  Brand Accent Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={formData.brandAccentColor}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        brandAccentColor: e.target.value,
                      })
                    }
                    placeholder="#4f46e5"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {formData.brandAccentColor && (
                    <div
                      className="w-8 h-8 rounded border border-gray-300 flex-shrink-0"
                      style={{ backgroundColor: formData.brandAccentColor }}
                    />
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setEditingClient(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                >
                  {createMutation.isPending || updateMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : null}
                  {editingClient ? "Save Changes" : "Create Client"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
