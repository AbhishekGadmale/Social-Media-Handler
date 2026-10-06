# AGENCY_SOCIAL_OS_MASTER_CONTEXT

## 1. Goal
Provide context for coding agents working on the repository. Do NOT summarize this file; load it fully via `cat` or file-reading tools.

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

## 6. Provider Contract
Providers implement a stateless contract via `IPublishingProvider`:
- `publish(credentials, input, context)`: Initiates publishing.
- `checkStatus?(credentials, providerState)`: Polls remote async processing status. Returns `ProviderStatusCheckResult` (with status: `PROCESSING`, `PREPARATION_READY`, `READY`, `PUBLISHED`, `FAILED`, `UNKNOWN`).
- `continuePreparation?(credentials, input, providerState, context)`: Advances a multi-step preparation flow.
- `finalizePublish?(credentials, input, context)`: Commits final remote publishing step after preparation.

**Coordination Context (`ProviderPublishContext` / `ProviderPreparationContext`):**
- `onRemotePrepared(ProviderRemotePreparation)`: Checkpoints intermediate provider state (`containerId`, `providerState`).
- `beforeFinalMutation()`: A mandatory checkpoint yielding a database CAS lock. MUST be invoked strictly before the dangerous final remote network call.

**Semantic Status Map Distinction:**
- `PREPARATION_READY`: Provider preparation can advance through a mutable preparation step via `continuePreparation()`.
- `READY`: Dangerous final publication mutation may now proceed via `finalizePublish()`.

## 7. Execution Metadata & State Graph
Execution checkpoints protect against orphaned assets and dangerous duplicate publications.

**Global Execution Phases:**
- `INITIATED`: Worker has started execution. No remote publication mutations have occurred.
- `CONTAINER_CREATED`: Provider created an intermediate remote resource (e.g., Reel container or Carousel child). Allowed to loop (`CONTAINER_CREATED` -> `CONTAINER_CREATED`) for repeated durable child checkpoints.
- `PROCESSING_REMOTE`: System is async polling or advancing preparation. Supports continuation/progress via `PROCESSING_REMOTE` -> `PROCESSING_REMOTE`.
- `PUBLISH_REQUESTED`: The durable pre-final-mutation checkpoint. Automatic replay of final mutation is STRICTLY FORBIDDEN.
- `COMPLETED`: Publication successfully completed with a valid authoritative final ID.
- `FAILED`: Execution terminated due to validation or definitive remote failure.
- `AMBIGUOUS`: A dangerous remote mutation may have succeeded, but the local system cannot authoritatively confirm the outcome. Outer variant falls back to `UNKNOWN`.

**CAS Behavior:**
Continuation uses `operationId` and `dispatchVersion`. A successful CAS increments `dispatchVersion` exactly once. Stale contenders are rejected, preventing downstream remote mutation when the checkpoint precedes that mutation. *This is duplicate-risk containment, NOT exactly-once publishing.*

## 8. Identifier Semantics
- `containerId` / `parentContainerId`: Intermediate resource tracking ID during remote processing.
- `finalRemoteId` / `externalPostId`: The authoritative completed publication identity on the social network. Do NOT use container IDs as finalRemoteIds.

## 9. Async Continuation Model
`PROCESSING_REMOTE` does NOT mean a worker thread sleeps.
1. State and `nextCheckAt` are persisted.
2. The worker function returns naturally.
3. A separate dispatcher routinely scans the DB for due operations.
4. BullMQ schedules a continuation job.
5. Continuation executes `checkStatus()` read-only polling or `continuePreparation()` steps.

**Generic Transient Failure Rule:**
During the authoritative `PUBLISH_REQUESTED` phase, a provider `failureCategory === TRANSIENT` is treated as an uncertain final outcome and routed to `handleUnknown` (AMBIGUOUS), NOT `handleFailure`, preventing blind retry of final mutations.

## 10. PublicationAttempt Semantics
`PublicationAttempt` represents a logical user execution history. Polling/retries do not create new attempt rows. One logical publish stays one logical attempt.

## 11. Coordination Errors
`ProviderCoordinationError` represents LOCAL failures (missing hooks, stale CAS rejections). They immediately halt execution and reject stale contenders before external final mutations.

## 12. BullMQ Retry Configuration
- `attempts`: 3
- `backoff`: `{ type: 'exponential', delay: 2000 }`
- `removeOnComplete`: true
- `removeOnFail`: false

## 13. Current Provider Flows

### Instagram Carousel (Verified Lifecycle)
1. `INITIATED`
2. Child 1 remote container creation -> `CONTAINER_CREATED` (providerState contains child 1).
3. Additional child creations -> repeated `CONTAINER_CREATED` checkpoints (completed children are skipped on resume).
4. All child containers created -> `PROCESSING_REMOTE` (`providerState.step = CHILD_PROCESSING`).
5. Child polling (all children `FINISHED`) -> `PREPARATION_READY`.
6. Worker calls `continuePreparation()`.
7. Parent carousel container creation -> `PROCESSING_REMOTE` (`providerState.step = PARENT_PROCESSING`; `parentContainerId` persisted).
8. Parent polling (parent `FINISHED`) -> `READY`.
9. Worker calls `finalizePublish()`.
10. `beforeFinalMutation()` -> durable `PROCESSING_REMOTE` -> `PUBLISH_REQUESTED` CAS.
11. POST `/{ig-user-id}/media_publish` (`creation_id=<providerState.parentContainerId>`). No remoteResourceId fallback.
12. Authoritative success -> `COMPLETED` -> `finalRemoteId` = published post ID -> Variant `PUBLISHED` -> Attempt `SUCCESS`.

