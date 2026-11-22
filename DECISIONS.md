# Architecture & Product Decision Records

## ADR 001: Restrict `billing.view` Permission to Internal Agency Roles (`OWNER`, `MANAGER`, `EDITOR`)

### Context
In the original API Permission Matrix (`apps/api/src/modules/auth/guards/permission.guard.ts`), `billing.view` was granted to all 5 workspace roles: `['OWNER', 'MANAGER', 'EDITOR', 'CLIENT_APPROVER', 'VIEWER']`.
However, `billing.view` gates access to sensitive business data:
1. Workspace subscription status and tier (Solo, Studio, Agency, Founding rates).
2. Internal agency software costs and billing intervals.
3. Official GST tax invoices containing enterprise details, registered business names, and financial breakdowns.

`CLIENT_APPROVER` is specifically designed for external clients to review, approve, or request changes on draft publications before they go live. `VIEWER` is an external/read-only role. Exposing agency subscription pricing, GST records, and invoice histories to external clients or read-only guests is inappropriate and leaks commercial agency terms.

### Decision
Update the API `PermissionMatrix` for `billing.view` from:
```typescript
'billing.view': ['OWNER', 'MANAGER', 'EDITOR', 'CLIENT_APPROVER', 'VIEWER'],
```
to:
```typescript
'billing.view': ['OWNER', 'MANAGER', 'EDITOR'],
```
Mirror this in the web frontend:
- `canViewBilling(role)` in `apps/web/src/lib/permissions.ts` returns `true` only for `OWNER`, `MANAGER`, `EDITOR`.
- Navigation sidebar hides the Billing link for `CLIENT_APPROVER` and `VIEWER`.
- Directly navigating to `/[workspaceId]/billing` displays an access-denied state and avoids querying billing endpoints.

### Consequences
- External client approvers and viewers can no longer inspect agency platform pricing or download enterprise GST invoices.
- `billing.view` permission checks on `/workspaces/:workspaceId/billing/*` return HTTP 403 Forbidden for `CLIENT_APPROVER` and `VIEWER`.
- Full backwards compatibility is preserved for `OWNER`, `MANAGER`, and `EDITOR`.

## ADR 002: Client Layer: Multi-Client Grouping, Scoped Client-Approver Visibility, and Per-Client White-Label Report Branding

### Context
Agencies hold many clients' social accounts in a single workspace while billing remains at the workspace level. Previously, accounts in a workspace were a flat pool, a `CLIENT_APPROVER` saw all accounts, posts, and analytics in the workspace, and white-label report branding existed only per-workspace.
The client layer organizes accounts by client, allows scoping client approvers to specific clients, and enables per-client report branding.

### Decision
1. **New `Client` Entity**: Added per workspace with `name`, `brandDisplayName`, `brandLogoUrl`, `brandAccentColor`.
2. **Account Assignment**: `SocialAccount.clientId` is nullable; accounts can belong to a client or remain unassigned.
3. **Approver Scoping**: `WorkspaceMember.clientId` applies strictly to `CLIENT_APPROVER` members. Any other role (or unscoped approver with `clientId == null`) maintains workspace-wide visibility.
4. **Post Visibility**: A scoped approver can see a post if and only if at least one platform variant targets an account belonging to their assigned client. Draft posts without assigned account targets are invisible to scoped approvers.
5. **Out-of-Scope Isolation**: Accessing an out-of-scope account, post, or analytics by a scoped approver returns HTTP 404 NotFound (never 403, never leaking metadata).
6. **Deletion Safety**: Deleting a client that still has scoped approvers assigned is rejected with HTTP 409 Conflict (`"Remove or reassign this client's approver first."`). When approvers are removed, account foreign keys are set to NULL via `onDelete: SetNull`.
7. **Report Branding Fallback**: Report header branding follows: Client branding (`client.brandDisplayName`) -> Workspace branding (`workspace.brandDisplayName`) -> Platform default. White-label rules ensure platform branding is fully stripped when client or workspace branding is set.
8. **No Client Count Cap in v1**: No plan gating or billing modifications are introduced in v1.

### Consequences
- Agencies can securely invite client approvers restricted strictly to their own brand's accounts and publications.
- Client white-label reports can be generated per client or per account with distinct branding.
- Full backwards compatibility is retained for existing unscoped members and accounts.
