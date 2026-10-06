# Ambiguous Publication Reconciliation Architecture

## 1. Executive Summary
This document locks the architecture for resolving publications that end in an `AMBIGUOUS` execution phase and `UNKNOWN` status. Because no supported provider currently offers an authoritative lookup mechanism without blind mutation replay, the system will enforce **Manual Reconciliation Hardening** (Model A) as the primary strategy for E1, avoiding false-positives and dangerous duplicate publications.

## 2. Current Problem
The system encounters a specific failure class:
1. A durable `PUBLISH_REQUESTED` checkpoint exists.
2. The dangerous final provider mutation (e.g., `media_publish`, `videos.insert`) is sent.
3. The provider may have accepted it.
4. The response is lost, times out, yields a 5xx error, or is malformed (missing authoritative final ID).
5. The worker refuses blind retry.
6. Execution becomes `AMBIGUOUS`.
7. `PostPlatformVariant` becomes `UNKNOWN`.
8. The actual external state remains unresolved, risking duplicate publication if naively retried.

## 3. Existing Architecture
Manual reconciliation code already partially exists in the repository:
- **Service:** `PublishingApplicationService.reconcile()`
- **Endpoint:** `POST /api/v1/workspaces/:workspaceId/publications/:publicationId/reconcile`
- **UI:** Exists at `apps/web/src/app/[workspaceId]/publishing/[postId]/page.tsx`
- **Schema:** `PostPlatformVariant` tracks `reconciledAt`, `reconciledBy`, `reconciliationReason`.
- **Audit Logs:** `PUBLICATION_RECONCILED_PUBLISHED`, `PUBLICATION_RECONCILED_FAILED` exist.

*Defects:*
1. The endpoint currently reuses the `publishing.publish` permission instead of a dedicated `publishing.reconcile` permission.
2. The logic updates `PostPlatformVariant` but fails to synchronize the terminal state into the associated `PublicationAttempt` or its `executionMetadata.phase`.

## 4. Safety Invariants
- **R1:** Reconciliation MUST NOT blindly repeat the original dangerous publish mutation.
- **R2:** Reconciliation MUST be read-only unless an explicit operator action is separately authorized.
- **R3:** A publication may move from `AMBIGUOUS`/`UNKNOWN` to `PUBLISHED` only with authoritative provider evidence or explicit operator confirmation.
- **R4:** Never synthesize `finalRemoteId`.
- **R5:** If evidence is inconclusive, remain `AMBIGUOUS`/`UNKNOWN`.
- **R6:** Stale reconciliation workers/operators must not overwrite a newer state.
- **R7:** Multiple reconciliation attempts must be idempotent at the DB layer.
- **R8:** Audit trail must record the resolution origin (automatic or manual) and the actor.
- **R9:** Credentials/tokens/signed URLs must not be persisted in reconciliation metadata.
- **R10:** Do not claim exactly-once external publication.

## 5. Existing Manual Reconciliation Audit
Current manual reconciliation semantics:
- **A. Does `CONFIRM_PUBLISHED` require `externalPostId`?** No, it is optional.
- **B. Is `canonicalUrl` supported?** Yes, it is optional.
- **C. Can operator confirm publication without final ID?** Yes.
- **D. Does it modify `finalRemoteId` (`externalPostId`)?** Yes, if provided.
*Defect:* A variant may currently become PUBLISHED without an authoritative `finalRemoteId` / external post identity because `externalPostId` and `canonicalUrl` can be omitted. This is a current invariant gap to harden in E1. It must not be silently normalized as acceptable final publication semantics.
- **E. Is `AuditLog` recorded?** Yes (`PUBLICATION_RECONCILED_PUBLISHED` or `FAILED`).
- **F. Is RBAC permission `publishing.reconcile` enforced?** NO. It currently requires `publishing.publish`.
- **G. Can terminal records be reconciled twice?** No, it throws `ConflictException`.
- **H. Is decision idempotent?** Yes, if the state is already the target state, it returns the variant.
- **I. Can stale operators overwrite an automatically resolved result?** No, thanks to the atomic `UNKNOWN` -> Target state transition constraint.
- **J. Does it require a reason?** Yes (`dto.reason`).
- **K. Does it update `PublicationAttempt` or `executionMetadata.phase`?** NO. Currently, only `PostPlatformVariant` is updated, leaving the attempt record stale.
- **L. Is Tenancy enforced?** Yes, via repository workspace scope.

