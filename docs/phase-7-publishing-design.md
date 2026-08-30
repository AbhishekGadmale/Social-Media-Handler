# Phase 7.1 — Publishing Domain & Provider Capability Design

## Skills actually loaded
None explicitly. Relied on standard architectural inspection of the repository's Prisma schema, provider interfaces, and common Node.js scaling paradigms.

## Existing architecture findings
- The `schema.prisma` already establishes a foundational aggregate separation: `Post` (the aggregate content) and `PostPlatformVariant` (the specific target).
- `PostStatus` currently holds basic states: `DRAFT`, `SCHEDULED`, `PARTIAL`, `PUBLISHED`, `FAILED`. 
- `SocialAccount` and `SocialConnection` manage secure credentials.
- `ISocialProvider` (in `packages/providers/core/interfaces/ISocialProvider.ts`) defines an optional `publishPost` method but uses a very basic `PublishPayload` string-only interface without capability declarations.
- RBAC is defined by `WorkspaceRole` (OWNER, MANAGER, EDITOR, etc.).

## Publishing terminology
- **ContentItem / Post**: The logical overarching content created by a user.
- **PublicationTarget / Variant**: A targeted destination mapped to a specific `SocialAccount` (e.g., YouTube channel).
- **PublicationAttempt**: A single discrete execution by the worker attempting to deliver the content to the provider.
- **Provider Result**: The outcome returned by the API (external ID, URL, or error payload).

## Proposed domain model
The existing schema structure is robust and conceptually aligned. We will build upon it:

```text
Post (The Core Content)
  |
  +-- PostPlatformVariant (Target: YouTube Account)
  |     |
  |     +-- PublicationAttempt (Attempt 1 - Failed: Auth)
  |     +-- PublicationAttempt (Attempt 2 - Published)
  |
  +-- PostPlatformVariant (Target: LinkedIn Account)
        |
        +-- PublicationAttempt (Attempt 1 - Published)
```
*Why this is superior:* Storing everything on a single `Post` row makes multi-account scheduling, isolated retries, and provider-specific error tracking practically impossible without heavy JSON structures. This normalized aggregate structure ensures data integrity and cleanly separates logical content from delivery executions.

## State machine
We must expand `PostStatus` to prevent worker race conditions and accurately reflect execution states.

**States:** `DRAFT`, `SCHEDULED`, `QUEUED`, `PUBLISHING`, `PUBLISHED`, `FAILED`, `UNKNOWN`, `PARTIAL` (aggregate only).

**Transitions (for a PostPlatformVariant):**
- `DRAFT` → `SCHEDULED` (Triggered by user setting a time. Side effect: sets scheduledAt).
- `DRAFT` / `SCHEDULED` → `QUEUED` (Triggered by immediate publish or scheduler. Side effect: enqueues job).
- `QUEUED` → `PUBLISHING` (Triggered by worker taking the job. Side effect: acquires execution lock).
- `PUBLISHING` → `PUBLISHED` (Triggered by successful provider result. Side effect: persists externalId).
- `PUBLISHING` → `FAILED` (Triggered by validation or provider error).
- `PUBLISHING` → `UNKNOWN` (Triggered by timeout/crash during provider API request).
- `FAILED` → `QUEUED` (Triggered by manual user retry).

*Impossible transitions prevented:* `PUBLISHED` → `DRAFT`, `QUEUED` → `SCHEDULED`, `UNKNOWN` → `PUBLISHING` (requires manual unblocking).

## Provider capability architecture
Capabilities should not be raw arrays (`['POST_PUBLISH']`), but a typed structure outlining constraints.
```ts
export interface PublishingCapabilities {
  supported: boolean;
  text: { maxLength: number; supported: boolean };
  media: {
    imagesSupported: boolean;
    maxImages: number;
    videoSupported: boolean;
    videoMaxBytes: number;
    videoMimeTypes: string[];
  };
  scheduling: { providerNative: boolean };
}
```

## Provider-specific options strategy
**Recommendation:** Typed JSON validated by discriminated shared schemas.
- `PostPlatformVariant` will contain a `providerOptions: Json?` field.
- The domain validates this JSON using Zod schemas specific to the provider (e.g., `YouTubeOptionsSchema`, `LinkedInOptionsSchema`).
- This avoids schema bloat (no need for 50 provider-specific database columns) while maintaining strict type safety before insertion.

## Media model recommendation
Establish a standalone `MediaAsset` entity scoped to the `Workspace`.
Fields: `id`, `workspaceId`, `filename`, `mimeType`, `byteSize`, `storageKey`, `createdAt`, `status`.
This decouples the business logic from underlying storage (S3/R2) and prevents cross-tenant access.

