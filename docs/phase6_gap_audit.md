# Phase 6 Hardening Gap Audit

## Phase 6 Overall Status
**Status:** NEEDS WORK (Significant gaps before staging readiness)

Based on the Agency Reality Checker skill and strict evidence-based auditing, the current system has a strong security foundation (Auth, OAuth, Tenant Isolation, Encryption) but severely lacks production operations hardening (Input Validation, Global Rate Limiting, Dockerization, CI, Audit Logging, and System Hygiene).

## Executive Summary
The core identity and tenant architecture (Phase 3 & 4) is robust and production-grade. However, the system is exposed to basic application-layer attacks due to missing global input validation and rate limiting. Additionally, deployment readiness is at 0%—no containerization for apps, no CI pipeline, and poor git hygiene with tracked local temporary files. 

## Security Matrix

| Area | Status | Evidence | Risk | MVP Blocking? |
|------|--------|----------|------|---------------|
| 1. Auth & Sessions | COMPLETE | `AuthGuard` verifies session ID and strict CSRF matching. Cookie is `httpOnly`, `sameSite: lax`. | Low | No |
| 2. Password Security | COMPLETE | `@node-rs/argon2` utilized. Proper masking in APIs. | Low | No |
| 3. OAuth Security | COMPLETE | `OAuthService` implements PKCE. State uses 5min Redis TTL & single-use deletion. | Low | No |
| 4. Credential Encryption | COMPLETE | `encryption.ts` strictly requires 32-byte key, uses AES-256-GCM. | Low | No |
| 5. Authorization / RBAC | COMPLETE | `PermissionGuard` and `WorkspaceGuard` properly check `WorkspaceMemberRepository`. | Low | No |
| 6. Tenant Isolation | COMPLETE | `WorkspaceScopedRepository` bounds Prisma queries. No controller bypasses found. | Low | No |
| 7. Rate Limiting | PARTIAL | `ThrottlerGuard` is only on `/login`. In-memory default store won't work for multi-instance. | High | Yes |
| 8. Audit Logging | NOT STARTED | `audit.view` permission exists, but no implementation/interceptor exists to record actions. | Medium | Yes |
| 9. App Logging / Obs. | PARTIAL | NestJS default logger used. No structured logging (Pino), no liveness/readiness probes. | Medium | Yes |
| 10. BullMQ Reliability | COMPLETE | `sync.processor.ts` handles rate limits via `moveToDelayed` and unauthorized gracefully. | Low | No |
| 11. Input Validation | MISSING | `ValidationPipe` missing from `main.ts`. Controllers use raw `Record<string, string>`. | High | Yes |
| 12. HTTP Security | PARTIAL | CORS configured, but Helmet is absent. | Medium | Yes |
| 13. Secrets & Hygiene | BROKEN | `cookies.txt`, `temp.json`, `test-results.txt` are currently tracked by git. | High | Yes |
| 14. Testing | PARTIAL | Good e2e coverage for core modules, but CI doesn't run them. | Medium | No |
| 15. CI | NOT STARTED | No GitHub Actions or CI configuration exists. | High | Yes |
| 16. DB Migration Safety | PARTIAL | No safety scripts preventing `prisma migrate dev` execution in prod. | Medium | Yes |
| 17. Staging Readiness | NOT STARTED | `docker-compose.yml` only contains DB/Redis. No App Dockerfiles exist. | High | Yes |
| 18. Frontend Security | PARTIAL | Basic structure exists, cache boundaries untested. | Medium | No |
| 19. Dependency Hygiene | PARTIAL | Unnecessary temp scripts (`fix.js`, `trigger.js`) at root. | Low | No |

## Existing Hardening Already Complete
1. **Tenant Isolation:** `WorkspaceScopedRepository` is strictly utilized in data fetching (Accounts, Analytics).
2. **Credential Encryption:** The AES-256-GCM implementation correctly manages IVs and Auth Tags, and strictly enforces environment variables.
3. **Queue Reliability:** BullMQ handles provider backoffs smoothly without halting the worker.
4. **OAuth Security:** PKCE and State verification are flawless. 

## Partial Implementations
1. **Rate Limiting:** Implemented only on login via memory storage. 
2. **Observability:** Basic NestJS logging without structure, correlation IDs, or health probes.