## 6. Provider Capability Matrix

| Provider / Flow | Known identifier at AMBIGUOUS | Official lookup mechanism | Evidence strength | Auto-PUBLISHED? | Auto-FAILED? | Manual fallback needed? | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Instagram Image | `containerId` | `/media` edge search | HEURISTIC | NO | NO | YES | `creation_id` does not return the published media ID. |
| Instagram Reels | `containerId` | `/media` edge search | HEURISTIC | NO | NO | YES | Same as Image. |
| Instagram Carousel | `parentContainerId` | `/media` edge search | HEURISTIC | NO | NO | YES | Same as Image. |
| Facebook | None | `/feed` search | HEURISTIC | NO | NO | YES | No idempotency key support on standard POST `/feed`. |
| LinkedIn | None | `/ugcPosts` search | HEURISTIC | NO | NO | YES | `X-RestLi-Idempotency-Key` not currently implemented/sent. |
| YouTube | None | `search.list` / `activities` | HEURISTIC | NO | NO | YES | `videos.insert` does not expose resumable upload session URI natively in our implementation. |

*Conclusion:* For the current Agency Social OS publishing flows, using identifiers currently retained, based on official APIs reviewed during E0 (October 2026), NO provider currently supports an AUTHORITATIVE lookup for ambiguous final mutations. Therefore, auto-reconciliation is not viable today.

## 7. Evidence Taxonomy
- **AUTHORITATIVE:** Provider gives a deterministic mapping from our known operation/resource to the exact externally published resource. Allows auto-resolution.
- **STRONG_CORRELATION:** High-confidence correlation but not guaranteed unique. Requires manual confirmation.
- **HEURISTIC:** Content/time/account matching that may collide. Requires manual confirmation.
- **NONE:** Provider offers no useful evidence.

## 8. Recommended Architecture
**Model A (Manual-Only Reconciliation Hardening)** is the recommended architecture.
No authoritative automatic lookup was identified for current supported flows using identifiers currently retained. Therefore: no provider auto-reconciliation implementation now, no heuristic auto-resolution, and no dangerous mutation replay.

1. **Trigger:** Human operator views `UNKNOWN` variants in the UI.
2. **Lookup:** Operator manually verifies the social platform natively.
3. **Persist:** Operator submits `CONFIRM_PUBLISHED` (with optional final ID) or `CONFIRM_FAILED` via API.
*Distinction:* Manual `CONFIRM_PUBLISHED` / `CONFIRM_FAILED` are explicit operator assertions. They are NOT provider-authoritative evidence. `CONFIRM_FAILED` must not be used automatically without authoritative proof that publication did not occur.
4. **Concurrency:** Atomic CAS on `PostPlatformVariant.status` from `UNKNOWN`.
5. **Audit:** Writes `PUBLICATION_RECONCILED_*` with actor ID and reason.

## 9. State Transitions
Allowed atomic transitions:
- `AMBIGUOUS` (Execution) / `UNKNOWN` (Variant) -> `COMPLETED` / `PUBLISHED` (via `CONFIRM_PUBLISHED`)
- `AMBIGUOUS` (Execution) / `UNKNOWN` (Variant) -> `FAILED` / `FAILED` (via `CONFIRM_FAILED`)

## 10. Concurrency Model
Atomic persistence via `repo.transitionVariantState(variantId, PostStatus.UNKNOWN, targetStatus)`. This guarantees a stale operator cannot overwrite an already resolved state (e.g. if the user clicks twice, or two admins act concurrently).

## 11. DB/Transaction Ownership
*Defect:* Currently, `PublishingApplicationService` writes the `AuditLog` AFTER `transitionVariantState` and it is NOT inside the same DB transaction. Current manual reconciliation is not fully transactional. In E1, required reconciliation writes must be made atomic to keep the `AuditLog` consistent with terminal resolution.

## 12. Scheduling/Retry Design
No background BullMQ jobs are required for reconciliation at this stage, as automatic provider evidence lookup is deemed too heuristic. No retry loops are needed.

## 13. RBAC/Security
- **New Permission:** Create a dedicated `publishing.reconcile` permission.
- **Constraint:** Replace `@RequirePermission('publishing.publish')` with `publishing.reconcile` on the `/reconcile` endpoint.
- **Data Privacy:** No credentials or signed URLs are persisted in the reconciliation payload or audit log.

