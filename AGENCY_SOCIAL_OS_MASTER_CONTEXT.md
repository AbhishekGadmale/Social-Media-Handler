# Agency Social OS - Master Context

This is the definitive handoff document for Claude Code, Antigravity, OpenCode, Gemini, and future developers.

## 1. Product Vision
A multi-tenant social media management platform allowing agencies to connect client social accounts, schedule and publish posts, and track analytics across platforms.

## 2. Current Architecture
Monorepo architecture (Turborepo + pnpm) separating frontend (Next.js), backend (NestJS API), background processing (NestJS Worker via BullMQ), and shared domain logic (Prisma Database, Providers).

## 3. Monorepo Map
- `apps/web`: Next.js frontend application.
- `apps/api`: NestJS REST API.
- `apps/worker`: NestJS background worker (BullMQ).
- `packages/database`: Prisma schema, migrations, and repository layer.
- `packages/providers`: Abstracted social media integrations.

## 4. Current Database Models
- **Core**: `User`, `Organization`, `Workspace`, `WorkspaceMember`
- **Accounts**: `SocialAccount`, `SocialConnection`
- **Publishing**: `Post`, `PostPlatformVariant`, `PublicationAttempt`, `ExecutionMetadata`
- **Media**: `MediaAsset`, `PostMedia`
- **Analytics/Audit**: `AccountMetricDaily`, `AuditLog`, `WebhookEvent`, `SyncRun`

## 5. Tenancy, Auth, RBAC
- **Tenancy**: `WorkspaceMember` records within a `Workspace`. `WorkspaceGuard` enforces boundaries.
- **Auth/Session**: Email/password authentication yielding HTTP-only session cookies backed by Redis.
- **CSRF**: Enforced via `x-csrf-token` header matching a secure cookie.
- **RBAC**: Granular roles evaluated via `PermissionMatrix`.

## 6. Provider-Neutral Contract (`IPublishingProvider`)
Providers implement a stateless contract:
- `publish(credentials, input, context)`: Initiates publishing.
- `checkStatus?(credentials, remoteResourceId)`: Polls remote async processing status. Returns `ProviderStatusCheckResult` with status: `PROCESSING`, `READY`, `PUBLISHED`, `FAILED`, `UNKNOWN`.
- `finalizePublish?(credentials, input, remoteResourceId, context)`: Commits final remote publishing step after preparation.

**ProviderPublishContext Coordination Hooks:**
- `onRemotePrepared({ containerId })`: Informs the system of intermediate resource creation (e.g., Meta container).
- `beforeFinalMutation()`: A mandatory checkpoint function yielding a database CAS lock. This MUST be invoked immediately before the dangerous final remote network call.

**Semantic Status Map:**
- `PROCESSING`: Remote asset is still rendering/processing.
- `READY`: Remote preparation complete; final mutation still required via `finalizePublish`.
- `PUBLISHED`: Provider reports already-published remote state. (NOTE: If final ID cannot be isolated, this falls back to an AMBIGUOUS safety outcome).
- `FAILED`: Terminal remote processing error.
- `UNKNOWN`: Unrecognized state, or temporary HTTP transport timeout/5xx.

## 7. Execution Metadata & State Graph
Execution checkpoints protect against orphaned assets and dangerous duplicate publications.

**Execution Phases:**
- `INITIATED`: Worker has started execution. No remote publication mutations have occurred. Safe to retry.
- `CONTAINER_CREATED`: Provider created an intermediate remote resource (e.g., Reel container). Safe to query status.
- `PROCESSING_REMOTE`: System is async polling the provider. Worker is yielded.
- `PUBLISH_REQUESTED`: **The dangerous final publication mutation is now allowed to be issued and may already have been issued.** Automatic replay of final mutation is STRICTLY FORBIDDEN.
- `COMPLETED`: Publication successfully completed with a valid final ID.
- `FAILED`: Execution terminated due to validation or definitive remote failure.
- `AMBIGUOUS`: A dangerous remote mutation may have succeeded, but the local system cannot authoritatively confirm the final outcome. High-level variant falls back to `UNKNOWN`. Never automatically replay.

**Legal State Transitions (`ALLOWED_TRANSITIONS`):**
- `INITIATED` -> `CONTAINER_CREATED`, `PUBLISH_REQUESTED`, `COMPLETED`, `FAILED`
- `CONTAINER_CREATED` -> `PROCESSING_REMOTE`, `PUBLISH_REQUESTED`, `FAILED`
- `PROCESSING_REMOTE` -> `PROCESSING_REMOTE`, `PUBLISH_REQUESTED`, `COMPLETED`, `FAILED`

*(Explicitly illegal: `INITIATED` -> `PROCESSING_REMOTE`)*

**DispatchVersion CAS Semantics:**
`dispatchVersion` acts as a row-level compare-and-swap mechanism. Every state transition verifies the expected version, increments it atomically, and hands it forward. A rejection raises `ProviderCoordinationError` and immediately halts execution (prevents racing duplicate processes). It is NOT a bulletproof exactly-once guarantee.

## 8. Identifier Semantics
- `containerId` / `remoteResourceId`: Intermediate resource tracking ID during remote processing (e.g., Meta IG Container, YouTube upload ID before processing check).
- `finalRemoteId` / `externalPostId`: The authoritative completed publication identity on the social network. Do NOT use container IDs as finalRemoteIds.
- `operationId`: Internal idempotent tracking UUID spanning logical checkpoints.
- `dispatchVersion`: CAS integer for execution metadata mutations.

