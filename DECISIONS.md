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