## Publishability validation design
A central `PublishabilityValidator` acts as a pure pipeline before queue insertion:
1. **Load**: Content + Target Account + Media Assets.
2. **Account Check**: Ensure account is `ACTIVE`.
3. **Capability Check**: Retrieve provider capabilities and assert media sizes/counts against provider limits.
4. **Options Check**: Validate `providerOptions` against the specific Zod schema.
5. **Result**: Throws specific error codes (`PROVIDER_CAPABILITY_UNSUPPORTED`, `MEDIA_TOO_LARGE`) preventing bad queue data.

## Immediate publishing flow
1. User clicks "Publish".
2. API validates RBAC.
3. API runs `PublishabilityValidator`.
4. DB transitions `PostPlatformVariant` to `QUEUED`.
5. API inserts lightweight identifier payload to `publish-queue` (e.g., `{ variantId }`).
6. Worker picks up job, sets status to `PUBLISHING`.
7. Worker fetches DB authoritative state, runs adapter logic.
8. Worker persists result and writes Audit Event.

## Scheduled publishing architecture
**Recommendation:** Option B (Database `scheduledAt` + periodic scheduler).
*Why:* BullMQ delayed jobs are prone to loss on redis evictions, make editing/canceling very hard, and complicate timezone updates. A database-authoritative chron poller querying `WHERE status = 'SCHEDULED' AND scheduledAt <= NOW()` is infinitely more robust, idempotent, and resilient to worker downtime.

## Idempotency strategy
- Generate a UUID `idempotencyKey` per `PublicationAttempt`. 
- Pass this to provider APIs where supported.
- For providers without idempotency keys, strict DB state machines (`QUEUED` → `PUBLISHING`) prevent concurrent duplicate executions.

## Retry taxonomy
- `TRANSIENT` (5xx): Auto-retry. Exponential backoff. Max 3 attempts.
- `RATE_LIMITED` (429): Auto-retry. Respect provider `Retry-After`.
- `AUTH_REQUIRED` (401): FAILED. State set to `REAUTH_REQUIRED`. User action required.
- `VALIDATION` (400): FAILED. Permanent. Do not auto-retry.
- `UNKNOWN_RESULT`: UNKNOWN. Do not auto-retry. Requires manual reconciliation.

## Unknown-result handling
Condition: Provider accepted upload, but connection died before HTTP response.
- Target set to `UNKNOWN`.
- A user UI banner says: "Publish status unclear. Check your social account."
- The UI offers two actions: "Mark as successful (input ID/URL)" or "Force Retry (I checked, it didn't post)".

## Multi-account / partial-success model
- One `Post` creates multiple independent `PostPlatformVariant` instances.
- Failures are completely isolated at the Variant layer.
- `Post` status is a derived aggregation: `PUBLISHED` if all variants succeeded, `PARTIAL` if mixed, `FAILED` if all failed. This aggregation is calculated on read or updated via DB triggers.

## RBAC proposal
Map to existing `WorkspaceRole`:
- `publishing.publish`, `publishing.schedule`, `publishing.retry`: **OWNER, MANAGER, EDITOR**.
- `content.create`, `content.update`: **OWNER, MANAGER, EDITOR**.
- `content.read`: **ALL ROLES** (including CLIENT_APPROVER and VIEWER).
*Do not redesign current roles.*

## Audit-event proposal
Events created via `AuditLog` entity:
- `PUBLICATION_QUEUED`, `PUBLICATION_SCHEDULED`, `PUBLICATION_SUCCEEDED`, `PUBLICATION_FAILED`.
Metadata must contain `variantId`, `provider`, and `attemptId`.
**Never store credentials or full sensitive payloads in audit metadata.**

## Provider adapter contract
```ts
interface IPublishingProvider {
  getPublishingCapabilities(): PublishingCapabilities;
  validateOptions(options: any): boolean;
  publish(input: PublishInputContext): Promise<PublishResult>;
}
```
Existing `ISocialProvider` can be extended, or `PublishingProvider` can be a sub-interface resolved through `ProviderRegistry`.

## Provider registry changes
`ProviderRegistry` will implement `getPublishingAdapter(provider: SocialProvider)`. If the provider only supports analytics (e.g., a future read-only integration), this throws `Error('PROVIDER_CAPABILITY_UNSUPPORTED')`.

## YouTube first vertical slice
**MVP Scope:** Video upload + Title + Description + Visibility (Public/Unlisted/Private).
*Out of scope for MVP:* Playlists, advanced monetization, tags, custom thumbnails.

## OAuth scope implications
Publishing to YouTube requires the `https://www.googleapis.com/auth/youtube.upload` scope.
Currently, the app likely holds read-only scopes.
**UX Impact:** Upon navigating to publishing features, users must be prompted to re-authenticate their YouTube connection to upgrade permissions. Old connections will remain active for analytics until upgraded.