## 9. Async Continuation Model
`PROCESSING_REMOTE` does NOT mean a worker thread sleeps.
1. State and `nextCheckAt` are persisted.
2. The worker function returns naturally.
3. A separate dispatcher routinely scans the DB for due operations.
4. BullMQ schedules a continuation job.
5. Continuation strictly executes `checkStatus()` read-only polling logic.

## 10. PublicationAttempt Semantics
`PublicationAttempt` represents a logical user execution history.
`PROCESSING_REMOTE` continuation polling must NOT create new `PublicationAttempt` rows per poll. One logical publish stays one logical attempt.

## 11. Coordination Errors
`ProviderCoordinationError` represents LOCAL coordination failures (missing checkpoint hooks, stale `dispatchVersion`, CAS rejections). They are NOT provider HTTP transient errors. Providers remain database-agnostic.

## 12. Current Provider Flows

### Instagram Image
- Canonical final-mutation checkpoint model.
- Container creation -> `onRemotePrepared` -> container persistence.
- `beforeFinalMutation` -> `PUBLISH_REQUESTED` -> `/{ig-user-id}/media_publish`.
- Yields final ID.

### Instagram Reels
- `INITIATED` -> `CONTAINER_CREATED` -> `PROCESSING_REMOTE` -> `PROCESSING_REMOTE` (0..N) -> `PUBLISH_REQUESTED` -> `COMPLETED`.
- `checkStatus()` converts `FINISHED` -> `READY`.
- `READY` calls `finalizePublish()`.
- `finalizePublish()` calls `beforeFinalMutation()` to transition to `PUBLISH_REQUESTED`.
- Finally, issues `/media_publish`.

### Facebook
- Direct final-mutation checkpoint model. No intermediate async processing.

### YouTube
- `INITIATED` -> `PUBLISH_REQUESTED` -> `youtube.videos.insert` -> `PROCESSING_REMOTE` -> `PROCESSING_REMOTE` (polling) -> `COMPLETED`.
- Publish happens exactly once per normal operation.
- Continuation uses `checkStatus()` only.
- `remoteResourceId` is the stable YouTube video ID. Polling does not re-upload.

### LinkedIn
- `INITIATED` -> `PUBLISH_REQUESTED` -> `POST /rest/posts` -> `COMPLETED`.
- Asset preparation occurs before final post creation (preparation idempotency not proven).
- Unknown final network result defaults to `AMBIGUOUS` execution and `UNKNOWN` variant.

## 13. Current Provider Status Matrix

| Provider | Content Type | Preparation | Async Processing | Final Checkpoint | Status Polling | Finalization | Known Risk |
|---|---|---|---|---|---|---|---|
| Instagram Image | Image | Yes | No | Yes | No | Yes | Ambiguity |
| Instagram Reel | Video | Yes | Yes | Yes | Yes | Yes | Ambiguity, Orphan |
| Facebook | Text/Image/Video | Yes | No | Yes | No | No | Ambiguity |
| YouTube | Video | No | Yes | Yes | Yes | No | - |
| LinkedIn | Text/Image/Video/Doc | Yes | No | Yes | No | No | Preparation Idempotency |

## 14. Current Known Risks
1. **Instagram Reels initial /media unknown-outcome window**: Possible orphan/duplicate preparation containers if network dies precisely during creation.
2. **Container creation idempotency**: NOT PROVEN across providers.
3. **LinkedIn preparation idempotency/orphan cleanup**: NOT PROVEN.
4. **Real Redis/BullMQ race behavior**: NOT EXECUTED / ENVIRONMENT-BLOCKED. Relying on mocks/DB transactions currently.
5. **Generic DB polling scan scalability**: Current MVP design may require indexed scheduling before significant scale.
6. **No exactly-once guarantee**: The system does NOT guarantee exactly-once publishing. Checkpointed dangerous final mutations are protected against blind automatic duplicate retry, and uncertain outcomes are represented conservatively as AMBIGUOUS / UNKNOWN.
7. **Provider reconciliation**: Providers reporting already-published remote resources (but lacking identifiable IDs) will conservatively fallback to `AMBIGUOUS/UNKNOWN`.

## 15. Current Test Evidence
Verified Baseline: `033c2b52007f1585e57c123b4e039da101b40404`

- **Providers**: 14 files / 202 tests PASS
- **Worker**: 7 files / 63 tests PASS
- **Database**: 9 files / 73 tests PASS
- **API**: 13 files / 82 tests PASS
- **Web**: 4 files / 44 tests PASS
- **Turbo Matrix** (test, lint, typecheck): PASS
- **Real PostgreSQL state-graph tests**: PASS
- **Real Redis/BullMQ**: NOT EXECUTED / ENVIRONMENT-BLOCKED

*(Note: These reflect the evidence at the above checkpoint, not eternal guarantees).*

## 16. Current Implementation Status
Publishing capabilities implemented:
- Instagram image publishing
- Instagram Reel/video publishing
- Facebook publishing
- YouTube publishing
- LinkedIn publishing

Checkpoint safety adopted for:
- Instagram image final mutation
- Facebook final mutation
- YouTube upload mutation + processing continuation
- LinkedIn final post mutation
- Instagram Reels async preparation + final mutation

**Explicitly Unsupported Features (DO NOT CLAIM):**
- Instagram carousel
- Instagram Stories
- Facebook Reels
- TikTok
