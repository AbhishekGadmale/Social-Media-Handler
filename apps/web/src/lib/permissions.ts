export type WorkspaceRole =
  "OWNER" | "MANAGER" | "EDITOR" | "CLIENT_APPROVER" | "VIEWER";

/**
 * Single web source of truth mirroring the API PermissionMatrix for UI decisions.
 */

export function canManageAccounts(role?: string | null): boolean {
  return role === "OWNER" || role === "MANAGER";
}

export function canPublish(role?: string | null): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "EDITOR";
}

export function canApprove(role?: string | null): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "CLIENT_APPROVER";
}

export function canManageMembers(role?: string | null): boolean {
  return role === "OWNER" || role === "MANAGER";
}

export function canManageBilling(role?: string | null): boolean {
  return role === "OWNER";
}

export function canViewBilling(role?: string | null): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "EDITOR";
}

export function canManageBranding(role?: string | null): boolean {
  return role === "OWNER" || role === "MANAGER";
}

export function canGenerateReports(role?: string | null): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "EDITOR";
}

export function canReconcile(role?: string | null): boolean {
  return role === "OWNER" || role === "MANAGER";
}

export function canViewClients(role?: string | null): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "EDITOR";
}

export function canManageClients(role?: string | null): boolean {
  return role === "OWNER" || role === "MANAGER";
}