## 14. Metrics/Observability
- `publishing_ambiguous_total` (counter)
- `publishing_ambiguous_current` (gauge)
- `publishing_reconciliation_resolved_total` (counter, labels: `provider`, `resolution_type: PUBLISHED | FAILED`)
- **Cardinality:** High-cardinality labels (`workspaceId`, `publicationId`, error messages) MUST be excluded.

## 15. Provider-Specific Findings
- **Meta (Instagram/Facebook):** Relying on caption/timestamp matching is a weak heuristic and risks false negatives (resulting in dangerous republishing) or false positives.
- **LinkedIn:** Implementing `X-RestLi-Idempotency-Key` in the future *could* enable authoritative reconciliation, but it is not present in the current codebase.

## 16. Recommended First Implementation Provider
**NONE.** Due to the lack of authoritative lookup capabilities across all implemented providers, the recommendation is to **harden manual reconciliation across all providers** rather than pretending automatic reconciliation is safe.

## 17. Future E1+ Task Breakdown
- **E1 - Manual Reconciliation Hardening & RBAC:**
  - Add dedicated `publishing.reconcile` permission and update RBAC grants.
  - Switch reconciliation endpoint to `publishing.reconcile`.
  - Synchronize `executionMetadata.phase`.
  - Synchronize `PublicationAttempt`.
  - Preserve `PostPlatformVariant` transition.
  - Make required reconciliation writes atomic (keep `AuditLog` consistent with terminal resolution).
  - Require operator reason.
  - Define `finalRemoteId`/`externalPostId` policy (close the invariant gap).
  - Prevent stale/double resolution.
  - Maintain workspace isolation.
  - API tests + worker/domain/repository tests as needed.
  - *Constraints:* No automatic provider lookup, no republish.
- **E5 - Admin Visibility:** Enhance the UI to display the exact time of ambiguity and guide the user on how to manually verify on each platform.
- **E6 - Metrics & Observability:** Implement the low-cardinality Prometheus metrics for ambiguous states.

## 18. Test Strategy
- **Orchestration Tests:** Simulate a manual reconciliation call interrupting or resolving an `UNKNOWN` variant, verifying CAS constraints and audit logs.
- **Provider Mocking:** Force a mocked 5xx response on `media_publish`, assert the variant reaches `UNKNOWN`, and then successfully resolve it via the manual endpoint.

## 19. Known Unknowns
- Will Meta eventually return the final media ID when polling a `creation_id`?
- Does LinkedIn's `X-RestLi-Idempotency-Key` support long-term retrieval of the final post URN on retry?

## 20. Explicit Non-Goals
- Automatic heuristic matching of content/timestamps.
- Blind retries of dangerous mutations.
- Claiming "exactly-once" delivery.
- Creating new global execution phases (use existing `AMBIGUOUS`).
- Schema changes for E0/E1 (currently required = NO).
- New queues or background jobs for E0/E1 (currently required = NO).

## 21. Official External References
- **Instagram Graph API (Container Publishing)**
  - URL: https://developers.facebook.com/docs/instagram-api/reference/ig-user/media_publish
  - Accessed: October 2026
  - Conclusion: `creation_id` status polling does not reliably return the final published media ID across all scenarios.
- **Facebook Graph API (Feed Publishing)**
  - URL: https://developers.facebook.com/docs/graph-api/reference/page/feed
  - Accessed: October 2026
  - Conclusion: Standard `POST /feed` lacks a robust idempotency key mechanism for guaranteed duplicate prevention on timeout.
- **YouTube Data API (Resumable Uploads)**
  - URL: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
  - Accessed: October 2026
  - Conclusion: `videos.insert` does not natively expose the resumable upload session URI in a way that allows us to poll state without a prior saved session ID.
- **LinkedIn Rest.li (Idempotency)**
  - URL: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/idempotency
  - Accessed: October 2026
  - Conclusion: `X-RestLi-Idempotency-Key` exists but is not implemented in our current flow, preventing authoritative recovery of ambiguous POSTs.

## 22. Architecture Decision Summary
We reject automatic reconciliation (Options B & C) in favor of **Manual-Only Reconciliation (Option A)**. This prioritizes duplicate-risk containment and data integrity over operational convenience, adhering strictly to the principle that a dangerous mutation must never be blindly repeated or spuriously marked as successful based on heuristic evidence.
