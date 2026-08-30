# Phase 7.2 Schema Implementation Notes

## Implemented Entities
1. **Post (Modified)**: Added `authorId` (User) and `media` (PostMedia).
2. **PostPlatformVariant (Modified)**: Added `canonicalUrl`, `providerOptions` (JsonB). Added execution tracking timestamps: `scheduledAt`, `queuedAt`, `publishingStartedAt`, `publishedAt`, `cancelledAt`.
3. **PublicationAttempt (New)**: Tracks individual provider executions. Includes `variantId`, `attemptNumber`, `status`, `failureCategory`, `failureCode`, `providerResponse`.
4. **MediaAsset (New)**: Tracks media file metadata. Includes `workspaceId`, `filename`, `mimeType`, `byteSize`, `storageKey`, `status`.
5. **PostMedia (New)**: Explicit many-to-many join table preserving sort order between `Post` and `MediaAsset`.

## Enums
1. **PostStatus (Expanded)**: `DRAFT`, `SCHEDULED`, `QUEUED`, `PUBLISHING`, `PARTIAL`, `PUBLISHED`, `FAILED`, `UNKNOWN`.
2. **FailureCategory (New)**: `TRANSIENT`, `RATE_LIMITED`, `AUTH_REQUIRED`, `VALIDATION`, `PERMANENT`, `UNKNOWN_RESULT`.

## State Machine
Pure domain state machine exported from `packages/database/src/publishing/state-machine.ts`. Transitions strictly encode the approved legal graph and protect against impossible transitions (e.g., `PUBLISHED` -> `DRAFT`).

## Indexes & Constraints
- `UNIQUE(postId, socialAccountId)` on `PostPlatformVariant` to ensure one target per post.
- `UNIQUE(variantId, attemptNumber)` on `PublicationAttempt`.
- Index `(status, scheduledAt)` on `PostPlatformVariant` to optimize the future chron scheduler poller.
- `Cascade` deletes implemented to ensure data lifecycle matches workspace deletion.

## Migration
- Name: `20260830000000_publishing_domain`
- Fully additive migration generated via `prisma migrate diff`, avoiding downtime or loss of existing operational data.

## Technical Deviations from Phase 7.1
- **CANCELLED State**: The prompt's example suggested `CANCELLED`, but Phase 7.1 defined the return of cancelled scheduled targets to `DRAFT`. The state machine implements `SCHEDULED -> DRAFT` and `QUEUED -> DRAFT` to handle cancellations.
- **Media Join Entity**: Instead of implicit many-to-many, an explicit `PostMedia` join entity was created with a `sortOrder` column to ensure predictable media ordering (crucial for carousels).
- **Attempt Idempotency Key**: Relies on the UUID `id` of `PublicationAttempt` itself to serve as the idempotency key for API executions where supported, avoiding redundant UUID columns.