## Missing Implementations
1. **Input Validation:** Global validation pipe is absent; route payloads are untyped.
2. **Audit Logging:** No tracking of logins, connections, or permission changes.
3. **Helmet:** Missing HTTP headers.
4. **CI & Dockerfiles:** No deployment artifacts or pipelines.

## Architecture Violations
- **None observed** in the domain logic. The separation between controllers, services, and repositories is well maintained.

## Secrets / Git Hygiene Findings
- **CRITICAL:** `cookies.txt`, `temp.json`, and `test-results.txt` are committed to the repository. These must be purged from the git history/index immediately.

## Testing Matrix
- **Auth/OAuth:** E2E tests exist.
- **Worker:** Spec tests exist for queue logic.
- **Environment:** CI is not executing tests.

## Staging Readiness
- **Gap:** No Dockerfiles for `api`, `web`, `worker`. 
- **Gap:** No reverse-proxy assumptions or readiness probes available.

## Zero-Cost MVP Recommendations
- **Logging:** Use `nestjs-pino` (Free, open-source) instead of paid APM platforms.
- **Rate Limiting:** Use `@nestjs/throttler-storage-redis` alongside the existing Redis instance.
- **Audit Logs:** Create a simple `AuditLog` table in Postgres rather than using an external event store.
- **CI/CD:** Use standard GitHub Actions.

## Phase 6 Ordered Execution Plan

**6.1 Resolve Git Hygiene & Temporary Files**
- **Objective:** Untrack and delete `cookies.txt`, `temp.json`, `test-results.txt`, and clean up root scripts.
- **Why it comes now:** Prevent further credential leakage before making new commits.
- **Acceptance:** `git status` is clean, `.gitignore` includes wildcard exclusions for temp files.

**6.2 Implement Global Input Validation & Helmet**
- **Objective:** Add `ValidationPipe` globally and install `helmet`. Define DTOs for `auth.controller.ts`.
- **Why it comes now:** Security basic that affects all incoming data.
- **Acceptance:** Unvalidated requests return 400 Bad Request. Helmet headers are present on API responses.

**6.3 Upgrade Rate Limiting to Redis & Global Scope**
- **Objective:** Install `@nestjs/throttler-storage-redis` and apply global API limits (with relaxed limits, and strict limits for Auth).
- **Why it comes now:** Required for multi-instance horizontal scaling before staging.
- **Acceptance:** Redis keys show throttle state; limits work across instances.

**6.4 Implement Structured Logging & Health Probes**
- **Objective:** Add `nestjs-pino` for JSON logging and `@nestjs/terminus` for `/health` endpoints.
- **Why it comes now:** Required for Docker container health checks.
- **Acceptance:** Logs are JSON formatted; `/health` returns 200 OK checking DB and Redis.

**6.5 Implement Basic Audit Logging**
- **Objective:** Add Prisma model `AuditLog` and a global interceptor or service to record security events (login, connect provider).
- **Why it comes now:** Final application logic hardening task.
- **Acceptance:** Connecting an account creates an entry in `AuditLog` table.

**6.6 Containerization (Dockerfiles)**
- **Objective:** Create optimized Dockerfiles for `api`, `worker`, and `web`. Update `docker-compose.yml` to include app services.
- **Why it comes now:** Application is hardened and ready to be packaged.
- **Acceptance:** `docker compose up` starts the entire system.

**6.7 Implement CI Pipeline**
- **Objective:** Add `.github/workflows/ci.yml` to run lint, typecheck, and tests.
- **Why it comes now:** Ensure future commits do not regress the hardened system.
- **Acceptance:** GitHub Action runs successfully on push.

## Items Explicitly Deferred Beyond MVP
- External APM tools (DataDog/NewRelic).
- Dedicated Auth microservice (Monolith remains sufficient).
- Complex event sourcing for audit logs (Simple table is sufficient).

## Final Recommendation
**NEEDS WORK.** Do not deploy to staging until Tasks 6.1 through 6.6 are complete. The application business logic is sound, but it lacks the operational shell required to run safely on the public internet. Proceed sequentially starting with Task 6.1.