## Queue architecture
A dedicated `publish` queue must be created (separate from `sync`).
*Why:* Publishing jobs (video uploads) are memory-intensive, hold connections for minutes, and have vastly different concurrency limits and retry profiles compared to rapid lightweight metric syncing.

## API contract
RESTful, workspace-isolated:
- `POST /api/v1/workspaces/:workspaceId/posts` (Create content)
- `PATCH /api/v1/workspaces/:workspaceId/posts/:postId` (Update DRAFT)
- `POST /api/v1/workspaces/:workspaceId/posts/:postId/publish` (Triggers validation & queues)
- `POST /api/v1/workspaces/:workspaceId/posts/:postId/variants/:variantId/retry`
- *Responses must return DTOs stripped of any credentials or internal Job IDs.*

## Tenant isolation
Repository layer must enforce `where: { workspaceId }` on every query involving `Post`, `PostPlatformVariant`, and `PublicationAttempt`. Variant IDs passed to APIs must strictly check parent workspace lineage.

## Security threat model
- **SSRF / Malicious URLs:** All media processing must occur within our architecture; URLs provided by users must be aggressively validated against allowed storage domains.
- **Cross-tenant access:** Enforced via repository-level workspace scoping.
- **Token leakage:** Worker pulls credentials server-side directly from DB. Payloads only contain `variantId`.
- **MIME spoofing:** File magic numbers must be validated upon upload, not just extensions.
- **Duplicate Replays:** State machine locks `QUEUED/PUBLISHING` transitions globally per variant.

## MVP anti-features
- Provider-native scheduled publishing (we use DB scheduling).
- Editing a post *after* publication.
- Complex media transformations / AI captioning.
- Auto-retries for `UNKNOWN` states.

## ADR decisions
- **ADR-001:** Enforce normalized `Post` -> `PostPlatformVariant` to enable isolated multi-account error handling.
- **ADR-002:** Implement a database-authoritative `scheduledAt` chron poller instead of BullMQ delayed jobs.
- **ADR-003:** Manage provider-specific configurations via discriminated Zod-validated JSON instead of expansive relational columns.
- **ADR-004:** Separate `publish` queue from `sync` queue due to distinct latency/concurrency profiles.

## Proposed Prisma entities (DESIGN ONLY)
```prisma
// Modified enum
enum PostStatus {
  DRAFT
  SCHEDULED
  QUEUED
  PUBLISHING
  PARTIAL
  PUBLISHED
  FAILED
  UNKNOWN
}

// New Entity
model PublicationAttempt {
  id              String   @id @db.Uuid
  variantId       String   @db.Uuid
  attemptNumber   Int
  status          String   // SUCCESS, FAILED, TIMEOUT
  failureCategory String?
  failureCode     String?
  providerResponse Json?
  startedAt       DateTime @default(now())
  completedAt     DateTime?

  variant PostPlatformVariant @relation(fields: [variantId], references: [id])
  
  @@unique([variantId, attemptNumber])
}

// New Entity
model MediaAsset {
  id          String   @id @db.Uuid
  workspaceId String   @db.Uuid
  filename    String
  mimeType    String
  byteSize    Int
  storageKey  String
  status      String
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id])
}
```

## Proposed indexes / constraints (DESIGN ONLY)
- `PublicationAttempt.variantId, PublicationAttempt.attemptNumber` (Unique constraint).
- Index on `PostPlatformVariant(status, scheduledAt)` to massively speed up the cron scheduler query.
- Foreign Key cascades to safely clean up Attempts if a Variant is deleted.

## Phase 7 implementation sequence
1. **7.1** Domain design (Complete)
2. **7.2** Prisma publishing schema updates & state machine enums.
3. **7.3** Publishing provider interfaces and capability registries.
4. **7.4** Zod schemas and `PublishabilityValidator` implementation.
5. **7.5** Publishing HTTP API endpoints (Create, update, schedule, trigger).
6. **7.6** `publish-queue` implementation, Worker Processor, and Attempt logging logic.
7. **7.7** YouTube vertical slice (OAuth scope update + Video Publish Adapter).
8. **7.8** Database-authoritative scheduled chron poller.
9. **7.9** React UI implementation (Composer, capability feedback).
10. **7.10** Failure UX (Retry, Cancel, Unknown states).

## Open decisions requiring product input
1. **Media Storage Backend:** What storage provider (S3, Cloudflare R2, Supabase Storage) should we provision for Phase 7 file handling?
2. **Video Upload Sizes:** What is the maximum acceptable raw file upload size per user tier to prevent abuse?

## Reality Checker Verdict
`DESIGN_READY`

## Next Task
`Phase 7.2 — Publishing Database Schema & State Machine`
