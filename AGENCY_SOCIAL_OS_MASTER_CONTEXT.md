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
- `PROCESSING_REMOTE` -> `PROCESSING_REMOTE`, `PUBLISH_REQUESTED`, `COMPLETED`, `FAILED`, `AMBIGUOUS`

*(Explicitly illegal: `INITIATED` -> `PROCESSING_REMOTE`)*

**Concrete Use Case for PROCESSING_REMOTE -> AMBIGUOUS:**
A provider reports a remote resource is already published, but the authoritative final publication ID cannot be recovered.

**DispatchVersion & OperationId CAS Semantics:**
Continuation jobs are protected by two strict guards: `operationId` and `dispatchVersion`. A continuation job is authoritative only when BOTH match the current database state. `dispatchVersion` acts as a row-level compare-and-swap mechanism. Every state transition verifies the expected version, increments it atomically, and hands it forward. A rejection raises `ProviderCoordinationError` and immediately halts execution (prevents racing duplicate processes). A stale job returns without provider mutation and cannot overwrite a newer authoritative state. This is NOT a bulletproof exactly-once guarantee.

**Terminal Atomicity:**
Terminal resolution now occurs atomically within one Prisma transaction. Real PostgreSQL rollback tests prove that partial terminal states do not commit:
- `handleSuccess`: `executionMetadata -> COMPLETED` + `variant -> PUBLISHED` + `PublicationAttempt terminal update` inside one transaction.
- `handleFailure`: `executionMetadata -> FAILED` + `variant -> FAILED` + `PublicationAttempt update` inside one transaction.
- `handleUnknown`: `executionMetadata -> AMBIGUOUS` + `variant -> UNKNOWN` inside one transaction.

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

**Terminal nextCheckAt Cleanup:**
Transitions to `COMPLETED`, `FAILED`, or `AMBIGUOUS` explicitly clear `nextCheckAt`. Therefore, terminal rows are no longer eligible for continuation scheduling.

**Read-Only Retry Semantics:**
Temporary `checkStatus` failures, such as network timeouts or provider/HTTP 5xx errors, are read-only failures. `PROCESSING_REMOTE` remains authoritative, and a BullMQ technical retry may occur. They are NOT documented or treated immediately as `FAILED`, `AMBIGUOUS`, or `UNKNOWN` unless some additional dangerous-mutation uncertainty exists. No new `PublicationAttempt` is created during a technical retry.

## 10. PublicationAttempt Semantics
`PublicationAttempt` represents a logical user execution history.
`PROCESSING_REMOTE` continuation polling must NOT create new `PublicationAttempt` rows per poll. One logical publish stays one logical attempt.
- YouTube multi-poll flow: 1 logical `PublicationAttempt`
- Reels multi-poll + finalize: 1 logical `PublicationAttempt`
- Temporary read failure + technical retry: 1 logical `PublicationAttempt`
Polling/retries do not automatically create one attempt per queue execution.

## 11. Coordination Errors
`ProviderCoordinationError` represents LOCAL coordination failures (missing checkpoint hooks, stale `dispatchVersion`, CAS rejections). They are NOT provider HTTP transient errors. Providers remain database-agnostic.

## 12. BullMQ Retry Configuration
The verified configuration for publishing workers is:
- `attempts`: 3
- `backoff`: `{ type: 'exponential', delay: 2000 }`
- `removeOnComplete`: true
- `removeOnFail`: false

Technical retries are strictly safe for read-only continuation polling. Dangerous final mutations are NOT blindly replayed after `PUBLISH_REQUESTED`.

## 13. Current Provider Flows

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
- Finally, issues remote final mutation (`/media_publish`).
- Unknown final result: `PUBLISH_REQUESTED` -> `AMBIGUOUS` -> `UNKNOWN`.

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

## 14. Current Provider Status Matrix

| Provider | Content Type | Preparation | Async Processing | Final Checkpoint | Status Polling | Finalization | Known Risk |
|---|---|---|---|---|---|---|---|
| Instagram Image | Image | Yes | No | Yes | No | Yes | Ambiguity |
| Instagram Reel | Video | Yes | Yes | Yes | Yes | Yes | Ambiguity, Orphan |
| Facebook | Text/Image/Video | Yes | No | Yes | No | No | Ambiguity |
| YouTube | Video | No | Yes | Yes | Yes | No | - |
| LinkedIn | Text/Image/Video/Doc | Yes | No | Yes | No | No | Preparation Idempotency |

## 15. Current Known Risks
No new blocker was identified within the tested real-infrastructure continuation boundary. However, the following systemic risks explicitly remain:
1. **Exactly-once publishing is NOT guaranteed**: The system does NOT guarantee exactly-once publishing. Checkpointed dangerous final mutations are protected against blind automatic duplicate retry, and uncertain outcomes are represented conservatively as `AMBIGUOUS` / `UNKNOWN`.
2. **Network partition / lost ACK**: A network partition after a dangerous provider mutation may produce unavoidable ambiguity.
3. **Instagram Reels initial /media preparation ambiguity**: Can still create orphan/duplicate preparation resources if the network drops.
4. **Container/preparation idempotency**: Remains provider-dependent and not proven.
5. **LinkedIn preparation idempotency/orphan cleanup**: Remains not proven.
6. **Provider HTTP**: Was mocked in real queue/database integration tests.
7. **Provider rate limits/throttling**: Remain external operational risks.
8. **Generic DB polling/dispatcher scan**: May need indexing/scheduling evolution at a larger scale.
9. **Reconciliation of already-published remote resources**: Without an authoritative final ID, it remains conservatively `AMBIGUOUS`/`UNKNOWN`.

## 16. Current Test Evidence
Verified Baseline: `71953e6e803481c52f334784a8f9aa23c834a861`

- **Real Redis**: EXECUTED / VERIFIED for tested continuation scenarios
- **Real BullMQ**: EXECUTED / VERIFIED for tested continuation scenarios
- **Real PostgreSQL**: EXECUTED / VERIFIED for state-machine, continuation, CAS, and rollback scenarios
- **Provider HTTP**: MOCKED in real-infrastructure orchestration tests

Real Redis/BullMQ/PostgreSQL orchestration was verified for the tested scenarios with mocked provider HTTP.

Latest test metrics:
- **Real-infra continuation**: 15 / 15 PASS
- **Worker**: 76 / 76 PASS
- **Providers**: 202 / 202 PASS
- **Database**: 73 / 73 PASS
- **API**: 82 / 82 PASS
- **Web**: 44 / 44 PASS
- **Turbo Matrix**: PASS
- **Lint**: PASS
- **Typecheck**: PASS

*(Note: These are checkpoint evidence, not timeless guarantees).*

## 17. Real-Infrastructure Test Isolation
Real-infrastructure integration tests operate using:
- A unique test queue namespace (`publishing_real_integration_test_${Date.now()}`).
- Scoped DB cleanup targeting only explicitly tracked test-created IDs.
- No broad shared `deleteMany` and no `FLUSHALL`.

## 18. Current Implementation Status
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
