# Phase 7.4 — Publishability Validation

## Responsibility Boundary
The `PublishabilityValidator` is the authoritative core domain service that determines whether a `PostPlatformVariant` is safe and valid to execute a provider publish attempt. It strictly handles validation before execution and does not execute any API calls or mutate state. It evaluates the tenant ownership, capability constraints, and options.

## Validation Pipeline
1. **Tenant Loading:** Loads target variant safely bounded by `workspaceId`.
2. **State Eligibility:** Verifies `status`. `UNKNOWN` is rejected for reconciliation. 
3. **Account Status:** Verifies `ACTIVE`.
4. **Adapter Capability Check:** Ensures current app adapter supports publishing via `ProviderRegistry`.
5. **Content Classification:** Determines capability category (`TEXT_POST`, `VIDEO_POST`, etc.) based on media properties.
6. **Capability Constraints:** Checks generic limits (e.g. `maxCount`, `maxBytes`, `mimeTypes`).
7. **Media Consistency:** Validates media tenant ownership and basic readiness.
8. **Provider Options:** Defers to `validateProviderOptions` on the Publishing Adapter for schema compliance.
9. **Scheduling Check:** Validates `scheduledAt` is present and in the future for `SCHEDULED` status.

## Issue Codes
Validation results are normalized into structured arrays of issues (`valid: boolean; issues: PublishabilityIssue[]`).

Stable Codes:
- `TARGET_NOT_FOUND`
- `PUBLICATION_STATE_INVALID`
- `ACCOUNT_NOT_ACTIVE`
- `PROVIDER_PUBLISHING_UNSUPPORTED`
- `CONTENT_TYPE_UNSUPPORTED`
- `MEDIA_WORKSPACE_MISMATCH`
- `MEDIA_TYPE_UNSUPPORTED`
- `MEDIA_TOO_LARGE`
- `MEDIA_COUNT_EXCEEDED`
- `MEDIA_NOT_READY`
- `PROVIDER_OPTION_INVALID`
- `SCHEDULE_REQUIRED`
- `SCHEDULE_IN_PAST`

## State Eligibility
- **DRAFT, SCHEDULED:** Valid for initial.
- **FAILED:** Valid for retry.
- **PUBLISHING, PUBLISHED:** Rejected.
- **UNKNOWN:** Rejected (requires manual reconciliation).

## No-Side-Effects Guarantee
The validator does not alter state, queue jobs, refresh tokens, or communicate with external providers.

## Worker Revalidation Requirement
Because validation represents a snapshot-in-time check, the future execution worker MUST defensively re-evaluate critical conditions (e.g. account active status, state) immediately before firing the external request, since those could drift between scheduling and execution.