**Carousel Provider State:**
`kind: INSTAGRAM_CAROUSEL`, `step`, `completedChildren` (sortOrder, containerId, mediaType), `pendingChildrenIndices`, `parentContainerId`.
*Must NOT contain access tokens, credentials, signed URLs, or CAS versions.*

**Carousel Child Preparation:**
- Image: POST `/{ig-user-id}/media` (`image_url=<transient signed URL>`, `is_carousel_item=true`)
- Video: POST `/{ig-user-id}/media` (`video_url=<transient signed URL>`, `media_type=VIDEO`, `is_carousel_item=true`) (No REELS type).
No caption on children.

**Carousel Child Polling:**
GET `/{childContainerId}?fields=status_code`. Mapping: `IN_PROGRESS -> PROCESSING`, `FINISHED -> ready child`, `ERROR/EXPIRED -> FAILED`.
All children `FINISHED` -> `PREPARATION_READY`.

**Carousel Parent Preparation:**
POST `/{ig-user-id}/media` (`media_type=CAROUSEL`, `children=<ordered ids>`, `caption`). Parent caption only. Response ID becomes `parentContainerId`.

**Carousel Parent Polling:**
GET `/{parentContainerId}?fields=status_code`. Mapping: `FINISHED -> READY`.

### Instagram Image
- Canonical final-mutation checkpoint model.
- Container creation -> `onRemotePrepared` -> container persistence.
- `beforeFinalMutation` -> `PUBLISH_REQUESTED` -> `/{ig-user-id}/media_publish`.

### Instagram Reels
- `INITIATED` -> `CONTAINER_CREATED` -> `PROCESSING_REMOTE` -> `PUBLISH_REQUESTED` -> `COMPLETED`.
- `checkStatus()` converts `FINISHED` -> `READY`. `READY` -> `finalizePublish()`.

### Facebook
- Direct final-mutation checkpoint model. No intermediate async processing.

### YouTube
- `INITIATED` -> `PUBLISH_REQUESTED` -> `youtube.videos.insert` -> `PROCESSING_REMOTE` (polling) -> `COMPLETED`.

### LinkedIn
- `INITIATED` -> `PUBLISH_REQUESTED` -> POST `/rest/posts` -> `COMPLETED`.

## 14. Current Known Risks & Final Ambiguity Policy
1. **Final AMBIGUOUS reconciliation risk (Network Loss)**: If `/media_publish` succeeds remotely and the response is lost, the system enters `AMBIGUOUS` / `UNKNOWN`. Manual, asynchronous, or future provider-side reconciliation is required.
2. **Child/Parent preparation ambiguity risk**: If POST `/media` reaches Meta but response is lost, retry may create an additional orphan/duplicate preparation container. Preparation idempotency is NOT proven.
3. **HTTP 5xx / Timeout Ambiguity**: During `PUBLISH_REQUESTED`, these translate to `AMBIGUOUS`.
4. **Malformed Successful Response Missing Authoritative Final ID**: An HTTP success response may be received, but if the provider response lacks the authoritative published resource ID required by the contract (e.g. `/media_publish` missing `data.id`), the system MUST NOT synthesize a fake `finalRemoteId`. The dangerous mutation may have already happened. The system MUST NOT blindly repeat the dangerous mutation. Execution routes to `AMBIGUOUS` and the outer PostPlatformVariant routes to `UNKNOWN`.
5. **Restart Safety**: A restarted job already in `PUBLISH_REQUESTED` does not call `finalizePublish()` or `media_publish` again, but conservatively resolves via ambiguity recovery.
6. **Exactly-once publishing is NOT guaranteed**: Publishing uses durable execution checkpoints, CAS-based stale-worker exclusion, continuation-safe provider state, and conservative ambiguous-outcome handling (duplicate-risk containment + ambiguity protection).

## 15. Current Checkpoint & Regression Baseline
**Baseline Checkpoint**: `85285c8bc4ef5f4ad22b9a24d419024c10bc65fb`
Task D: feat(publishing): finalize Instagram carousel publishing

**Historical Milestones:**
- Task A: `1d70ba1fd722553841ea85f57cedb348b10c47f6` (multi-step preparation)
- Task B: `06478cea4fe077117ae58bbdeab0be7593195f76` (carousel child preparation)
- Task C: `f072d26befd2df0812b4cf0e6abb34859f5c898c` (carousel parent preparation)
- Task D: `85285c8bc4ef5f4ad22b9a24d419024c10bc65fb` (carousel final media_publish)

**Verified Test Baseline:**
- **Real-infra continuation**: 18 / 18 PASS
- **Providers**: 15 suites / 225 tests PASS
- **Worker**: PASS
- **Database**: PASS
- **API**: PASS
- **Web**: PASS
- **Turbo Matrix**: PASS (test, lint, typecheck)

Real Redis/BullMQ/PostgreSQL orchestration was verified for the tested scenarios with mocked provider HTTP.

**Evidence Boundaries:**
- Stale finalization race: generic real-infra CAS proof + carousel provider integration/unit behavior.
- Unknown final result: generic real-infra AMBIGUOUS handling + carousel finalization classification.
- PUBLISH_REQUESTED restart: generic real-infra recovery behavior.

## 16. Current Implementation Status
**Instagram Support:**
- Single-image feed publishing
- Reels/video publishing
- Carousel child preparation
- Carousel parent preparation
- Carousel final media_publish
Carousel MVP supports 2..10 media, ordered media, image/video mixed assets where currently supported.

**Out-of-Scope / Not Implemented:**
- Instagram Stories
- Collaborative posts
- Product tagging
- Music attachment
- Advanced carousel metadata
- Speculative reconciliation API
- Exactly-once external publishing
- Facebook Reels
- TikTok
