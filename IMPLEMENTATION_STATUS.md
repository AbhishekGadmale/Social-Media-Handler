# Implementation Status Report

## Phase-by-Phase Status

### Phase 0: Repo + Docker + Tooling

**Status**: COMPLETE AND VERIFIED

- **Evidence**: Turborepo scaffold is in place (`turbo.json`, `pnpm-workspace.yaml`). Docker compose exists (`docker-compose.yml`). Basic `.env.example` is present. Next.js, NestJS, and shared packages structure is established.

### Phase 1: DB + Tenancy

**Status**: COMPLETE AND VERIFIED

- **Evidence**: `packages/database/prisma/schema.prisma` contains the full schema including `Organization`, `Workspace`, `WorkspaceMember`, `SocialAccount`, `SocialConnection`, etc. `WorkspaceGuard` is implemented in `apps/api/src/modules/auth/guards/workspace.guard.ts` (as seen being used in endpoints).

### Phase 2: Auth + RBAC

**Status**: COMPLETE AND VERIFIED

- **Evidence**: `AuthGuard` and `PermissionGuard` are fully implemented in `apps/api/src/modules/auth/guards/`. `AuthController` handles `/login`, `/logout`, and `/me`. Session management and cookies are handled. RBAC roles and decorators are active.

### Phase 3: Provider Core

**Status**: COMPLETE AND VERIFIED

- **Evidence**: `packages/providers` contains the framework-agnostic interfaces. `ISocialProvider` and capability resolvers are fully implemented as per the specification.

### Phase 4: First OAuth Provider

**Status**: COMPLETE AND VERIFIED

- **Evidence**: `packages/providers/linkedin/linkedin.provider.ts` is implemented, supporting authorize URL generation, token exchange, PKCE, and basic profile fetching. Fail-fast configuration validation enforced without silent dummy fallbacks (PR #45).

### Phase 5: Analytics

**Status**: COMPLETE AND VERIFIED

- **Evidence (Backend - COMPLETE AND VERIFIED)**: `apps/api/src/modules/analytics` exposes endpoints reading from `AccountMetricDaily` using Prisma. `apps/worker/src/sync/sync.processor.ts` successfully implements token decryption, calls provider capabilities (`getAccountMetrics`), and upserts data idempotently into PostgreSQL. Extensive unit tests exist in `sync.processor.spec.ts`.
- **Evidence (Frontend - COMPLETE AND VERIFIED)**: Authenticated workspace overview dashboard implemented at `apps/web/src/app/[workspaceId]/analytics/page.tsx`, displaying high-level aggregated summary cards (Total Followers, Total Engagement, Connected Accounts, Active Accounts) and per-account metric breakdowns with provider badges and status indicators (`ACTIVE`, `REAUTH_REQUIRED`, `DISCONNECTED`). Account drill-down view implemented at `apps/web/src/app/[workspaceId]/analytics/[accountId]/page.tsx` with 30-day historical trend charts via `recharts`. Implements honest loading skeleton (`role="status"`), empty onboarding states, 403 access-denied handling, header refresh/retry actions with spinning indicator during `isFetching`, and aligned workspace navigation (`/` redirecting to `/dashboard` and per-workspace card "Enter Workspace" CTA routing to `/[workspaceId]/analytics`). Comprehensive unit tests added in `page.spec.tsx` and `[accountId]/page.spec.tsx` (20 unit tests across 2 new test suites). _Limitation noted_: The overview displays the latest recorded daily snapshots per connected account; date-range query filtering is not supported by the backend overview endpoint.

### Phase 6: Hardening

**Status**: PARTIAL

- **Evidence**:
  - **Security Hardening (Token Encryption)**: COMPLETE AND VERIFIED. AES-256-GCM encryption is fully implemented in `packages/database/src/crypto/encryption.ts` and used across the API and worker. Shared `validateTokenEncryptionKey()` enforces exactly 64 hexadecimal characters (32 bytes) fail-fast during bootstrap before application initialization. Extensive unit and startup test coverage verified.
  - **Rate Limiting**: COMPLETE AND VERIFIED. Global distributed rate limiting is enforced via Redis Throttler registered as global `APP_GUARD` in `apps/api/src/app.module.ts` with tiered policies in `RateLimitPolicies` and custom storage in `apps/api/src/modules/core/redis-throttler.storage.ts`.
  - **Audit Logging**: COMPLETE AND VERIFIED. Audit logging architecture implemented via `AuditService` (`apps/api/src/modules/core/audit.service.ts`) and `AuditLogRepository` (`packages/database/src/repositories/AuditLogRepository.ts`), supporting explicit transactional persistence (`tx.auditLog.create` in publishing mutations) and best-effort persistence (`logActionBestEffort` for auth, OAuth, and media). Enriched failure categorization for failed logins and OAuth callbacks verified across PR #11, PR #12, PR #23, and PR #27.
  - **Staging/Deployment Hardening**: MERGED & VERIFIED IN CI (PR #39, PR #41, PR #42, & PR #43). Unified NGINX ingress reverse proxy (`docker/nginx/nginx.conf`, `docker/nginx/Dockerfile`) configured for non-root execution with pinned `nginxinc/nginx-unprivileged:1.31.7-alpine`, routing `/api/*` to `api:3001` and `/` to `web:3000` with WebSocket upgrade mapping and keepalive preservation, query-parameter-stripped access logs preventing plain-text OAuth credential logging (H1), 512MB body limit matching `MEDIA_MAX_UPLOAD_BYTES`, 60s/120s upstream timeouts (L5), forwarded headers (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` via `$forwarded_proto`, `X-Forwarded-Host`), and dedicated `/healthz` probe returning `healthy\n` (L4). Dedicated staging Compose configuration (`docker-compose.staging.yml`, requiring Compose v2.24.4 or later) unbinds internal ports (Postgres, Redis, MinIO, API, Web) from host exposure (`ports: !reset []`), binds ingress strictly to loopback `${STAGING_BIND_IP:-127.0.0.1}:${STAGING_PORT:-80}:8080` by default for Cloudflare Tunnel origin isolation (zero public host ports exposed), and enforces genuinely required staging secrets (`POSTGRES_PASSWORD`, `TOKEN_ENCRYPTION_KEY`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, `OBJECT_STORAGE_PUBLIC_ENDPOINT`, `FRONTEND_URL`, `API_PUBLIC_URL`, `NEXT_PUBLIC_API_URL`) without unused variables (`SESSION_SECRET`, `JWT_SECRET`, `COOKIE_SECRET`). Fail-fast public storage validation (`validateStoragePublicEndpoint`) strictly rejects internal Docker hostnames (`minio`) in production and enforces HTTPS. Express proxy trust defaults to `TRUST_PROXY: "${TRUST_PROXY:-2}"` for 2-hop Cloudflare Tunnel routing with comprehensive rate-limiting and anti-spoofing tests. CI port inspection asserts that non-ingress backing services have zero published host ports. Stdin-streaming disaster recovery procedures documented for custom-format PostgreSQL dumps. Comprehensive Phase 6.6 Staging Operator Runbook (`docs/phase-6-6-staging-operator-runbook.md`, PR #43) merged and verified in CI, detailing preflight prerequisites, host security baseline and dynamic SSH lockout prevention (§5.1), loopback NGINX ingress with Cloudflare Tunnel origin routing, Cloudflare R2 browser presigned upload configuration, fail-safe migration execution capturing non-zero exit codes (§8.1), operational workflows, health check diagnostics, and isolated rehearsal procedures for PostgreSQL database restore (Gate G18) and media volume restore with representative retrieval verification (Gate G19). _Verification boundaries_: Implementation, readiness documentation, and operator runbook merged into `main` and automated tests passed (YES: 24 staging regression tests, 16 trust-proxy tests, 12 storage-endpoint tests, 12 auth tests, 2 worker publishing tests, 270 API unit tests across 22 test files), Docker ingress and loopback host isolation smoke test passed in CI (YES), 6 required pre-merge checks passed on PR HEAD `70e1b60` (YES), 5 post-merge check runs passed on merge commit `cf393c8` (YES, Run #41212384042); Live operator verification pending: VPS host setup, Cloudflare Tunnel provisioning on host, Cloudflare R2 bucket CORS policy and credentials, secure staging secrets provisioning, and live restore rehearsals G18 and G19 (RELEASE GATE: STRICT NO-GO).
  - **Secret Management**: PARTIAL. Environment variable templates documented in `.env.example` (including `TOKEN_ENCRYPTION_KEY`, LinkedIn OAuth credentials [`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`], and `FRONTEND_URL`). `docker-compose.yml` requires an explicitly supplied `TOKEN_ENCRYPTION_KEY` for API and Worker services with zero default secret fallbacks. Test-only key explicitly supplied in CI smoke testing. Fail-fast credential validation enforced for LinkedIn provider without silent dummy fallbacks (PR #45). Untracked `packages/database/cookies.txt` from Git index while preserving local ignore status (PR #45). Production external secret store integration (e.g., Vault / AWS Secrets Manager) remains deferred.
  - **Observability**: COMPLETE AND VERIFIED. Structured Pino logging configured across API and Worker (`logger.config.ts`), with correlation ID validation and propagation across HTTP requests and BullMQ queue jobs (`SyncJobData`, `PublishJobData`, `PublishDeleteJobData`), sensitive credential and header redaction (snake_case and camelCase tokens, secrets, cookies), request URL query parameter sanitization (`url-sanitizer.utils.ts`), required `PinoLogger` dependency injection, and comprehensive unit and integration test suites.
  - **Tenancy Verification**: COMPLETE AND VERIFIED. Cross-workspace checks and `WorkspaceGuard` are enforced (e.g., in `analytics.controller.ts`).
  - **OAuth Hardening (CSRF/PKCE)**: COMPLETE AND VERIFIED. `auth.guard.ts` enforces CSRF headers for mutations. `linkedin.provider.ts` supports PKCE via `codeChallenge` and `codeVerifier`.
  - **Queue Reliability**: COMPLETE AND VERIFIED. `sync.processor.ts` implements intelligent backoff using `moveToDelayed` for `ProviderRateLimitError`, gracefully handles `401 Unauthorized` by marking accounts for re-authentication, and handles failed jobs properly.
  - **CI/Testing Hardening**: PARTIAL. High-quality isolated tests exist for the worker (`sync.processor.spec.ts`), but full E2E testing across API and frontend is missing.

---

## Executive Summary

1. **Last definitely completed phase**: Phase 5 (Analytics).
2. **Current active phase**: Phase 6 (Hardening).
3. **Exact Phase 6 items already finished**: Tenancy verification (WorkspaceGuard), OAuth Hardening (PKCE + CSRF), Token Encryption (AES-256-GCM logic + fail-fast 64-hex startup validation in API/Worker), Environment Secret Documentation (.env.example templates), Docker Compose Required Secret Enforcement, Queue Reliability (BullMQ backoffs), Ingress Rate Limiting (`APP_GUARD` + Redis Throttler), Audit Logging (`AuditService` and transactional audit persistence), Container Hardening (Node `dist` execution, workspace-aware production Docker runner slimming), Observability (Structured Pino logging, request/job correlation propagation, sensitive credential redaction, and URL sanitization), Staging/Deployment Hardening & Safety Corrections (unified NGINX ingress, staging compose loopback isolation for Cloudflare Tunnel, fail-fast browser-reachable object storage validation rejecting `minio` in production, `TRUST_PROXY=2` hop configuration and tests, CI zero-host-port inspection, stdin-streaming disaster recovery procedures), Staging Operator Runbook (PR #43 comprehensive 791-line operator runbook covering host preparation, dynamic SSH port detection, Cloudflare Tunnel, R2 storage, migration failure safety, isolated DB and media restore drills, and 19-point release gates G1-G19).
4. **Exact Phase 6 items partially implemented**: Secret management (environment configuration, fail-fast startup validation, and staging compose secret enforcement complete; production external secrets vault integration remains deferred).
5. **Exact Phase 6 items not started / deferred**: External secret vault integration (HashiCorp Vault / AWS Secrets Manager) deferred for production; live VPS deployment, Cloudflare Tunnel provisioning, Cloudflare R2 bucket CORS/credentials, staging secrets provisioning, and live restore rehearsals (G18 and G19) remain pending external operator infrastructure actions (Release Gate: STRICT NO-GO).
6. **Most likely last task Claude Code was working on**: Implementing the background analytics synchronization worker (`apps/worker/src/sync/sync.processor.ts`) and writing its tests, while concurrently adding initial Phase 6 queue reliability and token encryption logic necessary for the worker to function securely.
7. **Exact next task that should be continued**: Phase 7.1 — Publishing Domain & Provider Capability Design (following complete hardening of Phase 6).

---

## CI Tests Fix on Branch `fix/sync-idor`

### 1. CI Tests Failure Cause

- **Missing / Misconfigured `TEST_DATABASE_URL`**: `TEST_DATABASE_URL` was originally missing from the `Run Tests` step's environment in `.github/workflows/ci.yml` (and had been mistakenly placed into the `Smoke test Compose stack` step with typos: username `postgresql` instead of `postgres` and password `passord` instead of `password`). In CI, where no root `.env` exists on the runner, `test-setup.ts` failed fast with `Error: TEST_DATABASE_URL is not set in root .env. Loaded from: null`.
- **Missing `TOKEN_ENCRYPTION_KEY`**: The API and worker tests (specifically `sync.processor.spec.ts`) invoke `encrypt()` from `@agency-os/database/src/crypto/encryption.ts`. When `TOKEN_ENCRYPTION_KEY` was absent in the CI test step, `getEncryptionKey()` threw `TOKEN_ENCRYPTION_KEY environment variable is missing`.
- **Turborepo Strict Env Filtering**: Turborepo v2 executes tasks in `strict` environment mode by default, stripping undeclared environment variables from child subprocesses (`pnpm run test`). Setting `TURBO_ENV_MODE: loose` / `--env-mode=loose` ensures all required test environment variables are properly passed down to Vitest and Jest.

### 2. Corrected `TEST_DATABASE_URL`

```yaml
TEST_DATABASE_URL: postgresql://postgres:password@localhost:5432/agency_os_test?schema=public
```

(Matches PostgreSQL CI service container credentials: user `postgres`, password `password`, database `agency_os_test`).

### 3. Added Test-Only `TOKEN_ENCRYPTION_KEY`

```yaml
TOKEN_ENCRYPTION_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

(32-byte hexadecimal key for CI test runs).

### 4. Final CI Result

- **Status**: PASSED (Green)
- **Local Verification**: 5/5 monorepo packages passed (`@agency-os/database`, `@agency-os/providers`, `@agency-os/api`, `@agency-os/web`, `@agency-os/worker`), 82/82 worker tests passed, 73/73 database tests passed, 225/225 provider tests passed, 54/54 web tests passed.
- **GitHub PR Tests Check**: Verified green via GitHub Actions check-runs API.

---

## Web Build Failures & Vitest Jest-DOM Fix on Branch `fix/sync-idor`

### 1. Root Cause of Build Failures

- **Root Cause**: Next.js executes TypeScript compilation (`tsc --noEmit`) across all files matched by `apps/web/tsconfig.json` during `next build`. Because `apps/web/test-setup.ts` imported `@testing-library/jest-dom` instead of `@testing-library/jest-dom/vitest`, Vitest's `Assertion` interface was not augmented with Testing Library DOM matchers (e.g., `toBeInTheDocument`, `toBeDisabled`, `toBeChecked`, `toHaveTextContent`, `toHaveAccessibleName`, `toHaveClass`).
- **Blast Radius**: This caused over 50 TypeScript compilation errors TS2339 in web spec files during `next build`, failing both `CI / Application Builds` (`pnpm turbo run build`) and `CI / Docker Build & Smoke Test` (`docker compose build web`).
- **Pre-existing Issue**: This was an existing CI/build issue present on `main` and across all historical runs, completely independent from and not introduced by the Sync IDOR fix.

### 2. Applied Fix

In `apps/web/test-setup.ts`, changed line 1 from:

```typescript
import "@testing-library/jest-dom";
```

to:

```typescript
import "@testing-library/jest-dom/vitest";
```

Additionally deleted unneeded scratch files (`last_user_prompt.txt`, `prompt.txt`, `patch.py`, `patch_tests.py`, `patch_status.js`, `patch_tests.js`).

### 3. Verification & CI Status

- **Jest-DOM Matcher Resolution**: Verified that 100% of the `toBeInTheDocument`, `toBeDisabled`, `toBeChecked`, `toHaveTextContent`, and related matcher type errors were eliminated.
- **Web Tests**: `pnpm --filter @agency-os/web test` passed completely (4/4 test files, 54/54 tests passing).
- **GitHub PR Checks (Commit 2d4c9e3 / Run 38738718718)**:
  - `CI / Application Builds`: **SUCCESS** (Green)
  - `CI / Docker Build & Smoke Test`: **SUCCESS** (Green)
  - `CI / Tests`: **SUCCESS** (Green)
  - `CI / Code Quality (Lint & Typecheck)`: **SUCCESS** (Green)
  - `GitGuardian Security Checks`: **SUCCESS** (Green)

---

## Resolution of Pre-Existing Web TypeScript Build Errors (Commit 2d4c9e3)

### 1. Root Cause of Pre-Existing Errors

1. **MockApiError in `page.spec.tsx` (TS7006, TS2339)**:
   - Untyped constructor parameters `(status, data, message)` caused implicit `any` errors under TypeScript strict mode.
   - Properties `status` and `data` were not declared on `MockApiError`, causing `Property does not exist on type 'MockApiError'`.
2. **FocusEventHandler Mismatch in `page.tsx` (TS2322)**:
   - `handleUpdate` has signature `(overrides?: Record<string, unknown>) => Promise<void>`.
   - Wiring `onBlur={handleUpdate}` caused TypeScript to reject assigning a function expecting `Record<string, unknown>` to React's `FocusEventHandler<HTMLInputElement>` (`FocusEvent` lacks index signature). Passing the raw event as `overrides` would also incorrectly spread event internals into API update payloads.
3. **XMLHttpRequest Mock in `media-uploader.spec.tsx` (TS2540, TS2554)**:
   - `this.status = 200` attempted direct mutation on the DOM `XMLHttpRequest.status` property, which is typed as `readonly`.
   - `this.onload()` was called with 0 arguments, but `onload` requires 1 argument (`ProgressEvent`).

### 2. Exact Minimal Fixes Applied

1. **`apps/web/src/app/[workspaceId]/publishing/[postId]/page.spec.tsx`**:
   - Explicitly typed constructor parameters `status: number`, `data: unknown`, `message: string`, and declared `public status: number`, `public data: unknown`, and `public headers: Record<string, string> = {}` on `MockApiError`, accurately matching `ApiError`'s shape.
2. **`apps/web/src/app/[workspaceId]/publishing/[postId]/page.tsx`**:
   - Replaced `onBlur={handleUpdate}` with `onBlur={() => handleUpdate()}` across Title, Category ID, and Tags inputs (lines 391, 419, 430), correctly invoking the handler with current state and no arguments.
3. **`apps/web/src/components/media-uploader.spec.tsx`**:
   - Initialized `status = 200` on `XHRMock` and used `Object.defineProperty(this, 'status', { value: 200, configurable: true })` instead of directly assigning to readonly `this.status`.
   - Invoked `this.onload(new ProgressEvent('load'))` with a valid `ProgressEvent`.

### 3. Local Verification Results

- `pnpm --filter @agency-os/web test`: **PASS** (4/4 test files, 54/54 tests passed).
- `pnpm --filter @agency-os/web build`: **PASS** (Exit code 0, TypeScript compiled in 3.6s, all static and dynamic routes generated).
- `pnpm turbo run typecheck`: **PASS** (Exit code 0, 5/5 tasks successful).
- `pnpm turbo run lint`: **PASS** (Exit code 0, 0 errors).

### 4. Final GitHub CI Status (Run 38738718718)

- `CI / Application Builds`: **SUCCESS** (Green)
- `CI / Docker Build & Smoke Test`: **SUCCESS** (Green)
- `CI / Tests`: **SUCCESS** (Green)
- `CI / Code Quality (Lint & Typecheck)`: **SUCCESS** (Green)
- `GitGuardian Security Checks`: **SUCCESS** (Green)

**PR Status**: All CI checks are green. The branch is now fully verified and merge-ready.

---

## Login Redirect Validation Hardening on Branch `fix/login-open-redirect` (Commit 6c8ad6b)

### 1. Root Cause of Encoded-Separator Bypass

- **Vulnerability**: Post-login redirection in `apps/web/src/app/login/page.tsx` was vulnerable to open redirection if an attacker supplied URL-encoded path separators (e.g. `/%2f%2fevil.com`, `/%2F%2FEvil.com`, `/%5cevil.com`, `/%5Cevil.com`, `/%2f/evil.com`).
- **Bypass Mechanism**: When decoded by downstream browser navigation or URL resolvers, `/%2f%2fevil.com` becomes `//evil.com` (a protocol-relative redirect), and `/%5cevil.com` becomes `/\evil.com` (which certain browsers resolve to `//evil.com`). Literal string checks matching only raw characters (`//` and `/\`) failed to intercept these percent-encoded sequences.
- **Fail-Closed on Malformed Encodings**: Sequences like `/%zz` or truncated sequences like `/%2` trigger `URIError` during percent-decoding and must fail closed (return `null`).
- **Query Parameter Preservation**: Legitimate URLs may contain encoded slashes within the query string (e.g. `/search?q=a%2fb`). Decoding the entire redirect string would corrupt query parameters or trigger false-positive rejections. Therefore, only the path portion (substring before the first `?` or `#`) must be decoded and inspected.

### 2. Exact Validation Logic Added

In `apps/web/src/lib/redirect.ts`:

1. **Path-only extraction**: Extracted the path portion prior to any query string (`?`) or hash fragment (`#`) using `redirect.split(/[?#]/)[0]`.
2. **Safe Decoding with Fail-Closed Error Handling**: Attempted `decodeURIComponent(pathPortion)`. If a `URIError` is thrown (e.g. malformed percent sequence), immediately return `null`.
3. **Decoded Separator Rejection**: Rejected the redirect if `decodedPath` starts with `//`, starts with `/\`, or contains any backslash `\`.
4. **Preserve Valid Routing & WHATWG Parsing**: Retained the existing WHATWG `URL` parse check with a local dummy base (`http://localhost`) to ensure origin and protocol remain local while preserving valid query strings and fragments.

### 3. Local Verification Results

- `pnpm --filter @agency-os/web test`: **PASS** (6/6 test files, 91/91 tests passed, including 21 redirect unit tests and 16 login page tests).
- `pnpm --filter @agency-os/web build`: **PASS** (Exit code 0, TypeScript compiled in 3.5s, all static and dynamic pages generated).
- `pnpm turbo run typecheck`: **PASS** (Exit code 0, 5/5 packages successful).
- `pnpm turbo run lint`: **PASS** (Exit code 0, 0 errors across all packages).

### 4. Final GitHub CI Status (Commit 6c8ad6b / Run 38746197037)

- `GitGuardian Security Checks`: **SUCCESS** (Green)
- `CI / Application Builds`: **SUCCESS** (Green)
- `CI / Docker Build & Smoke Test`: **SUCCESS** (Green)
- `CI / Tests`: **SUCCESS** (Green)
- `CI / Code Quality (Lint & Typecheck)`: **SUCCESS** (Green)

**PR Status**: PR #2 is fully hardened, verified, all CI checks are green, and it is ready for Muse re-review.

---

## Trust Proxy Configuration on Branch `fix/trust-proxy`

### 1. Confirmed Trust Proxy Root Cause

- **Vulnerability**: Express defaults `trust proxy` to `false`. Behind a TLS-terminating reverse proxy, load balancer, or cloud PaaS (e.g., Render, Nginx, AWS ALB), Express evaluates `req.ip` as the direct TCP connection peer (`req.socket.remoteAddress`), which is the internal reverse proxy IP (e.g. `10.x.x.x` or `172.x.x.x`), while ignoring `X-Forwarded-For`.
- **Global Rate-Limiting DoS**: Because NestJS `ThrottlerGuard` uses `req.ip` as its client tracker, all clients worldwide were grouped into a single rate-limiting bucket. In `RateLimitPolicies.auth`, 5 failed login attempts locked out all users globally for 15 minutes. In `RateLimitPolicies.baseline`, normal aggregate traffic across all users exceeded 100 req/min, causing global HTTP 429 throttling.
- **Protocol Mismatch**: Without proxy trust, `req.protocol` resolved to `'http'`, which broke OAuth callback URL generation when TLS terminated upstream.

### 2. Exact Environment Behavior & Supported Values

Implemented `parseTrustProxy` and `configureTrustProxy` in `apps/api/src/config/trust-proxy.ts` and wired into `apps/api/src/main.ts`:

- **Unset or Empty**:
  - Production (`NODE_ENV === 'production'`): Defaults to `1` (trusts exactly 1 upstream ingress proxy hop).
  - Non-production (local development/testing): Defaults to `false` (disabled, assumes direct connection; prevents header spoofing in local dev).
- **Explicit Numeric Values** (e.g., `TRUST_PROXY=1`, `TRUST_PROXY=2`):
  - Parsed as integer hop count. Express trusts that exact number of hops from the right of `X-Forwarded-For`.
  - Spoofed leftmost client headers are ignored.
- **Explicit Boolean Values**:
  - `TRUST_PROXY=false` or `TRUST_PROXY=0`: Disables proxy trust explicitly.
  - `TRUST_PROXY=true`: Enables full proxy trust.
    - **WARNING**: `TRUST_PROXY=true` trusts ALL `X-Forwarded-For` entries, including attacker-controlled values. Only use it behind a proxy that strips/overwrites incoming `X-Forwarded-For`. Never use it when the API is directly reachable from the public internet. Using it incorrectly defeats rate limiting and IP-based audit/logging protections.
- **Fail-Fast Validation**:
  - Malformed strings (e.g. `invalid`, `-1`, `1.5`, `NaN`, `yes`) throw an Error during startup, preventing accidental misconfiguration.
- **Deployment Requirement**:
  - The API must only be reachable through the trusted ingress/proxy. Direct public exposure of the API can defeat X-Forwarded-For spoofing protections.
- **`.env.example` Default**:
  - `# TRUST_PROXY=1` is commented out by default so that local development and non-production environments direct-connect safely without enabling proxy trust by default.
  - Comments provide guidance for local direct development (unset/false), standard single-ingress production (1), multi-hop proxy chains (exact hop count), and CDN additions like Cloudflare (e.g. increasing hop count from 1 to 2).
  - Explicit danger warning documented for `TRUST_PROXY=true`.

### 3. Tests Added

In `apps/api/src/config/trust-proxy.spec.ts` (12 tests, all passing):

- Proved development mode with no `TRUST_PROXY` defaults to `false` and does not trust forwarded IP headers.
- Proved production mode with no `TRUST_PROXY` defaults to 1 hop.
- Proved explicit numeric values (`1`, `2`, `5`) and booleans (`true`, `false`, `0`) are honored.
- Proved malformed values fail fast with descriptive validation errors.
- Proved forwarded client IP resolves correctly through one trusted hop in live Express request tests.
- Proved spoofed leftmost `X-Forwarded-For` entries are not trusted over the proxy-appended IP.
- Proved `X-Forwarded-Proto=https` resolves `req.protocol` to `https` and `req.secure` to `true`.
- **3-Entry Spoof Chain (Test A)**: Sent `X-Forwarded-For: 1.1.1.1, 2.2.2.2, 203.0.113.50` with `trust proxy = 1`; asserted `req.ip === '203.0.113.50'` and explicitly `req.ip !== '1.1.1.1'` and `req.ip !== '2.2.2.2'`, proving only the rightmost upstream-appended address is trusted.
- **Pinned Dangerous `true` Semantics (Test B)**: Sent `X-Forwarded-For: 1.1.1.1, 203.0.113.50` with `trust proxy = true`; asserted `req.ip === '1.1.1.1'`, intentionally documenting and pinning the dangerous semantics of trusting all proxy hops.

### 4. Re-Verification Classifications

- **Logout Cookie Clearing (FALSE POSITIVE)**: Re-evaluated and confirmed that RFC 6265/RFC 6265bis identifies cookies strictly by `[Name, Domain, Path]`. Because both `login` and `logout` use identical host-only domains and default `Path=/`, compliant browsers successfully evict the cookie when `Expires` is set to 1970. Server-side session invalidation in Redis also guarantees revocation.
- **CSRF Split-Domain Compatibility (ARCHITECTURAL / DEPLOYMENT ITEM)**: The double-submit CSRF mechanism relies on frontend JavaScript accessing `document.cookie`. This is 100% compatible under same-origin gateways (e.g., reverse proxy mapping `/api`). Cross-subdomain deployments require configuring `COOKIE_DOMAIN` or returning `csrfToken` via response body. No code changes were made to CSRF or cookies in this task.
- **OAuth Callback URL (FOLLOW-UP ITEM)**: Dynamically generating OAuth redirect URIs from `req.protocol` + `req.get('host')` remains functional with trust proxy enabled, but introducing an explicit `API_PUBLIC_URL` is recommended as a deterministic follow-up item.

### 5. Local Verification Results

- `pnpm --filter @agency-os/api test`: **PASS** (14/14 test files, 95/95 tests passing).
- `pnpm turbo run typecheck`: **PASS** (Exit code 0, 5/5 tasks successful).
- `pnpm turbo run lint`: **PASS** (Exit code 0, 0 errors, zero new warnings).
- `pnpm turbo run build`: **PASS** (API, Web, Worker all compiled successfully).

### 6. GitHub CI Checks Status (Commit e5665a6 / PR #3)

- `GitGuardian Security Checks`: **SUCCESS** (Green)
- `CI / Application Builds`: **SUCCESS** (Green)
- `CI / Docker Build & Smoke Test`: **SUCCESS** (Green)
- `CI / Tests`: **SUCCESS** (Green)
- `CI / Code Quality (Lint & Typecheck)`: **SUCCESS** (Green)

---

## Deterministic OAuth Public URL Configuration on Branch `fix/oauth-public-url`

### 1. Root Cause & Reliability/Security Analysis

- **Reliability Flaw**: `apps/api/src/modules/oauth/oauth.controller.ts` previously derived the OAuth callback redirect URI dynamically from `${req.protocol}://${req.get('host')}/api/v1/oauth/${provider.toLowerCase()}/callback` in two separate HTTP requests (`connectProvider` and `callbackProvider`). In multi-tier topologies (reverse proxies, API gateways, Docker Compose, Kubernetes), the client-to-API connect request (often internal or proxy-routed) and the user's top-level browser callback navigation frequently presented divergent host headers or schemes. Any byte-level divergence causes RFC 6749 token exchange failure (`redirect_uri_mismatch`).
- **Security & Topology Leakage**: Unsanitized `Host` headers allowed untrusted values to be passed into external OAuth authorization requests, and internal cluster hostnames (e.g. `api:3001` or `.local` domains) leaked into third-party redirect URLs.
- **Provider Requirements**: External providers (LinkedIn, Google/YouTube, Meta) require pre-registered, exact, static redirect URIs in their developer consoles. A deterministic `API_PUBLIC_URL` aligns runtime execution with developer portal whitelists.

### 2. Validation & Normalization Rules (`apps/api/src/config/public-url.ts`)

Implemented `parseApiPublicUrl` and `getPublicApiUrl`:

- **Production (`NODE_ENV === 'production'`)**:
  - `API_PUBLIC_URL` is **REQUIRED**. Missing or empty string throws a fail-fast error on startup/invocation.
  - Protocol must be **HTTPS** (`https://`), **except for local loopback hosts** (`localhost`, `127.0.0.1`, `[::1]`) which are permitted to support local production-like Docker Compose environments.
  - All non-loopback `http://` URLs (such as `http://api.example.com`, `http://10.0.0.1:3001`, `http://192.168.1.1:3001`) in production strictly throw with a descriptive error message.
  - Must parse as a valid WHATWG URL.
  - Rejects URLs containing query parameters (`?`), hash fragments (`#`), or embedded user credentials (`user:pass@`).
  - Normalizes trailing slashes (`.replace(/\/+$/, '')`) so `${apiPublicUrl}/api/v1/...` never produces accidental double slashes (`//api/...`).
- **Development & Testing (`NODE_ENV !== 'production'`)**:
  - `API_PUBLIC_URL` is **OPTIONAL**.
  - If unset or empty, falls back deterministically to `http://localhost:${process.env.PORT || 3001}` without depending on untrusted request headers.
  - If provided, validated and normalized (`http:` and `https:` both permitted for localhost and dev tunnels).

### 3. Fail-Fast Startup Validation in `apps/api/src/main.ts`

- Wired `getPublicApiUrl()` directly into `bootstrap()` immediately after `isProduction` is computed.
- If `API_PUBLIC_URL` is missing or invalid in a production deployment, the server aborts startup immediately at deploy time rather than failing lazily when a user initiates an OAuth connection.

### 4. Controller Integration & Host Header Immunity

- Updated `apps/api/src/modules/oauth/oauth.controller.ts`:
  - `connectProvider()` and `callbackProvider()` now construct `redirectUri` exclusively via `getPublicApiUrl()`:
    `${apiPublicUrl}/api/v1/oauth/${provider.toLowerCase()}/callback`
  - Replaced all dependencies on `req.protocol` and `req.get('host')`.
  - The callback URI is 100% immune to `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` request headers.
  - The exact same deterministic URI is used for authorization URL generation and token exchange across all providers (**LinkedIn**, **YouTube**, and **Meta**).

### 5. Configuration Updates

- `.env.example`: Added documented `API_PUBLIC_URL=http://localhost:3001` with instructions for production HTTPS requirements (noting the loopback exception) and local development defaults.
- `docker-compose.yml`: Added `API_PUBLIC_URL: http://localhost:3001` to the `api` service environment.
- `.github/workflows/ci.yml`: Added `API_PUBLIC_URL: http://localhost:3001` to the smoke test Compose stack step environment.

### 6. Tests Added

- `apps/api/src/config/public-url.spec.ts` (14 tests):
  - Validated production HTTPS URLs and trailing slash normalization.
  - Proved fail-fast rejection when `API_PUBLIC_URL` is missing or empty in production.
  - Proved production allows loopback HTTP (`http://localhost:3001`, `http://127.0.0.1:3001`, `http://[::1]:3001`).
  - Proved production rejects non-loopback HTTP (`http://api.example.com`, `http://10.0.0.1:3001`, `http://192.168.1.1:3001`) with explicit error messages.
  - Proved rejection of non-HTTP(S) schemes, queries, fragments, credentials, and malformed strings.
  - Proved development fallback to local port and custom development hosts/tunnels.
- `apps/api/src/modules/oauth/oauth.controller.spec.ts` (12 tests):
  - Proved `connectProvider` and `callbackProvider` use `API_PUBLIC_URL` for redirect URI.
  - Proved immunity against `Host` and `X-Forwarded-Host` headers in both connect and callback flows.
  - Proved trailing slash normalization in generated callback URIs.
  - Proved multi-provider consistency across LinkedIn, YouTube, and Meta.
- `apps/api/src/modules/oauth/oauth.service.spec.ts` (12 tests):
  - Added dedicated test proving `generateAuthUrl` and `handleOAuthCallback` forward the exact `redirectUri` argument to underlying provider adapters and external token endpoints with full fidelity.

### 7. Local Verification Results

- `pnpm --filter @agency-os/api test`: **PASS** (15/15 test files, 117/117 tests passing).
- `pnpm turbo run typecheck`: **PASS** (5/5 tasks successful).
- `pnpm turbo run lint`: **PASS** (5/5 tasks successful, 0 errors, 0 new warnings).
- `pnpm turbo run build`: **PASS** (API, Web, Worker all compiled successfully).

### 8. GitHub CI Checks Status (PR #4)

- PR: `#4` (`fix/oauth-public-url`)
- Previous HEAD `a383aee`: All 5 CI checks **SUCCESS** (Green).

---

## Provider Token Expiry & Centralized Worker Refresh (PR #5) — MERGED

### 1. Merge & Release Summary

- **PR**: [#5](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/5) (`fix/provider-token-refresh`)
- **Status**: **MERGED**
- **Approved Head SHA**: `ef71244`
- **Final Merge Commit SHA**: `0d862ca187bda6c11d11294138c2a5e9cbd5b4f9` (`0d862ca`)
- **Merged Into**: `main`
- **GitHub Actions CI**: All 5 check-runs completed **SUCCESS** (Green).
- **Automated Test Results**: **453 / 453 tests passed** across all packages (`providers`: 231/231, `worker`: 105/105, `api`: 117/117).
- **Static Analysis & Builds**: Turbo typecheck (5/5), turbo lint (5/5, 0 errors), turbo build (3/3) all clean.

### 2. Verified Root Cause & Gaps

- **Lack of Refresh Contract in Provider Core**: `ISocialProvider` lacked any refresh abstraction (`refreshCredentials` method was absent from the interface and from all concrete provider classes).
- **Silent Inability to Refresh in Worker**: `apps/worker/src/sync/sync.processor.ts` performed a raw check on `expiresAt < new Date()`. If expired, it immediately flipped `SocialAccount.status` to `REAUTH_REQUIRED` and skipped sync, even though valid encrypted refresh tokens existed in `SocialConnection`.
- **Duplicate, Non-Centralized Decryption Logic**: `SyncProcessor` and `PublishingProcessor` each decrypted stored access tokens independently, bypassing centralized token validity and freshness checks.
- **Publishing Worker Missing Auth Status Updates**: When `PublishingProcessor` encountered credential acquisition failures or provider `AUTH_REQUIRED` failure results, `SocialAccount.status` was not consistently updated to `REAUTH_REQUIRED`, allowing subsequent jobs to attempt publication with broken tokens.

### 3. Provider-Specific Token Lifecycle & Refresh Implementation

- **Provider Core Contract (`packages/providers/core/interfaces/ISocialProvider.ts`)**:
  - Added optional `refreshCredentials?(refreshToken: string): Promise<OAuthCredentials>` to `ISocialProvider`.
- **YouTube (`packages/providers/youtube/youtube.provider.ts`)**:
  - Implemented `refreshCredentials` calling Google OAuth2 token endpoint `https://oauth2.googleapis.com/token` (`grant_type=refresh_token`).
  - Added `fetchWithTimeout(..., 7000)`: guarantees HTTP refresh call will timeout at 7,000ms (strictly less than Redis lock TTL of 10,000ms).
  - Redacts sensitive secrets (`clientSecret` and `refreshToken`) from error messages using `replaceAll`.
  - Supports token rotation: if Google returns a new `refresh_token`, it is captured; if omitted, the existing refresh token is preserved.
  - Returns calculated `expiresAt = new Date(Date.now() + expires_in * 1000)`.
- **LinkedIn (`packages/providers/linkedin/linkedin.provider.ts`)**:
  - Implemented `refreshCredentials` calling LinkedIn token endpoint `https://www.linkedin.com/oauth/v2/accessToken` (`grant_type=refresh_token`).
  - Added `fetchWithTimeout(..., 7000)`: guarantees HTTP refresh call will timeout at 7,000ms (strictly less than Redis lock TTL of 10,000ms).
  - Redacts sensitive secrets (`clientSecret` and `refreshToken`) from error messages using `replaceAll`.
  - Supports token rotation with `refresh_token`.
  - Computes `expiresAt = new Date(Date.now() + expires_in * 1000)`.
- **Meta / Instagram (`packages/providers/meta/meta.provider.ts`)**:
  - Explicitly does NOT add generic refresh credentials method. Meta user tokens are exchanged via server-side OAuth flow for 60-day long-lived tokens and carry an explicit ~60-day `expiresAt` in the DB.
  - When within the 5-minute pre-expiry window, if `expiresAt > now`, `TokenService` recognizes the token is still valid, keeps the account `ACTIVE`, and returns the decrypted token without marking `REAUTH_REQUIRED`.
  - Only when actually expired (`expiresAt <= now`) or when an explicit HTTP 401 / OAuthException is returned during execution is the account transitioned to `REAUTH_REQUIRED`.

### 4. Centralized `TokenService` & Concurrency Architecture (`apps/worker/src/publishing/token.service.ts`)

- **Single Execution Credential Authority**: All workers (`SyncProcessor`, `PublishingProcessor`) resolve execution credentials solely through `tokenService.getExecutionCredentials(socialAccountId, workspaceId)`. Tenant isolation is enforced via optional `workspaceId`.
- **Preemptive Freshness Threshold**: Tokens expiring within 5 minutes (`now >= expiresAt - 5m`) or already expired trigger automatic refresh before worker execution, while still-valid non-refreshable tokens return cleanly until actually expired.
- **Distributed Concurrency Lock & Extended Contention Wait**:
  - Uses Redis `SET lock:refresh:${socialAccountId} <lockToken> PX 10000 NX` to reduce concurrent refresh attempts across workers.
  - While Redis locking significantly reduces duplicate provider refresh requests, the design does NOT claim mathematically perfect exactly-once external provider invocation (e.g. under edge network partitions, Redis failover, or clock skew).
  - Outbound provider HTTP requests are strictly bounded below the lock TTL using a 7,000ms abort timeout (`fetchWithTimeout`), guaranteeing the provider call times out before the 10,000ms Redis lock expires.
  - Contention wait loop extends to 50 attempts * 200ms = 10,000ms (matching the 10-second lock TTL) with double-checked DB re-reading every 200ms to immediately return fresh credentials when an in-flight refresh completes.
  - Safe lock release uses a Lua script (`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`) ensuring a worker whose lock expired never inadvertently releases a subsequent worker's lock.
- **CAS (Compare-And-Swap) Persistence & Fencing**:
  - State convergence and credential integrity are guaranteed at the database layer rather than relying solely on distributed locking.
  - Persists new ciphertext, IV, auth tag, key version, and new `expiresAt` using `tx.socialConnection.updateMany({ where: { socialAccountId, encryptedRefreshToken: oldEncryptedRefreshToken }, data: updateData })`.
  - Stale workers that completed refresh after another worker cannot overwrite the winning credential state; if `casResult.count === 0`, the losing worker discards its stale credential response, re-reads the fresh token from DB, and returns the winning state.
- **Failure Fencing on Refresh Errors**:
  - When a worker encounters an auth invalidation error (e.g. HTTP 400 `invalid_grant`) during refresh, it re-reads `SocialConnection` from DB before mutating status.
  - If another worker already successfully refreshed and stored new credentials in DB (changing `encryptedRefreshToken` or setting fresh `expiresAt`), the current worker recovers the fresh token without marking `REAUTH_REQUIRED`.
  - Only genuine auth failures where the DB state has not been updated mark `SocialAccount.status = REAUTH_REQUIRED`.

### 5. Error Classification & Handling

- **Semantic Evidence Required for Permanent Auth Failure (`REAUTH_REQUIRED`)**:
  - HTTP 401 Unauthorized, or HTTP 400 specifically accompanied by OAuth error indicators (`invalid_grant`, `invalid_token`, `unauthorized`, `revoked`, `expired`, `token_expired`), marks `SocialAccount.status = REAUTH_REQUIRED` and throws `AuthRequiredError`.
  - Bare HTTP 400 responses, `invalid_client` configuration errors, and generic `invalid_request` errors are classified as transient/configuration errors and rethrown without marking `REAUTH_REQUIRED`.
- **Transient Failures (Retryable)**:
  - Network timeouts, DNS errors, HTTP 5xx responses, and Redis lock acquisition timeouts are rethrown without modifying `SocialAccount.status`, allowing standard BullMQ queue backoff retries.

### 6. Processor Integrations

- **`apps/worker/src/sync/sync.processor.ts`**:
  - Injected `TokenService` and removed inline decryption; passes `workspaceId` for tenant scoping.
  - Catches `AuthRequiredError`, records `syncRun` status as `SKIPPED` with reason `expired_token`, and skips execution without retrying.
  - Transient errors bubble up as standard errors so BullMQ retries with exponential backoff (no longer converts transient errors into `UnrecoverableError`). Only missing required job inputs or missing account throw `UnrecoverableError`.
- **`apps/worker/src/publishing/publishing.processor.ts`**:
  - Updated credential acquisition in `process` and `processDelete` to pass `workspaceId`.
  - Split credential acquisition error handling: only `AuthRequiredError` sets `socialAccount.status = REAUTH_REQUIRED` and calls `handleFailure(..., 'AUTH_REQUIRED', ...)`.
  - Transient credential acquisition errors (e.g. lock acquisition timeout, 5xx) log a warning and rethrow so BullMQ retries the job without failing the publication or marking the account `REAUTH_REQUIRED`.

### 7. Test Coverage Added

- **`packages/providers/youtube/youtube.provider.spec.ts`**:
  - Unit tests verifying Google OAuth2 refresh endpoint call, token rotation, and refresh token preservation.
- **`packages/providers/linkedin/linkedin.provider.spec.ts`**:
  - Unit tests verifying LinkedIn OAuth2 refresh endpoint call, rotated refresh tokens, and parameter formatting.
- **`apps/worker/src/publishing/token.service.spec.ts`**:
  - 17 comprehensive unit & integration tests covering fresh tokens, perpetual Meta tokens, preemptive refresh, token preservation, token rotation, still-valid <5m non-refreshable tokens, bare HTTP 400 vs 400 `invalid_grant` vs config errors (`invalid_client`, `invalid_request`), missing refresh token handling, Redis distributed concurrency, Lua lock release safety, CAS conflict fencing, and failure fencing.
- **`apps/worker/src/sync/sync.processor.spec.ts`**:
  - Added test verifying expired YouTube token with valid refresh token refreshes credentials and completes sync successfully.
  - Added test verifying transient credential acquisition errors keep account `ACTIVE` and rethrow for BullMQ retry without `UnrecoverableError`.
- **`apps/worker/src/publishing/publishing.worker.spec.ts`**:
  - Added tests verifying `socialAccount.status` transitions to `REAUTH_REQUIRED` when provider returns `AUTH_REQUIRED` or `TokenService` throws `AuthRequiredError`.
  - Added tests verifying transient credential errors keep account `ACTIVE` and rethrow for BullMQ retry without terminal `AUTH_REQUIRED` attempt failure.

### 8. Verification Results & CI Status

- `pnpm --filter @agency-os/providers test`: **PASS** (15/15 test files, 231/231 tests passing).
- `pnpm --filter @agency-os/worker test`: **PASS** (9/9 test files, 105/105 tests passing).
- `pnpm --filter @agency-os/api test`: **PASS** (15/15 test files, 117/117 tests passing).
- `pnpm turbo run typecheck`: **PASS** (5/5 tasks successful).
- `pnpm turbo run lint`: **PASS** (5/5 tasks successful, 0 errors, 0 new warnings).
- `pnpm turbo run build`: **PASS** (All packages built successfully).
- **GitHub Check Runs (PR #5 / Head `ef71244`)**:
  - `Docker Build & Smoke Test`: **SUCCESS** (Green)
  - `Code Quality (Lint & Typecheck)`: **SUCCESS** (Green)
  - `Application Builds`: **SUCCESS** (Green)
  - `Tests`: **SUCCESS** (Green)
  - `GitGuardian Security Checks`: **SUCCESS** (Green)

### 9. Non-Blocking Concurrency Follow-Up (Future Hardening)

> [!NOTE]
> **NON-BLOCKING FOLLOW-UP**:
> There is a narrow Time-Of-Check to Time-Of-Use (TOCTOU) window between:
>
> 1. A stale worker re-reading `SocialConnection` from the database upon receiving a permanent refresh error (such as HTTP 400 `invalid_grant`), and
> 2. The subsequent update setting `SocialAccount.status = SocialAccountStatus.REAUTH_REQUIRED`.
>
> If a winning concurrent worker successfully commits fresh credentials immediately after the stale worker's re-read check but before its status update, the stale worker could still mark the account `REAUTH_REQUIRED`.
>
> **Recommended future hardening**:
> Fence the `REAUTH_REQUIRED` status update using the same credential/CAS condition (e.g. executing the status update conditionally or verifying that the connection's `encryptedRefreshToken` / `updatedAt` still matches the failed credential snapshot) so the status update only succeeds if the failed credential state is still current.

---

## Comprehensive Review Backlog & Architecture Re-Evaluation (Post-PR #5)

### 1. Re-Evaluation of Cookie Clearing on Logout (VERIFIED FALSE POSITIVE)

- **Previous Claim**:
  It was previously hypothesized that `res.clearCookie('session')` and `res.clearCookie('csrfToken')` in [`apps/api/src/modules/auth/auth.controller.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/auth/auth.controller.ts) fail to evict cookies from the client browser because they omit `secure: true` and `sameSite: 'lax'`, thereby supposedly leaving active session cookies stored on the client.
- **Empirical Code & RFC 6265 Verification**:
  1. **RFC 6265 Storage Key Model**: Per RFC 6265 Section 5.3 ("Storage Model") and Section 5.4 ("The Cookie Header"), user agents store and match cookies based strictly on the tuple:
     $$\text{Key} = (\text{name}, \text{domain}, \text{path})$$
     Attributes such as `Secure`, `HttpOnly`, and `SameSite` are transport and accessibility constraints; they are **not** part of the cookie lookup key during eviction.
  2. **Express `res.cookie` vs `res.clearCookie` Parameter Matching**:
     - At login ([`auth.controller.ts#L75-L89`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/auth/auth.controller.ts#L75-L89)):
       ```typescript
       res.cookie("session", session.sessionId, {
         httpOnly: true,
         secure: process.env.NODE_ENV === "production",
         sameSite: "lax",
         expires: session.expiresAt,
       });
       res.cookie("csrfToken", session.csrfToken, {
         httpOnly: false,
         secure: process.env.NODE_ENV === "production",
         sameSite: "lax",
         expires: session.expiresAt,
       });
       ```
       Because no explicit `path` option is provided, Express defaults `path: '/'`. Because no explicit `domain` option is provided, Express emits a host-only cookie for the request host.
     - At logout ([`auth.controller.ts#L115-L116`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/auth/auth.controller.ts#L115-L116)):
       ```typescript
       res.clearCookie("session");
       res.clearCookie("csrfToken");
       ```
       Express `res.clearCookie(name)` defaults `path: '/'` and sets `expires: new Date(1)` (`Thu, 01 Jan 1970 00:00:00 GMT`).
       The emitted HTTP response headers are:
       ```http
       Set-Cookie: session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
       Set-Cookie: csrfToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
       ```
       Because `name`, `domain` (host-only), and `path` (`/`) match identically with the stored cookie, compliant browsers immediately evict both cookies from storage.
  3. **Immediate Server-Side Session Revocation**:
     Regardless of client-side cookie storage or client compliance, `AuthService.logout()` unconditionally destroys the server-side session in Redis:
     ```typescript
     await this.sessionManager.deleteSession(sessionId);
     ```
     Any subsequent request carrying the evicted or copied session cookie is rejected immediately by [`AuthGuard`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/auth/guards/auth.guard.ts) with `401 Unauthorized` because `sessionManager.getSession(sessionId)` returns `null`.
- **Classification**: **VERIFIED FALSE POSITIVE / NON-ISSUE**. No application code changes are required or warranted.

### 2. Cross-Subdomain CSRF Architecture (ARCHITECTURAL DEPLOYMENT DECISION)

- **Distinction from Cookie Clearing**:
  Cross-subdomain CSRF compatibility is an infrastructure topology design decision, entirely distinct from logout cookie clearing.
- **Repository Implementation Analysis**:
  1. `csrfToken` is currently set as a host-only cookie (`httpOnly: false`, without an explicit `domain` attribute).
  2. The frontend web application ([`apps/web/src/lib/api/client.ts`](file:///C:/Users/bappa/agency-os/apps/web/src/lib/api/client.ts#L20-L26)) reads `document.cookie` to extract `csrfToken` and submits it via the `x-csrf-token` header for mutating API requests.
- **Topology Analysis**:
  - **Single-Origin Reverse Proxy Gateway (Current Documented Topology)**:
    In [`docs/phase-6-readiness.md`](file:///C:/Users/bappa/agency-os/docs/phase-6-readiness.md#L71-L76), staging and production prerequisites specify a unified reverse proxy / ingress (e.g., NGINX, Traefik, Caddy, or AWS ALB) routing frontend traffic (`/`) to the Next.js service and API traffic (`/api/*`) to the NestJS service under the same origin (e.g., `https://app.example.com`). Under this unified topology, `document.cookie` seamlessly reads `csrfToken` because both services share the same origin and host-only cookie scope. The double-submit CSRF mechanism operates correctly without defect.
  - **Separate Subdomains Topology (`app.example.com` vs `api.example.com`)**:
    If an operator deploys the frontend and backend on distinct subdomains without a shared reverse proxy, standard browser same-origin policies prevent JavaScript executing on `app.example.com` from accessing host-only cookies set by `api.example.com`.
  - **Architectural Solutions (When Multi-Subdomain is Adopted)**:
    1. _Option A (Shared Parent Domain Cookie)_: Configure `COOKIE_DOMAIN=.example.com` so the browser permits subdomains to share the cookie.
    2. _Option B (Dedicated Token Handshake Endpoint)_: Expose an unauthenticated or session-authenticated `GET /api/v1/auth/csrf-token` endpoint returning `{ csrfToken }` in the JSON response body, enabling the client to store the CSRF token in memory.
    3. _Option C (Login Response Body Payload)_: Return `csrfToken` in the `/login` JSON response body alongside user metadata.
- **Classification**: **ARCHITECTURAL DEPLOYMENT DECISION REQUIRED**. Not a bug under the primary single-origin reverse proxy deployment pattern.

### 3. Prioritized Review Backlog Hierarchy & Status

Following the project's 7-tier prioritization hierarchy:

1. **Tier 1 — Cross-Tenant Data Isolation / IDOR**
2. **Tier 2 — Direct Authentication / Session Bypass**
3. **Tier 3 — Publishing / Worker Data Loss / State Corruption**
4. **Tier 4 — Provider Contract Compliance & Token Refresh**
5. **Tier 5 — Public API Contract / OAuth Callback Correctness**
6. **Tier 6 — Deployment / Infrastructure / Rate-Limiting Hardening**
7. **Tier 7 — Code Cleanup / Documentation / Non-Blocking Improvements**

| Priority Tier                            | Backlog Item                                                                                             | Target Components / Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status                                  | Severity / Classification                                    | Next Action                                                                                                                                                          |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- | :----------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tier 1: Tenant Isolation**             | Cross-tenant sync IDOR vulnerability                                                                     | `apps/worker/src/sync/sync.processor.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **MERGED** (PR #1, `cb37719`)           | High / Resolved                                              | Complete                                                                                                                                                             |
| **Tier 2: Auth Bypass**                  | Open redirect on login (`returnUrl`)                                                                     | `apps/api/src/modules/auth/auth.controller.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **MERGED** (PR #2, `862372c`)           | High / Resolved                                              | Complete                                                                                                                                                             |
| **Tier 2: Auth Bypass**                  | Trust Proxy unconfigured spoofing & rate-limit defeat                                                    | `apps/api/src/config/trust-proxy.ts`, `apps/api/src/main.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **MERGED** (PR #3, `f382a93`)           | High / Resolved                                              | Complete                                                                                                                                                             |
| **Tier 2: Auth Bypass**                  | Logout cookie clear omitting `Secure`/`SameSite`                                                         | `apps/api/src/modules/auth/auth.controller.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **DISMISSED**                           | **FALSE POSITIVE** (RFC 6265 Section 5.3 + Redis revocation) | None (Closed)                                                                                                                                                        |
| **Tier 3: Publishing / Data Loss**       | **Ambiguous Publication Reconciliation Transactionality, Metadata Synchronization, and Attributed RBAC** | [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts#L496-L623), [`apps/api/src/modules/publishing/controllers/publications.controller.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/controllers/publications.controller.ts#L194-L207), [`docs/AMBIGUOUS_PUBLICATION_RECONCILIATION_ARCHITECTURE.md`](file:///C:/Users/bappa/agency-os/docs/AMBIGUOUS_PUBLICATION_RECONCILIATION_ARCHITECTURE.md) | **MERGED** (PR #7, `d7f2d71`)           | High / Resolved & Hardened                                   | Complete                                                                                                                                                             |
| **Tier 4: Provider Token**               | Centralized worker token refresh & lifecycle management                                                  | `packages/providers/`, `apps/worker/src/publishing/token.service.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **MERGED** (PR #5, `0d862ca`)           | High / Resolved                                              | Complete                                                                                                                                                             |
| **Tier 5: API / OAuth Contract**         | Deterministic `API_PUBLIC_URL` for OAuth callbacks                                                       | `apps/api/src/config/public-url.ts`, `apps/api/src/modules/oauth/oauth.controller.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **MERGED** (PR #4, `28b9a2c`)           | Medium / Resolved                                            | Complete                                                                                                                                                             |
| **Tier 5: Product Core Feature**         | **Phase 5: Unified Workspace Analytics Dashboard & Account Detail View**                                 | `apps/web/src/app/[workspaceId]/analytics/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **MERGED / CLOSED** (PR #33, `90e6447`) | Medium / Core Product Capability                             | Authenticated workspace overview metrics, per-account breakdown, 30-day historical trend charts via recharts, loading/empty/403 states, 20 unit tests                |
| **Tier 6: Deployment Hardening**         | **Security Hygiene Preflight: Untrack `cookies.txt` & Fail-Fast LinkedIn Credentials**                   | `packages/database/cookies.txt`, `packages/providers/linkedin/linkedin.provider.ts`, `packages/providers/linkedin/linkedin.provider.spec.ts`, `packages/providers/core/__tests__/provider-registry.test.ts`, `apps/worker/src/publishing/token.service.spec.ts`, `.github/workflows/ci.yml`                                                                                                                                                                                                                                                                     | **MERGED** (PR #45, `3c89eee`)          | Medium / Security Hygiene                                    | Untracked cookies.txt without deletion, fail-fast LinkedIn credentials without dummy fallback, unit tests, 6 green pre-merge CI checks, 5 green post-merge CI checks |
| **Tier 6: Deployment Hardening**         | **Phase 6: Environment Secret Management & Fail-Fast Token Encryption Startup Validation**               | `packages/database/src/crypto/encryption.ts`, `apps/api/src/main.ts`, `apps/worker/src/main.ts`, `docker-compose.yml`, `.env.example`                                                                                                                                                                                                                                                                                                                                                                                                                           | **MERGED / CLOSED** (PR #35, `cb63286`) | Medium / Security Hardening                                  | 64-hex key validation, fail-fast startup checks, required compose secret interpolation, CI smoke test key provisioning, 23 unit tests                                |
| **Tier 6: Deployment Hardening**         | **Security Event Audit Logging Coverage & Explicit Persistence Semantics**                               | [`apps/api/src/modules/core/audit.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/core/audit.service.ts), [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts), [`packages/database/src/repositories/AuditLogRepository.ts`](file:///C:/Users/bappa/agency-os/packages/database/src/repositories/AuditLogRepository.ts)                                                                               | **MERGED** (PR #11, `546316a`)          | Medium / Resolved & Audited                                  | Complete                                                                                                                                                             |
| **Tier 6: Deployment Hardening**         | Cross-Subdomain CSRF Deployment Architecture                                                             | `apps/api/src/modules/auth/auth.controller.ts`, `docs/phase-6-readiness.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **DOCUMENTED ARCHITECTURE CONSTRAINT**  | Informational / Ingress Topology Requirement                 | Front web & API under unified reverse proxy or configure parent domain                                                                                               |
| **Tier 6: Deployment Hardening**         | Global Distributed Rate Limiting via Redis Throttler                                                     | `apps/api/src/app.module.ts`, `apps/api/src/modules/core/redis-throttler.storage.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **VERIFIED COMPLETE**                   | Medium / Ingress Abuse Prevention                            | Complete (`APP_GUARD` + Redis store verified)                                                                                                                        |
| **Tier 6: Deployment Hardening**         | **Phase 6.5: Unified Ingress Reverse Proxy & Staging Compose Configuration**                             | [`docker/nginx/nginx.conf`](file:///C:/Users/bappa/agency-os/docker/nginx/nginx.conf), [`docker-compose.staging.yml`](file:///C:/Users/bappa/agency-os/docker-compose.staging.yml), [`apps/api/src/config/staging-deployment.spec.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/config/staging-deployment.spec.ts)                                                                                                                                                                                                                                         | **MERGED** (PR #39, `dbc8938`)          | Medium / Deployment Hardening                                | Non-root NGINX ingress, host port isolation, required staging secret enforcement, 23 automated regression tests, CI smoke test                                       |
| **Tier 7: Concurrency & Data Integrity** | **Token Refresh `REAUTH_REQUIRED` CAS TOCTOU Fencing**                                                   | [`apps/worker/src/publishing/token.service.ts`](file:///C:/Users/bappa/agency-os/apps/worker/src/publishing/token.service.ts#L359-L540), [`apps/worker/src/publishing/token.service.spec.ts`](file:///C:/Users/bappa/agency-os/apps/worker/src/publishing/token.service.spec.ts#L688-L1075)                                                                                                                                                                                                                                                                     | **MERGED** (PR #9, `4752a15`)           | High / Resolved & Fenced                                     | Complete                                                                                                                                                             |
| **Tier 7: Concurrency & Data Integrity** | **Transactional Audit Writes for Draft Operations**                                                      | [`packages/database/src/repositories/AuditLogRepository.ts`](file:///C:/Users/bappa/agency-os/packages/database/src/repositories/AuditLogRepository.ts), [`apps/api/src/modules/core/audit.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/core/audit.service.ts), [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts)                                                                               | **MERGED** (PR #12, `8e94c62`)          | Medium / Resolved & Audited                                  | Complete                                                                                                                                                             |
| **Tier 7: Concurrency & Data Integrity** | **`updateDraft` In-Transaction Locked-Variant Concurrency Serialization**                                | [`packages/database/src/repositories/PublishingRepository.ts`](file:///C:/Users/bappa/agency-os/packages/database/src/repositories/PublishingRepository.ts), [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts), [`apps/api/test/publishing.e2e-spec.ts`](file:///C:/Users/bappa/agency-os/apps/api/test/publishing.e2e-spec.ts)                                                                                       | **MERGED** (PR #14, `279b4c5`)          | Low / Resolved & Fenced                                      | Complete                                                                                                                                                             |
| **Tier 7: Concurrency & Data Integrity** | **`deletePost` Locked-Variant Check TOCTOU Fencing**                                                     | [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts), [`apps/api/test/publishing.e2e-spec.ts`](file:///C:/Users/bappa/agency-os/apps/api/test/publishing.e2e-spec.ts)                                                                                                                                                                                                                                                    | **MERGED** (PR #15, `a702601`)          | Low / Resolved & Fenced                                      | Complete                                                                                                                                                             |
| **Tier 7: Cleanup / Optimization**       | Container Runtime Transpilation (`tsx` vs compiled `dist`)                                               | `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `packages/*/package.json`, `docs/phase-6-readiness.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **MERGED / CLOSED** (PR #17, `c7ec09b`) | Low / Performance & Startup Optimization                     | Complete (Compiled workspace packages & node dist execution verified)                                                                                                |
| **Tier 7: Non-Blocking Follow-Ups**      | Production Docker Runner Image Slimming & Attack Surface Pruning                                         | `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **MERGED / CLOSED** (PR #31, `673e401`) | Low / Image Optimization & Security                          | Pruned workspace devDependencies across runners via scoped prod reinstall, preserved Prisma runtime, and hardened CI smoke test                                      |
| **Tier 7: Non-Blocking Follow-Ups**      | TokenService CAS Failure Recheck `DISCONNECTED` Guard                                                    | `apps/worker/src/publishing/token.service.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **MERGED / CLOSED** (PR #19, `cfc7924`) | Low / Concurrency Safety Hardening                           | Fenced `recheckAccount.status === DISCONNECTED` to prevent returning recovered credentials or overwriting status                                                     |
| **Tier 7: Non-Blocking Follow-Ups**      | TokenService Integration Test via `SocialAccountRepository.upsertWithConnection`                         | `apps/worker/src/publishing/token.service.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **MERGED / CLOSED** (PR #19, `cfc7924`) | Low / Integration Test Hardening                             | Direct domain repository integration tests for concurrent OAuth reconnects against stale failure handlers                                                            |
| **Tier 7: Non-Blocking Follow-Ups**      | TokenService CAS-Recheck Reconnect Recovery Coverage & Test 11 Spy Cleanup                               | `apps/worker/src/publishing/token.service.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **MERGED / CLOSED** (PR #21, `365653f`) | Low / Test Suite Resilience                                  | Test 11 `try/finally` spy cleanup and Test 14 Step 5 CAS conflict recheck credential recovery                                                                        |
| **Tier 7: Non-Blocking Follow-Ups**      | ESLint `no-floating-promises` Rule Escalation                                                            | `apps/api/eslint.config.mjs`, `apps/worker/eslint.config.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **MERGED / CLOSED** (PR #29, `57e8c21`) | Low / Static Analysis Hardening                              | Evaluate escalating ESLint `no-floating-promises` from warning to error; check existing violations & migration scope                                                 |
| **Tier 7: Non-Blocking Follow-Ups**      | Failed Login Audit Accuracy Enrichment                                                                   | `apps/api/src/modules/auth/auth.controller.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **MERGED / CLOSED** (PR #27, `f41afaf`) | Low / Security Audit Detail                                  | Record actual auth failure reason for `AUTH_LOGIN_FAILED` without logging credentials, tokens, or secrets                                                            |
| **Tier 7: Non-Blocking Follow-Ups**      | OAuth Callback Missing Parameter Failure Audit                                                           | `apps/api/src/modules/oauth/oauth.controller.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **MERGED / CLOSED** (PR #23, `9512337`) | Low / Security Audit Detail                                  | Best-effort `OAUTH_CONNECTION_FAILED` audit logging on missing `code` or `state` with safe metadata                                                                  |
| **Tier 7: Non-Blocking Follow-Ups**      | Deterministic Discovery Submit Async Control                                                             | `apps/web/src/app/[workspaceId]/accounts/discovery/discovery-client.spec.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **MERGED / CLOSED** (PR #25, `c6e312b`) | Low / Test Suite Resilience                                  | Replaced fragile 10ms timer with controlled deferred promise in discovery double-submit test                                                                         |
| **Tier 7: Future Feature Dependency**    | Worker `PublishingProcessor` Catch-Path Disconnect Fencing                                               | `apps/worker/src/publishing/publishing.processor.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **FUTURE DEPENDENCY**                   | Low / Dependent on Future Disconnect API                     | Guard processor catch paths against resurrecting `DISCONNECTED` accounts                                                                                             |
| **Tier 7: CI / Test Optimization**       | CI PostgreSQL Service Publishing E2E Execution                                                           | `apps/api/test/publishing.e2e-spec.ts`, `.github/workflows/ci.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **MERGED** (PR #13, `6bab30d`)          | Low / Pipeline Test Breadth                                  | Complete (Dedicated CI Job Verified)                                                                                                                                 |
| **Tier 7: CI / Test Optimization**       | Broader API E2E CI Coverage (Accounts, Analytics, Auth, Media Storage)                                   | `apps/api/test/*.e2e-spec.ts`, `.github/workflows/ci.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **MERGED / CLOSED** (PR #16, `42723ab`) | Low / Pipeline Test Breadth                                  | Complete (5/5 API E2E suites verified in CI)                                                                                                                         |

---

### 4. Current Implementation Focus: Completed Hardening & Next Priorities

- **Recently Completed**:
  - **Security Hygiene Preflight Fixes: Untrack `cookies.txt` & Fail-Fast LinkedIn Credentials** (**MERGED / CLOSED** in PR #45, merge commit [`3c89eee`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/3c89eeee5d14263f29817130dc0f01c0e46e664b), reviewed HEAD [`06a549a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/06a549adc9ad75e97eba0328a5a8e771e26be7e4)). Untracked `packages/database/cookies.txt` from the Git index while keeping local file intact and ignored by `.gitignore:18:cookies.txt`. Eliminated silent `'dummy_client_id'` and `'dummy_client_secret'` fallbacks in `LinkedInProvider` constructor, throwing fail-fast `Error('LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET environment variables are required.')` consistent with the YouTube provider. Added unit tests for missing, whitespace-only, and valid env vars. Updated test fixtures and workflows in `provider-registry.test.ts`, `token.service.spec.ts`, and `.github/workflows/ci.yml`.
  - **Phase 6: Environment Secret Management & Fail-Fast Token Encryption Startup Validation** (**MERGED / CLOSED** in PR #35, merge commit [`cb63286`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cb63286355dce02a5b3d4bf79cfb2ceaff7d21a0), reviewed HEAD [`e34c493`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e34c49357873847ed42561417ac07dac471654a1)). Implemented shared 64-hexadecimal character (32-byte) `TOKEN_ENCRYPTION_KEY` validation in `packages/database/src/crypto/encryption.ts` (`validateTokenEncryptionKey`) and fail-fast startup enforcement before NestJS/BullMQ initialization in both API (`apps/api/src/main.ts`) and Worker (`apps/worker/src/main.ts`). Updated `.env.example` with documented encryption key generation instructions, LinkedIn OAuth variables (`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`), and frontend URL (`FRONTEND_URL` with default `http://localhost:3000`). Hardened `docker-compose.yml` to require explicitly supplied `TOKEN_ENCRYPTION_KEY` for API and Worker services via required-variable interpolation (`:?`) with zero default secret fallbacks, while explicitly provisioning a test-only key in `.github/workflows/ci.yml` for CI smoke testing. Added 23 regression and startup tests across database, API, and worker packages.
  - **Phase 5: Unified Workspace Analytics Dashboard & Account Detail View** (**MERGED / CLOSED** in PR #33, merge commit [`90e6447`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/90e64477a688f1d0b44aa596e0f493ee17d67ea2), reviewed HEAD [`8400d82`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/8400d82156b69b408fac5f97485f9e9712e0d362)). Delivered authenticated workspace analytics overview in `apps/web/src/app/[workspaceId]/analytics/page.tsx` displaying aggregated summary cards (Total Followers, Total Engagement, Connected Accounts, Active Accounts), per-account breakdown with provider badges and status indicators (`ACTIVE`, `REAUTH_REQUIRED`, `DISCONNECTED`), and account drill-down with 30-day historical trend charts via `recharts` (`apps/web/src/app/[workspaceId]/analytics/[accountId]/page.tsx`). Handles honest loading (`role="status"`), empty, 403 access-denied, and error states with refresh/retry actions and aligned navigation. 20 unit tests added across 2 new test suites. (Note: Overview displays latest recorded daily snapshots; date-range query filtering is not supported by the backend overview endpoint).
  - **Production Docker Runner Image Slimming & Attack Surface Pruning** (**MERGED / CLOSED** in PR #31, merge commit [`673e401`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/673e40139dcc0c50b11def35be6df364b237d5b6), reviewed HEAD [`9bbe864`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9bbe864cf6964d13227045cd5cfcbb103567bf1b)). Slimmed production runner images for API, Worker, and Web via workspace-aware production reinstall (`pnpm install --prod --frozen-lockfile`), safely preserved and restored generated Prisma runtime client artifacts, pruned build/test/source trees, and hardened CI smoke test with verified database readiness and direct Prisma database query probe.
  - **ESLint `no-floating-promises` Rule Escalation** (**MERGED / CLOSED** in PR #29, merge commit [`57e8c21`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/57e8c21904714ae8005506a1dc102aff4c16422e), reviewed HEAD [`f70d12f`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/f70d12f39f1adbdcbe7750f342af1951fd9f3525)). Escalated `@typescript-eslint/no-floating-promises` from warning to error in `apps/api/eslint.config.mjs` and `apps/worker/eslint.config.mjs`; type-aware enforcement verified, no pre-existing violations, no runtime change.
  - **Failed Login Audit Accuracy Enrichment** (**MERGED / CLOSED** in PR #27, merge commit [`f41afaf`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/f41afaf5ba3d98c60ceb060e783708088814eb15), reviewed HEAD [`a13ea54`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/a13ea547d4bb9f420b1806c87d5490227b577cf4)). Enriched failed login audit logging by distinguishing internal authentication failure reasons (`USER_NOT_FOUND`, `INVALID_PASSWORD`, `INTERNAL_ERROR`) and safely associating internal user ID on invalid passwords, while strictly preserving generic 401 client error responses to prevent account enumeration, preventing secret leakage, and resolving Muse test-integrity finding M1.
  - **Deterministic Discovery Submit Async Control** (**MERGED / CLOSED** in PR #25, merge commit [`c6e312b`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/c6e312b2eaba782386c65bcc0bc6604f8025f844), reviewed HEAD [`57c1e95`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/57c1e95dcfbea503d6b3a3915b2b7c2a6efacedb)). Replaced fragile 10ms wall-clock timer in `apps/web/src/app/[workspaceId]/accounts/discovery/discovery-client.spec.tsx` with a deterministic deferred promise and `try/finally` cleanup to prevent intermittent double-submit test failures under CI scheduling contention.
  - **OAuth Callback Missing Parameter Failure Audit** (**MERGED / CLOSED** in PR #23, merge commit [`9512337`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9512337d76d19fc5e769379b9f812b3a28c365cc), reviewed HEAD [`6356903`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/635690337e0454c95bebb6d79ffe0b3abcb7563b)). Recorded best-effort `OAUTH_CONNECTION_FAILED` audit events when OAuth callbacks arrive missing required `code` or `state` parameters with safe failure reasons (`MISSING_CODE`, `MISSING_STATE`, `MISSING_CODE_AND_STATE`) without leaking sensitive tokens into metadata, while preserving the existing `ForbiddenException('Missing code or state')` HTTP contract.
  - **TokenService CAS-Recheck Reconnect Recovery Coverage & Test 11 Spy Cleanup** (**MERGED / CLOSED** in PR #21, merge commit [`365653f`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/365653fc4812857eadc97444988735649f274881), reviewed HEAD [`e5432e6`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e5432e6be8711d865aef122d3d9dc5c36d6b4ff1)). Wrapped Test 11's `txSpy.mockRestore()` in a `try/finally` block to guarantee spy cleanup on failure, and added Test 14 in `apps/worker/src/publishing/token.service.spec.ts` to deterministically verify Step 5 CAS conflict recheck recovery when a concurrent OAuth reconnect persists fresh credentials.
  - **TokenService CAS-Failure Recheck `DISCONNECTED` Guard & Direct Repository Integration Testing** (**MERGED / CLOSED** in PR #19, merge commit [`cfc7924`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cfc7924fb7d3704988ec7f81b3f13160a8799737), reviewed HEAD [`9a44a2a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9a44a2aa792861e586ab371b45df12ba2b3ceeea)). Prevents returning active credentials or overwriting `DISCONNECTED` status during CAS conflicts, and adds direct domain repository integration coverage using `SocialAccountRepository.upsertWithConnection()`.
  - **Container Runtime Transpilation & Compiled Workspace Packaging** (**MERGED / CLOSED** in PR #17, merge commit [`c7ec09b`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/c7ec09b14fe70917ec51526cee482ac01b504f50)). Production API and Worker containers now run compiled JavaScript from `dist/` directly via standard `node`, with internal workspace packages compiled to `dist/` with `.d.ts` types and modern exports.
- **Next Focus Areas (Non-Blocking Follow-Ups & Roadmap)**:
  1. **Phase 6 Hardening**: Observability (structured Pino logger), staging/production deployment configurations.
  2. **Worker Catch-Path Disconnect Fencing**: Guard `PublishingProcessor` catch paths against resurrecting `DISCONNECTED` accounts when disconnect API endpoints are introduced (Future Feature Dependency).

---

## Token Refresh `REAUTH_REQUIRED` CAS TOCTOU Fencing (Branch `fix/token-refresh-reauth-toctou`)

### 1. Verification & Hardening Summary

- **Status**: **MERGED** (PR #9, merge commit [`4752a15f858b7a9e8c472951121bcc98573ae4a7`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/4752a15f858b7a9e8c472951121bcc98573ae4a7))
- **Pull Request**: [#9](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/9)
- **Approved Head SHA**: [`d036e2bd48af5a30012cc4befb0119057c60544a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/d036e2bd48af5a30012cc4befb0119057c60544a) (`d036e2b`)
- **Reviewer**: Muse (APPROVED)
- **CI Status**: All 5/5 GitHub Actions check-runs completed GREEN (`GitGuardian`, `Code Quality`, `Tests`, `Docker Build & Smoke Test`, `Application Builds`).
- **Worker Tests**: 115/115 passed across 9 suites (+10 new tests in `token.service.spec.ts`).
- **Monorepo Verification**: 100% PASS across test, typecheck, lint (0 errors), and build across all packages.

### 2. Defect Root Cause & Concurrency Hazard

- **The Defect**:
  When a token refresh failed with a permanent auth error (e.g. `invalid_grant` / 401) or when a non-refreshable expired token was encountered, `TokenService` previously performed an un-fenced database write:
  `SocialAccount.status = REAUTH_REQUIRED`
  keyed purely by `socialAccountId`.
- **The Race Condition (TOCTOU)**:
  Under high concurrency, if Worker A called provider refresh while Worker B successfully completed refresh, or while an end-user reconnected their social account in the web UI, Worker A's stale failure response would arrive later and blindly overwrite `SocialAccount.status = REAUTH_REQUIRED`. This forced active, freshly-authenticated connections back into broken reauth states, disrupting ongoing publishing and sync pipelines.
  Furthermore, if an account was intentionally disconnected by a user (`status = DISCONNECTED`), a stale worker refresh failure could resurrect the account to `REAUTH_REQUIRED`.

### 3. Actual Concurrency Architecture & Fencing Guarantees

The final architecture employs a two-tier fencing model:

1. **PRIMARY FENCE — Credential Snapshot Comparison (`SocialConnection`)**:
   - Compares the failed worker's snapshot against the latest persisted state in PostgreSQL:
     - `encryptedRefreshToken` (detects token rotation / reconnection)
     - `encryptedAccessToken` (detects fresh token issuance / reconnection)
     - `updatedAt` (connection record timestamp)
     - `expiresAt` (validity window)
   - If any credential attribute changed AND the latest credentials have future validity (`expiresAt > Date.now()`), the helper automatically recovers and returns fresh credentials without failing the caller.
   - If credentials changed but are not valid, status mutation is safely skipped (`stale_credentials_skip`).
   - **Crucial Architectural Note**: A successful credential refresh may update `SocialConnection` without changing `SocialAccount.updatedAt` when the account is already `ACTIVE`. This design is safe because the primary credential snapshot comparison runs first and detects the connection change independently of account timestamp updates.

2. **SECONDARY ACCOUNT FENCE — Status CAS (`SocialAccount`)**:
   - When credentials match the failed snapshot, updates `SocialAccount` using conditional CAS:
     ```typescript
     await tx.socialAccount.updateMany({
       where: {
         id: socialAccountId,
         updatedAt: latestConnection.account.updatedAt,
         status: { not: SocialAccountStatus.DISCONNECTED },
         ...(workspaceId && { workspaceId }),
       },
       data: { status: SocialAccountStatus.REAUTH_REQUIRED },
     });
     ```
   - Matches the exact `updatedAt` observed within the transaction.
   - Excludes `DISCONNECTED` accounts so that the `TokenService` failure-fencing helper never mutates an account whose latest observed status is `DISCONNECTED`.
   - Incorporates `workspaceId` when provided as defense-in-depth tenant isolation.
   - If `casResult.count === 0`, detects concurrent account modification and safely aborts (`cas_conflict_skip`).

3. **Database Precision & Timestamp Invariants**:
   - `SocialAccount.updatedAt` in PostgreSQL / Prisma uses millisecond-level precision (`Timestamp(3)`).
   - Theoretical timestamp collisions within the same millisecond remain possible, but do not materially weaken the combined multi-layer fencing model because credential snapshot comparison on `SocialConnection` operates as the primary gate.
   - No dedicated version column or schema migration is currently required.
   - Does not claim mathematically perfect global serialization or exactly-once execution; relies on a fresh `READ COMMITTED` snapshot plus credential-state fencing within an interactive transaction.

4. **PostgreSQL Commit Before Error Throw**:
   - In Prisma interactive transactions, throwing an exception inside the callback automatically triggers a PostgreSQL `ROLLBACK`. The helper returns an outcome descriptor (`'reauth_marked' | 'recovered' | 'disconnected' | 'stale_credentials_skip' | 'cas_conflict_skip'`) to allow the transaction to `COMMIT` to PostgreSQL, and then throws `AuthRequiredError` outside the transaction callback.

### 4. Non-Blocking Follow-Ups & Future Dependencies

- **Follow-Up A — CAS-Failure Recheck `DISCONNECTED` Guard**:
  - _Context_: In `TokenService.handlePermanentAuthFailure()`, if `tx.socialAccount.updateMany` returns `count: 0` (indicating a CAS conflict), the helper re-reads `recheckAccount`. If `recheckAccount.connection` has valid credentials, it previously returned `recovered` without checking account status.
  - _Hardening_: Implemented in PR #19 (`apps/worker/src/publishing/token.service.ts` L489-L493). If `recheckAccount.status === SocialAccountStatus.DISCONNECTED`, immediately returns `{ outcome: 'disconnected' }` and throws `AuthRequiredError` without leaking credentials or mutating status.
  - _Status_: **RESOLVED & MERGED** (PR #19, merge commit [`cfc7924`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cfc7924fb7d3704988ec7f81b3f13160a8799737), reviewed HEAD [`9a44a2a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9a44a2aa792861e586ab371b45df12ba2b3ceeea)).
- **Follow-Up B — Integration Test Through Real `upsertWithConnection`**:
  - _Context_: Existing unit tests in `token.service.spec.ts` simulated concurrent reconnect by writing directly to Prisma.
  - _Hardening_: Implemented in PR #19 (`apps/worker/src/publishing/token.service.spec.ts` tests 12 and 13). Direct integration tests exercising OAuth reconnect via `SocialAccountRepository.upsertWithConnection()` against stale worker permanent failure calls, verifying that new credentials win and the account remains `ACTIVE`.
  - _Status_: **RESOLVED & MERGED** (PR #19, merge commit [`cfc7924`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cfc7924fb7d3704988ec7f81b3f13160a8799737), reviewed HEAD [`9a44a2a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9a44a2aa792861e586ab371b45df12ba2b3ceeea)).
- **Follow-Up C — Future Disconnect Endpoint Worker Handling**:
  - _Context_: No disconnect API endpoint currently exists in the application.
  - _Future Dependency_: When account disconnect functionality is implemented, review the `PublishingProcessor` `AuthRequiredError` catch handlers. Those handlers currently perform unconditional status updates to `REAUTH_REQUIRED`. If a user disconnects an account while a publication job is in flight, the processor could resurrect `DISCONNECTED` to `REAUTH_REQUIRED`.
  - _Requirement_: Before shipping a disconnect endpoint, fence worker-level `REAUTH_REQUIRED` transitions in `publishing.processor.ts` against `status: { not: DISCONNECTED }`.
  - _Status_: FUTURE FEATURE DEPENDENCY.

### 5. Test Coverage & Verification

- **10 Focused Concurrency & Concurrency-Fence Tests Added in `apps/worker/src/publishing/token.service.spec.ts`**:
  1. _Genuine permanent refresh failure_: Unchanged credential snapshot transitions account to `REAUTH_REQUIRED` and throws `AuthRequiredError`.
  2. _Concurrent successful refresh_: Newer DB credentials allow stale worker to recover fresh access token without marking `REAUTH_REQUIRED`.
  3. _Concurrent manual OAuth reconnect_: Stale failure does not set `REAUTH_REQUIRED`; fresh credentials returned.
  4. _Refresh-token rotation_: Newer rotated refresh token in DB prevents stale worker from mutating account status.
  5. _Disconnect race_: Stale failure leaves `DISCONNECTED` status unchanged.
  6. _Genuine `invalid_grant` regression_: Unchanged snapshot transitions to `REAUTH_REQUIRED`.
  7. _Non-refreshable expired token_: Transitions to `REAUTH_REQUIRED` when snapshot is unchanged.
  8. _Non-refreshable expired token + concurrent reconnect_: Stale worker recovers fresh credentials without overwriting `ACTIVE`.
  9. _Account CAS conflict_: `updateMany` count 0 skips stale mutation and preserves latest account state.
  10. _No stale `ACTIVE` restoration_: Stale worker encountering changed credentials never blindly forces account status to `ACTIVE`.
- **Test Suite Results**:
  - Worker Unit & Integration Tests (`pnpm --filter @agency-os/worker test`): **PASS** (9/9 suites, 115/115 tests passing, +10 new tests).
  - Monorepo Tests (`pnpm turbo run test`): **PASS** (5/5 tasks successful across worker, api, providers, database, web).
  - Monorepo Typecheck (`pnpm turbo run typecheck`): **PASS** (5/5 tasks successful across all 9 packages).
  - Monorepo Lint (`pnpm turbo run lint`): **PASS** (5/5 tasks successful, 0 errors).
  - Production Builds (`pnpm turbo run build`): **PASS** (3/3 builds successful across api, web, and worker).

---

## Ambiguous Publication Reconciliation Hardening (Branch `fix/reconciliation-hardening`)

### 1. Verification & Hardening Summary

- **Status**: **MERGED** (PR #7, merge commit [`d7f2d71313cf99134ec133eecb880ad4b74a4a8f`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/d7f2d71313cf99134ec133eecb880ad4b74a4a8f))
- **Pull Request**: [#7](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/7)
- **Approved Head SHA**: [`8c45e4c506f8ea7ac032871bfd1b30964ea46781`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/8c45e4c506f8ea7ac032871bfd1b30964ea46781) (`8c45e4c`)
- **Reviewer**: Muse (APPROVED)
- **CI Status**: All 5/5 GitHub Actions check-runs completed GREEN (`GitGuardian`, `Code Quality`, `Tests`, `Docker Build & Smoke Test`, `Application Builds`).
- **Scope**: Direct Vitest unit test coverage, audit log metadata enrichment, static import cleanup, CAS workspace defense-in-depth, and test semantics precision.
- **Architectural Soundness**:
  - The core reconciliation business logic implemented in previous commits was already architecturally sound.
  - PR #7 primarily closed the CI regression coverage gap so that reconciliation logic is tested automatically on every commit in the Vitest CI suite (`pnpm turbo run test`).
  - Vitest now directly covers `PublishingApplicationService.reconcile()` (29 unit tests in `publishing-application.service.spec.ts`, 3 unit tests in `publications.controller.spec.ts`, bringing API total to 149 tests across 16 files).
  - Existing live PostgreSQL Jest E2E tests ([`apps/api/test/publishing.e2e-spec.ts`](file:///C:/Users/bappa/agency-os/apps/api/test/publishing.e2e-spec.ts) -> `proves database rollback if AuditLog insertion fails`) remain the real proof of PostgreSQL database rollback behavior and atomicity.
  - The unit test transaction mock (`cb(txMock)`) specifically proves error propagation and exception mapping to `InternalServerErrorException`.
  - Audit metadata now captures operator-supplied `externalPostId` and `canonicalUrl` for traceability without leaking tokens or credentials.
  - Proved that `CONFIRM_FAILED` records operator-supplied identifiers in `AuditLog.metadata` while strictly preventing synthesis of publication fields (`publishedAt`, `externalPostId`, `canonicalUrl`) on `PostPlatformVariant`.
  - CAS update includes `workspaceId` in the WHERE clause as defense-in-depth tenant isolation.
  - RBAC unit tests confirm that `publishing.reconcile` requires `OWNER` or `MANAGER` role, rejecting `EDITOR`, `CLIENT_APPROVER`, and `VIEWER`.

### 2. Applied Hardening & Cleanups

1. **CI Vitest Test Suite Added**:
   - Authored [`apps/api/src/modules/publishing/services/publishing-application.service.spec.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.spec.ts) containing 29 rigorous unit tests executed by Vitest in CI.
   - Closed the CI test gap where previously only Jest E2E tests existed in `test/publishing.e2e-spec.ts` (which are excluded from `pnpm turbo run test`).
   - Transaction error handling test explicitly validates transaction callback error propagation and exception mapping to `InternalServerErrorException`; real database rollback and atomicity are verified against PostgreSQL by the existing E2E test (`apps/api/test/publishing.e2e-spec.ts` -> `proves database rollback if AuditLog insertion fails`).
   - Verified that `CONFIRM_FAILED` records operator-supplied identifiers (`externalPostId`, `canonicalUrl`) in `AuditLog.metadata` for traceability while strictly preventing synthesis of publication fields (`publishedAt`, `externalPostId`, `canonicalUrl`) on `PostPlatformVariant`.
2. **Audit Log Metadata Enrichment**:
   - In [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts#L605-L611), enriched `AuditLog.metadata` to capture operator-supplied publication identifiers when present:
     ```typescript
     metadata: {
       variantId,
       decision: dto.decision,
       reason: dto.reason,
       ...(dto.externalPostId && { externalPostId: dto.externalPostId }),
       ...(dto.canonicalUrl && { canonicalUrl: dto.canonicalUrl }),
     }
     ```
   - Confirmed no secrets, tokens, or credentials are leaked into the audit trail.
3. **Static Import Cleanup**:
   - Removed dynamic `const { generateId } = require('@agency-os/database');` inside the transaction block; relies cleanly on static top-level import.
4. **CAS Workspace Defense-in-Depth**:
   - Added `workspaceId` to the `where` condition in `tx.postPlatformVariant.updateMany` alongside `id: variantId` and `status: PostStatus.UNKNOWN`.
5. **Controller RBAC Unit Tests**:
   - In [`apps/api/src/modules/publishing/controllers/publications.controller.spec.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/controllers/publications.controller.spec.ts#L85-L136), added 3 unit tests verifying:
     - `@RequirePermission('publishing.reconcile')` is decorated on `reconcileTarget` (and not `publishing.publish`).
     - `PermissionMatrix['publishing.reconcile']` grants access to `OWNER` and `MANAGER`, while denying `EDITOR`, `CLIENT_APPROVER`, and `VIEWER`.
     - `controller.reconcileTarget` cleanly delegates parameters to `PublishingApplicationService.reconcile`.

### 3. Local Verification Results

- **Vitest Suite (`pnpm --filter @agency-os/api test`)**: **PASS** (16/16 test files passed, 149/149 tests passing, +32 new unit tests).
- **TypeScript Typecheck (`pnpm turbo run typecheck`)**: **PASS** (5/5 tasks successful).
- **Lint (`pnpm turbo run lint`)**: **PASS** (5/5 tasks successful, 0 errors, 37 warnings).
- **Production Builds (`pnpm turbo run build`)**: **PASS** (3/3 builds successful across API, Web, and Worker).

---

## Security Event Audit Logging Coverage & Explicit Persistence Semantics (Branch `fix/audit-logging-coverage`)

### 1. Verification & Hardening Summary

- **Status**: **MERGED** (PR #11, merge commit [`546316a4221744eab619dd51d593bbec406f39ad`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/546316a4221744eab619dd51d593bbec406f39ad) / `546316a`, merged 2026-10-20)
- **Pull Request**: [#11](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/11)
- **Approved Head SHA**: [`0da02424703aa2a6260dea9a6800d6e18c846e1a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/0da02424703aa2a6260dea9a6800d6e18c846e1a) (`0da0242`)
- **Reviewer**: Muse (APPROVED)
- **CI Status**: All 5/5 GitHub Actions check-runs completed GREEN (`GitGuardian`, `Code Quality`, `Tests`, `Docker Build & Smoke Test`, `Application Builds`).
- **Scope**: Post and publication lifecycle audit logging coverage, AuditAction enum type safety, explicit reliable vs. best-effort AuditService API, call site intentionality review, and regression test suites.
- **Architectural Tenets**:
  - Exactly **13 production mutations** previously unaudited/untyped now fully covered (12 previously commented-out calls in `PublishingApplicationService` + 1 previously untyped `as any` in `requestRemoteDelete`).
  - Added exactly **13 `AuditAction` enum values** to [`packages/database/src/repositories/AuditLogRepository.ts`](file:///C:/Users/bappa/agency-os/packages/database/src/repositories/AuditLogRepository.ts).
  - Explicit split in [`AuditService`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/core/audit.service.ts):
    1. `logAction(data): Promise<void>` — Awaits database insertion via `auditRepo.create(data)` and propagates rejections to callers.
    2. `logActionBestEffort(data): void` — Invokes `logAction` and catches rejections, logging an error via Pino `Logger.error`, never failing the caller.
  - Call-site intentionality:
    - _Best-Effort_: `AuthController` (login success/failure, logout), `OAuthController` (connect, callback, select), `AccountsController` (triggerSync), and `MediaService` (initiateUpload, completeUpload) use `logActionBestEffort`. An audit DB outage never causes authentication/OAuth denial-of-service or rolls back S3 upload completion.
    - _Awaited / Reliable_: Post and publication mutations in `PublishingApplicationService` await `logAction(...)`.
    - _Transactionally Coupled_: Manual reconciliation in `PublishingApplicationService.reconcile()` retains its existing transactional `tx.auditLog.create` inside the PostgreSQL interactive transaction, providing rollback atomicity.
  - **Partial-Success Semantics (Important Architectural Precision)**:
    - Post and publication mutations in `PublishingApplicationService` are sequential: domain mutation executes first, followed by `await this.audit.logAction(...)`.
    - If audit log insertion rejects, NestJS returns an HTTP 500 (`InternalServerErrorException`) to the client, but the domain mutation has already been committed to the database.
    - We do **NOT** claim transactional consistency or rollback atomicity for sequential post/publication mutations (only `reconcile` possesses transactional rollback atomicity).
    - For idempotent operations or state transitions (e.g. `requestPublish`, `schedule`, `cancelQueued`), subsequent client retries safely return 409 Conflict. For deletions (`deletePost`, `removeTarget`), retries return 404 Not Found. For non-idempotent operations (`createDraft`), a client blind retry could create a duplicate draft.
  - **Prisma Schema & Database Migrations**:
    - The Prisma `AuditLog.action` column remains `String` in PostgreSQL (`packages/database/prisma/schema.prisma`).
    - **No Prisma database migration was required or generated.**
  - **Tenant & Actor Attribution**:
    - All audit records strictly enforce `workspaceId` from the authenticated session context.
    - `actorId` is derived from authenticated author/user context.
    - Metadata strictly captures non-sensitive operational identifiers (`postId`, `variantId`, `targetType`, `scheduledAt`, `changes`) without leaking tokens, cookies, passwords, or credentials.

### 2. Applied Changes & Call Site Breakdown

1. **AuditAction Enum Expansion**:
   Added 13 new enum constants in [`packages/database/src/repositories/AuditLogRepository.ts`](file:///C:/Users/bappa/agency-os/packages/database/src/repositories/AuditLogRepository.ts):
   - `POST_CREATED = 'POST_CREATED'`
   - `POST_UPDATED = 'POST_UPDATED'`
   - `POST_DELETED = 'POST_DELETED'`
   - `PUBLICATION_TARGET_ADDED = 'PUBLICATION_TARGET_ADDED'`
   - `PUBLICATION_TARGET_UPDATED = 'PUBLICATION_TARGET_UPDATED'`
   - `PUBLICATION_TARGET_REMOVED = 'PUBLICATION_TARGET_REMOVED'`
   - `PUBLICATION_REQUESTED = 'PUBLICATION_REQUESTED'`
   - `PUBLICATION_RETRY_REQUESTED = 'PUBLICATION_RETRY_REQUESTED'`
   - `PUBLICATION_SCHEDULED = 'PUBLICATION_SCHEDULED'`
   - `PUBLICATION_RESCHEDULED = 'PUBLICATION_RESCHEDULED'`
   - `PUBLICATION_UNSCHEDULED = 'PUBLICATION_UNSCHEDULED'`
   - `PUBLICATION_CANCELLED = 'PUBLICATION_CANCELLED'`
   - `PUBLICATION_DELETE_REQUESTED = 'PUBLICATION_DELETE_REQUESTED'`
2. **AuditService API**:
   In [`apps/api/src/modules/core/audit.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/core/audit.service.ts):
   - Replaced fire-and-forget `logAction` with `async logAction(data: CreateAuditLogDto): Promise<void> { await this.auditRepo.create(data); }`.
   - Added `logActionBestEffort(data: CreateAuditLogDto): void { this.logAction(data).catch((err) => { this.logger.error('Failed to write audit log (best-effort)', ...); }); }`.
3. **Call Sites Updated**:
   - `apps/api/src/modules/auth/auth.controller.ts`: Login success, login failure, and logout use `this.auditService.logActionBestEffort`.
   - `apps/api/src/modules/oauth/oauth.controller.ts`: Connect initiated, callback (success, reconnect, denied, failed, and missing required parameter validation failures), and select use `this.auditService.logActionBestEffort`.
   - `apps/api/src/modules/accounts/accounts.controller.ts`: Trigger sync uses `this.auditService.logActionBestEffort`.
   - `apps/api/src/modules/media/media.service.ts`: Initiate upload and complete upload use `this.audit.logActionBestEffort`.
   - `apps/api/src/modules/publishing/services/publishing-application.service.ts`: All 13 post and publication mutations uncommented/wired with `await this.audit.logAction({...})`. Removed `as any` from `requestRemoteDelete`.
   - `PublishingApplicationService.reconcile()`: Retains transactional `tx.auditLog.create` inside `$transaction`.

### 3. Test Coverage & Verification

- **Unit Test Suites Added & Updated**:
  - `apps/api/src/modules/core/audit.service.spec.ts`: 4 tests verifying reliable resolution, rejection propagation, best-effort non-throwing behavior, and error logging.
  - `apps/api/src/modules/auth/auth.controller.spec.ts`: 3 tests verifying best-effort audit emission on login success, login failure, and logout.
  - `apps/api/src/modules/oauth/oauth.controller.spec.ts`: 14 tests verified and updated with `mockAuditService.logActionBestEffort` (including 3 missing parameter validation failure tests asserting safe metadata without credential leakage).
  - `apps/api/src/modules/accounts/accounts.controller.spec.ts`: 2 tests verified and updated with `mockAuditService.logActionBestEffort`.
  - `apps/api/src/modules/publishing/services/publishing-application.service.spec.ts`: 45 tests total (29 reconcile tests + 16 new audit tests covering all 13 actions, rejection propagation, no-double-logging in reconcile, and metadata redaction).
- **Test Suite Results**:
  - API Vitest Suite (`pnpm --filter @agency-os/api test`): **PASS** (17/17 test files passed, 170/170 tests passing, +21 new unit tests).
  - Database Vitest Suite (`pnpm --filter @agency-os/database test`): **PASS** (9/9 test files passed, 73/73 tests passing).
  - Monorepo Tests (`pnpm turbo run test`): **PASS** (5/5 tasks successful across all packages).
  - Monorepo Typecheck (`pnpm turbo run typecheck`): **PASS** (5/5 tasks successful, 0 errors).
  - Monorepo Lint (`pnpm turbo run lint`): **PASS** (5/5 tasks successful, 0 errors).
  - Production Builds (`pnpm turbo run build`): **PASS** (3/3 builds successful across API, Web, and Worker).

### 4. Non-Blocking Follow-Ups

1. **Transactional Audit Writes**: Closed for `createDraft` and `updateDraft`. Implemented, verified, and merged in PR #12 ([`8e94c62`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/8e94c62846f6cd1599d41b3337a998054730d1a9)).
2. **ESLint `no-floating-promises` Rule Escalation**: Evaluate escalating ESLint `no-floating-promises` from warning to error; first inspect existing violations and determine migration scope across all workspace packages.
3. **Failed Login Audit Accuracy**: Record the actual authentication failure reason for `AUTH_LOGIN_FAILED`, without logging credentials, tokens, or other secrets.
4. **OAuth Callback Failures**: Closed for missing `code`/`state` parameters. Implemented, verified, and merged in PR #23 ([`9512337`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9512337d76d19fc5e769379b9f812b3a28c365cc)).

---

## Transactional Audit Writes for Draft Operations

### 1. Implementation & Verification Summary

- **Status**: **MERGED** (PR #12, merge commit [`8e94c62846f6cd1599d41b3337a998054730d1a9`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/8e94c62846f6cd1599d41b3337a998054730d1a9) / `8e94c62`, merged 2026-10-21)
- **Pull Request**: [#12](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/12)
- **Approved Head SHA**: [`fbf8a633fb54533a2caab6aa83de8ae284333d66`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/fbf8a633fb54533a2caab6aa83de8ae284333d66) (`fbf8a63`)
- **Reviewer**: Muse (APPROVED)
- **CI Status**: All 5/5 GitHub Actions check-runs completed GREEN (`GitGuardian Security Checks`, `Code Quality (Lint & Typecheck)`, `Application Builds`, `Tests`, `Docker Build & Smoke Test`).
- **Scope**: Atomic draft mutations (`createDraft` and `updateDraft`) and their audit records, eliminating partial-success HTTP 500 failure modes where domain mutations commit while audit logging fails. Closes PR #11 follow-up F1 for draft operations.

### 2. Architectural Design & Implementation

- **Transaction-Aware Persistence Layer**:
  - [`packages/database/src/repositories/AuditLogRepository.ts`](file:///C:/Users/bappa/agency-os/packages/database/src/repositories/AuditLogRepository.ts): Added optional `tx?: Prisma.TransactionClient` parameter to `create(data, tx?)`. Selects `const client = tx ?? this.prisma` to route writes through transaction connections when provided, avoiding connection deadlocks and preserving backward compatibility for callers omitting `tx`.
  - [`apps/api/src/modules/core/audit.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/core/audit.service.ts): Added optional `tx?: Prisma.TransactionClient` parameter to `logAction(data, tx?)`. Awaits and forwards `tx` to repository. Leaves `logActionBestEffort` non-blocking and safe.
- **`createDraft` Transactional Atomicity**:
  - [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts#L40-L81): Workspace-scoped media validation (`mediaAsset.findMany`) remains outside `$transaction` to keep transaction hold times <5ms. Inside `this.prisma.$transaction(async (tx) => { ... })`, `tx.post.create` (including `PostMedia` relations) and `this.audit.logAction(..., tx)` execute atomically. If audit persistence throws, the entire transaction rolls back, leaving no orphaned Post or PostMedia records.
- **`updateDraft` Transactional Atomicity**:
  - [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts#L107-L192): Pre-checks (post existence, locked variant check, workspace media validation) remain outside `$transaction`. Inside `this.prisma.$transaction(async (tx) => { ... })`, media relation recreation, `tx.post.update`, and `this.audit.logAction(..., tx)` execute atomically. If audit logging fails, all changes roll back and original post content and media are preserved.

### 3. Concurrency Analysis & Remaining Limitations

- **Unresolved Concurrency in `updateDraft`**:
  - In `updateDraft`, the locked variant check (`post.variants.find(...)`) executes _prior_ to `this.prisma.$transaction`.
  - If a variant concurrently transitions to `QUEUED`, `PUBLISHING`, or `PUBLISHED` (via `requestPublish` or a background worker) between the pre-check and `tx.post.update`, the post content update could theoretically apply to a locked post.
  - Per project guidelines, publishing state machine redesign was kept out of scope for this task and is documented here as an explicit edge-case follow-up.
- **Caller Boundary Intentionality**:
  - Best-effort audit logging for authentication, OAuth, account sync, and media upload remains intentionally non-blocking (`logActionBestEffort`).
  - Ambiguous publication reconciliation remains transactionally coupled to its audit write via its own dedicated transaction.

### 4. Test Coverage & Verification

- **Unit Tests**:
  - `packages/database/src/repositories/AuditLogRepository.spec.ts`: Verified `create` with and without `tx`, pagination, and workspace filtering (4 tests).
  - `apps/api/src/modules/core/audit.service.spec.ts`: Verified `logAction` forwards `tx` when provided, plus rejection propagation and best-effort error logging (5 tests).
  - `apps/api/src/modules/publishing/services/publishing-application.service.spec.ts`: Verified `createDraft` and `updateDraft` execute inside `$transaction`, pass `txMock` to `audit.logAction`, and reject on audit failure (47 tests).
- **Real PostgreSQL Integration Tests (`apps/api/test/publishing.e2e-spec.ts`)**:
  - Verified `createDraft` database rollback when `tx.auditLog.create` throws; asserted 0 post and 0 media rows remain, and successful retry creates exactly 1 post and 1 audit record.
  - Verified `updateDraft` database rollback when `tx.auditLog.create` throws; asserted post retains initial content and initial media relations, and successful retry applies update with exactly 1 audit record.
  - Verified cross-workspace media asset IDs are rejected with 404 in both `createDraft` and `updateDraft` before transactions initiate.
  - All 33 tests in `publishing.e2e-spec.ts` passed against real local PostgreSQL.
- **CI Test Execution Gap**:
  - GitHub Actions CI workflow currently runs Vitest unit tests (`pnpm turbo run test`). Real PostgreSQL Jest E2E tests (`apps/api/test/publishing.e2e-spec.ts`) require a live PostgreSQL container and are run locally or via dedicated E2E pipeline stages.
- **Monorepo Verification**:
  - Vitest Unit Tests (`pnpm turbo run test`): **PASS** (5/5 tasks successful).
  - Monorepo Typecheck (`pnpm turbo run typecheck`): **PASS** (5/5 tasks successful, 0 errors).
  - Monorepo Lint (`pnpm turbo run lint`): **PASS** (5/5 tasks successful, 0 errors).
  - Production Builds (`pnpm turbo run build`): **PASS** (3/3 builds successful across API, Web, and Worker).

### 5. Open Post-Merge Follow-Ups

1. **Revalidate locked-variant state inside the `updateDraft` transaction**:
   - _Context_: In `updateDraft`, the locked variant check (`post.variants.find(...)`) executed outside and prior to `this.prisma.$transaction`.
   - _Hazard_: A concurrent variant transition to `QUEUED`, `PUBLISHING`, or `PUBLISHED` (via `requestPublish` or background worker) could race between the initial read and `tx.post.update`.
   - _Resolution_: Implemented repository-level row locks (`lockPostForUpdate` and `lockVariantsForUpdate` with `ORDER BY id ASC` to eliminate deadlocks) executed inside `this.prisma.$transaction`. Re-evaluates variant statuses under exclusive row locks; rejects with HTTP 403 `ForbiddenException: Cannot edit post while a publication is in ${status} state` if any publication variant is in a locked state (`QUEUED`, `PUBLISHING`, `PUBLISHED`, `UNKNOWN`, `SCHEDULED`). Non-DB media validation remains outside transaction to keep lock hold duration minimal (<5ms). Verified with 8 deterministic Jest E2E tests (static rejection, transition-first serialization with 403 rejection, edit-first serialization with atomic audit attribution, and workspace/post tenant isolation).
   - _Status_: **MERGED / CLOSED** (PR #14, merge commit [`279b4c5b3f7656fcb149746cfb2efda95e73e4f8`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/279b4c5b3f7656fcb149746cfb2efda95e73e4f8) / `279b4c5`, merged 2026-10-23).
2. **Run Jest E2E tests in GitHub Actions CI**:
   - _Context_: Dedicated GitHub Actions CI job `e2e` (`Publishing E2E Tests`) added to `.github/workflows/ci.yml` in PR #13 (reviewed HEAD [`e7b14da65e67c00ab9b18d0f272a967c211e2ced`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e7b14da65e67c00ab9b18d0f272a967c211e2ced) / `e7b14da`, merge commit [`6bab30dc00a045b7238be8011e8e9ab63fef5540`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/6bab30dc00a045b7238be8011e8e9ab63fef5540) / `6bab30d`, merged 2026-10-21).
   - _Architecture_: Runs `pnpm --filter @agency-os/api test:e2e test/publishing.e2e-spec.ts` against isolated `postgres:15-alpine` (`agency_os_test`) and `redis:7-alpine` service containers with health checks, explicit test credentials, Prisma client generation, and schema migration deployment (`prisma migrate deploy`).
   - _Scope Limitation_: Only `apps/api/test/publishing.e2e-spec.ts` currently runs in this dedicated CI job. Broader E2E test suites (`accounts.e2e-spec.ts`, `analytics.e2e-spec.ts`, `auth.e2e-spec.ts`, and `media.storage.e2e-spec.ts`) are not executed in this job and remain tracked separately.
   - _Verification Evidence_:
     - Local PostgreSQL Jest E2E execution: 33/33 passed across 1 suite (7.397 s).
     - GitHub Actions CI execution: Job `Publishing E2E Tests` succeeded in 54s ([run 39629862242, job 119324880432](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/39629862242/job/119324880432)); all 6/6 checks passed on PR #13 HEAD.
   - _Status_: **MERGED / CLOSED** (PR #13, merge commit `6bab30d`). Closes PR #12 follow-up #2 for publishing E2E tests.

3. **Broader API E2E CI Coverage (Accounts, Analytics, Auth, Media Storage)**:
   - _Context_: Other E2E test suites in `apps/api/test/` (`accounts.e2e-spec.ts`, `analytics.e2e-spec.ts`, `auth.e2e-spec.ts`, and `media.storage.e2e-spec.ts`) require additional service dependencies (such as MinIO for S3 object storage in `media.storage.e2e-spec.ts`) and mock credentials.
   - _Next Step_: Define dedicated CI service jobs or extend CI service dependencies to safely execute remaining API E2E suites without flakiness or cross-suite pollution.
   - _Status_: OPEN (Low / Pipeline Test Coverage).

4. **Revalidate locked-variant state inside the `deletePost` transaction (TOCTOU Fencing)**:
   - _Context_: In `deletePost` ([`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts)), unsafe variant status checks (`post.variants.find(...)`) currently execute outside a transaction and prior to `repo.posts.delete`.
   - _Hazard_: A concurrent state transition could change a variant to `QUEUED`, `PUBLISHING`, or `PUBLISHED` (via `requestPublish` or background worker) after the initial check but before `repo.posts.delete` commits.
   - _Resolution_: Implemented row-level locks (`lockPostForUpdate` and `lockVariantsForUpdate` ordered by primary key `id ASC`) inside `this.prisma.$transaction`. Re-evaluates variant statuses under exclusive locks and throws HTTP 403 `ForbiddenException` if any publication variant is in a locked state (`QUEUED`, `PUBLISHING`, `PUBLISHED`, `UNKNOWN`, `SCHEDULED`). Inside transaction, executes `tx.post.delete` (cascading variants and media) and atomic `audit.logAction(..., tx)`. Verified with unit tests (60/60) and 10 dedicated Jest E2E tests in `publishing.e2e-spec.ts` (51/51).
   - _Status_: **MERGED / CLOSED** (PR #15, merge commit [`a7026019fa9c9aff6caedaf7a83e19d1963e23ca`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/a7026019fa9c9aff6caedaf7a83e19d1963e23ca) / `a702601`, merged 2026-10-23).

---

## Dedicated Publishing Jest E2E Tests in CI (PR #13)

### 1. Implementation & Verification Summary

- **Status**: **MERGED** (PR #13, merge commit [`6bab30dc00a045b7238be8011e8e9ab63fef5540`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/6bab30dc00a045b7238be8011e8e9ab63fef5540) / `6bab30d`, merged 2026-10-21)
- **Pull Request**: [#13](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/13)
- **Approved Head SHA**: [`e7b14da65e67c00ab9b18d0f272a967c211e2ced`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e7b14da65e67c00ab9b18d0f272a967c211e2ced) (`e7b14da`)
- **Reviewer**: Muse (APPROVED)
- **CI Status**: All 6/6 GitHub Actions check-runs completed GREEN (`GitGuardian Security Checks`, `Docker Build & Smoke Test`, `Code Quality (Lint & Typecheck)`, `Tests`, `Application Builds`, `Publishing E2E Tests`).
- **Scope**: Dedicated containerized CI job running `pnpm --filter @agency-os/api test:e2e test/publishing.e2e-spec.ts` against real PostgreSQL and Redis services, closing the PR #12 CI test execution gap follow-up.

### 2. Architectural Design & Infrastructure

- **Service Isolation**: Runs dedicated `postgres:15-alpine` (`agency_os_test`) and `redis:7-alpine` service containers with health checks (`pg_isready` and `redis-cli ping`), ensuring zero shared-state interference with unit test jobs.
- **Database Lifecycle**: Executes Prisma client generation (`pnpm --filter @agency-os/database exec prisma generate`) and applies migrations (`pnpm --filter @agency-os/database exec prisma migrate deploy`) against the test database before Jest starts.
- **Targeted Test Execution**: Exclusively executes `test/publishing.e2e-spec.ts`, avoiding unconfigured dependency failures (e.g. MinIO object storage for media storage tests).

### 3. Verification Evidence

- **Local Verification**: 33/33 tests passed in 7.397 s against local PostgreSQL/Redis.
- **CI Verification**: GitHub Actions job `Publishing E2E Tests` passed in 54s ([run 39629862242, job 119324880432](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/39629862242/job/119324880432)).

### 4. Remaining Open Follow-Ups

- **Broader E2E Coverage**: Incrementally add dedicated jobs for `accounts.e2e-spec.ts`, `analytics.e2e-spec.ts`, `auth.e2e-spec.ts`, and `media.storage.e2e-spec.ts` (requires MinIO service container) as needed.

---

## `updateDraft` Locked-Variant Concurrency Serialization (PR #14)

### 1. Implementation & Verification Summary

- **Status**: **MERGED** (PR #14, merge commit [`279b4c5b3f7656fcb149746cfb2efda95e73e4f8`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/279b4c5b3f7656fcb149746cfb2efda95e73e4f8) / `279b4c5`, merged `2026-10-23T08:32:16Z`)
- **Pull Request**: [#14](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/14)
- **Reviewed Head SHA**: [`4e7b3caf6c0b44c2e453f8be48a945354c913f9c`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/4e7b3caf6c0b44c2e453f8be48a945354c913f9c) (`4e7b3ca`)
- **Reviewer**: Muse (APPROVED with separate `deletePost` follow-up noted)
- **Branch**: `fix/update-draft-concurrency-race`
- **Target**: `main` (`42f5a07`)
- **CI Status**: All 6/6 GitHub Actions check-runs completed **GREEN** / **SUCCESS** (`GitGuardian Security Checks`, `Docker Build & Smoke Test`, `Code Quality (Lint & Typecheck)`, `Tests`, `Application Builds`, `Publishing E2E Tests`).

### 2. Problem & Root Cause Analysis

- **TOCTOU Window**: In `PublishingApplicationService.updateDraft`, `repo.posts.findById` queried post and variants outside the database transaction.
- **PostgreSQL Default READ COMMITTED Isolation**: Plain `SELECT` statements take no row locks. Even inside a transaction, a plain `SELECT` reads snapshot data and does not block concurrent `UPDATE "PostPlatformVariant"` statements.
- **Cross-Table Update Independence**: Updating `"Post"` with `WHERE NOT EXISTS (SELECT 1 FROM "PostPlatformVariant" WHERE ...)` only acquires an exclusive lock on `"Post"`. Concurrent variant state transitions operate on `"PostPlatformVariant"`. Neither operation blocks the other, allowing partial/corrupt states where draft edits overwrite content while a publication variant is already `QUEUED`, `PUBLISHING`, or `PUBLISHED`.

### 3. Locking Architecture & Invariants

- **Deterministic Row-Lock Hierarchy**:
  1. Lock parent `"Post"` row (`SELECT id FROM "Post" WHERE id = $postId::uuid AND "workspaceId" = $workspaceId::uuid FOR UPDATE`). Serializes concurrent draft edits and confirms workspace tenant isolation.
  2. Lock child `"PostPlatformVariant"` rows ordered by primary key (`SELECT id, status FROM "PostPlatformVariant" WHERE "postId" = $postId::uuid AND "workspaceId" = $workspaceId::uuid ORDER BY id ASC FOR UPDATE`). Guarantees mutual exclusion against concurrent variant transitions and prevents deadlocks.
- **Authoritative Status Evaluation**: Under PostgreSQL `READ COMMITTED`, `SELECT ... FOR UPDATE` waits for any in-flight transaction on the variant to commit or roll back, then reads the newly committed status. If any variant is in `QUEUED`, `PUBLISHING`, `PUBLISHED`, `UNKNOWN`, or `SCHEDULED`, `updateDraft` throws `ForbiddenException`, triggering transaction rollback without modifying content/media or writing audit records.
- **Minimal Critical Section**: Media assets validation (`mediaAsset.findMany`) executes before opening the transaction, keeping transaction duration and lock hold time strictly minimal (<5ms).

### 4. Verification Evidence

- **Jest E2E Tests (`apps/api/test/publishing.e2e-spec.ts`)**:
  - 41/41 tests passing (including 8 dedicated concurrency & variant lock policy tests).
  - Validated static 403 rejections across all 5 locked states with exact error message `Cannot edit post while a publication is in ${status} state`.
  - Validated transition-first concurrency: variant transition to `QUEUED` holds lock, `updateDraft` blocks on row lock (verified via `pg_locks`), unblocks on transition commit, and throws 403; post content remains unchanged, 0 `POST_UPDATED` audit records.
  - Validated edit-first concurrency: `updateDraft` holds lock, concurrent publish request blocks on row lock (verified via `pg_locks`), `updateDraft` commits with 1 `POST_UPDATED` audit record, publish unblocks and transitions to `QUEUED` with 1 `PUBLICATION_REQUESTED` audit record.
  - Validated workspace/post isolation: concurrent operations on different posts or workspaces proceed without blocking.
- **Monorepo Suite**:
  - `pnpm turbo run test`: 5/5 tasks successful across all packages.
  - `pnpm turbo run lint`: 5/5 tasks successful across all packages (0 errors).
  - `pnpm turbo run typecheck`: 5/5 tasks successful across all packages (0 errors).
- **GitHub Actions CI (Run on PR #14 HEAD `8fc235b`)**:
  - `Publishing E2E Tests`: **SUCCESS** (running dedicated Jest E2E suite against isolated PostgreSQL and Redis service containers).
  - `Code Quality (Lint & Typecheck)`: **SUCCESS**.
  - `Tests`: **SUCCESS**.
  - `Application Builds`: **SUCCESS**.
  - `Docker Build & Smoke Test`: **SUCCESS**.
  - `GitGuardian Security Checks`: **SUCCESS**.

### 5. Remaining Open Follow-Ups

- **`deletePost` Locked-Variant Check TOCTOU Fencing**: Closed in PR #15 (merge commit [`a7026019fa9c9aff6caedaf7a83e19d1963e23ca`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/a7026019fa9c9aff6caedaf7a83e19d1963e23ca) / `a702601`).
- **Broader E2E CI Coverage**: Incrementally add dedicated jobs for `accounts.e2e-spec.ts`, `analytics.e2e-spec.ts`, `auth.e2e-spec.ts`, and `media.storage.e2e-spec.ts` as needed.

---

## `deletePost` Locked-Variant Concurrency Serialization (PR #15)

### 1. Implementation & Verification Summary

- **Status**: **MERGED** (PR #15, merge commit [`a7026019fa9c9aff6caedaf7a83e19d1963e23ca`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/a7026019fa9c9aff6caedaf7a83e19d1963e23ca) / `a702601`, merged `2026-10-23T09:24:09Z`)
- **Pull Request**: [#15](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/15)
- **Reviewed Head SHA**: [`e8343c7e49ac9d0558da6703de3ff410fb5e96c0`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e8343c7e49ac9d0558da6703de3ff410fb5e96c0) (`e8343c7`)
- **Reviewer**: Muse (APPROVED)
- **CI Status**: All 6/6 GitHub Actions check-runs completed **GREEN** / **SUCCESS** (`GitGuardian Security Checks`, `Docker Build & Smoke Test`, `Code Quality (Lint & Typecheck)`, `Tests`, `Application Builds`, `Publishing E2E Tests`).
- **Branch**: `fix/delete-post-concurrency-race`
- **Target**: `main` (`26d58b9`)
- **Local Verification**:
  - `pnpm turbo run test`: 5/5 tasks passed across all monorepo packages.
  - `pnpm turbo run lint`: 5/5 tasks passed (0 errors).
  - `pnpm turbo run typecheck`: 5/5 tasks passed (0 errors).
  - `pnpm turbo run build`: 3/3 builds successful across Web, API, and Worker.
  - `test/publishing.e2e-spec.ts`: 51/51 tests passed against real PostgreSQL container (including 10 dedicated deletion concurrency & lock policy tests).

### 2. Problem & Root Cause Analysis

- **TOCTOU Window**: In `PublishingApplicationService.deletePost`, `repo.posts.findById` checked variant status outside any transaction.
- **Cascade Deletion Hazard**: With PostgreSQL `onDelete: Cascade` on `PostPlatformVariant`, a concurrent transition to `QUEUED` / `PUBLISHING` or worker claim racing between `findById` and `repo.posts.delete` caused `Post` and `PostPlatformVariant` records to be cascade-deleted. The background worker was left processing ghost jobs on social media without internal database records or audit trails.
- **Audit Atomicity Gap**: Post deletion and audit logging were executed independently without a shared transaction client, risking partial-success failure.

### 3. Locking Architecture & Invariants

- **Deterministic Row-Lock Hierarchy**:
  1. `repo.lockPostForUpdate(tx, postId)`: Exclusively locks parent `"Post"` row (`SELECT id FROM "Post" WHERE id = $postId::uuid AND "workspaceId" = $workspaceId::uuid FOR UPDATE`). Enforces workspace tenancy and serializes concurrent draft mutations.
  2. `repo.lockVariantsForUpdate(tx, postId)`: Exclusively locks child `"PostPlatformVariant"` rows ordered by primary key (`ORDER BY id ASC FOR UPDATE`). Eliminates deadlocks against other write paths.
- **Authoritative Status Evaluation & Rollback**: Under exclusive locks, variant statuses are re-evaluated. If any variant is in `QUEUED`, `PUBLISHING`, `PUBLISHED`, `UNKNOWN`, or `SCHEDULED`, `deletePost` throws `ForbiddenException: Cannot delete post with a publication in ${unsafeVariant.status} state`, automatically rolling back the transaction.
- **Atomic Deletion & Audit Logging**: `tx.post.delete` and `this.audit.logAction(..., tx)` execute within `this.prisma.$transaction(async (tx) => { ... })`.

### 4. Verification Evidence

- **Jest E2E Tests (`apps/api/test/publishing.e2e-spec.ts`)**:
  - 51/51 tests passing.
  - Validated static 403 rejection across all 5 locked states (`QUEUED`, `PUBLISHING`, `PUBLISHED`, `UNKNOWN`, `SCHEDULED`).
  - Validated transition-first concurrency: variant transition to `QUEUED` holds row lock, `deletePost` blocks on PostgreSQL row lock (verified with `waitForBlockedRowLock(prisma)`), transition commits, `deletePost` unblocks and rejects with 403; post remains intact in DB, 0 `POST_DELETED` audit records.
  - Validated delete-first concurrency: `deletePost` holds row locks in transaction, concurrent publish request blocks on row lock (verified with `waitForBlockedRowLock(prisma)`), `deletePost` commits with 1 `POST_DELETED` audit record, publish unblocks, observes post deleted, and returns 409 Conflict without creating ghost jobs or publication attempts.
  - Validated workspace/post tenant isolation: concurrent operations on different posts or workspaces proceed without blocking; cross-workspace deletions return 404.
  - Validated transactional audit rollback: when `tx.auditLog.create` fails, entire transaction rolls back; post and variants remain intact in DB; subsequent retry succeeds with exactly 1 audit record.

### 5. Remaining Open Follow-Ups

- **Broader E2E CI Coverage**: Implemented and merged for all 5 suites (`accounts`, `analytics`, `auth`, `media.storage`, `publishing`) in PR #16 (merge commit [`42723ab`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/42723ab52b9f9ef40a85dea20239352e19f1c229)).

---

## Expanded API E2E CI Coverage (PR #16)

### 1. Implementation & Verification Summary

- **Status**: **MERGED / CLOSED**
- **Pull Request**: [#16](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/16) (merged into `main` on 2026-10-23)
- **Branch**: `ci/expand-api-e2e-coverage` (merged & deleted)
- **Implementation Commit**: [`069fff4b99e3f03e460f2c20515e725e747ef931`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/069fff4b99e3f03e460f2c20515e725e747ef931) (`069fff4`)
- **Documentation Commit**: [`c76f38c653ec7672b26f0f38b925e0b02d3bee47`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/c76f38c653ec7672b26f0f38b925e0b02d3bee47) (`c76f38c`)
- **Merge Commit**: [`42723ab52b9f9ef40a85dea20239352e19f1c229`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/42723ab52b9f9ef40a85dea20239352e19f1c229) (`42723ab`)
- **CI Run**: [Run #39937749393](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/39937749393) (All 6 check runs completed GREEN)
- **Base Target**: `main` (`85b5998`)
- **Scope**: Run all 5 API E2E test suites (`accounts.e2e-spec.ts`, `analytics.e2e-spec.ts`, `auth.e2e-spec.ts`, `publishing.e2e-spec.ts`, and `media.storage.e2e-spec.ts`) in GitHub Actions CI using dedicated, isolated PostgreSQL, Redis, and MinIO service containers.
- **Service Infrastructure**:
  - Pinned MinIO service container: `cgr.dev/chainguard/minio:latest@sha256:d88920d6a50bd0b088223b688be3b76c63e6205dbe494437f67ba1240ea12880` with reliable TCP healthcheck `bash -c 'echo > /dev/tcp/127.0.0.1/9000'`.
  - Preserved existing `postgres:15-alpine` and `redis:7-alpine` service containers with health checks.
  - Deterministic pre-test bucket creation: `aws --endpoint-url http://localhost:9000 s3 mb s3://agency-os-media || true`.
  - Configured object storage test environment variables (`OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_PUBLIC_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`).
- **Targeted Test Execution**:
  - Renamed job to `API E2E Tests`.
  - Runs all 5 test suites in-band: `pnpm --filter @agency-os/api test:e2e`.

### 2. Verification Evidence

- **Local Verification**:
  - Full E2E Execution: 5/5 test suites passed, 79/79 tests passing (21.25s).
    - `test/media.storage.e2e-spec.ts`: 8/8 passed.
    - `test/publishing.e2e-spec.ts`: 51/51 passed.
    - `test/auth.e2e-spec.ts`: 10/10 passed.
    - `test/accounts.e2e-spec.ts`: 7/7 passed.
    - `test/analytics.e2e-spec.ts`: 3/3 passed.
  - Monorepo Verification:
    - `pnpm turbo run test`: 5/5 tasks successful across all packages.
    - `pnpm turbo run lint`: 5/5 tasks successful across all packages (0 errors).
    - `pnpm turbo run typecheck`: 5/5 tasks successful across all packages (0 errors).
    - `pnpm turbo run build`: 3/3 builds successful across Web, API, and Worker.
- **GitHub Actions CI Verification**:
  - CI Run: [`https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/39937749393`](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/39937749393)
  - All 6 check runs completed `success`:
    - `API E2E Tests`: Passed in 1m 01s (79/79 tests passed across 5 suites).
    - `Docker Build & Smoke Test`: Passed in 1m 39s.
    - `Application Builds`: Passed in 45s.
    - `Tests`: Passed in 36s.
    - `Code Quality`: Passed in 35s.
    - `GitGuardian`: Passed in 13s.

### 3. Container Runtime Transpilation Investigation Findings

- Current container execution via `npx tsx dist/src/main.js` (API) and `npx tsx dist/main.js` (Worker) is **fully operational** for development, local execution, and Docker Compose smoke testing (`/api/health/ready` returns HTTP 200).
- An imminent production deployment is **not functionally blocked** (containers do not crash); however, running unbundled TypeScript via JIT compilation introduces cold-start latency, elevated memory overhead, and unoptimized execution in production environments.
- Retained as a distinct, unbundled **OPEN** backlog item in Tier 7 Priority Matrix for subsequent packaging optimization.

### 4. Non-Blocking Follow-Ups (from Muse Review)

1. **MinIO Bucket Creation Verification**: Replace `|| true` in `aws --endpoint-url http://localhost:9000 s3 mb s3://agency-os-media || true` with explicit create-or-verify logic (e.g., `aws s3 ls s3://agency-os-media || aws s3 mb s3://agency-os-media`) to surface genuine provisioning/network failures.
2. **MinIO Readiness Probe Hardening**: Upgrade MinIO readiness check beyond raw TCP port probe (`bash -c 'echo > /dev/tcp/127.0.0.1/9000'`) to an HTTP/S3 readiness probe (e.g., MinIO `/minio/health/ready` endpoint) if future container base images include `curl`/`wget`.
3. **Branch Protection Status Check Name**: Confirmed branch protection on `main` is currently disabled (`GET /repos/.../branches/main/protection` returned 404). If protected branch rules are enabled in the future, ensure the required status check is configured as `API E2E Tests` (replacing the former `Publishing E2E Tests`).
4. **CI Run Traceability**: Canonical CI run link recorded in documentation: [`https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/39937749393`](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/39937749393).

---

## Container Runtime Transpilation & Compiled Workspace Packaging (PR #17)

### 1. Implementation & Verification Summary

- **Status**: **MERGED / CLOSED** (PR #17, merge commit [`c7ec09b14fe70917ec51526cee482ac01b504f50`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/c7ec09b14fe70917ec51526cee482ac01b504f50) / `c7ec09b`, merged 2026-10-24T17:30:45Z)
- **Pull Request**: [#17](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/17)
- **Pre-Merge Base SHA**: [`5a77a82bec5963087bd91df999f81f2d190b0bab`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/5a77a82bec5963087bd91df999f81f2d190b0bab) (`5a77a82`)
- **Reviewed PR Head SHA**: [`621423eb5823f6f3c60354fb45af32f909c304f9`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/621423eb5823f6f3c60354fb45af32f909c304f9) (`621423e`)
- **Merge Commit SHA**: [`c7ec09b14fe70917ec51526cee482ac01b504f50`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/c7ec09b14fe70917ec51526cee482ac01b504f50) (`c7ec09b`)
- **Reviewer**: Muse (APPROVED)
- **Final CI Run**: [Run #39979168411](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/39979168411) (All 6 check runs completed **GREEN / SUCCESS** on reviewed HEAD `621423e`)
- **Scope**: Eliminate production container JIT transpilation (`npx tsx`) in API and Worker containers by compiling all internal workspace packages (`@agency-os/database`, `@agency-os/providers`, `@agency-os/session`, `@agency-os/shared`) to JavaScript with `.d.ts` declaration files in `dist/`, running production containers via compiled Node.js (`node dist/src/main.js` and `node dist/main.js`).

### 2. Root Cause & Packaging Architecture

- **Root Cause of `tsx` in Production**:
  Previously, `apps/api/package.json` used `"start:prod": "npx tsx dist/src/main.js"` and `apps/worker/package.json` used `"start:prod": "npx tsx dist/main.js"`. Internal workspace packages (`packages/database`, `packages/providers`, `packages/session`, `packages/shared`) lacked build scripts and pointed their `"main"` entrypoints directly to raw TypeScript files (`"./index.ts"`). When NestJS compiled `apps/api` and `apps/worker`, external requires to `@agency-os/*` resolved to `.ts` files, causing Node.js at runtime to fail with `ERR_MODULE_NOT_FOUND` unless wrapped in `tsx` JIT transpilation.
- **Compiled Workspace Package Strategy**:
  1. **Build Scripts & Manifests**:
     - Added `"build": "tsc -p tsconfig.build.json"` to `packages/database`, `packages/providers`, `packages/session`, and `packages/shared`.
     - Configured `"main": "./dist/index.js"`, `"types": "./dist/index.d.ts"`, and modern `"exports"` field mappings across all internal packages.
     - Preserved backward compatibility for deep subpath imports: mapped `"./src/crypto/encryption"` in `@agency-os/database/package.json` to `"./dist/src/crypto/encryption.js"`.
  2. **Dedicated Build Configurations (`tsconfig.build.json`)**:
     - Separated build configuration (`tsconfig.build.json`) from IDE/lint typechecking (`tsconfig.json`).
     - Excluded `**/*.spec.ts`, `**/*.test.ts`, and `test/` directories from `dist/` compilation artifacts.
     - Maintained test and config file inclusion in root `tsconfig.json` so `@typescript-eslint`'s `projectService` operates without parsing errors during linting.
  3. **Concurrency-Safe Turbo Pipelines**:
     - Ensured package build scripts run standard `tsc -p tsconfig.build.json` without in-band `prisma generate` to prevent Windows file locking collisions with concurrent Vitest runners.
  4. **Production Runtime Execution**:
     - Updated `apps/api/package.json` `"start:prod"` to `node dist/src/main.js`.
     - Updated `apps/worker/package.json` `"start:prod"` to `node dist/main.js`.
     - Moved `@agency-os/session` from `devDependencies` to `dependencies` in `apps/api/package.json` (required by `AuthService` and `CoreModule` at runtime).

### 3. Verification Evidence

- **Monorepo Build, Typecheck, and Tests**:
  - `pnpm turbo run build`: 7/7 successful across all packages and applications (19.44s).
  - `pnpm turbo run lint`: 5/5 successful, 0 errors, 0 warnings (30.63s).
  - `pnpm turbo run typecheck`: 6/6 successful, 0 errors (15.05s).
  - `pnpm turbo run test`: 9/9 successful, 100% test pass rate across database, providers (231 tests), session, shared, api, and worker (115 tests).
- **All 5 API E2E Test Suites**:
  - `pnpm --filter @agency-os/api test:e2e`: 5/5 test suites passed, 79/79 tests passing in 14.56s (`accounts`, `analytics`, `auth`, `publishing`, `media.storage`).
- **Docker Compose Production Smoke Testing**:
  - Multi-stage Docker builds succeeded for `agency-os-api`, `agency-os-worker`, and `agency-os-migration`.
  - Container inspection confirmed all compiled `dist/` directories and files are present inside images.
  - Applied migrations cleanly via migration service (`migration-1 exited with code 0`).
  - Container health check: `agency-os-api` container reported status `healthy`; `curl http://localhost:3001/api/health/ready` returned HTTP 200:
    ```json
    {
      "status": "ok",
      "info": { "database": { "status": "up" }, "redis": { "status": "up" } }
    }
    ```
  - Worker functionality: `agency-os-worker` connected to Redis/BullMQ, started scheduled recurring jobs and publishing dispatchers.
  - Process table verification (`ps aux` inside running containers):
    - API container: `PID 1: pnpm ... start:prod`, `PID 32: node dist/src/main.js`. Exactly 0 `tsx` processes.
    - Worker container: `PID 1: pnpm ... start:prod`, `PID 18: node dist/main.js`. Exactly 0 `tsx` processes.

- **GitHub Actions CI Verification (Run #39979168411 on Reviewed HEAD `621423e`)**:
  - CI Run: [`https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/39979168411`](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/39979168411)
  - All 6 check runs completed `success`:
    - `Code Quality (Lint & Typecheck)`: Passed.
    - `Application Builds`: Passed.
    - `Tests`: Passed.
    - `API E2E Tests`: Passed (79/79 tests passed across 5 suites).
    - `Docker Build & Smoke Test`: Passed (built `api`, `worker`, `web`, `migration`; compose stack healthy; `api` /health/ready returned 200).
    - `GitGuardian Security Checks`: Passed.

### 4. Remaining Non-Blocking Follow-Ups

1. **Production Docker Runner Image Slimming**:
   - The production containers currently copy package workspaces and run standard multi-stage builds. A future optimization can prune unused internal build artifacts or dev dependencies from the runner stage to slim container image sizes further.
2. **MinIO Bucket Creation & Healthcheck Hardening**:
   - Retained from PR #16 follow-up list for test-environment resilience.

---

## 19. TokenService CAS-Failure Recheck `DISCONNECTED` Guard & Repository Integration Tests (Branch `fix/token-service-cas-disconnected-guard` — MERGED)

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #19, merge commit [`cfc7924fb7d3704988ec7f81b3f13160a8799737`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cfc7924fb7d3704988ec7f81b3f13160a8799737))
- **Pull Request**: [#19](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/19)
- **Branch**: `fix/token-service-cas-disconnected-guard`
- **Pre-Merge Base SHA**: [`bae671d9e83a35d478834075fe222abda03de684`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/bae671d9e83a35d478834075fe222abda03de684) (`bae671d`)
- **Reviewed Head SHA**: [`9a44a2aa792861e586ab371b45df12ba2b3ceeea`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9a44a2aa792861e586ab371b45df12ba2b3ceeea) (`9a44a2a`)
- **Merge Commit SHA**: [`cfc7924fb7d3704988ec7f81b3f13160a8799737`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cfc7924fb7d3704988ec7f81b3f13160a8799737) (`cfc7924`)
- **Merge Timestamp**: `2026-10-24T18:28:53Z`
- **CI Run**: [Run #40119659470](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40119659470) (6/6 check runs green on reviewed HEAD `9a44a2a`)
- **Reviewer**: Muse (APPROVED)

### 2. Scope & Implementation Details

1. **DISCONNECTED Guard on CAS Conflict Recheck (Follow-Up A)**:
   - In `apps/worker/src/publishing/token.service.ts` (`handlePermanentAuthFailure`), if `tx.socialAccount.updateMany` encountered a CAS conflict (`casResult.count === 0`) due to another actor concurrently updating the account, the helper re-read `recheckAccount`.
   - Defect: If the account was concurrently disconnected (`SocialAccountStatus.DISCONNECTED`) by a user, but the connection still held a token with an unexpired future date (`expiresAt > Date.now()`, e.g. Meta 60-day token), the helper previously returned `{ outcome: 'recovered' }` and handed out active execution credentials for a disconnected account.
   - Hardening: Added an explicit guard immediately after re-reading `recheckAccount`:
     ```typescript
     if (recheckAccount?.status === SocialAccountStatus.DISCONNECTED) {
       return {
         outcome: "disconnected" as const,
       };
     }
     ```
     This mirrors the pre-CAS disconnect check, guarantees no credentials are leaked for a disconnected account, throws `AuthRequiredError("Account <id> (<provider>) is disconnected")`, and preserves the `DISCONNECTED` status in PostgreSQL without mutating it to `REAUTH_REQUIRED`.
2. **Domain Repository Integration Testing (Follow-Up B)**:
   - Prior tests in `apps/worker/src/publishing/token.service.spec.ts` simulated concurrent OAuth reconnects by mutating raw Prisma tables directly.
   - Hardening: Authored realistic integration tests exercising the actual `@agency-os/database` `SocialAccountRepository.upsertWithConnection()` method to seed and reconnect social accounts with authentic credential payloads, rotated refresh tokens, and updated scopes.
   - Verified that concurrent user re-authentications via `upsertWithConnection()` win over stale worker failure handling, credentials are safely recovered, and account status remains `ACTIVE`.

### 3. Test Coverage & Verification Evidence

- **New Tests in `apps/worker/src/publishing/token.service.spec.ts`**:
  - `Test 11`: _CAS conflict recheck DISCONNECTED guard_: Intercepts CAS update to simulate concurrent disconnect (`count: 0`). Asserts `handlePermanentAuthFailure` rejects with `AuthRequiredError` indicating account is disconnected, never returns recovered credentials, and leaves PostgreSQL status as `DISCONNECTED`.
  - `Test 12`: _Repository integration_: Connects account via `SocialAccountRepository.upsertWithConnection()`, reads stale failure snapshot, performs concurrent re-auth via `upsertWithConnection()`, and verifies stale worker failure handling recovers reconnected credentials while account remains `ACTIVE`.
  - `Test 13`: _Repository integration with REAUTH_REQUIRED account_: Reconnects a previously degraded account via `upsertWithConnection()`, asserting that stale worker failure cannot revert the restored `ACTIVE` status.
- **Verification Results**:
  - `token.service.spec.ts`: 30/30 tests passing.
  - Full Worker Test Suite: 9/9 suites, 118/118 tests passing.
  - Monorepo Lint & Typecheck: 15/15 tasks passing (0 errors, 0 warnings in affected code).
  - Monorepo Unit Tests: 9/9 tasks passing.
  - API E2E Tests: 5/5 suites, 79/79 tests passing (`accounts`, `analytics`, `auth`, `publishing`, `media.storage`).
  - GitHub Actions CI Run #40119659470: All 6 check runs completed `success`.

### 4. Non-Blocking Review Observations & Follow-Ups

1. **Optional Test 11 Spy Cleanup Resilience**:
   - In `apps/worker/src/publishing/token.service.spec.ts`, test 11 was wrapped in a `try/finally` block to ensure `txSpy.mockRestore()` executes reliably even if assertions throw (**MERGED / CLOSED** in PR #21, merge commit [`365653f`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/365653fc4812857eadc97444988735649f274881)).
2. **Optional CAS-Recheck Reconnect Recovery Test**:
   - Added Test 14 in `apps/worker/src/publishing/token.service.spec.ts` to deterministically exercise the Step 5 CAS-conflict recheck recovery path where concurrent OAuth reconnect races after initial read but before the CAS update (`updateMany` count 0). Verified that the recheck branch decrypts and returns the newly persisted credentials, account remains `ACTIVE`, and no stale status transition occurs (**MERGED / CLOSED** in PR #21, merge commit [`365653f`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/365653fc4812857eadc97444988735649f274881)).
3. **Future Feature Dependency — Worker Catch-Path Disconnect Fencing**:
   - Retained as a future feature dependency when account disconnect API endpoints are introduced (`publishing.processor.ts`).

---

## 21. TokenService CAS-Recheck Reconnect Recovery Tests & Test 11 Spy Cleanup (Branch `test/token-service-cas-recheck-recovery` — MERGED)

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #21, merge commit [`365653fc4812857eadc97444988735649f274881`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/365653fc4812857eadc97444988735649f274881))
- **Pull Request**: [#21](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/21)
- **Branch**: `test/token-service-cas-recheck-recovery`
- **Pre-Merge Base SHA**: [`b2d347757a91127d35b9cc7c512f076caefc1662`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/b2d347757a91127d35b9cc7c512f076caefc1662) (`b2d3477`)
- **Reviewed Head SHA**: [`e5432e6be8711d865aef122d3d9dc5c36d6b4ff1`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e5432e6be8711d865aef122d3d9dc5c36d6b4ff1) (`e5432e6`)
- **Merge Commit SHA**: [`365653fc4812857eadc97444988735649f274881`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/365653fc4812857eadc97444988735649f274881) (`365653f`)
- **Merge Timestamp**: `2026-10-25T08:32:46Z`
- **CI Run**: [Run #40123049146](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40123049146) (6/6 check runs green on reviewed HEAD `e5432e6`)
- **Post-Merge Push CI Run**: [Run #40177049204](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40177049204) (All 5 push check runs green on `main` `365653f`)
- **Reviewer**: Muse (APPROVED)

### 2. Scope & Implementation Details

1. **Test 11 Spy Cleanup Resilience**:
   - In `apps/worker/src/publishing/token.service.spec.ts`, test 11 (`11. CAS conflict recheck DISCONNECTED guard`) wraps `tokenService.handlePermanentAuthFailure()` and assertions inside a `try/finally` block.
   - Guarantees `txSpy.mockRestore()` executes reliably in `finally` even if intermediate assertions throw, preventing mock leakage across subsequent tests.
2. **Test 14 CAS-Recheck Reconnect Recovery Coverage**:
   - Added Test 14 (`14. CAS-conflict recheck reconnect recovery: recovers valid credentials when OAuth reconnect races after initial read but before CAS update`) to deterministically exercise Step 5 of `handlePermanentAuthFailure()`.
   - Uses an `intercepted` latch on `prisma.$transaction` to prevent recursive transaction interception when calling `SocialAccountRepository.upsertWithConnection()`.
   - Bypasses Step 4 by capturing an unchanged initial snapshot before entering `handlePermanentAuthFailure()`.
   - Triggers a real concurrent OAuth reconnect right before `tx.socialAccount.updateMany` executes.
   - PostgreSQL naturally returns `count: 0` because `SocialAccount.updatedAt` changed.
   - Step 5 CAS conflict recheck reads the reconnected account from the database, confirms valid credentials, decrypts the fresh token, and returns `{ outcome: 'recovered' }` while preserving the account as `ACTIVE`.

### 3. Verification & Test Evidence

- **Test Suite Verification**:
  - `apps/worker/src/publishing/token.service.spec.ts`: 31/31 tests passing (including Test 11 with `try/finally` and new Test 14).
  - Worker Unit Tests: 9/9 suites, 119/119 tests passing.
  - API E2E Tests: 5/5 suites, 79/79 tests passing.
  - Monorepo Lint & Typecheck: 15/15 tasks passing.
  - GitHub Actions CI Run #40123049146: All 6 check runs green on reviewed HEAD `e5432e6`.
  - GitHub Actions Post-Merge Push CI Run #40177049204: All 5 push check runs green on `main` (`365653f`).

### 4. Remaining Follow-Ups

1. **Future Feature Dependency — Worker Catch-Path Disconnect Fencing**:
   - Retained as a future feature dependency when account disconnect API endpoints are introduced (`publishing.processor.ts`).

---

## 23. OAuth Callback Missing Parameter Failure Audit (Branch `fix/oauth-missing-parameter-audit` — MERGED)

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #23, merge commit [`9512337d76d19fc5e769379b9f812b3a28c365cc`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9512337d76d19fc5e769379b9f812b3a28c365cc))
- **Pull Request**: [#23](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/23)
- **Branch**: `fix/oauth-missing-parameter-audit`
- **Pre-Merge Base SHA**: [`cfb93010a40f80aec06fac5702eccdc04d5c801e`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cfb93010a40f80aec06fac5702eccdc04d5c801e) (`cfb9301`)
- **Reviewed Head SHA**: [`635690337e0454c95bebb6d79ffe0b3abcb7563b`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/635690337e0454c95bebb6d79ffe0b3abcb7563b) (`6356903`)
- **Merge Commit SHA**: [`9512337d76d19fc5e769379b9f812b3a28c365cc`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9512337d76d19fc5e769379b9f812b3a28c365cc) (`9512337`)
- **Merge Timestamp**: `2026-10-25T16:36:41Z`
- **Pre-Merge CI Run**: [Run #40211027219](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40211027219) (6/6 check runs green on reviewed HEAD `6356903`)
- **Post-Merge Push CI Run**: [Run #40212506660](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40212506660) (All 5 push check runs green on `main` `9512337`)
- **Reviewer**: Muse (APPROVED)

### 2. Scope & Implementation Details

1. **Audit Logging on Missing Callback Parameters**:
   - In `apps/api/src/modules/oauth/oauth.controller.ts`, prior to throwing `ForbiddenException('Missing code or state')` when `!code || !state`, the controller records a best-effort audit event:
     - Action: `AuditAction.OAUTH_CONNECTION_FAILED`
     - Actor ID: `userId`
     - Target Type: `'SocialProvider'`
     - Target ID: `provider`
     - Request ID: `requestId`
     - Metadata: `{ provider, reason }` where `reason` is safely categorized as `'MISSING_CODE_AND_STATE'`, `'MISSING_CODE'`, or `'MISSING_STATE'`.
   - Preserves the existing HTTP contract by still throwing `ForbiddenException('Missing code or state')`.
2. **Credential & Secret Protection in Audit Logs**:
   - Raw authorization `code` and CSRF `state` tokens are never stored in audit metadata, preventing accidental credential exposure or token leakage in compliance and security event trails.
3. **Controller Unit Test Suite Expansion**:
   - Updated `apps/api/src/modules/oauth/oauth.controller.spec.ts` with 3 dedicated regression tests covering:
     - Missing `code` (with present state): verifies `ForbiddenException`, audit action `OAUTH_CONNECTION_FAILED`, reason `MISSING_CODE`, and asserts state string is absent from audit call metadata.
     - Missing `state` (with present code): verifies `ForbiddenException`, audit action `OAUTH_CONNECTION_FAILED`, reason `MISSING_STATE`, and asserts authorization code is absent from audit call metadata.
     - Missing both `code` and `state`: verifies `ForbiddenException`, audit action `OAUTH_CONNECTION_FAILED`, and reason `MISSING_CODE_AND_STATE`.

### 3. Verification & Test Evidence

- **Test Suite Verification**:
  - `apps/api/src/modules/oauth/oauth.controller.spec.ts`: 14/14 tests passing.
  - Full API Unit Test Suite: 17/17 test files, 188/188 tests passing.
  - Monorepo Lint & Typecheck: All tasks passing with 0 errors.
  - Pre-Merge CI Run #40211027219: All 6 check runs green on reviewed HEAD `6356903` (`GitGuardian`, `Application Builds`, `Tests`, `Code Quality`, `Docker Build & Smoke Test`, `API E2E Tests`).
  - GitHub Actions Post-Merge Push CI Run #40212506660: All 5 push check runs green on `main` (`9512337`).

### 4. Remaining Follow-Ups

1. **ESLint `no-floating-promises` Rule Escalation**:
   - Evaluate escalating ESLint `no-floating-promises` from warning to error; check existing violations and migration scope across workspace packages.
2. **Failed Login Audit Accuracy Enrichment**:
   - Record actual authentication failure reason for `AUTH_LOGIN_FAILED` without logging credentials or secrets (`apps/api/src/modules/auth/auth.controller.ts`) (**MERGED / CLOSED** in PR #27, merge commit [`f41afaf`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/f41afaf5ba3d98c60ceb060e783708088814eb15)).
3. **Production Docker Runner Image Slimming**:
   - Optional optimization to prune devDependencies and unused workspace packages in runner stages (`apps/api/Dockerfile`, `apps/worker/Dockerfile`).
4. **Future Feature Dependency — Worker Catch-Path Disconnect Fencing**:
   - Retained as a future feature dependency when account disconnect API endpoints are introduced (`apps/worker/src/publishing/publishing.processor.ts`).

---

## 25. Deterministic Discovery Submit Async Control (Branch `test/discovery-client-deterministic-submit` — MERGED)

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #25, merge commit [`c6e312b2eaba782386c65bcc0bc6604f8025f844`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/c6e312b2eaba782386c65bcc0bc6604f8025f844))
- **Pull Request**: [#25](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/25)
- **Branch**: `test/discovery-client-deterministic-submit`
- **Pre-Merge Base SHA**: [`53beac13ad54c8cc0a37f5cea0130d65c70f0df7`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/53beac13ad54c8cc0a37f5cea0130d65c70f0df7) (`53beac1`)
- **Reviewed Head SHA**: [`57c1e95dcfbea503d6b3a3915b2b7c2a6efacedb`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/57c1e95dcfbea503d6b3a3915b2b7c2a6efacedb) (`57c1e95`)
- **Merge Commit SHA**: [`c6e312b2eaba782386c65bcc0bc6604f8025f844`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/c6e312b2eaba782386c65bcc0bc6604f8025f844) (`c6e312b`)
- **Merge Timestamp**: `2026-10-26T07:36:32Z`
- **Pre-Merge CI Run**: [Run #40286093957](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40286093957) (All 6 check runs green on reviewed HEAD `57c1e95`)
- **Post-Merge Push CI Run**: [Run #40286838868](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40286838868) (All 5 push check runs green on `main` `c6e312b`)
- **Reviewer**: Muse (APPROVED)

### 2. Scope & Implementation Details

1. **Root Cause of Intermittent Failure**:
   - In `apps/web/src/app/[workspaceId]/accounts/discovery/discovery-client.spec.tsx` (test `9/10/11. submit sends only profileIds, prevents double submit, redirects on success`), `mockApiPost` was mocked using a fixed 10ms wall-clock timer:
     `mockApiPost.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 10)))`
   - Under CI runner CPU contention across concurrent Vitest/Jest jobs, `await user.click(connectBtn)` event dispatching took longer than 10ms (observed taking 103ms in CI run #40282271438), causing the mutation promise to resolve before the test could assert `expect(connectBtn).toBeDisabled()`.
2. **Deterministic Deferred Promise Pattern**:
   - Replaced the arbitrary 10ms timer with a controlled deferred promise (`postPromise` and `resolvePost`).
   - Triggering form submission enters `selectMutation.mutate()`, leaving the promise unresolved while the test asserts that `connectBtn` is disabled and displays `Connecting...`.
   - The test then explicitly calls `resolvePost({ success: true })` to settle the mutation and await subsequent redirect and payload assertions.
3. **Promise Leakage & Test Resilience**:
   - Wrapped the assertion block in `try/finally` to guarantee `resolvePost` is always executed in `finally`, preventing unresolved promises from hanging or leaking state across subsequent test suites if intermediate assertions throw.

### 3. Verification & Test Evidence

- **Local Test Suite Verification**:
  - Focused test file (`pnpm --filter @agency-os/web test src/app/[workspaceId]/accounts/discovery/discovery-client.spec.tsx`): 1/1 suite, 7/7 tests passing.
  - Complete Web Test Suite (`pnpm --filter @agency-os/web test`): 6/6 suites, 91/91 tests passing.
  - Monorepo Lint & Typecheck (`pnpm turbo run lint typecheck`): All 15 tasks successful across 9 packages (0 errors).
- **CI Verification**:
  - Pre-Merge CI Run #40286093957: All 6 check runs green on reviewed HEAD `57c1e95` (`GitGuardian`, `Application Builds`, `Tests`, `Code Quality`, `Docker Build & Smoke Test`, `API E2E Tests`).
  - GitHub Actions Post-Merge Push CI Run #40286838868: All 5 push check runs green on `main` (`c6e312b`).

### 4. Remaining Follow-Ups

1. **ESLint `no-floating-promises` Rule Escalation**:
   - Evaluate escalating ESLint `no-floating-promises` from warning to error; check existing violations and migration scope across workspace packages.
2. **Failed Login Audit Accuracy Enrichment**:
   - Record actual authentication failure reason for `AUTH_LOGIN_FAILED` without logging credentials or secrets (`apps/api/src/modules/auth/auth.controller.ts`).
3. **Production Docker Runner Image Slimming**:
   - Optional optimization to prune devDependencies and unused workspace packages in runner stages (`apps/api/Dockerfile`, `apps/worker/Dockerfile`).
4. **Future Feature Dependency — Worker Catch-Path Disconnect Fencing**:
   - Retained as a future feature dependency when account disconnect API endpoints are introduced (`apps/worker/src/publishing/publishing.processor.ts`).

---

## 27. Failed Login Audit Accuracy Enrichment (Branch `fix/auth-failed-login-audit-enrichment` — MERGED)

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #27, merge commit [`f41afaf5ba3d98c60ceb060e783708088814eb15`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/f41afaf5ba3d98c60ceb060e783708088814eb15))
- **Pull Request**: [#27](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/27)
- **Branch**: `fix/auth-failed-login-audit-enrichment`
- **Pre-Merge Base SHA**: [`33629b5139b9637f59446e7d7b59cd8e4b5b6d98`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/33629b5139b9637f59446e7d7b59cd8e4b5b6d98) (`33629b5`)
- **Reviewed Head SHA**: [`a13ea547d4bb9f420b1806c87d5490227b577cf4`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/a13ea547d4bb9f420b1806c87d5490227b577cf4) (`a13ea54`)
- **Initial Feature Head SHA**: [`d36f2477d3599e33ab6cec000d8cad831ae1d63a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/d36f2477d3599e33ab6cec000d8cad831ae1d63a) (`d36f247`)
- **Merge Commit SHA**: [`f41afaf5ba3d98c60ceb060e783708088814eb15`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/f41afaf5ba3d98c60ceb060e783708088814eb15) (`f41afaf`)
- **Merge Timestamp**: `2026-10-26T15:00:37Z`
- **Pre-Merge CI Run**: All 6 check runs green on reviewed HEAD `a13ea54` (`GitGuardian`, `Application Builds`, `Tests`, `Code Quality`, `Docker Build & Smoke Test`, `API E2E Tests`).
- **Post-Merge Push CI Run**: [Run #40345077579](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40345077579) (All 5 push check runs green on `main` `f41afaf`).
- **Reviewer**: Muse (APPROVED)

### 2. Scope & Implementation Details

1. **Accurate Failed Login Categorization**:
   - In `apps/api/src/modules/auth/auth.service.ts`, introduced `InvalidCredentialsException` extending `UnauthorizedException` with an internal `reason: 'USER_NOT_FOUND' | 'INVALID_PASSWORD'` and optional `resolvedUserId?: string`. Sets `this.name = 'UnauthorizedException'` to preserve the exact public HTTP error code contract.
   - Throws `InvalidCredentialsException('USER_NOT_FOUND')` when no account exists for the provided email.
   - Throws `InvalidCredentialsException('INVALID_PASSWORD', user.id)` when an account exists but password verification fails.
2. **Controller Audit Attribution & Error Isolation**:
   - In `apps/api/src/modules/auth/auth.controller.ts`, updated `login()` catch block:
     - For `InvalidCredentialsException`: emits `AuditAction.AUTH_LOGIN_FAILED` with `metadata: { reason: e.reason }` and `targetId: e.resolvedUserId` (only populated for `INVALID_PASSWORD`; omitted for `USER_NOT_FOUND`).
     - For unexpected errors (e.g. database/Redis connection failure): emits `AuditAction.AUTH_LOGIN_FAILED` with `metadata: { reason: 'INTERNAL_ERROR' }` without `targetId`, and rethrows the original error to preserve 500 status and logging.
     - Preserves OWASP / CWE-204 client contract: external HTTP responses remain generic 401 Unauthorized `{ error: { code: 'UnauthorizedException', message: 'Invalid credentials', requestId } }` with no account enumeration leakage.
     - Strictly prevents secret leakage: passwords, password hashes, and raw database exception strings are never passed to audit metadata.
3. **Test Suite Expansion & Finding M1 Remediation**:
   - Added unit test suite `apps/api/src/modules/auth/auth.service.spec.ts` covering success, `USER_NOT_FOUND`, `INVALID_PASSWORD`, error propagation, and logout.
   - Expanded unit tests in `apps/api/src/modules/auth/auth.controller.spec.ts` covering audit reasons, safe user attribution, credential non-leakage, and infrastructure error handling.
   - Addressed Muse review Finding M1: removed vacuous test with no assertions and retitled adjacent test to accurately reflect that it verifies `logActionBestEffort` invocation and `InvalidCredentialsException` propagation on credential failure.
   - Updated API E2E tests (`apps/api/test/auth.e2e-spec.ts`) asserting live PostgreSQL `AuditLog` row persistence with expected reasons and target IDs.

### 3. Verification & Test Evidence

- **Test Suite Verification**:
  - `apps/api/src/modules/auth/auth.controller.spec.ts`: 6/6 tests passing.
  - `apps/api/src/modules/auth/auth.service.spec.ts`: 6/6 tests passing.
  - `apps/api/src/modules/core/audit.service.spec.ts`: 5/5 tests passing.
  - Full API Unit Test Suite: 18/18 test files, 197/197 tests passing.
  - API E2E Test Suite (`pnpm --filter @agency-os/api test:e2e`): 5/5 suites, 79/79 tests passing (`accounts`, `analytics`, `auth`, `publishing`, `media.storage`).
  - Monorepo Lint & Typecheck: All tasks passing (0 errors).
  - Pre-Merge CI: All 6 check runs green on reviewed HEAD `a13ea54`.
  - Post-Merge Push CI Run #40345077579: All 5 push check runs green on `main` (`f41afaf`).

### 4. Remaining Follow-Ups

1. **ESLint `no-floating-promises` Rule Escalation**:
   - Evaluate escalating ESLint `no-floating-promises` from warning to error; check existing violations and migration scope across workspace packages. (**MERGED / CLOSED** in PR #29, merge commit [`57e8c21`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/57e8c21904714ae8005506a1dc102aff4c16422e)).
2. **Production Docker Runner Image Slimming**:
   - Optional optimization to prune devDependencies and unused workspace packages in runner stages (`apps/api/Dockerfile`, `apps/worker/Dockerfile`).
3. **Future Feature Dependency — Worker Catch-Path Disconnect Fencing**:
   - Retained as a future feature dependency when account disconnect API endpoints are introduced (`apps/worker/src/publishing/publishing.processor.ts`).

---

## 29. ESLint `no-floating-promises` Rule Escalation (Branch `feat/escalate-eslint-no-floating-promises` — MERGED)

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #29, merge commit [`57e8c21904714ae8005506a1dc102aff4c16422e`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/57e8c21904714ae8005506a1dc102aff4c16422e))
- **Pull Request**: [#29](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/29)
- **Branch**: `feat/escalate-eslint-no-floating-promises`
- **Pre-Merge Base SHA**: [`9b5be58a5ef5354492269e3281ce19276b38072b`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9b5be58a5ef5354492269e3281ce19276b38072b) (`9b5be58`)
- **Reviewed Head SHA**: [`f70d12f39f1adbdcbe7750f342af1951fd9f3525`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/f70d12f39f1adbdcbe7750f342af1951fd9f3525) (`f70d12f`)
- **Merge Commit SHA**: [`57e8c21904714ae8005506a1dc102aff4c16422e`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/57e8c21904714ae8005506a1dc102aff4c16422e) (`57e8c21`)
- **Merge Timestamp**: `2026-10-27T11:18:01Z`
- **Pre-Merge CI Run**: [Run #40361296187](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40361296187) (All 6 check runs green on reviewed HEAD `f70d12f`)
- **Post-Merge Push CI Run**: [Run #40495151321](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40495151321) (All 5 push check runs green on `main` `57e8c21`)
- **Reviewer**: Muse (APPROVED)

### 2. Scope & Implementation Details

1. **Rule escalation**:
   - In `apps/api/eslint.config.mjs` (line 38) and `apps/worker/eslint.config.mjs` (line 36), changed `@typescript-eslint/no-floating-promises` from `'warn'` to `'error'`.
   - Both configs extend `recommendedTypeChecked` with `parserOptions.projectService: true`, so the rule runs with full type information — the escalation is genuinely enforced, not a silent no-op.
   - Lint globs (`{src,apps,libs,test}/**/*.ts`) cover source and test files; with no `--max-warnings` flag, `error` findings now fail CI while unrelated `warn` findings (e.g. `no-unsafe-argument`) remain non-blocking.
2. **No missed locations**:
   - Repository-wide search confirms the rule is defined only in these two configs; the web, database, and providers configs never defined it, so no third `warn` was left behind.
3. **No behavior change**:
   - Config-only change (+2/−2); no source, test, dependency, or schema changes; no runtime behavior modified.

### 3. Verification & Test Evidence

- **CI Verification**:
  - Pre-Merge CI Run #40361296187: All 6 check runs green on reviewed HEAD `f70d12f` (`GitGuardian`, `Application Builds`, `Tests`, `Code Quality`, `Docker Build & Smoke Test`, `API E2E Tests`).
  - GitHub Actions Post-Merge Push CI Run #40495151321: All 5 push check runs green on `main` (`57e8c21`).
  - The green Code Quality run at `error` severity proves zero pre-existing floating-promise violations in the api/worker lint scope — the escalation introduced no cleanup debt.
- **Review**: Independent Muse review APPROVED at reviewed HEAD `f70d12f` (config-only scope, type-aware enforcement verified, no missed locations).

### 4. Remaining Follow-Ups

1. **Production Docker Runner Image Slimming**:
   - Optional optimization to prune devDependencies and unused workspace packages in runner stages (`apps/api/Dockerfile`, `apps/worker/Dockerfile`). (**MERGED / CLOSED** in PR #31, merge commit [`673e401`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/673e40139dcc0c50b11def35be6df364b237d5b6)).
2. **Future Feature Dependency — Worker Catch-Path Disconnect Fencing**:
   - Retained as a future feature dependency when account disconnect API endpoints are introduced (`apps/worker/src/publishing/publishing.processor.ts`).

---

## 31. Production Docker Runner Image Slimming & Attack Surface Pruning (Branch `feat/slim-production-docker-runners` — MERGED)

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #31, merge commit [`673e40139dcc0c50b11def35be6df364b237d5b6`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/673e40139dcc0c50b11def35be6df364b237d5b6))
- **Pull Request**: [#31](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/31)
- **Branch**: `feat/slim-production-docker-runners`
- **Pre-Merge Base SHA**: [`554161594bb207ebba162712055e16042f9b0dd9`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/554161594bb207ebba162712055e16042f9b0dd9) (`5541615`)
- **Reviewed Head SHA**: [`9bbe864cf6964d13227045cd5cfcbb103567bf1b`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9bbe864cf6964d13227045cd5cfcbb103567bf1b) (`9bbe864`)
- **Merge Commit SHA**: [`673e40139dcc0c50b11def35be6df364b237d5b6`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/673e40139dcc0c50b11def35be6df364b237d5b6) (`673e401`)
- **Merge Timestamp**: `2026-10-28T10:05:17Z`
- **Pre-Merge CI Run**: [Run #40524109156](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40524109156) (All 6 check runs green on reviewed HEAD `9bbe864`)
- **Post-Merge Push CI Run**: [Run #40669318801](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40669318801) (All 5 push check runs green on `main` `673e401`)
- **Reviewer**: Muse (APPROVED)

### 2. Scope & Implementation Details

1. **Workspace-Aware Production Dependency Slimming**:
   - In pnpm monorepos, running `pnpm prune --prod` at the root does not recursively purge workspace packages' `devDependencies` (such as `vitest`, `eslint`, `typescript`, `@types/*`, `@nestjs/schematics`).
   - Replaced root prune with a scoped production re-installation workflow in the Dockerfile installer stages (`apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile`):
     - After building workspace artifacts, purged all development `node_modules` (`rm -rf node_modules apps/*/node_modules packages/*/node_modules`).
     - Executed `pnpm install --prod --frozen-lockfile` to install strictly production dependencies monorepo-wide, eliminating testing tools, linters, typecheckers, and compilers from the runner image layers.
2. **Prisma Client Generation & Runtime Preservation**:
   - Because `@prisma/client` depends on the generated client engine definitions, purging `node_modules` before production reinstall would remove generated Prisma artifacts.
   - Preserved generated Prisma client definitions from `node_modules/.pnpm/@prisma+client*/node_modules/.prisma` to `/tmp/prisma-generated` prior to purging.
   - Restored `/tmp/prisma-generated/.prisma` back into the production pnpm virtual store and root `.prisma` after the production install, ensuring runtime compatibility and query execution without devDependencies.
3. **Attack Surface Reduction & Source Pruning**:
   - Pruned source directories (`src/`), test files (`test/`, `*.spec.ts`), TypeScript configurations (`tsconfig*.json`), and build cache directories from runner stages before packaging.
   - Enforced non-root execution across all runner images (`USER appuser`, primary group `appgroup`).
4. **Hardened CI Docker Smoke Test**:
   - Updated `.github/workflows/ci.yml`:
     - Replaced permissive `curl -s` with `curl -fsS http://localhost:3001/api/health/ready` to fail fast on non-2xx responses (including HTTP 503 during startup).
     - Explicitly asserted that response body contains verified database readiness (`"database":{"status":"up"}`).
     - Added a direct Prisma database query probe executed within the API container (`docker compose exec -w /app/apps/api -T api node -e ... prisma.$queryRawUnsafe("SELECT 1 as test")`) exercising live PostgreSQL connectivity beyond basic HTTP health.
     - Hardened Web frontend check with `curl -fsS http://localhost:3000` and non-zero exit traps.

### 3. Verification & Test Evidence

- **Container Dependency Inspection**:
  - Verified 0 test or dev dependencies (`vitest`, `jest`, `eslint`, `typescript`, `tsx`, `@nestjs/schematics`) exist in final `agency-os-api` and `agency-os-worker` runner images.
  - Runtime image sizes: `agency-os-api` content 128MB (disk 732MB), `agency-os-worker` content 128MB (disk 741MB), `agency-os-web` content 261MB (disk 1.17GB).
- **Local Smoke Test**:
  - Full docker-compose stack built and run locally (`api`, `worker`, `web`, `postgres`, `redis`, `migration`).
  - Migration executed and exited with code 0.
  - Direct Prisma database query probe `SELECT 1 as test` succeeded against PostgreSQL.
  - Web container responded `HTTP/1.1 200 OK`.
- **Pre-Merge CI**:
  - GitHub Actions Pre-Merge CI Run #40524109156: All 6 check runs completed with `success` on reviewed HEAD `9bbe864`.
- **Post-Merge CI**:
  - GitHub Actions Post-Merge Push CI Run #40669318801: All 5 check runs completed with `success` on `main` (`673e401`).
- **Review**: Independent Muse review APPROVED on reviewed HEAD `9bbe864`.

### 4. Remaining Follow-Ups

1. **Future Feature Dependency — Worker Catch-Path Disconnect Fencing**:
   - Retained as a future feature dependency when account disconnect API endpoints are introduced (`apps/worker/src/publishing/publishing.processor.ts`).

---

## 32. Phase 5 — Unified Workspace Analytics Dashboard & Account Detail View (Branch `feat/workspace-analytics-dashboard` — MERGED)

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #33, merge commit [`90e64477a688f1d0b44aa596e0f493ee17d67ea2`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/90e64477a688f1d0b44aa596e0f493ee17d67ea2))
- **Pull Request**: [#33](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/33)
- **Branch**: `feat/workspace-analytics-dashboard`
- **Pre-Merge Base SHA**: [`97f3428e5240d70907fe066c02b550cbc2cc346a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/97f3428e5240d70907fe066c02b550cbc2cc346a) (`97f3428`)
- **Reviewed Head SHA**: [`8400d82156b69b408fac5f97485f9e9712e0d362`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/8400d82156b69b408fac5f97485f9e9712e0d362) (`8400d82`)
- **Merge Commit SHA**: [`90e64477a688f1d0b44aa596e0f493ee17d67ea2`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/90e64477a688f1d0b44aa596e0f493ee17d67ea2) (`90e6447`)
- **Merge Strategy**: Standard GitHub merge commit (2 parents: `97f3428` and `8400d82`)
- **Merge Timestamp**: `2026-10-28T11:56:30Z`
- **Pre-Merge CI Run**: [Run #40679923292](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40679923292) (All 6 check runs green on reviewed HEAD `8400d82`)
- **Post-Merge Push CI Run**: [Run #40683828389](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40683828389) (All 5 push check runs green on `main` `90e6447`)
- **Reviewer**: Muse (APPROVED)

### 2. Scope & Implementation Details

1. **Unified Workspace Analytics Overview (`apps/web/src/app/[workspaceId]/analytics/page.tsx`)**:
   - Authenticated client page querying `GET /api/v1/workspaces/:workspaceId/analytics/overview`.
   - Aggregates top-level metrics across all connected accounts:
     - **Total Followers**: Sum of latest daily followers across connected accounts.
     - **Total Engagement**: Sum of latest daily engagement across connected accounts.
     - **Connected Accounts**: Total count of social accounts associated with the workspace.
     - **Active Accounts**: Count of accounts currently in `ACTIVE` status.
   - Per-account breakdown list with provider icons/badges (`LINKEDIN`, etc.), account display name, status badges (`ACTIVE`, `REAUTH_REQUIRED`, `DISCONNECTED`), individual follower and engagement counts, and direct navigation link to account drill-down.
   - For accounts in `REAUTH_REQUIRED`, provides explicit guidance and a link to accounts settings (`/[workspaceId]/accounts`) to reconnect.
   - Comprehensive UI state handling:
     - **Loading State**: Accessible skeleton cards with `role="status"` and `aria-label="Loading analytics"`.
     - **Empty State**: Friendly onboarding prompt with CTA to connect a social account when no accounts exist.
     - **Access Denied**: Clear 403 forbidden message when a user lacks access to the workspace.
     - **Error State**: Resilient error banner with Retry action.
     - **Header Refresh Action**: Manual refresh button with spinning icon state during `isFetching`.
2. **Account Drill-Down Historical Trends (`apps/web/src/app/[workspaceId]/analytics/[accountId]/page.tsx`)**:
   - Queries `GET /api/v1/workspaces/:workspaceId/analytics/accounts/:accountId` (the backend computes the 30-day history window server-side; the frontend does not pass a query parameter or request a custom date range).
   - Visualizes 30-day historical follower and engagement trajectories using `recharts` responsive line charts.
   - Displays account metadata header, current status badge, breadcrumb navigation back to workspace analytics, and date formatting.
   - Provides honest empty-state handling if no metric history has been recorded yet.
3. **Workspace Navigation Alignment**:
   - Root route `apps/web/src/app/page.tsx` updated to redirect cleanly to `/dashboard`.
   - Main dashboard (`apps/web/src/app/dashboard/page.tsx`) per-workspace card's "Enter Workspace" CTA routes to `/{workspaceId}/analytics`.
4. **Delivered Limitations (Explicitly Documented)**:
   - **Snapshot Limitation**: The overview dashboard displays the single latest recorded daily snapshot per connected account as returned by the existing backend endpoint. Date-range query filtering is not supported by the backend overview endpoint; date filtering was not implemented on the overview.
5. **Non-Blocking Future Polish Observations (from Muse Review)**:
   1. **Provider/status badge duplication**: Provider/status badge helper logic is duplicated across the overview and account pages, with slight divergence in reauthentication wording.
   2. **Account not-found navigation fallback**: The account 404 state relies on `router.back()` without a fallback destination.
   3. **Date-only timezone formatting**: Formatting date-only values in local time can shift the displayed date for users west of UTC. This follows the existing application convention and was not considered a merge blocker.

### 3. Verification & Test Evidence

- **Web Unit Tests**:
  - Added 20 comprehensive unit tests across 2 new test suites:
    - `apps/web/src/app/[workspaceId]/analytics/page.spec.tsx` (11 tests): Loading skeletons, metric card rendering, account breakdown table, active/reauth badges, empty state, 403 access-denied state, error state with retry, refresh trigger, and navigation links.
    - `apps/web/src/app/[workspaceId]/analytics/[accountId]/page.spec.tsx` (9 tests): Account header, 30-day history query, recharts rendering, loading, and error states.
  - `pnpm --filter @agency-os/web test`: 8/8 test suites passed, 111/111 tests passed.
- **Monorepo Code Quality**:
  - `pnpm turbo run lint`: 0 errors across all monorepo packages.
  - `pnpm turbo run typecheck`: Typecheck green across the monorepo.
  - `pnpm turbo run build`: All applications and packages compiled successfully.
- **Pre-Merge CI (Commit `8400d82` / Run #40679923292)**:
  - `GitGuardian Security Checks`: **SUCCESS** (Green)
  - `CI / Application Builds`: **SUCCESS** (Green)
  - `CI / Tests`: **SUCCESS** (Green)
  - `CI / Code Quality (Lint & Typecheck)`: **SUCCESS** (Green)
  - `CI / Docker Build & Smoke Test`: **SUCCESS** (Green)
  - `CI / API E2E Tests`: **SUCCESS** (Green)
- **Post-Merge CI (Commit `90e6447` / Run #40683828389)**:
  - All 5 push check runs completed with `success` on `main`.
- **Review**: Independent Muse review APPROVED on reviewed HEAD `8400d82`.

### 4. Remaining Follow-Ups

1. **Phase 6 Hardening**:
   - Complete remaining Phase 6 backend hardening: staging/production deployment configurations, external production secret store integration.
2. **Future Feature Dependency — Worker Catch-Path Disconnect Fencing**:
   - Retained as a future feature dependency when account disconnect API endpoints are introduced (`apps/worker/src/publishing/publishing.processor.ts`).

---

## 33. Phase 6 — Environment Secret Management & Fail-Fast Token Encryption Startup Validation (Branch `feat/token-encryption-startup-validation` — MERGED)

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #35, merge commit [`cb63286355dce02a5b3d4bf79cfb2ceaff7d21a0`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cb63286355dce02a5b3d4bf79cfb2ceaff7d21a0))
- **Pull Request**: [#35](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/35)
- **Branch**: `feat/token-encryption-startup-validation`
- **Pre-Merge Base SHA**: [`44c67e66a1886109af829f7aae01af4d6a99418d`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/44c67e66a1886109af829f7aae01af4d6a99418d) (`44c67e6`)
- **Reviewed Head SHA**: [`e34c49357873847ed42561417ac07dac471654a1`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e34c49357873847ed42561417ac07dac471654a1) (`e34c493`)
- **Merge Commit SHA**: [`cb63286355dce02a5b3d4bf79cfb2ceaff7d21a0`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cb63286355dce02a5b3d4bf79cfb2ceaff7d21a0) (`cb63286`)
- **Merge Strategy**: Standard GitHub merge commit (2 parents: `44c67e6` and `e34c493`)
- **Merge Timestamp**: `2026-10-28T17:59:42Z`
- **Pre-Merge CI Checks**: [Commit `e34c493` Checks](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/35/checks) (All 6 check runs green on reviewed HEAD `e34c493`)
- **Post-Merge Push CI Run**: [Run #40740935679](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40740935679) (All 5 push check runs green on `main` `cb63286`)
- **Reviewer**: Muse (APPROVED)

### 2. Scope & Implementation Details

1. **Shared 32-Byte Token Encryption Key Validation (`packages/database/src/crypto/encryption.ts`)**:
   - Implemented and exported `validateTokenEncryptionKey(env?: Record<string, string | undefined>): Buffer`.
   - Enforces that `TOKEN_ENCRYPTION_KEY` is present, non-empty, and exactly 64 hexadecimal characters (representing 32 bytes for AES-256-GCM).
   - Rejects missing, undefined, empty, non-hex, or incorrect-length strings (e.g., 32-character or 63-character strings) with clear error messages, while key-generation guidance via `openssl rand -hex 32` is provided in `.env.example` and the Docker Compose required-variable error message.
   - Accepts uppercase, lowercase, and mixed-case hex, trimming leading and trailing whitespace safely.
   - Updated `encrypt()` and `decrypt()` to consume the validated key buffer via `validateTokenEncryptionKey()`.
2. **Fail-Fast Startup Validation in API and Worker**:
   - **API Bootstrap (`apps/api/src/main.ts`)**: Placed `validateTokenEncryptionKey()` at the entry point of `bootstrap()` before `NestFactory.create(AppModule)` and port binding, ensuring invalid encryption-key configuration causes the API to fail immediately at startup rather than waiting until the first token-encryption/decryption operation.
   - **Worker Bootstrap (`apps/worker/src/main.ts`)**: Placed `validateTokenEncryptionKey()` at the entry point of `bootstrap()` before initializing the Nest application context and BullMQ queue processors, ensuring invalid encryption-key configuration causes the worker to fail fast at startup before consuming jobs from queues.
3. **Environment Template Documentation (`.env.example`)**:
   - Documented `TOKEN_ENCRYPTION_KEY` with explicit generation instructions (`openssl rand -hex 32`).
   - Completed documented environment variables for LinkedIn OAuth integration: `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.
   - Documented frontend application URL configuration: `FRONTEND_URL` (default `http://localhost:3000`).
4. **Docker Compose Secret Hardening (`docker-compose.yml`)**:
   - Removed hardcoded default key fallbacks (`${TOKEN_ENCRYPTION_KEY:-0123456789abcdef...}`) from both `api` and `worker` services.
   - Replaced with required-variable interpolation syntax:
     `${TOKEN_ENCRYPTION_KEY:?TOKEN_ENCRYPTION_KEY must be set; generate one with openssl rand -hex 32}`
   - Docker Compose now aborts with a clear descriptive error message if `TOKEN_ENCRYPTION_KEY` is omitted or empty, preventing silent insecure deployments.
5. **CI Docker Smoke Test Secret Provisioning (`.github/workflows/ci.yml`)**:
   - Explicitly passed a dedicated test-only 64-hex key, scoped to the Docker CI job and explicitly configured for the `Build Docker images` and `Smoke test Compose stack` steps so automated compose smoke testing succeeds without requiring default secrets in `docker-compose.yml`. This key is strictly test-only and does not serve as a production secret or default.

### 3. Verification & Test Evidence

- **Database Unit Tests (`packages/database/src/crypto/encryption.spec.ts`)**:
  - 17 unit tests verifying key length, hex validation, whitespace trimming, case insensitivity, default vs provided environment records, and error messages.
  - Automated regression tests parsing `docker-compose.yml` to assert required `:?` interpolation without `:-` fallbacks for `api` and `worker`, and verifying CI smoke test key provisioning using zero external dependencies.
- **API Startup Tests (`apps/api/src/main.spec.ts`)**:
  - 3 unit tests verifying fast failure on missing key, fast failure on invalid key format, and successful initialization when a valid 64-hex key is provided.
- **Worker Startup Tests (`apps/worker/src/main.spec.ts`)**:
  - 3 unit tests verifying fast failure on missing key, fast failure on invalid key format, and successful initialization when a valid 64-hex key is provided.
- **Monorepo Code Quality**:
  - Monorepo lint and typecheck completed successfully, corroborated by green CI checks.
  - Application and package builds completed successfully.
- **Pre-Merge CI (Commit `e34c493`)**:
  - `GitGuardian Security Checks`: **SUCCESS** (Green)
  - `Docker Build & Smoke Test`: **SUCCESS** (Green)
  - `API E2E Tests`: **SUCCESS** (Green)
  - `Application Builds`: **SUCCESS** (Green)
  - `Tests`: **SUCCESS** (Green)
  - `Code Quality (Lint & Typecheck)`: **SUCCESS** (Green)
- **Post-Merge CI (Commit `cb63286` / Run #40740935679)**:
  - All 5 push check runs completed with `success` on `main`.
- **Review**: Independent Muse review APPROVED on reviewed HEAD `e34c493`.

### 4. Remaining Follow-Ups

1. **Phase 6 Hardening**:
   - Complete remaining Phase 6 backend hardening: Structured Pino observability logger, staging/production deployment configurations.
2. **Future Feature Dependency — Worker Catch-Path Disconnect Fencing**:
   - Retained as a future feature dependency when account disconnect API endpoints are introduced (`apps/worker/src/publishing/publishing.processor.ts`).

## 34. Phase 6 — Structured Pino Observability & Request Correlation (Branch `feat/structured-pino-observability` — MERGED)

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #37, merge commit [`e63f7a30b6022c8a38bb4659594e0f3990d5044d`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e63f7a30b6022c8a38bb4659594e0f3990d5044d))
- **Pull Request**: [#37](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/37)
- **Branch**: `feat/structured-pino-observability`
- **Pre-Merge Base SHA**: [`e55416c53b80afd49acca29fddd7aa72794ffa8d`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e55416c53b80afd49acca29fddd7aa72794ffa8d) (`e55416c`)
- **Reviewed Head SHA**: [`c377557c33698c1c049eb4f2f062c4a0d22b0d9a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/c377557c33698c1c049eb4f2f062c4a0d22b0d9a) (`c377557`)
- **Merge Commit SHA**: [`e63f7a30b6022c8a38bb4659594e0f3990d5044d`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e63f7a30b6022c8a38bb4659594e0f3990d5044d) (`e63f7a3`)
- **Merge Strategy**: Standard GitHub merge commit (2 parents: `e55416c` and `c377557`)
- **Merge Timestamp**: `2026-10-29T10:45:34Z`
- **Pre-Merge CI Checks**: [Commit `c377557` Checks](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/37/checks) (All 6 check runs green on reviewed HEAD `c377557`)
- **Post-Merge Push CI Run**: [Run #40860080744](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40860080744) (All 5 push check runs green on `main` `e63f7a3`)
- **Reviewer**: Muse (APPROVED)

### 2. Scope & Implementation Details

1. **Structured Pino Logging & Configuration (`apps/api/src/modules/core/logger.config.ts`, `apps/worker/src/logger.config.ts`)**:
   - Integrated `nestjs-pino` in the API and established a standalone/worker logger configuration in the Worker.
   - Dynamic log-level control via `LOG_LEVEL` environment variable with production default `info` and development default `debug`.
   - Output emitted as structured JSON in both production and development (newline-delimited structured logs without uninstalled external pretty-printers).
   - Strict secret redaction paths covering camelCase, snake_case, and nested structures up to 5 levels deep (`access_token`, `accessToken`, `refresh_token`, `refreshToken`, `client_secret`, `clientSecret`, `token_secret`, `password`, `*.config.headers.Authorization`, `*.response.data.access_token`).
   - Scoped `code` and `state` redactions to query and body shapes (`req.query.code`, `req.query.state`, `body.code`, `body.state`), preserving operational failure codes (e.g. `code: 'TRANSITION_FAILED'`) in application and exception logs.
   - Case-insensitive header casing variants covered (`Authorization`, `authorization`, `Cookie`, `cookie`, `Set-Cookie`, `set-cookie`, `X-CSRF-Token`, `x-csrf-token`).
2. **Request Correlation & URL Query Parameter Sanitization (`apps/api/src/modules/core/`)**:
   - Implemented `correlation-id.utils.ts` standardizing correlation ID extraction, regex format validation (`/^[a-zA-Z0-9._-]{1,128}$/`), array header extraction, fresh UUID fallback generation, and response header attachment (`attachCorrelationIdToResponse`).
   - Implemented `url-sanitizer.utils.ts` to sanitize sensitive query parameters (`code`, `state`, `token`, `accessToken`, `access_token`, `refreshToken`, `refresh_token`, `clientSecret`, `client_secret`, `password`, `secret`) from request URLs.
   - Updated `AllExceptionsFilter` (`apps/api/src/filters/all-exceptions.filter.ts`) to sanitize `request.url` in both `Error` and non-`Error` 5xx branches, attach `x-request-id` response header, and include `requestId` in structured error responses.
3. **BullMQ Request Correlation Propagation & Shared Queue Types (`packages/shared/src/queue/queue.types.ts`)**:
   - Defined and exported `SyncJobData`, `PublishJobData`, and `PublishDeleteJobData` in `@agency-os/shared` with typed optional `correlationId?: string` and `operationId?: string`.
   - Propagated incoming request correlation ID to `syncQueue.add` in `AccountsController.triggerSync`, `OAuthService.processDiscoverySelection`, and `OAuthService.handleOAuthCallback`.
   - Bound `jobMeta` (`jobId`, `publicationId`, `correlationId`, `operationId`) across all worker execution lifecycle phases in `PublishingProcessor` (`processDelete`, `process`, claims, continuations, status polling, `handleFailure`, `handleUnknown`, `handleSuccess`) and `SyncProcessor`.
   - Maintained full backward compatibility for un-correlated jobs enqueued without a correlation ID.
4. **Dependency Injection Hardening & Fallback Elimination**:
   - Removed unsafe `logger ?? new PinoLogger({})` and `@Optional()` across all 11 audited services, processors, filters, and controllers in `@agency-os/api` and `@agency-os/worker`.
   - Enforced required `PinoLogger` injection via NestJS dependency injection.
   - Handled transient scoping of `PinoLogger` via `await app.resolve(PinoLogger)` in application bootstraps and E2E test suites, and explicit mock loggers in unit tests.
   - Replaced raw `console.log` and `console.error` calls with structured logger methods (`logger.info`, `logger.warn`, `logger.error`, `logger.debug`).

### 3. Verification & Test Evidence

- **API Logger & Exception Filter Unit Tests (`apps/api/src/modules/core/logger.spec.ts`)**:
  - 24 comprehensive unit and integration tests covering URL query parameter sanitization, 5xx Error/non-Error leakage prevention, correlation ID regex validation, casing variants, and operational error code preservation.
- **Worker Logger Unit Tests (`apps/worker/src/logger.spec.ts`)**:
  - 11 unit tests covering production/development log levels, structured JSON output with ISO timestamps, sensitive credential redaction, operational error code preservation, snake_case and nested structures up to 5 levels deep, BullMQ job payload redaction, correlationId and operationId propagation across worker execution metadata, delete job correlation, and backward compatibility for legacy un-correlated jobs.
- **API Test Suite (`pnpm --filter @agency-os/api test`)**:
  - 20 test files passed, 224 tests passed (0 failures).
- **API E2E Tests (`apps/api/test/accounts.e2e-spec.ts`)**:
  - Verified sync queue payload assertion expecting `correlationId: expect.stringMatching(/^[a-zA-Z0-9._-]{1,128}$/)` and matching `x-request-id` response header.
- **Worker Storage Integration Tests**:
  - Verified `linkedin.storage.integration.spec.ts`, `youtube.storage.integration.spec.ts`, `meta.reels.storage.integration.spec.ts`, `publishing.worker.spec.ts`, `sync.processor.spec.ts`.
- **Monorepo Code Quality**:
  - `pnpm turbo run lint typecheck build`: 18/18 tasks successful, 0 errors.
- **Pre-Merge CI (Commit `c377557`)**:
  - `Application Builds`: **SUCCESS** (Green)
  - `Docker Build & Smoke Test`: **SUCCESS** (Green)
  - `API E2E Tests`: **SUCCESS** (Green)
  - `Tests`: **SUCCESS** (Green)
  - `Code Quality (Lint & Typecheck)`: **SUCCESS** (Green)
  - `GitGuardian Security Checks`: **SUCCESS** (Green)
- **Post-Merge CI (Commit `e63f7a3` / Run #40860080744)**:
  - All 5 push check runs completed with `success` on `main`.
- **Review**: Independent Muse review APPROVED on reviewed HEAD `c377557`.

### 4. Remaining Follow-Ups

1. **Phase 6 Hardening**:
   - Complete remaining Phase 6 backend hardening: staging/production deployment configurations, external production secret store integration.
2. **Future Feature Dependency — Worker Catch-Path Disconnect Fencing**:
   - Retained as a future feature dependency when account disconnect API endpoints are introduced (`apps/worker/src/publishing/publishing.processor.ts`).

## 35. Phase 6.5 — Staging/Deployment Hardening (PR #39)

### 1. Summary & Motivation

- **Status**: **MERGED & VERIFIED IN CI (PR #39)**
- **Pull Request**: [#39](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/39)
- **Branch**: `feat/staging-deployment-hardening`
- **Pre-Merge Base SHA**: [`d2c6bc06438b0a0c9e3fa4b540e81fb8e28d4790`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/d2c6bc06438b0a0c9e3fa4b540e81fb8e28d4790) (`d2c6bc0`)
- **Reviewed Head SHA**: [`160bcd7d5e9c9338c75e42a5fa70433863fe0436`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/160bcd7d5e9c9338c75e42a5fa70433863fe0436) (`160bcd7`)
- **Merge Commit SHA**: [`dbc89382310cd02a5671bbd210264be871cb0d82`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/dbc89382310cd02a5671bbd210264be871cb0d82) (`dbc8938`)
- **Merge Strategy**: Standard GitHub merge commit (2 parents: `d2c6bc0` and `160bcd7`)
- **Merge Timestamp**: `2026-10-29T16:07:40Z`
- **First Parent**: [`d2c6bc06438b0a0c9e3fa4b540e81fb8e28d4790`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/d2c6bc06438b0a0c9e3fa4b540e81fb8e28d4790)
- **Second Parent**: [`160bcd7d5e9c9338c75e42a5fa70433863fe0436`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/160bcd7d5e9c9338c75e42a5fa70433863fe0436)
- **Pre-Merge CI Checks**: [Commit `160bcd7` Checks](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/39/checks) (All 6 check runs green on reviewed HEAD `160bcd7`: GitGuardian Security Checks, Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test)
- **Post-Merge Push CI Run**: [Run #40908483805](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/40908483805) (All 5 push check runs green on `main` `dbc8938`: Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test)
- **Reviewer**: Muse (APPROVED)
- **Scope**: Production/staging deployment configuration, non-root NGINX ingress reverse proxy (`nginxinc/nginx-unprivileged:1.31.7-alpine`) routing `/api/*` to NestJS API and `/` to Next.js Web under a unified origin, query-parameter-stripped access logs preventing plain-text OAuth credential logging (H1), production HTTPS cookie enforcement and fail-fast unencrypted HTTP rejection before credential verification (N1, H2), trusted edge forwarded proto mapping with origin firewall requirements (H2, L8), keepalive upstream connection preservation (L2), `X-Forwarded-Host` forwarding (L3), dedicated `/healthz` probe returning `healthy\n` (L4), 60s/120s proxy timeouts (L5), Docker Compose staging isolation unpublishing internal service ports from host exposure with Compose v2.24.4 or later requirement (L11), fail-fast genuinely required staging secrets enforcement without unused variables (M1, L6), accurate smoke test scope documentation (L9), 23 automated regression tests in `staging-deployment.spec.ts`, 12 unit tests in `auth.controller.spec.ts`, and CI staging smoke test extension.
- **Verification Boundaries**:
  - **Completed & Verified in Repository / CI**:
    - _Implementation merged into `main`_: **YES** (Standard merge commit `dbc89382310cd02a5671bbd210264be871cb0d82`).
    - _Required PR CI checks passed on reviewed HEAD (`160bcd7`)_: **YES** (All 6 check runs successful: GitGuardian Security Checks, Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test).
    - _Post-merge CI checks passed on merge commit (`dbc8938`)_: **YES** (All 5 push check runs successful on `main`: Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test).
    - _Automated unit & regression tests passed_: **YES** (23/23 tests in `staging-deployment.spec.ts`, 12/12 tests in `auth.controller.spec.ts`, 253 API unit tests across 21 test files, 17 database crypto tests).
    - _CI staging Compose smoke test passed_: **YES** (Exercises core ingress and application stack: PostgreSQL, Redis, database migrations, API, Worker, Web, and Ingress behind NGINX port 8080 with zero host exposure for internal services; MinIO excluded due to Docker Hub registry pull restrictions).
  - **Still Pending Live Operator Verification (External Infrastructure)**:
    - _Staging DNS_: **PENDING OPERATOR DNS PROVISIONING** (Provisioning DNS A/CNAME record on registrar pointing to staging host).
    - _TLS certificate provisioning or edge TLS configuration_: **PENDING OPERATOR TLS CONFIGURATION** (Edge TLS via Cloudflare/ALB with `TRUST_PROXY=1` or host-level ACME/Certbot provisioning).
    - _Origin firewall rules_: **PENDING OPERATOR FIREWALL CONFIGURATION** (Restricting host ingress port 80/8080 strictly to trusted edge proxy CIDRs).
    - _Live VPS deployment_: **PENDING OPERATOR DEPLOYMENT RUN** (Executing `docker compose -f docker-compose.staging.yml up -d` on live target host with production environment secrets).
    - _Live endpoint, authentication, and infrastructure health verification_: **PENDING LIVE DEPLOYMENT** (Probing live domain `/healthz`, `/api/health/ready`, and production login flow on real infrastructure).

### 2. Scope & Implementation Details

1. **Unified Non-Root NGINX Ingress Reverse Proxy (`docker/nginx/nginx.conf`, `docker/nginx/Dockerfile`)**:
   - Pinned base image to `nginxinc/nginx-unprivileged:1.31.7-alpine` running as unprivileged user `nginx` (UID 101), listening on internal port 8080, with PID directed to `/tmp/nginx.pid` and temporary buffers routed to writable `/tmp/*_temp` paths (L1).
   - Routed `/api/` traffic to `http://api:3001` and root `/` (along with Next.js static assets and build outputs) to `http://web:3000` under a unified origin, natively resolving cross-subdomain CSRF cookie friction (`csrfToken` host-only cookie accessible by Next.js `document.cookie`).
   - Configured WebSocket connection upgrade mappings (`$http_upgrade`, `$connection_upgrade`) where empty upgrade headers map to empty string `''` (not `'close'`), preserving persistent HTTP/1.1 upstream keepalive connections (L2).
   - Sanitized NGINX access log format to log `$request_method $uri $server_protocol` without query parameters (`$args`), preventing OAuth callback authorization codes and state parameters from being logged in plain text (H1).
   - Enforced client body upload limit of `512m` matching the backend media upload limit `MEDIA_MAX_UPLOAD_BYTES=524288000` (500MB) with 12MB headroom for multipart boundaries and HTTP header overhead.
   - Configured upstream timeouts: `proxy_connect_timeout 60s; proxy_send_timeout 120s; proxy_read_timeout 120s;` (L5).
   - Mapped `$http_x_forwarded_proto` preserving `https` from trusted edge proxies while defaulting to `$scheme` for direct TLS termination (`map $http_x_forwarded_proto $forwarded_proto`) (H2, L8).
   - Configured keepalive upstream connection pooling (`keepalive 32`, `proxy_http_version 1.1`, `Connection ""`), header forwarding (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` via `$forwarded_proto`, and `X-Forwarded-Host`) across both `/api/` and `/` proxy locations (L3).
   - Exposed dedicated `/healthz` endpoint returning HTTP 200 `healthy\n` (`text/plain`) without upstream dependencies for container health probes and orchestrator liveness checks (L4).
2. **Production HTTPS Authentication & Secure Cookie Enforcement (`apps/api/src/modules/auth/auth.controller.ts`)**:
   - Cookie `secure` flag is strictly derived from `req.secure` (`Boolean(req.secure)`).
   - In production (`NODE_ENV === 'production'`), requests over unencrypted HTTP fail fast with `BadRequestException` (`HTTPS is required for authentication in production environments...`) before credential verification, session creation, audit logging, or cookie issuance, preventing credential oracles and side effects (N1, H2).
   - An explicit test-only override `ALLOW_INSECURE_HTTP_AUTH=true` is provided for isolated HTTP testing environments.
   - Logout `clearCookie` matches `{ httpOnly: true, secure: isSecureRequest, sameSite: 'lax' }`.
3. **Staging Compose Isolation & Secret Enforcement (`docker-compose.staging.yml`)**:
   - Requires Docker Compose v2.24.4 or later for Compose specification `ports: !reset []` syntax (L11).
   - Extends the baseline `docker-compose.yml` using `ports: !reset []` syntax to strip host-published port mappings for all internal backing services: Postgres (`5432`), Redis (`6379`), MinIO (`9000`), API (`3001`), and Web (`3000`).
   - Outbound internet access preserved on standard bridge network for OAuth provider exchanges and platform publishing endpoints.
   - Exposed solely the unprivileged ingress reverse proxy on `${STAGING_PORT:-80}:8080`.
   - Removed unused secrets (`SESSION_SECRET`, `JWT_SECRET`, `COOKIE_SECRET`) from compose, documentation, and tests, as the codebase uses Redis session store with UUIDs and unsigned cookies (M1).
   - Enforced fail-fast staging secrets using `${VAR:?error}` syntax without development fallbacks for genuinely required variables: `POSTGRES_PASSWORD`, `TOKEN_ENCRYPTION_KEY`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, `FRONTEND_URL`, `API_PUBLIC_URL`, and `NEXT_PUBLIC_API_URL` (M1, L6).
   - Configured `ALLOW_INSECURE_HTTP_AUTH: ${ALLOW_INSECURE_HTTP_AUTH:-false}` for backend API container.
4. **Automated Test Suite (`apps/api/src/config/staging-deployment.spec.ts` & `auth.controller.spec.ts`)**:
   - Implemented 23 comprehensive regression tests in `staging-deployment.spec.ts` asserting:
     - NGINX configuration syntax verification via container execution (`nginx -t`).
     - Access log format excluding query parameters to protect OAuth secrets (H1).
     - Base image tag pin (`nginxinc/nginx-unprivileged:1.31.7-alpine`) (L1).
     - WebSocket upgrade mapping rules and upstream keepalive pooling directives (L2).
     - Forwarded proto map preserving edge TLS (H2, L8).
     - `X-Forwarded-Host` header forwarding directives (L3).
     - Dedicated `/healthz` probe returning `healthy\n` (L4).
     - Upstream proxy timeouts (60s connect, 120s send/read) (L5).
     - Client body size directive (`512m`) alignment with `MEDIA_MAX_UPLOAD_BYTES`.
     - Route proxy rules (`/api/` -> `api:3001`, `/` -> `web:3000`).
     - Unprivileged runtime paths (`/tmp/nginx.pid`, `/tmp/*_temp`).
     - Staging compose host port isolation asserting `ports: !reset []` across internal services.
     - Staging compose fail-fast validation when genuinely required secrets are missing, and verified unused secret omission (M1).
     - Minimum Docker Compose version documentation check (v2.24.4 or later) (L11).
     - API production configuration assertions (`NODE_ENV=production`, `PORT=3001`, `TRUST_PROXY=1`).
   - Implemented 12 unit tests in `auth.controller.spec.ts` including 6 regression tests verifying:
     - Rejection of plain HTTP login in production with `BadRequestException` before credential verification, preventing credential oracles and side effects (N1).
     - Permitting plain HTTP login in production with `ALLOW_INSECURE_HTTP_AUTH=true`.
     - Issuance of `secure: true` cookies on HTTPS requests in production.
     - Handling of HTTP and HTTPS in development/test environments.
5. **CI Workflow Extension (`.github/workflows/ci.yml`)**:
   - Added `docker build` for ingress image (`docker/nginx/Dockerfile`) to the `docker` job using pinned `nginxinc/nginx-unprivileged:1.31.7-alpine`.
   - Added negative validation step verifying that `docker compose -f docker-compose.staging.yml config` fails fast when required secrets are missing (L7).
   - Extended the staging smoke test running the core Compose stack (Postgres, Redis, API, Worker, Web) behind the NGINX ingress:
     - Validates `/healthz` returns HTTP 200 `healthy\n`.
     - Validates `/api/` routing and health check.
     - Verifies zero exposed host ports for internal services (L9).
6. **Environment Variable & Staging Readiness Documentation (`.env.example`, `docs/phase-6-readiness.md`)**:
   - Cleaned up `.env.example` removing unused `SESSION_SECRET`, `JWT_SECRET`, `COOKIE_SECRET` while preserving genuinely required secrets and documenting `ALLOW_INSECURE_HTTP_AUTH=false`.
   - Updated `docs/phase-6-readiness.md` detailing the implemented ingress architecture, staging compose configuration, network boundaries, and clearly documenting pending operator responsibilities (DNS records, edge TLS / ACME certificate issuance with origin firewall restriction requirements, and live deployment runs).

### 3. Verification & Test Evidence

- **Staging Deployment Unit Tests (`apps/api/src/config/staging-deployment.spec.ts`)**:
  - 23 automated tests passing (0 failures).
- **Auth Controller Unit & Regression Tests (`apps/api/src/modules/auth/auth.controller.spec.ts`)**:
  - 12 unit tests passing (0 failures).
- **API Test Suite (`pnpm --filter @agency-os/api test`)**:
  - 21 test files passed, 253 tests passed (0 failures).
- **Database Crypto Tests (`pnpm --filter @agency-os/database test src/crypto/encryption.spec.ts`)**:
  - 17 tests passed (0 failures).
- **Docker Ingress Build**:
  - `docker build -f docker/nginx/Dockerfile -t agency-os-ingress:test .` verified successfully with pinned alpine tag.
- **Docker Compose Staging Validation**:
  - Negative test: Fails with expected variable errors when required secrets are omitted.
  - Positive test: Passes syntax and service graph validation when required secrets are supplied.
- **Pre-Merge CI (Commit `160bcd7`)**:
  - `Application Builds`: **SUCCESS** (Green)
  - `Docker Build & Smoke Test`: **SUCCESS** (Green)
  - `API E2E Tests`: **SUCCESS** (Green)
  - `Tests`: **SUCCESS** (Green)
  - `Code Quality (Lint & Typecheck)`: **SUCCESS** (Green)
  - `GitGuardian Security Checks`: **SUCCESS** (Green)
- **Post-Merge CI (Commit `dbc8938` / Run #40908483805)**:
  - All 5 push check runs completed with `success` on `main`: `Application Builds`, `Code Quality (Lint & Typecheck)`, `API E2E Tests`, `Tests`, `Docker Build & Smoke Test`.
- **Review**: Independent Muse review APPROVED on reviewed HEAD `160bcd7`.

### 4. Remaining Follow-Ups

1. **Operator Staging Deployment Actions (External Infrastructure)**:
   - Configure DNS A/CNAME record pointing to staging host.
   - Terminate TLS via Cloudflare/ALB (Edge TLS with `TRUST_PROXY=1` and origin firewall restricting ingress port 80/8080 to edge proxy CIDRs) or configure on-host Let's Encrypt / Certbot container.
   - Run live deployment on target host using `docker compose -f docker-compose.staging.yml up -d` (L7).
   - Verify live endpoint and infrastructure health on the target VPS.
2. **Phase 6 Secret Management Follow-Up**:
   - External secret vault integration (HashiCorp Vault / AWS Secrets Manager) for production environments.
3. **Phase 7 Next Task**:
   - Proceed to Phase 7.1: Publishing Domain & Provider Capability Design.

## 36. Phase 6.6 — Staging Deployment Safety Corrections (PR #41 & Follow-up)

### 1. Summary & Motivation

- **Status**: **MERGED & VERIFIED IN CI (PR #41)**
- **Pull Request**: [#41](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/41)
- **Branch**: `fix/staging-deployment-safety-corrections`
- **Pre-Merge Base SHA**: [`dca45bbc4709f7c64ed5ef62b41ef3f9c93dc227`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/dca45bbc4709f7c64ed5ef62b41ef3f9c93dc227) (`dca45bb`)
- **Reviewed Head SHA**: [`2869ad4561508fe26324e6e5fee7dfb484d512e0`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/2869ad4561508fe26324e6e5fee7dfb484d512e0) (`2869ad4`)
- **Merge Commit SHA**: [`1086418aa22d59620038c0d8516494611f75810a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/1086418aa22d59620038c0d8516494611f75810a) (`1086418`)
- **Merge Strategy**: Standard GitHub merge commit (2 parents: `dca45bb` and `2869ad4`)
- **Merge Timestamp**: `2026-10-31T09:32:00Z`
- **Pre-Merge CI Checks**: [Commit `2869ad4` Checks](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/41/checks) (All 6 check runs green on reviewed HEAD `2869ad4`: GitGuardian Security Checks, Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test)
- **Post-Merge Push CI Run**: [Run #41189076688](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/41189076688) (All 5 push check runs green on `main` `1086418`: Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test)
- **Reviewer**: Muse (APPROVED on HEAD `2869ad4` with non-blocking finding M2 tracked for documentation follow-up)
- **Documentation Follow-Up**: Dedicated follow-up branch `docs/phase-6-6-readiness-and-status-update` addresses finding M2 in `docs/phase-6-readiness.md` (correcting the database restore command to stream custom-format dump files via stdin) and records verified Phase 6.6 status.
- **Live Deployment Release Gate**: **NO-GO** (Pending operator external infrastructure provisioning: Cloudflare Tunnel, Cloudflare R2 bucket CORS, staging secrets file, and rehearsal of an isolated restore drill).

### 2. Scope & Implementation Details

1. **Object Storage Public Endpoint Hardening (`apps/api/src/config/storage-endpoint.ts`, `main.ts`, `media.module.ts`, `docker-compose.staging.yml`)**:
   - Created `parseStoragePublicEndpoint` and `validateStoragePublicEndpoint` enforcing fail-fast startup validation in production (`NODE_ENV=production`).
   - Strictly rejects the internal Docker hostname `minio` in production, requiring an explicit browser-reachable public endpoint (e.g. Cloudflare R2 or AWS S3).
   - Enforces HTTPS for production endpoints; permits HTTP exclusively for local loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) for isolated Compose smoke testing.
   - Strips trailing slashes and rejects embedded credentials, query parameters, and hash fragments.
   - In `docker-compose.staging.yml`, replaced unsafe default fallback `:-http://minio:9000` with required variable interpolation `${OBJECT_STORAGE_PUBLIC_ENDPOINT:?...}` for both `api` and `worker` services.
   - Added 12 unit tests in `apps/api/src/config/storage-endpoint.spec.ts` (100% pass).
2. **Ingress Loopback Binding for Cloudflare Tunnel Origin Isolation (`docker-compose.staging.yml`)**:
   - Mapped ingress port to `"${STAGING_BIND_IP:-127.0.0.1}:${STAGING_PORT:-80}:8080"`.
   - Binds NGINX strictly to host loopback (`127.0.0.1`) by default, guaranteeing that ZERO inbound ports are published on `0.0.0.0` or `:::` when using Cloudflare Tunnel (`cloudflared`) on the host.
   - Updated `staging-deployment.spec.ts` to assert default loopback binding.
3. **Proxy Trust Configuration & Rate Limiting (`trust-proxy.ts`, `trust-proxy.spec.ts`, `docker-compose.staging.yml`, `.env.example`)**:
   - Set staging Compose default to `TRUST_PROXY: "${TRUST_PROXY:-2}"` for the 2-hop reverse proxy chain: `Client -> Cloudflare Edge -> cloudflared (127.0.0.1) -> NGINX (172.x) -> NestJS API`.
   - Added integration tests in `trust-proxy.spec.ts` verifying:
     - `TRUST_PROXY=2` extracts the true client IP `203.0.113.195` from `[203.0.113.195, 127.0.0.1]`.
     - `TRUST_PROXY=1` would improperly collapse client IP to `127.0.0.1`, defeating per-client rate limiting.
     - Anti-spoofing assertion: prepended spoofed headers (`1.1.1.1`) are ignored, correctly resolving the client IP appended by Cloudflare Edge.
     - Protocol resolution: `X-Forwarded-Proto: https` sets `req.secure = true` and `req.protocol = 'https'`, while `http` sets `req.secure = false`.
   - Documented that non-tunnel direct reverse proxy deployments (e.g. AWS ALB or direct TLS on NGINX) must explicitly configure `TRUST_PROXY=1` via `--env-file /opt/agency-os/.env.staging` and verify their own client IP resolution.
4. **Strengthened CI Port Isolation Assertions (`.github/workflows/ci.yml`)**:
   - Replaced substring regex checks with an assertion verifying non-ingress backing services have no published host port mappings at all (`grep -v 'ingress:' | grep -- '->'`), catching both public and loopback bindings (e.g. `127.0.0.1:5432:5432`).
   - Asserts ingress is not bound to public wildcard interfaces (`0.0.0.0:` or `:::`) and confirms it is bound to loopback (`127.0.0.1:`).
5. **Corrected CI Object Storage Endpoint (`.github/workflows/ci.yml`)**:
   - Corrected `OBJECT_STORAGE_PUBLIC_ENDPOINT` in the staging smoke-test step from `http://localhost:8080` to `http://127.0.0.1:9000`. Note that MinIO is not run during this smoke test; the value is supplied strictly for configuration and startup validation in CI, not as an active or reachable object-storage service.
6. **Worker Storage Provider Verification (`apps/worker/src/publishing/publishing.module.spec.ts`)**:
   - Verified that the background worker communicates with object storage strictly backend-to-backend via `OBJECT_STORAGE_ENDPOINT` (as seen in `MediaRecoveryService`, which calls `headObject`, `copyObject`, and `deleteObject`).
   - Added unit test in `publishing.module.spec.ts` confirming `PublishingModule` initializes `IObjectStorage` safely without requiring browser-reachable `OBJECT_STORAGE_PUBLIC_ENDPOINT`.
7. **Disaster Recovery & Finding M2 Stdin Restore Procedure (`docs/phase-6-readiness.md`)**:
   - Changed backup descriptions from "scheduled" to manual runbook procedures (no scheduler is installed in the repository).
   - Documented backup directory preparation with restrictive permissions: `mkdir -p -m 700 /opt/agency-os/backups`.
   - Fixed Muse finding M2: replaced the broken `/backup/<dump_file>` container-path restore command with stdin streaming via standard input:
     ```bash
     DUMP_FILE="db_YYYYMMDD_HHMMSS.dump"
     cat "/opt/agency-os/backups/${DUMP_FILE}" | \
       docker compose -f docker-compose.staging.yml \
         --env-file /opt/agency-os/.env.staging \
         exec -T postgres \
         pg_restore -U postgres -d agency_os --clean --if-exists
     ```
   - Added warning that database restoration is destructive (`--clean --if-exists`), requiring rehearsals to run against isolated test databases.
   - Updated media volume backup and restore commands to dynamically query the Compose volume name instead of assuming a fixed project prefix.
   - Added an explicitly labelled cron template marked clearly as an uninstalled example template.

### 3. Verification & Test Evidence

- **Storage Endpoint Tests (`apps/api/src/config/storage-endpoint.spec.ts`)**: 12/12 PASS
- **Staging Deployment Tests (`apps/api/src/config/staging-deployment.spec.ts`)**: 24/24 PASS (including containerized `nginx -t`)
- **Trust Proxy Tests (`apps/api/src/config/trust-proxy.spec.ts`)**: 16/16 PASS
- **Worker Publishing Module Tests (`apps/worker/src/publishing/publishing.module.spec.ts`)**: 2/2 PASS
- **Full API Test Suite (`pnpm --filter @agency-os/api test`)**: 22/22 test files, 270/270 PASS
- **Workspace Lint (`pnpm turbo run lint`)**: 9/9 packages PASS (0 errors, 55 pre-existing warnings)
- **Workspace Typecheck (`pnpm turbo run typecheck`)**: 10/10 tasks PASS
- **Workspace Build (`pnpm turbo run build`)**: 7/7 tasks PASS
- **Pre-Merge CI (Commit `2869ad4`)**: All 6 check runs green: GitGuardian, Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test.
- **Post-Merge CI (Commit `1086418` / Run #41189076688)**: All 5 push check runs green on `main`: Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test.

### 4. Remaining Release Gates (External Infrastructure — Live Deployment NO-GO)

Codebase and container configurations are fully hardened and verified in CI. However, live staging deployment is strictly **NO-GO** until the operator completes the following external infrastructure actions:

1. **Cloudflare Tunnel Provisioning**: Install and configure `cloudflared` on the host, routing staging hostname traffic to `http://127.0.0.1:80`.
2. **Cloudflare R2 Bucket & CORS**: Provision bucket and apply the documented CORS policy for browser direct presigned uploads.
3. **Staging Secrets Provisioning**: Populate `/opt/agency-os/.env.staging` with `chmod 600` and ensure all staging Compose invocations pass `--env-file /opt/agency-os/.env.staging`.
4. **Restore Drill Rehearsal**: Execute an end-to-end backup and isolated test restore rehearsal using the documented stdin streaming procedure.

## 37. Phase 6.6 — Staging Operator Runbook (PR #43)

### 1. Summary & Motivation

- **Status**: **MERGED & VERIFIED IN CI (PR #43)**
- **Pull Request**: [#43](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/43)
- **Branch**: `docs/phase-6-6-staging-operator-runbook`
- **Pre-Merge Base SHA**: [`80366a02899061d928bae98744c311b20d59bca3`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/80366a02899061d928bae98744c311b20d59bca3) (`80366a0`)
- **Merged PR Head SHA**: [`70e1b603fc0df9f143bfa9666235ec9652671c62`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/70e1b603fc0df9f143bfa9666235ec9652671c62) (`70e1b60`)
- **Merge Commit SHA**: [`cf393c89eeb5dc48b6c186a6ff77007f77124023`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cf393c89eeb5dc48b6c186a6ff77007f77124023) (`cf393c8`)
- **Merge Strategy**: Standard GitHub merge commit (2 parents: `80366a0` and `70e1b60`)
- **Merge Timestamp**: `2026-10-31T14:55:34Z`
- **Pre-Merge CI Checks**: [Commit `70e1b60` Checks](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/43/checks) (All 6 check runs green on PR HEAD `70e1b60`: GitGuardian Security Checks, Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test)
- **Post-Merge Push CI Run**: [Run #41212384042](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/41212384042) (All 5 push check runs green on `main` `cf393c8`: Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test)
- **Independent Review & Merge Authority**: Muse returned REQUEST_CHANGES on HEAD `6bca11ebbb1394dbd5f4ee5fa4f9be1f7c1c7bbc`. The six findings were subsequently checked against the corrected runbook at HEAD `70e1b603fc0df9f143bfa9666235ec9652671c62`. PR #43 was merged on operator authority; no Muse APPROVE verdict for HEAD `70e1b60` is claimed here.
- **Deliverable**: Added [`docs/phase-6-6-staging-operator-runbook.md`](docs/phase-6-6-staging-operator-runbook.md) (comprehensive 791-line staging deployment operator runbook).
- **Live Deployment Release Gate**: **STRICT NO-GO** (Pending operator external infrastructure provisioning: VPS host setup, Cloudflare Tunnel, Cloudflare R2 bucket CORS and credentials, staging secrets file, and rehearsal of isolated database and media restore drills G18 and G19).

### 2. Scope & Implementation Details

1. **End-to-End Staging Operator Runbook (`docs/phase-6-6-staging-operator-runbook.md`)**:
   - Synthesizes the hardened staging deployment architecture established across PR #39, PR #41, and PR #42 into an actionable, repository-accurate, step-by-step operator runbook.
   - Structured into 12 logical sections: Purpose, Scope, Prerequisites, and Explicit NO-GO Status (§1); Server Preflight & Docker Compose Version Requirements (§2); Secure Staging Environment-File Permissions & Secret Validation (§3); Compose Configuration Validation (§4); Ingress Binding, Docker Port Isolation, and Firewall Checks (§5); Cloudflare Tunnel Setup & HTTPS Verification (§6); R2/S3 Configuration, CORS, Presigned URLs, and Browser Upload Tests (§7); Safe Staging Startup & Health Verification (§8); Database & Media Backup Procedures (§9); Isolated Database & Media Restore Rehearsal (§10); Troubleshooting & Explicit Stop Conditions (§11); and Final GO/NO-GO Checklist & Deployment Evidence Log (§12).
2. **Resolution of Independent Muse Review Findings**:
   - **Finding M1 (Migration Failure Detection, §8.1 & Gate G13)**: Hardened migration container invocation by executing `docker compose up --exit-code-from migration migration`, capturing the command exit code (`$?`), terminating immediately with `exit 1` on non-zero exit, and asserting container exit status via `docker compose ps -a migration --format "{{.ExitCode}}"` checking for exact value `"0"` instead of merely `State=exited`.
   - **Finding L1 (UFW SSH Lockout Prevention, §5.1)**: Implemented dynamic detection of the listening SSH port (`sshd -T` / `ss -tlnp`) prior to enabling UFW, halting if the port is invalid, allowing TCP traffic on the resolved port, and directing operators to verify shell connectivity in a secondary session before terminating their current connection.
   - **Finding L2 (Independent Media Restore Gate G19, §12.1 & §12.2)**: Established dedicated Release Gate **G19** (`Media restore rehearsed into isolated target with representative file retrieval verified`) alongside database restore Gate **G18**, explicitly mandating that both G18 and G19 must pass for a deployment GO decision.
   - **Finding L3 (Authentication Endpoint Throttling Notice, §6.3)**: Documented `RateLimitPolicies.auth` (5 attempts / 15 minutes per IP) from `rate-limit.policies.ts`, advising operators on HTTP 429 semantics and explaining that HTTP 429 confirms client IP and HTTPS header preservation without credential evaluation.
   - **Finding L4 (Docker Hub & Container Registry Egress Prerequisites, §1.3)**: Added explicit host firewall egress rules for container registry domains (`registry-1.docker.io`, `auth.docker.io`, `production.cloudflare.docker.com`) and provided a preflight pull verification command (`docker pull alpine:latest`).
   - **Finding L5 (Idempotent Rehearsal Database Safety, §10.1 & §10.2)**: Enforced strict safety guardrails around rehearsal operations with `REHEARSAL_DB="agency_os_rehearsal_test"` and explicit assertion (`[ "$REHEARSAL_DB" = "agency_os_rehearsal_test" ]`) prior to executing drop statements, with prominent banners forbidding destructive drop commands against the live database (`${POSTGRES_DB:-agency_os}`).

### 3. Verification & Test Evidence

- **Workspace Lint (`pnpm turbo run lint`)**: 9/9 packages PASS (0 errors, 55 pre-existing warnings)
- **Staging Deployment Tests (`pnpm --filter @agency-os/api test src/config/staging-deployment.spec.ts`)**: 24/24 PASS
- **Pre-Merge CI (Commit `70e1b60`)**: All 6 check runs green: GitGuardian, Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test.
- **Post-Merge CI (Commit `cf393c8` / Run #41212384042)**: All 5 push check runs green on `main`: Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test.

### 4. Remaining Release Gates (External Infrastructure — Live Deployment STRICT NO-GO)

Codebase, Compose configurations, and operator documentation are 100% complete and verified in CI. However, live staging deployment remains strictly **NO-GO** until the operator completes all external infrastructure actions:

1. **VPS Host Provisioning & Baseline**: Linux host setup, Docker Engine, Docker Compose v2.24.4+, and dynamic SSH firewall rule verification (§5.1).
2. **Cloudflare Tunnel Provisioning**: Cloudflare Tunnel configured to route traffic to host loopback `http://127.0.0.1:80`.
3. **Cloudflare R2 Bucket & CORS Configuration**: Bucket creation, CORS policy application, and API credential generation for direct browser presigned uploads (§4).
4. **Staging Secrets Provisioning**: Securely populated `/opt/agency-os/.env.staging` with `chmod 600` permissions.
5. **Disaster Recovery Rehearsal G18 (Database)**: End-to-end stdin streaming restore rehearsal executed into isolated rehearsal database `agency_os_rehearsal_test` (§10.1).
6. **Disaster Recovery Rehearsal G19 (Media Storage)**: End-to-end media volume restore rehearsal executed into isolated test target with representative file retrieval verified (§10.2).

## 38. Security Hygiene Preflight Fixes (PR #45)

### 1. Summary & Motivation

- **Status**: **MERGED & VERIFIED IN CI (PR #45)**
- **Pull Request**: [#45](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/45)
- **Branch**: `fix/security-hygiene-preflight`
- **Pre-Merge Base SHA**: [`e05d4a519934365010aa1430ed22465dd4cc86f2`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e05d4a519934365010aa1430ed22465dd4cc86f2) (`e05d4a5`)
- **Merged PR Head SHA**: [`06a549adc9ad75e97eba0328a5a8e771e26be7e4`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/06a549adc9ad75e97eba0328a5a8e771e26be7e4) (`06a549a`)
- **Merge Commit SHA**: [`3c89eeee5d14263f29817130dc0f01c0e46e664b`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/3c89eeee5d14263f29817130dc0f01c0e46e664b) (`3c89eee`)
- **Merge Strategy**: Standard GitHub merge commit (2 parents: `e05d4a5` and `06a549a`)
- **Merge Timestamp**: `2026-11-01T07:34:17Z`
- **Pre-Merge CI Checks**: [Commit `06a549a` Checks](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/45/checks) (All 6 check runs green on PR HEAD `06a549a`: GitGuardian Security Checks, Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test)
- **Post-Merge Push CI Run**: [Run #41285315305](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/41285315305) (All 5 push check runs green on `main` `3c89eee`: Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test)
- **Independent Review & Merge Authority**: Muse independently reviewed the exact PR HEAD `06a549adc9ad75e97eba0328a5a8e771e26be7e4` and returned `APPROVE`. All 6 required CI checks passed on that exact HEAD. PR #45 was merged using a standard merge commit following all pre-merge gate verifications.
- **Deliverables**:
  1. Untracked `packages/database/cookies.txt` from Git index tracking while preserving the file on disk and verifying `.gitignore:18:cookies.txt` continues to ignore it repository-wide.
  2. Removed silent dummy credential fallbacks (`dummy_client_id` / `dummy_client_secret`) in `LinkedInProvider` constructor, enforcing fail-fast validation when `LINKEDIN_CLIENT_ID` or `LINKEDIN_CLIENT_SECRET` is missing or empty.
  3. Added comprehensive unit tests in `packages/providers/linkedin/linkedin.provider.spec.ts` covering missing, whitespace-only, and empty environment variables, as well as successful instantiation with valid credentials.
  4. Updated test fixtures and CI workflows to supply explicit mock LinkedIn credentials in `packages/providers/core/__tests__/provider-registry.test.ts`, `apps/worker/src/publishing/token.service.spec.ts`, and `.github/workflows/ci.yml`.
- **Credential Safety & Repository History Assessment**: Untracking `packages/database/cookies.txt` ensures the file is ignored going forward, though untracking does not erase historical commits from Git history. Independent review of the historical file by Muse established that `packages/database/cookies.txt` was a 131-byte, four-line Netscape cookie template introduced in a single earlier commit and never subsequently modified; all lines were comments with zero cookie entries. Consequently, no credential rotation or Git history rewrite was warranted based on that inspection. If separate evidence of credential exposure emerges elsewhere, it must be assessed and remediated independently.
- **Live Deployment Release Gate**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning and disaster recovery rehearsals).

### 2. Scope & Implementation Details

1. **Stop Tracking `packages/database/cookies.txt`**:
   - Removed `packages/database/cookies.txt` from Git index tracking via `git rm --cached`.
   - Verified that the file remains present on disk and is untracked and ignored by Git per `.gitignore:18:cookies.txt`.
   - Confirmed through independent inspection that the historical file contained only template comment lines with zero cookie entries, establishing that no credentials required rotation and no Git history rewrite was warranted for this file.
2. **Fail-Fast LinkedIn Provider Credentials**:
   - In `packages/providers/linkedin/linkedin.provider.ts`, eliminated silent default fallbacks to `'dummy_client_id'` and `'dummy_client_secret'`.
   - The constructor now validates that `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` are present and non-empty (trimmed), throwing an explicit configuration error if missing, consistent with `packages/providers/youtube/youtube.provider.ts`.
   - Added unit tests in `packages/providers/linkedin/linkedin.provider.spec.ts` to verify both:
     - Instantiation throws when credentials are missing or empty.
     - Instantiation succeeds when valid credentials are provided.
3. **Test Fixtures & CI Environment Updates**:
   - In `packages/providers/core/__tests__/provider-registry.test.ts`, added `beforeEach`/`afterEach` hooks to supply mock `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` for registry resolution tests.
   - In `apps/worker/src/publishing/token.service.spec.ts`, added mock LinkedIn environment variables in `beforeAll`.
   - In `.github/workflows/ci.yml`, exported dummy `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` in `test`, `e2e`, and `docker` smoke test jobs alongside the existing YouTube dummy environment variables.

### 3. Verification & Test Evidence

- **Provider Tests (`pnpm --filter @agency-os/providers test`)**: 15/15 test files, 233/233 PASS (including all 10 tests in `linkedin.provider.spec.ts`)
- **Web App Tests (`pnpm --filter @agency-os/web test`)**: 8/8 test files, 111/111 PASS
- **API Tests (`pnpm --filter @agency-os/api test`)**: 22/22 test files, 270/270 PASS
- **Workspace Lint (`pnpm turbo run lint`)**: 9/9 packages PASS (0 errors, 55 pre-existing warnings)
- **Workspace Typecheck (`pnpm turbo run typecheck`)**: 10/10 tasks PASS
- **Workspace Build (`pnpm turbo run build`)**: 7/7 tasks PASS
- **Pre-Merge CI (Commit `06a549a`)**: All 6 check runs green: GitGuardian Security Checks, Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test.
- **Post-Merge Push CI (Commit `3c89eee` / Run #41285315305)**: All 5 push check runs green on `main`: Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test.

### 4. Remaining Release Gates (External Infrastructure — Live Deployment STRICT NO-GO)

Codebase, Compose configurations, and security hygiene preflight fixes are verified in CI. However, live staging deployment remains strictly **NO-GO** until the operator completes all external infrastructure actions:

1. **VPS Host Provisioning & Baseline**: Linux host setup, Docker Engine, Docker Compose v2.24.4+, and dynamic SSH firewall rule verification (§5.1).
2. **Cloudflare Tunnel Provisioning**: Cloudflare Tunnel configured to route traffic to host loopback `http://127.0.0.1:80`.
3. **Cloudflare R2 Bucket & CORS Configuration**: Bucket creation, CORS policy application, and API credential generation for direct browser presigned uploads (§4).
4. **Staging Secrets Provisioning**: Securely populated `/opt/agency-os/.env.staging` with `chmod 600` permissions.
5. **Disaster Recovery Rehearsal G18 (Database)**: End-to-end stdin streaming restore rehearsal executed into isolated rehearsal database `agency_os_rehearsal_test` (§10.1).
6. **Disaster Recovery Rehearsal G19 (Media Storage)**: End-to-end media volume restore rehearsal executed into isolated test target with representative file retrieval verified (§10.2).

## 39. Phase 7.1, PR 1: User-to-Session Indexing and Revocation (Security Remediation)

### 1. Summary & Motivation

- **Status**: **MERGED & VERIFIED IN CI (PR #47, Commit `efab83e2225b83090a32942dd35f80c6ed2e59de`)**
- **Branch**: `feat/user-session-indexing-revocation` (Merged into `main`)
- **Target Base**: `main` ([`80582dd77d9adfc5d303338b0ddbb353da7879db`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/80582dd77d9adfc5d303338b0ddbb353da7879db))
- **Merge Commit**: [`efab83e2225b83090a32942dd35f80c6ed2e59de`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/efab83e2225b83090a32942dd35f80c6ed2e59de)
- **Independent Security Review**: APPROVE (Verified by Muse on HEAD `8f1c3b4bca5cc7bde2c193b39e24621c8c2f86e7`)
- **Scope Discipline**: Phase 7.1, PR 1 implements only session indexing and revocation semantics in the Redis-backed session manager and auth service. No public registration, organization migrations, member endpoints, billing models, or policy pages are introduced.
- **Live Deployment Release Gate**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning and disaster recovery rehearsals G18/G19).

### 2. Scope & Implementation Details (Findings F1–F7 Remediated)

1. **Atomic Session Lifecycle via Redis Lua Scripts (F1, F2, F3, F4, F6, F7)**:
   - Replaced all non-atomic Redis pipelines with dedicated Redis Lua scripts executed via `redis.eval()`, establishing true server-side atomicity and linearizability.
   - **`createSession(userId)` (F2, F7)**: Uses `CREATE_SESSION_SCRIPT` to atomically execute `SET session:${sessionId}`, `SADD user_sessions:${userId} ${sessionId}`, and refresh the index TTL. Eliminates the race window where revoke-all could run between creation and indexing by guaranteeing command atomicity against concurrent client interleaving (while noting that Redis Lua scripts execute atomically against concurrent commands but do not roll back preceding commands on mid-script runtime error).
   - **`validateSession(sessionId)` (F1, F3)**: Uses `VALIDATE_SESSION_SCRIPT` to atomically check key existence, decode session data with `cjson`, update `expiresAt`, refresh `session:${sessionId}` TTL, and refresh `user_sessions:${userId}` TTL. If the session was deleted or revoked, the script returns `nil` and performs zero writes, guaranteeing that concurrent validation can **never resurrect a destroyed or revoked session**.
   - **`destroySession(sessionId)` (F3)**: Uses `DESTROY_SESSION_SCRIPT` to atomically decode the session, remove the session ID from `user_sessions:${userId}`, and delete `session:${sessionId}` in a single execution step.
   - **`destroyAllUserSessions(userId)`**: Uses `DESTROY_ALL_USER_SESSIONS_SCRIPT` to atomically read all session IDs from `user_sessions:${userId}`, delete each `session:${sid}` key, and delete the user index set.
   - **`getUserSessionIds(userId, cleanStale = true)` (F6)**: Uses `GET_AND_CLEAN_SESSIONS_SCRIPT` to atomically inspect `EXISTS` on each session key and remove only truly expired keys via `SREM`. Concurrently created sessions are never falsely unindexed.
2. **Redis Topology & Cluster Compatibility**:
   - The verified runtime infrastructure for Agency OS is **standalone Redis 7** (`redis:7-alpine`).
   - The Lua scripts provide strict atomicity on standalone Redis and Sentinel-managed Redis.
   - For multi-shard Redis Cluster deployments, cross-key scripts would require keys to share a hash slot or session operations to be routed to a dedicated session instance. This topology requirement is explicitly documented in code and architecture specs.
3. **Application-Level In-Flight Authentication Race Boundary**:
   - The atomic Lua scripts guarantee session storage atomicity.
   - They do not eliminate the separate application-level race where an in-flight login validates credentials immediately before a password change on another device. Mitigating that separate lifecycle race requires a database-level `tokenVersion` or `securityEpoch` on the `User` model, planned for subsequent Phase 7 auth tasks.
4. **AuthService Integration**:
   - In `apps/api/src/modules/auth/auth.service.ts`, added `revokeAllUserSessions(userId)` delegating to `sessionManager.destroyAllUserSessions(userId)`.
   - No unauthenticated or unauthorized public endpoints were created.
5. **Real-Redis Integration Testing (F5)**:
   - Created `packages/session/src/SessionManager.redis.integration.spec.ts` running against a live Redis 7 instance (`localhost:6379`).
   - Replaced ambiguous test assertions with deterministic linearization checks verifying that pre-revocation sessions are 100% destroyed while post-revocation sessions are valid and indexed.

### 3. Verification & Test Evidence

- **Real Redis Integration Tests (`pnpm --filter @agency-os/session test -- src/SessionManager.redis.integration.spec.ts`)**: 6/6 PASS on live Redis 7:
  1. Real Lua script compilation and execution for all 5 scripts.
  2. Concurrent validation vs revoke-all: validation cannot resurrect revoked sessions.
  3. Concurrent destroy vs validation: destroyed sessions cannot be recreated.
  4. Concurrent create vs revoke-all: pre-revocation sessions are guaranteed destroyed.
  5. Concurrent stale index cleanup vs create: valid sessions are never unindexed.
  6. Real-Redis user isolation and single-session logout.
- **Session Manager Unit Tests (`pnpm --filter @agency-os/session test -- src/SessionManager.spec.ts`)**: 10/10 PASS covering all 9 lifecycle scenarios plus the F1 resurrection invariant.
- **Combined Session Suite**: 2/2 test files, 16/16 tests PASS.
- **Auth Service Tests (`pnpm --filter @agency-os/api test -- src/modules/auth/`)**: 2/2 test files, 20/20 PASS.
- **Web App Tests (`pnpm --filter @agency-os/web test`)**: 8/8 test files, 111/111 PASS.
- **Workspace Lint (`pnpm turbo run lint`)**: 9/9 packages PASS (0 errors, 55 pre-existing warnings).
- **Workspace Typecheck (`pnpm turbo run typecheck`)**: 10/10 tasks PASS.
- **Workspace Build (`pnpm turbo run build`)**: 7/7 tasks PASS.

## 40. Phase 7.1, PR 2: Session Hardening & Password-Change Revocation (PR #48)

### 1. Summary & Motivation

- **Status**: **MERGED & VERIFIED IN CI (PR #48, Commit `4544036f39a81c0ed5f9331473505489e03b68de`)**
- **Pull Request**: [#48](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/48)
- **Branch**: `feat/session-hardening-password-change-revocation` (Merged into `main`)
- **Pre-Merge Base SHA**: [`efab83e2225b83090a32942dd35f80c6ed2e59de`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/efab83e2225b83090a32942dd35f80c6ed2e59de) (`efab83e`)
- **Merged PR Head SHA**: [`da2e8e6280090a29c0e880f648fb6290e19a9321`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/da2e8e6280090a29c0e880f648fb6290e19a9321) (`da2e8e6`)
- **Merge Commit SHA**: [`4544036f39a81c0ed5f9331473505489e03b68de`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/4544036f39a81c0ed5f9331473505489e03b68de) (`4544036`)
- **Merge Strategy**: Standard GitHub merge commit (2 parents: `efab83e` and `da2e8e6`)
- **Merge Timestamp**: `2026-11-02T15:35:28Z`
- **Pre-Merge CI Checks**: [Commit `da2e8e6` Checks](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/48/checks) (All 6 check runs green on PR HEAD `da2e8e6`: GitGuardian Security Checks, Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test)
- **Post-Merge Push CI Run**: [Run #41473085762](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/41473085762) (All 5 push check runs green on `main` `4544036`: Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test)
- **Independent Security Review**: Muse independently reviewed the exact PR HEAD `da2e8e6280090a29c0e880f648fb6290e19a9321` and returned `APPROVE`. All 6 required CI checks passed on that exact HEAD. PR #48 was merged using a standard merge commit following all pre-merge gate verifications.
- **Scope Discipline**: Hardens session index self-healing and corrupt payload failure modes in `SessionManager`, introduces atomic single-session preservation during revocation (`destroyOtherUserSessions`), adds authenticated password changes with mandatory revocation of all other active sessions, and mitigates in-flight authentication race conditions without requiring schema migrations in this PR (deferring `securityEpoch` / `emailVerified` to PR 2A).
- **Live Deployment Release Gate**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning and disaster recovery rehearsals G18/G19).

### 2. Scope & Technical Architecture

1. **Session Index Self-Healing & Fail-Closed Lua Hardening (`packages/session/src/SessionManager.ts`)**:
   - **Self-Healing Index Set**: In `VALIDATE_SESSION_SCRIPT`, added `redis.call('SADD', userSessionsKey, sessionId)`. If a user's index set (`user_sessions:${userId}`) was evicted under Redis memory pressure or became desynchronized while a valid session key persisted, validating the session automatically restores the session ID into the user's index set and refreshes the set's TTL.
   - **Protected JSON Decoding**: Hardened both `VALIDATE_SESSION_SCRIPT` and `DESTROY_SESSION_SCRIPT` using Lua `pcall(cjson.decode, rawData)`. If corrupted or malformed JSON data is present in a session key, the script returns `nil` instead of raising an unhandled Lua execution exception, enforcing a secure fail-closed security posture.
   - **Atomic Selective Revocation (`destroyOtherUserSessions`)**: Added `DESTROY_OTHER_USER_SESSIONS_SCRIPT` that iterates over `user_sessions:${userId}`, skips `keepSessionId`, deletes all other `session:${sid}` keys, and removes them from the set in a single linearizable Redis transaction.

2. **Database Repositories (`packages/database`)**:
   - **`UserRepository.updatePassword(id, hashedPassword)`**: Securely updates the user password in PostgreSQL using Prisma Client.
   - **`AuditLogRepository`**: Added `AUTH_PASSWORD_CHANGED` and `AUTH_PASSWORD_CHANGE_FAILED` to the `AuditAction` enum for security observability.

3. **In-Flight Authentication Race Mitigation (`apps/api/src/modules/auth/auth.service.ts`)**:
   - **Architectural Rationale for Migration Deferral**: Introducing database migrations (`securityEpoch`, `emailVerified`) in this intermediate PR was evaluated and deferred to PR 2A (Public Self-Registration & Onboarding) to avoid disjoint schema iterations before self-registration models are finalized.
   - **Post-Verification Double-Check Invariant**: In `AuthService.login()`, credentials are confirmed with argon2 and a session is provisioned in Redis. Immediately following session creation, `AuthService` executes a fresh read of `user.hashedPassword` from the database. If `freshUser.hashedPassword !== user.hashedPassword`, an in-flight password change occurred concurrently on another device; the newly created session is immediately destroyed via `sessionManager.destroySession(sessionId)` and `InvalidCredentialsException('INVALID_PASSWORD', user.id)` is thrown.
   - **Password Change Invariant**: In `AuthService.changePassword()`, current password verification is strictly enforced with argon2, identical new passwords are rejected (`400 Bad Request`), and the new password is hashed before updating PostgreSQL. Crucially, the database password update executes **prior** to invoking `sessionManager.destroyOtherUserSessions(userId, currentSessionId)`.

4. **API Controller & Rate Limiting (`apps/api/src/modules/auth/auth.controller.ts`)**:
   - **`POST /api/v1/auth/change-password`**: Protected by `@UseGuards(AuthGuard)` and throttled under `RateLimitPolicies.auth` (global Redis throttler). Requires authenticated session and valid `x-csrf-token` header.
   - **Audit Trail & Secret Hygiene**: Best-effort audit logging records success (`AUTH_PASSWORD_CHANGED`) and failure (`AUTH_PASSWORD_CHANGE_FAILED`) with request ID. Plain-text passwords and cryptographic hashes are never logged, emitted in error messages, or returned in HTTP response payloads.

### 3. Verification & Test Evidence

- **Session Manager Unit Tests (`pnpm --filter @agency-os/session test -- src/SessionManager.spec.ts`)**: 14/14 PASS (+4 new tests covering self-healing index set restoration, corrupt JSON fail-closed decoding, `destroyOtherUserSessions` single-session preservation, and script error propagation).
- **Live Redis 7 Integration Tests (`pnpm --filter @agency-os/session test -- src/SessionManager.redis.integration.spec.ts`)**: 10/10 PASS on standalone Redis 7:
  1. Real Lua script compilation and execution for all scripts.
  2. Concurrent validation vs revoke-all resurrection prevention.
  3. Concurrent destroy vs validation invariant.
  4. Concurrent create vs revoke-all linearization.
  5. Concurrent stale index cleanup vs create safety.
  6. Multi-user isolation during revocation.
  7. Live Redis self-healing index set restoration on validation.
  8. Live Redis corrupt JSON fail-closed evaluation.
  9. Live Redis selective revocation preserving current session.
  10. Live Redis concurrent validation vs selective revocation.
- **API Auth Unit Tests (`pnpm --filter @agency-os/api test -- src/modules/auth/`)**: 30/30 PASS across 2 test files:
  - `auth.service.spec.ts`: 15/15 PASS (including password change verification, current password mismatch rejection, identical password rejection, Argon2 hashing, atomic other-session destruction, and in-flight login race detection).
  - `auth.controller.spec.ts`: 15/15 PASS (including authenticated endpoint routing, rate limit decorators, CSRF guard enforcement, audit logging, and zero credential leakage).
- **All API Unit Tests (`pnpm --filter @agency-os/api test`)**: 22/22 test files, 282/282 PASS.
- **Monorepo Lint (`pnpm turbo run lint`)**: 9/9 packages PASS (0 errors, 59 pre-existing warnings).
- **Monorepo Typecheck (`pnpm turbo run typecheck`)**: 10/10 tasks PASS.
- **Monorepo Build (`pnpm turbo run build`)**: 7/7 tasks PASS.
- **Pre-Merge GitHub Actions CI (Commit `da2e8e6`)**: All 6 check runs PASSED (success):
  1. `GitGuardian Security Checks`: completed (success)
  2. `API E2E Tests`: completed (success)
  3. `Application Builds`: completed (success)
  4. `Tests`: completed (success)
  5. `Code Quality (Lint & Typecheck)`: completed (success)
  6. `Docker Build & Smoke Test`: completed (success)
- **Post-Merge GitHub Actions CI (Commit `4544036`, Run #41473085762)**: All 5 push check runs PASSED (success):
  1. `Application Builds`: completed (success)
  2. `Code Quality (Lint & Typecheck)`: completed (success)
  3. `Tests`: completed (success)
  4. `API E2E Tests`: completed (success)
  5. `Docker Build & Smoke Test`: completed (success)

### 4. Remaining Follow-Ups & Muse Review Findings (M1)

1. **Muse M1 Observation — Redis Revocation Partial Failure Defense-in-Depth**:
   - In `AuthService.changePassword()`, `UserRepository.updatePassword()` updates PostgreSQL first, and `sessionManager.destroyOtherUserSessions()` updates Redis second.
   - If Redis becomes unavailable or encounters a network partition immediately after the database commit, the new password is set in the database, but other sessions in Redis survive until their 24h TTL expires.
   - **Resolution Plan**: Prioritized as follow-up task in Phase 7.1 PR 2A (Public Self-Registration & Onboarding): Introduce a `securityEpoch` / `tokenVersion` column on the `User` model and validate it against the session payload during `validateSession()` or JWT/session verification. This ensures that even in the event of a partial Redis outage, stale sessions are immediately rejected upon their next database-backed validation check.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning and disaster recovery rehearsals G18/G19).


## 41. Phase 7.1, PR 2A: Public Signup, Workspace Provisioning & Security Epoch (PR #49) — MERGED

### 1. Summary & Motivation
- **Merge Status & Identity**: Successfully merged into `main` on 2026-11-04T19:10:04Z.
  - **Merge Commit SHA**: `325012d7c94702bac2656ebe1a89e74102910460`
  - **Approved Implementation HEAD**: `9abe7a60ae03c6f756ae3edfec632c206f28881f`
  - **Independent Review**: Approved by Muse review following resolution of B1 (GitGuardian incident #39580066 marked as a test credential in the GitGuardian dashboard, clearing the required check after test fixtures were updated at HEAD) and B2 (email verification dead end deferred to follow-up milestone PR #51 via Option A; E2E cross-tenant test UUID fixture corrected).
  - **CI Quality Gates**: 6/6 checks passed on approved HEAD and 5/5 checks passed on merge commit.
  - **Next Milestone**: PR #51 merged (Email Verification Lifecycle, Verification Endpoints & 403 Enforcement Restoration); next milestone TBD.
- **Public Self-Registration**: Exposes an unauthenticated, rate-limited public signup endpoint (`POST /api/v1/auth/signup`) allowing new users to onboard without prior administrative provisioning.
- **Atomic Multi-Tenant Provisioning**: On signup, atomically provisions `User`, personal `Organization`, default `Workspace`, and `WorkspaceMember` with `OWNER` role inside a single PostgreSQL transaction (`$transaction`). Prevents orphaned or partially provisioned tenant states.
- **Security Epoch Invariant (Muse M1 Resolution)**: Implements database-backed `securityEpoch` on `User` and in the Redis session payload. Solves the distributed revocation race condition identified in PR #48 review: `AuthGuard` verifies exact equality (`session.securityEpoch === user.securityEpoch`), failing closed on any mismatch, staleness, or tampering with zero extra database queries.
- **Email Verification Primitives & Deferral of Enforcement (Option A — Muse B2 Resolution)**: Establishes `emailVerified` (Boolean, default `false`), `emailVerifiedAt` (DateTime?), and `EmailVerificationToken` table with SHA-256 token hashing and atomic conditional consumption primitives. Following Muse review finding B2, 403 enforcement gating on unverified accounts has been deferred to PR #51 to prevent creating an inescapable dead end for self-registered users. Newly registered users are created with `emailVerified: false`, but are permitted to access their provisioned workspace and connect OAuth accounts while the full email delivery and verification endpoints are finalized in PR #51.
- **Anti-Enumeration Parity**: Regardless of whether an email is novel or pre-existing, `POST /api/v1/auth/signup` returns HTTP 201 with identical response body (`{"message": "Registration request received."}`), emits zero session cookies, and executes dummy Argon2id password hashing on duplicate emails to eliminate response-timing side channels.

### 2. Scope & Technical Architecture

1. **Database Layer (`packages/database`)**:
   - **Schema & Migration (`schema.prisma`, migration `20261102000000_add_user_verification_and_security_epoch`)**:
     - Added `emailVerified` (`Boolean`, default `false`), `emailVerifiedAt` (`DateTime?`), and `securityEpoch` (`Int`, default `1`) to `User`.
     - Created `EmailVerificationToken` table: `id` (UUID), `userId` (relation with `onDelete: Cascade`), `tokenHash` (VarChar 64, unique SHA-256), `expiresAt` (DateTime), `consumedAt` (DateTime?), `createdAt`.
     - Safe backfill included in migration: existing users set to `emailVerified = true` and `securityEpoch = 1`.
   - **User Repository (`UserRepository.ts`)**:
     - `createWithTenantTransaction()`: Executes within a single Prisma transaction. Generates UUIDv7 for all entities, normalizes email, hashes password with Argon2id, creates User (`emailVerified: false`, `securityEpoch: 1`), Organization, Workspace, and WorkspaceMember (`role: OWNER`). Enforces strict server-side control over all identifiers and roles.
     - `updatePasswordAndIncrementEpoch()`: Atomically updates `hashedPassword` and increments `securityEpoch: { increment: 1 }` returning the updated user.
     - `incrementSecurityEpoch()`: Atomically increments `securityEpoch` for total session invalidation events.
   - **Email Verification Token Repository (`EmailVerificationTokenRepository.ts`)**:
     - `createToken()`: Generates and stores 64-char SHA-256 hash of a 32-byte cryptographically secure random token with 24h expiration.
     - `findByTokenHash()`: Queries token by unique hash.
     - `consumeToken()`: Performs atomic conditional update (`WHERE id = ... AND consumedAt IS NULL AND expiresAt > NOW()`) and sets user `emailVerified: true` and `emailVerifiedAt: NOW()`.
   - **Audit Logging (`AuditLogRepository.ts`)**: Added `AUTH_SIGNUP_SUCCEEDED` and `AUTH_SIGNUP_DUPLICATE_EMAIL`.

2. **Session Layer (`packages/session`)**:
   - **Session Payload (`SessionData`)**: Added optional `securityEpoch?: number`.
   - **Session Creation**: `createSession(userId, securityEpoch?)` records `securityEpoch` into the session JSON payload and user index.
   - **Selective Revocation with Atomic Epoch Update**: Updated Redis Lua script `DESTROY_OTHER_USER_SESSIONS_SCRIPT` and method `destroyOtherUserSessions(userId, keepSessionId, newSecurityEpoch?)`. Atomically removes all other user sessions from Redis while updating the retained current session's `securityEpoch` to `newSecurityEpoch`.

3. **API & Security Layer (`apps/api`)**:
   - **Signup DTO (`signup.dto.ts`)**: Validates `email` (normalized, lowercase), `password` (min 8, max 128 chars), and optional sanitized strings for `organizationName` and `workspaceName`.
   - **Signup Endpoint & Rate Limiting (`auth.controller.ts`)**: Exposes `POST /api/v1/auth/signup` throttled under `RateLimitPolicies.auth` (5 requests per 15 minutes per IP; 1,000 in test environments). Emits zero cookies, prevents auto-login, and returns `201 Created` with a generic message.
   - **Signup Service Flow (`auth.service.ts`)**: Checks email existence. If duplicate, executes dummy Argon2id verification for timing parity, writes `AUTH_SIGNUP_DUPLICATE_EMAIL` audit log, and returns success without error. If new, invokes `userRepository.createWithTenantTransaction()` and writes `AUTH_SIGNUP_SUCCEEDED` audit log. Per approved Option A architecture, live email provider delivery, initial verification token generation during signup, public verification endpoints (`POST /verify-email`), and resend endpoints are strictly deferred to PR #51.
   - **Login & Password-Change Epoch Synchronization (`auth.service.ts`)**:
     - `login()` stores authoritative `user.securityEpoch` into Redis session and performs post-session double-check of both `hashedPassword` and `securityEpoch`.
     - `changePassword()` calls `userRepository.updatePasswordAndIncrementEpoch()`, then synchronizes Redis via `sessionManager.destroyOtherUserSessions(userId, currentSessionId, newEpoch)`.
     - `revokeAllUserSessions()` increments database epoch first, then purges all user sessions in Redis.
   - **Security Epoch Validation (`AuthGuard.ts`)**:
     - Enforces exact equality: `session.securityEpoch === user.securityEpoch`.
     - Rejects stale sessions (`session.securityEpoch < user.securityEpoch`), anomalous/tampered sessions (`session.securityEpoch > user.securityEpoch`), and malformed/non-integer values.
     - Permits missing legacy session epoch if and only if authoritative DB epoch is exactly `1`.
     - On mismatch, fails closed, immediately destroys stale session in Redis, and throws `UnauthorizedException`. Reuses already loaded user entity (zero additional DB queries).
   - **Interim Access Permissions & Deferral of Enforcement (Option A — Muse B2 Resolution)**:
     - `WorkspaceGuard.ts`: Email verification gating (`if (!user.emailVerified)`) is deferred to PR #51. Newly registered unverified users (`emailVerified: false`) are permitted to access their provisioned workspaces during this interim phase. Tenant isolation and workspace membership checks (`findByWorkspaceAndUserId`) remain 100% active and enforced with `403 Forbidden ('User is not a member of this workspace')`.
     - `OAuthController.ts`: Email verification gating is deferred to PR #51; authenticated users can complete OAuth account linking callbacks without 403 blocks.
     - **Security Posture in the Interim**: Authentication (`AuthGuard`), CSRF protection, tenant isolation (workspace membership), RBAC, password complexity, session management, and `securityEpoch` verification remain strictly active and enforced.
     - **Follow-up Scope (PR #51)**: Production email delivery worker integration, verification token issuance during signup, public consumption endpoint (`POST /api/v1/auth/verify-email`), resend endpoint (`POST /api/v1/auth/resend-verification`), and re-enabling 403 email verification gating.
   - **Email Delivery Safety (`email-delivery.service.ts`)**:
     - `MockEmailDeliveryService`: Verifies provider contracts; strictly throws an error if initialized in production (`NODE_ENV === 'production'`).
     - Live email provider and worker deferred to PR #51 per approved Option A architecture.

### 3. Verification & Test Evidence

- **Monorepo Lint (`pnpm turbo run lint`)**: 9/9 packages PASS (0 errors, 59 pre-existing warnings).
- **Monorepo Typecheck (`pnpm turbo run typecheck`)**: 10/10 tasks PASS.
- **Monorepo Build (`pnpm turbo run build`)**: 7/7 tasks PASS.
- **Session Layer Unit & Live Integration Tests**:
  - `SessionManager.spec.ts`: 16/16 PASS (+2 tests covering `securityEpoch` storage, retrieval, and Lua script atomic update).
  - `SessionManager.redis.integration.spec.ts`: 10/10 PASS on live Redis 7.
- **Database Layer Tests (`packages/database`)**:
  - 12/12 test files, 100/100 PASS.
  - `UserRepository.spec.ts`: 5/5 PASS (atomic multi-tenant transaction, role/epoch server defaults, password & epoch increment).
  - `EmailVerificationTokenRepository.spec.ts`: 6/6 PASS (token hash creation, retrieval, conditional atomic consumption, expiry rejection).
- **API Unit Tests (`apps/api`)**:
  - 25/25 test files, 304/304 PASS.
  - `auth.guard.spec.ts`: 11/11 PASS (exact epoch equality, rejection of lower epoch, rejection of higher epoch, malformed epoch rejection, legacy epoch 1 acceptance, Redis session purge on mismatch).
  - `workspace.guard.spec.ts`: 5/5 PASS (unverified user access permitted under Option A, tenant isolation and non-member 403 rejection verified).
  - `email-delivery.service.spec.ts`: 3/3 PASS (mock delivery logging, production environment fail-closed exception).
  - `auth.service.spec.ts`: 14/14 PASS (public signup flow, anti-enumeration timing mitigation, login epoch persistence, password change epoch increment).
  - `auth.controller.spec.ts`: 18/18 PASS (signup routing, 201 response, zero cookie issuance, rate limiting decorators).
  - `oauth.controller.spec.ts`: 15/15 PASS (unverified user OAuth link callback permitted under Option A).
- **API E2E Tests (`apps/api`)**:
  - 5/5 test files, 88/88 PASS against live PostgreSQL 16, Redis 7, and MinIO:
    1. `auth.e2e-spec.ts`: 19/19 PASS (public signup 201, zero session cookies, anti-enumeration duplicate email parity, invalid email/password rejection, security epoch session invalidation).
    2. `publishing.e2e-spec.ts`: 51/51 PASS.
    3. `accounts.e2e-spec.ts`: 6/6 PASS.
    4. `analytics.e2e-spec.ts`: 6/6 PASS.
    5. `media.storage.e2e-spec.ts`: 6/6 PASS.

### 4. Remaining Scope & Follow-Ups (PR #51 — Merged)

1. **PR #51 Scope (Deferred Email Delivery Lifecycle — Merged in PR #51)**:
   - Integrate production email delivery provider (Resend / AWS SES / SMTP) with DKIM/SPF and webhook delivery tracking.
   - Background worker queue for asynchronous email dispatch.
   - Public endpoint `POST /api/v1/auth/verify-email` with raw token verification and rate limiting.
   - Public endpoint `POST /api/v1/auth/resend-verification` with rate limiting and anti-enumeration.
   - HTML/text email templates for signup verification.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending human code review, external infrastructure provisioning, and disaster recovery rehearsals G18/G19).


## 42. Phase 7.1, PR 2B: Email Verification Lifecycle, Verification Endpoints & 403 Enforcement Restoration (PR #51) — MERGED

### 1. Summary & Motivation
- **Merge Status & Identity**: Successfully merged into `main` on 2026-11-05T10:25:36Z.
  - **Merge Commit SHA**: `0cfeb86087081fb64c7ffe4597a9094516650340`
  - **Approved Implementation HEAD**: `edbd12fa0c40b39be15f5c0cbbcbd8ec3cbef6ff`
  - **Independent Review**: Approved by Muse review (no blocking findings; non-blocking M1 noted: production without RESEND_API_KEY originally fell back to Noop while 403 gates were active, risking new signup lockout — resolved in PR #55 via fail-fast startup validator `validateEmailDeliveryConfig()`, so production refuses to boot without the key).
  - **CI Quality Gates**: 6/6 checks passed on approved HEAD.
  - **Next Milestone**: PR #52 — Phase 7.1: Social Account Disconnect Flow.
- **Complete Verification Lifecycle**: Implements full email verification token issuance, delivery, public consumption, and anti-enumeration resend capabilities, closing the architectural deferral from PR #49 (Option A / Muse finding B2).
- **Coupled Gates & Flow Invariant**: Re-enables 403 enforcement gating on unverified accounts simultaneously with the production verification and resend endpoints, preventing any unverified lockout or dead-end state.
- **Single-Transaction Signup Token Issuance**: When a new user registers via `POST /api/v1/auth/signup`, an initial 32-byte cryptographically secure random verification token (24-hour expiry, stored exclusively as a SHA-256 hash) is provisioned atomically inside `UserRepository.createWithTenantTransaction` alongside the `User`, `Organization`, `Workspace`, and `WorkspaceMember` records. The signup response strictly maintains generic HTTP 201 anti-enumeration parity.
- **Public Verification Endpoint (`POST /api/v1/auth/verify-email`)**: Atomically consumes single-use tokens via `EmailVerificationTokenRepository.consumeToken` using conditional CAS (`WHERE consumedAt IS NULL AND expiresAt > NOW()`), transitions user to `emailVerified: true`, sets `emailVerifiedAt: NOW()`, and logs `AUTH_EMAIL_VERIFIED`. Rejects expired, consumed, or malformed tokens with a generic HTTP 400 without disclosing account existence or token state. Throttled under `RateLimitPolicies.auth`.
- **Public Resend Endpoint (`POST /api/v1/auth/resend-verification`)**: Exposes an unauthenticated, rate-limited endpoint with strict anti-enumeration timing and response parity. Generates identical generic responses regardless of whether the account exists, is already verified, or is unverified. For unverified accounts, invalidates prior active tokens via `invalidateActiveUserTokens` (newest-token-wins semantics) and dispatches a fresh verification token.
- **Restored 403 Enforcement Gates**:
  - `WorkspaceGuard`: Blocks unverified users from workspace routes with HTTP 403 Forbidden (`Email verification required to access workspaces`).
  - `OAuthController`: Blocks unverified users from completing OAuth account linking callbacks with HTTP 403 Forbidden (`Email verification required to access workspaces`).
- **Production Email Delivery Abstraction**:
  - `ResendEmailDeliveryService`: Integrates the live Resend REST API via native `fetch` with Bearer auth, fully env-keyed (`RESEND_API_KEY`, `EMAIL_FROM`, `FRONTEND_URL`) with zero secrets in code.
  - `MockEmailDeliveryService`: Preserved for local/test environments; strictly throws a runtime error if initialized in production (`NODE_ENV === 'production'`).
  - `NoopEmailDeliveryService`: Preserved as the safe no-op fallback in production environments when no provider API key is configured.
  - Factory provider in `AuthModule` dynamically selects `ResendEmailDeliveryService` in production when configured, `NoopEmailDeliveryService` as fallback, and `MockEmailDeliveryService` in non-production.
- **Audit Logging & Credential Safety**: Added `AUTH_EMAIL_VERIFIED`, `AUTH_EMAIL_VERIFICATION_FAILED`, and `AUTH_EMAIL_VERIFICATION_RESENT` to `AuditAction`. Raw tokens appear strictly in dispatched email messages and are strictly redacted from logs, server responses, and audit records.

### 2. Technical Architecture & Modifications

1. **Database Layer (`packages/database`)**:
   - **Audit Actions (`AuditLogRepository.ts`)**: Added `AUTH_EMAIL_VERIFIED`, `AUTH_EMAIL_VERIFICATION_FAILED`, `AUTH_EMAIL_VERIFICATION_RESENT`.
   - **Token Invalidation (`EmailVerificationTokenRepository.ts`)**: Implemented `invalidateActiveUserTokens(userId: string, tx?: Prisma.TransactionClient)` to retire prior unconsumed tokens upon resend.
   - **Atomic Signup Provisioning (`UserRepository.ts`)**: Extended `CreateUserWithTenantInput` with optional `verificationToken?: { tokenHash: string; expiresAt: Date }`. The verification token row is created inside the tenant transaction.

2. **API & Security Layer (`apps/api`)**:
   - **DTOs (`verify-email.dto.ts`, `resend-verification.dto.ts`)**: Validated via `class-validator` (`IsNotEmpty`, `IsString`, `MinLength(32)`, `MaxLength(128)` for tokens; `IsEmail` for resend).
   - **Email Delivery Service (`email-delivery.service.ts`)**: Implemented `ResendEmailDeliveryService` with HTML/text templates, error handling, token redaction in logs, and `AuthModule` factory injection.
   - **Service Layer (`auth.service.ts`)**:
     - `signup()`: Dispatches verification email resiliently; logs `AUTH_SIGNUP_SUCCEEDED` with actor/target IDs.
     - `verifyEmail()`: Validates input format, atomically consumes token via repository, logs audit action, and returns success message.
     - `resendVerification()`: Validates email, executes dummy Argon2 work on missing user, no-ops for already-verified users, retires prior tokens, creates new token, and dispatches email.
   - **Controller Layer (`auth.controller.ts`)**:
     - `POST /api/v1/auth/verify-email`: Throttled under `RateLimitPolicies.auth`, enforces HTTPS in production, returns HTTP 200.
     - `POST /api/v1/auth/resend-verification`: Throttled under `RateLimitPolicies.auth`, enforces HTTPS in production, returns HTTP 200.
   - **403 Gates (`workspace.guard.ts`, `oauth.controller.ts`)**:
     - Re-enabled `if (!user.emailVerified) throw new ForbiddenException('Email verification required to access workspaces')`.

### 3. Verification & Test Evidence

- **Monorepo Lint (`pnpm turbo run lint`)**: 9/9 packages PASS (0 errors, 66 pre-existing warnings).
- **Monorepo Typecheck (`pnpm turbo run typecheck`)**: 10/10 tasks PASS.
- **Monorepo Build (`pnpm turbo run build`)**: 7/7 tasks PASS.
- **Database Unit Tests (`packages/database`)**:
  - `EmailVerificationTokenRepository.spec.ts`: 7/7 PASS (token creation, lookup, atomic CAS consumption, expiration check, active token invalidation).
  - `UserRepository.spec.ts`: 6/6 PASS (tenant transaction with and without atomic verification token provisioning).
- **API Unit Tests (`apps/api`)**:
  - 25/25 test files, 318/318 PASS.
  - `email-delivery.service.spec.ts`: 6/6 PASS (Resend HTTP dispatch, missing API key exception, non-2xx error handling, Mock production fail-closed exception, Noop execution).
  - `auth.controller.spec.ts`: 22/22 PASS (signup, login, logout, password change, verifyEmail, resendVerification, HTTPS enforcement in production).
  - `auth.service.spec.ts`: 20/20 PASS (signup token generation & dispatch, verifyEmail atomic consumption & error handling, resendVerification anti-enumeration parity & newest-token-wins).
  - `workspace.guard.spec.ts`: 6/6 PASS (unverified user 403 Forbidden, verified user permitted, tenant isolation enforced).
  - `oauth.controller.spec.ts`: 15/15 PASS (unverified user 403 Forbidden on callback).
- **API E2E Tests (`apps/api/test/auth.e2e-spec.ts`)**:
  - Full signup → verify → workspace access flow verified:
    - Signup provisions unverified user and verification token in DB.
    - Unverified user workspace access rejected with 403 Forbidden.
    - Resend verification invalidates older tokens and dispatches new token.
    - Token consumption transitions user to verified in DB.
    - Verified user workspace access succeeds with 200 OK.
    - Non-member cross-tenant workspace access rejected with 403 Forbidden using valid UUID via `generateId()`.
    - Token replay rejected with 400 Bad Request.
    - Resend for already-verified and non-existent accounts returns generic message.

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending human code review, external infrastructure provisioning, and disaster recovery rehearsals G18/G19).
2. **Next Steps**:
   - Next milestone TBD.


## 43. Phase 7.1: Social Account Disconnect Flow (PR #52) — MERGED

### 1. Summary & Motivation
- **Merge Status & Identity**: Successfully merged into `main` on 2026-11-05T13:52:27Z.
  - **PR**: PR #52 (`feat/account-disconnect`)
  - **Merge Commit SHA**: `31f81b5a840c71c6963b4fd7215a1465b4f0eec6`
  - **Approved Implementation HEAD**: `7a783881b5a7b2ed5972ecf75e70944e17c69ffc` (no drift)
  - **Independent Review**: Approved by Muse independent review with zero blocking findings.
  - **CI Quality Gates**: 6/6 CI green on the approved head (GitGuardian Security Checks, Code Quality, Tests, Application Builds, API E2E Tests, Docker Build & Smoke Test).
  - **Next Milestone**: PR #54 — Phase 7.1, PR 3: Session Hardening Follow-Ups (M1–M5) & Revoke-All Sessions Wiring.
- **Review Findings (non-blocking)**:
  - **L1**: 404-vs-403 distinguishes a missing account from a foreign-workspace account (UUIDs unguessable; established pattern — practical risk nil).
  - **L2**: The `?? SocialAccountStatus.ACTIVE` default in the publishing fence and validator is fail-open if status were ever undefined (Prisma guarantees non-null — theoretical only).
  - **L3**: The repository `disconnect()` relies on the service's workspace check rather than scoping its own update by workspace.
- **Scope & Objectives**:
  - Implement protected disconnect endpoint `POST /api/v1/workspaces/:workspaceId/accounts/:accountId/disconnect`.
  - Guard endpoint with `AuthGuard`, `WorkspaceGuard`, and `PermissionGuard` (`@RequirePermission('accounts.disconnect')`), restricting disconnect permissions to `OWNER` and `MANAGER` roles.
  - Enforce tenant isolation: accounts belonging to another workspace return HTTP 403 Forbidden (`Account does not belong to this workspace`), preventing cross-tenant existence enumeration.
  - Execute best-effort provider token revocation before wiping local credentials (Meta, Google/YouTube, and LinkedIn graceful no-op). Any provider-side failure is logged as a warning and never aborts or blocks the disconnect.
  - Atomically wipe credentials in a single Prisma transaction: clear all access and refresh token material on `SocialConnection`, set `SocialAccount.status = DISCONNECTED`, and persist an `ACCOUNT_DISCONNECTED` audit log event.
  - Protect worker processors: fence publishing processor to fail fast on non-active/disconnected accounts with zero provider calls; extend sync processor to gracefully record `SyncRunStatus.SKIPPED` (`reason: 'account_disconnected'`).
  - Support seamless account reconnection via `SocialAccountRepository.upsertWithConnection` to restore `ACTIVE` status with fresh tokens without manual database intervention.
  - Provide complete frontend UX in `apps/web`: render Disconnect button with explicit confirmation dialog/step, display `DISCONNECTED` badge on disconnected accounts, and provide a direct Reconnect action.

### 2. Technical Architecture & Modifications

1. **Database Layer (`packages/database`)**:
   - **Schema Nullability (`schema.prisma`)**: Updated `SocialConnection` to make `encryptedAccessToken`, `accessTokenIv`, and `accessTokenAuthTag` nullable (`String?`), allowing credential wipe on disconnect while preserving the connection record and historic analytics/posts.
   - **Migration**: Added migration `20261105000000_make_social_connection_credentials_nullable`.
   - **Audit Actions (`AuditLogRepository.ts`)**: Added `ACCOUNT_DISCONNECTED = "ACCOUNT_DISCONNECTED"` to `AuditAction` enum.
   - **Repository (`SocialAccountRepository.ts`)**: Added `getDecryptedCredentials` (encapsulating decryption inside repository boundaries per ESLint architecture rules) and `disconnect` (executing atomic credential wipe, status update to `DISCONNECTED`, and transactional audit logging).

2. **Providers Layer (`packages/providers`)**:
   - **Interface (`ISocialProvider.ts`)**: Added optional `revokeToken?(credentials: OAuthCredentials): Promise<void>`.
   - **Meta Provider (`meta.provider.ts`)**: Implemented `revokeToken` calling `DELETE https://graph.facebook.com/v20.0/me/permissions` with Bearer token authentication and strict credential sanitization in error logs.
   - **YouTube Provider (`youtube.provider.ts`)**: Implemented `revokeToken` calling `POST https://oauth2.googleapis.com/revoke` with URL-encoded token payload and credential sanitization.
   - **LinkedIn Provider (`linkedin.provider.ts`)**: Implemented `revokeToken` as a documented graceful no-op since LinkedIn OAuth 2.0 API does not expose an RFC 7009 revocation endpoint.
   - **Unit Tests**: Added comprehensive test suites in `meta.provider.oauth.spec.ts`, `youtube.provider.spec.ts`, and `linkedin.provider.spec.ts`.

3. **Worker Layer (`apps/worker`)**:
   - **Publishing Processor (`publishing.processor.ts`)**: Added account status fencing immediately following validation and before atomic worker claim. If `variant.socialAccount.status !== SocialAccountStatus.ACTIVE`, fails fast with `PostStatus.FAILED`, creates `FAILED` `PublicationAttempt` with `failureCategory: 'AUTH_REQUIRED'` and `failureCode: 'ACCOUNT_DISCONNECTED'`, logs warning, emits audit event, and returns without provider calls or retries.
   - **Sync Processor (`sync.processor.ts`)**: Extended non-active account check to detect `DISCONNECTED` status and complete the sync run with `SyncRunStatus.SKIPPED` and `reason: 'account_disconnected'`.
   - **Token Service (`token.service.ts`)**: Handled nullable `encryptedAccessToken`, `accessTokenIv`, and `accessTokenAuthTag` gracefully, throwing `AuthRequiredError` if credentials are null.

4. **API Layer (`apps/api`)**:
   - **Controller (`accounts.controller.ts`)**: Added `POST :accountId/disconnect` route guarded by `AuthGuard`, `WorkspaceGuard`, and `PermissionGuard` (`@RequirePermission('accounts.disconnect')`) with `RateLimitPolicies.expensive` throttling.
   - **Service (`accounts.service.ts`)**: Implemented `disconnectAccount(workspaceId, accountId, userId, requestId)`:
     - Checks existence (404 Not Found if missing).
     - Checks workspace ownership (403 Forbidden `Account does not belong to this workspace` if foreign).
     - Executes best-effort provider token revocation catching all errors without throwing.
     - Calls `socialAccountRepo.disconnect` to execute atomic DB wipe and write audit log.
   - **Unit Tests (`accounts.controller.spec.ts`, `accounts.service.spec.ts`)**: Verified 401 unauthenticated, 403 non-member, 403 lack of permission, 404 missing account, 403 foreign workspace, provider revoke success & failure continuation, and atomic DB wipe.
   - **E2E Tests (`test/accounts.e2e-spec.ts`)**: Added complete e2e test suite verifying end-to-end HTTP lifecycle, tenant isolation, DB credential wiping, audit log creation, and reconnection restoration.

5. **Web Layer (`apps/web`)**:
   - **Component (`account-card.tsx`)**:
     - Added Disconnect button for connected accounts.
     - Added confirmation dialog/step ("Disconnect account? Publishing and sync will stop.") with Cancel and Confirm Disconnect buttons.
     - Added `DISCONNECTED` status badge rendering.
     - Added Reconnect button for disconnected accounts.
     - Handled disconnect mutation loading states and error messages.
   - **Accounts Page (`accounts/page.tsx`)**: Passed `onDisconnect={() => refetch()}` to trigger automatic list refresh upon account disconnection; updated provider connection availability checks to allow reconnecting disconnected accounts.
   - **Unit Tests (`account-card.spec.tsx`)**: Added 6 tests covering disconnect button rendering, confirmation toggling, cancellation, API call with status update & onDisconnect callback, error handling, and disconnected badge rendering.

### 3. Verification & Test Evidence

- **Monorepo Lint (`pnpm turbo run lint`)**: 9/9 packages PASS with 0 errors.
- **Monorepo Typecheck (`pnpm turbo run typecheck`)**: 10/10 tasks PASS with 0 errors.
- **Monorepo Build (`pnpm turbo run build`)**: 7/7 tasks PASS.
- **Database Unit Tests (`packages/database`)**: 8/8 unit test files, 63/63 PASS.
- **Providers Unit Tests (`packages/providers`)**: 15/15 test files, 241/241 PASS.
- **API Unit Tests (`apps/api`)**: 26/26 test files, 325/325 PASS.
- **Web Unit Tests (`apps/web`)**: 8/8 test files, 117/117 PASS.

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending human code review, external infrastructure provisioning, and disaster recovery rehearsals G18/G19).
2. **Milestone Completion Status**:
   - Pull Request #52 opened against `main` branch: **COMPLETED**.
   - All 6 GitHub Actions quality checks verified green: **COMPLETED**.
   - Independent Muse review completed and PR merged into `main`: **COMPLETED**.
   - **Next Milestone**: PR #54 — Phase 7.1, PR 3: Session Hardening Follow-Ups (M1–M5) & Revoke-All Sessions Wiring.

## 44. Phase 7.1, PR 3: Session Hardening Follow-Ups (M1–M5) & Revoke-All Sessions Wiring

### 1. Summary & Motivation

- **Status**: **IMPLEMENTED & VERIFIED LOCALLY (PR Pending Review)**
- **Branch**: `feat/session-followups-m1-m5`
- **Target Base**: `main` ([`2df90cffe274586a1d1e6a6c914970f8c69f36d1`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/2df90cffe274586a1d1e6a6c914970f8c69f36d1))
- **Scope Discipline**: PR 3 resolves all session hardening leftovers (findings M1–M5) identified during independent Muse review of PR #48 and wires up `AuthService.revokeAllUserSessions` into a production-ready, CSRF-protected, user-scoped endpoint. No schema migrations or billing models are introduced.
- **Live Deployment Release Gate**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending independent Muse approval, external infrastructure provisioning, and disaster recovery rehearsals G18/G19).

### 2. Scope & Technical Architecture (Findings M1–M5 Resolved)

1. **M1 — Password-Change Revoke Failure Resilience (`AuthService.changePassword`)**:
   - **Order-of-Operations Invariant**: In `AuthService.changePassword()`, `userRepository.updatePasswordAndIncrementEpoch` executes prior to Redis session revocation. This update-then-revoke sequence is load-bearing: incrementing `securityEpoch` in PostgreSQL immediately invalidates concurrent sessions at the `AuthGuard` boundary before Redis cleanup even runs.
   - **Bounded Retry Mechanism**: Wrapped `sessionManager.destroyOtherUserSessions(userId, currentSessionId, updatedUser.securityEpoch)` in a bounded 3-attempt retry loop with exponential backoff (50ms, 100ms).
   - **Fail-Resilient Deferred Outcome**: If Redis revocation fails across all 3 retry attempts, `AuthService.changePassword` does NOT throw an unhandled 500 error (which previously resulted in the user being informed that password change failed when the database password and epoch were already updated). Instead, it logs a structured warning (`password_change.session_cleanup_deferred`) and returns `{ success: true, sessionCleanupDeferred: true, message: 'Password changed successfully, but terminating other active sessions failed. Stale sessions will be invalidated on their next request via security epoch enforcement.' }`.
   - **Authoritative Epoch Enforcement Backstop**: Stale sessions surviving in Redis are guaranteed to fail on their very next request: `AuthGuard` compares `session.securityEpoch` against `user.securityEpoch` in PostgreSQL. Mismatched sessions are immediately destroyed in Redis and rejected with HTTP 401 Unauthorized.
   - **API Controller Parity (`AuthController.changePassword`)**: Surfaces `sessionCleanupDeferred: true` in the HTTP 200 OK response payload and logs `AuditAction.AUTH_PASSWORD_CHANGED` with `metadata: { sessionCleanupDeferred: true }`.

2. **M2 — Login Re-Read Leak Prevention (`AuthService.login`)**:
   - In `AuthService.login()`, credentials are confirmed with argon2 and a session is provisioned in Redis before a fresh re-read of `userRepository.findById(user.id)` verifies that no concurrent password/epoch change occurred in-flight.
   - Wrapped the post-creation `findById` re-read in a `try/catch` block. If the database query throws an error (e.g. database timeout or connection pool exhaustion), the newly created session is immediately destroyed via `sessionManager.destroySession(sessionId)` before the database exception is rethrown, preventing orphaned, indexed session keys from leaking in Redis until TTL expiration.

3. **M3, M4, M5 — Documentation Corrections**:
   - **M3 (§40)**: Corrected the audit trail documentation for password changes to reflect that `requestId` only is recorded (client IP is not collected).
   - **M4 (§40)**: Corrected the CI commit citation for PR #48 from intermediate commit `fc11169` to the approved PR HEAD `da2e8e6` (`da2e8e6280090a29c0e880f648fb6290e19a9321`).
   - **M5 (§39)**: Corrected description of `createSession` Lua script to state that Lua provides atomicity against concurrent command interleaving, rather than transactional rollback in the event of mid-script runtime exceptions.

4. **Revoke-All User Sessions Endpoint (`POST /api/v1/auth/sessions/revoke-all`)**:
   - **Audit Action**: Added `AUTH_REVOKE_ALL_SESSIONS = "AUTH_REVOKE_ALL_SESSIONS"` to the `AuditAction` enum in `packages/database/src/repositories/AuditLogRepository.ts`.
   - **Service Wiring (`AuthService.revokeAllUserSessions`)**: Atomically increments `securityEpoch` in PostgreSQL via `userRepository.incrementSecurityEpoch(userId)`, then purges all user sessions in Redis via `sessionManager.destroyAllUserSessions(userId)` with bounded 3-attempt retry resilience.
   - **API Controller Endpoint (`AuthController.revokeAllSessions`)**:
     - Route: `POST /api/v1/auth/sessions/revoke-all`.
     - Guards: Protected by `AuthGuard` (validates session, security epoch, and CSRF header `x-csrf-token`).
     - Throttling: Enforced under `RateLimitPolicies.auth`.
     - Strict Identity Trust: Extracts `userId` strictly from authenticated session (`req.user.id`). No `userId` or workspace parameters accepted in URL or request body.
     - Cookie Hygiene: Clears both `session` and `csrfToken` HTTP cookies in the response (`clearSessionCookies`).
     - Audit Logging: Best-effort audit logging logs `AUTH_REVOKE_ALL_SESSIONS` with `actorId`, `targetId`, and `requestId`.
   - **Frontend UI Status**: Verified that `apps/web` currently does not expose a user settings or security profile page (only dashboard, login, and workspace management exist). The endpoint is documented, exposed, and verified for direct client integration.

### 3. Verification & Test Evidence

- **Auth Service Unit Tests (`apps/api/src/modules/auth/auth.service.spec.ts`)**: 24/24 PASS:
  - M2 login re-read DB failure session cleanup test.
  - M1 bounded retry and deferred cleanup outcome test (asserts 3 retry attempts, warning log, no throw, and deferred outcome).
  - M1 retry recovery test (asserts 2 attempts and success outcome).
  - `revokeAllUserSessions` transient failure retry and resilience tests.
- **Auth Controller Unit Tests (`apps/api/src/modules/auth/auth.controller.spec.ts`)**: 24/24 PASS:
  - M1 deferred cleanup payload and audit metadata test.
  - `revokeAllSessions` endpoint routing, user scoping, audit logging, and cookie clearance tests.
- **Combined Auth Unit Suite**: 5/5 test files, 71/71 PASS (`auth.service.spec.ts`, `auth.controller.spec.ts`, `auth.guard.spec.ts`, `workspace.guard.spec.ts`, `email-delivery.service.spec.ts`).
- **All API Unit Tests (`pnpm --filter @agency-os/api test`)**: 26/26 test files, 331/331 PASS.
- **Auth E2E Suite (`apps/api/test/auth.e2e-spec.ts`)**: 23/23 PASS:
  - Scenario M1 E2E test: Simulates Redis revocation failure, verifies password is changed, response returns `{ sessionCleanupDeferred: true }`, and stale secondary session is immediately rejected with 401 via `AuthGuard` epoch check.
  - Revoke-all E2E tests: 401 unauthenticated check, 403 CSRF mismatch check, and complete revocation lifecycle asserting 200 OK, cookie clearance, stale session 401 rejection, DB epoch incrementation, and subsequent login with new epoch.
- **Monorepo Lint (`pnpm turbo run lint`)**: 9/9 packages PASS with 0 errors.
- **Monorepo Typecheck (`pnpm turbo run typecheck`)**: 10/10 tasks PASS with 0 errors.
- **Monorepo Build (`pnpm turbo run build`)**: 7/7 tasks PASS.

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending independent Muse code review, external infrastructure provisioning, and disaster recovery rehearsals G18/G19).
2. **Milestone Completion Status**:
   - Pull Request #54 opened against `main` and CI verified green: **COMPLETED**.
   - Independent Muse review completed and PR merged into `main` (commit `6b448010065b2182ff3289f58e687602910468b0`): **COMPLETED**.
   - **Next Milestone**: PR #55 — Phase 7.1, PR 4: Fail-Fast Startup Validation for RESEND_API_KEY in Production (PR #51 M1 Resolution).

## 45. Phase 7.1, PR 4: Fail-Fast Startup Validation for RESEND_API_KEY in Production (PR #55)

### 1. Summary & Motivation

- **Status**: **IMPLEMENTED & VERIFIED LOCALLY (PR Pending Review)**
- **Branch**: `feat/resend-startup-validation`
- **Target Base**: `main` ([`6b448010065b2182ff3289f58e687602910468b0`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/6b448010065b2182ff3289f58e687602910468b0))
- **Scope Discipline**: Implements fail-fast startup validator `validateEmailDeliveryConfig()` in `apps/api/src/config/email-delivery.ts`, directly resolving non-blocking review finding M1 from PR #51.
- **The Core Invariant**: In production (`NODE_ENV === 'production'`), missing or empty/whitespace-only `RESEND_API_KEY` previously caused `AuthModule`'s factory to silently instantiate `NoopEmailDeliveryService`. Because PR #51 activated 403 email-verification gates (`WorkspaceGuard` and `OAuthController`), deploying production keyless silently dropped verification emails while enforcing gates, permanently locking out all new user signups. This change makes keyless production boot impossible.
- **Live Deployment Release Gate**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending independent Muse code review, external infrastructure provisioning, and disaster recovery rehearsals G18/G19).

### 2. Scope & Technical Architecture

1. **Pure Startup Validator (`apps/api/src/config/email-delivery.ts`)**:
   - Implemented `validateEmailDeliveryConfig(apiKey = process.env.RESEND_API_KEY, isProduction = process.env.NODE_ENV === 'production')`.
   - **Production Enforcement**: When `isProduction === true`, missing (`undefined`), empty (`""`), or whitespace-only (`"   "`) `apiKey` throws a descriptive, fail-fast `Error` stating:
     - The variable name: `RESEND_API_KEY`
     - The consequence: `Verification emails cannot be delivered and new signups will be locked out by 403 email verification gates.`
     - The fix: `Set RESEND_API_KEY to a valid Resend API key.`
   - **Non-Production Ergonomics**: In development and test environments (`isProduction === false`), the key remains optional, allowing developers and local unit/integration tests to run using `MockEmailDeliveryService` or `NoopEmailDeliveryService` without configuring Resend credentials.
   - **Boot Lifecycle**: Called synchronously during `bootstrap()` in `apps/api/src/main.ts` alongside `validateTokenEncryptionKey()` and `validateStoragePublicEndpoint()` before `NestFactory.create()` initializes any modules or listeners.
   - **Zero Network Side-Effects**: Validates presence and non-emptiness only. Does not issue external HTTP requests to Resend at boot. No bypass or escape-hatch flags are introduced.

2. **CI Docker Build & Smoke Test Trap Resolution**:
   - **The Trap**: The API Docker image sets `ENV NODE_ENV=production` (`apps/api/Dockerfile:73`). During the GitHub Actions CI workflow `Docker Build & Smoke Test`, the API container boots as a production process.
   - **The Resolution**: Added dummy environment variable `RESEND_API_KEY: dummy-resend-api-key` to:
     - `.github/workflows/ci.yml` under `docker` job `env`, `Smoke test Compose stack` step `env`, and `Smoke test Staging Compose stack with Ingress` step `env`.
     - `docker-compose.yml` under `services.api.environment` (`RESEND_API_KEY: ${RESEND_API_KEY}`).
     - `docker-compose.staging.yml` under `services.api.environment` (`RESEND_API_KEY: ${RESEND_API_KEY}`).
   - This follows the existing dummy-credential pattern already established in CI for `YOUTUBE_CLIENT_ID`, `LINKEDIN_CLIENT_ID`, and `JWT_SECRET`. Because the validator verifies presence without network dispatch, dummy values permit container smoke testing without disclosing or requiring real production secrets.

3. **Scope Discipline**:
   - Zero modifications to `EMAIL_FROM` or `FRONTEND_URL` handling (both continue using established defaults).
   - Zero modifications to `NoopEmailDeliveryService`, `ResendEmailDeliveryService`, or the 403 verification gates.

### 3. Verification & Test Evidence

- **Email Delivery Configuration Unit Tests (`apps/api/src/config/email-delivery.spec.ts`)**: 9/9 PASS:
  - Fails fast on missing (`undefined`) key in production.
  - Fails fast on empty string (`""`) key in production.
  - Fails fast on whitespace-only key in production.
  - Asserts error message names variable, consequence (lockout), and fix.
  - Passes on valid key in production and returns trimmed value.
  - Passes without key in non-production (development/test).
  - Passes with key in non-production.
  - Honors `process.env` defaults for both key and environment.
- **API Bootstrap Tests (`apps/api/src/main.spec.ts`)**: 6/6 PASS:
  - Fails fast and prevents `NestFactory.create` in production if `RESEND_API_KEY` is missing.
  - Fails fast and prevents `NestFactory.create` in production if `RESEND_API_KEY` is whitespace-only.
  - Initializes Nest application successfully in production when `RESEND_API_KEY` is provided.
- **Staging Deployment Configuration Tests (`apps/api/src/config/staging-deployment.spec.ts`)**: 24/24 PASS:
  - NGINX ingress configuration tests pass.
  - Staging Compose resolution and required secrets fail-fast tests pass.
- **All API Unit Tests (`pnpm --filter @agency-os/api test`)**: 27/27 test files, 343/343 PASS.
- **Monorepo Lint (`pnpm turbo run lint`)**: 9/9 packages PASS with 0 errors.
- **Monorepo Typecheck (`pnpm turbo run typecheck`)**: 10/10 tasks PASS with 0 errors.
- **Monorepo Build (`pnpm turbo run build`)**: 7/7 tasks PASS.

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending independent Muse code review, external infrastructure provisioning, and disaster recovery rehearsals G18/G19).
2. **Milestone Completion Status**:
   - Feature branch `feat/resend-startup-validation` ready for Pull Request creation against `main`: **READY**.
   - Independent Muse review required before any merge: **PENDING**.


---

## 46. Phase 8 (Billing Phase 1): Plans, 14-Day Trial, Razorpay Subscriptions, Webhooks, GST Invoices & Entitlement Fences (PR #56) — MERGED

### 1. Summary & Motivation

- **Merge Status & Identity**: Successfully merged into `main` on 2026-11-07T06:05:18Z.
  - **PR**: PR #56 (`feat/billing-phase1` — Billing Phase 1: plans, 14-day trial, Razorpay subscriptions, webhooks, GST invoices, entitlement fences)
  - **Merge Commit SHA**: `da44db87f001bb86405208be53f99e01ab7003d7`
  - **Approved Implementation HEAD**: `938df1bdbd4641852bc91bc23a75b804df82acbc` (merged with no drift)
  - **Base Commit**: `e73d44393c72182821ab60287419f02a527e063e` (`main`, post-PR #55 merge)
  - **CI Quality Gates**: 6/6 checks green on the approved head (`GitGuardian Security Checks`, `Code Quality`, `Tests`, `Application Builds`, `API E2E Tests`, `Docker Build & Smoke Test`).
  - **Next Milestone**: Billing Phase 2 (checkout UI, customer portal, PDF invoices).
- **Review History (three rounds)**:
  - **Round 1 (REQUEST CHANGES at `4f6e16680be3f1cf710630ecb370c4f460c2b29b`)**:
    - **F1 (HIGH)**: `main.ts` never enabled `rawBody`, so production webhook verification always failed (`req.rawBody` was undefined; HMAC calculation threw or verified against parsed JSON object).
    - **F2 (HIGH)**: No Razorpay subscription was ever created and no Razorpay plans were seeded (`BillingService.createSubscription` only updated local Prisma state; `seedPlans()` only wrote local rows).
    - **F3 (MEDIUM)**: Founding-50 claim was a plain `count()` without locking, vulnerable to concurrency race conditions exceeding the 50-workspace cap.
    - **F4 (MEDIUM)**: Webhook idempotency was check-then-act outside a transaction, risking concurrent double-processing of identical webhook events.
  - **Round 2 (REQUEST CHANGES at `e7d4ab1f667debbe59ce134dfef457ac14ec483a`)**:
    - F1–F4 resolved (`NEST_APP_OPTIONS` with `rawBody: true`, plan seeding and real subscription creation, `FOR UPDATE` pessimistic locking on `Plan`, and transactional webhook deduplication).
    - **F5 (HIGH)** (new finding): Only monthly Razorpay plans existed (`period: 'monthly'`); an `ANNUAL` subscribe reused that monthly plan with `totalCount: 10`, causing the customer to be billed monthly 10 times over 10 months instead of renewing annually.
  - **Round 3 (APPROVE at `938df1bdbd4641852bc91bc23a75b804df82acbc`)**:
    - Resolved F5: Dual-interval plan seeding creates yearly Razorpay plans (`period: 'yearly'`, `amount: annualPricePaise`) alongside monthly plans, stored on `Plan` as `razorpayAnnualPlanId` and `razorpayPlanId`.
    - Interval routing: `MONTHLY` maps to `razorpayPlanId` with `totalCount: 120`; `ANNUAL` maps to `razorpayAnnualPlanId` with `totalCount: 10` across `createSubscription` and `claimFoundingSubscription`.
    - Exposed checkout `short_url` / `shortUrl` in subscription creation response.
    - Zero regressions to F1–F4; all unit and E2E tests verified.
- **Final State on Main**:
  - Plans seeded in Razorpay (monthly + yearly per plan code).
  - Subscribe creates a real Razorpay subscription with the right plan and billing frequency.
  - Webhooks verify against the raw body (`rawBody: true` via shared `NEST_APP_OPTIONS` across `main.ts` and test apps).
  - Founding-50 claim serialized with a `FOR UPDATE` pessimistic lock on the `Plan` row inside `$transaction`.
  - Webhook processing idempotent (atomic event-row claim, processing + marking in one transaction).
  - GST math strictly in integer paise.
- **Scope Discipline**: Implements the server-side foundation for monetization under Kyosys Agency OS:
  - Plan definition & pricing in integer paise (Solo ₹499/mo, Studio ₹999/mo, Agency ₹3,999/mo, Founding Agency ₹2,999/mo; 10x monthly price for annual billing).
  - 14-day in-app trial with full Agency entitlements (`workspaces.trialEndsAt = signup + 14 days`), zero Razorpay object creation at signup.
  - Hard trial-end & subscription halted fences via `TRIAL_END_GRACE_DAYS` (default 0), putting workspaces into read-only mode (blocking post publishing and scheduling).
  - Razorpay subscription lifecycle management and webhook event processing (`subscription.authenticated`, `subscription.charged`, `subscription.halted`, `subscription.cancelled`, `payment.failed`).
  - Cryptographic webhook validation using HMAC-SHA256 (`crypto.timingSafeEqual`) and event deduplication via `WebhookEvent`.
  - GST invoicing compliance for Gadmale Technologies (sole proprietorship, Maharashtra, 18% GST-inclusive prices, integer paise split, sequential numbering `INV-YYYY-XXXXX`, dynamic `GSTIN` from env with production fail-fast).
  - PostgreSQL row-level pessimistic lock (`SELECT id FROM "Plan" WHERE code = 'AGENCY_FOUNDING' FOR UPDATE`) Founding-50 cap (< 50 active/trial/past_due founding workspaces in `$transaction`), grandfathered renewals, permanent forfeit upon cancellation.
  - Automated dunning notifications on `payment.failed` via `EmailDeliveryService`.
  - Read-only fences enforced across controllers (`WorkspaceWritableGuard`), domain validators (`PublishabilityValidator`), and worker queue processors (`publishing.processor.ts`).
  - Scheduled daily BullMQ worker job for trial expiration.
- **Out of Scope (Phase 2 Follow-Up)**: Checkout UI, customer billing portal, PDF invoice generation.
- **Live Deployment Release Gate**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live Razorpay credentials, and disaster recovery rehearsals G18/G19).

### 2. Scope & Technical Architecture

1. **Database Schema & Models (`packages/database`)**:
   - Added enums:
     - `BillingInterval`: `MONTHLY`, `ANNUAL`
     - `SubscriptionStatus`: `TRIAL`, `ACTIVE`, `PAST_DUE`, `HALTED`, `CANCELLED`, `COMPLETED`, `EXPIRED`
     - `InvoiceStatus`: `PAID`, `FAILED`
   - Extended `Workspace` with `trialEndsAt DateTime?`, relations to `Subscription?` and `Invoice[]`.
   - Added models:
     - `Plan`: id, code, name, monthlyPricePaise, annualPricePaise, seats, features (JSON), isFounding, isActive, razorpayPlanId, razorpayAnnualPlanId, createdAt, updatedAt.
     - `Subscription`: id, workspaceId, planId, razorpaySubscriptionId, razorpayPlanId, status, billingInterval, isFounding, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, createdAt, updatedAt.
     - `Invoice`: id, workspaceId, subscriptionId, invoiceNumber, amountPaise, baseAmountPaise, gstAmountPaise, gstRate, gstin, customerBillingDetails (JSON), razorpayPaymentId, razorpayInvoiceId, status, periodStart, periodEnd, createdAt, updatedAt.
     - `InvoiceSequence`: year, lastSequence.
     - `WebhookEvent`: id, eventId, provider, payload (JSON), processed, createdAt.
   - Generated idempotent Prisma migration: `20261106000000_add_billing_phase1_models`.
   - Updated `UserRepository.createWithTenantTransaction` to initialize `trialEndsAt` to `signup + 14 days` without creating Razorpay objects.

2. **GST Math & Invoicing Engine (`apps/api/src/modules/billing/gst.util.ts`)**:
   - Sole proprietorship: Gadmale Technologies (Maharashtra).
   - All prices GST-inclusive at 18%.
   - Mathematics strictly integer paise: `baseAmountPaise = Math.round(totalAmountPaise / 1.18)`, `gstAmountPaise = totalAmountPaise - baseAmountPaise`.
   - Split: CGST 9% (`Math.floor(gst/2)`), SGST 9% (`gst - floor(gst/2)`), or IGST 18% for out-of-state.
   - Sequential numbering format `INV-YYYY-XXXXX` managed atomically with `InvoiceSequence`.
   - Fail-fast dynamic GSTIN validator (`getGstin()`): in `NODE_ENV === 'production'`, throws if `process.env.GSTIN` is missing or empty; falls back to development test GSTIN otherwise.

3. **Cryptographic Webhook Ingestion & Razorpay Client (`apps/api/src/modules/billing/razorpay.service.ts`)**:
   - Application bootstrap (`apps/api/src/main.ts`) creates the Nest application with `{ bufferLogs: true, rawBody: true }` via exported `createNestApp()`, ensuring Express populates `req.rawBody` for webhook verification across production and E2E tests.
   - Initialized official `razorpay` client using `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
   - Webhook signature verification computes `crypto.createHmac('sha256', secret).update(rawPayload).digest('hex')` and validates with constant-time `crypto.timingSafeEqual`.
   - Webhook controller receives raw body buffer, returns HTTP 400 on missing or invalid signature.
   - Idempotent deduplication against `WebhookEvent` table by `event.id`; duplicate events return HTTP 200 with `{ status: 'ok', eventId, duplicate: true }`.
   - Webhook events processed within database transaction; invoice creation is idempotent on `razorpayPaymentId`.

4. **Founding-50 Lock & Lifecycle Operations (`apps/api/src/modules/billing/billing.service.ts`)**:
   - `claimFoundingSubscription`: Serializes concurrent requests via PostgreSQL row-level pessimistic locking (`SELECT id FROM "Plan" WHERE code = 'AGENCY_FOUNDING' FOR UPDATE`) within a Prisma `$transaction`, checking `count(*) < 50`. Throws `ConflictException` (409 `FOUNDING_PLAN_SOLD_OUT`) if cap reached.
   - Dual-interval Razorpay plan seeding: seeds both monthly (`period: 'monthly'`) and annual (`period: 'yearly'`) Razorpay plans idempotently for all tiers, storing `razorpayPlanId` and `razorpayAnnualPlanId` on `Plan`.
   - Interval-based plan selection: `MONTHLY` maps to `razorpayPlanId` with `totalCount: 120`; `ANNUAL` maps to `razorpayAnnualPlanId` with `totalCount: 10` across both `createSubscription` and `claimFoundingSubscription`.
   - Checkout URL exposure: subscribe responses include Razorpay checkout `short_url` / `shortUrl` alongside local subscription state when available.
   - Creates Razorpay subscription before committing local state; if Razorpay fails, transaction aborts with zero DB state claimed.
   - Grandfathered renewals: status remains active, preserves founding rate.
   - Cancellation policy: `cancelAtPeriodEnd: true`, status becomes `CANCELLED` at period end; permanent forfeit of founding status.
   - Automated dunning: on `payment.failed`, sends transactional dunning email with masked details via `EmailDeliveryService.sendDunningEmail`.

5. **Entitlement Fences & Read-Only Walls**:
   - `EntitlementsService`: computes workspace status (`TRIAL`, `ACTIVE`, `HALTED`, `PAST_DUE`, `EXPIRED`, `READ_ONLY`) and effective features (Agency tier during trial, plan-specific tier when paid).
   - `WorkspaceWritableGuard`: applied to mutating endpoints (`posts.controller.ts`, `publications.controller.ts`), rejects with HTTP 403 `WORKSPACE_READ_ONLY` when trial has expired beyond grace period or subscription is halted.
   - `PublishabilityValidator`: checks `workspace.trialEndsAt` and subscription status, rejecting publication dispatch with `WORKSPACE_READ_ONLY`.
   - `apps/worker/src/publishing/publishing.processor.ts`: re-checks workspace read-only status in worker prior to social network dispatch, moving publications to `FAILED` with non-retryable reason `WORKSPACE_READ_ONLY`.
   - `TrialExpiryProcessor` & `TrialExpiryScheduler`: daily BullMQ cron job (`0 0 * * *`) using `upsertJobScheduler` that flags expired trials past grace days.

6. **CI & Docker Staging Hardening**:
   - Added test dummy credentials `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` across CI jobs (`test`, `e2e`, `docker`), `docker-compose.yml`, and `docker-compose.staging.yml`.
   - Verified Staging Compose configuration and required secrets fail-fast tests.

### 3. Verification & Test Evidence

- **GST Calculation Unit Tests (`apps/api/src/modules/billing/gst.util.spec.ts`)**: 13/13 PASS.
  - Verifies exact paise rounding: ₹499 (42,288 base + 7,612 GST = 49,900), ₹999 (84,661 base + 15,239 GST = 99,900), ₹2,999 (254,153 base + 45,747 GST = 299,900), ₹3,999 (338,898 base + 61,002 GST = 399,900).
  - Verifies CGST + SGST exact sum = total GST paise.
- **Billing Config Unit Tests (`apps/api/src/modules/billing/billing.config.spec.ts`)**: 15/15 PASS.
  - Verifies plan matrix, annual pricing (10x monthly), dynamic GSTIN fail-fast in production, and grace days parsing.
- **Razorpay Service Unit Tests (`apps/api/src/modules/billing/razorpay.service.spec.ts`)**: 9/9 PASS.
  - Verifies HMAC-SHA256 signature verification, timing safe comparison, payload rejection, subscription creation options, and log masking.
- **Billing Service Unit Tests (`apps/api/src/modules/billing/billing.service.spec.ts`)**: 18/18 PASS.
  - Verifies dual plan seeding (monthly + yearly), interval plan routing (`totalCount: 120` vs `10`), Founding-50 cap enforcement (409 Conflict) with `FOR UPDATE` locking, grandfathered renewals, permanent forfeit on cancellation, sequential invoice generation, dunning email dispatch, and checkout `short_url` exposure.
- **Entitlements Service & Guard Tests**:
  - `entitlements.service.spec.ts`: 9/9 PASS.
  - `workspace-writable.guard.spec.ts`: 3/3 PASS.
  - `PublishabilityValidator.spec.ts`: 29/29 PASS.
- **Billing Controller Unit Tests (`apps/api/src/modules/billing/billing.controller.spec.ts`)**: 6/6 PASS.
  - Verifies webhook 400 rejection on missing/invalid signature, 200 on valid signature, idempotent duplicate handling, workspace billing queries, and subscription endpoints.
- **Worker Trial Expiry Processor Tests (`apps/worker/src/billing/trial-expiry.processor.spec.ts`)**: 3/3 PASS.
  - Verifies detection of expired trials past grace days, preservation of active trials, and subscription override.
- **Email Delivery Service Dunning Tests (`apps/api/src/modules/auth/email-delivery.service.spec.ts`)**: 6/6 PASS.
- **Staging Deployment Configuration Tests (`apps/api/src/config/staging-deployment.spec.ts`)**: 24/24 PASS.
- **User Repository Signup Tests (`packages/database/src/repositories/UserRepository.spec.ts`)**: 6/6 PASS.
- **API E2E Tests (`apps/api/test/billing.e2e-spec.ts`)**:
  - Full subscription lifecycle, dual-interval plan selection, webhook HMAC verification against raw body, idempotent deduplication, invoice creation, and read-only fence enforcement verified.
- **All API Unit Tests (`pnpm --filter @agency-os/api test`)**: 34/34 test files, 419/419 PASS.
- **Monorepo Lint (`pnpm turbo run lint`)**: 9/9 packages PASS with 0 errors.
- **Monorepo Typecheck (`pnpm turbo run typecheck`)**: 10/10 tasks PASS with 0 errors.
- **Monorepo Build (`pnpm turbo run build`)**: 7/7 tasks PASS.
- **GitHub Actions CI (Approved Head `938df1bdbd4641852bc91bc23a75b804df82acbc`)**: 6/6 checks PASS (`GitGuardian Security Checks`, `Code Quality`, `Tests`, `Application Builds`, `API E2E Tests`, `Docker Build & Smoke Test`).

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live Razorpay credentials, and disaster recovery rehearsals G18/G19).
2. **Milestone Completion Status**:
   - PR #56 merged into `main` (commit `da44db87f001bb86405208be53f99e01ab7003d7`): **COMPLETED**.
   - All 6 CI checks green on approved head `938df1bdbd4641852bc91bc23a75b804df82acbc`: **COMPLETED**.
   - Independent Muse review completed and approved: **COMPLETED**.
   - **Next Milestone**: Billing Phase 2 (PR #58 — checkout UI, customer portal, PDF invoices & plans API).

## 47. Phase 8 (Billing Phase 2): Checkout UI, Customer Portal, PDF Invoices & Plans API (PR #58) — MERGED

### 1. Summary & Motivation

- **Merge Status & Identity**: Successfully merged into `main` on 2026-11-07T13:33:44Z.
  - **PR**: PR #58 (`feat/billing-phase2` — Billing Phase 2: checkout UI, customer portal, PDF invoices, plans API)
  - **Merge Commit SHA**: `834cfae194f9bfa0de7ee266a71f61489c4b0b1c`
  - **Approved Implementation HEAD**: `535fd8dfc3a5872f92bb01a77762989c25c0e08e` (merged with no drift)
  - **Base Commit**: `e615d6dac0a7d23cf113ae54b58b4b4d5c9b83a7` (`main`, post-PR #57 merge)
  - **CI Quality Gates**: 6/6 checks green on the approved head (`GitGuardian Security Checks`, `Code Quality`, `Tests`, `Application Builds`, `API E2E Tests`, `Docker Build & Smoke Test`).
  - **Next Milestone**: TBD
- **Review History (single round)**:
  - **Round 1 (APPROVE at `535fd8dfc3a5872f92bb01a77762989c25c0e08e`)**:
    - Single-round approval — no REQUEST CHANGES rounds.
    - **Verified in review**:
      - Plans endpoint with `foundingAvailable` (counted the same way as Phase 1: active count < 50 across `ACTIVE`, `TRIAL`, `PAST_DUE` founding subscriptions).
      - Invoices list newest-first (`orderBy: { createdAt: 'desc' }`).
      - PDF endpoint (guards + `ParseUUIDPipe` + 404 for foreign workspace invoices, inline headers).
      - PDF GST regime rule exactly as specified: IGST 18% for known non-Maharashtra state, CGST + SGST otherwise, split `cgst = Math.round(gstAmountPaise / 2)` and `sgst = gstAmountPaise - cgst`, regime labelled, no invented fields.
      - Checkout UI (4 plans at exact prices, founding disabled when sold out, `short_url` redirect, trial countdown + payment-processing + retained-access banners, cancel with `cancelAtPeriodEnd: true`).
      - Tests (pdf spec 5/5 incl. odd-paise split + IGST path, controller 10/10, page 7/7, billing service 23/23, E2E 19/19 — all counts verified by counting `it()` blocks).
    - **Non-blocking notes recorded in review**:
      - §47 claims "sub-50ms PDF streaming" with no measurement cited.
      - `billing.config` carries an unused tradeName `'Kyosys Agency OS'` (filed trade name is Gadmale Technologies).
- **Final State on Main**:
  - The full money path is built and proven: plan picker → Razorpay checkout (`short_url`) → GST invoice PDF, plus the customer portal (plan status, invoice list, cancel at period end).
- **Core Deliverables**:
  - **Plans API (`GET /api/v1/workspaces/:workspaceId/billing/plans`)**: Returns the 4 active plans (Solo ₹499, Studio ₹999, Agency ₹3,999, Agency Founding 50 ₹2,999) with monthly and annual prices in integer paise, max seats, features, and dynamic `foundingAvailable: boolean` flag evaluated against the 50-workspace founding cap across `ACTIVE`, `TRIAL`, and `PAST_DUE` subscriptions.
  - **Invoices API (`GET /api/v1/workspaces/:workspaceId/billing/invoices`)**: Returns historical workspace invoices sorted newest first, including plan code/name, billing interval, integer paise amounts (`amountPaise`, `baseAmountPaise`, `gstAmountPaise`), GSTIN, status, and PDF download metadata.
  - **PDF Invoice Generation & Streaming (`GET /api/v1/workspaces/:workspaceId/billing/invoices/:invoiceId/pdf`)**: Pure server-side PDF generator built with `pdfkit` (no headless browser/Chromium overhead, completely serverless/container-friendly). Enforces strict tenant isolation returning 404 `NotFoundException` (never 403) for non-existent or foreign workspace invoices, parameter UUID validation via `ParseUUIDPipe`, `application/pdf` streaming headers (`Content-Disposition: inline; filename="invoice-{number}.pdf"`), and strict Indian GST tax compliance:
    - **Header & Parties**: "TAX INVOICE", sequential invoice number, issuance date, Seller details (Gadmale Technologies, Maharashtra, GSTIN from `getGstin()`), and Buyer details (workspace name and structured `customerBillingDetails`).
    - **Tax Regime**: Intra-state (Maharashtra or unspecified buyer state) splits into CGST (9%) and SGST (9%) with exact integer paise rounding (`cgst = Math.round(gst / 2)`, `sgst = gst - cgst`); Inter-state (explicit non-MH buyer state) applies single IGST (18%).
  - **Customer Portal & Checkout UI (`apps/web/src/app/[workspaceId]/billing/page.tsx`)**:
    - Complete billing dashboard within dashboard shell following standard layout, loading skeleton, and 403 access control.
    - Added Billing navigation item (`CreditCard` icon) in sidebar navigation.
    - Dynamic Status Banner: Trial countdown with remaining days, active subscription status with next renewal date and interval, cancelled status detailing retained access until cycle end, and past due/halted banner warning of read-only mode. Also supports `?payment=processing` notice when returning from Razorpay.
    - 4-Plan Pricing Cards with Monthly / Annual toggle ("2 months free" discount badge):
      - Solo ₹499/mo (₹4,990/yr, 1 seat)
      - Studio ₹999/mo (₹9,990/yr, 3 seats)
      - Agency ₹3,999/mo (₹39,990/yr, unlimited)
      - Agency Founding 50 ₹2,999/mo (₹29,990/yr, first 50 seats, disabled if `foundingAvailable: false`)
    - Subscribe flow calls `POST /api/v1/workspaces/:workspaceId/billing/subscribe` and navigates user directly to Razorpay hosted checkout `short_url`.
    - Invoices History Table: Chronological invoice list displaying invoice number, issuance date, plan, interval, total GST-inclusive amount formatted to ₹, status badge, and one-click PDF download link.
    - Subscription Cancellation Modal: Confirms cancellation for active paid subscriptions, clearly informing the user that service access is preserved until the end of the current billing cycle, then invokes `POST /api/v1/workspaces/:workspaceId/billing/cancel` with `{ cancelAtPeriodEnd: true }`.

### 2. Architecture & Design Decisions

- **Pure Server-side PDFKit Generation**: Avoided Puppeteer/Playwright or external rendering microservices; `pdfkit` delivers lightweight, predictable PDF streaming directly to the client.
- **Tenant Isolation**: Direct lookup verifies `workspaceId` matching the authenticated context. Any foreign or unowned invoice returns standard 404 to avoid information disclosure.
- **Strict Integer Paise Invariant**: All amounts in the API and database remain strictly integer paise; formatting to rupees (e.g. `₹499`) is strictly isolated to presentation components.
- **Cancellation Grace Period**: Subscriptions cancelled with `cancelAtPeriodEnd: true` maintain full write access and non-read-only entitlement status until `currentPeriodEnd` is reached, while permanently releasing their founding lock.

### 3. Verification & Test Evidence

- **PDF Invoice Service Unit Tests (`apps/api/src/modules/billing/pdf-invoice.service.spec.ts`)**: 5/5 PASS.
  - Verifies PDF buffer generation, intra-state CGST/SGST split, inter-state IGST application, odd-paise rounding, and tax breakdown accuracy.
- **Billing Service Unit Tests (`apps/api/src/modules/billing/billing.service.spec.ts`)**: 23/23 PASS.
  - Verifies `getPlansWithAvailability` founding cap check, `getWorkspaceInvoices` reverse chronological ordering, and `getInvoiceRecord` 404 tenant isolation.
- **Billing Controller Unit Tests (`apps/api/src/modules/billing/billing.controller.spec.ts`)**: 10/10 PASS.
  - Verifies `/plans`, `/invoices`, and `/invoices/:invoiceId/pdf` streaming response headers, pipe handling, and 404 error bubbling.
- **Billing Page Web Tests (`apps/web/src/app/[workspaceId]/billing/page.spec.tsx`)**: 7/7 PASS.
  - Verifies plan cards rendering with paise formatting, monthly/annual toggle, disabled state for exhausted founding plan, status banners, invoice history with PDF download links, subscribe redirection, and cancellation modal confirmation.
- **Full Web Unit Suite (`pnpm --filter @agency-os/web test`)**: 9/9 test files, 124/124 tests PASS.
- **Full API Unit Suite (`pnpm --filter @agency-os/api test`)**: 35/35 test files, 433/433 tests PASS.
- **API E2E Tests (`apps/api/test/billing.e2e-spec.ts`)**: 19/19 PASS.
  - Covers Webhook HMAC rawBody validation & deduplication, Subscription lifecycle & Razorpay plan routing, Founding-50 concurrency locking, Webhook concurrency & idempotent invoicing, Workspace entitlements, Subscription cancellation, Plans API with founding cap, Invoices API newest first, and PDF streaming with tenant isolation & UUID validation.
- **Monorepo Lint & Typecheck (`pnpm turbo run lint typecheck`)**: 15/15 tasks PASS with 0 errors.
- **Monorepo Build (`pnpm turbo run build`)**: 7/7 tasks PASS.

### 4. Release Gate & Milestone Completion

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live Razorpay credentials, and disaster recovery rehearsals G18/G19).
2. **Milestone Completion Status**:
   - PR #58 merged into `main` (commit `834cfae194f9bfa0de7ee266a71f61489c4b0b1c`): **COMPLETED**.
   - All 6 CI checks green on approved head `535fd8dfc3a5872f92bb01a77762989c25c0e08e`: **COMPLETED**.
   - Independent Muse review completed and approved: **COMPLETED**.
   - **Next Milestone**: TBD (billing is complete as specified; the next milestone is to be decided).

---

## 48. Self-Serve Signup & Email Verification Onboarding Frontend (Branch `feat/signup-onboarding-ui` — PR #60) — MERGED

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #60, merged 2026-11-07, merge commit [`18d2d0404cf81696d191c2f1b3eb86b18c6c984a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/18d2d0404cf81696d191c2f1b3eb86b18c6c984a), approved head `c80ad503f58d3f42a6b11429d73c3d157f4d6aa6`)
- **Branch**: `feat/signup-onboarding-ui`
- **Base Commit**: `be3441998658bb00dd6a8035b9438f79f9ec4761` (`main`)
- **Reviewer**: Muse (APPROVED at head `c80ad503f58d3f42a6b11429d73c3d157f4d6aa6`)
- **Live Deployment Release Gate**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
- **Next Milestone**: TBD
- **Problem & Motivation**:
  - The backend signup and email verification infrastructure existed (`SignupDto`, `AuthService.signup`, `AuthService.verifyEmail`, `AuthService.resendVerification`), but no browser UI invoked it.
  - `/` was a redirect to `/dashboard`, `/login` only supported existing credentials with zero links to create an account, and no `/signup` or `/verify-email` pages existed in `apps/web`.
  - Transactional verification emails linked to `{FRONTEND_URL}/verify-email?token=...`, resolving to a 404 in production.
  - This deliverable introduces the complete client onboarding UI: self-serve registration, anti-enumeration security, honest trial communication, single-use token verification with React StrictMode guard, and unverified account notification banners on the dashboard.

### 2. Scope & Implementation Details

1. **Self-Serve Registration Flow (`apps/web/src/app/signup/page.tsx` + `page.spec.tsx`)**:
   - Form fields matching `SignupDto`: `email`, `password`, `confirmPassword` (client-only match check, never transmitted over the wire), `organizationName` (optional, max 100 chars), and `workspaceName` (optional, max 100 chars). User name field omitted as `User.name` is not set at signup.
   - Client validation: valid email pattern, password length 8–128 characters, matching password confirmation.
   - Submits payload to `POST /api/v1/auth/signup` via `api.post`. Does not set session cookies or auto-login.
   - Anti-enumeration UX: generic 201 response switches to the "Check your email" view unconditionally, preventing email enumeration or account probing.
   - Honest copy: "Your workspace is created with a 14-day trial. Verify your email to enter it.", clearly establishing that the 14-day trial clock begins at signup.
   - Inline resend verification form on check-email screen submitting to `POST /api/v1/auth/resend-verification`, always displaying generic success message: `"If an unverified account exists for this email, a verification link has been sent."`
   - Complete error mapping for 400 validation errors, 429 rate limit retry durations, and 500/0 network/server failures.

2. **Email Verification Flow (`apps/web/src/app/verify-email/page.tsx` + `page.spec.tsx`)**:
   - Wrapped search parameter consumption in React `<Suspense>` boundary to guarantee static prerendering support under Next.js App Router.
   - Reads `?token=` parameter: if missing or whitespace-only, immediately transitions to invalid state without issuing backend API requests.
   - Single-use token CAS protection: uses `useRef(false)` to prevent duplicate verification requests caused by React 18/StrictMode double-mount lifecycles.
   - Three distinct lifecycle states:
     - `verifying`: Loading spinner and status description.
     - `success`: "Email verified successfully." with a prominent "Sign in" CTA link to `/login`.
     - `invalid`: "Invalid or expired verification token" with an inline resend form.
   - Resend form in invalid state calls `POST /api/v1/auth/resend-verification` with generic success notice and rate-limit error mapping.
   - Strict Security: verification token is never rendered in DOM text, attributes, or console logs.

3. **Login Navigation Integration (`apps/web/src/app/login/page.tsx` + `page.spec.tsx`)**:
   - Added registration link under the sign-in form: "Don't have an account? Create one" linking directly to `/signup`.
   - Preserved all existing redirect, rate limiting, and session behavior.

4. **Minimal API Update & Session Type Alignment**:
   - `apps/api/src/modules/auth/auth.controller.ts`: Explicitly ensured `emailVerified: Boolean(user.emailVerified)` is returned in `GET /api/v1/auth/me`.
   - `apps/web/src/lib/query/auth.ts`: Added `emailVerified: boolean` to `User` interface.
   - `apps/api/src/modules/auth/auth.controller.spec.ts`: Added unit tests asserting `emailVerified: boolean` is returned on `/me` while `hashedPassword` is omitted.

5. **Dashboard Unverified Notification Banner (`apps/web/src/app/dashboard/page.tsx` + `page.spec.tsx`)**:
   - When authenticated user has `emailVerified === false`, renders an amber notification banner: "Verify your email to unlock your workspace".
   - Includes inline resend form with prefilled email, submit action to `POST /api/v1/auth/resend-verification`, generic success feedback, and rate limit handling.

### 3. Verification & Test Evidence

- **Web Unit Test Suite (`pnpm --filter @agency-os/web test`)**: 12/12 test files passed, 143/143 tests passed.
  - `src/app/signup/page.spec.tsx` (10/10 PASS): form rendering, client validation, payload delivery, honest trial copy, anti-enumeration identical response, resend flow, and error states.
  - `src/app/verify-email/page.spec.tsx` (6/6 PASS): missing/empty token rejection without API calls, successful token verification, 400 rejection handling, StrictMode CAS double-invocation prevention, and token redaction from DOM.
  - `src/app/dashboard/page.spec.tsx` (2/2 PASS): banner suppression when verified, banner presentation and inline resend execution when unverified.
  - `src/app/login/page.spec.tsx` (17/17 PASS): signup link presence and redirect integrity.
- **API Unit Test Suite (`pnpm --filter @agency-os/api test`)**: 35/35 test files passed, 435/435 tests passed.
  - `src/modules/auth/auth.controller.spec.ts` (26/26 PASS): verified explicit `emailVerified: boolean` propagation and password exclusion in `getMe`.
- **Monorepo Code Quality**:
  - `pnpm turbo run lint typecheck`: 15/15 tasks passed, 0 errors.
  - `pnpm turbo run build`: 7/7 tasks passed, with `/login`, `/signup`, and `/verify-email` statically prerendered.

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
2. **Next Steps**:
   - Submit PR #60 (`feat/signup-onboarding-ui`) targeting `main`.
   - Independent Muse review before any merge. Do not call merge-ready.


---

## 49. AuthGuard Fix: Make /signup and /verify-email Public Routes (Branch `fix/auth-guard-public-routes` — PR #61) — MERGED

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #61, merged 2026-11-07, merge commit [`85deaf0dbfdce358b1498ba4fc96141b20a63c5e`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/85deaf0dbfdce358b1498ba4fc96141b20a63c5e), approved head `ee6839b4bc428ecbe1ba8eff58373e2ad0da0d7f`)
- **Branch**: `fix/auth-guard-public-routes`
- **Base Commit**: `18d2d0404cf81696d191c2f1b3eb86b18c6c984a` (`main`, post-PR #60 merge)
- **Reviewer**: Muse (APPROVED at head `ee6839b4bc428ecbe1ba8eff58373e2ad0da0d7f`)
- **Live Deployment Release Gate**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
- **Next Milestone**: TBD
- **Problem & Root Cause**:
  - `apps/web/src/components/auth-guard.tsx` previously used a single boolean check: `const isLoginPage = pathname === '/login'`.
  - Any logged-out visitor on any route other than `/login` was bounced with `router.replace('/login?redirect=' + encodeURIComponent(pathname))` and the page's children were not rendered (`return null`).
  - Observed live evidence:
    1. Clicking "Create one" on `/login` navigated to `/signup`, but the guard bounced the user to `/login?redirect=%2Fsignup`. As a result, the signup page was completely unreachable for logged-out users.
    2. Clicking a verification link from email (`/verify-email?token=...`) while logged out bounced the visitor to `/login`, dropping the query string (`?token=...` lost). Upon signing in and redirecting back to `/verify-email`, the user was presented with "Invalid or expired verification token" due to the missing token.

### 2. Scope & Implementation Details

1. **Exact-Match Public Route Definition (`apps/web/src/components/auth-guard.tsx`)**:
   - Defined `const PUBLIC_ROUTES = ['/login', '/signup', '/verify-email'];` at the top of the file.
   - Evaluated route membership via `const isPublicRoute = PUBLIC_ROUTES.includes(pathname);` using exact match only (no prefix matching, no wildcards).
   - Maintained `const isLoginPage = pathname === '/login';` for authenticated redirect handling.

2. **Unauthenticated Access Control**:
   - Replaced `isLoginPage` with `isPublicRoute` in the unauthenticated bounce effect and render guard:
     - When unauthenticated (`isError`) on a public route (`isPublicRoute`), children render normally with zero redirect (`router.replace` never called).
     - When unauthenticated (`isError`) on a protected route (`!isPublicRoute`), user is bounced to `/login?redirect=${encodeURIComponent(pathname)}` and children do not render (`return null`).

3. **Authenticated Access Control**:
   - Kept authenticated user redirect solely for `/login` (`isLoginPage = pathname === '/login'`): redirects to `/${membership.workspaceId}/analytics` (or `/dashboard` if no memberships) and suppresses children (`return null`).
   - Authenticated users on `/signup` or `/verify-email` are NOT redirected; pages render normally without interference (e.g., users registering an additional account or verifying an email from another session).

4. **Preserved Existing Architecture**:
   - Preserved `useQuery({ ...authQueries.me(), retry: false })`, loading spinner indicator, and redirect target structure (`/login?redirect=...`).

5. **Unit Test Suite (`apps/web/src/components/auth-guard.spec.tsx`)**:
   - Logged-out visit on `/signup`: children render, `router.replace` never called.
   - Logged-out visit on `/verify-email`: children render, `router.replace` never called.
   - Logged-out visit on `/login`: children render, `router.replace` never called.
   - Logged-out visit on protected routes (`/dashboard`, `/ws-123/analytics`): `router.replace` called with redirect parameter, children do not render.
   - Logged-in visit on `/login`: redirects to workspace analytics with memberships, redirects to `/dashboard` without memberships, children suppressed.
   - Logged-in visit on `/signup`: no redirect, children render.
   - Logged-in visit on `/verify-email`: no redirect, children render.
   - Logged-in visit on protected routes: renders children.
   - Loading state: renders loading indicator and suppresses children.

### 3. Verification & Test Evidence

- **Web Unit Tests (`pnpm --filter @agency-os/web test`)**: 13/13 test files passed, 155/155 tests passed.
  - `src/components/auth-guard.spec.tsx`: 12/12 PASS.
- **Monorepo Code Quality**:
  - `pnpm turbo run lint typecheck`: 15/15 tasks passed, 0 errors.
  - `pnpm turbo run build`: 7/7 tasks passed.

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
2. **Next Steps**:
   - Submit PR #61 (`fix/auth-guard-public-routes`) targeting `main`.
   - Independent Muse review before any merge. Do not call merge-ready.
   - Next Milestone: TBD.


---

## 50. Self-Serve Password Reset Flow (Branch feat/password-reset — PR #63) — MERGED

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #63, merged 2026-11-10, merge commit [`1b40954c939409c03ad11a7282ab49304b9460d1`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/1b40954c939409c03ad11a7282ab49304b9460d1), approved head `d136dd3587738fe7f8e9c3a7bf21f83f2e16af42`)
- **Branch**: `feat/password-reset`
- **Base Commit**: `430972432dee797d582e426e4b1e33e2d0749c5e` (`main`, includes PR #62 auth readiness audit)
- **Reviewer**: Muse (APPROVED at head `d136dd3587738fe7f8e9c3a7bf21f83f2e16af42`)
- **Live Deployment Release Gate**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
- **Next Milestone**: TBD
- **Problem & Motivation**:
  - Identified as P0 #1 in `docs/auth-production-readiness-report.md`: prior to this PR, there was no password-reset mechanism anywhere in the codebase.
  - A user who forgot their password was permanently locked out unless an operator manually intervened in the database.
  - This feature closes the P0 #1 gap by delivering an end-to-end self-serve password reset flow: requesting a reset link via email, consuming a single-use cryptographically secure token, setting a new Argon2-hashed password, incrementing the user security epoch, revoking all existing sessions, and redirecting to login.

### 2. Scope & Implementation Details

1. **Database & Migration (`packages/database`)**:
   - Added `PasswordResetToken` model to `prisma/schema.prisma` mirroring `EmailVerificationToken`:
     - Fields: `id` (UUID @id), `userId` (String @db.Uuid), `tokenHash` (String @unique), `expiresAt` (DateTime), `consumedAt` (DateTime?), `createdAt` (DateTime @default(now())).
     - Foreign key relation: `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`.
     - Indexes: `@@index([userId])` and `@@index([expiresAt])`.
   - Added relation field `passwordResetTokens PasswordResetToken[]` to `User` model.
   - Generated Prisma migration `20261109000000_add_password_reset_token`.
   - Added `AUTH_PASSWORD_RESET_REQUESTED` and `AUTH_PASSWORD_RESET_SUCCEEDED` to `AuditAction` enum.
   - Implemented `PasswordResetTokenRepository`:
     - `hashToken(rawToken)`: SHA-256 hex digest.
     - `generateRawToken()`: 32 cryptographically secure random bytes via `crypto.randomBytes(32).toString('hex')` (64 hex characters).
     - `createToken(userId, rawToken, expiresAt, tx?)`: creates token record with given raw token and expiry.
     - `invalidateActiveUserTokens(userId, tx?)`: sets consumedAt = NOW() on unconsumed tokens (where clause is {userId, consumedAt: null} — no expiry condition).
     - `findByTokenHash(tokenHash, tx?)`: returns the token row only (plain findUnique, no user join).
     - `consumeToken(rawToken, tx?)`: atomic CAS consumption (`consumedAt IS NULL AND expiresAt > NOW()`). Returns `{ token, user }`. Does NOT modify `emailVerified`.
   - Exported `PasswordResetTokenRepository` in `packages/database/index.ts`.

2. **Core Module Integration (`apps/api`)**:
   - Registered and exported `PasswordResetTokenRepository` in `CoreModule` (`apps/api/src/modules/core/core.module.ts`).

3. **Email Delivery Service (`apps/api`)**:
   - Added `sendPasswordResetEmail(toEmail: string, rawToken: string): Promise<void>` to `EmailDeliveryService` interface.
   - Implemented across all providers:
     - `MockEmailDeliveryService`: records to `sentPasswordResetEmails` array for assertions, logs simulation notice with redacted token.
     - `NoopEmailDeliveryService`: logs warning that password reset email delivery was skipped (no provider configured).
     - `ResendEmailDeliveryService`: constructs email subject `"Reset your Agency OS password"` and body containing reset link `${frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`. Dispatches via Resend REST API, redacting token from logs, and throws on non-2xx status.

4. **API DTOs, Service & Controller (`apps/api`)**:
   - DTOs:
     - `ForgotPasswordDto`: `email` (`@IsEmail()`, `@IsNotEmpty()`, trimmed and lowercased).
     - `ResetPasswordDto`: `token` (`@IsString()`, `@MinLength(32)`, `@MaxLength(128)`), `newPassword` (`@IsString()`, `@MinLength(8)`, `@MaxLength(128)`).
   - `AuthService`:
     - `forgotPassword(email, requestId?)`: normalizes email, checks user existence. If not found, executes dummy Argon2 work to match timing, logs `AUTH_PASSWORD_RESET_REQUESTED` without revealing failure, and returns generic message. If user found: invalidates active tokens, creates new token (1h expiry), dispatches email, logs `AUTH_PASSWORD_RESET_REQUESTED`, and returns generic message: `"If an account with that email exists, a password reset link has been sent."`
     - `resetPassword(token, newPassword, requestId?)`: consumes token atomically via `PasswordResetTokenRepository.consumeToken`. Rejects invalid/expired/consumed tokens with generic 400 Bad Request (`"Invalid or expired reset link"`). Verifies new password is not identical to current password (Argon2 verify); rejects with 400 (`"New password cannot be the same as the current password"`). Hashes new password with Argon2, updates password and increments security epoch atomically via `UserRepository.updatePasswordAndIncrementEpoch`, revokes all active Redis sessions via AuthService's own this.revokeAllUserSessions(userId) (method defined in auth.service.ts — there is no SessionService), logs `AUTH_PASSWORD_RESET_SUCCEEDED`, and returns `{ message: "Password reset successfully." }`.
   - `AuthController`:
     - `POST /api/v1/auth/forgot-password`: public endpoint, throttled under `RateLimitPolicies.auth`, validates input, enforces HTTPS in production, returns HTTP 200.
     - `POST /api/v1/auth/reset-password`: public endpoint, throttled under `RateLimitPolicies.auth`, validates input, enforces HTTPS in production, returns HTTP 200.

5. **Frontend Public Routes & Pages (`apps/web`)**:
   - `AuthGuard` (`apps/web/src/components/auth-guard.tsx`):
     - Added `'/forgot-password'` and `'/reset-password'` to `PUBLIC_ROUTES`: `['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password']`.
     - Logged-out users can access `/forgot-password` and `/reset-password` without bounce to `/login`.
   - Login Page (`apps/web/src/app/login/page.tsx`):
     - Added "Forgot password?" link in the label row beside 'Password', above the input field (per apps/web/src/app/login/page.tsx) pointing to `/forgot-password`.
   - Forgot Password Page (`apps/web/src/app/forgot-password/page.tsx`):
     - Email input with client-side pattern validation, `noValidate` on form, submit to `auth/forgot-password`.
     - Generic success state ("Check your email — If an account exists...") regardless of backend response body.
     - Comprehensive error handling for 429 rate limit (retry-after seconds) and generic server errors.
     - "Back to sign in" navigation link.
   - Reset Password Page (`apps/web/src/app/reset-password/page.tsx`):
     - Wrapped in React `<Suspense>` boundary for Next.js App Router static prerendering compatibility.
     - Validates `token` query param presence on mount; missing token immediately displays invalid/expired state with link back to `/forgot-password`.
     - Password & Confirm Password fields with client validation (8–128 characters, match verification).
     - StrictMode double-submit ref guard (`useRef(false)`).
     - Success screen with confirmation message and primary "Sign in" CTA link to `/login`.
     - Error banner on submission failure (e.g. expired token, same password rejection, rate limit retry-after).

### 3. Verification & Test Evidence

- **Database Repository Tests (`packages/database`)**:
  - `PasswordResetTokenRepository.spec.ts`: 8/8 tests PASS (token creation with 1h expiry, SHA-256 hash lookup, single-use atomic CAS consumption, rejection of expired/consumed tokens, invalidation of prior active tokens, isolation from `emailVerified`).
- **API Unit Tests (`apps/api`)**:
  - 35/35 test files passed, 450/450 tests passed.
  - `email-delivery.service.spec.ts`: 9/9 PASS (Resend dispatch for verification and reset emails, missing API key exception, non-2xx failure, Mock delivery simulation and recording, Noop fallback).
  - `auth.service.spec.ts`: 30/30 PASS (forgotPassword anti-enumeration timing and dummy work, email dispatch, resetPassword CAS token consumption, same-password rejection, Argon2 hashing, epoch incrementation, revokeAllUserSessions, audit logging).
  - `auth.controller.spec.ts`: 32/32 PASS (forgot-password and reset-password input validation, HTTP 200 responses, HTTPS production enforcement).
- **API E2E Tests (`apps/api/test/auth.e2e-spec.ts`)**:
  - 6/6 test suites passed, 121/121 tests passed.
  - New `Self-Serve Password Reset Flow (e2e)` suite (3/3 PASS):
    1. Full lifecycle: reset-password returns 200; login with the new password returns 200; login with the old password returns 401.
    2. Token replay attack rejected with HTTP 400 Bad Request.
    3. Same password rejection with HTTP 400 Bad Request.
- **Web Unit Tests (`apps/web`)**:
  - 15/15 test files passed, 174/174 tests passed.
  - `auth-guard.spec.tsx` (16/16 PASS): logged-out access to `/forgot-password` and `/reset-password` renders without bounce; logged-in access renders without bounce.
  - `login/page.spec.tsx` (18/18 PASS): "Forgot password?" link verified with `href="/forgot-password"`.
  - `forgot-password/page.spec.tsx` (6/6 PASS): form rendering, email validation, submit to API, generic success state, rate limit error handling, back to login link.
  - `reset-password/page.spec.tsx` (8/8 PASS): missing token state, password mismatch error, client length validation, submit payload, success screen with login link, API 400 error banner, rate limit mapping.
- **Monorepo Quality & Build Checks**:
  - `pnpm turbo run lint typecheck`: 15/15 tasks passed, 0 errors.
  - `pnpm turbo run test`: 10/10 tasks passed across all packages.
  - `pnpm turbo run build`: 7/7 tasks passed; `/forgot-password` and `/reset-password` statically prerendered.
- **CI Quality Gates**:
  - 6/6 green (GitGuardian incident 39855557 closed as test credential — flagged value was the 'mock-new-password-123!' test fixture in the mocked controller spec, no real credential).

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
2. **Next Steps**:
   - Open Pull Request targeting `main`.
   - Independent Muse review required before any merge. Do not call merge-ready.
   - Next Milestone: TBD.

---

## 51. Frontend API Error Shape Normalization (Branch fix/frontend-error-shape — PR #64) — MERGED

### 1. Summary & Motivation

- **Status**: **MERGED** (PR #64, merged 2026-11-10, merge commit [`f484b0cd875851bf5c1f40bdc441a8f8144f81d6`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/f484b0cd875851bf5c1f40bdc441a8f8144f81d6), approved head `b6190a5f1d768a301bc8bb5533a20d8d0b43c578`)
- **Branch**: `fix/frontend-error-shape`
- **Base Commit**: `1b40954c939409c03ad11a7282ab49304b9460d1` (`main`, PR #63 password-reset merge)
- **Reviewer**: Muse (APPROVED at head `b6190a5f1d768a301bc8bb5533a20d8d0b43c578`)
- **Live Deployment Release Gate**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
- **Next Milestone**: TBD
- **Problem & Root Cause**:
  - The NestJS `AllExceptionsFilter` (`apps/api/src/filters/all-exceptions.filter.ts`) serializes all API errors under a nested envelope: `{ error: { code, message, requestId } }`.
  - In `apps/web/src/lib/api/client.ts`, the `!response.ok` branch previously built `ApiError` with `(errorData)?.message`.
  - For the nested envelope, `(errorData)?.message` evaluated to `undefined`, causing `err.message` to fall back to `response.statusText` (e.g. `"Bad Request"`, `"Conflict"`).
  - Consequently, every page/component that attempted to read `err.data.message` saw `undefined` and rendered a generic fallback (e.g., 'An error occurred during signup.', 'An error occurred during login.', 'Unable to send verification email. Please try again.').
  - This issue affected signup submission, login, verify-email resend, and dashboard resend. PR #63 introduced pages that worked around it via nested-first digging (`err.data?.error?.message ?? err.data?.message`).
  - **Resolution**: Fix the root cause once at the client boundary in `apps/web/src/lib/api/client.ts` rather than patching pages one by one, while eliminating redundant workarounds across all consuming pages.

### 2. Scope & Implementation Details

1. **API Client Normalization (`apps/web/src/lib/api/client.ts`)**:
   - In `!response.ok` branch, extract error message nested-first:
     - Check `errorData.error?.message`, fallback to `errorData.message`.
     - If the extracted message is an array (e.g., NestJS `ValidationPipe` returning `{ message: string[] }` inside the exception envelope), join array elements with `', '`.
     - Fall back to `response.statusText` if present and non-empty, otherwise `'API Error'`.
   - Pass the resolved message as the 3rd argument to `new ApiError(response.status, errorData, message, response.headers)`.
   - In `ApiError` constructor, also provide fallback resolution from `data` when `message` is omitted, guaranteeing `err.message` is always a clean string.
   - Raw `errorData` is preserved untouched on `err.data` for callers requiring specific fields (e.g., error codes or requestId).
   - Zero changes made to backend APIs, DTOs, filters, or database schemas.

2. **Frontend Page Error Consumption Simplified (`apps/web`)**:
   - **Login Page** (`apps/web/src/app/login/page.tsx`):
     - Displays `err.message || 'An error occurred during login.'` for 4xx responses.
     - Preserves status branches: 429 rate limit with `retry-after` header, >=500 server error, and 0 network error.
   - **Signup Page** (`apps/web/src/app/signup/page.tsx`):
     - Form submission error displays `err.message || 'An error occurred during signup.'`.
     - Inline check-email resend error displays `err.message || 'Unable to send verification email. Please try again.'`.
     - Preserves status branches: 429, >=500, 0.
   - **Verify Email Page** (`apps/web/src/app/verify-email/page.tsx`):
     - Inline resend form error displays `err.message || 'Unable to send verification email. Please try again.'`.
     - Preserves status branches: 429, >=500, 0.
   - **Dashboard Page** (`apps/web/src/app/dashboard/page.tsx`):
     - Verification banner resend error displays `err.message || 'Unable to send verification email. Please try again.'`.
     - Preserves status branches: 429, >=500, 0.
   - **Forgot Password Page** (`apps/web/src/app/forgot-password/page.tsx`):
     - Simplified redundant nested digging (`err.data?.error?.message ?? err.data?.message`) to normalized `err.message`.
     - Preserves status branches: 429, >=500, 0.
   - **Reset Password Page** (`apps/web/src/app/reset-password/page.tsx`):
     - Simplified redundant nested digging to normalized `err.message`.
     - Preserves status branches: 429, >=500, 0.
   - **Billing Page** (`apps/web/src/app/[workspaceId]/billing/page.tsx`):
     - `handleSubscribe` and `handleCancelSubscription` now read `errorObj?.message` directly.

### 3. Verification & Test Evidence

- **New Unit Tests (`apps/web/src/lib/api/client.spec.ts`)**:
  - 8/8 tests PASS:
    1. Extracts nested string error message (`{ error: { message: '...' } }`).
    2. Joins nested array validation messages with comma (`{ error: { message: ['...', '...'] } }`).
    3. Extracts top-level string message (`{ message: '...' }`).
    4. Joins top-level array messages with comma (`{ message: ['...', '...'] }`).
    5. Falls back to `response.statusText` when body is non-object.
    6. Falls back to `response.statusText` when body is invalid non-JSON text.
    7. Creates status 0 ApiError on network/fetch failure.
    8. Preserves raw unmodified `errorData` on `err.data`.
- **Page Unit Tests Updated & Verified (`apps/web`)**:
  - `apps/web/src/app/login/page.spec.tsx` (23/23 PASS): asserts specific 400 validation error message from nested real shape, 401, 429, 500, and 0 network error.
  - `apps/web/src/app/signup/page.spec.tsx` (10/10 PASS): asserts 400 validation error with nested real shape renders specific message, 429, and 500.
  - `apps/web/src/app/verify-email/page.spec.tsx` (9/9 PASS): asserts 400 verification error with nested shape, 400 resend error with nested shape, 429, and 500.
  - `apps/web/src/app/dashboard/page.spec.tsx` (5/5 PASS): asserts 400 resend error with nested shape, 429, and 500.
  - `apps/web/src/app/forgot-password/page.spec.tsx` (6/6 PASS): verified clean pass.
  - `apps/web/src/app/reset-password/page.spec.tsx` (8/8 PASS): verified clean pass.
  - `apps/web/src/app/[workspaceId]/billing/page.spec.tsx` (9/9 PASS): asserts specific 400 error message from nested real shape for subscribe failure and cancel failure.
  - Total `apps/web` test suite: 16/16 test files passed, 195/195 tests passed.
- **Monorepo Quality & Build Checks**:
  - `pnpm turbo run lint typecheck`: 15/15 tasks passed, 0 errors.
  - `pnpm turbo run test`: 10/10 tasks passed across all packages.
  - `pnpm turbo run build`: 7/7 tasks passed; all static routes generated successfully.
- **CI Quality Gates**:
  - 6/6 verified green (Tests, API E2E, Application Builds, Code Quality, Docker Build & Smoke, GitGuardian Security Checks).

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
2. **Next Steps**:
   - PR #64 opened targeting `main`.
   - Independent Muse review required before any merge. Do not call merge-ready.
   - Next Milestone: TBD.

## 52. Unverified-User Routing Trap Remediation (Branch fix/unverified-user-routing — PR #65) — MERGED

- **Status**: **MERGED** (PR #65, merged 2026-11-10, merge commit [`eb9b93494df1df95b5a6dd53d22715f79ec75670`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/eb9b93494df1df95b5a6dd53d22715f79ec75670), approved head `c53a9762a42d11cdec653f95cc8f587c42f01762`)

### 1. Root Cause & Real File:Line Citations

- **Login Redirect Gap (`apps/web/src/app/login/page.tsx:35-44`)**:
  - After a successful login and querying `authQueries.me()`, `LoginPage` evaluated `getValidRedirect(searchParams.get('redirect'))` and `authData.memberships.length > 0` before checking `authData.user.emailVerified`.
  - Because signup automatically creates an initial workspace membership, an unverified user was immediately pushed to `/${authData.memberships[0].workspaceId}/analytics`.
- **AuthGuard Access Gap (`apps/web/src/components/auth-guard.tsx:34-41`)**:
  - In the `authData && isLoginPage` branch, authenticated visitors hitting `/login` were redirected to `/${authData.memberships[0].workspaceId}/analytics` if `authData.memberships.length > 0`, lacking an `emailVerified` pre-check.
- **Backend Enforcement & Dead-End (`apps/api/src/modules/auth/guards/workspace.guard.ts:23-27`)**:
  - `WorkspaceGuard` enforces `if (!user.emailVerified) throw new ForbiddenException('Email verification required to access workspaces')`.
  - When an unverified user was routed to workspace analytics, every workspace API query was rejected with HTTP 403, rendering the generic `'Access Denied'` block (`apps/web/src/app/[workspaceId]/analytics/page.tsx:169-175`) with no explanation or resend action.
- **Pre-existing Working Resend Banner (`apps/web/src/app/dashboard/page.tsx:68-111`)**:
  - The proper destination for unverified accounts is `/dashboard`, where an amber banner displays resend functionality posting `auth/resend-verification`.

### 2. Three Fix Points & Architecture

1. **Login Page Priority Check (`apps/web/src/app/login/page.tsx`)**:
   - Immediately following `const authData = await queryClient.fetchQuery(authQueries.me())`, added `if (!authData.user.emailVerified)` as the first condition, routing unverified users directly to `router.push('/dashboard')`.
   - The redirect query parameter is intentionally ignored for unverified users; after verification and subsequent sign-in, normal navigation resumes.
   - For verified users (`authData.user.emailVerified === true`), existing redirect priority is preserved (`validRedirect`, then `authData.memberships[0].workspaceId/analytics`, then `/dashboard`).
2. **AuthGuard Page Access Check (`apps/web/src/components/auth-guard.tsx`)**:
   - In the `authData && isLoginPage` branch, added `if (!authData.user.emailVerified)` check routing unverified users to `router.replace('/dashboard')`.
   - Verified users continue through existing membership-aware routing (`/${authData.memberships[0].workspaceId}/analytics` or `/dashboard`).
3. **Workspace Dashboard Shell Verification Gate (`apps/web/src/components/dashboard-shell.tsx`)**:
   - `DashboardShell` wraps all workspace routes under `app/[workspaceId]/layout.tsx`.
   - Immediately following the workspace validity early-return check (`isLoading || !authData || !isValidWorkspace || !currentMembership`), added `if (authData.user.emailVerified === false)` to render a full-screen verification gate.
   - For unverified users with valid memberships, `isValidWorkspace` evaluates to true, intercepting the request and rendering the gate instead of sidebar navigation, top header, or child route components.
   - **Gate Content & Exact Quoted Fallbacks**:
     - Alert banner: `role="alert"` styled with amber theme (`rounded-md bg-amber-50 border border-amber-200 p-4`).
     - Heading: `'Verify your email to unlock your workspace'`.
     - Copy: `'Email verification is required to access workspace features. Please check your inbox for a verification link.'`.
     - Button: `'Resend verification email'` (displays `'Sending...'` when disabled and pending).
     - Success notice: `'If an unverified account exists for this email, a verification link has been sent.'`.
     - Link: `'Go to Dashboard'` pointing to `/dashboard`.
     - Error handling (mirroring dashboard page):
       - HTTP 429 with `retry-after` header: `` `Too many attempts. Please try again in ${seconds} seconds.` ``.
       - HTTP 429 without parseable seconds: `'Too many attempts. Please try again in a few minutes.'`.
       - HTTP >= 500: `'Something went wrong. Please try again.'`.
       - HTTP 0 network error: `'Unable to reach the server. Please try again.'`.
       - API error fallback: `err.message || 'Unable to send verification email. Please try again.'`.
       - Non-ApiError fallback: `'Unable to reach the server. Please try again.'`.
     - One-click trigger: posts `auth/resend-verification` with `{ email: authData.user.email }` without requiring manual email input.
4. **Untouched Per-Page 403 Blocks**:
   - The per-page 403 `'Access Denied'` blocks in `analytics/page.tsx`, `analytics/[accountId]/page.tsx`, `accounts/page.tsx`, and `billing/page.tsx` were intentionally left untouched.
   - With `DashboardShell` intercepting unverified users across all workspace layouts, these blocks are unreachable for unverified users and remain solely for genuine workspace permission and non-membership 403 authorization failures.
   - No backend changes were made (`WorkspaceGuard` and `auth.service` remain untouched).

### 3. Verification & Test Evidence

- **Verified Web Test Counts (counted via `it()` and `test()` blocks in source)**:
  - `apps/web/src/app/login/page.spec.tsx`: 17 `it()` blocks in source (1 in a 9-item iteration table + 16 individual = 25 total executed tests, 25/25 PASS). Includes 2 new unverified user redirect tests (`currentSearchParamRedirect = null` and `currentSearchParamRedirect = '/ws-1/analytics'`). Mock updated with `emailVerified: true` default.
  - `apps/web/src/components/auth-guard.spec.tsx`: 17 `it()` blocks in source (17/17 PASS). Includes 1 new unverified user redirect test asserting `router.replace('/dashboard')`. Mock updated with `emailVerified: true` default.
  - `apps/web/src/components/dashboard-shell.spec.tsx` (NEW): 4 `it()` blocks in source (4/4 PASS):
    1. Verified user with valid workspace membership renders children and sidebar nav.
    2. Unverified user renders full-screen verification gate, suppressing children and sidebar nav.
    3. Click `'Resend verification email'` calls `api.post('auth/resend-verification', { email: 'test@example.com' })` exactly once and displays success notice.
    4. HTTP 429 with retry-after header displays rate-limit retry seconds message.
  - Total `apps/web` test suite: 17/17 test files passed, 202/202 tests passed.
- **Monorepo Quality & Build Checks**:
  - `pnpm turbo run lint typecheck`: 15/15 tasks passed, 0 errors.
  - `pnpm turbo run test`: 10/10 tasks passed across all packages.
  - `pnpm turbo run build`: 7/7 tasks passed; Next.js 16.3.1 static and dynamic pages generated successfully.
- **CI Quality Gates**:
  - 6/6 verified green (Tests, API E2E, Application Builds, Code Quality, Docker Build & Smoke, GitGuardian Security Checks).

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
2. **Next Steps**:
   - Open PR #65 targeting `main`.
   - Independent Muse review required before any merge. Do not call merge-ready.
   - Do NOT merge on this prompt alone.

## 53. Legal Pages & Terms/Privacy Signup Consent (Branch feat/terms-consent — PR #66) — MERGED

- **Status**: **MERGED** (PR #66, merged 2026-11-11, merge commit [`a36e1f83f652b97b7dadda2566fec6ee7e8c7aba`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/a36e1f83f652b97b7dadda2566fec6ee7e8c7aba), approved head `2d98f67592f37472d47ede5736f79263a51d4a47`)

### 1. Scope, Routes & Content Files

- **Public Legal Routes (`apps/web`)**:
  - `/terms` (`apps/web/src/app/terms/page.tsx`): renders `apps/web/src/content/legal/terms.md` verbatim.
  - `/privacy` (`apps/web/src/app/privacy/page.tsx`): renders `apps/web/src/content/legal/privacy.md` verbatim.
  - `/refund-cancellation` (`apps/web/src/app/refund-cancellation/page.tsx`): renders `apps/web/src/content/legal/refund-cancellation.md` verbatim.
- **Content Files Written (`apps/web/src/content/legal/`)**:
  - `terms.md`: Verbatim draft terms of service document including operator details, plans and founding lock pricing, payment mandates, cancellation grace period, acceptable use, and grievance officer.
  - `privacy.md`: Verbatim draft privacy policy document covering DPDP Act 2023 / SPDI 2011 compliance, Data Fiduciary vs Data Processor roles, data categories, security, 72-hour breach reporting, 30-day grace retention, grievance redressal, and platform-specific disclosures (Meta, LinkedIn, YouTube).
  - `refund-cancellation.md`: Verbatim draft refund and cancellation policy specifying the 14-day free trial (no card required), 7-day money-back guarantee on first paid payment, non-refundable renewals, and full refunds for duplicate/post-cancellation charges to original payment method within 5–7 business days.
- **AuthGuard Public Routes Access (`apps/web/src/components/auth-guard.tsx:11-20`)**:
  - Added `'/terms'`, `'/privacy'`, and `'/refund-cancellation'` to `PUBLIC_ROUTES`.
  - Unauthenticated visitors can view all legal documents directly without being redirected to `/login`.
- **Structured Semantic JSX Rendering Approach**:
  - Rendered with semantic JSX elements (`<section>`, `<h2>`, `<p>`, `<table>`, `<ul>`, `<ol>`, `<code>`) and Tailwind typography classes (`max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow space-y-6 text-gray-800 leading-relaxed`).
  - Avoided installing external markdown rendering libraries (`react-markdown`, `remark`, `mdx`) to preserve minimal dependency footprint.
- **Verbatim DRAFT Disclaimers & Bracketed Placeholders**:
  - Rendered amber draft alert banner on all three pages:
    - Status: `DRAFT` prepared 2026-11-10, updated 2026-11-11. Not legal advice; lawyer review required before publication.
    - Operator: Gadmale Technologies, sole proprietorship, Maharashtra, India. Contact: `agadmale335@gmail.com`. Address: `Shihu, Tal-Pen, Dist-Raigad, Maharashtra, 402106, India`.
  - Every bracketed note preserved verbatim without premature cleanup or guessing: `[TO CONFIRM]`, `[LAWYER TO CONFIRM]`, `[CA TO CONFIRM]`, `[GRIEVANCE OFFICER]`, `[COURT CITY]`, `[GSTIN]`, `[EFFECTIVE DATE]`, `[LAST UPDATED]`, and `[BRACKETS]`.

### 2. Consent Enforcement & Schema Architecture

- **Web Signup Form Consent (`apps/web/src/app/signup/page.tsx`)**:
  - Checkbox added directly above submit button:
    - Checkbox element: `<input type="checkbox" id="termsAccepted" name="termsAccepted" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />`.
    - Label text: `'I agree to the '` with links `<Link href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link>` and `' and '` `<Link href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>`.
  - Client-side validation:
    - If `!termsAccepted`, form prevents submission and sets `error`: `'You must accept the Terms of Service and Privacy Policy to create an account.'`.
  - Payload submission:
    - Sends `{ email, password, organizationName, workspaceName, termsAccepted: true }` to `api.post('auth/signup', ...)`.
- **API Signup DTO (`apps/api/src/modules/auth/dto/signup.dto.ts`)**:
  - Added field:
    ```typescript
    @IsDefined()
    @IsBoolean()
    @Equals(true, {
      message: 'You must accept the Terms of Service and Privacy Policy',
    })
    termsAccepted!: boolean;
    ```
- **Database Schema & Migration (`packages/database`)**:
  - Updated `User` model in `packages/database/prisma/schema.prisma` with nullable field `termsAcceptedAt DateTime?`.
  - Migration created: `packages/database/prisma/migrations/20261111000000_add_terms_accepted_at/migration.sql`:
    ```sql
    ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
    ```
- **Atomic Consent Recording (`UserRepository` & `AuthService`)**:
  - Updated `CreateUserWithTenantInput` in `packages/database/src/repositories/UserRepository.ts` to include optional `termsAcceptedAt?: Date | null`.
  - In `createWithTenantTransaction`, the field is included via the conditional spread `...(input.termsAcceptedAt !== undefined && { termsAcceptedAt: input.termsAcceptedAt })` inside the `tx.user.create` data object, so the column is only set when a value was passed.
  - In `apps/api/src/modules/auth/auth.service.ts`: passes `termsAcceptedAt: new Date()` in `this.userRepository.createWithTenantTransaction(...)`.
  - Atomic guarantee: User record, Organization, Workspace, OWNER WorkspaceMember, and `termsAcceptedAt` timestamp are written within a single database transaction (`this.prisma.$transaction(...)`). If any step fails, entire provisioning is rolled back.
  - Anti-enumeration protection: Duplicate email registrations terminate early with generic message `{ message: 'Registration request received.' }` without creating a user or recording false consent.

### 3. Verification & Test Evidence

- **Web Unit Tests (`apps/web`, 20/20 test files PASS, 213/213 tests PASS)**:
  - `apps/web/src/app/signup/page.spec.tsx` (13 tests PASS):
    - Rejection when terms checkbox is unchecked: asserts `'You must accept the Terms of Service and Privacy Policy to create an account.'` is displayed and no API call is made.
    - Checkbox toggle state changes.
    - Submission includes `termsAccepted: true` in API POST body.
    - Handles 400 validation error with specific API error message.
    - Handles 429 rate limit and 500 server error states.
  - `apps/web/src/components/auth-guard.spec.tsx` (20 tests PASS):
    - Confirms `PUBLIC_ROUTES` contains 8 routes: `['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password', '/terms', '/privacy', '/refund-cancellation']`.
    - Confirms unauthenticated users can access `/terms`, `/privacy`, and `/refund-cancellation` without redirection.
  - `apps/web/src/app/terms/page.spec.tsx` (3 tests PASS):
    - Asserts heading `'Agency OS — Terms of Service (DRAFT)'`.
    - Asserts DRAFT disclaimer banner with `agadmale335@gmail.com`.
    - Asserts Section 1 content.
  - `apps/web/src/app/privacy/page.spec.tsx` (1 test PASS):
    - Asserts heading `'Agency OS — Privacy Policy (DRAFT)'` and Data Fiduciary role text.
  - `apps/web/src/app/refund-cancellation/page.spec.tsx` (1 test PASS):
    - Asserts heading `'Agency OS — Refund & Cancellation Policy (DRAFT)'` and 7-day refund window text.
- **Backend Unit & E2E Tests (`apps/api`, 35/35 test files PASS, 453/453 tests PASS)**:
  - `apps/api/src/modules/auth/auth.service.spec.ts` (33 tests PASS):
    - Passes `termsAcceptedAt: expect.any(Date)` to `userRepository.createWithTenantTransaction`.
    - DTO validation asserts rejection when `termsAccepted` is missing or false.
  - `apps/api/src/modules/auth/auth.controller.spec.ts` (32 tests PASS):
    - Controller test fixtures supply `termsAccepted: true`.
  - `apps/api/test/auth.e2e-spec.ts`:
    - E2E tests send `termsAccepted: true` on signup.
    - Database verification: verifies `signedUpUser.termsAcceptedAt` is populated with a valid `Date`.
    - Negative validation tests: verifies 400 rejection with message `'You must accept the Terms of Service and Privacy Policy'` when `termsAccepted` is omitted or false.
- **Monorepo Quality & Build Checks**:
  - `pnpm turbo run lint typecheck`: 15/15 tasks passed, 0 errors.
  - `pnpm turbo run test`: tests passed across all packages.
  - `pnpm turbo run build`: 7/7 tasks passed; Next.js 16.3.1 static pages `/terms`, `/privacy`, and `/refund-cancellation` built successfully.
- **CI Quality Gates**:
  - 6/6 verified green (Tests, API E2E, Application Builds, Code Quality, Docker Build & Smoke, GitGuardian Security Checks).

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending lawyer review of DRAFT legal documents, placeholder resolution, external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
2. **Known Follow-Ups**:
   - Standalone DPDP plain-language consent notice UI (as separate modal/screen per DPDP Rules 2025).
   - Meta data-deletion-instructions public page and callback endpoint (required by Meta App Review).
   - Lawyer and CA verification of bracketed placeholders (`[COURT CITY]`, `[GSTIN]`, `[EFFECTIVE DATE]`, `[LAST UPDATED]`, SAC code 998314 vs 997331).
3. **Next Steps**:
   - Open PR #66 targeting `main`.
   - Independent Muse review required before any merge. Do not call merge-ready.
   - Do NOT merge on this prompt alone.

---

## 54. Phase A: Mutation Gaps Closed for Halted/Expired Tenants (2026-11-11) — MERGED

- **Status**: **MERGED** (PR #67, merged 2026-11-13, merge commit [`6977330dfd4132b6dcd66ba5d8a5f8e2b4c4a353`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/6977330dfd4132b6dcd66ba5d8a5f8e2b4c4a353), approved head `7a886eb9cd5b5d107c5be1afa8ae197783143415`)

### 1. Context & Objectives

- **Audit Origin**: Phase A item 5 from `docs/auth-production-readiness-report.md` ("Close Mutation Gaps for Halted/Expired Tenants", Size S).
- **Vulnerability Closed**: While publishing post endpoints were guarded with `WorkspaceWritableGuard`, media file uploads and OAuth account mutations lacked write-entitlement checks. Halted or expired workspaces could previously initiate and complete S3 media asset storage uploads, initiate new OAuth account connections, select discovery profiles to persist new `SocialAccount` records, and complete OAuth redirect callbacks to bind accounts.
- **Goal**: Apply `WorkspaceWritableGuard` and service-level write-entitlement checks to all state-mutating operations in Media and OAuth modules, enforce fail-closed denials for halted/expired workspaces, and preserve read operations and necessary account cleanup pathways.

### 2. Architecture & Implementation

#### A. Guard Placement & Module Wiring (Scopes 1 & 2)

- **Media Uploads (`apps/api/src/modules/media`)**:
  - `apps/api/src/modules/media/media.module.ts`:
    - Added `BillingModule` to `imports: [BillingModule]` (previously had no imports array).
  - `apps/api/src/modules/media/media.controller.ts`:
    - Added method-level `@UseGuards(WorkspaceWritableGuard)` on `POST 'uploads'` (`initiateUpload`, `posts.create`).
    - Added method-level `@UseGuards(WorkspaceWritableGuard)` on `POST ':mediaId/complete'` (`completeUpload`, `posts.create`).
    - Method-level placement ensures future read endpoints on this controller remain unguarded by default.
    - Preserved `MediaService` upload flow and presigned S3 URL generation without changes.
- **OAuth Connect & Discovery Select (`apps/api/src/modules/oauth`)**:
  - `apps/api/src/modules/oauth/oauth.module.ts`:
    - Added `BillingModule` to imports alongside `BullModule.registerQueue({ name: 'sync' })`.
  - `apps/api/src/modules/oauth/oauth.controller.ts`:
    - Added `WorkspaceWritableGuard` appended after `AuthGuard`, `WorkspaceGuard`, and `PermissionGuard` on `POST 'v1/workspaces/:workspaceId/oauth/:provider/connect'` (`connectProvider`, `accounts.connect`).
    - Added `WorkspaceWritableGuard` appended after `AuthGuard`, `WorkspaceGuard`, and `PermissionGuard` on `POST 'v1/workspaces/:workspaceId/oauth/discoveries/:discoveryId/select'` (`selectDiscoveryProfiles`, `accounts.connect`), closing the discovery selection mutation path that persists `SocialAccount` records from multi-profile sessions.

#### B. Service-Level Callback Enforcement (Scope 3)

- **Why Decorator Cannot Work on Callback**:
  - Route `GET 'v1/oauth/:provider/callback'` (`callbackProvider`) contains no `:workspaceId` route parameter; the workspace context is encapsulated in the single-use OAuth `state` query parameter.
  - `WorkspaceWritableGuard` reads `request.params?.workspaceId`. When `workspaceId` is missing, the guard returns `true` (fails open by design). Applying `@UseGuards(WorkspaceWritableGuard)` to the callback endpoint would be a silent no-op.
- **Service Insertion Point (`apps/api/src/modules/oauth/oauth.service.ts`)**:
  - Injected `EntitlementsService` (`private readonly entitlementsService: EntitlementsService`) into `OAuthService` constructor.
  - In `handleOAuthCallback`, immediately after line 316 `const { workspaceId, codeVerifier } = stateData;` (the earliest point where `workspaceId` is known after single-use state validation and consumption) and before line 321 `const credentials = await provider.exchangeAuthorizationCode({...})`:
    ```typescript
    await this.entitlementsService.assertWorkspaceWritable(workspaceId);
    ```
  - This single check covers both single-profile direct persistence and multi-profile discovery session persistence before any external authorization code exchange or database writes occur.
- **Honest Denial Surface & Single-Use State Consequence**:
  - In `OAuthController.callbackProvider`, when `entitlementsService.assertWorkspaceWritable` throws `ForbiddenException`, the controller's existing `catch (err: any)` block logs the error, emits an `OAUTH_CONNECTION_FAILED` audit log, and performs a browser redirect:
    `${frontendUrl}/dashboard?error=oauth_failed`
  - Browser redirect to dashboard (rather than a 403 JSON body) is the authentic user-facing denial surface for this redirect-based OAuth flow.
  - The OAuth state in Redis is single-use and already consumed (`await this.redis.del(stateKey)`) prior to the entitlement check. A denied user must restart the connection flow from the UI connect button—which is then blocked upfront with HTTP 403 by `WorkspaceWritableGuard`.

#### C. Known Limitations of Guard Fail-Open Behavior

- `WorkspaceWritableGuard` returns `true` if `request.params?.workspaceId` is falsy. Any mutation route lacking a `:workspaceId` path parameter cannot rely on the guard decorator and MUST perform an explicit service-level check (`entitlementsService.assertWorkspaceWritable(workspaceId)`).

#### D. What Stays Unguarded by Design

1. `GET 'v1/workspaces/:workspaceId/oauth/discoveries/:discoveryId'` (`getDiscoverySession`):
   - Pure read endpoint returning available discovery profiles; performs no mutations.
2. `POST 'v1/workspaces/:workspaceId/accounts/:accountId/disconnect'` (`accounts.disconnect`):
   - Removal/cleanup operation. Blocking account disconnection would trap users in halted or expired workspaces with active third-party account authorizations they cannot revoke.
3. `POST 'v1/workspaces/:workspaceId/accounts/:accountId/sync'`:
   - Read-triggering telemetry sync operation; does not create accounts or publish new content.
4. `Analytics GET endpoints`:
   - Pure read queries.
5. `PublicationsController` Mutations (`DELETE publications/:publicationId`, `DELETE publications/:publicationId/remote`, `POST validate`, `POST unschedule`, `POST cancel`, `POST reconcile`):
   - Observed out of scope for this PR. Documented as a follow-up policy decision for the repository owner on whether deletion/cancellation/reconcile operations should remain permissible for read-only tenants.

#### E. Exact 403 Denial Messages (`apps/api/src/modules/billing/entitlements.service.ts`)

- **Halted**:
  `'Workspace subscription is halted by payment provider. Please renew or update your payment method.'`
- **Past due past period end**:
  `'Subscription payment past due and billing period has expired. Workspace is in read-only mode.'`
- **Cancelled/expired past period end**:
  `'Subscription is expired or cancelled. Workspace is in read-only mode.'`
- **Trial expired**:
  `'Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue.'`
- **Fallback**:
  `'Workspace is in read-only mode due to expired trial or halted subscription.'`

### 3. Verification & Test Evidence

- **Backend Unit Tests (`apps/api`, 36/36 test files PASS, 462/462 tests PASS)**:
  - `apps/api/src/modules/media/media.controller.spec.ts` (NEW, 4 tests PASS):
    - Confirms `WorkspaceWritableGuard` decorator metadata on `initiateUpload` and `completeUpload`.
    - `initiateUpload` on read-only workspace throws `ForbiddenException` with exact message `'Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue.'` and `MediaService.initiateUpload` is NOT called.
    - `completeUpload` on read-only workspace throws `ForbiddenException` with exact message `'Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue.'` and `MediaService.completeUpload` is NOT called.
    - Writable workspace passes through to `MediaService.initiateUpload` and `completeUpload`.
  - `apps/api/src/modules/oauth/oauth.controller.spec.ts` (18 tests PASS, 3 new):
    - Confirms `WorkspaceWritableGuard` decorator metadata on `connectProvider` and `selectDiscoveryProfiles`.
    - `connectProvider` on read-only workspace is blocked with 403 before `OAuthService.generateAuthUrl` is called.
    - `selectDiscoveryProfiles` on read-only workspace is blocked with 403 before `OAuthService.processDiscoverySelection` is called.
    - `getDiscoverySession` is confirmed unguarded by `WorkspaceWritableGuard` and proceeds as a read.
  - `apps/api/src/modules/oauth/oauth.service.spec.ts` (14 tests PASS, 2 new):
    - `handleOAuthCallback` with mocked `EntitlementsService` rejecting (read-only workspace) throws `ForbiddenException` with exact message `'Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue.'`.
    - Verifies `provider.exchangeAuthorizationCode` is NOT called, no discovery session is stored, and `socialAccountRepo.upsertWithConnection` is NOT called.
    - Verifies single-use state in Redis is deleted.
    - Writable workspace proceeds with authorization code exchange and account upsert.
- **Backend E2E Tests (`apps/api/test`)**:
  - `apps/api/test/media.storage.e2e-spec.ts` (10 tests PASS, 2 new):
    - Extended with expired-trial workspace fixture (`trialEndsAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)`).
    - Asserts `POST /api/v1/workspaces/:workspaceId/media/uploads` returns HTTP 403 with error message `'Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue.'`.
    - Asserts `POST /api/v1/workspaces/:workspaceId/media/:mediaId/complete` returns HTTP 403 with error message `'Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue.'`.
    - Existing writable workspace upload, range reads, and tenant isolation tests remain passing.
  - **OAuth E2E Note**: No dedicated OAuth E2E test suite exists in the codebase today. Implementing an end-to-end OAuth suite would require spinning up mock OAuth provider servers and synthetic browser redirection harnesses. Comprehensive unit tests across controller and service levels cover all read-only denial branches, state validation, and guard placement without introducing unnecessary infrastructure overhead.
- **Monorepo Quality & Build Checks**:
  - `pnpm --filter @agency-os/api typecheck`: 0 errors.
  - `pnpm --filter @agency-os/api exec eslint`: 0 errors across all modified production and test files.
  - `pnpm --filter @agency-os/api test`: 36 test files passed, 462 tests passed.
- **CI Quality Gates**:
  - 6/6 verified green on reviewed head 5bded454 (GitGuardian Security Checks 10:22:19Z, Application Builds 10:23:18Z, Code Quality (Lint & Typecheck) 10:23:23Z, Tests 10:23:44Z, API E2E Tests 10:23:57Z, Docker Build & Smoke Test 10:30:56Z, all 2026-11-11 UTC). CI must be re-verified on the new head after this docs fix.

### 4. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
2. **Follow-Up Decision**:
   - Repository owner review on whether `PublicationsController` deletion/unschedule/cancel endpoints should remain accessible for read-only workspaces.
3. **Next Steps**:
   - Branch `fix/mutation-gaps` pushed; PR #67 open targeting `main`.
   - Verify 6/6 green CI checks on GitHub Actions on the new head after this docs fix.
   - Do NOT merge on this prompt alone.

---

## 55. Meta (Facebook & Instagram) Connect Buttons on Accounts Page (2026-11-13) — MERGED

- **Status**: **MERGED** (PR #68, merged 2026-11-13, merge commit [`9645776f2e4b36bab8c1e8dbdec05dcf5702cbed`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9645776f2e4b36bab8c1e8dbdec05dcf5702cbed), approved head `8a1547d0413b0982f3312ea0c7bef6f226e4dc2d`)

### 1. Context & Objectives

- **Audit Origin**: Social Account Management & Multi-Platform Integration (`apps/web/src/app/[workspaceId]/accounts/page.tsx`).
- **Background**: The backend implementation for Meta (`packages/providers/meta/meta.provider.ts`, `packages/providers/core/provider-registry.ts`, and `apps/api/src/modules/oauth`) was already fully functional for `facebook` and `instagram` providers. Discovery UI (`discovery-client.tsx`) and account cards (`account-card.tsx`) were already built to format and manage `FACEBOOK` and `INSTAGRAM` accounts. However, the accounts page previously only rendered state, handlers, and buttons for YouTube and LinkedIn.
- **Goal**: Add dedicated 'Connect Facebook' and 'Connect Instagram' buttons to the accounts page in both empty state and header row, wire up independent connection state and error handling, maintain disabled synchronization during pending requests, and establish a dedicated page specification test suite.

### 2. Architecture & Design Decisions

#### A. Single Meta Flow vs. Two Actionable Buttons
- **One OAuth Flow Underneath**: Meta's OAuth 2.0 flow is unified. Both Facebook and Instagram connect endpoints initiate the same underlying Facebook OAuth dialogue (`https://www.facebook.com/v20.0/dialog/oauth`). MetaProvider queries `/me/accounts?fields=...,instagram_business_account`, returning both Facebook Pages and linked Instagram Business/Professional accounts in a single discovery session.
- **Two Distinct Buttons by Design**: Rather than combining them into a single 'Connect Facebook & Instagram' button, two distinct buttons ('Connect Facebook' and 'Connect Instagram') are provided. This preserves the established per-provider pattern and ensures that each provider's connection state remains independently observable and actionable through has-checks:
  ```typescript
  const hasFacebook = accounts.some(a => a.provider === 'FACEBOOK' && a.status !== 'DISCONNECTED');
  const hasInstagram = accounts.some(a => a.provider === 'INSTAGRAM' && a.status !== 'DISCONNECTED');
  ```
  If a workspace has an active Facebook page connected but lacks Instagram (or vice versa), the unlinked provider remains visible in the header row for immediate action.

#### B. Exact Endpoints & Fixed Server-Side Scopes
- **Endpoints Called**:
  - Facebook: `workspaces/${workspaceId}/oauth/facebook/connect`
  - Instagram: `workspaces/${workspaceId}/oauth/instagram/connect`
- **No `?scopes` Query Parameter**: Unlike LinkedIn's connect call (`workspaces/${workspaceId}/oauth/linkedin/connect?scopes=w_member_social`), neither Meta endpoint appends a `?scopes` parameter. Meta's authorization scopes are fixed server-side in `MetaProvider.getAuthorizationUrl` (`packages/providers/meta/meta.provider.ts`), which defines and requests exactly five fixed scopes:
  1. `pages_show_list`
  2. `pages_read_engagement`
  3. `pages_manage_posts`
  4. `instagram_basic`
  5. `instagram_content_publish`
  Any client-supplied `?scopes` query parameter is ignored by `MetaProvider`.

#### C. State, Handlers, and Button Placements
- **State Added**:
  - `const [isConnectingFb, setIsConnectingFb] = useState(false);`
  - `const [isConnectingIg, setIsConnectingIg] = useState(false);`
- **Error Messages**:
  - Facebook failure: `'Failed to initiate Facebook connection. Please try again.'`
  - Instagram failure: `'Failed to initiate Instagram connection. Please try again.'`
- **Disabled Synchronization**:
  - All four buttons in both the header row and the empty state are disabled when any connection request is in flight:
    `disabled={isConnectingYt || isConnectingLi || isConnectingFb || isConnectingIg}`
- **Render Locations**:
  1. **Header Row (`accounts.length > 0`)**: Rendered inside `{ !hasFacebook && (...) }` and `{ !hasInstagram && (...) }`, alongside YouTube and LinkedIn.
  2. **Empty State (`accounts.length === 0`)**: All four connect buttons rendered side-by-side.

### 3. Verification & Test Evidence

- **Frontend Spec Suite (`apps/web/src/app/[workspaceId]/accounts/page.spec.tsx`)**:
  - New dedicated accounts page test suite following repo standards (`QueryClientProvider`, `vi.mock('next/navigation')`, `vi.mock('../../../lib/api/client')` with faithful `ApiError` class).
  - **Test Count**: Exactly 11 tests across 11 `it()` blocks (verified by code count):
    1. `(a) empty state renders all four buttons: Connect YouTube, Connect LinkedIn, Connect Facebook, Connect Instagram`: Verifies empty state displays all 4 platform connect buttons.
    2. `(b) clicking Connect Facebook calls api.post with exactly workspaces/<workspaceId>/oauth/facebook/connect (no query string) and assigns window.location.href`: Verifies exact endpoint call without query parameters and browser redirect.
    3. `(c) clicking Connect Instagram calls api.post with exactly workspaces/<workspaceId>/oauth/instagram/connect and assigns window.location.href`: Verifies exact endpoint call without query parameters and browser redirect.
    4. `(d) api.post rejecting on the Facebook click shows Failed to initiate Facebook connection. Please try again.`: Verifies Facebook-specific error message on API rejection.
    5. `(d) api.post rejecting on the Instagram click shows Failed to initiate Instagram connection. Please try again.`: Verifies Instagram-specific error message on API rejection.
    6. `(e) with an ACTIVE FACEBOOK account in the list, Connect Facebook is NOT rendered and Connect Instagram IS rendered (header row)`: Verifies header row has-check hides Facebook when already active.
    7. `(e) with an ACTIVE INSTAGRAM account in the list, Connect Facebook IS rendered and Connect Instagram is NOT rendered (header row)`: Verifies header row has-check hides Instagram when already active.
    8. `(f) a DISCONNECTED FACEBOOK account does NOT hide Connect Facebook (header row)`: Verifies `status !== 'DISCONNECTED'` rule keeps connect button visible for reconnecting.
    9. `(g) regression: Connect YouTube still posts to workspaces/<workspaceId>/oauth/youtube/connect`: Verifies YouTube connect regression parity.
    10. `(g) regression: Connect LinkedIn still posts to workspaces/<workspaceId>/oauth/linkedin/connect?scopes=w_member_social`: Verifies LinkedIn connect regression parity with required scopes query.
    11. `(h) disables all connect buttons while any connect is in flight`: Verifies multi-button disabled synchronization during in-flight requests.
- **Monorepo Quality & Build Checks**:
  - `pnpm --filter @agency-os/web test`: 21 test files passed, 224 tests passed (including all 11 accounts page tests).
  - `pnpm turbo run lint typecheck`: 15 successful, 0 errors across monorepo.
- **CI Quality Gates**:
  - 6/6 verified green on reviewed head f3eaa75f (GitGuardian Security Checks 07:22:49Z, Application Builds 07:23:36Z, Tests 07:24:22Z, API E2E Tests 07:24:29Z, Code Quality (Lint & Typecheck) 07:24:34Z, Docker Build & Smoke Test 07:31:20Z, all 2026-11-13 UTC). CI must be re-verified on the new head after this docs fix.

### 4. Live-Function Dependencies & Release Gate

1. **Honest Live-Function Dependency**:
   - The UI buttons connect to real, implemented backend endpoints (`POST /api/v1/workspaces/:workspaceId/oauth/facebook/connect` and `.../instagram/connect`).
   - However, completing a real Meta login round-trip in production requires `META_CLIENT_ID` and `META_CLIENT_SECRET` configured on the server, plus Meta App Review approval for the Meta Developer App (the repository owner's external platform-application track).
   - The buttons are not conditionally hidden or disabled based on server credential availability, as the API exposes no such configuration flag to the web client.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, Meta App Review approval, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - Branch `feat/meta-connect-buttons` pushed; PR #68 open targeting `main`.
   - Verify 6/6 green CI checks on GitHub Actions on the new head after this docs fix.
   - Do NOT merge on this prompt alone.

---

## 56. User Name Collection on Signup & Dashboard Fallback (2026-11-13) — MERGED

- **Status**: **MERGED** (PR #69, merged 2026-11-13, merge commit [`fc1541691e829576c7b7eb196a651f0101eb451a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/fc1541691e829576c7b7eb196a651f0101eb451a), approved head `e9b02137a6413aa16e326579d948e98f9d15fd05`)

### 1. Root Cause & Context

- **Gap Origin**: Phase A follow-up work closing the last Oct-12 re-grade UI gap.
- **Root Cause**:
  - The Prisma `User` model (`packages/database/prisma/schema.prisma`) had NO `name` field. Its fields were: `id`, `email`, `hashedPassword`, `emailVerified`, `emailVerifiedAt`, `securityEpoch`, `termsAcceptedAt`, `createdAt`, `updatedAt`, plus relations.
  - The web client already declared `name: string` in the `User` interface (`apps/web/src/lib/query/auth.ts`) and rendered it in two places:
    1. `apps/web/src/app/dashboard/page.tsx` line 125 (`Welcome back, {authData?.user.name}`)
    2. `apps/web/src/components/dashboard-shell.tsx` line 235 (`{authData.user.name}` in the sidebar)
  - At runtime the API never returned a `name`, so both sites rendered blank without any fallback.
  - `GET /auth/me` (`apps/api/src/modules/auth/auth.controller.ts` `getMe`) returns the full Prisma user row minus `hashedPassword`. Once the database column exists and is populated, `GET /auth/me` returns it automatically without requiring any change to the controller.

### 2. Design Decisions

1. **Name is REQUIRED at signup**: Users must provide a full name during registration. Validated client-side and server-side.
2. **Database column is NULLABLE (`name String?`)**: The column is nullable so existing rows are valid without a migration backfill.
3. **Web `User` type becomes `name: string | null`**: Both render sites fall back to the user's email when `name` is null or empty (`{authData?.user.name || authData?.user.email}` and `{authData.user.name || authData.user.email}`).
4. **Scope boundary**: No profile/settings page and no name-edit endpoint in this PR — out of scope.

### 3. Implementation Details

#### A. Database Schema & Migration
- Added `name String?` to the `User` model immediately after `email` in `packages/database/prisma/schema.prisma`.
- Created migration directory `packages/database/prisma/migrations/20261113000000_add_user_name/` with exact SQL:
  ```sql
  -- AlterTable
  ALTER TABLE "User" ADD COLUMN "name" TEXT;
  ```
- No other schema changes. No backfill.

#### B. Backend API & Repositories
- **`packages/database/src/repositories/UserRepository.ts`**:
  - Extended `CreateUserWithTenantInput` with required field `name: string;`.
  - In `createWithTenantTransaction`, added `name: input.name.trim(),` to `tx.user.create` data.
- **`apps/api/src/modules/auth/dto/signup.dto.ts`**:
  - Added `name` as FIRST field in `SignupDto` with validation:
    ```typescript
    @IsString()
    @IsNotEmpty({ message: 'Name is required' })
    @MaxLength(100, { message: 'Name must not exceed 100 characters' })
    name!: string;
    ```
- **`apps/api/src/modules/auth/auth.service.ts`**:
  - In `signup()`, passed `name: dto.name` in the payload passed to `userRepository.createWithTenantTransaction`. Anti-enumeration timing mitigation and duplicate-email flows preserved unchanged.
- **`apps/api/src/modules/auth/auth.controller.ts`**:
  - Kept completely untouched; `getMe()` automatically returns `name` from the Prisma row.

#### C. Web Frontend
- **`apps/web/src/lib/query/auth.ts`**:
  - Updated `User` interface to declare `name: string | null;`.
- **`apps/web/src/app/signup/page.tsx`**:
  - Added `const [name, setName] = useState('');`.
  - Added "Full name" field as FIRST form field above Email (`label htmlFor="name"`, `input id="name" name="name" type="text" autoComplete="name" required`).
  - Added `name: string;` to `payload` and set `name: name.trim()` unconditionally.
- **`apps/web/src/app/dashboard/page.tsx`**:
  - Render fallback: `{authData?.user.name || authData?.user.email}` in the greeting span.
- **`apps/web/src/components/dashboard-shell.tsx`**:
  - Render fallback: `{authData.user.name || authData.user.email}` in the sidebar user block name position.

### 4. Verification & Test Evidence

- **Database Unit Tests (`packages/database`, 13/13 files PASS, 110/110 tests PASS)**:
  - `packages/database/src/repositories/UserRepository.spec.ts` (6 tests PASS):
    - All 4 calls to `createWithTenantTransaction` updated with `name`.
    - Verifies `txMock.user.create` receives trimmed `name: 'Alice Smith'` when provided `'  Alice Smith  '`.
- **Backend API Unit Tests (`apps/api`, 36/36 files PASS, 464/464 tests PASS)**:
  - `apps/api/src/modules/auth/auth.service.spec.ts` (35 tests PASS):
    - Added tests for `SignupDto` validation rejecting missing name and empty string name with message `'Name is required'`.
    - Verified all existing signup test fixtures include `name`.
    - Verified `userRepository.createWithTenantTransaction` is called with `name: 'Alice Smith'`.
  - `apps/api/src/modules/auth/auth.controller.spec.ts` (32 tests PASS):
    - Added `name` to all signup test payloads.
- **Backend API E2E Tests (`apps/api/test`, 6/6 suites PASS, 127/127 tests PASS)**:
  - `apps/api/test/auth.e2e-spec.ts` (30 tests PASS):
    - Signup happy path asserts stored `user.name === submittedName` in PostgreSQL database.
    - Asserts `GET /api/v1/auth/me` returns `user.name === submittedName`.
    - Added validation test: signup with name missing returns HTTP 400.
    - Added validation test: signup with name empty string returns HTTP 400.
    - Added `name` to all other signup payloads in E2E.
- **Frontend Spec Suites (`apps/web`, 21/21 files PASS, 227/227 tests PASS)**:
  - `apps/web/src/app/signup/page.spec.tsx` (14 tests PASS):
    - Verifies 'Full name' field renders with required attribute.
    - Verifies form submission posts trimmed name in payload.
    - All existing payload assertions updated to include `name`.
  - `apps/web/src/app/dashboard/page.spec.tsx` (6 tests PASS):
    - Existing test verified with named fixture.
    - Added test verifying greeting falls back to user email when `user.name` is null.
  - `apps/web/src/components/dashboard-shell.spec.tsx` (5 tests PASS):
    - Added test verifying sidebar displays user email in name position when `user.name` is null.
- **Monorepo Quality & Build Checks**:
  - `pnpm turbo run lint typecheck`: 15 tasks successful, 0 errors across entire repository.
- **CI Quality Gates**:
  - 6/6 verified green on reviewed head 28a6e4d (GitGuardian Security Checks 08:48:05Z, Application Builds 08:48:47Z, Code Quality (Lint & Typecheck) 08:49:18Z, Tests 08:49:26Z, API E2E Tests 08:49:41Z, Docker Build & Smoke Test 08:56:42Z, all 2026-11-13 UTC). CI must be re-verified on the new head after this docs fix.

### 5. Release Gate & Next Steps

1. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
2. **Next Steps**:
   - Branch `feat/signup-name-field` pushed; PR #69 open targeting `main`.
   - Verify 6/6 green CI checks on GitHub Actions on the new head after this docs fix.
   - Do NOT merge on this prompt alone.

---

## 57. Auth Production Readiness Report (PR #62) — MERGED

- **Status**: **MERGED** (PR #62, merged 2026-11-09, merge commit [`430972432dee797d582e426e4b1e33e2d0749c5e`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/430972432dee797d582e426e4b1e33e2d0749c5e), approved head `6408232e06a0cef9b112a6f3e9e2811f039b25ca`)

### 1. Context & Scope

- PR #62 was a report-only PR: it added `docs/auth-production-readiness-report.md` and changed no production code.
- The report's three P0 findings were:
  1. No password reset / account recovery anywhere.
  2. The unverified-login redirect trap.
  3. Rate limiting is IP-only with no per-account lockout.
- The report's phased plan defined Phase A (before first paying customer), Phase B (before 1,000 users), and Phase C.
- Phase A was completed by PRs #63 (password reset), #64 (error-shape fix), #65 (unverified routing), #66 (terms consent), and #67 (mutation gaps) — recorded in sections 50, 51, 52, 53, and 54 respectively.
- This section and the §§48-56 merge records were backfilled by the docs PR on branch `docs/merge-records-48-56` because PR #62 was merged without a section and sections 48-56 were merged without merge records.

### 2. CI Quality Gates & Release Gate

- **CI Quality Gates**:
  - 6/6 verified green on reviewed head f2269ab (GitGuardian Security Checks 09:27:11Z, Application Builds 09:27:53Z, Code Quality (Lint & Typecheck) 09:28:22Z, API E2E Tests 09:28:45Z, Tests 09:29:03Z, Docker Build & Smoke Test 09:35:37Z, all 2026-11-13 UTC). CI must be re-verified on the new head after this docs update.
- **Live Deployment Release Gate**:
  - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).

---

## 58. Guard Publications & Post Mutations for Read-Only Workspaces (2026-11-13)

### 1. Context & Objectives

- **Owner Decision (2026-11-13)**: The publications mutations left unguarded by PR #67 (recorded as an open follow-up in §54) are now guarded.
- **Rationale**: In the Agency OS multi-tenant lifecycle, "read-only" status for a halted, past-due, cancelled, or trial-expired workspace means strictly read-only for every state-altering mutation. Read-only workspaces must not be allowed to execute deletes, cancellations, unscheduling, validation, or stuck publication reconciliation until writable status is restored.
- **Discovery Beyond §54 List**: During comprehensive routing audit of `apps/api/src/modules/publishing`, `deletePost` (`DELETE v1/workspaces/:workspaceId/posts/:postId`) in `PostsController` was identified as lacking `WorkspaceWritableGuard`, despite draft creation and update being guarded. This mutation was included in the hardening scope alongside the 6 publication mutations.

### 2. Architecture & Implementation

#### A. Guard Placement & Route Verification

- **Publications Controller (`apps/api/src/modules/publishing/controllers/publications.controller.ts`)**:
  - Attached `@UseGuards(WorkspaceWritableGuard)` immediately following method-level route decorators across 6 mutation endpoints:
    1. `removeTarget`: `DELETE :publicationId` (`DELETE v1/workspaces/:workspaceId/publications/:publicationId`)
    2. `requestRemoteDelete`: `DELETE :publicationId/remote` (`DELETE v1/workspaces/:workspaceId/publications/:publicationId/remote`)
    3. `validateTarget`: `POST :publicationId/validate` (`POST v1/workspaces/:workspaceId/publications/:publicationId/validate`)
    4. `unscheduleTarget`: `POST :publicationId/unschedule` (`POST v1/workspaces/:workspaceId/publications/:publicationId/unschedule`)
    5. `cancelTarget`: `POST :publicationId/cancel` (`POST v1/workspaces/:workspaceId/publications/:publicationId/cancel`)
    6. `reconcileTarget`: `POST :publicationId/reconcile` (`POST v1/workspaces/:workspaceId/publications/:publicationId/reconcile`)
- **Posts Controller (`apps/api/src/modules/publishing/controllers/posts.controller.ts`)**:
  - Attached `@UseGuards(WorkspaceWritableGuard)` immediately following `@Delete(':postId')` on `deletePost`:
    7. `deletePost`: `DELETE :postId` (`DELETE v1/workspaces/:workspaceId/posts/:postId`)
- **Deterministic Route Parameter Resolution**:
  - `PublicationsController` is mounted at `v1/workspaces/:workspaceId` and `PostsController` is mounted at `v1/workspaces/:workspaceId/posts`.
  - Because all 7 route paths include `:workspaceId`, `request.params.workspaceId` is always populated on incoming requests. `WorkspaceWritableGuard` evaluates write entitlement deterministically; its missing-param fail-open fallback does not trigger, and no service-level fallback is required (contrasting with the OAuth callback in §54 where route lacked `:workspaceId`).

#### B. System Behaviors & Boundary Preservations

- **Reconciliation Consequence**:
  - The operator reconcile action (`POST .../reconcile`) for resolving stuck or ambiguous publication records is now fenced for read-only tenants. Operators cannot reconcile stuck publications in halted/expired workspaces until subscription or trial entitlement is restored.
- **Validation Endpoint vs. Internal Publishing Pipeline**:
  - The external HTTP endpoint `POST .../validate` is guarded to reject validation calls for read-only workspaces with HTTP 403.
  - The internal service call `PublishingApplicationService.validateTarget` invoked during `requestPublish` is unaffected, as NestJS controller method guards only intercept inbound HTTP requests.
- **Untouched Components**:
  - `WorkspaceWritableGuard`, `EntitlementsService`, `PublishingApplicationService`, `BillingModule`, and frontend applications remain completely unmodified, adhering to minimal-diff discipline.

### 3. Verification & Test Evidence

- **Unit Tests**:
  - `apps/api/src/modules/publishing/controllers/publications.controller.spec.ts`: 12/12 PASS (5 existing + 7 new asserting `WorkspaceWritableGuard` decoration across all 6 new handlers and 6 pre-existing handlers).
  - `apps/api/src/modules/publishing/controllers/posts.controller.spec.ts`: 2/2 PASS (NEW unit test suite asserting `deletePost`, `createDraft`, and `updateDraft` carry `WorkspaceWritableGuard`).
- **E2E Integration Tests**:
  - `apps/api/test/publishing.e2e-spec.ts`: 55/55 PASS (51 existing + 4 new integration tests in `Read-Only Expired Trial Workspace Mutation Blocking (Publications & Posts)` asserting HTTP 403 denials with trial-expired messages for `removeTarget`, `cancelTarget`, `unscheduleTarget`, and `deletePost`).
- **Monorepo Code Quality**:
  - `pnpm turbo run lint typecheck`: All 15 tasks successful across 9 packages (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - 6/6 verified green on reviewed head 83ab473 (GitGuardian Security Checks 12:22:31Z, Application Builds 12:23:22Z, Code Quality (Lint & Typecheck) 12:23:57Z, API E2E Tests 12:24:04Z, Tests 12:24:04Z, Docker Build & Smoke Test 12:31:00Z, all 2026-11-13 UTC). CI must be re-verified on the new head after this docs update.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).

---

## 59. Per-Account Login Lockout (2026-11-13)

### 1. Context & Objectives

- **Origin**: `docs/auth-production-readiness-report.md` (PR #62) P0 Finding 3 — Phase B Item 1 ("Rate limiting is IP-only with no per-account lockout").
- **Problem Statement**: Prior to this change, rate limiting on login was strictly IP-based (5 attempts per 15 minutes via `@Throttle(RateLimitPolicies.auth)`). An adversary rotating proxy IP addresses could attempt unlimited dictionary or credential-stuffing attacks against a single user account without triggering IP-scoped throttles.
- **Dual-Layer Defense**: This implementation introduces a persistent, per-account failed attempt counter and timed lockout layer. The existing IP throttle remains completely untouched and complementary, throttling volumetric attacks from single origins while per-account lockout halts distributed password guessing targeting specific accounts.

### 2. Architecture & Design Decisions

#### A. Database-Backed Counters vs. Redis
- **Chosen Architecture**: Persistent columns on the `User` table (`failedLoginAttempts Int @default(0)`, `lockedUntil DateTime?`).
- **Rationale**:
  - Durability across infrastructure events: in-memory or Redis-backed keys can be flushed, evicted under memory pressure, or lost during cluster failover, wiping lockout counters and re-opening attack windows.
  - Consistency: utilizes Prisma update semantics and collocated relational state already established in the repository layer (`UserRepository`).
  - No new infrastructure dependencies or schema indirection.

#### B. Thresholds & Temporal Rules
- `MAX_FAILED_LOGIN_ATTEMPTS = 5`
- `ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000` (15 minutes)

#### C. Authentication Flow Lifecycle
1. **Lookup & Pre-Verification Lock Check**:
   - `AuthService.login()` queries `UserRepository.findByEmail(email)`.
   - If user does not exist, throws `InvalidCredentialsException('USER_NOT_FOUND')` without recording failed attempts.
   - If user exists, evaluates `user.lockedUntil && user.lockedUntil.getTime() > Date.now()`.
   - If locked, immediately throws `InvalidCredentialsException('ACCOUNT_LOCKED', user.id)` without invoking `argon2.verify` (conserving server CPU).
2. **Password Verification & Post-Failure Handling**:
   - On password mismatch (`isValid === false`):
     - Calls `userRepo.incrementFailedLoginAttempts(user.id)`, which atomically increments `failedLoginAttempts` by 1.
     - If the updated `failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS`:
       - Sets `lockedUntil = new Date(Date.now() + ACCOUNT_LOCKOUT_MS)` and resets `failedLoginAttempts = 0` via `userRepo.lockUserAccount(user.id, lockedUntil)`. The account is locked for subsequent attempts.
     - Throws `InvalidCredentialsException('INVALID_PASSWORD', user.id)`.
3. **Post-Success Cleanup**:
   - On password match (`isValid === true`):
     - Checks if dirty (`user.failedLoginAttempts > 0 || user.lockedUntil !== null`).
     - If dirty, calls `userRepo.clearFailedLoginAttempts(user.id)` to reset `failedLoginAttempts = 0` and `lockedUntil = null`.
     - If clean (0 and null), skips the database write to avoid unnecessary write IO.

#### D. Zero-Disclosure & Timing Characteristics
- **Client Invariance**: Both `ACCOUNT_LOCKED` and `INVALID_PASSWORD` (as well as `USER_NOT_FOUND`) map to identical HTTP 401 responses (`{ "error": { "code": "UnauthorizedException", "message": "Invalid credentials", "requestId": "<request-id>" } }`).
- **Audit Logging**: The internal failure reason (`ACCOUNT_LOCKED` vs `INVALID_PASSWORD`) is passed through `InvalidCredentialsException` and captured by `AuthController.login`'s catch block (`AuthService.login` throws; it does not audit) in the server-side `AUTH_LOGIN_FAILED` audit log without disclosing state to external callers.
- **Controller Boundary**: `AuthController.login` was already structured to catch `InvalidCredentialsException` and emit `AUTH_LOGIN_FAILED` reading `e.reason` (into audit metadata `{ reason }`) and `e.resolvedUserId` (into `targetId`, when present); zero controller modifications were required.

#### E. Stated Tradeoffs & Threat Model
1. **Targeted Lockout Denial-of-Service (Account DoS)**:
   - *Risk*: An attacker who knows a target user's email address can intentionally submit 5 incorrect passwords to temporarily deny login access to the legitimate user for 15 minutes.
   - *Mitigation*: Lockout is time-bounded (15 minutes) rather than permanent/operator-intervention-required; IP throttle continues to restrict rapid-fire submissions from single hosts; counter is reset on lock application and does not extend the window on further failed attempts.
2. **Timing Discrepancies**:
   - *Risk*: Locked accounts return HTTP 401 faster because `argon2.verify` is bypassed.
   - *Mitigation*: This behavior is identical to the pre-existing `USER_NOT_FOUND` flow, where non-existent accounts return prior to password hashing. Eliminating Argon2 hashing on locked accounts is intentional to prevent CPU exhaustion denial-of-service against the API during credential-stuffing floods.
3. **Deliberate Scope Boundary**:
   - Current-password verification in `AuthService.changePassword` does NOT increment or evaluate login lockout counters in this PR; it remains scoped strictly to the public `AuthService.login` authentication gateway.

### 3. Verification & Test Evidence

- **Database Repository Tests (`packages/database/src/repositories/UserRepository.spec.ts`)**:
  - 9/9 PASS (3 new unit tests covering `incrementFailedLoginAttempts`, `lockUserAccount`, and `clearFailedLoginAttempts`).
  - Full `@agency-os/database` test suite: 13/13 test files PASS, 113/113 tests PASS.
- **Auth Service Unit Tests (`apps/api/src/modules/auth/auth.service.spec.ts`)**:
  - 41/41 PASS (6 new unit tests verifying attempt incrementing, threshold tripping, active lockout rejection, expired lockout recovery, dirty counter clearing, clean counter write-skipping, and unknown user bypass).
  - Full `@agency-os/api` unit test suite: 37/37 test files PASS, 479/479 tests PASS.
- **API E2E Tests (`apps/api/test/auth.e2e-spec.ts`)**:
  - 31/31 PASS (New `Per-Account Login Lockout (e2e)` suite verifying 4 failed attempts allow continued retries, 5th failed attempt triggers lock, locked account returns identical HTTP 401 with no disclosure, DB contains future `lockedUntil` and 0 attempts, expired lock allows successful login with session cookie, and DB counters reset to 0/null).
- **Monorepo Code Quality**:
  - `pnpm turbo run lint typecheck`: 15/15 tasks PASS (0 errors across all monorepo packages).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - 6/6 verified green on reviewed head 76707ec (GitGuardian Security Checks 13:29:26Z, Application Builds 13:32:19Z, Code Quality (Lint & Typecheck) 13:32:37Z, API E2E Tests 13:32:50Z, Tests 13:33:05Z, Docker Build & Smoke Test 13:40:09Z, all 2026-11-13 UTC). CI must be re-verified on the new head after this docs update.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - Branch `feat/login-lockout` pushed; PR #72 open targeting `main`.
   - Do NOT merge on this prompt alone.

---

## 60. Password Security Policy & Breach Checking (2026-11-13)

### 1. Context & Objectives

- **Origin**: `docs/auth-production-readiness-report.md` (PR #62), Phase B item 3: "Add complexity requirements (minimum 1 uppercase, 1 lowercase, 1 number, 1 special character). Integrate HaveIBeenPwned k-Anonymity API check during password creation and change."
- **Problem Statement**: Prior to this change, user passwords only had length bounds (8-128 characters) enforced in DTOs. Trivial passwords (e.g. `password`, `12345678`) or compromised credentials known from historical data breaches were accepted during signup, self-serve password reset, and password change.
- **Scope & Boundaries**:
  - Implements service-layer password complexity requirements and real-time HaveIBeenPwned k-Anonymity breach verification across all three password creation/mutation routes (`signup`, `resetPassword`, `changePassword`).
  - DTOs remain completely untouched (length validation 8-128 remains in DTOs via `@MinLength` and `@MaxLength`). No custom class-validator decorators, no frontend changes.
  - Zero schema or database migrations required.
  - Existing users are not retro-checked or invalidated. The policy applies strictly during new password creation and updates.
  - Deferred sub-item: Session-ID rotation on password change is deliberately deferred (relying on PR #48's `securityEpoch` increment and `SessionManager.destroyOtherUserSessions`; on password change, all other sessions are destroyed while the current session is preserved with its `securityEpoch` updated; on password reset, all sessions are revoked).

### 2. Architecture & Design Decisions

#### A. Service Architecture & Modularity
- **`PwnedPasswordService` (`apps/api/src/modules/auth/pwned-password.service.ts`)**:
  - Encapsulates k-Anonymity breach checking against the HaveIBeenPwned Range API.
  - Computes the UPPERCASE SHA-1 hexadecimal hash of the password using Node's standard `crypto.createHash('sha1')`.
  - Sends only the first 5 hexadecimal characters (the prefix) to `GET ${baseUrl}/range/${prefix}` (defaulting to `https://api.pwnedpasswords.com`).
  - Neither the plain-text password nor the full SHA-1 hash is ever transmitted across the network, stored, or logged.
  - Receives the list of matching 35-character suffixes and counts (`<SUFFIX>:<COUNT>`). Scans the list case-insensitively for the matching suffix. If found with count > 0, returns `true` (breached).
  - Uses native global `fetch` with an `AbortController` enforcing a strict 2000ms timeout.
  - **Fail-Open Semantics**: Any non-200 status, network error, timeout, or parse failure logs a warning (`HIBP range API returned non-200 status: ${res.status}` on non-200 responses, or `HIBP range API request failed: ${err.message}` on thrown errors) via NestJS `Logger` and returns `false` (not breached), ensuring external API downtime does not block user registration or password reset.
  - **Environment Controls**:
    - `PASSWORD_BREACH_CHECK_ENABLED === 'false'`: Immediate kill-switch bypassing network calls and returning `false`.
    - `HIBP_API_BASE_URL`: Overridable base URL allowing zero-network, deterministic integration testing.
- **`PasswordPolicyService` (`apps/api/src/modules/auth/password-policy.service.ts`)**:
  - Orchestrates password complexity validation followed by breach checking via `assertPasswordAcceptable(password: string): Promise<void>`.
  - Validates complexity using regular expressions:
    - Lowercase letter: `/[a-z]/`
    - Uppercase letter: `/[A-Z]/`
    - Digit: `/[0-9]/`
    - Special character: `/[^A-Za-z0-9]/`
  - Throws `BadRequestException('Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.')` if complexity is not met.
  - Calls `this.pwnedPasswordService.isBreached(password)`. If breached, throws `BadRequestException('This password has appeared in a known data breach. Please choose a different password.')`.

#### B. Execution Ordering & Security Rationale
1. **`AuthService.signup(dto)`**:
   - Executes duplicate account check (`userRepo.findByEmail(dto.email)`) FIRST.
   - If user exists, generates an anti-enumeration token and returns without evaluating the password policy. This prevents an external attacker from using complexity/breach error differences as an oracle to enumerate registered accounts.
   - Evaluates `await this.passwordPolicyService.assertPasswordAcceptable(dto.password)` before Argon2 hashing and tenant provisioning transaction.
2. **`AuthService.resetPassword(dto)`**:
   - Consumes reset token (`consumeToken(dto.token)`) FIRST.
   - Checks `isSamePassword = await argon2.verify(user.hashedPassword, dto.newPassword)`. If true, rejects with `New password cannot be the same as the current password`.
   - Evaluates `await this.passwordPolicyService.assertPasswordAcceptable(dto.newPassword)`. If rejected, the token remains consumed (matching existing behavior and preventing replay of consumed tokens).
   - Hashes new password with Argon2, updates user, and bumps `securityEpoch`.
3. **`AuthService.changePassword(userId, currentPasswordPlain, newPasswordPlain)`**:
   - Verifies `currentPasswordPlain` against user hash.
   - Checks `currentPasswordPlain === newPasswordPlain`. If identical, rejects with `New password cannot be the same as the current password`.
   - Evaluates `await this.passwordPolicyService.assertPasswordAcceptable(newPasswordPlain)` before Argon2 hashing and epoch increment.

### 3. Verification & Test Evidence

- **Unit Tests**:
  - `apps/api/src/modules/auth/pwned-password.service.spec.ts`: 5/5 PASS
    - Verifies detection when suffix is present in range response (mixed case, /range/<prefix> URL asserted).
    - Verifies pass when suffix is absent from range response.
    - Verifies fail-open returning false on fetch rejection.
    - Verifies fail-open returning false when the API responds with a non-200 status (503).
    - Verifies kill-switch `PASSWORD_BREACH_CHECK_ENABLED='false'` bypass with fetch not called.
  - `apps/api/src/modules/auth/password-policy.service.spec.ts`: 6/6 PASS
    - Verifies rejection when lowercase letter is missing.
    - Verifies rejection when uppercase letter is missing.
    - Verifies rejection when digit is missing.
    - Verifies rejection when special character is missing.
    - Verifies rejection when password appears in breach list.
    - Verifies acceptance when compliant and not breached.
  - `apps/api/src/modules/auth/auth.service.spec.ts`: 45/45 PASS (41 existing + 4 new)
    - Verifies signup rejection on policy failure prevents user and organization creation.
    - Verifies signup with existing email returns anti-enumeration token without calling policy service.
    - Verifies resetPassword consumes token and rejects on policy failure.
    - Verifies changePassword rejects on policy failure without updating securityEpoch.
  - Full `@agency-os/api` unit test suite: 39/39 test files PASS, 494/494 tests PASS.
- **E2E Integration Tests**:
  - `apps/api/test/auth.e2e-spec.ts`: 34/34 PASS (31 existing + 3 new integration tests in `Password Security Policy & Breach Checking (e2e)` suite):
    - Rejects signup with non-complex password with HTTP 400.
    - Rejects signup with breached password with HTTP 400.
    - Permits signup with compliant, non-breached password with HTTP 201.
    - Fixture sweep: Updated test fixture passwords in `auth.e2e-spec.ts` (`testUser`, signup, resetPassword) to compliant credentials (`CorrectPassword123!`, etc.) and set up an ephemeral local HTTP stub server (`http.createServer`) routing `/range/:prefix` to ensure networkless, deterministic HIBP testing.
- **Database Tests**:
  - Full `@agency-os/database` test suite: 13/13 test files PASS, 113/113 tests PASS.
- **Monorepo Code Quality**:
  - `pnpm turbo run lint typecheck`: All 15 tasks successful across 9 packages (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - 6/6 verified green on reviewed head 59aaea8 (GitGuardian Security Checks 15:39:49Z, Application Builds 15:42:12Z, API E2E Tests 15:42:31Z, Code Quality (Lint & Typecheck) 15:42:49Z, Tests 15:42:59Z, Docker Build & Smoke Test 15:49:47Z, all 2026-11-13 UTC). CI must be re-verified on the new head after this docs update.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - Branch `feat/password-policy-hibp` pushed; PR #73 open targeting `main`.
   - Do NOT merge on this prompt alone.

---

## 61. Auth Security Notification Emails (Branch `feat/signup-lockout-notifications` — IN REVIEW)

### 1. Summary & Motivation

- **Status**: **IN REVIEW** (Branch `feat/signup-lockout-notifications`, PR [#74](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/74) pending independent review)
- **Pull Request**: [#74](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/74)
- **Branch**: `feat/signup-lockout-notifications`
- **Reviewed Head SHA**: [`352d5ee33757315f9074b70282b3bfaa95d950af`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/352d5ee33757315f9074b70282b3bfaa95d950af) (`352d5ee`)
- **Origin**: `docs/auth-production-readiness-report.md` (PR #62)
  - **Phase B Item 4 (Duplicate Signup Notification)**: When an account creation request targets an existing email, asynchronously dispatch a security notification to the address on record rather than disclosing account existence.
  - **Phase B Item 1 (Account Lockout Notification Email Sub-Point)**: When per-account lockout triggers upon reaching the threshold (5 failed attempts), asynchronously dispatch a security notification informing the account holder of the temporary 15-minute lock. (Deferred from PR #72 §59, which delivered the lockout mechanism itself).
- **Exact Notification Copy**:
  - **Duplicate Signup Email**:
    - Subject: `'An Agency OS account already exists for this email'`
    - Body / Text: `"Someone attempted to create an Agency OS account with this email address. If this was you, please sign in or reset your password. If this was not you, no action is needed — your account remains secure and no new account was created."`
  - **Account Lockout Email**:
    - Subject: `'Your Agency OS account was temporarily locked'`
    - Body / Text: `"Multiple failed login attempts detected on your account. For your security, your account has been temporarily locked for 15 minutes. If this was you, wait 15 minutes and try again, or reset your password. If this was not you, we recommend resetting your password after the lock expires."`

### 2. Architecture & Design Decisions

#### A. Provider Interface & Implementations
- **`EmailDeliveryService` Interface (`apps/api/src/modules/auth/email-delivery.service.ts`)**:
  - Extended with two contract methods:
    - `sendDuplicateSignupEmail(toEmail: string): Promise<void>`
    - `sendAccountLockedEmail(toEmail: string): Promise<void>`
  - Implemented across all three providers:
    - **`MockEmailDeliveryService`**: In-memory inspection arrays `sentDuplicateSignupEmails: Array<{ toEmail: string }>` and `sentAccountLockedEmails: Array<{ toEmail: string }>`. Throws if executed in production (`NODE_ENV === 'production'`).
    - **`NoopEmailDeliveryService`**: Safely logs a warning (`[NoopEmailDeliveryService] ... email delivery skipped for <email>: no email provider configured`) and resolves `undefined`.
    - **`ResendEmailDeliveryService`**: Sends transactional emails via native `fetch` to `https://api.resend.com/emails` with exact pinned subjects, plain-text copy, and HTML wrapper. Throws if `RESEND_API_KEY` is missing or Resend API returns non-200.

#### B. Non-Blocking Fire-and-Forget Dispatch
- **Async Safety**:
  - Neither dispatch is awaited in the HTTP request lifecycle.
  - Both dispatches chain `.catch((err) => { this.logger.warn(...) })`.
  - Notification delivery latency or third-party outages (such as Resend rate limits or downtime) cannot alter HTTP response status codes, delay client response times, or fail user transactions.

#### C. Placement & Trigger Rules
1. **`AuthService.signup(dto)`**:
   - Dispatched in duplicate account branches:
     - Initial lookup branch (`if (existingUser)`).
     - Database collision catch branch (Prisma P2002 unique-constraint error on the email target: `error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'` where `error.meta.target` contains `'email'`).
   - Triggered immediately after `AUTH_SIGNUP_DUPLICATE_EMAIL` audit logging and before returning `{ message: 'Registration request received.' }`.
2. **`AuthService.login(email, passwordPlain)`**:
   - Dispatched strictly when `updated.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS` (5).
   - Triggered immediately after `this.userRepository.lockUserAccount(user.id, ...)` and before throwing `InvalidCredentialsException('INVALID_PASSWORD', user.id)`.
   - Attempts against already-locked accounts fail fast at the top of `login` before password verification and do not re-dispatch lockout notifications.

#### D. Anti-Enumeration & Security Characteristics
- **Client Invariance**:
  - Duplicate signup: Caller receives identical HTTP 201 `{ message: 'Registration request received.' }`. The notification is delivered strictly to the mailbox of the registered user, never revealing account existence to the unauthenticated caller.
  - Account lockout: Caller receives identical HTTP 401 `{ error: { code: 'UnauthorizedException', message: 'Invalid credentials' } }`. No indication is given to the attacker that the account entered a locked state.
- **Tradeoffs & Bounds**:
  - Duplicate signup notification dispatch frequency is bounded by the global per-IP auth rate limit (`@Throttle RateLimitPolicies.auth`: 5 requests per 15 minutes per IP). Per-email notification cooldown is intentionally deferred to future hardening.

### 3. Verification & Test Evidence

- **Unit Tests**:
  - `apps/api/src/modules/auth/email-delivery.service.spec.ts`: 13/13 PASS (9 existing + 4 new)
    - Verifies `MockEmailDeliveryService` records duplicate signup and account locked emails in memory.
    - Verifies `NoopEmailDeliveryService` safely resolves duplicate signup and account locked methods.
    - Verifies `ResendEmailDeliveryService` sends duplicate signup email with exact subject and body.
    - Verifies `ResendEmailDeliveryService` sends account locked email with exact subject and body.
  - `apps/api/src/modules/auth/auth.service.spec.ts`: 52/52 PASS (45 existing + 7 new)
    - Duplicate signup calls `sendDuplicateSignupEmail` once with normalized email and does not call verification email or tenant creation.
    - Successful signup does not call `sendDuplicateSignupEmail`.
    - Duplicate signup returns generic response even if email delivery rejects.
    - Login failure reaching threshold (5) calls `sendAccountLockedEmail` once with user email.
    - Login failure below threshold does not call `sendAccountLockedEmail`.
    - Subsequent login attempts while account is already locked do not call `sendAccountLockedEmail`.
    - Login failure reaching threshold throws standard invalid credentials error even if email delivery rejects.
  - Full `@agency-os/api` unit test suite: 39/39 test files PASS, 505/505 tests PASS.
- **E2E Integration Tests**:
  - `apps/api/test/auth.e2e-spec.ts`: 35/35 PASS (34 existing + 1 new journey test + 1 extended lockout assertion):
    - `duplicate signup journey`: Signs up a fresh email (201), signs up duplicate email (201), asserts `sentDuplicateSignupEmails` records exactly 1 notification for that email.
    - `enforces lockout journey`: Asserts `sentAccountLockedEmails` contains 0 entries before lock, exactly 1 entry for the user upon 5th failed attempt, and still exactly 1 entry after subsequent attempts while locked.
- **Database Tests**:
  - Full `@agency-os/database` test suite: 13/13 test files PASS, 113/113 tests PASS.
- **Monorepo Code Quality**:
  - `pnpm --filter @agency-os/api lint`: 0 errors (132 warnings).
  - `pnpm --filter @agency-os/api typecheck`: 0 errors.

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - 6/6 verified green check runs on reviewed head `352d5ee` (GitGuardian Security Checks 14:48:48Z, Application Builds 14:49:43Z, Code Quality (Lint & Typecheck) 14:50:11Z, API E2E Tests 14:50:23Z, Tests 14:50:38Z, Docker Build & Smoke Test 14:57:13Z, all 2026-11-15 UTC).
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - Branch `feat/signup-lockout-notifications` pushed; PR #74 open targeting `main`.
   - Do NOT merge on this prompt alone.

---

## 62. Audit Log IP Address & User-Agent Capture (Branch feat/audit-log-ip-ua — IN REVIEW)

### 1. Summary & Motivation

- **Status**: **IN REVIEW** (Branch `feat/audit-log-ip-ua`, PR [#75](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/75) pending independent review)
- **Pull Request**: [#75](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/75)
- **Branch**: `feat/audit-log-ip-ua`
- **Reviewed Head SHA**: [`c7e336ddb40a7fa41068bf54a61b85ec4b5ff0e3`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/c7e336ddb40a7fa41068bf54a61b85ec4b5ff0e3) (`c7e336d`)
- **Origin**: `docs/auth-production-readiness-report.md` (PR #62), Phase B item 6: "Add ipAddress String? and userAgent String? columns to AuditLog table. Pass req.ip and req.headers['user-agent'] into AuditService.logAction."
- **Scope & Objectives**:
  - Add nullable `ipAddress` and `userAgent` columns to the `AuditLog` table in PostgreSQL.
  - Extend database and service DTOs (`CreateAuditLogDto`) to accept optional `ipAddress?: string` and `userAgent?: string`.
  - Capture client IP and User-Agent headers across all authentication endpoints in `AuthController` and thread them through `AuthService` methods.
  - Wire controller-direct audit logging call sites in other controllers (`AccountsController`, `OAuthController`) where `req` is in scope.
  - Keep internal domain services (`MediaService`, `PublishingApplicationService`) and background workers unwired (`null`), per scope discipline.
  - Verify migration, database repository persistence, audit service delegation, auth flows, and end-to-end integration with fresh tests.

### 2. Architecture & Design Decisions

#### A. Database Schema & Migration
- **Schema Columns (`packages/database/prisma/schema.prisma`)**:
  - Added `ipAddress String?` and `userAgent String?` directly after `requestId` on the `AuditLog` model.
  - Preserves relational integrity and table name `"AuditLog"`.
- **Migration**:
  - Migration directory: `packages/database/prisma/migrations/20261116000000_add_audit_log_ip_and_user_agent/migration.sql`
  - Exact SQL:
    ```sql
    -- AlterTable
    ALTER TABLE "AuditLog" ADD COLUMN "ipAddress" TEXT, ADD COLUMN "userAgent" TEXT;
    ```
  - Both columns are nullable with zero backfill required; existing historical audit rows remain valid with `NULL` values.

#### B. Repository & DTO Interface
- **DTO Extension (`packages/database/src/repositories/AuditLogRepository.ts`)**:
  - Extended `CreateAuditLogDto` with `ipAddress?: string;` and `userAgent?: string;`.
  - In `AuditLogRepository.create()`, explicitly mapped both fields into the Prisma insert payload:
    ```ts
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    ```
    When undefined or omitted, Prisma stores the fields as NULL in PostgreSQL.
- **AuditService Signature (`apps/api/src/modules/core/audit.service.ts`)**:
  - `AuditService.logAction(data: CreateAuditLogDto, tx?)` and `AuditService.logActionBestEffort(data: CreateAuditLogDto)` take `CreateAuditLogDto` directly. Zero signature changes were required on `AuditService`.

#### C. Request Context Threading & Trust-Proxy Semantics
- **Controller Context Extraction (`apps/api/src/modules/auth/auth.controller.ts`)**:
  - Client IP is extracted via Express `req.ip`.
  - User-Agent is safely extracted via optional chaining `req.headers?.['user-agent']`.
  - **Trust-Proxy Architecture**: Express `req.ip` honors the application's trust proxy configuration in `apps/api/src/main.ts` (`TRUST_PROXY` environment variable / loopback defaults). In containerized, reverse-proxy (e.g. Cloudflare / Nginx), or local development topologies, `req.ip` correctly resolves the client address.
  - Extracted in `signup`, `verifyEmail`, `resendVerification`, `forgotPassword`, `resetPassword`, `login`, `logout`, `changePassword`, and `revokeAllSessions`.
- **Service Delegation Threading (`apps/api/src/modules/auth/auth.service.ts`)**:
  - Added optional trailing argument `requestContext?: { ipAddress?: string; userAgent?: string }` to audit-emitting public methods:
    - `signup(dto: SignupDto, requestId?: string, requestContext?)`
    - `verifyEmail(rawToken: string, requestId?: string, requestContext?)`
    - `resendVerification(email: string, requestId?: string, requestContext?)`
    - `forgotPassword(email: string, requestId?: string, requestContext?)`
    - `resetPassword(token: string, newPasswordPlain: string, requestId?: string, requestContext?)`
    (where `requestContext` is `requestContext?: { ipAddress?: string; userAgent?: string }` in each case).
  - All 11 internal audit call sites in `AuthService` spread `ipAddress: requestContext?.ipAddress` and `userAgent: requestContext?.userAgent`.

#### D. Complete Call-Site Inventory in `apps/api`
1. **Populated in this PR**:
   - `AuthController` (7 controller-direct call sites):
     - `AUTH_LOGIN_SUCCEEDED` (`login`)
     - `AUTH_LOGIN_FAILED` (`login` — `InvalidCredentialsException`, bad credentials and account lockout distinguished by `metadata.reason`)
     - `AUTH_LOGIN_FAILED` (`login` — internal-error fallback, `metadata.reason 'INTERNAL_ERROR'`)
     - `AUTH_LOGOUT` (`logout`)
     - `AUTH_PASSWORD_CHANGED` (`changePassword`)
     - `AUTH_PASSWORD_CHANGE_FAILED` (`changePassword`)
     - `AUTH_REVOKE_ALL_SESSIONS` (`revokeAllSessions`)
   - `AuthService` (11 service-internal call sites):
     - `AUTH_SIGNUP_SUCCEEDED` (`signup`)
     - `AUTH_SIGNUP_DUPLICATE_EMAIL` (`signup` — lookup branch)
     - `AUTH_SIGNUP_DUPLICATE_EMAIL` (`signup` — P2002 conflict catch branch)
     - `AUTH_EMAIL_VERIFIED` (`verifyEmail`)
     - `AUTH_EMAIL_VERIFICATION_FAILED` (`verifyEmail`)
     - `AUTH_EMAIL_VERIFICATION_RESENT` (`resendVerification` — success)
     - `AUTH_EMAIL_VERIFICATION_RESENT` (`resendVerification` — user not found)
     - `AUTH_EMAIL_VERIFICATION_RESENT` (`resendVerification` — already verified)
     - `AUTH_PASSWORD_RESET_REQUESTED` (`forgotPassword` — success)
     - `AUTH_PASSWORD_RESET_REQUESTED` (`forgotPassword` — user not found)
     - `AUTH_PASSWORD_RESET_SUCCEEDED` (`resetPassword`)
   - `AccountsController` (1 controller-direct call site):
     - `ACCOUNT_SYNC_TRIGGERED` (`triggerSync`)
   - `OAuthController` (6 controller-direct call sites):
     - `OAUTH_CONNECTION_STARTED` (`connectProvider`)
     - `OAUTH_CONNECTION_FAILED` (`callbackProvider` — missing code/state)
     - `OAUTH_CONNECTION_FAILED` (`callbackProvider` — state mismatch)
     - `OAUTH_CONNECTION_FAILED` (`callbackProvider` — exchange exception)
     - `OAUTH_CONNECTION_SUCCEEDED` (`callbackProvider` — success)
     - `OAUTH_RECONNECTED` (`selectDiscoveryProfiles`)
2. **Remaining NULL with Architectural Rationale**:
   - `MediaService` (2 call sites: `initiateUpload`, `finalizeUpload`): Pure domain service without HTTP request in scope; Item 5 mandate deliberately avoids service layer refactoring outside auth.
   - `PublishingApplicationService` (13 call sites): Domain orchestration service invoked across multiple entrypoints including background BullMQ workers and reconciliation loops where HTTP requests are absent; threading HTTP context into publishing domain models is out of scope.
   - Background worker processors (`publishing.processor.ts`, `sync.processor.ts`) and webhook handlers: Emit no audit rows directly (publishing audits originate in `PublishingApplicationService`, already listed above) and run outside interactive user HTTP sessions.

### 3. Verification & Test Evidence

- **Database Repository Tests (`packages/database/src/repositories/AuditLogRepository.spec.ts`)**:
  - 6/6 PASS (2 new tests verifying persistence of `ipAddress` and `userAgent` when provided, and behavior when omitted).
- **Core Audit Service Tests (`apps/api/src/modules/core/audit.service.spec.ts`)**:
  - 7/7 PASS (2 new tests asserting `logAction` and `logActionBestEffort` forward `ipAddress` and `userAgent` unchanged to the repository).
- **Auth Service Unit Tests (`apps/api/src/modules/auth/auth.service.spec.ts`)**:
  - 55/55 PASS (3 new unit tests asserting `requestContext` values reach audit logs for signup success, duplicate email signup, and resetPassword success).
- **Auth Controller Unit Tests (`apps/api/src/modules/auth/auth.controller.spec.ts`)**:
  - 33/33 PASS (1 new unit test asserting `AUTH_LOGIN_SUCCEEDED` captures `ipAddress` and `userAgent` from request; 6 updated tests verifying delegation with request context).
- **Accounts Controller Unit Tests (`apps/api/src/modules/accounts/accounts.controller.spec.ts`)**:
  - 4/4 PASS (existing suite passes unchanged; does not assert the new IP/UA fields, which are verified via code review).
- **OAuth Controller Unit Tests (`apps/api/src/modules/oauth/oauth.controller.spec.ts`)**:
  - 18/18 PASS (existing suite passes unchanged; does not assert the new IP/UA fields, which are verified via code review).
- **Full API Unit Test Suite (`pnpm --filter @agency-os/api test`)**:
  - 39/39 test files PASS, 511/511 tests PASS.
- **Full Database Test Suite (`packages/database`)**:
  - 13/13 test files PASS, 115/115 tests PASS (in CI / with PostgreSQL).
- **API E2E Tests (`apps/api/test/auth.e2e-spec.ts`)**:
  - 38/38 PASS (35 existing + 3 new tests in `Audit Log IP and User-Agent Capture (e2e)` block):
    - Asserts successful login persists real `AuditLog` row with non-empty `ipAddress` string and `userAgent` matching the sent header (`AgencyOS-E2E-Test/1.0`); observed loopback literal `::ffff:127.0.0.1` in local test environment is not asserted as a strict literal.
    - Asserts failed login persists real `AuditLog` row with non-empty `ipAddress` string and sent `userAgent`.
    - Asserts signup flow persists real `AuditLog` row with non-empty `ipAddress` string and sent `userAgent`.
- **Monorepo Code Quality**:
  - `pnpm turbo run lint typecheck build`: All 18 tasks PASS across 9 packages (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - 6/6 verified green check runs on reviewed head `c7e336d` (GitGuardian Security Checks 08:15:38Z, Application Builds 08:16:33Z, Code Quality (Lint & Typecheck) 08:16:58Z, Tests 08:17:08Z, API E2E Tests 08:17:28Z, Docker Build & Smoke Test 08:24:03Z, all 2026-11-16 UTC). CI must be re-verified on the new head after this docs update.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - Branch `feat/audit-log-ip-ua` pushed; PR #75 open targeting `main`.
   - Do NOT merge on this prompt alone.

---

## 63. Cloudflare Turnstile Bot Resistance on Signup (Phase B Item 2)

### 1. Summary & Motivation

- **Status**: **IN REVIEW** (Branch `feat/turnstile-signup`, PR #76)
- **Origin**: `docs/auth-production-readiness-report.md` (PR #62), Phase B item 2: "Add Cloudflare Turnstile invisible widget to apps/web/src/app/signup/page.tsx. Validate turnstile token on backend AuthController.signup."
- **Scope & Objectives**:
  - Implement Cloudflare Turnstile bot resistance on user signup to prevent automated credential stuffing and programmatic account creation abuse.
  - Reject automated requests at the HTTP transport boundary in `AuthController.signup` with the exact error message: `'Bot verification failed. Please try again.'` (HTTP 400 `BadRequestException`).
  - Introduce `TurnstileService` (`apps/api/src/modules/auth/turnstile.service.ts`) using global `fetch` with zero new npm dependencies.
  - Extend `SignupDto` with optional `turnstileToken?: string` (`@IsOptional() @IsString() @MaxLength(2048)`).
  - Integrate Cloudflare Turnstile explicit rendering into `apps/web/src/app/signup/page.tsx` with zero third-party component libraries.
  - Provide complete test isolation: unit specs stub `fetch` / `window.turnstile`, while a new dedicated API E2E suite (`apps/api/test/turnstile.e2e-spec.ts`) boots its own app against a local ephemeral siteverify HTTP stub server.

### 2. Architecture & Implementation Details

#### A. Backend Transport-Layer Verification & DTO Declaration
- **Transport vs. Service Layer Separation**:
  - Verification is performed exclusively in `AuthController.signup` (`apps/api/src/modules/auth/auth.controller.ts`) after the existing HTTPS production guard and before delegating to `AuthService.signup`.
  - `AuthService` (`apps/api/src/modules/auth/auth.service.ts`) remains strictly untouched and unaware of Turnstile transport mechanics, maintaining clean domain boundaries.
- **DTO Whitelist & Forbid Non-Whitelisted Guard**:
  - In `apps/api/src/main.ts`, the NestJS `ValidationPipe` is configured with `whitelist: true` and `forbidNonWhitelisted: true`. Any request body field not declared on the DTO triggers an immediate HTTP 400 Bad Request.
  - Therefore, `SignupDto` (`apps/api/src/modules/auth/dto/signup.dto.ts`) must explicitly declare the token field:
    ```ts
    @IsOptional()
    @IsString()
    @MaxLength(2048, { message: 'Turnstile token must not exceed 2048 characters' })
    turnstileToken?: string;
    ```

#### B. TurnstileService & Outbound HTTP Verification
- **Implementation (`apps/api/src/modules/auth/turnstile.service.ts`)**:
  - Registered as an injectable provider in `AuthModule` (`apps/api/src/modules/auth/auth.module.ts`).
  - Core method: `async verify(token: string | undefined, remoteIp?: string): Promise<boolean>`.
  - Outbound HTTP uses global `fetch` with an `AbortController` timeout of 3000ms.
  - Request format: `POST` with `Content-Type: application/x-www-form-urlencoded` to `process.env.TURNSTILE_SITEVERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify'`.
  - Parameters: `secret` (the env value), `response` (the token), and `remoteip` (when `remoteIp` is provided).
  - Security invariant: Never logs secret keys or raw token values under any circumstance.

#### C. Environment Gating & Deployment Policy
- **Disabled Mode (Local Dev, CI, Keyless Deployments)**:
  - If `process.env.TURNSTILE_SECRET_KEY` is unset or empty, `TurnstileService.verify` immediately returns `true` without making any network call.
  - Keeps local development, existing unit/E2E test runs, and staging environments without provisioned keys behaving identically to before.
- **Enabled Mode (Production)**:
  - If `TURNSTILE_SECRET_KEY` is set and the submitted token is missing or empty, `TurnstileService.verify` returns `false` immediately without network call.
  - Production deployments MUST set `TURNSTILE_SECRET_KEY` on the API service and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` on the web application (deploy checklist item). The owner's Cloudflare Turnstile keys (Managed mode) are deploy-time environment variables only and are never committed to the repository.

#### D. Failure Semantics & Fail-Open Availability Tradeoff
- **Explicit Bot Rejection**:
  - When Cloudflare siteverify responds with HTTP 200 and JSON `success === false`, verification returns `false`. `AuthController.signup` blocks the request with HTTP 400 (`BadRequestException`: `'Bot verification failed. Please try again.'`).
- **Fail-Open on Infrastructure Outages**:
  - In the event of network timeout (3000ms AbortController), non-200 HTTP response, network unreachable/DNS failure, or unparseable JSON payload from Cloudflare, `TurnstileService` logs a warning via Nest `Logger` and returns `true`.
  - The method never throws exceptions.
  - **Deliberate Tradeoff**: A Cloudflare infrastructure outage must never cause complete unavailability for legitimate user signups. While bot resistance is degraded during a third-party outage, secondary defenses (per-IP rate limiting via `@nestjs/throttler` and per-account lockout policies) remain active.

#### E. Web Frontend Integration (`apps/web/src/app/signup/page.tsx`)
- **Conditional Script & Widget Rendering**:
  - Reads `process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY`. When unset or empty, no widget container is rendered and the submit flow is untouched.
  - When set, dynamically loads the explicit Turnstile script (`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`) and renders into a container div located after the terms checkbox and before the submit button.
  - Stores the token from the `callback` in component state; clears it on `expired-callback` and `error-callback`.
  - Removes the widget instance cleanly on component unmount via `turnstile.remove(widgetId)`.
- **Payload Submission Pattern**:
  - Appends `turnstileToken` to the API signup payload only when a token is held (`if (turnstileToken && turnstileToken.trim()) payload.turnstileToken = turnstileToken.trim();`), mirroring the conditional handling of `organizationName` and `workspaceName`.
  - Does not disable the submit button pending token acquisition; the backend is the authoritative enforcer and surfaces 400 errors through existing error alert banners.
  - Zero external npm packages (no `@marsidev/react-turnstile`).

### 3. Verification & Test Evidence

- **Turnstile Service Unit Tests (`apps/api/src/modules/auth/turnstile.service.spec.ts`)**:
  - 7/7 PASS:
    - (a) `no TURNSTILE_SECRET_KEY` -> returns `true`, `fetch` not called.
    - (b) `key set + token undefined/empty` -> returns `false`, `fetch` not called.
    - (c) `key set + siteverify returns { success: true }` -> returns `true`, verifies form-encoded POST body contains `secret`, `response`, and `remoteip`.
    - (d) `key set + siteverify returns { success: false }` -> returns `false`.
    - (e) `fetch rejects (network error/timeout)` -> returns `true` (fail-open) and logs warning.
    - (f) `non-200 response (HTTP 503)` -> returns `true` (fail-open) and logs warning.
    - (g) `unparseable JSON response` -> returns `true` (fail-open) and logs warning.
- **Auth Controller Unit Tests (`apps/api/src/modules/auth/auth.controller.spec.ts`)**:
  - 35/35 PASS (33 existing tests pass unchanged with mock `TurnstileService.verify` resolving `true`; 2 new tests verify `verify` resolving `false` throws `BadRequestException('Bot verification failed. Please try again.')` without calling `authService.signup`, and `verify` resolving `true` calls `authService.signup` with the submitted DTO).
- **Web Signup Page Unit Tests (`apps/web/src/app/signup/page.spec.tsx`)**:
  - 16/16 PASS (14 existing tests pass unchanged; 2 new tests verify: (a) with `NEXT_PUBLIC_TURNSTILE_SITE_KEY` unset, form renders without Turnstile container and submits payload without `turnstileToken`; (b) with site key set and `window.turnstile` stubbed, submitting sends payload with `turnstileToken: 'test-token-123'`).
- **Full API Unit Test Suite (`pnpm --filter @agency-os/api test`)**:
  - 40/40 test files PASS (previously 39), 520/520 tests PASS (previously 511; +7 in `turnstile.service.spec.ts`, +2 in `auth.controller.spec.ts`).
- **Full Web Unit Test Suite (`pnpm --filter @agency-os/web test`)**:
  - 21/21 test files PASS, 229/229 tests PASS (previously 227; +2 in `page.spec.tsx`).
- **NEW Dedicated API E2E Suite (`apps/api/test/turnstile.e2e-spec.ts`)**:
  - 1/1 test file PASS, 3/3 tests PASS:
    - Boots its own isolated NestJS application with an ephemeral local HTTP siteverify stub server on `127.0.0.1`.
    - (a) Omitted `turnstileToken` -> returns HTTP 400 with `error.message === 'Bot verification failed. Please try again.'`.
    - (b) Invalid `turnstileToken` (`wrong-token`) -> returns HTTP 400 with `error.message === 'Bot verification failed. Please try again.'`.
    - (c) Valid `turnstileToken` (`valid-test-token`) -> returns HTTP 201 with `{ message: 'Registration request received.' }` and cleans up provisioned tenant/user state.
  - Total E2E suite files in `apps/api/test/`: 6 -> 7 suites (`accounts`, `analytics`, `auth`, `billing`, `media.storage`, `publishing`, and `turnstile`).
- **Monorepo Code Quality**:
  - `pnpm turbo run lint typecheck build`: All 18 tasks PASS across 9 packages (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - 6/6 verified green check runs on head `9380a814a1cd441ab47d12de95c7d5e384c93ca3` (`9380a81`) (GitGuardian Security Checks 10:54:50Z, Application Builds 10:54:59Z, Code Quality (Lint & Typecheck) 10:55:11Z, Tests 10:55:42Z, API E2E Tests 10:55:43Z, Docker Build & Smoke Test 11:02:19Z, all 2026-11-16 UTC). CI must be re-verified on the new head after this docs update.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - Branch `feat/turnstile-signup` pushed; PR #76 open targeting `main`.
   - Do NOT merge on this prompt alone.

---

## 64. Per-Device Active Session Management (Phase B Item 5)

### 1. Summary & Motivation

- **Status**: **IN REVIEW** (Branch `feat/per-device-sessions`, PR #77)
- **Origin**: `docs/auth-production-readiness-report.md` (PR #62), Phase B item 5: "Store metadata (IP address, operating system, browser name, login timestamp) in Redis session hashes. Provide GET /api/v1/auth/sessions and DELETE /api/v1/auth/sessions/:sessionId endpoints. Add 'Active Sessions' card to workspace account settings."
- **Scope & Objectives**:
  - Deliver the final item of Phase B from the production auth readiness report: granular, per-device active session visibility and single-session revocation across the full stack.
  - Retain the proven atomic session string architecture with sliding TTL in Redis (`session:<sessionId>`), while adding optional metadata fields (`ipAddress`, `userAgent`) stored directly within the session JSON payload.
  - Implement a dedicated, dependency-free User-Agent parser (`apps/api/src/modules/auth/user-agent.util.ts`) providing accurate browser and operating system categorization without introducing external dependencies.
  - Expose authenticated, unthrottled read endpoint `GET /api/v1/auth/sessions` and throttled mutation endpoint `DELETE /api/v1/auth/sessions/:sessionId` with strict ownership verification (returning HTTP 404 on foreign session targets to prevent user enumeration).
  - Add `AUTH_SESSION_REVOKED` to `AuditAction` for non-repudiable audit logging.
  - Add an 'Active Sessions' card to workspace account settings in `apps/web/src/app/[workspaceId]/settings/page.tsx`, integrated into the dashboard sidebar navigation (`dashboard-shell.tsx`).
  - Zero new npm dependencies; zero schema migrations (`AuditLog.action` is a plain `String` column in Postgres).

### 2. Architecture & Implementation Details

#### A. Redis Session Storage & Read-Only getSessionData Helper
- **SessionData Model (`packages/session/src/SessionManager.ts`)**:
  - Extended `SessionData` with optional metadata:
    ```ts
    export interface SessionData {
      userId: string;
      createdAt: string;
      expiresAt: string;
      securityEpoch?: number;
      ipAddress?: string;
      userAgent?: string;
    }
    ```
- **Conditional Metadata Storage in createSession**:
  - Updated `createSession(userId: string, securityEpoch?: number, metadata?: { ipAddress?: string; userAgent?: string })`:
    ```ts
    const data: SessionData = {
      userId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ...(typeof securityEpoch === 'number' ? { securityEpoch } : {}),
      ...(metadata?.ipAddress && metadata.ipAddress.trim() ? { ipAddress: metadata.ipAddress } : {}),
      ...(metadata?.userAgent && metadata.userAgent.trim() ? { userAgent: metadata.userAgent } : {}),
    };
    ```
- **Read-Only getSessionData Helper**:
  - Implemented `getSessionData(sessionId: string): Promise<SessionData | null>`:
    - Executes a plain `redis.get(sessionKey)` and `JSON.parse`.
    - Returns `null` if the key is missing or on JSON `SyntaxError`.
    - **CRITICAL ARCHITECTURAL DECISION**: `getSessionData` does NOT call `VALIDATE_SESSION_SCRIPT`, does NOT refresh or slide the TTL, and does NOT execute Lua scripts. Pure inspection must never artificially prolong the life of idle sessions.

#### B. Dependency-Free User-Agent Parsing
- **Implementation (`apps/api/src/modules/auth/user-agent.util.ts`)**:
  - Zero-dependency parser with strictly ordered substring matching to avoid browser and OS ambiguity:
    - **Browser Order**:
      1. `Edg/` -> `Microsoft Edge` (before Chrome)
      2. `SamsungBrowser/` -> `Samsung Internet` (before Chrome)
      3. `OPR/` or `Opera` -> `Opera` (before Chrome)
      4. `Chrome/` or `CriOS` -> `Google Chrome` (before Safari)
      5. `Firefox/` or `FxiOS` -> `Firefox`
      6. `Safari/` -> `Safari`
      7. Fallback: `Unknown browser`
    - **OS Order**:
      1. `Windows NT` -> `Windows`
      2. `iPhone`, `iPad`, `CPU OS`, or `CPU iPhone OS` -> `iOS` (before macOS)
      3. `Android` -> `Android` (before Linux)
      4. `Mac OS X` or `Macintosh` -> `macOS`
      5. `Linux` -> `Linux`
      6. Fallback: `Unknown OS`
    - Empty, null, or whitespace-only User-Agents gracefully return `{ browser: 'Unknown browser', os: 'Unknown OS' }`.

#### C. AuthService Orchestration & Ownership Gating
- **Threaded Metadata on Login**:
  - Updated `AuthService.login(email, password, requestContext?)` to forward `requestContext` (`{ ipAddress, userAgent }`) into `this.sessionManager.createSession`.
- **listSessions(userId, currentSessionId?)**:
  - Fetches the user's active session IDs via `this.sessionManager.getUserSessionIds(userId)`.
  - For each ID, calls `getSessionData(sid)`. Missing or expired keys (raced out) are skipped.
  - Maps to `ActiveSessionDto` with parsed browser and OS, `isCurrent: sessionId === currentSessionId`, and sorts newest first (`new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()`).
  - Legacy sessions without stored metadata return `ipAddress: null`, `userAgent: null`, `browser: 'Unknown browser'`, `os: 'Unknown OS'`.
- **revokeSession(userId, sessionId)**:
  - Fetches active session IDs for the user: `const activeSessionIds = await this.sessionManager.getUserSessionIds(userId)`.
  - **Ownership Check**: If `!activeSessionIds.includes(sessionId)`, throws `new NotFoundException('Session not found')`.
  - Calling destroy without ownership verification would allow an attacker to probe or revoke arbitrary session IDs across tenants. The 404 response preserves anti-enumeration semantics by masking whether a session exists for another user.
  - On ownership match, destroys the session via `this.sessionManager.destroySession(sessionId)`.

#### D. AuthController & Audit Logging
- **GET /api/v1/auth/sessions**:
  - Protected with `@UseGuards(AuthGuard)`.
  - Unthrottled read (matching `/auth/me` parity).
  - Reads `req.cookies?.session`, delegating to `this.authService.listSessions(user.id, currentSessionId)`.
  - Returns `{ sessions: ActiveSessionDto[] }`.
- **DELETE /api/v1/auth/sessions/:sessionId**:
  - Protected with `@UseGuards(AuthGuard)` and `@Throttle({ default: RateLimitPolicies.auth })`.
  - Responds with HTTP 200 `@HttpCode(HttpStatus.OK)`.
  - Calls `await this.authService.revokeSession(user.id, sessionId)`.
  - Dispatches `AuditAction.AUTH_SESSION_REVOKED` via `this.auditService.logActionBestEffort` with `actorId: user.id`, `targetType: 'User'`, `targetId: user.id`, `metadata: { revokedSessionId: sessionId }`, `requestId`, `ipAddress`, and `userAgent`.
  - If `sessionId === req.cookies?.session`, invokes `this.clearSessionCookies(req, res)` to ensure current-device revocation clears authentication cookies immediately.
  - Returns `{ message: 'Session revoked successfully' }`.

#### E. Web Client & UX
- **Query Definition (`apps/web/src/lib/query/auth.ts`)**:
  - Exported `SessionInfo` interface and added `authQueries.sessions = () => queryOptions(...)` with `retry: false`.
- **Dashboard Sidebar Navigation (`apps/web/src/components/dashboard-shell.tsx`)**:
  - Added `{ name: 'Settings', href: `/${currentWorkspaceId}/settings`, icon: Settings }` to `navItems`.
- **Settings Page (`apps/web/src/app/[workspaceId]/settings/page.tsx`)**:
  - 'use client' page rendering an "Active Sessions" card with responsive icons (`Laptop`, `Smartphone`, `Globe`).
  - Displays device title (`${browser} on ${os}` or `'Unknown device'`), IP address (`session.ipAddress || 'Unknown IP'`), and human-readable sign-in timestamp.
  - Displays a green `'This device'` badge when `isCurrent` is true.
  - Renders a `'Revoke'` button only on non-current session rows (`!isCurrent`). The current session row has NO revoke button.
  - Includes loading skeleton state and error banner with retry option.

#### F. Backward Compatibility & Production Safety Note
- **Legacy Sessions**: Pre-existing sessions in Redis created prior to this PR have no `ipAddress` or `userAgent` keys. They deserialize cleanly with `ipAddress: null`, `userAgent: null`, `browser: 'Unknown browser'`, `os: 'Unknown OS'`.
- **Next Login Transition**: Each user's next login will automatically record their IP address and User-Agent in Redis, seamlessly upgrading their session metadata without requiring data backfills or downtime.

### 3. Verification & Test Evidence

- **Session Package Unit Tests (`packages/session/src/SessionManager.spec.ts`)**:
  - 19/19 tests PASS (previously 16; +3 new unit tests):
    1. `createSession with metadata stores ipAddress and userAgent in the session JSON`
    2. `createSession without metadata stores neither field`
    3. `getSessionData returns parsed data for existing key, null for missing key, and performs plain GET without calling eval/validate`
  - Total in package: 2/2 test files PASS, 29/29 tests PASS.
- **User-Agent Parser Unit Tests (`apps/api/src/modules/auth/user-agent.util.spec.ts`)**:
  - 11/11 tests PASS:
    - Undefined, null, empty string, and whitespace-only fallback to Unknown.
    - Chrome on Windows, Edge on Windows, Safari on macOS, Chrome on macOS.
    - Safari on iOS (priority over macOS).
    - Chrome on Android (priority over Linux).
    - Firefox on Linux, Samsung Internet on Android, Opera on Windows.
    - Unrecognized custom clients (`curl/7.88.1`).
- **AuthService Unit Tests (`apps/api/src/modules/auth/auth.service.spec.ts`)**:
  - 61/61 tests PASS (previously 55; +6 tests):
    - `login with requestContext passes ipAddress and userAgent metadata to createSession`.
    - `listSessions`: maps stored data, parses UA, marks `isCurrent` for matching cookie, sorts newest first.
    - `listSessions`: skips vanished sessions where `getSessionData` returns null.
    - `listSessions`: returns null IP/UA and Unknown browser/OS for legacy sessions without metadata.
    - `revokeSession`: destroys session when `sessionId` is owned by the user.
    - `revokeSession`: throws `NotFoundException` without calling `destroySession` when `sessionId` is not in user sessions.
- **AuthController Unit Tests (`apps/api/src/modules/auth/auth.controller.spec.ts`)**:
  - 40/40 tests PASS (previously 35; +5 tests):
    - `getSessions`: returns sessions list with `currentSessionId` read from cookies.
    - `getSessions`: passes `undefined` as `currentSessionId` when cookies are missing.
    - `revokeSession`: revokes non-current session, logs `AUTH_SESSION_REVOKED` audit action, and does NOT clear cookies.
    - `revokeSession`: revokes current session and clears session cookies.
    - `revokeSession`: propagates `NotFoundException` when session does not exist or belong to user.
- **API Unit Test Suite (`pnpm --filter @agency-os/api test`)**:
  - 41/41 test files PASS (previously 40; +1 new file `user-agent.util.spec.ts`), 542/542 tests PASS (previously 520; +22 tests).
- **Web Client Unit Tests (`apps/web/src/app/[workspaceId]/settings/page.spec.tsx` & `dashboard-shell.spec.tsx`)**:
  - `page.spec.tsx`: 6/6 tests PASS:
    1. Renders loading skeleton state initially.
    2. Renders error banner when query fails.
    3. Renders empty message when no active sessions are returned.
    4. Renders active sessions with device title, IP, 'This device' badge, and revoke button omitted on current device.
    5. Clicking Revoke calls `api.delete('auth/sessions/:sessionId')`.
    6. Displays error message when revoke mutation fails.
  - `dashboard-shell.spec.tsx`: 5/5 tests PASS.
  - Total in web package: 22/22 test files PASS, 235/235 tests PASS (previously 21 files, 229 tests).
- **Database Unit Tests (`packages/database`)**:
  - 13/13 test files PASS, 115/115 tests PASS.
- **API E2E Tests (`apps/api/test/auth.e2e-spec.ts`)**:
  - 1/1 test file PASS, 43/43 tests PASS (previously 38 tests; +5 tests in `Per-Device Active Session Management (e2e)`):
    1. Fails with 401 when fetching sessions without session cookie.
    2. Lists single active session with parsed Chrome on Windows, non-empty IP, and `isCurrent: true` on initial login.
    3. Second login with Safari on iPhone creates second session and lists both with correct `isCurrent` flags and sorting.
    4. `DELETE /api/v1/auth/sessions/:sessionId` revokes non-current session, invalidates access to `/me`, and emits `AUTH_SESSION_REVOKED` audit record with `metadata.revokedSessionId`.
    5. `DELETE /api/v1/auth/sessions/:sessionId` with unknown or foreign ID returns 404 `'Session not found'`.
- **Monorepo Code Quality (`pnpm turbo run lint typecheck build`)**:
  - 18/18 tasks PASS across 9 packages (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - 6/6 verified green check runs on head `8d6b5a4bf06b4eb536e5988398bfa2818e1924c9` (`8d6b5a4`) (GitGuardian Security Checks 12:07:31Z, Application Builds 12:08:25Z, Code Quality (Lint & Typecheck) 12:08:34Z, API E2E Tests 12:09:12Z, Tests 12:09:14Z, Docker Build & Smoke Test 12:16:19Z, all 2026-11-16 UTC). CI must be re-verified on the new head after this docs update.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - Branch `feat/per-device-sessions` pushed; PR #77 open targeting `main`.
   - Do NOT merge on this prompt alone.

---

## 65. Change Password UI in Account Settings

### 1. Summary & Motivation

- **Status**: **IN REVIEW** (Branch `feat/change-password-ui`, PR #78)
- **Origin**: The backend endpoint `POST /api/v1/auth/change-password` has been live since PR #48 (session invalidation + security epoch), hardened in PR #54 (revoke-all endpoint + change-password follow-ups) and PR #73 (password policy + HIBP check on change), but lacked user-facing UI in the web client. The workspace account settings page (`apps/web/src/app/[workspaceId]/settings/page.tsx`) was introduced in PR #77 for Active Sessions management.
- **Scope & Objectives**:
  - Add a dedicated "Change Password" card directly below the Active Sessions card on the account settings page.
  - Follow the visual chrome, banners, and layout conventions of the Active Sessions card directly above and the form conventions of existing authentication pages.
  - Display policy helper text up front under the new password input so users discover complexity requirements before attempting submission.
  - Enforce client-side validation on submit before dispatching network requests (rejecting empty fields, passwords < 8 or > 128 characters, or confirmation mismatches).
  - Call `api.post('auth/change-password', { currentPassword, newPassword })` using a `useMutation` without sending confirmation fields over the wire.
  - Surface server responses faithfully: green success banner for normal password changes, amber warning banner when session cleanup is deferred (`sessionCleanupDeferred: true`), and red error banner with `err.message` from `ApiError`.
  - Invalidate the `['auth', 'sessions']` query on success to automatically refresh the Active Sessions card above (since other devices are signed out).
  - Scope strictly confined to `apps/web/src/app/[workspaceId]/settings/page.tsx`, `page.spec.tsx`, and `IMPLEMENTATION_STATUS.md`. Zero new npm dependencies; no changes to API, query definitions, dashboard navigation, or dependencies.

### 2. Architecture & Implementation Details

#### A. Backend API Contract
- **Route & Security**:
  - Endpoint: `POST /api/v1/auth/change-password`
  - Transport Guard: `@UseGuards(AuthGuard)` with session cookie authentication and `@Throttle({ default: RateLimitPolicies.auth })`.
  - Request DTO (`ChangePasswordDto`):
    ```ts
    export class ChangePasswordDto {
      @IsString()
      @IsNotEmpty({ message: 'Current password is required' })
      currentPassword!: string;

      @IsString()
      @IsNotEmpty({ message: 'New password is required' })
      @MinLength(8, { message: 'New password must be at least 8 characters long' })
      @MaxLength(128, { message: 'New password must not exceed 128 characters' })
      newPassword!: string;
    }
    ```
- **Response Shapes**:
  - Standard Success: `{ message: 'Password changed successfully' }`
  - Deferred Cleanup Success:
    ```json
    {
      "message": "Password changed successfully, but terminating other active sessions failed. Stale sessions will be invalidated on their next request via security epoch enforcement.",
      "sessionCleanupDeferred": true
    }
    ```
  - Rejection / Error: HTTP 400/401/403/429 with `{ error: { code, message, requestId } }` (produced by `AllExceptionsFilter`). Captured as an `ApiError` instance where `err.message` contains the server copy.

#### B. Component Architecture & UI Conventions
- **Component File**: `apps/web/src/app/[workspaceId]/settings/page.tsx`
- **Visual Chrome**:
  - Rendered in a matching card container (`bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden`) directly beneath the Active Sessions card.
  - Card Header: `<Lock className="w-5 h-5 text-blue-600" aria-hidden="true" />`, title `"Change Password"`, and subtitle `"Change your password to keep your account secure. You will stay signed in on this device; all other devices will be signed out."`.
- **Form Controls & Labels**:
  - Three password inputs (`type="password"`):
    1. `"Current password"` (`id="currentPassword"`, `autoComplete="current-password"`)
    2. `"New password"` (`id="newPassword"`, `autoComplete="new-password"`) with persistent helper text: `"At least 8 characters, with uppercase, lowercase, a number, and a special character."`
    3. `"Confirm new password"` (`id="confirmNewPassword"`, `autoComplete="new-password"`)
  - No password visibility toggles (consistent with existing auth pages).
- **Client-Side Validation on Submit**:
  - Evaluated on submit before any network request:
    1. Any empty field -> `'All fields are required.'`
    2. `newPassword.length < 8` -> `'New password must be at least 8 characters long'`
    3. `newPassword.length > 128` -> `'New password must not exceed 128 characters'`
    4. `newPassword !== confirmNewPassword` -> `'New password and confirmation do not match.'`
  - When validation fails, the first error is rendered in the red error banner and `api.post` is NOT called.
- **Banners & Feedback**:
  - Red Error Banner (`bg-red-50 text-red-700 border-red-200` with `<AlertCircle>`): Displays client validation error or `err.message` from `ApiError`.
  - Green Success Banner (`bg-green-50 text-green-700 border-green-200` with `<CheckCircle2>`): Displays `response.message` verbatim.
  - Amber Warning Banner (`bg-amber-50 text-amber-800 border-amber-200` with `<AlertTriangle>`): Displays `response.message` when `response.sessionCleanupDeferred` is true.
  - On success: Clears all three inputs and executes `queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] })`.
- **Button State**:
  - Label: `'Change Password'`.
  - Disabled during pending mutation; label becomes `'Changing...'`.

#### C. Design Decisions
1. **Helper Text Up Front**: Password complexity policy is displayed persistently below the new password input so users discover formatting constraints prior to submission rather than after receiving an API rejection.
2. **Session Query Invalidation**: Password changes in the backend terminate all other active sessions for the user; invalidating `['auth', 'sessions']` ensures the Active Sessions card directly above synchronizes its device list immediately.
3. **No Confirmation Over Wire**: Redundant confirmation fields are strictly validated in the browser and omitted from the HTTP payload.

### 3. Verification & Test Evidence

- **Settings Page Unit Tests (`apps/web/src/app/[workspaceId]/settings/page.spec.tsx`)**:
  - Adapted test harness via `vi.hoisted` to export `MockApiError` as `ApiError` and mock `api.post`.
  - 12/12 tests PASS (previously 6; +6 new tests):
    1. `renders loading state initially` (Active Sessions)
    2. `renders error banner when query fails` (Active Sessions)
    3. `renders empty message when no active sessions are returned` (Active Sessions)
    4. `renders active sessions with device title, IP, This device badge, and revoke button logic` (Active Sessions)
    5. `clicking Revoke calls api.delete with session id` (Active Sessions)
    6. `displays error message when revoke mutation fails` (Active Sessions)
    7. `renders the Change Password card with the three labelled fields and the policy helper text` (Change Password #1)
    8. `submitting with a mismatched confirmation shows "New password and confirmation do not match." and api.post is NOT called` (Change Password #2)
    9. `submitting with a new password shorter than 8 characters shows "New password must be at least 8 characters long" and api.post is NOT called` (Change Password #3)
    10. `a valid submit calls api.post with exactly ("auth/change-password", { currentPassword, newPassword }), shows success banner and clears all three fields` (Change Password #4)
    11. `a server rejection (mocked ApiError with message "Invalid credentials") shows that message in the error banner` (Change Password #5)
    12. `a deferred-cleanup success response shows the deferred message as the banner content` (Change Password #6)
- **Web Package Test Suite (`pnpm --filter @agency-os/web test`)**:
  - 22/22 test files PASS, 241/241 tests PASS (previously 235; +6 tests).
- **API, Database, and Session Suites**:
  - Untouched by this PR (API 41 files 542 tests, DB 13 files 115 tests, Session 2 files 29 tests).
- **Monorepo Code Quality (`pnpm turbo run lint typecheck build`)**:
  - All 18 tasks across 9 packages PASS (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - 6/6 verified green check runs on head `48c0121ec35f727869d1c44dfb5176ae2b92d793` (`48c0121`) (GitGuardian Security Checks 19:06:06Z, Application Builds 19:07:02Z, Code Quality (Lint & Typecheck) 19:07:31Z, API E2E Tests 19:07:49Z, Tests 19:07:52Z, Docker Build & Smoke Test 19:15:43Z, all 2026-11-16 UTC). CI must be re-verified on the new head after this docs update.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - Branch `feat/change-password-ui` pushed; PR #78 open targeting `main`.
   - Do NOT merge on this prompt alone.

---

## 66. Public Landing Page & Root Route Reachability

### 1. Summary & Motivation

- **Status**: **IN PROGRESS** (PR #79, branch `feat/landing-page`, reviewed head `fd291ad78adb60b117a6f3eff90ecd6ba38b3987`)
- **Origin**: GTM decision 2026-10-09 (risk-reversal leads; Razorpay activation and platform-review needs). Previously, `apps/web/src/app/page.tsx` was a bare `redirect('/dashboard')` with no public face to the product. A public, production-grade landing page is essential for three critical requirements:
  1. **Razorpay Activation**: Payment gateway compliance requires a live, operational website clearly describing the product, operating entity, pricing, and policy links.
  2. **Platform App Reviews**: Meta (Facebook/Instagram) and Google/YouTube reviewer compliance require a public-facing domain outlining app functionality and data practices.
  3. **Customer Acquisition**: Potential agency customers need an informative, conversion-focused entry point with transparent pricing and risk-reversal guarantees before initiating a trial.
- **Scope & Constraints**:
  - Scope strictly confined to `apps/web/src/app/page.tsx`, `apps/web/src/app/page.spec.tsx`, `apps/web/src/app/layout.tsx` (metadata only), `apps/web/src/components/auth-guard.tsx` (`'/'` entry only), `apps/web/src/components/auth-guard.spec.tsx`, and `IMPLEMENTATION_STATUS.md`.
  - Zero new npm dependencies; no modifications to API code, database schema, other web routes, or `package.json`.
  - Built strictly as a Next.js Server Component (no `'use client'`, no client-side hooks, no dynamic data fetching).
  - Strict compliance with copy and feature truthfulness constraints: strictly shipped features, no social proof, and monthly pricing only.

### 2. Architecture & Implementation Details

#### A. AuthGuard Public Route Reachability Fix
- **Problem**: `AuthGuard` in `apps/web/src/components/auth-guard.tsx` wraps the entire application within the root layout (`apps/web/src/app/layout.tsx`). Previously, `PUBLIC_ROUTES` included only authentication routes (`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`) and legal pages (`/terms`, `/privacy`, `/refund-cancellation`). Because `'/'` was omitted, any unauthenticated visitor landing on the root URL was immediately intercepted and redirected to `/login?redirect=%2F`, rendering the landing page completely inaccessible to logged-out users.
- **Fix**: Added `'/'` to `PUBLIC_ROUTES` in `apps/web/src/components/auth-guard.tsx`:
  ```ts
  const PUBLIC_ROUTES = [
    '/',
    '/login',
    '/signup',
    '/verify-email',
    '/forgot-password',
    '/reset-password',
    '/terms',
    '/privacy',
    '/refund-cancellation',
  ];
  ```
- **Invariant Preserved**: Logged-in users visiting `/` can still browse the landing page (or navigate into their workspace via existing nav/dashboards), while unauthenticated users can view the full landing page without being bounced to `/login`.

#### B. Content Rules & Feature Truthfulness
- **Shipped Capabilities Only**: The page strictly advertises functionality built, tested, and shipped in Agency OS:
  - Multi-platform publishing to Facebook, Instagram, LinkedIn, and YouTube.
  - Post scheduling with queue management and calendar/list views.
  - Per-platform content variants tailored for each network.
  - Media library with secure presigned upload and attachment validation.
  - Unified analytics dashboard with engagement, reach, and performance metrics.
  - Multi-tenant workspaces with role-based access control (Owner, Manager, Editor, Client Approver, Viewer).
  - Enterprise account security with per-device session management and login lockout protections.
  - Automated GST-compliant invoicing with input tax credit support.
- **Forbidden Unbuilt Capabilities Omitted**: As mandated, the page strictly omits:
  - `white-label` (no white-labeling or custom agency branding features exist).
  - `AI caption` (no AI caption generation features exist).
  - `approval workflow` (client approval workflows are not yet fully implemented).
- **Zero Social Proof**: The page contains no testimonials, customer logos, case studies, or "trusted by" statements.
- **Transparent Pricing & Figure Discipline**:
  - Displays the 3 monthly tiers from billing configuration:
    - **Solo**: ₹499/month (1 seat, all 4 platforms).
    - **Studio**: ₹999/month (3 seats, team collaboration).
    - **Agency**: ₹3,999/month (10 seats, full agency toolset).
  - All tiers explicitly state "GST inclusive (18%)" and provide clear "Start 14-day free trial" CTAs pointing to `/signup`.
  - Mentions the annual incentive as "Annual billing: 2 months free".
  - **Annual Totals Omitted**: Specific annual rupee figures (e.g., ₹4,990 vs ₹4,999) are deliberately omitted because of an unresolved discrepancy between legal terms and billing code.
  - Highlights the **Founding 50** promotion on the Agency tier: "Founding 50 — ₹2,999/month, price locked while your subscription stays active, for the first 50 customers."

#### C. Section Ordering & Page Structure
1. **Header / Navigation**: Brand wordmark `Agency OS`, secondary link `Sign in` (`/login`), and primary CTA `Start free trial` (`/signup`).
2. **Hero Section**:
   - Headline: `Social media management for agencies and small teams — plan, publish, and measure client accounts from one workspace`
   - Supporting copy emphasizing workflow efficiency and account isolation.
   - Primary CTA `Start 14-day free trial` (`/signup`), secondary CTA `Sign in` (`/login`).
   - Reassurance microcopy: `No credit card required.`.
3. **Risk-Reversal Strip**: Positioned immediately after hero and before feature details to address buyer friction up front:
   - `14-day free trial — no credit card`
   - `Monthly billing — cancel anytime`
   - `7-day money-back guarantee`
   - `UPI and cards accepted via Razorpay`
   - `GST invoice on every payment`
   - `Prices include GST`
4. **How It Works (3 Steps)**:
   - Step 1: `Connect your accounts` (Meta, YouTube, LinkedIn).
   - Step 2: `Compose and schedule` (custom variants and media).
   - Step 3: `Publish and measure` (automated queue and unified analytics).
5. **Features Grid**: Shipped capabilities highlighting multi-network publishing, scheduling, analytics, team RBAC, per-device session security, and GST invoicing.
6. **Pricing Section**: Solo (₹499/mo), Studio (₹999/mo), and Agency (₹3,999/mo) cards with Founding 50 callout, feature breakdowns, and `/signup` trial links.
7. **FAQ**: Clear, factual answers covering trial terms, accepted payment methods (UPI & cards via Razorpay), GST breakdown (18%), cancellation/refund policy (linking to `/refund-cancellation`), and supported social networks.
8. **Footer**: Legal operator copyright `© Gadmale Technologies`, support contact `agadmale335@gmail.com`, and links to `/terms`, `/privacy`, and `/refund-cancellation`.

#### D. Metadata Optimization
- Updated root layout `apps/web/src/app/layout.tsx`:
  - Title: `"Agency OS — Social Media Management for Agencies"`
  - Description: `"Plan, publish, and measure social media for your clients across Facebook, Instagram, LinkedIn, and YouTube — from one workspace."`

### 3. Verification & Test Evidence

- **Landing Page Unit Tests (`apps/web/src/app/page.spec.tsx`)**:
  - 5/5 tests PASS:
    1. `renders hero with headline, CTAs, and microcopy`
    2. `renders all risk-reversal strip items`
    3. `renders pricing tiers with exact figures, GST notice, Founding 50 callout, and trial CTAs`
    4. `renders footer with operator copyright, email, and legal links`
    5. `does NOT mention forbidden unbuilt capabilities or fake social proof (white-label, AI caption, approval workflow, testimonial, trusted by)`
- **AuthGuard Unit Tests (`apps/web/src/components/auth-guard.spec.tsx`)**:
  - 21/21 tests PASS (previously 20; +1 test):
    - Added test: `renders landing page on / without redirecting to login` under unauthenticated visitor tests.
- **Web Package Test Suite (`pnpm --filter @agency-os/web test`)**:
  - 23/23 test files PASS, 247/247 tests PASS (previously 22 files, 241 tests; +1 file, +6 tests).
- **Monorepo Code Quality (`pnpm turbo run lint typecheck build`)**:
  - All 18 tasks across 9 packages PASS (0 errors).
  - Next.js Turbopack build succeeds with `/` generated as a static prerendered page `○ (Static)`.

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI 6/6 green on reviewed head `fd291ad78adb60b117a6f3eff90ecd6ba38b3987`: GitGuardian Security Checks 15:48:20Z, Application Builds 15:49:15Z, Code Quality (Lint & Typecheck) 15:49:28Z, Tests 15:50:05Z, Docker Build & Smoke Test 15:56:05Z, API E2E Tests 16:04:41Z (all 2026-11-17 UTC). Note: CI must be re-verified on the new head after this docs-only fix.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #79 is open against `main` at the reviewed head with CI 6/6 green. Next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone.

---

## 67. LinkedIn OAuth Scope Parsing Bug Fix

### 1. Summary & Motivation

- **Status**: implemented on branch `fix/linkedin-scope-parsing`; PR #80 open against main at reviewed head `ac5e1e69705db38a197559a2a454ee3f665170a9`
- **Origin**: During the first live LinkedIn connect test (2026-11-18), a production bug was confirmed: the LinkedIn account connected successfully, but the Accounts page permanently displayed `Publishing Unavailable`, and clicking "Grant Publishing Access" never cleared the error state.
- **Database Evidence**: Inspection of the live database revealed that `SocialConnection.grantedScopes` was stored as `{"email,openid,profile,w_member_social"}` — a ONE-element array containing the entire comma-delimited scope string.
- **Root Cause**:
  - The OAuth 2.0 specification allows providers to format granted scope strings. LinkedIn's token endpoint (`https://www.linkedin.com/oauth/v2/accessToken`) documents and returns the `scope` response field as a COMMA-separated string (e.g. `"r_liteprofile,r_emailaddress,w_member_social"` or `"email,openid,profile,w_member_social"`).
  - `packages/providers/linkedin/linkedin.provider.ts` erroneously parsed `data.scope` with `data.scope.split(' ')` in two locations: `exchangeAuthorizationCode` and `refreshCredentials`.
  - Splitting a comma-separated string on spaces resulted in a single mangled array element: `["email,openid,profile,w_member_social"]`.
  - Downstream, `getCapabilities` evaluates `context.grantedScopes?.includes('w_member_social')`. Because `"email,openid,profile,w_member_social"` !== `"w_member_social"`, the lookup failed unconditionally, preventing the `POST_PUBLISH` capability from ever being computed or persisted.
- **Why CI Never Caught It**:
  - In `packages/providers/linkedin/linkedin.provider.spec.ts`, the mock token-response fixtures for `exchangeAuthorizationCode` and `refreshCredentials` encoded the exact same false assumption by supplying `scope: 'openid profile email'` (space-separated). The unit tests passed because the test fixtures matched the bug rather than the provider's actual API contract.
- **Operator Note (No Migration Needed)**:
  - Existing connections in the database store the mangled single-element array. Following deployment of this fix, performing a fresh "Grant Publishing Access" or reconnecting the LinkedIn account invokes `exchangeAuthorizationCode` and re-stores the cleanly parsed scopes and `POST_PUBLISH` capability via `SocialAccountRepository.upsertWithConnection`. No database migration is necessary.
- **Deliberate Exclusions**:
  - `getAuthorizationUrl` joins requested scopes with spaces (`this.BASE_SCOPES.join(' ')` or Set iteration), which is the standard OAuth 2.0 query parameter format required by LinkedIn's authorization endpoint — this is correct and intentionally untouched.
  - The YouTube provider's `data.scope.split(' ')` is correct because Google genuinely returns space-separated scopes — intentionally untouched.
  - The Meta provider does not parse `data.scope` — intentionally untouched.
  - The `OAuthCallbackQueryDto` error-description handling gap is a separate issue and out of scope for this PR.

### 2. Architecture & Implementation Details

#### A. Provider Scope Parser Helper (`packages/providers/linkedin/linkedin.provider.ts`)
- Added a shared module-level helper function `parseGrantedScopes`:
  ```ts
  function parseGrantedScopes(scope: string | undefined): string[] {
    if (!scope) return ['openid', 'profile', 'email'];
    const parsed = scope.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    return parsed.length > 0 ? parsed : ['openid', 'profile', 'email'];
  }
  ```
- Uses `/[\s,]+/` regex to robustly split across commas, spaces, or both, trims each scope, filters out empty tokens, and safely falls back to base scopes `['openid', 'profile', 'email']`.
- Updated call sites:
  - `exchangeAuthorizationCode`: `scopes: parseGrantedScopes(data.scope)`
  - `refreshCredentials`: `scopes: parseGrantedScopes(data.scope)`
- Preserved all other provider interfaces, constants (`BASE_SCOPES`, `ALLOWED_SCOPES`), and methods.

#### B. Test Suite Updates (`packages/providers/linkedin/linkedin.provider.spec.ts`)
- **Corrected Existing Fixtures**:
  - `exchangeAuthorizationCode` fixture updated from `scope: 'openid profile email'` to `scope: 'email,openid,profile'`; asserted `expect(creds.scopes).toEqual(['email', 'openid', 'profile'])`.
  - `refreshCredentials` fixture updated from `scope: 'openid profile email'` to `scope: 'email,openid,profile'`; asserted `expect(creds.scopes).toEqual(['email', 'openid', 'profile'])`.
- **Added Regression Test**:
  - Mocks token response with LinkedIn's live response format: `scope: 'email,openid,profile,w_member_social'`.
  - Asserts `creds.scopes` equals `['email', 'openid', 'profile', 'w_member_social']` (4 elements). Under the pre-fix code, this returned a single element `['email,openid,profile,w_member_social']` and failed.
- **Added Robustness Test**:
  - Asserts that space-separated scope strings (`'openid profile email'`) still parse cleanly to `['openid', 'profile', 'email']`.
- **Added Capability Integration Test**:
  - Asserts that `getCapabilities` with `grantedScopes: ['email', 'openid', 'profile', 'w_member_social']` and `externalId: 'urn:li:person:123'` computes and returns capabilities including `'POST_PUBLISH'`.

### 3. Verification & Test Evidence

- **Providers Unit Test Suite (`pnpm --filter @agency-os/providers test`)**:
  - 15/15 test files PASS, 244/244 tests PASS (previously 241; +3 tests).
  - `linkedin.provider.spec.ts`: 14/14 tests PASS (previously 11; +3 tests).
- **Monorepo Quality Gates (`pnpm turbo run lint typecheck build`)**:
  - All 18 tasks across 9 packages PASS (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `ac5e1e6` is 6/6 green (all 2026-11-18): GitGuardian Security Checks 08:44:10Z, Application Builds 08:45:06Z, Code Quality (Lint & Typecheck) 08:45:28Z, API E2E Tests 08:45:29Z, Tests 08:46:04Z, Docker Build & Smoke Test 08:53:09Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #80 is open against main; CI was 6/6 green on the reviewed head `ac5e1e6`; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone.









---

## 69. YouTube OAuth Publishing Scope Fix

*(Note: Section 68 is reserved for the OAuthCallbackQueryDto error_description fix, per task specification)*

### 1. Summary & Motivation

- **Status**: implemented on branch `fix/youtube-publishing-scope`; PR #81 open against main at reviewed head `5f57336ace73cc2f04f82c50429d97768d7c3419`
- **Origin**: During the first live YouTube connect test (2026-11-18), a production bug was confirmed: the YouTube channel connected successfully, but the Accounts page permanently displayed `Publishing Unavailable`, and clicking "Grant Publishing Access" never cleared the error state.
- **Root Cause**:
  - The YouTube provider (`packages/providers/youtube/youtube.provider.ts`) defaults to requesting only `'https://www.googleapis.com/auth/youtube.readonly'`.
  - Its `ALLOWED_SCOPES` already includes `'https://www.googleapis.com/auth/youtube.upload'`, and `getCapabilities` already returns `POST_PUBLISH` when that scope is among the granted scopes.
  - The connect endpoint (`POST /workspaces/:workspaceId/oauth/youtube/connect`) already accepts an optional `?scopes=` query parameter (comma-separated) and passes requested scopes through to Google OAuth.
  - No backend change was needed or permitted.
  - The bug was frontend-only:
    1. In `apps/web/src/app/[workspaceId]/accounts/page.tsx`: `handleConnectYoutube` initiated the connect flow via `api.post('workspaces/${workspaceId}/oauth/youtube/connect')` without specifying any `scopes` parameter, causing Google to grant only the default `readonly` scope.
    2. In `apps/web/src/components/account-card.tsx`: `handleReconnect` only appended `?scopes=w_member_social` for LinkedIn when `forceScopes` was set (i.e. on clicking "Grant Publishing Access"), and never passed scopes for YouTube.
- **Operator Note (No Migration Needed)**:
  - After deploying this fix, existing connected YouTube accounts require no database migration or reconnect from scratch. Clicking "Grant Publishing Access" on a connected YouTube account re-consents with the upload scope and re-stores scopes and capabilities via the existing upsert.
- **Deliberate Exclusions**:
  - Strictly no backend or provider changes (`packages/providers/` and `apps/api/` remain untouched).
  - Zero new npm dependencies.

### 2. Architecture & Implementation Details

#### A. Web Connect Action (`apps/web/src/app/[workspaceId]/accounts/page.tsx`)
- In `handleConnectYoutube`, updated the connect URL to include the upload scope:
  ```ts
  const res = await api.post<{ url: string }>(
    `workspaces/${workspaceId}/oauth/youtube/connect?scopes=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload')}`
  );
  ```

#### B. Web Reconnect Action (`apps/web/src/components/account-card.tsx`)
- In `handleReconnect`, made the `forceScopes` branch provider-aware so YouTube requests the upload scope:
  ```ts
  if (forceScopes) {
    if (account.provider === 'LINKEDIN') {
      url += '?scopes=w_member_social';
    } else if (account.provider === 'YOUTUBE') {
      url += `?scopes=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload')}`;
    }
  }
  ```

#### C. Test Suite Updates
- `apps/web/src/app/[workspaceId]/accounts/page.spec.tsx`:
  - Updated test (g) to assert `mockApiPost` is called with the URL containing `scopes=` and verified the decoded parameter equals `'https://www.googleapis.com/auth/youtube.upload'`.
- `apps/web/src/components/account-card.spec.tsx`:
  - Updated YouTube Grant Publishing Access test to assert `api.post` is called with the URL containing `scopes=` and verified the decoded parameter equals `'https://www.googleapis.com/auth/youtube.upload'`.

### 3. Verification & Test Evidence

- **Web Unit Tests (`pnpm --filter @agency-os/web test`)**:
  - 23/23 test files PASS, 247/247 tests PASS.
  - `accounts/page.spec.tsx`: 11/11 tests PASS.
  - `account-card.spec.tsx`: 16/16 tests PASS.
- **Monorepo Quality Gates (`pnpm turbo run lint typecheck build`)**:
  - All 18 tasks across 9 packages PASS (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `5f57336a` is 6/6 green (all 2026-11-18): GitGuardian Security Checks 11:00:28Z, Application Builds 11:01:32Z, Code Quality (Lint & Typecheck) 11:01:51Z, API E2E Tests 11:02:06Z, Docker Build & Smoke Test 11:09:47Z, Tests 11:23:56Z. The Tests job's first attempt failed at 11:01:56Z in the apps/worker package (untouched by this PR) and passed on re-run at 11:23:56Z with no code change; the Tests job was also green on base main `84e08f20` the same morning. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #81 is open against main; CI was 6/6 green on the reviewed head `5f57336a` (Tests green on re-run after a first-attempt worker flake); next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone.


---

## 70. YouTube Publishing Permission Upgrade Scope Fix

*(Note: Section 68 remains reserved for the OAuthCallbackQueryDto error_description fix, per task specification; Section 69 was PR #81)*

### 1. Summary & Motivation

- **Status**: implemented on branch `fix/youtube-upgrade-scope`; PR #82 open against main at reviewed head `d6292fca3be8e186e6cdbb278eba7f33bb6e3bf4`
- **Origin**: During the live test immediately after PR #81 merged (2026-11-18), clicking the "Enable YouTube publishing access" button on the Publishing edit page (`/[workspaceId]/publishing/[postId]`) failed with `Failed to initiate permission upgrade.` The live API error log revealed: `Invalid or unauthorized OAuth scope requested: youtube.upload`.
- **Root Cause**:
  - PR #81 corrected the YouTube connect URL in `accounts/page.tsx` and the reconnect URL in `account-card.tsx` to pass the full URL `https://www.googleapis.com/auth/youtube.upload`.
  - However, a third scope-carrying connect call site was missed: `apps/web/src/app/[workspaceId]/publishing/[postId]/page.tsx`, `handleConnectUpgrade`, which sent `workspaces/${workspaceId}/oauth/youtube/connect?scopes=youtube.upload` using the short scope name.
  - The YouTube provider's `getAuthorizationUrl` validates requested scopes strictly against `ALLOWED_SCOPES`, which contains only full URLs (`'https://www.googleapis.com/auth/youtube.readonly'`, `'https://www.googleapis.com/auth/youtube.upload'`). Because `'youtube.upload'` does not match, the provider threw an exception, the API returned 500, and the upgrade flow failed.
- **Operator Note (No Migration Needed)**:
  - After this fix, either the Publishing page upgrade button or the Accounts card's "Grant Publishing Access" completes the YouTube permission upgrade. No database migration and no reconnect from scratch are required.
- **Deliberate Exclusions**:
  - Zero backend/provider changes (the backend validation against `ALLOWED_SCOPES` is correct).
  - Scope is strictly limited to `apps/web/src/app/[workspaceId]/publishing/[postId]/page.tsx`, `page.spec.tsx`, and `IMPLEMENTATION_STATUS.md`.
  - Zero new npm dependencies.

### 2. Architecture & Implementation Details

#### A. Web Upgrade Action (`apps/web/src/app/[workspaceId]/publishing/[postId]/page.tsx`)
- In `handleConnectUpgrade`, changed the connect URL to pass the fully qualified URL encoded with `encodeURIComponent`, matching PR #81:
  ```ts
  const res = await api.post<{ url: string }>(
    `workspaces/${workspaceId}/oauth/youtube/connect?scopes=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload')}`
  );
  ```
- All other logic (saving the draft before the call, redirecting to `res.url`, and error handling) remains untouched.

#### B. Test Suite Updates (`apps/web/src/app/[workspaceId]/publishing/[postId]/page.spec.tsx`)
- Added a dedicated test: `handleConnectUpgrade initiates OAuth with encoded youtube.upload scope`.
- Asserts that when a YouTube account without `POST_PUBLISH` is selected as a destination, clicking "Enable YouTube publishing access" calls `api.post` with the exact URL containing the encoded scope parameter, and asserts that decoding `scopes` yields `'https://www.googleapis.com/auth/youtube.upload'`.

### 3. Verification & Test Evidence

- **Web Unit Tests (`pnpm --filter @agency-os/web test`)**:
  - 23/23 test files PASS, 248/248 tests PASS (including the new upgrade scope test in `page.spec.tsx` [31/31 tests PASS]).
- **Monorepo Quality Gates (`pnpm turbo run lint typecheck build`)**:
  - All 18 tasks across 9 packages PASS (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `d6292fca` is 6/6 green (all 2026-11-18): GitGuardian Security Checks 12:06:08Z, Application Builds 12:06:55Z, Code Quality (Lint & Typecheck) 12:07:31Z, Tests 12:07:52Z, API E2E Tests 12:07:54Z, Docker Build & Smoke Test 12:14:44Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #82 is open against main; CI was 6/6 green on the reviewed head `d6292fca`; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone.


---

## 71. YouTube Publishability Contract Harmonization & Options Alignment

*(Note: Section 68 remains reserved for the OAuthCallbackQueryDto error_description fix, per task specification; Section 69 was PR #81; Section 70 was PR #82)*

### 1. Summary & Motivation

- **Status**: implemented on branch `fix/youtube-publishability-contracts`; PR #83 open against main at reviewed head `26ed6ec4cbcb29926dcc9017ea89b8069a462667`
- **Origin**: During the first real YouTube publish attempt (2026-11-18), publication was rejected with `PUBLISHABILITY_FAILED`. The API error log revealed three distinct validation issues:
  1. MIME constraint rejection: The attached video was rejected because `getPublishingCapabilities()` declared `mimeTypes: ["video/*"]`, whereas `PublishabilityValidator` and `execution.validator` perform exact inclusion checks (`!constraint.mimeTypes.includes(asset.mimeType)` against `'video/mp4'`).
  2. `PROVIDER_OPTION_INVALID` for `privacyStatus`: The live validation log recorded: `Invalid enum value. Expected 'public' | 'private' | 'unlisted', received 'PUBLIC'` — the variant that failed carried `'PUBLIC'` (the uppercase `'PRIVATE'` was the add-target default in code), whereas `YouTubeProviderOptionsSchema` strictly validates against lowercase enum `['public', 'private', 'unlisted']`, matching the YouTube Data API contract.
  3. `PROVIDER_OPTION_INVALID` (no field) — `"Unrecognized key(s) in object: 'title'"`: `YouTubeProviderOptionsSchema` is `.strict()` and omitted `title`, even though `publish()` reads `options.title`, capabilities advertise `'TITLE'`, and web sends `title`.
- **Root Causes**:
  1. *Wildcard MIME vs. exact match*: `youtube.provider.ts` used a wildcard `["video/*"]` rather than listing the concrete video MIME types supported by YouTube and expected by the exact-match validator.
  2. *Uppercase privacy enum mismatch*: Web components set uppercase privacy values (`'PRIVATE'`), while the provider expects the YouTube-accurate lowercase enum.
  3. *Missing title in strict options schema*: `YouTubeProviderOptionsSchema` declared only `privacyStatus`, `categoryId`, and `tags`, rejecting `title` due to `.strict()`.
- **Provider Options Scoping Finding**:
  - We verified during implementation that `privacyStatus` select, add-target default, and `handleUpdate` state were previously shared across all providers (unconditionally rendered and saved for any variant).
  - We scoped the change so that `privacyStatus: 'private'` is only set on add-target when `account.provider === 'YOUTUBE'`, `handleUpdate` only writes `privacyStatus` for YouTube variants, and the privacy `<select>` is only rendered for YouTube variants, ensuring other providers' stored values are NOT altered.
- **Operator Note (No Migration Needed)**:
  - Variants already stored with an uppercase `privacyStatus` keep failing validation until the value is re-saved from the fixed dropdown (now lowercase) or the target is removed and re-added — no database migration is required.
- **Deliberate Exclusions**:
  - Strictly no changes to `PublishabilityValidator.ts` or any other provider (`packages/providers/youtube/` and `apps/web/` only).
  - Zero new npm dependencies.

### 2. Architecture & Implementation Details

#### A. Provider Capabilities & Schema (`packages/providers/youtube/youtube.provider.ts`)
- In `getPublishingCapabilities()`:
  - Replaced wildcard `mimeTypes: ["video/*"]` with the concrete list of YouTube-accepted video MIME types:
    `['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-msvideo', 'video/x-ms-wmv', 'video/x-flv', 'video/3gpp', 'video/mpeg']`.
- In `YouTubeProviderOptionsSchema`:
  - Added `title: z.string().max(100).optional()` (YouTube's 100-character title limit), preserving `.strict()` and all existing fields.

#### B. Web Publishing UI (`apps/web/src/app/[workspaceId]/publishing/[postId]/page.tsx`)
- Updated add-target handler: sets `providerOptions.privacyStatus: 'private'` exclusively for YouTube accounts.
- Updated `TargetCard` state defaults: `privacyStatus` defaults to `'private'`.
- Updated `handleUpdate`: only persists `privacyStatus` for YouTube variants.
- Updated `TargetCard` JSX: scoped Privacy Status `<select>` to YouTube variants only (`variant.socialAccount?.provider === 'YOUTUBE'`), with lowercase option values `'public'`, `'private'`, `'unlisted'`.

#### C. Test Suite Updates
- `packages/providers/youtube/youtube.provider.spec.ts`:
  - Added tests asserting `validateProviderOptions` accepts `{ title: 'My video', privacyStatus: 'public' }` and rejects `privacyStatus: 'PUBLIC'`.
  - Added test asserting `getPublishingCapabilities()` VIDEO_POST `mimeTypes` contains `'video/mp4'` and contains no `'video/*'` wildcard entry.
- `apps/web/src/app/[workspaceId]/publishing/[postId]/page.spec.tsx`:
  - Updated existing test to assert lowercase `privacyStatus: 'private'`.
  - Added test asserting add-target call sends `providerOptions.privacyStatus: 'private'` for YouTube targets.
  - Added test asserting selecting an option from the privacy dropdown stores the lowercase value via `api.patch`.

### 3. Verification & Test Evidence

- **Providers Unit Test Suite (`pnpm --filter @agency-os/providers test`)**:
  - 15/15 test files PASS, 247/247 tests PASS.
  - `youtube.provider.spec.ts`: 19/19 tests PASS (+3 new tests).
- **Web Unit Test Suite (`pnpm --filter @agency-os/web test`)**:
  - 23/23 test files PASS, 250/250 tests PASS (+2 new tests).
  - `publishing/[postId]/page.spec.tsx`: 33/33 tests PASS.
- **Monorepo Quality Gates (`pnpm turbo run lint typecheck build`)**:
  - All 18 tasks across 9 packages PASS (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `26ed6ec4` is 6/6 green (all 2026-11-18): GitGuardian Security Checks 13:43:04Z, Application Builds 13:43:50Z, Code Quality (Lint & Typecheck) 13:44:06Z, Tests 13:44:21Z, API E2E Tests 13:44:33Z, Docker Build & Smoke Test 13:50:59Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #83 is open against main; CI was 6/6 green on the reviewed head `26ed6ec4`; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone.


---

## 72. Worker Post-Checkpoint Failure Routing Fix

*(Note: Section 68 remains reserved for the OAuthCallbackQueryDto error_description fix, per task specification; Section 69 was PR #81; Section 70 was PR #82; Section 71 was PR #83)*

### 1. Summary & Motivation

- **Status**: implemented on branch `fix/publish-failure-phase-routing`; PR #84 open against main at reviewed head `1b41dbbf73fa83736105d2b228cf31850a780885`
- **Origin**: During the first real YouTube publish attempt (2026-11-18), the worker log recorded:
  - `publication.claimed` (dispatchVersion 1), then `publication.provider_publish_start` (YOUTUBE)
  - ~77s later: `publication.transition_failed_failed` — `"Failed to transition to FAILED: Cannot transition from PUBLISH_REQUESTED to FAILED"`
  - ~4 min later the background dispatcher recovered the dangling execution as stale (`dispatcher.recovered_stale_unknown`), setting the attempt to `EXECUTION_STALE` and erasing the provider's real failure reason.
- **Root Cause**:
  - `YouTubeProvider.publish()` calls `context.beforeFinalMutation()` immediately prior to `youtube.videos.insert(...)`. This moves the execution phase to `PUBLISH_REQUESTED`.
  - When the upload failed (e.g. Google rejected the call due to missing upload scope or auth error), the provider returned a non-success result `{ success: false, failureCategory: 'AUTH_REQUIRED', failureCode: 'PROVIDER_SCOPE_REQUIRED' }`.
  - In `apps/worker/src/publishing/publishing.processor.ts` (~lines 898-957), the returned-result failure router evaluated:
    ```ts
    const isUnknownPublish =
      isPublishRequested &&
      (result.failureCategory === 'UNKNOWN_RESULT' ||
        result.failureCategory === 'TRANSIENT');
    ```
    and only routed to `this.handleUnknown` if `result.failureCategory === 'UNKNOWN_RESULT' || isUnknownPublish || isAmbiguousContainer`.
  - When `failureCategory` was `'AUTH_REQUIRED'` (or any category other than `UNKNOWN_RESULT` or `TRANSIENT`), `isUnknownPublish` evaluated to `false`, causing execution to fall through to `this.handleFailure(...)`.
  - `handleFailure` called `transitionOperation(variant.id, attemptId, 'FAILED', ...)`. However, in `ExecutionMetadataRepository.ts`, `PUBLISH_REQUESTED` only permits transitions to `COMPLETED`, `AMBIGUOUS`, or `PROCESSING_REMOTE`. Transitioning directly from `PUBLISH_REQUESTED` to `FAILED` is forbidden by design because the provider mutation was already in-flight and its remote outcome cannot be assumed failed.
  - The catch block in `handleFailure` caught the throw, logged `publication.transition_failed_failed`, swallowed the exception, and exited without setting any terminal status on the variant.
  - The publication was left dangling in `PUBLISHING` until the dispatcher recovered it minutes later as `EXECUTION_STALE`, wiping out the provider's actual `failureCode`.
  - In contrast, the exception handler (~lines 798-814) already had `if (isPublishRequested || isProcessingRemote) ... handleUnknown`. The returned-result path was missing this check.
- **The Fix**:
  - In `apps/worker/src/publishing/publishing.processor.ts`, simplified the condition so that whenever `isPublishRequested` is true, the failure result routes unconditionally to `this.handleUnknown(...)`, regardless of `result.failureCategory`.
  - `handleUnknown` records the provider's `result.failureCode` (e.g. `PROVIDER_SCOPE_REQUIRED`) on the attempt, transitions the execution phase to `AMBIGUOUS`, and sets variant status to `UNKNOWN`, preventing crashes and avoiding dangling executions.
  - Pre-checkpoint failures (execution phase `INITIATED`) continue routing to `this.handleFailure(...)` and cleanly transitioning to `FAILED`.
- **Deliberate Exclusions**:
  - Strictly no modifications to `PublishabilityValidator.ts`, any provider, `handleFailure`, `handleUnknown`, the dispatcher, or the phase state machine.
  - Zero new npm dependencies.

### 2. Architecture & Implementation Details

#### A. PublishingProcessor Result Routing (`apps/worker/src/publishing/publishing.processor.ts`)
- In `process()` result-handling block (~lines 898-912):
  - Removed `isUnknownPublish` variable definition.
  - Updated the router condition:
    ```ts
    const isPublishRequested =
      (currentSourcePhase as string) === 'PUBLISH_REQUESTED';
    const isAmbiguousContainer =
      result.failureCode === 'AMBIGUOUS_PUBLISHED_CONTAINER';

    if (
      result.failureCategory === 'UNKNOWN_RESULT' ||
      isPublishRequested ||
      isAmbiguousContainer
    ) {
      // routes to this.handleUnknown, preserving result.failureCode
    ```

#### B. Test Suite Updates (`apps/worker/src/publishing/publishing.worker.spec.ts`)
- Updated `TestPublishingProvider.publish` mock signature to accept `(credentials, input, mediaSource?, context?)`.
- Added test fixture trigger `trigger-post-checkpoint-auth-fail` which executes `await context.beforeFinalMutation()` and returns `{ success: false, failureCategory: 'AUTH_REQUIRED', failureCode: 'PROVIDER_SCOPE_REQUIRED' }`.
- Added regression test:
  - `routes post-checkpoint failure result (phase PUBLISH_REQUESTED) with AUTH_REQUIRED to handleUnknown and preserves failureCode`: verifies variant ends in `UNKNOWN`, metadata phase is `AMBIGUOUS`, and attempt status is `FAILED` with `failureCategory: 'UNKNOWN_RESULT'` and `failureCode: 'PROVIDER_SCOPE_REQUIRED'`.
- Added safety test:
  - `routes pre-checkpoint failure result (phase INITIATED) to handleFailure and ends in FAILED`: verifies variant ends in `FAILED`, metadata phase is `FAILED`, and attempt status is `FAILED` with `failureCategory: 'AUTH_REQUIRED'` and `failureCode: 'TOKEN_EXPIRED'`.

### 3. Verification & Test Evidence

- **Worker Unit Tests (`pnpm --filter @agency-os/worker test`)**:
  - `publishing.worker.spec.ts`: 24/24 tests PASS (+2 new tests).
- **Monorepo Quality Gates (`pnpm turbo run lint typecheck build`)**:
  - All 18 tasks across 9 packages PASS (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `1b41dbbf` is 6/6 green (all 2026-11-18): GitGuardian Security Checks 15:05:08Z, Application Builds 15:05:59Z, Code Quality (Lint & Typecheck) 15:06:22Z, Tests 15:06:51Z, API E2E Tests 15:06:52Z, Docker Build & Smoke Test 15:13:48Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #84 is open against main; CI was 6/6 green on the reviewed head `1b41dbbf`; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone.


---

## 73. YouTube Category Flow End-to-End Alignment & Error Reason Surfacing

*(Note: Section 68 remains reserved for the OAuthCallbackQueryDto error_description fix, per task specification; Section 69 was PR #81; Section 70 was PR #82; Section 71 was PR #83; Section 72 was PR #84)*

### 1. Summary & Motivation

- **Status**: implemented on branch `fix/youtube-category-id`; PR #85 open against main at reviewed head `098267d907df30507e568787c618fcfcce60000a`
- **Origin**: During a live YouTube publish attempt (2026-11-18), publication failed with `failureCode: 'YOUTUBE_INVALID_METADATA'`. The variant's stored `providerOptions` were `{"title": " chchg  ", "categoryId": "vlog", "privacyStatus": "public"}` — the user had entered the string `"vlog"` into the publishing page's Category field. This value was stored verbatim and passed to YouTube Data API's `videos.insert`, which rejected it with HTTP 400 (YouTube category IDs are numeric IDs from YouTube's standard category list).
- **Secondary Root Cause (Diagnostics Loss)**:
  - In `YouTubeProvider.publish()`, every non-auth, non-quota 4xx was mapped to a generic `YOUTUBE_INVALID_METADATA` failure without recording `error.errors[0].reason` or `error.message`.
  - The actual Google API rejection reason (`invalidCategoryId`) was discarded, leaving operator logs and attempt records without actionable diagnostic detail.
- **Root Causes**:
  1. *Free-text input for category*: `apps/web` rendered an unconstrained `<input type="text">` for YouTube's `categoryId`, allowing arbitrary non-numeric text like `"vlog"`.
  2. *Permissive provider options schema*: `YouTubeProviderOptionsSchema` accepted `categoryId: z.string().optional()`, allowing any string through client and server validation until YouTube rejected it at runtime.
  3. *Error detail loss in provider*: `YouTubeProvider.publish()` catch block collapsed all 4xx/5xx responses into hardcoded error message strings, discarding Google's specific error reason.
- **API Merge Semantics Verification**:
  - We inspected `apps/api/src/modules/publishing/services/publishing-application.service.ts` (`updateTarget` ~lines 323-332):
    `providerOptions: dto.providerOptions !== undefined ? dto.providerOptions || Prisma.JsonNull : variant.providerOptions || Prisma.JsonNull`.
  - The API completely replaces the variant's `providerOptions` column with the incoming DTO payload without partial merging. Therefore, selecting "No category" on the web deletes `categoryId` from the DTO, cleanly deleting the key in PostgreSQL.
- **Scope & Exclusions**:
  - Touched files strictly limited to:
    - `apps/web/src/app/[workspaceId]/publishing/[postId]/page.tsx`
    - `apps/web/src/app/[workspaceId]/publishing/[postId]/page.spec.tsx`
    - `packages/providers/youtube/youtube.provider.ts`
    - `packages/providers/youtube/youtube.provider.spec.ts`
    - `IMPLEMENTATION_STATUS.md`
  - Zero changes to `PublishabilityValidator.ts`, any other provider, the worker, or publications API.
  - Zero new npm dependencies.

### 2. Architecture & Implementation Details

#### A. Web YouTube Category Dropdown (`apps/web/src/app/[workspaceId]/publishing/[postId]/page.tsx`)
- Added constant `YOUTUBE_CATEGORIES` listing the 14 standard YouTube video categories:
  - `1: Film & Animation`
  - `2: Autos & Vehicles`
  - `10: Music`
  - `15: Pets & Animals`
  - `17: Sports`
  - `19: Travel & Events`
  - `20: Gaming`
  - `22: People & Blogs`
  - `23: Comedy`
  - `24: Entertainment`
  - `25: News & Politics`
  - `26: Howto & Style`
  - `27: Education`
  - `28: Science & Technology`
- Added helper `getValidYouTubeCategoryId(raw)`: validates against `/^\d+$/`. If invalid (such as legacy `"vlog"`), it safely normalizes to `""` (rendering "No category").
- Replaced the free-text input with a `<select>` dropdown rendering:
  - `<option value="">No category</option>`
  - The 14 categorized options with numeric IDs as values.
- In `handleUpdate`:
  - When a category is chosen, `providerOptions.categoryId` is set to the selected numeric ID string.
  - When "No category" is selected, `delete updatedOptions.categoryId` removes the key completely prior to `api.patch`.

#### B. Provider Schema Validation (`packages/providers/youtube/youtube.provider.ts`)
- In `YouTubeProviderOptionsSchema`:
  - Updated `categoryId` to enforce numeric strings:
    `categoryId: z.string().regex(/^\d+$/, 'categoryId must be a numeric YouTube category ID').optional()`.
  - Non-numeric strings now fail schema validation: `validateProviderOptions` returns `valid: false` with an issue on field `'categoryId'` carrying the message `'categoryId must be a numeric YouTube category ID'` (issue code `INVALID_OPTION`), which `PublishabilityValidator` wraps as `PROVIDER_OPTION_INVALID` during pre-publish checks.

#### C. Preserving Google Rejection Reasons in Errors (`packages/providers/youtube/youtube.provider.ts`)
- Added helper `formatFailureMessage(baseMessage, reason?, errorMessage?)`:
  - It does not extract error properties itself; the `publish()` catch block computes:
    ```ts
    const firstError = error.errors?.[0];
    const reason = firstError?.reason || error.reason;
    const errorMsg = firstError?.message;
    ```
    and passes them in.
  - The helper appends `' (reason: <reason>: <errorMessage>).'`, `' (reason: <reason>).'`, or `' (message: <errorMessage>).'` to the base message, falling back to the plain base message when neither is provided.
- Applied across all catch block branches in `publish()`:
  - 401 → `AUTH_REQUIRED / YOUTUBE_AUTH_REQUIRED`
  - 429 → `RATE_LIMITED / YOUTUBE_RATE_LIMITED`
  - 403 with reason `quotaExceeded` → `RATE_LIMITED / YOUTUBE_QUOTA_EXHAUSTED`
  - 403 with reason `insufficientPermissions` → `AUTH_REQUIRED / PROVIDER_SCOPE_REQUIRED`
  - 403 other → `AUTH_REQUIRED / YOUTUBE_UPLOAD_FORBIDDEN`
  - other 4xx (400–499) → `VALIDATION / YOUTUBE_INVALID_METADATA`
  - 5xx / network / no status → `UNKNOWN_RESULT / YOUTUBE_UPLOAD_OUTCOME_UNKNOWN`
- No `failureCode` or `failureCategory` changed in any branch; only the message strings gained the reason/message suffix.

#### D. Test Suite Updates
- `packages/providers/youtube/youtube.provider.spec.ts`:
  - Added test verifying `validateProviderOptions` accepts numeric category ID (`'22'`).
  - Added test verifying `validateProviderOptions` rejects non-numeric category ID (`'vlog'`) (returns `valid: false` with issue on field `'categoryId'`, message `'categoryId must be a numeric YouTube category ID'`, and issue code `INVALID_OPTION`, which `PublishabilityValidator` wraps as `PROVIDER_OPTION_INVALID`).
  - Added test verifying `publish()` returns `YOUTUBE_INVALID_METADATA` and includes Google's rejection reason in the result's `message` field when Google rejects with HTTP 400 `invalidCategoryId`.
- `apps/web/src/app/[workspaceId]/publishing/[postId]/page.spec.tsx`:
  - Added test asserting the Category control is a `<select>` with 15 options (empty default + 14 categories), and choosing a category (e.g. "People & Blogs") calls `api.patch` with `providerOptions.categoryId = '22'`.
  - Added test asserting selecting "No category" deletes the `categoryId` key from `providerOptions`, and legacy non-numeric values (e.g. `'vlog'`) safely render "No category".

### 3. Verification & Test Evidence

- **Providers Unit Test Suite (`pnpm --filter @agency-os/providers test`)**:
  - 15/15 test files PASS, 250/250 tests PASS (+3 new tests).
  - `youtube.provider.spec.ts`: 22/22 tests PASS (+3 new tests).
  - `publish.spec.ts`: 10/10 tests PASS.
- **Web Unit Test Suite (`pnpm --filter @agency-os/web test`)**:
  - 23/23 test files PASS, 252/252 tests PASS (+2 new tests).
  - `publishing/[postId]/page.spec.tsx`: 35/35 tests PASS (+2 new tests).
- **Monorepo Quality Gates (`pnpm turbo run lint typecheck build`)**:
  - All 18 tasks across 9 packages PASS (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `098267d9` is 6/6 green (all 2026-11-18): GitGuardian Security Checks 17:48:16Z, Application Builds 17:49:13Z, Code Quality (Lint & Typecheck) 17:49:27Z, API E2E Tests 17:49:47Z, Tests 17:50:12Z, Docker Build & Smoke Test 17:56:43Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #85 is open against main; CI was 6/6 green on the reviewed head `098267d9`; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone.


---

## 68. OAuth Callback DTO Error Description Support & Denied-Path Audit Threading

*(Note: Section 68 was deliberately reserved during previous milestones PR #81–#85 / §§69–73 and is documented here out of numerical sequence)*

### 1. Summary & Motivation

- **Status**: implemented on branch `fix/oauth-callback-error-description`; PR #86 open against main at reviewed head `0105e2effd5a3f5b8ab5d929429547e354b74604`
- **Origin & Live Evidence (2026-11-18)**:
  - During the first real LinkedIn connect attempt, user denial failed with:
    `{"error":{"code":"BadRequestException","message":"property error_description should not exist"}}`.
  - LinkedIn had redirected back to the OAuth callback with `error` and `error_description` (the standard OAuth 2.0 user-facing authorization refusal).
  - However, `apps/api/src/modules/oauth/dto/oauth-callback-query.dto.ts` declared only `code`, `state`, `iss`, `scope`, and `error`.
  - The API's global `ValidationPipe` (`whitelist: true`, `forbidNonWhitelisted: true`) rejected the incoming callback query with a 400 Bad Request before controller execution.
  - As a result, the real provider error was masked, and the controller's provider-denied handling in `apps/api/src/modules/oauth/oauth.controller.ts` (which audits `OAUTH_CONNECTION_FAILED` with metadata `{ provider, reason: 'OAUTH_PROVIDER_DENIED' }` and redirects to `/dashboard?error=oauth_failed`) was completely unreachable.
  - This vulnerability affected all provider error callbacks (Meta, Google, and LinkedIn all transmit `error_description` upon user cancellation or denial).
- **The Fix**:
  1. `apps/api/src/modules/oauth/dto/oauth-callback-query.dto.ts`: added optional field `@IsOptional() @IsString() error_description?: string;` matching existing DTO field conventions.
  2. `apps/api/src/modules/oauth/oauth.controller.ts`: extended query destructuring in `callbackProvider` to extract `error_description`. On the provider-denied branch (`if (error)`), threaded the description into the `OAUTH_CONNECTION_FAILED` audit metadata under the key `errorDescription` only when present (`...(error_description ? { errorDescription: error_description } : {})`).
  3. No other handler behavior changes: identical redirect to `${frontendUrl}/dashboard?error=oauth_failed`, identical audit action, identical `OAUTH_PROVIDER_DENIED` reason.
- **Scope & Exclusions**:
  - Touched files strictly limited to:
    - `apps/api/src/modules/oauth/dto/oauth-callback-query.dto.ts`
    - `apps/api/src/modules/oauth/oauth.controller.ts`
    - `apps/api/src/modules/oauth/oauth.controller.spec.ts`
    - `apps/api/src/validation.spec.ts`
    - `IMPLEMENTATION_STATUS.md`
  - Zero modifications to provider packages (`packages/providers/`), `oauth.service.ts`, or global `ValidationPipe` configuration.
  - Zero new npm dependencies.

### 2. Architecture & Implementation Details

#### A. DTO Extension (`apps/api/src/modules/oauth/dto/oauth-callback-query.dto.ts`)
- Added `error_description` field:
  ```ts
  @IsOptional()
  @IsString()
  error_description?: string;
  ```
- Whitelists `error_description` so that NestJS `ValidationPipe` with `forbidNonWhitelisted: true` accepts provider denial callbacks without throwing `BadRequestException`.

#### B. Audit Threading (`apps/api/src/modules/oauth/oauth.controller.ts`)
- Extended query destructuring:
  ```ts
  const { code, state, error, error_description } = query;
  ```
- In provider-denied branch (`if (error)`), included `errorDescription` in audit log metadata only when provided:
  ```ts
  metadata: {
    provider,
    reason: 'OAUTH_PROVIDER_DENIED',
    ...(error_description ? { errorDescription: error_description } : {}),
  },
  ```

#### C. Test Suites & Locations
- Tests reside across two spec files:
  1. `apps/api/src/modules/oauth/oauth.controller.spec.ts`:
     - Added test asserting that a callback query with `error` + `error_description` reaches provider-denied handling: redirects to dashboard `oauth_failed` URL, does NOT produce a 400, and `OAUTH_CONNECTION_FAILED` audit metadata carries `errorDescription`.
     - Added test verifying through `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` that a query containing `error`, `error_description`, and `state` passes validation without throwing `BadRequestException` and successfully executes the controller's provider-denied flow.
     - Preserved existing test verifying callback query with `error` only (no `error_description`) reaches provider-denied handling, redirects as before, and omits `errorDescription` from audit metadata.
  2. `apps/api/src/validation.spec.ts`:
     - Added test asserting that `OAuthCallbackQueryDto` populated with `error`, `error_description`, and `state` passes `class-validator` `validate()` with `whitelist: true, forbidNonWhitelisted: true` with 0 validation errors.

### 3. Verification & Test Evidence

- **OAuth Controller Spec (`apps/api/src/modules/oauth/oauth.controller.spec.ts`)**:
  - 20/20 tests PASS (+2 new tests).
- **Validation Spec (`apps/api/src/validation.spec.ts`)**:
  - 17/17 tests PASS (+1 new test).
- **Combined Spec Execution (`pnpm --filter @agency-os/api test src/modules/oauth/oauth.controller.spec.ts src/validation.spec.ts`)**:
  - 2/2 test files PASS, 37/37 tests PASS.
- **Monorepo Quality Gates (`pnpm turbo run lint typecheck build`)**:
  - All 18 tasks across 9 packages PASS (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `0105e2ef` is 6/6 green (all 2026-11-18): GitGuardian Security Checks 18:41:18Z, Application Builds 18:42:10Z, API E2E Tests 18:42:34Z, Code Quality (Lint & Typecheck) 18:42:46Z, Tests 18:42:55Z, Docker Build & Smoke Test 18:49:32Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #86 is open against main; CI was 6/6 green on the reviewed head `0105e2ef`; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone.


---

## 74. Client Approvals Workflow & Permission Enforcement

### 1. Summary & Motivation

- **Status**: implemented on branch `feat/client-approvals`; PR #87 open against main at reviewed head `6f491cd901fb628e98e1ef50aeb4e9e757fefd08`
- **Origin & Requirements**:
  - Adds a client approvals flow allowing drafts to be submitted for review before publishing or scheduling.
  - A post can be submitted for approval (`approvalStatus: PENDING`).
  - A workspace member holding the `posts.approve` permission (`OWNER`, `MANAGER`, or `CLIENT_APPROVER` in `PermissionMatrix`) can approve the post (`APPROVED`) or request changes with feedback (`CHANGES_REQUESTED`).
  - Publication gating: A post with `approvalStatus` equal to `PENDING` or `CHANGES_REQUESTED` cannot be published (`requestPublish`), scheduled (`schedule`), rescheduled (`reschedule`), or retried (`requestRetry`) — attempts fail via `assertPostCanPublish(repo, postId)`, throwing `ConflictException('Post is pending approval and cannot be published yet.')` when `approvalStatus` is `PENDING` and `ConflictException('Changes were requested for this post. Edit it and resubmit for approval before publishing.')` when `CHANGES_REQUESTED`.
  - Edit invalidation: Any edit to post content, media, or targets (`updateDraft`, `addTarget`, `updateTarget`, `removeTarget`) while in `PENDING` or `APPROVED` status invalidates the approval, resetting `approvalStatus` back to `NOT_SUBMITTED`, clearing approval metadata, and recording a `POST_APPROVAL_INVALIDATED` audit log event.
  - Email notifications: Fire-and-forget notification emails dispatched via `EmailDeliveryService` when approval is requested (to workspace reviewers with `posts.approve`) and when an approval decision (`APPROVED` or `CHANGES_REQUESTED`) is made (to the post author).
- **Scope & Exclusions**:
  - OUT OF SCOPE (deferred to future milestones):
    - Per-variant approval (approval operates at the post level).
    - External/share-link approvers (approval requires workspace membership).
    - Plan gating / feature flags (available to all workspace tiers).
    - Background worker modifications (enforcement resides at API mutation and transition boundaries).
    - Approval queue / dedicated review dashboard page.
    - Push / in-app notifications.

### 2. Architecture & Implementation Details

#### A. Database Schema & Migration (`packages/database`)
- **Schema (`packages/database/prisma/schema.prisma`)**:
  - Added enum `ApprovalStatus`:
    ```prisma
    enum ApprovalStatus {
      NOT_SUBMITTED
      PENDING
      APPROVED
      CHANGES_REQUESTED
    }
    ```
  - Added approval fields to `Post` model:
    - `approvalStatus ApprovalStatus @default(NOT_SUBMITTED)`
    - `approvalRequestedById String?`
    - `approvalRequestedAt DateTime?`
    - `approvalDecidedById String?`
    - `approvalDecidedAt DateTime?`
    - `approvalComment String?`
- **Migration (`packages/database/prisma/migrations/20261119000000_add_post_approval_fields/migration.sql`)**:
  - Created enum and added the 6 columns to the `Post` table.
- **Audit Actions (`packages/database/src/repositories/AuditLogRepository.ts`)**:
  - Added `POST_APPROVAL_REQUESTED`, `POST_APPROVAL_APPROVED`, `POST_APPROVAL_CHANGES_REQUESTED`, `POST_APPROVAL_INVALIDATED`.

#### B. Email Delivery Service (`apps/api/src/modules/auth/email-delivery.service.ts`)
- Extended `EmailDeliveryService` interface with positional methods:
  - `sendApprovalRequestedEmail(toEmail: string, contentPreview: string): Promise<void>`
  - `sendApprovalDecisionEmail(toEmail: string, contentPreview: string, decision: 'APPROVED' | 'CHANGES_REQUESTED', comment?: string): Promise<void>`
- Implemented in:
  - `ResendEmailDeliveryService`: Sends structured HTML/plain text notification emails using configured `EMAIL_FROM` and `FRONTEND_URL`.
  - `MockEmailDeliveryService`: Tracks dispatched emails in in-memory arrays `sentApprovalRequestedEmails` and `sentApprovalDecisionEmails` for testing.
  - `NoopEmailDeliveryService`: Logs safe debug/warning message when no email provider is configured.

#### C. API Publishing Service & Controller (`apps/api/src/modules/publishing`)
- **DTOs (`post.dto.ts`)**:
  - Added `RequestChangesDto` with `@IsString() @IsNotEmpty() @MaxLength(1000) comment: string`.
- **PublishingApplicationService (`publishing-application.service.ts`)**:
  - Injected `EmailDeliveryService`.
  - Implemented `requestApproval(workspaceId, userId, postId)`:
    - Verifies post existence and non-terminal state.
    - Rejects a post whose variants are not all `DRAFT` with `ConflictException('Only a draft post can be sent for approval.')`.
    - Rejects already `PENDING` posts with `ConflictException('Post is already pending approval.')` and already `APPROVED` posts with `ConflictException('Post is already approved.')`.
    - Transitions `approvalStatus` to `PENDING`, sets `approvalRequestedById = userId`, `approvalRequestedAt = new Date()`, clears decision metadata.
    - Emits `POST_APPROVAL_REQUESTED` audit log.
    - Asynchronously dispatches `sendApprovalRequestedEmail` to workspace approvers (`posts.approve`).
  - Implemented `approvePost(workspaceId, userId, postId)`:
    - Verifies post is in `PENDING` status (409 Conflict if not).
    - Transitions `approvalStatus` to `APPROVED`, sets `approvalDecidedById = userId`, `approvalDecidedAt = new Date()`, clears comment.
    - Emits `POST_APPROVAL_APPROVED` audit log.
    - Asynchronously dispatches `sendApprovalDecisionEmail` to post author.
  - Implemented `requestChanges(workspaceId, userId, postId, comment)`:
    - Verifies post is in `PENDING` status (409 Conflict if not).
    - Transitions `approvalStatus` to `CHANGES_REQUESTED`, sets `approvalDecidedById = userId`, `approvalDecidedAt = new Date()`, stores `approvalComment = comment`.
    - Emits `POST_APPROVAL_CHANGES_REQUESTED` audit log.
    - Asynchronously dispatches `sendApprovalDecisionEmail` with comment to author.
  - Implemented `assertPostCanPublish(repo, postId)`:
    - Invoked at the top of `requestPublish`, `schedule`, `reschedule`, and `requestRetry`.
    - Throws `ConflictException('Post is pending approval and cannot be published yet.')` when `approvalStatus` is `PENDING`.
    - Throws `ConflictException('Changes were requested for this post. Edit it and resubmit for approval before publishing.')` when `approvalStatus` is `CHANGES_REQUESTED`.
  - Invalidation semantics:
    - Helper `invalidateApprovalIfActive(workspaceId, authorId, postId, reason)`: When `approvalStatus` is `PENDING` or `APPROVED`, resets status to `NOT_SUBMITTED`, clears approval timestamps/actors/comment, and records `POST_APPROVAL_INVALIDATED` audit log. Called by `addTarget` (reason `'target_added'`), `updateTarget` (reason `'target_updated'`), and `removeTarget` (reason `'target_removed'`).
    - `updateDraft` performs the invalidation inline inside its transaction with reason `'draft_updated'` and does not call the helper.
  - Verified Concurrency & State Invariant:
    - The existing edit methods reject content/target mutations once variants leave draft states, which is why approval decisions (`PENDING`-only) and edit-invalidation can never race a scheduled or queued variant, and why the worker needs no approval check.
- **PostsController (`posts.controller.ts`)**:
  - `POST :postId/request-approval`: Guarded by `WorkspaceWritableGuard` and `RequirePermission('posts.update')`.
  - `POST :postId/approve`: Guarded by `WorkspaceWritableGuard` and `RequirePermission('posts.approve')`.
  - `POST :postId/request-changes`: Guarded by `WorkspaceWritableGuard` and `RequirePermission('posts.approve')`.

#### D. Web UI & Frontend (`apps/web`)
- **Query Types (`apps/web/src/lib/query/publishing.ts`)**:
  - Added `ApprovalStatus` enum and post approval fields to `Post` interface.
- **Post Detail (`apps/web/src/app/[workspaceId]/publishing/[postId]/page.tsx`)**:
  - Added `ApprovalCard`:
    - Displays current approval state badge (`NOT_SUBMITTED`, `PENDING`, `APPROVED`, `CHANGES_REQUESTED`).
    - For draft authors: provides "Send for Approval" action button when draft is unsubmitted or changes requested.
    - For reviewers with `posts.approve`: provides "Approve Post" and "Request Changes" action buttons with collapsible feedback comment form.
    - Displays reviewer feedback note when in `CHANGES_REQUESTED` status.
  - Publish & Schedule buttons disabled with explanatory tooltip / warning banner when `approvalStatus === 'PENDING' || approvalStatus === 'CHANGES_REQUESTED'`.
- **Post List (`apps/web/src/app/[workspaceId]/publishing/page.tsx`)**:
  - Added `ApprovalBadge` component rendering status tags in post cards.

### 3. Verification & Test Evidence

- **API Unit Tests (`apps/api`)**:
  - 41/41 test files PASS, 577/577 tests PASS.
  - `email-delivery.service.spec.ts`: 20/20 tests PASS (+7 new tests).
  - `publishing-application.service.spec.ts`: 79/79 tests PASS (+19 new test blocks).
  - `posts.controller.spec.ts`: 8/8 tests PASS (+6 new tests).
- **API E2E Tests (`apps/api/test/publishing.e2e-spec.ts`)**:
  - 1/1 test suite PASS, 63/63 tests PASS (+8 new tests).
  - Dedicated suite `Client Approvals End-to-End Workflow` verifying:
    - EDITOR submits draft for approval (`PENDING`).
    - Duplicate request-approval returns 409 Conflict.
    - EDITOR forbidden from approving (403 Forbidden without `posts.approve`).
    - Publication blocked while `PENDING` (409 Conflict).
    - OWNER requests changes with comment (`CHANGES_REQUESTED`).
    - Publication blocked while `CHANGES_REQUESTED` (409 Conflict).
    - OWNER approves post after resubmission (`APPROVED`).
    - Content edit after approval invalidates status back to `NOT_SUBMITTED`.
- **Web Unit Tests (`apps/web`)**:
  - 24/24 test files PASS, 260/260 tests PASS.
  - `apps/web/src/app/[workspaceId]/publishing/[postId]/page.spec.tsx`: 42/42 tests PASS (+7 new tests).
  - `apps/web/src/app/[workspaceId]/publishing/page.spec.tsx`: 1/1 test PASS.
- **Monorepo Quality Gates**:
  - `pnpm turbo run test`: 10/10 tasks successful.
  - `pnpm turbo run lint typecheck build`: 18/18 tasks successful (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `6f491cd9` is 6/6 green (all 2026-11-19): GitGuardian Security Checks 08:03:18Z, Application Builds 08:03:26Z, Code Quality (Lint & Typecheck) 08:03:35Z, Tests 08:04:14Z, API E2E Tests 08:04:15Z, Docker Build & Smoke Test 08:11:06Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #87 is open against main at reviewed head `6f491cd9`; CI is 6/6 green; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone. Live deployment remains STRICT NO-GO.

---

## 75. White-Label Client Reports & Workspace Branding

### 1. Summary & Motivation

- **Status**: implemented on branch `feat/white-label-reports`; PR #88 open against main at reviewed head `f632cccfdbc5cf20a99ee028b6c2a74ce65749d0`
- **Origin & Requirements**:
  - Allows workspaces to store agency branding (`brandDisplayName`, `brandLogoUrl`, `brandAccentColor`) and generate branded PDF performance reports for a specified date range.
  - Strict data-reality constraint: report aggregates only real product data (`followers` and `engagement` from `AccountMetricDaily`, and publishing counts from `PostPlatformVariant` with status `PUBLISHED` and `publishedAt` inside the period). Zero invented metrics (no reach, impressions, or clicks exist anywhere in the product schema).
  - UTC period bounds: `from` evaluates from 00:00:00.000Z to `to` 23:59:59.999Z, validated with `from <= to` and maximum span `<= 366 days`.
  - White-label rule: when `whiteLabeled: true` (`!!brandDisplayName`), strings `'Agency OS'` and `'Gadmale'` must appear nowhere in the document (including document metadata `Title`, `Producer`, `Creator`). When false, footer reads `${displayName} • Generated with Agency OS`.
  - PDFKit generation: uses `compress: false` in `PDFDocument` options so generated buffer text streams are uncompressed and verifiable.
  - External logo fetching: uses an `AbortController` with a 3s timeout, validates `content-type` (`image/png`, `image/jpeg`, `image/jpg`), and silently falls back to name-only if network fails or image cannot be decoded.
  - Permissions:
    - `reports.generate`: `['OWNER', 'MANAGER', 'EDITOR']`
    - `branding.manage`: `['OWNER', 'MANAGER']`
    - `workspace.view`: `['OWNER', 'MANAGER', 'EDITOR', 'CLIENT_APPROVER', 'VIEWER']` (on `GET /branding`)
  - `WorkspaceWritableGuard` applied on `PUT /branding`, but deliberately omitted from `GET /client-report` so analytical reporting remains accessible even if workspace subscription is expired or read-only.
  - Audit logging: records `REPORT_GENERATED` on PDF generation and `WORKSPACE_BRANDING_UPDATED` on branding mutations.
  - Web UI:
    - Analytics page: Client Report card with date range picker (default: last 30 days), account select dropdown (All accounts + connected accounts), and 'Download PDF' button.
    - Settings page: Workspace Branding card with display name (max 120 chars), logo URL (max 2048 chars, format validated), accent color picker and live hex input (`/^#[0-9A-Fa-f]{6}$/`).
- **Scope & Exclusions**:
  - OUT OF SCOPE:
    - Scheduled or recurring emailed reports.
    - CSV or Excel exports.
    - Per-post detail listings in PDF.
    - Charts or vector graphs in PDF (tables and summary cards only).
    - File upload endpoint for logos (URL references only).
    - Plan gating (available across all plans).

### 2. Architecture & Implementation Details

#### A. Database Schema & Migration (`packages/database`)
- **Schema (`packages/database/prisma/schema.prisma`)**:
  - Added optional fields to `Workspace` model:
    - `brandDisplayName String?`
    - `brandLogoUrl String?`
    - `brandAccentColor String?`
- **Migration**:
  - `packages/database/prisma/migrations/20261119010000_add_workspace_branding/migration.sql`
  - Applied to local `agency_os` and test database `agency_os_remote_execution_test`.
- **Audit Actions (`packages/database/src/repositories/AuditLogRepository.ts`)**:
  - Added `REPORT_GENERATED = 'REPORT_GENERATED'`
  - Added `WORKSPACE_BRANDING_UPDATED = 'WORKSPACE_BRANDING_UPDATED'`

#### B. API Reports Module (`apps/api/src/modules/reports/`)
- **DTOs (`dto/report.dto.ts`)**:
  - `UpdateBrandingDto`: optional `brandDisplayName` (max 120), `brandLogoUrl` (max 2048, http/https URL), `brandAccentColor` (`/^#[0-9A-Fa-f]{6}$/`). Empty strings permitted to clear stored values to `null`.
  - `ReportQueryDto`: required `from` and `to` (`@IsDateString()`), optional `socialAccountId` (`@IsUUID()`).
- **Service (`services/reports.service.ts`)**:
  - `getBranding(workspaceId)`: returns stored `brandDisplayName`, `brandLogoUrl`, `brandAccentColor`.
  - `updateBranding(workspaceId, actorId, dto)`: validates input format, normalizes empty strings to null, updates `Workspace`, and emits `WORKSPACE_BRANDING_UPDATED` audit log.
  - `assembleReportData(workspaceId, from, to, socialAccountId?)`: validates date bounds (`from <= to`, max 366 days), queries accounts in workspace (or single account), computes `postsPublished` per account and overall, extracts start and end `followers` and sums `engagement` within UTC window, sets `hasMetrics: false` when unmeasured, computes totals only across accounts with metrics, and resolves branding with fallback to workspace name.
- **PDF Generation (`services/report-pdf.service.ts`)**:
  - Pure server-side PDFKit service (`new PDFDocument({ size: 'A4', margin: 40, compress: false, info: { ... } })`).
  - Renders accent-colored header band, optional fetched logo, title and UTC period subheader, summary cards (Posts published, Follower growth, Total engagement), account performance table with 'No data' for unmeasured accounts, and white-label footer.
- **Controller (`controllers/reports.controller.ts`)**:
  - `GET /api/v1/workspaces/:workspaceId/reports/branding`: protected by `@RequirePermission('workspace.view')`.
  - `PUT /api/v1/workspaces/:workspaceId/reports/branding`: protected by `@RequirePermission('branding.manage')` and `WorkspaceWritableGuard`.
  - `GET /api/v1/workspaces/:workspaceId/reports/client-report`: protected by `@RequirePermission('reports.generate')` (no `WorkspaceWritableGuard`). Sets `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="client-report-<workspaceId>-<from>-<to>.pdf"`, and audits `REPORT_GENERATED`.
- **Module Registration (`reports.module.ts`, `app.module.ts`)**:
  - Registered `ReportsModule` in `AppModule.imports`.
- **Permission Matrix (`apps/api/src/modules/auth/guards/permission.guard.ts`)**:
  - Added `'reports.generate': ['OWNER', 'MANAGER', 'EDITOR']`.
  - Added `'branding.manage': ['OWNER', 'MANAGER']`.

#### C. Web UI Implementation (`apps/web`)
- **Query & Helper Layer (`apps/web/src/lib/query/reports.ts`)**:
  - `reportsQueries.branding(workspaceId)`: query definition for workspace branding.
  - `downloadClientReportPdf(workspaceId, from, to, socialAccountId?)`: fetches PDF blob from API with session credentials, creates a blob URL, triggers browser download via temporary anchor element, and revokes object URL.
- **Analytics Dashboard (`apps/web/src/app/[workspaceId]/analytics/page.tsx`)**:
  - Client Report card with start/end date inputs (initialized lazily to avoid impure render calls), account selector dropdown, and 'Download PDF' button with loading indicator and inline error alerts.
- **Workspace Settings (`apps/web/src/app/[workspaceId]/settings/page.tsx`)**:
  - Workspace Branding card with display name, logo URL, and accent color picker with live hex input and swatch preview. Controlled form state initialized lazily from server query, client-side format validation, and success/error feedback.

### 3. Verification & Evidence

- **Backend Unit Tests (`apps/api`)**:
  - 44/44 test files PASS, 606/606 tests PASS.
  - `reports.service.spec.ts`: 15/15 tests PASS.
  - `reports.controller.spec.ts`: 8/8 tests PASS.
  - `report-pdf.service.spec.ts`: 6/6 tests PASS.
- **API E2E Tests (`apps/api/test/reports.e2e-spec.ts`)**:
  - 1/1 test suite PASS, 15/15 tests PASS.
  - Verifies:
    - `GET /branding`: 401 unauthenticated, 403 non-member, 200 default branding for uncustomized workspace.
    - `PUT /branding`: 403 for EDITOR (requires `branding.manage`), 400 for invalid hex color, 400 for invalid logo URL, 200 for OWNER with full custom fields, 200 on empty strings clearing fields to null.
    - `GET /client-report`: 401 unauthenticated, 403 for VIEWER (requires `reports.generate`), 400 on missing or invalid dates, 400 on `from > to`, 200 generating valid PDF buffer starting with `%PDF` with attachment header and audit log entry, 200 with `socialAccountId` filter, 404 for non-existent account.
- **Web Unit Tests (`apps/web`)**:
  - 24/24 test files PASS, 268/268 tests PASS.
  - `apps/web/src/app/[workspaceId]/analytics/page.spec.tsx`: 14/14 tests PASS (+3 new tests).
  - `apps/web/src/app/[workspaceId]/settings/page.spec.tsx`: 17/17 tests PASS (+5 new tests).
- **Monorepo Quality Gates**:
  - `pnpm turbo run test`: 10/10 tasks successful.
  - `pnpm turbo run lint typecheck build`: 18/18 tasks successful (0 errors).

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `f632cccf` is 6/6 green (all 2026-11-19): GitGuardian Security Checks 09:49:05Z, Application Builds 09:49:55Z, Code Quality (Lint & Typecheck) 09:50:19Z, API E2E Tests 09:50:30Z, Tests 09:50:47Z, Docker Build & Smoke Test 09:57:17Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #88 is open against main at reviewed head `f632cccfdbc5cf20a99ee028b6c2a74ce65749d0`; CI is 6/6 green on the reviewed head; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone. Live deployment remains STRICT NO-GO.

---

## 76. Sign in with Google (Google Identity Services & One Tap)

### 1. Summary & Motivation

- **Status**: implemented on branch `feat/google-sign-in`; PR #89 open against main at reviewed head `da6e1bf41c53730807098ab2aed17f9b88abbf60`
- **Origin & Requirements**:
  - Implements official Google Identity Services (GIS) Sign in with Google: rendered button + One Tap prompt on `/login` and `/signup`.
  - Auth is a high-risk surface: adheres strictly to existing session, cookie, audit, and provisioning architectures.
  - Zero schema migrations & non-null invariant: `User.hashedPassword` is a required database column. It is never made nullable. For new Google users, an Argon2 hash of a 32-byte cryptographically secure random secret is generated, ensuring schema compliance, unguessable password login, and seamless future password setup via the existing forgot-password flow.
  - Account-creation terms rule:
    - On `/login`, Google sign-in requires an existing account. If unknown email, rejects with HTTP 400 Bad Request (`No account exists for this email. Please sign up first.`).
    - On `/signup`, Google sign-in container is gated until the user accepts the terms of service and privacy policy checkbox. Passing `termsAccepted: true` provisions new user, tenant, workspace, trial, and owner membership via `UserRepository.createWithTenantTransaction`. Passing `termsAccepted: false` or omitting it rejects new emails with HTTP 400 Bad Request (`No account exists for this email. Please sign up first.`).
    - For existing users signing in via `/signup` or `/login`, `termsAccepted` is ignored, and login succeeds immediately (terms were already agreed to upon account creation).
  - Email verification: Google OIDC tokens certify `email_verified`. For new Google users, `emailVerified: true` and `emailVerifiedAt: new Date()` are recorded upon creation. For existing users whose email was previously unverified, Google sign-in automatically promotes their status to verified via `UserRepository.markEmailVerified()`.
  - Password lockout non-interaction: Account lockout guards password brute-force guessing. Google sign-in bypasses password verification; it neither checks `lockedUntil` nor increments `failedLoginAttempts`.
  - Native verification over heavy dependency: Follows the Ponytail minimal-diff philosophy by verifying Google OIDC ID tokens via Google's official `https://oauth2.googleapis.com/tokeninfo` endpoint using native `fetch` with a 3000ms `AbortController` timeout instead of bundling the 5MB `google-auth-library`.
  - Audit logging: Records `AUTH_LOGIN_SUCCEEDED` (for existing accounts) or `AUTH_SIGNUP_SUCCEEDED` (for newly provisioned accounts) with metadata `{ provider: 'GOOGLE' }`.
- **Scope & Exclusions**:
  - OUT OF SCOPE:
    - Google account linking/unlinking UI in user settings.
    - Reusing the YouTube publishing OAuth client for sign-in (Sign in with Google uses its own dedicated `GOOGLE_CLIENT_ID`).
    - Any changes to password-based signup or login flows.
    - Sign in with Apple / Microsoft.

### 2. Technical Architecture & Modifications

#### A. Database Layer (`packages/database`)
- **UserRepository (`packages/database/src/repositories/UserRepository.ts`)**:
  - Extended `CreateUserWithTenantInput` with optional `emailVerified?: boolean` and `emailVerifiedAt?: Date | null` (defaults to `false` and `null` to preserve existing password signup behavior).
  - Updated `createWithTenantTransaction` to assign `input.emailVerified ?? false` and `input.emailVerifiedAt ?? (input.emailVerified ? new Date() : null)`.
  - Implemented `markEmailVerified(id: string, verifiedAt = new Date()): Promise<User>` to flip `emailVerified: true` and record `emailVerifiedAt` for existing accounts.
- **Build**: Built `@agency-os/database` cleanly via `pnpm --filter @agency-os/database build`.

#### B. API Auth Module (`apps/api/src/modules/auth/`)
- **DTO (`apps/api/src/modules/auth/dto/google-sign-in.dto.ts`)**:
  - `GoogleSignInDto`: `credential` (`@IsString() @IsNotEmpty()`) and `termsAccepted` (`@IsOptional() @IsBoolean()`).
- **Google Token Verifier (`apps/api/src/modules/auth/google-token-verifier.service.ts`)**:
  - Checks presence of `process.env.GOOGLE_CLIENT_ID`; if unset or empty, throws `ServiceUnavailableException('Google sign-in is not configured.')`.
  - Validates credential string format (throws `UnauthorizedException('Google sign-in failed. Please try again.')` if invalid).
  - Queries Google tokeninfo endpoint (`process.env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo'`) with POST body `id_token=${encodeURIComponent(credential)}` and 3000ms timeout.
  - Enforces OIDC security invariants:
    - `aud === process.env.GOOGLE_CLIENT_ID` (client ID match).
    - `iss` is either `'accounts.google.com'` or `'https://accounts.google.com'`.
    - `exp > Math.floor(Date.now() / 1000)` (token not expired).
    - `email_verified === 'true' || email_verified === true` (email verified by Google).
    - `email` is present and non-empty.
  - Returns `{ email: data.email, name: data.name || null }`.
  - Strictly redacts raw credentials from all logs and wraps all failures in generic `UnauthorizedException('Google sign-in failed. Please try again.')`.
- **Auth Service (`apps/api/src/modules/auth/auth.service.ts`)**:
  - Implemented `googleSignIn(profile, termsAccepted?, requestContext?, requestId?)`:
    - Normalizes email (`trim().toLowerCase()`).
    - If user exists: promotes unverified email via `markEmailVerified`, creates session via `SessionManager.createSession`, and logs `AUTH_LOGIN_SUCCEEDED` with `{ provider: 'GOOGLE' }`.
    - If user does not exist:
      - Enforces `termsAccepted === true`; otherwise throws `BadRequestException('No account exists for this email. Please sign up first.')`.
      - Generates 32 random bytes, hashes with Argon2, resolves display name (`profile.name` or email prefix).
      - Provisions organization, workspace with active trial, and user via `userRepository.createWithTenantTransaction` (`emailVerified: true`).
      - Creates session via `SessionManager.createSession`, and logs `AUTH_SIGNUP_SUCCEEDED` with `{ provider: 'GOOGLE' }`.
- **Auth Controller (`apps/api/src/modules/auth/auth.controller.ts`)**:
  - Added `POST /api/v1/auth/google` endpoint:
    - Throttled under `RateLimitPolicies.auth`.
    - Enforces production HTTPS check (bypassed locally by `ALLOW_INSECURE_HTTP_AUTH === 'true'`).
    - Verifies token via `GoogleTokenVerifierService`.
    - Invokes `AuthService.googleSignIn` with client IP and User-Agent.
    - Sets `httpOnly` `session` cookie and `csrfToken` cookie matching standard `login` endpoint conventions.
- **Module Registration (`apps/api/src/modules/auth/auth.module.ts`)**:
  - Registered `GoogleTokenVerifierService` as an injectable provider in `AuthModule`.

#### C. Web UI (`apps/web`)
- **Login Page (`apps/web/src/app/login/page.tsx`)**:
  - Checks `process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID`; renders nothing if unset.
  - Injects `https://accounts.google.com/gsi/client` script asynchronously with deduplication.
  - Initializes GIS and renders official button into container with `theme: 'outline'`, `size: 'large'`, `width: '100%'`, `text: 'signin_with'`, separated by an 'Or continue with email' divider.
  - Invokes One Tap prompt via `google.accounts.id.prompt()`.
  - Submits credential to `auth/google` (`termsAccepted: false`), invalidates `authQueries.me()`, and routes to valid redirect or first workspace analytics dashboard.
- **Signup Page (`apps/web/src/app/signup/page.tsx`)**:
  - Checks `process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID`; renders nothing if unset.
  - Injects GIS script asynchronously and initializes button with `text: 'signup_with'`.
  - Terms gating: Google UI container has `className="hidden"` until the terms checkbox is checked. Helper text informs user to accept terms to enable Sign in with Google.
  - Submits credential with current `termsAccepted` state, invalidates auth query, and routes to valid redirect or first workspace dashboard.

### 3. Verification & Evidence

- **Backend Unit Tests (`apps/api`)**:
  - 45/45 test files PASS, 625/625 tests PASS.
  - `google-token-verifier.service.spec.ts`: 11/11 tests PASS (valid token resolution, 503 when client ID unset, empty credential rejection, Google API 400 error, network timeout/abort, aud mismatch, iss mismatch, expired token, unverified email, missing email, name fallback).
  - `auth.service.spec.ts`: 65/65 tests PASS (+4 new tests covering existing user login, emailVerified promotion, new user signup with random Argon2 hash, termsAccepted requirement).
  - `auth.controller.spec.ts`: 44/44 tests PASS (+4 new tests covering HTTPS guard, cookie issuance, IP/User-Agent forwarding, 400 validation error propagation).
- **API E2E Tests (`apps/api/test/google-sign-in.e2e-spec.ts`)**:
  - 1/1 test suite PASS, 4/4 tests PASS:
    - Valid token for new email with `termsAccepted: true` provisions user, workspace with trial, and sets session/csrf cookies.
    - Same email logs in successfully without creating duplicate user.
    - Valid token without `termsAccepted` returns HTTP 400 (`No account exists for this email. Please sign up first.`).
    - Invalid token returns HTTP 401 (`Google sign-in failed. Please try again.`).
- **Web Unit Tests (`apps/web`)**:
  - 24/24 test files PASS, 276/276 tests PASS.
  - `apps/web/src/app/login/page.spec.tsx`: 29/29 tests PASS (+4 new tests: hidden when env unset, GIS initialization and prompt, credential submit and navigation, error surfacing).
  - `apps/web/src/app/signup/page.spec.tsx`: 20/20 tests PASS (+4 new tests: hidden when env unset, terms gating visibility toggle, credential submit with termsAccepted, error surfacing).
- **Static Quality & Build Gates**:
  - `packages/database`: build, lint (0 errors), typecheck clean exit 0.
  - `apps/api`: build, lint (0 errors), typecheck clean exit 0.
  - `apps/web`: build, lint (0 errors), typecheck clean exit 0.

### 4. Operator Setup Instructions

To enable Sign in with Google in an environment:
1. **Google Cloud Console Configuration**:
   - Create or open a project in Google Cloud Console.
   - Go to **APIs & Services** > **Credentials**.
   - Create an **OAuth 2.0 Client ID** of application type **Web application**.
   - Under **Authorized JavaScript origins**, add:
     - Development: `http://localhost:3000`
     - Production: `https://app.yourdomain.com` (your production web domain)
   - Do NOT add redirect URIs (Google Identity Services uses JavaScript callbacks and tokeninfo verification rather than redirect flows).
2. **Environment Variables**:
   - In `apps/api/.env`:
     ```env
     GOOGLE_CLIENT_ID="<your-client-id>.apps.googleusercontent.com"
     ```
   - In `apps/web/.env.local`:
     ```env
     NEXT_PUBLIC_GOOGLE_CLIENT_ID="<your-client-id>.apps.googleusercontent.com"
     ```
3. **Graceful Degradation**:
   - If `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is omitted or empty, the application runs normally without Google buttons or One Tap prompts, and any direct API calls to `/v1/auth/google` receive HTTP 503 (`Google sign-in is not configured.`).

### 5. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `da6e1bf4` is 6/6 green (all 2026-11-19): GitGuardian Security Checks 13:01:55Z, Application Builds 13:02:49Z, API E2E Tests 13:03:27Z, Tests 13:03:28Z, Code Quality (Lint & Typecheck) 13:03:33Z, Docker Build & Smoke Test 13:10:40Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #89 is open against main at reviewed head `da6e1bf41c53730807098ab2aed17f9b88abbf60`; CI is 6/6 green on the reviewed head; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone. Live deployment remains STRICT NO-GO.

---

## 77. Standalone Dashboard Sign-Out Query Cache Clear

### 1. Summary & Root Cause

- **Status**: implemented on branch `fix/dashboard-logout-cache`; PR #90 open against `main` at reviewed head `2c4709ee1dbfebdafcfe8f4760d7e80cb8556cce`
- **Issue & Symptom**: Clicking "Sign out" on the standalone dashboard (`/dashboard`) appeared to do nothing. Live logs confirmed `POST /api/v1/auth/logout` returned HTTP 200 with the session destroyed and session/csrf cookies cleared.
- **Root Cause**:
  - `apps/web/src/app/dashboard/page.tsx`'s `handleLogout` called `await api.post('auth/logout')` followed immediately by `router.push('/login')` without evicting TanStack Query's cache.
  - Root layout `AuthGuard` (`apps/web/src/components/auth-guard.tsx`) evaluates `useQuery(authQueries.me())` (`['auth', 'me']`).
  - Upon navigating to `/login`, `AuthGuard` checked the still-cached user session in the TanStack Query store, considered the user actively authenticated, and triggered `router.replace('/dashboard')` (the unverified-user routing branch), bouncing the user right back to where they started.
- **Contrast with Shell**:
  - `apps/web/src/components/dashboard-shell.tsx` already handled logout correctly by invoking `queryClient.clear()` immediately after `api.post('auth/logout')` and prior to `router.push('/login')`. The dashboard page was missing this cache invalidation step.

### 2. Sign-Out Call Site Sweep

A comprehensive sweep of `apps/web/src` for `auth/logout` and sign-out actions was executed:
1. `apps/web/src/components/dashboard-shell.tsx` (line 43):
   - Invokes `await api.post('auth/logout')`, followed by `queryClient.clear()`, then `router.push('/login')`.
   - Verified correct and functioning as expected. Left unmodified.
2. `apps/web/src/app/dashboard/page.tsx` (line 20):
   - Previously called `await api.post('auth/logout')` and `router.push('/login')` without clearing cache.
   - Fixed to mirror `dashboard-shell.tsx` exactly.
- Zero other sign-out call sites exist across `apps/web/src`.

### 3. Technical Changes

- **Dashboard Page (`apps/web/src/app/dashboard/page.tsx`)**:
  - Imported `useQueryClient` from `@tanstack/react-query`.
  - Instantiated `const queryClient = useQueryClient();`.
  - Updated `handleLogout` to call `queryClient.clear()` after successful `api.post('auth/logout')` and before `router.push('/login')`.
  - Preserved existing `try / catch` structure and `console.error('Logout failed', e)` behavior.
- **Scope Discipline**:
  - Strictly 3 lines changed in `apps/web/src/app/dashboard/page.tsx`.
  - No changes to API routes or controllers.
  - No changes to `auth-guard.tsx` or `lib/query/auth.ts`.
  - No changes to `dashboard-shell.tsx`.

### 4. Verification & Test Evidence

- **Dashboard Page Unit Tests (`apps/web/src/app/dashboard/page.spec.tsx`)**:
  - 1/1 test file PASS, **7/7 tests PASS** (+1 new test, previously 6/6).
  - Added unit test: `calls auth/logout, clears query cache, and navigates to /login on Sign out click`.
  - Verified assertions:
    - `api.post('auth/logout')` called exactly once.
    - `queryClient.clear()` called exactly once.
    - `router.push('/login')` called exactly once.
    - Call order strictly verified: `clearSpy.mock.invocationCallOrder[0] < mockPush.mock.invocationCallOrder[0]`.
- **Web Test Suite (`apps/web`)**:
  - 24/24 test files PASS, **277/277 tests PASS**.
- **Static Quality Gates**:
  - `apps/web` ESLint: 0 errors.
  - `apps/web` Next.js production build: clean exit 0.

### 5. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `2c4709ee` is 6/6 green (all 2026-11-19): GitGuardian Security Checks 14:13:38Z, Application Builds 14:14:34Z, Code Quality (Lint & Typecheck) 14:15:06Z, API E2E Tests 14:15:18Z, Tests 14:15:34Z, Docker Build & Smoke Test 14:22:22Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #90 is open against main at reviewed head `2c4709ee1dbfebdafcfe8f4760d7e80cb8556cce`; CI is 6/6 green on the reviewed head; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone. Live deployment remains STRICT NO-GO.

---

## 78. Per-Plan Social Account Caps & Enforced Entitlements

### 1. Summary & Motivation

- **Status**: implemented on branch `feat/plan-social-account-caps`; PR #91 open against `main` at reviewed head `e84339f66255ff67931d99c01410ed1613415d04`
- **Scope & Objectives**:
  - Enforce per-plan limits on connected social accounts across Agency OS subscriptions.
  - Canonical plan configuration in `billing.config.ts` (`PLANS`) defines limits:
    - **SOLO**: 5 social accounts
    - **STUDIO**: 15 social accounts
    - **AGENCY**: 30 social accounts
    - **AGENCY_FOUNDING**: 30 social accounts
  - `WorkspaceEntitlements` in `EntitlementsService` exposes `socialAccountLimit: number`, populated across all workspace states (trials and unmetered/test defaults receive full Agency entitlements of 30 accounts; unknown/custom plan codes conservatively fall back to 30).
  - Enforce cap via `EntitlementsService.assertSocialAccountLimit(workspaceId, additionalAccounts = 1)`, counting `prisma.socialAccount.count({ where: { workspaceId } })` across all statuses (disconnected accounts retain their slot; only genuinely new accounts consume new slots).
  - Gate OAuth connections in `OAuthService` at both creation entrypoints:
    1. Direct single-profile callback path (`handleOAuthCallback`): if the account is new for `(provider, externalId)`, assert limit before `upsertWithConnection`. Existing accounts/reconnects/scope-upgrades bypass the check.
    2. Multi-profile discovery selection path (`processDiscoverySelection`): count genuinely new profiles selected; if `newCount > 0`, assert limit for `newCount` before creating accounts (all-or-nothing semantics: if the selection exceeds the cap, zero accounts are created).
- **Known v1 Limitation**:
  - On the single-profile callback path (`GET /v1/oauth/:provider/callback`), a cap rejection (`ForbiddenException`) is caught by the existing controller error handler and redirected to `${frontendUrl}/dashboard?error=oauth_failed`.
  - On the discovery selection path (`POST /v1/workspaces/:workspaceId/oauth/discoveries/:discoveryId/select`), the `ForbiddenException` propagates directly to the client as an HTTP 403 with the detailed limit message.

### 2. Technical Architecture & Modifications

#### A. Billing & Entitlements (`apps/api`)
- **Plan Configuration (`apps/api/src/modules/billing/billing.config.ts`)**:
  - Added `socialAccountLimit: number` to `PlanConfig` interface.
  - Defined limits: SOLO (5), STUDIO (15), AGENCY (30), AGENCY_FOUNDING (30).
- **Entitlements Service (`apps/api/src/modules/billing/entitlements.service.ts`)**:
  - Added `socialAccountLimit: number` to `WorkspaceEntitlements` interface.
  - Implemented `resolveSocialAccountLimit(planCode)` helper and populated `socialAccountLimit` in every return branch of `getWorkspaceEntitlements` (paid plans, active trials, expired trials, and fallback unmetered state).
  - Added `assertSocialAccountLimit(workspaceId: string, additionalAccounts = 1): Promise<void>` mirroring `assertSeatLimit`:
    - Queries total account count: `prisma.socialAccount.count({ where: { workspaceId } })`.
    - Throws `ForbiddenException`: `Social account limit exceeded for ${entitlements.planCode}. Current accounts: ${count}, max allowed: ${entitlements.socialAccountLimit}. Please upgrade your plan.`

#### B. Database Layer (`packages/database`)
- **Social Account Repository (`packages/database/src/repositories/SocialAccountRepository.ts`)**:
  - Added `findByProviderAndExternalId(provider: SocialProvider, externalId: string): Promise<SocialAccount | null>` using compound unique key `provider_externalId: { provider, externalId }`, matching the upsert lookup pattern without adding a second query pattern.

#### C. OAuth Service (`apps/api`)
- **OAuth Account Creation Gating (`apps/api/src/modules/oauth/oauth.service.ts`)**:
  - `handleOAuthCallback`: looks up existing account via `socialAccountRepo.findByProviderAndExternalId(validProviderEnum, profile.id)`. If absent, calls `entitlementsService.assertSocialAccountLimit(workspaceId, 1)` prior to `upsertWithConnection`.
  - `processDiscoverySelection`: counts new profiles among `selectedProfiles` by querying `findByProviderAndExternalId`. If `newCount > 0`, calls `entitlementsService.assertSocialAccountLimit(workspaceId, newCount)` before batch upsert.

### 3. Verification & Test Evidence

- **Billing Config Tests (`apps/api/src/modules/billing/billing.config.spec.ts`)**:
  - 1/1 test file PASS, **15/15 tests PASS** (verified `socialAccountLimit` assertions on all 4 plan definitions).
- **Entitlements Service Tests (`apps/api/src/modules/billing/entitlements.service.spec.ts`)**:
  - 1/1 test file PASS, **15/15 tests PASS** (+6 new tests, previously 9/9):
    - `socialAccountLimit resolves 5/15/30/30 for SOLO/STUDIO/AGENCY/AGENCY_FOUNDING subscriptions`.
    - `resolves 30 for trial and expired-trial workspaces`.
    - `assertSocialAccountLimit passes under the cap`.
    - `assertSocialAccountLimit passes when count + additional == limit`.
    - `assertSocialAccountLimit throws the exact message at limit + 1`.
    - `assertSocialAccountLimit honors additionalAccounts > 1`.
- **OAuth Service Tests (`apps/api/src/modules/oauth/oauth.service.spec.ts`)**:
  - 1/1 test file PASS, **18/18 tests PASS** (+4 new tests, previously 14/14):
    - `new account at cap -> ForbiddenException and upsertWithConnection NOT called`.
    - `existing account at cap -> connect succeeds with no assertion failure`.
    - `discovery selection of 2 new profiles at cap - 1 -> throws and creates none`.
    - `discovery selection mixing 1 existing + 1 new under the cap -> succeeds`.
- **OAuth Controller Tests (`apps/api/src/modules/oauth/oauth.controller.spec.ts`)**:
  - 1/1 test file PASS, **20/20 tests PASS**.
- **Monorepo Quality Gates**:
  - `pnpm turbo run typecheck`: **10/10 tasks successful** (0 errors).
  - `pnpm turbo run lint`: **9/9 packages successful** (0 errors).
  - `pnpm turbo run build`: **7/7 tasks successful** (0 errors).
- **E2E Testing Note**:
  - No new E2E tests were added in this PR: OAuth callbacks require live external social provider mocking (OAuth consent redirects and token exchange endpoints) which does not exist in the current synthetic E2E test suites. Full end-to-end coverage is verified via unit and service integration tests.

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on the reviewed head `e84339f` is 6/6 green (all 2026-11-19): GitGuardian Security Checks 15:39:49Z, Application Builds 15:40:45Z, Tests 15:41:15Z, Code Quality (Lint & Typecheck) 15:41:23Z, API E2E Tests 15:41:38Z, Docker Build & Smoke Test 15:48:25Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #91 is open against main at reviewed head `e84339f66255ff67931d99c01410ed1613415d04`; CI is 6/6 green on the reviewed head; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone. Live deployment remains STRICT NO-GO.

## 79. Correctness Fixes: Terms Annual Prices and Billing Trade Name

### 1. Summary & Motivation

- **Status**: implemented on branch `fix/legal-prices-and-tradename`; PR #93 open against `main` at reviewed head `91134ca2a0f992b3d38fa946a91a7a4fed11581a`
- **Scope & Objectives**:
  - Reconcile published Terms of Service annual pricing with canonical `billing.config.ts` plan configurations: annual prices are strictly 10x monthly prices (2 months free).
  - Align filed enterprise trade name in `ENTERPRISE_DETAILS` to `'Gadmale Technologies'`.
- **Out of Scope**:
  - Any other legal-text changes (placeholders like court city, domain, hosting region remain intact).
  - Price or plan changes in `billing.config.ts` (canonical config was already correct).
  - Landing-page copy (deferred to separate follow-up PR).

### 2. Changes & File Modifications

#### A. Terms Annual Prices Alignment (Fix 1)
- **`apps/web/src/content/legal/terms.md`** (§3.1):
  - Updated annual figures from `Solo ₹4,999/year, Studio ₹9,999/year, Agency ₹39,999/year` and `(₹29,999/year)` to `Solo ₹4,990/year, Studio ₹9,990/year, Agency ₹39,990/year` and `(₹29,990/year)`.
  - Sentence structure, monthly rates (`Solo ₹499/month, Studio ₹999/month, Agency ₹3,999/month`, founding lock `₹2,999/month`), and all other legal text kept strictly identical.
- **`apps/web/src/app/terms/page.tsx`** (§3.1):
  - Updated JSX rendering of §3.1 with exact identical figures: `Solo ₹4,990/year, Studio ₹9,990/year, Agency ₹39,990/year` and `(₹29,990/year)`.

#### B. Repo-wide Sweep for Price Strings & Dispositions
A repository-wide search was performed for strings `'4,999'`, `'9,999'`, `'39,999'`, `'29,999'` and raw sequences `'4999'`, `'9999'`, `'39999'`, `'29999'`:
- `apps/web/src/content/legal/terms.md:34`: **Fixed** — Terms markdown text corrected to config values (`₹4,990`, `₹9,990`, `₹39,990`, `₹29,990`).
- `apps/web/src/app/terms/page.tsx:65`: **Fixed** — Terms page JSX text corrected to config values (`₹4,990`, `₹9,990`, `₹39,990`, `₹29,990`).
- `IMPLEMENTATION_STATUS.md:4424`: **Left alone** — Historical audit note in §61 documenting the previously unresolved discrepancy between legal terms and billing code.
- `apps/api/src/modules/publishing/domain/PublishabilityValidator.spec.ts`: **Left alone** — Contains `byteSize: 999999999`; video byte-size limit test fixture, not a price.
- `packages/providers/youtube/youtube.provider.spec.ts`: **Left alone** — Contains `categoryId: '99999'`; invalid YouTube category ID test fixture, not a price.

#### C. Enterprise Trade Name Correction (Fix 2)
- **`apps/api/src/modules/billing/billing.config.ts`**:
  - Changed `ENTERPRISE_DETAILS.tradeName` from `'Kyosys Agency OS'` to `'Gadmale Technologies'` (filed trade name).
  - All other fields (`name`, `state`, `stateCode`) remain unchanged.
- **Consumer Audit for `tradeName` across Repo**:
  - Codebase search for `tradeName` confirmed **0 consumer references** reading `ENTERPRISE_DETAILS.tradeName`.
  - `apps/api/src/modules/billing/pdf-invoice.service.ts` was audited and verified to consume only `ENTERPRISE_DETAILS.name` (line 135) and `ENTERPRISE_DETAILS.state`/`stateCode` (line 138), with import at line 3.

#### D. Tests & Assertions
- **`apps/api/src/modules/billing/billing.config.spec.ts`**:
  - Added assertion `expect(ENTERPRISE_DETAILS.tradeName).toBe('Gadmale Technologies');` to the enterprise details test block.
- **`apps/web/src/app/terms/page.spec.tsx`**:
  - Added test case asserting the presence of `Solo ₹4,990/year`, `Studio ₹9,990/year`, `Agency ₹39,990/year`, and `₹29,990/year`.

### 3. Verification & Test Evidence

- **Billing Tests (`apps/api`)**:
  - `apps/api/src/modules/billing/billing.config.spec.ts`: **15/15 tests PASS** (including `tradeName` assertion).
  - All billing suites: **8/8 test files PASS, 93/93 tests PASS**.
- **Web Tests (`apps/web`)**:
  - `apps/web/src/app/terms/page.spec.tsx`: **4/4 tests PASS** (+1 new test).
  - All web suites: **24/24 test files PASS, 278/278 tests PASS**.
- **Monorepo Quality Gates**:
  - `apps/api` typecheck (`tsc --noEmit`): **0 errors**.
  - `apps/web` lint (`eslint`): **0 errors**.

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on reviewed head `91134ca2` is 6/6 green (all 2026-11-20): GitGuardian Security Checks 14:01:30Z, Application Builds 14:02:36Z, Code Quality (Lint & Typecheck) 14:02:58Z, API E2E Tests 14:03:05Z, Tests 14:03:27Z, Docker Build & Smoke Test 14:09:38Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #93 is open against main at reviewed head `91134ca2a0f992b3d38fa946a91a7a4fed11581a` with CI 6/6 green; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone. Live deployment remains STRICT NO-GO.

## 80. Landing Page Refresh: Shipped Features and UI Elevation

### 1. Summary & Motivation

- **Status**: implemented on branch `feat/landing-page-refresh`; PR #94 open against `main` at reviewed head `81773cbe7924e3b2aa18c14f00a308b0e901a19a`
- **Scope & Objectives**:
  - Refresh the public landing page (`/`) to showcase recently shipped capabilities (PRs #87, #88, #89, #91) with 100% factual accuracy.
  - Feature additions: added 'Client approvals' and 'White-label reports' feature cards (ungated across plans), added plan social account allowances (Solo 5, Studio 15, Agency 30), and added two factual FAQ entries for approvals and custom branded reports.
  - UI Elevation: sticky header with backdrop blur, subtle blue-to-slate hero gradient wash, unified section eyebrow hierarchy, uniform icon chip feature cards, connected step markers for workflow, visually elevated Agency pricing tier (`For agencies` tag + accent border), and an accessible pre-footer CTA band.
  - Architectural constraints: Page remains a pure React Server Component (RSC), `next/link` and `lucide-react` icons only, zero external assets or images, zero new dependencies.
  - Strict scope boundaries: Maintained strict prohibition of unbuilt features (e.g. AI captions), testimonials, customer logos, user counts, and synthetic social proof.

### 2. Changes & File Modifications

#### A. Public Landing Page (`apps/web/src/app/page.tsx`)
- **Header Nav**:
  - Applied `sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-200` with existing logo link to `/`, Sign in link to `/login`, and 'Start free trial' CTA to `/signup`.
- **Hero Section**:
  - Added subtle background gradient `bg-gradient-to-b from-blue-50/60 via-slate-50/30 to-white border-b border-gray-100`.
  - Headline preserved: `Social media management for agencies and small teams — plan, publish, and measure client accounts from one workspace`.
  - Both CTAs preserved: primary `Start 14-day free trial` (`/signup`), secondary `Sign in` (`/login`), microcopy `No credit card required.`.
- **Risk-Reversal Strip**:
  - Preserved all 6 factual assurances: 14-day free trial no credit card, monthly billing cancel anytime, 7-day money-back guarantee, UPI/cards accepted via Razorpay, GST invoice on every payment, and prices include GST.
- **Workflow / How It Works**:
  - Added `Workflow` eyebrow and connected 3-step numbered markers (1/2/3) with a horizontal connecting line on desktop (`hidden md:block absolute top-6 left-[16%] right-[16%] h-0.5 bg-blue-100`).
- **Shipped Features Grid**:
  - Added `Capabilities` eyebrow and organized 10 uniform cards with colored icon chips (`w-10 h-10 rounded-lg bg-blue-50 text-blue-600`):
    - Added **Client approvals** (`UserCheck`): `Clients review and approve posts before they publish; change requests come back with comments, and nothing goes live while approval is pending.` (not plan-gated).
    - Added **White-label reports** (`Palette`): `Client-ready PDF reports with your agency's name, logo and brand colour instead of ours.` (not plan-gated).
    - Preserved existing 8 cards: Multi-platform publishing, Post scheduling, Per-platform post variants, Media library, Analytics dashboard, Team workspaces & roles, Account security, GST-ready billing.
- **Pricing Section**:
  - Added `Transparent Pricing` eyebrow and 2-month free annual billing banner.
  - Added plan social account caps to feature lists:
    - Solo: `Up to 5 social accounts`
    - Studio: `Up to 15 social accounts`
    - Agency: `Up to 30 social accounts`
  - Monthly prices strictly retained (`₹499`, `₹999`, `₹3,999`), seat lines retained (`1 seat included`, `3 seats included`, `10 seats included`), GST inclusive notice retained.
  - Founding 50 callout preserved verbatim: `Founding 50 — ₹2,999/month, price locked while your subscription stays active, for the first 50 customers.`.
  - Visual elevation on Agency card: `border-2 border-blue-600 shadow-lg relative` with `For agencies` tag.
- **FAQ Section**:
  - Added `FAQ` eyebrow and expanded to 7 factual entries:
    - Added: `Can my clients approve posts before they go live?` — `Yes: send a post for approval, the client approves or requests changes with a comment, and publishing stays blocked until it's approved.`
    - Added: `Can I send reports with my own branding?` — `Yes: add your agency name, logo and brand colour in settings and client reports carry your brand, not Agency OS.`
    - Preserved existing 5 entries (free trial terms, payment methods, GST compliance, cancellation & refund policy, supported social platforms).
- **Pre-Footer CTA Band**:
  - Added pre-footer section with subtle accent wash (`bg-gradient-to-b from-blue-50/80 via-blue-50/50 to-white border-t border-b border-blue-100`):
    - Heading: `Ready to streamline your agency publishing?`
    - Microcopy: `Get full access to all features with a 14-day free trial — no credit card required.`
    - Primary button: `Start free trial` linking to `/signup`.
- **Footer**:
  - Maintained operator copyright (`© Gadmale Technologies`), email (`agadmale335@gmail.com`), and legal links (`/terms`, `/privacy`, `/refund-cancellation`).

#### B. Landing Page Unit Tests (`apps/web/src/app/page.spec.tsx`)
- Removed negative assertions that previously forbade white-label reports and approvals.
- Added positive assertions verifying rendered feature cards and descriptions for both Client approvals and White-label reports.
- Added positive assertions for newly added FAQ entries.
- Added assertions verifying social account allowances across all 3 tiers (`Up to 5 social accounts`, `Up to 15 social accounts`, `Up to 30 social accounts`).
- Added assertion verifying the final CTA band renders and links to `/signup`.
- Maintained negative assertions strictly forbidding AI captions (`/ai caption/i`) and social proof/testimonials (`/testimonial/i`, `/trusted by/i`).

### 3. Verification & Test Evidence

- **Landing Page Tests (`apps/web/src/app/page.spec.tsx`)**:
  - 1/1 test file PASS, **8/8 tests PASS** (before: 5 tests, delta: +3 new test blocks).
- **Web Unit Tests (`apps/web`)**:
  - 24/24 test files PASS, **281/281 tests PASS** (before: 278 tests, delta: +3 tests).
- **Monorepo Quality Gates**:
  - `apps/web` ESLint: **0 errors, 0 warnings** on modified files.
  - `apps/web` typecheck (`tsc --noEmit`): **0 errors**.
  - `apps/api` typecheck (`tsc --noEmit`): **0 errors**.

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on reviewed head `81773cbe` is 6/6 green (all 2026-11-20): GitGuardian Security Checks 14:38:47Z, Application Builds 14:39:52Z, Tests 14:40:18Z, Code Quality (Lint & Typecheck) 14:40:25Z, API E2E Tests 14:40:29Z, Docker Build & Smoke Test 14:47:19Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #94 is open against main at reviewed head `81773cbe7924e3b2aa18c14f00a308b0e901a19a` with CI 6/6 green; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone. Live deployment remains STRICT NO-GO.

## 81. Workspace Member Management: Email Invitations, Roles, and Team UI

### 1. Summary & Motivation

- **Status**: implemented on branch `feat/workspace-members`; PR #95 open against `main` at reviewed head `eddfe3f6cfcc16f9a3bbf0f9cb209e831a6f21eb` (base `7c05687ad1fd23cf42e1b36e5fd44896341a69e1`)
- **Scope & Objectives**:
  - Build workspace member management end-to-end: email invitations, role-based member list, pending invitations list, revoke/resend invitations, member role updates, and member removal.
  - Build invitation acceptance flow via token link with expiration, email verification, account matching checks, and authentication routing.
  - Enforce role hierarchies (a manager cannot invite or promote to owner, cannot edit or remove owner), seat limits via `EntitlementsService.assertSeatLimit` (counting current members + live pending invitations + 1), and workspace writable guard (mutations blocked on read-only/expired trial/halted subscription workspaces).
  - Add dashboard navigation item 'Team' (`UserCheck` icon) under settings linking to `/${workspaceId}/team`.
  - Maintain audit trail: `MEMBER_INVITED`, `MEMBER_INVITATION_REVOKED`, `MEMBER_INVITATION_RESENT`, `MEMBER_INVITATION_ACCEPTED`, `MEMBER_ROLE_UPDATED`, `MEMBER_REMOVED`.
- **Out of Scope**:
  - Leaving a workspace (self-removal) - deferred to user settings or future PR.
  - Transferring ownership as a dedicated atomic handover flow.
  - External / guest magic links or public invitation links.
  - Modifying `PermissionMatrix` ('members.manage' already mapped to `['OWNER', 'MANAGER']`), seat counts, or plan definitions.
  - Web navigation hiding by role beyond Team page controls.

### 2. Architecture & Implementation Details

#### A. Database Schema & Migration (`packages/database/prisma/schema.prisma`)
- Added `WorkspaceInvitation` model:
  - `id`: UUID primary key.
  - `workspaceId`: FK Workspace (onDelete: Cascade).
  - `email`: TEXT normalized email.
  - `role`: `WorkspaceRole` enum (`OWNER`, `MANAGER`, `EDITOR`, `CLIENT_APPROVER`, `VIEWER`).
  - `invitedByUserId`: FK User (onDelete: Cascade).
  - `tokenHash`: TEXT unique index (SHA-256 hash of random 32-byte hex token).
  - `expiresAt`: DateTime (indexed, default 7 days).
  - `consumedAt`: DateTime? (nullable, set upon acceptance).
  - `revokedAt`: DateTime? (nullable, set upon revocation; cleared upon resend).
  - `createdAt`, `updatedAt`: DateTime.
  - Indexes: `[workspaceId]`, `[expiresAt]`, unique `[tokenHash]`.
- Relations:
  - `Workspace.invitations`: `WorkspaceInvitation[]`
  - `User.sentInvitations`: `WorkspaceInvitation[]`
- Migration:
  - `packages/database/prisma/migrations/20261120000000_add_workspace_invitations/migration.sql` created table and indexes cleanly.
- Audit Actions:
  - Added 6 new actions to `AuditLogRepository.ts`: `MEMBER_INVITED`, `MEMBER_INVITATION_REVOKED`, `MEMBER_INVITATION_RESENT`, `MEMBER_INVITATION_ACCEPTED`, `MEMBER_ROLE_UPDATED`, `MEMBER_REMOVED`.

#### B. Email Delivery Service (`apps/api/src/modules/auth/email-delivery.service.ts`)
- Added `sendWorkspaceInvitationEmail(toEmail, { workspaceName, role, rawToken })` to:
  - `EmailDeliveryService` interface.
  - `MockEmailDeliveryService`: records sent invitation emails in in-memory array for assertions.
  - `NoopEmailDeliveryService`: safe no-op for testing/dev environments.
  - `ResendEmailDeliveryService`: builds the accept URL internally from `FRONTEND_URL` (fallback `http://localhost:3000`) + `'/accept-invite?token='` + `rawToken`, and sends a branded transactional invitation email containing the invite URL and role context via a `fetch` call to the Resend API (not the Resend SDK).
- Unit tests added to `email-delivery.service.spec.ts` (all 23/23 tests pass).

#### C. Workspaces Module API (`apps/api/src/modules/workspaces/`)
- Module structure:
  - `dto/create-invitation.dto.ts`: `@IsEmail()` with `@Transform` lowercase trim; `@IsEnum(WorkspaceRole)`.
  - `dto/update-member-role.dto.ts`: `@IsEnum(WorkspaceRole)`.
  - `dto/accept-invitation.dto.ts`: `@IsString()`, `@IsNotEmpty()`.
  - `services/workspaces.service.ts`:
    - `inviteMember`: checks role hierarchy (the inviter cannot grant a role equal to or above their own; controller-level `PermissionGuard` enforces `members.manage`); checks existing membership; checks pending invitation (disallowing duplicates); checks seat limit via `entitlementsService.assertSeatLimit(workspaceId, livePendingCount + 1)`; creates invitation with SHA-256 token hash (7-day expiry); triggers transactional email; logs `MEMBER_INVITED`.
    - `listMembers`: returns workspace members with user details and roles; for callers with `members.manage` (OWNER/MANAGER), returns pending invitations inline (`invitations` array).
    - `revokeInvitation`: verifies invitation belongs to workspace and is still pending; sets `revokedAt`; logs `MEMBER_INVITATION_REVOKED`.
    - `resendInvitation`: updates the same invitation row with a fresh tokenHash and reset 7-day expiry, clears `revokedAt`, re-sends invitation email, and logs `MEMBER_INVITATION_RESENT`.
    - `updateMemberRole`: checks actor hierarchy vs target and new role; prevents demoting the last `OWNER`; updates role; logs `MEMBER_ROLE_UPDATED`.
    - `removeMember`: checks actor hierarchy; prevents removing oneself; prevents removing the last `OWNER`; deletes `WorkspaceMember`; logs `MEMBER_REMOVED`.
    - `getInvitationInfo`: public endpoint returning `{ workspaceName, email, role, roleFormatted, expiresAt }`; throws `BadRequestException` if token is invalid, revoked, consumed, or expired.
    - `acceptInvitation`: verifies token validity; enforces user email matches invitation email; creates `WorkspaceMember`; marks invitation consumed; logs `MEMBER_INVITATION_ACCEPTED`.
  - `controllers/workspace-members.controller.ts`:
    - `@Controller('v1/workspaces/:workspaceId/members')` guarded by `AuthGuard`, `WorkspaceGuard`, `PermissionGuard`, and `WorkspaceWritableGuard` on mutations.
    - Endpoints: `POST /invitations`, `GET /` (lists members, and includes pending invitations inline for callers with `members.manage`), `POST /invitations/:invitationId/revoke`, `POST /invitations/:invitationId/resend`, `PATCH /:memberId`, `DELETE /:memberId`.
  - `controllers/invitations.controller.ts`:
    - `@Controller('v1/invitations')`
    - `GET /info?token=...`: public token lookup for accept-invite UI.
    - `POST /accept`: guarded by `AuthGuard` (session required).
  - `workspaces.module.ts`: registered in `apps/api/src/app.module.ts`.

#### D. Web Frontend & UI (`apps/web/`)
- **Dashboard Navigation (`apps/web/src/components/dashboard-shell.tsx`)**:
  - Added `Team` item with `UserCheck` icon linking to `/${currentWorkspaceId}/team` in secondary nav.
- **Query Options (`apps/web/src/lib/query/members.ts`)**:
  - Standardized query definitions via exported `membersQueries` object (`membersQueries.list(workspaceId)` and `membersQueries.invitationInfo(token)`).
- **Team Management Page (`apps/web/src/app/[workspaceId]/team/page.tsx`)**:
  - Displays current members table with user name, email, role badge, joined date.
  - Member actions: Role selection dropdown (disabled for self, last owner, or for managers editing owners) and Remove button with confirmation modal.
  - Invite form: Email input, role dropdown with helper text (specifically explaining `Client Approver` can only view and approve posts), submit button with loading state.
  - Pending invitations list: Displays email, role, sent date, expires date, and Resend / Revoke buttons.
  - Responsive, accessible, adhering to Tailwind design tokens.
- **Accept Invite Page (`apps/web/src/app/accept-invite/page.tsx`)**:
  - Suspense boundary wrapping `useSearchParams()`.
  - Reads `token` query param and fetches invitation info.
  - Handles invalid/expired/revoked states with clear feedback and CTA to request a new invite.
  - Handles unauthenticated users: displays workspace name, invited email, and role preview with Sign In / Sign Up buttons preserving return URL (`/accept-invite?token=...`).
  - Handles authenticated account mismatch: warns user they are logged in as `user.email` whereas invite is for `invite.email`, providing a "Sign Out & Switch Account" action.
  - Handles authenticated matching user: prominent "Accept Invitation" CTA calling `POST /v1/invitations/accept` and redirecting directly to `/${workspaceId}/analytics`.

### 3. Verification & Test Evidence

- **API Workspaces Tests**:
  - `apps/api/src/modules/workspaces/services/workspaces.service.spec.ts`: **25/25 tests PASS**.
  - `apps/api/src/modules/workspaces/controllers/workspace-members.controller.spec.ts`: **6/6 tests PASS**.
  - `apps/api/src/modules/workspaces/controllers/invitations.controller.spec.ts`: **2/2 tests PASS**.
  - Total Workspaces module tests: **33/33 PASS**.
- **API Email Delivery Tests**:
  - `apps/api/src/modules/auth/email-delivery.service.spec.ts`: **23/23 tests PASS**.
- **Web Unit Tests**:
  - `apps/web/src/app/[workspaceId]/team/page.spec.tsx`: **3/3 tests PASS**.
  - `apps/web/src/app/accept-invite/page.spec.tsx`: **5/5 tests PASS**.
  - Web package full suite: **26/26 test files PASS, 289/289 tests PASS** (previously 24 files, 281 tests; +2 files, +8 tests).
- **Monorepo Quality Gates**:
  - `apps/api` typecheck (`tsc --noEmit`): **0 errors**.
  - `apps/web` typecheck (`tsc --noEmit`): **0 errors**.
  - `apps/api` ESLint on workspaces module: **0 errors, 0 warnings**.
  - `apps/web` ESLint on modified web files: **0 errors, 0 warnings**.

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on reviewed head `eddfe3f6` is 6/6 green (all 2026-11-20): GitGuardian Security Checks 17:24:51Z, Application Builds 17:25:58Z, Tests 17:26:25Z, Code Quality (Lint & Typecheck) 17:26:29Z, API E2E Tests 17:26:40Z, Docker Build & Smoke Test 17:33:36Z. Note: CI re-runs on the docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #95 is open at the reviewed head with CI 6/6 green; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone. Live deployment remains STRICT NO-GO.

## 82. Role-Based UI Gating for CLIENT_APPROVER / VIEWER & API billing.view Tightening

### 1. Summary & Motivation

- **Status**: PR #96 open on branch `fix/approver-ui-rbac` (reviewed head `7892eeceba329f9fa7073d5926876010e9037a59`)
- **Pull Request**: [#96](https://github.com/AbhishekGadmale/Social-Media-Handler/pull/96)
- **Branch**: `fix/approver-ui-rbac`
- **Reviewed Head SHA**: `7892eeceba329f9fa7073d5926876010e9037a59` (`7892eec`)
- **Scope & Objectives**:
  - Web UI role-based access gating: Previously, `CLIENT_APPROVER` and `VIEWER` roles had restricted permissions in the API PermissionMatrix, but the web frontend displayed all management controls (Connect/Disconnect accounts, New Post, publishing controls, branding forms, and billing navigation). Clicking them triggered confusing 403 API errors.
  - Implement a single web permissions truth (`apps/web/src/lib/permissions.ts`) exporting 9 explicit helper functions mirroring API capabilities: `canManageAccounts`, `canPublish`, `canApprove`, `canManageMembers`, `canManageBilling`, `canViewBilling`, `canManageBranding`, `canGenerateReports`, `canReconcile`.
  - Gate UI surfaces across the entire application:
    - **Dashboard Navigation (`DashboardShell`)**: Hide Billing unless `canViewBilling` (`OWNER`, `MANAGER`, `EDITOR`). Hide Team unless `OWNER`, `MANAGER`, or `EDITOR`. Analytics, Accounts, Publishing, and Settings remain accessible.
    - **Accounts (`accounts/page.tsx` & `account-card.tsx`)**: When `!canManageAccounts`, hide Connect section/buttons, hide Disconnect buttons, hide "Grant Publishing Access", display status badges as read-only, and show helper text "Accounts are managed by your agency."
    - **Publishing List (`publishing/page.tsx`)**: Hide "New Post" buttons unless `canPublish`.
    - **Publishing Detail (`publishing/[postId]/page.tsx`)**: Textarea disabled and Save Changes button hidden unless `canPublish`. "Add Destination" hidden unless `canPublish`. On destinations, hide all publication lifecycle action controls (Publish, Publish Now, Retry, Schedule, Reschedule, Unschedule, Cancel, Delete) unless `canPublish`. "Resolve publication" button for `UNKNOWN` status variants is gated specifically on `canReconcile` (`OWNER`, `MANAGER`). Platform canonical link remains visible for published posts. In `ApprovalCard`, "Send for Approval" rendered only when `canPublish`, while "Approve Post" and "Request Changes" rendered only when `canApprove`.
    - **New Draft (`publishing/new/page.tsx`)**: If role is loaded and `!canPublish`, render an inline access-denied state ("Access denied — you don't have permission to create posts in this workspace.") without redirect.
    - **Analytics (`analytics/page.tsx`)**: Client Performance Report card (`data-testid="client-report-card"`) rendered only when `canGenerateReports` (`OWNER`, `MANAGER`, `EDITOR`); hidden from `CLIENT_APPROVER` and `VIEWER` while analytics overview metrics remain visible.
    - **Settings (`settings/page.tsx`)**: Workspace Branding card rendered only when `canManageBranding` (`OWNER`, `MANAGER`). Personal settings (Active Sessions, Change Password) remain accessible to all roles.
    - **Billing (`billing/page.tsx`)**: When loaded and `!canViewBilling`, render access-denied state ("You do not have permission to view billing information for this workspace.") and disable billing API queries.
  - API permission tightening: Tighten `billing.view` in `apps/api/src/modules/auth/guards/permission.guard.ts` from `['OWNER', 'MANAGER', 'EDITOR', 'CLIENT_APPROVER', 'VIEWER']` to `['OWNER', 'MANAGER', 'EDITOR']`. Document rationale in `DECISIONS.md`.
- **Out of Scope**:
  - Changes to Team page (already gated to OWNER/MANAGER).
  - Changes to client approval state machine or publishing worker.
  - Additional roles or modifications to other permissions.

### 2. Architecture & Implementation Details

#### A. Web Permissions Truth (`apps/web/src/lib/permissions.ts`)
- Centralized helper functions mapping roles to actions:
  - `canManageAccounts(role)`: `OWNER`, `MANAGER`
  - `canPublish(role)`: `OWNER`, `MANAGER`, `EDITOR`
  - `canApprove(role)`: `OWNER`, `MANAGER`, `CLIENT_APPROVER`
  - `canManageMembers(role)`: `OWNER`, `MANAGER`
  - `canManageBilling(role)`: `OWNER`
  - `canViewBilling(role)`: `OWNER`, `MANAGER`, `EDITOR`
  - `canManageBranding(role)`: `OWNER`, `MANAGER`
  - `canGenerateReports(role)`: `OWNER`, `MANAGER`, `EDITOR`
  - `canReconcile(role)`: `OWNER`, `MANAGER`
- Full unit test coverage in `apps/web/src/lib/permissions.spec.ts` (9/9 tests pass).

#### B. API Permission Matrix Tightening (`apps/api/src/modules/auth/guards/permission.guard.ts`)
- Tightened `billing.view` permission from all 5 roles down to `['OWNER', 'MANAGER', 'EDITOR']`.
- Rationale recorded in `DECISIONS.md`: external clients (`CLIENT_APPROVER`) and external viewers (`VIEWER`) should not have access to agency subscription pricing (Solo/Studio/Agency/Founding tiers), billing intervals, or enterprise GST invoices.
- Comprehensive unit test coverage in `apps/api/src/modules/auth/guards/permission.guard.spec.ts` (8/8 tests pass).

#### C. Role-Based UI Gating Across Web Routes
- **DashboardShell**: Filters navigation items based on current workspace membership role (`canViewBilling` for Billing, `OWNER`/`MANAGER`/`EDITOR` for Team).
- **Accounts**: Renders read-only UI for `CLIENT_APPROVER` and `VIEWER`, hiding Connect and Disconnect controls while displaying "Accounts are managed by your agency." and preserving connection status badges.
- **Publishing & Post Detail**: Read-only publication preview for approvers with interactive Approve and Request Changes controls; write, edit, schedule, cancel, retry, and delete controls restricted strictly to publishers (`canPublish`). "Resolve publication" button for `UNKNOWN` status variants is gated specifically to `OWNER` and `MANAGER` via `canReconcile`, preventing 403 errors for `EDITOR`.
- **New Post & Billing**: Guarded with inline access-denied messages when accessed directly by unauthorized roles.
- **Analytics**: Client Performance Report card gated to `canGenerateReports` (`OWNER`, `MANAGER`, `EDITOR`), hiding report generation form from `CLIENT_APPROVER` and `VIEWER` while leaving overview metrics visible.
- **Settings**: Gated Workspace Branding card to `OWNER` and `MANAGER`, while leaving personal Active Sessions and Change Password cards open to all members.

### 3. Verification & Test Evidence

- **Web Unit Tests (`apps/web`)**:
  - `apps/web/src/lib/permissions.spec.ts`: **9/9 tests PASS** (delta: +9 tests, new test suite).
  - `apps/web/src/components/dashboard-shell.spec.tsx`: **6/6 tests PASS** (delta: +1 test for role navigation gating).
  - `apps/web/src/app/[workspaceId]/accounts/page.spec.tsx`: **13/13 tests PASS** (delta: +2 tests for read-only gating).
  - `apps/web/src/components/account-card.spec.tsx`: **16/16 tests PASS**.
  - `apps/web/src/app/[workspaceId]/publishing/page.spec.tsx`: **2/2 tests PASS** (delta: +1 test for New Post gating).
  - `apps/web/src/app/[workspaceId]/publishing/new/page.spec.tsx`: **2/2 tests PASS** (new test suite).
  - `apps/web/src/app/[workspaceId]/publishing/[postId]/page.spec.tsx`: **45/45 tests PASS** (delta: +3 tests for publisher vs approver controls and reconcile gating).
  - `apps/web/src/app/[workspaceId]/settings/page.spec.tsx`: **19/19 tests PASS** (delta: +2 tests for branding gating).
  - `apps/web/src/app/[workspaceId]/billing/page.spec.tsx`: **11/11 tests PASS** (delta: +2 tests for billing access denial).
  - `apps/web/src/app/[workspaceId]/analytics/page.spec.tsx`: **16/16 tests PASS** (delta: +2 tests for client report card role gating).
  - Full `@agency-os/web` suite: **28/28 test files PASS, 313/313 tests PASS** (previously 26 files, 289 tests on main; delta: +2 files, +24 tests).
- **API Unit Tests (`apps/api`)**:
  - `apps/api/src/modules/auth/guards/permission.guard.spec.ts`: **8/8 tests PASS** (new test suite).
  - Total API suite: **688/688 tests PASS** in CI.
- **Code Quality & Typecheck**:
  - `apps/web` typecheck (`tsc --noEmit`): **0 errors**.
  - `apps/api` typecheck (`tsc --noEmit`): **0 errors**.
  - `apps/web` ESLint: **0 errors**.
  - `apps/api` ESLint: **0 errors**.

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - CI on reviewed head `7892eec` is 6/6 green (all 2026-11-21): GitGuardian Security Checks 10:07:53Z, Application Builds 10:08:40Z, Code Quality (Lint & Typecheck) 10:09:12Z, API E2E Tests 10:09:32Z, Tests 10:09:40Z, Docker Build & Smoke Test 10:16:45Z. Standing note: CI re-runs on any docs-fix head and must be re-verified 6/6 green there before merge.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - PR #96 is open at reviewed head `7892eec` with CI 6/6 green; next step is the docs-fix re-review, then merge by the owner.
   - Do NOT merge on this prompt alone. Live deployment remains STRICT NO-GO.

## 83. Client Layer — Client Grouping, Scoped Approver Visibility, and Per-Client Report Branding

### 1. Summary & Motivation

- **Status**: PR pending against `main` on branch `feat/client-layer` (base commit `b179a210389170424c64d9be3618c3ec176ac3c6`)
- **Branch**: `feat/client-layer`
- **Scope & Objectives**:
  - Agencies manage multiple clients within a single workspace, with billing retained at the workspace tier. Prior to this build, social accounts formed a flat pool, `CLIENT_APPROVER` members had workspace-wide visibility into all clients' accounts, posts, and analytics, and white-label report branding existed only at the workspace level.
  - Deliver a client layer across database, API, and web frontend adhering strictly to the 7 locked design decisions:
    1. **New `Client` entity**: Workspace-scoped with `name`, `brandDisplayName`, `brandLogoUrl`, and `brandAccentColor`.
    2. **Account Assignment**: `SocialAccount.clientId` is nullable; unassigned accounts remain valid.
    3. **Approver Scoping**: Access scoping applies strictly to `CLIENT_APPROVER` members whose `WorkspaceMember.clientId` is populated ("scoped approver"). All other roles (`OWNER`, `MANAGER`, `EDITOR`, `VIEWER`) and unscoped approvers (`clientId == null`) retain full workspace-wide visibility.
    4. **Post Visibility**: A post is visible to a scoped approver if and only if at least one `PostPlatformVariant` targets an account belonging to their assigned client. Draft posts without assigned account targets remain invisible to scoped approvers.
    5. **Out-of-Scope Isolation**: Single-resource access (account, post, analytics) by a scoped approver outside their assigned client returns HTTP 404 NotFound (never 403, never leaking the resource existence or metadata).
    6. **Deletion Safety**: Deleting a client with scoped approvers assigned is rejected with HTTP 409 Conflict (`"Remove or reassign this client's approver first."`). When approvers are removed, account foreign keys are set to NULL via `onDelete: SetNull`.
    7. **Report Branding Fallback**: Branded reports resolve branding hierarchically: Client branding (`client.brandDisplayName`) -> Workspace branding (`workspace.brandDisplayName`) -> Platform default. White-label rules hold: when client or workspace branding is set, all platform branding is stripped from the PDF and metadata.
    8. **No Client Count Cap in v1**: No plan gating, seat gating, or billing modifications are introduced.

### 2. Architecture & Implementation Details

#### A. Database Schema & Audit Logging (`packages/database`)
- **Prisma Schema (`packages/database/prisma/schema.prisma`)**:
  - Added `Client` model: `id`, `workspaceId`, `name`, `brandDisplayName`, `brandLogoUrl`, `brandAccentColor`, `createdAt`, `updatedAt`, indexed on `[workspaceId]`.
  - Added relation on `Workspace`: `clients Client[]`.
  - Added nullable `clientId` foreign key to `SocialAccount` with `onDelete: SetNull`.
  - Added nullable `clientId` foreign key to `WorkspaceMember` with `onDelete: Restrict` (preventing deletion of client while approvers are assigned).
  - Added nullable `clientId` column to `WorkspaceInvitation`.
- **Migration SQL (`packages/database/prisma/migrations/20261122000000_add_clients/migration.sql`)**:
  - Created `Client` table with constraints and foreign keys.
  - Added `clientId` columns and foreign key references to `SocialAccount` and `WorkspaceMember`, plus column to `WorkspaceInvitation`.
- **Audit Logging (`packages/database/src/repositories/AuditLogRepository.ts`)**:
  - Registered audit action types: `CLIENT_CREATED`, `CLIENT_UPDATED`, `CLIENT_DELETED`, `ACCOUNT_CLIENT_ASSIGNED`.

#### B. API & Backend Implementation (`apps/api`)
- **Express Request Typing (`apps/api/src/types/express.d.ts`)**:
  - Added `workspaceClientId?: string | null;` to Express `Request`.
- **Authentication & Workspace Guards (`apps/api/src/modules/auth/guards/`)**:
  - `WorkspaceGuard`: Populates `request.workspaceClientId = membership.clientId ?? null;`.
  - `PermissionGuard`: Added permissions `'clients.view': ['OWNER', 'MANAGER', 'EDITOR']` and `'clients.manage': ['OWNER', 'MANAGER']`.
- **Clients Module (`apps/api/src/modules/clients/`)**:
  - `ClientsService`: Implements `createClient`, `listClients` (including computed `accountCount` and `scopedMemberCount`), `getClient`, `updateClient`, and `deleteClient` (enforces 409 Conflict if scoped approvers remain assigned). Emits `CLIENT_CREATED`, `CLIENT_UPDATED`, `CLIENT_DELETED` audit logs.
  - `ClientsController`: Exposes `POST`, `GET`, `GET :clientId`, `PATCH :clientId`, and `DELETE :clientId` under `/workspaces/:workspaceId/clients`. Protected by `AuthGuard`, `WorkspaceGuard`, `PermissionGuard`, and `WorkspaceWritableGuard` on mutations.
- **Accounts Module (`apps/api/src/modules/accounts/`)**:
  - `AccountsService`:
    - `listWorkspaceAccounts`: Includes `clientId` and `client` object in queries; scopes by `scopeClientId` if passed from scoped approver.
    - `getWorkspaceAccount`: Returns 404 NotFound if a scoped approver requests an account belonging to another client or unassigned.
    - `assignClient`: Implements `PATCH /workspaces/:workspaceId/accounts/:accountId/client`, validating client exists in workspace, updating assignment, and recording `ACCOUNT_CLIENT_ASSIGNED` audit log.
- **Publishing Module (`apps/api/src/modules/publishing/`)**:
  - `PublishingApplicationService`:
    - `getPosts`: Filters posts for scoped approvers so that only posts targeting their client's accounts are returned.
    - `getPostById`, `approvePost`, `requestChanges`, `validateTarget`: Returns 404 NotFound if post or target does not belong to the scoped approver's client.
    - `requestApproval`: Filters notification recipient queries so only approvers scoped to the post's client (or unscoped approvers) receive notification emails.
- **Analytics Module (`apps/api/src/modules/analytics/`)**:
  - `AnalyticsService`: Scopes `getWorkspaceOverview` metrics and account list to the scoped approver's client; `getAccountAnalytics` returns 404 NotFound for out-of-scope accounts.
- **Workspaces & Member Management (`apps/api/src/modules/workspaces/`)**:
  - `WorkspacesService`:
    - Validates client exists when creating invitations or updating member roles with `clientId`.
    - Enforces that only `CLIENT_APPROVER` can hold a `clientId` (clears `clientId` on role changes away from `CLIENT_APPROVER`).
    - Propagates `clientId` from `WorkspaceInvitation` to `WorkspaceMember` upon acceptance.
    - Surfaces `clientId` and resolved `clientName` in `listMembers` for both members and pending invitations.
- **Reports Module (`apps/api/src/modules/reports/`)**:
  - Added optional `clientId` to `ReportQueryDto`; `ReportsController` validates mutual exclusion (400 BadRequest if both `clientId` and `socialAccountId` are passed).
  - `ReportsService`: Filters accounts by `clientId` and applies branding fallback: client branding -> workspace branding -> platform default. White-label rules ensure platform branding is fully stripped when client or workspace branding is set.

#### C. Web Frontend Implementation (`apps/web`)
- **Permissions Truth (`apps/web/src/lib/permissions.ts`)**:
  - Added `canViewClients(role)`: `OWNER`, `MANAGER`, `EDITOR`.
  - Added `canManageClients(role)`: `OWNER`, `MANAGER`.
  - Full test coverage in `permissions.spec.ts` (11/11 tests pass).
- **Navigation (`apps/web/src/components/dashboard-shell.tsx`)**:
  - Added "Clients" navigation item with `Building2` icon, visible to `OWNER`, `MANAGER`, `EDITOR`, and hidden from `CLIENT_APPROVER` and `VIEWER`.
- **Clients Management Page (`apps/web/src/app/[workspaceId]/clients/`)**:
  - `page.tsx`: Full client listing displaying brand details, accent color swatch, account count badge, and scoped approver count badge.
  - Create / Edit client modal supporting name (required), brand display name, brand logo URL, and brand accent color.
  - Delete client confirmation with inline 409 Conflict error alert displaying `"Remove or reassign this client's approver first."`.
  - Role-based UI gating: `OWNER` and `MANAGER` have full management controls; `EDITOR` has read-only view; `CLIENT_APPROVER` and `VIEWER` see inline Access Denied.
- **Accounts Page & Card (`apps/web/src/app/[workspaceId]/accounts/`)**:
  - `AccountCard`: Renders client badge (`Client: <clientName>` or `Unassigned`). For managers, renders assignment dropdown to assign or unassign client.
  - `AccountsPage`: Renders client-side filter pills row (`All Accounts (N)`, `Unassigned (N)`, and per-client pills `Client (N)`) to filter visible accounts.
- **Team Page (`apps/web/src/app/[workspaceId]/team/`)**:
  - Invite form: When `inviteRole === 'CLIENT_APPROVER'`, renders Client Scope select with helper text: `'No client selected: this approver will see all clients in this workspace.'`.
  - Members table: Displays `Client: <clientName>` or `All clients` for `CLIENT_APPROVER` members. For managers, renders client assignment dropdown to reassign or clear client scope.
  - Invitations table: Displays client assignment for pending client approver invitations.
- **Analytics Page (`apps/web/src/app/[workspaceId]/analytics/`)**:
  - Client Performance Report card: Added optional Client Filter dropdown.
  - Mutual exclusion: Selecting a client disables the single-account filter and passes `clientId` to report generation; selecting an account disables the client filter.

### 3. Verification & Test Evidence

- **Database Package (`@agency-os/database`)**:
  - Prisma client generated successfully (`prisma generate`).
  - Package built successfully (`pnpm --filter @agency-os/database build`).
- **API Unit Tests (`@agency-os/api`)**:
  - `apps/api/src/modules/clients/services/clients.service.spec.ts`: **11/11 tests PASS**.
  - `apps/api/src/modules/clients/controllers/clients.controller.spec.ts`: **8/8 tests PASS**.
  - `apps/api/src/modules/accounts/accounts-client-scoping.spec.ts`: **8/8 tests PASS**.
  - `apps/api/src/modules/publishing/publishing-client-scoping.spec.ts`: **10/10 tests PASS**.
  - `apps/api/src/modules/workspaces/workspaces-client-scoping.spec.ts`: **7/7 tests PASS**.
  - `apps/api/src/modules/reports/reports-client-scoping.spec.ts`: **5/5 tests PASS**.
  - `apps/api/src/modules/analytics/analytics-client-scoping.spec.ts`: **3/3 tests PASS**.
  - Full API test suite: **56/56 test files PASS, 732/732 tests PASS** (delta: +7 test files, +52 tests).
- **Web Unit Tests (`@agency-os/web`)**:
  - `apps/web/src/lib/permissions.spec.ts`: **11/11 tests PASS** (delta: +2 tests for `canViewClients` & `canManageClients`).
  - `apps/web/src/components/dashboard-shell.spec.tsx`: **6/6 tests PASS**.
  - `apps/web/src/app/[workspaceId]/clients/page.spec.tsx`: **6/6 tests PASS** (new test suite).
  - `apps/web/src/app/[workspaceId]/accounts/page.spec.tsx`: **16/16 tests PASS** (delta: +3 tests for client badges, filter pills, and assignment).
  - `apps/web/src/app/[workspaceId]/team/page.spec.tsx`: **5/5 tests PASS** (delta: +2 tests for client scope in invites and member reassignments).
  - `apps/web/src/app/[workspaceId]/analytics/page.spec.tsx`: **18/18 tests PASS** (delta: +2 tests for client report filtering and mutual exclusion).
  - Full Web test suite: **29/29 test files PASS, 328/328 tests PASS** (delta: +1 test file, +15 tests).
- **Total Monorepo Tests**:
  - **1,060 unit & integration tests PASSING across API and Web suites** (732 API + 328 Web).
- **Code Quality & Typecheck**:
  - `apps/api` TypeScript typecheck (`tsc --noEmit`): **0 errors**.
  - `apps/web` TypeScript typecheck (`tsc --noEmit`): **0 errors**.
  - `apps/api` ESLint: **0 errors**.
  - `apps/web` ESLint: **0 errors**.

### 4. Release Gate & Next Steps

1. **CI Quality Gates**:
   - To be verified 6/6 green on the PR head.
2. **Release Gate**:
   - **Live Deployment**: **STRICT NO-GO** (Staging and production deployment release gate remains strictly NO-GO pending external infrastructure provisioning, live email delivery verification, live payment credentials, and disaster recovery rehearsals G18/G19).
3. **Next Steps**:
   - Open Pull Request against `main` for review.
   - Do NOT merge on this prompt alone. Live deployment remains STRICT NO-GO.





