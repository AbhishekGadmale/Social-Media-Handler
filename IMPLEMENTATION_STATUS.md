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
- **Evidence**: `packages/providers/linkedin/linkedin.provider.ts` is implemented, supporting authorize URL generation, token exchange, PKCE, and basic profile fetching.

### Phase 5: Analytics
**Status**: COMPLETE AND VERIFIED
- **Evidence (Backend - COMPLETE AND VERIFIED)**: `apps/api/src/modules/analytics` exposes endpoints reading from `AccountMetricDaily` using Prisma. `apps/worker/src/sync/sync.processor.ts` successfully implements token decryption, calls provider capabilities (`getAccountMetrics`), and upserts data idempotently into PostgreSQL. Extensive unit tests exist in `sync.processor.spec.ts`.
- **Evidence (Frontend - COMPLETE AND VERIFIED)**: Authenticated workspace overview dashboard implemented at `apps/web/src/app/[workspaceId]/analytics/page.tsx`, displaying high-level aggregated summary cards (Total Followers, Total Engagement, Connected Accounts, Active Accounts) and per-account metric breakdowns with provider badges and status indicators (`ACTIVE`, `REAUTH_REQUIRED`, `DISCONNECTED`). Account drill-down view implemented at `apps/web/src/app/[workspaceId]/analytics/[accountId]/page.tsx` with 30-day historical trend charts via `recharts`. Implements honest loading skeleton (`role="status"`), empty onboarding states, 403 access-denied handling, header refresh/retry actions with spinning indicator during `isFetching`, and aligned workspace navigation (`/` redirecting to `/dashboard` and per-workspace card "Enter Workspace" CTA routing to `/[workspaceId]/analytics`). Comprehensive unit tests added in `page.spec.tsx` and `[accountId]/page.spec.tsx` (20 unit tests across 2 new test suites). *Limitation noted*: The overview displays the latest recorded daily snapshots per connected account; date-range query filtering is not supported by the backend overview endpoint.

### Phase 6: Hardening
**Status**: PARTIAL
- **Evidence**:
  - **Security Hardening (Token Encryption)**: COMPLETE AND VERIFIED. AES-256-GCM encryption is fully implemented in `packages/database/src/crypto/encryption.ts` and used across the API and worker. Shared `validateTokenEncryptionKey()` enforces exactly 64 hexadecimal characters (32 bytes) fail-fast during bootstrap before application initialization. Extensive unit and startup test coverage verified.
  - **Rate Limiting**: COMPLETE AND VERIFIED. Global distributed rate limiting is enforced via Redis Throttler registered as global `APP_GUARD` in `apps/api/src/app.module.ts` with tiered policies in `RateLimitPolicies` and custom storage in `apps/api/src/modules/core/redis-throttler.storage.ts`.
  - **Audit Logging**: COMPLETE AND VERIFIED. Audit logging architecture implemented via `AuditService` (`apps/api/src/modules/core/audit.service.ts`) and `AuditLogRepository` (`packages/database/src/repositories/AuditLogRepository.ts`), supporting explicit transactional persistence (`tx.auditLog.create` in publishing mutations) and best-effort persistence (`logActionBestEffort` for auth, OAuth, and media). Enriched failure categorization for failed logins and OAuth callbacks verified across PR #11, PR #12, PR #23, and PR #27.
  - **Staging/Deployment Hardening**: MERGED & VERIFIED IN CI (PR #39). Unified NGINX ingress reverse proxy (`docker/nginx/nginx.conf`, `docker/nginx/Dockerfile`) configured for non-root execution with pinned `nginxinc/nginx-unprivileged:1.31.7-alpine`, routing `/api/*` to `api:3001` and `/` to `web:3000` with WebSocket upgrade mapping and keepalive preservation, query-parameter-stripped access logs preventing plain-text OAuth credential logging (H1), 512MB body limit matching `MEDIA_MAX_UPLOAD_BYTES`, 60s/120s upstream timeouts (L5), forwarded headers (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` via `$forwarded_proto`, `X-Forwarded-Host`), and dedicated `/healthz` probe returning `healthy\n` (L4). Dedicated staging Compose configuration (`docker-compose.staging.yml`, requiring Compose v2.24.4 or later) unbinds internal ports (Postgres, Redis, MinIO, API, Web) from host exposure (`ports: !reset []`), binds only the ingress service on `${STAGING_PORT:-80}`, and enforces genuinely required staging secrets (`POSTGRES_PASSWORD`, `TOKEN_ENCRYPTION_KEY`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, `FRONTEND_URL`, `API_PUBLIC_URL`, `NEXT_PUBLIC_API_URL`) without unused variables (`SESSION_SECRET`, `JWT_SECRET`, `COOKIE_SECRET`). Production authentication enforces HTTPS and fails fast on plain HTTP before credential verification to prevent credential oracles and side effects (N1, H2, with `ALLOW_INSECURE_HTTP_AUTH` override for testing). 23 automated regression tests in `apps/api/src/config/staging-deployment.spec.ts` and 12 unit tests in `apps/api/src/modules/auth/auth.controller.spec.ts` verified; CI staging smoke tests cover the core ingress and application stack while host isolation is verified for all internal ports. *Verification boundaries*: Implementation merged into `main` and automated tests passed (YES: 23 regression tests, 12 auth tests, 253 API unit tests across 21 test files), Docker ingress and host isolation smoke test passed in CI (YES), 6 required pre-merge checks passed on reviewed HEAD `160bcd7` (YES), 5 post-merge check runs passed on merge commit `dbc8938` (YES); Live operator verification pending: TLS verified on staging domain (PENDING OPERATOR DNS/CERT PROVISIONING), Live VPS deployment verified (PENDING OPERATOR DEPLOYMENT RUN).
  - **Secret Management**: PARTIAL. Environment variable templates documented in `.env.example` (including `TOKEN_ENCRYPTION_KEY`, LinkedIn OAuth credentials [`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`], and `FRONTEND_URL`). `docker-compose.yml` requires an explicitly supplied `TOKEN_ENCRYPTION_KEY` for API and Worker services with zero default secret fallbacks. Test-only key explicitly supplied in CI smoke testing. Production external secret store integration (e.g., Vault / AWS Secrets Manager) remains deferred.
  - **Observability**: COMPLETE AND VERIFIED. Structured Pino logging configured across API and Worker (`logger.config.ts`), with correlation ID validation and propagation across HTTP requests and BullMQ queue jobs (`SyncJobData`, `PublishJobData`, `PublishDeleteJobData`), sensitive credential and header redaction (snake_case and camelCase tokens, secrets, cookies), request URL query parameter sanitization (`url-sanitizer.utils.ts`), required `PinoLogger` dependency injection, and comprehensive unit and integration test suites.
  - **Tenancy Verification**: COMPLETE AND VERIFIED. Cross-workspace checks and `WorkspaceGuard` are enforced (e.g., in `analytics.controller.ts`).
  - **OAuth Hardening (CSRF/PKCE)**: COMPLETE AND VERIFIED. `auth.guard.ts` enforces CSRF headers for mutations. `linkedin.provider.ts` supports PKCE via `codeChallenge` and `codeVerifier`.
  - **Queue Reliability**: COMPLETE AND VERIFIED. `sync.processor.ts` implements intelligent backoff using `moveToDelayed` for `ProviderRateLimitError`, gracefully handles `401 Unauthorized` by marking accounts for re-authentication, and handles failed jobs properly.
  - **CI/Testing Hardening**: PARTIAL. High-quality isolated tests exist for the worker (`sync.processor.spec.ts`), but full E2E testing across API and frontend is missing.

---

## Executive Summary

1. **Last definitely completed phase**: Phase 5 (Analytics).
2. **Current active phase**: Phase 6 (Hardening).
3. **Exact Phase 6 items already finished**: Tenancy verification (WorkspaceGuard), OAuth Hardening (PKCE + CSRF), Token Encryption (AES-256-GCM logic + fail-fast 64-hex startup validation in API/Worker), Environment Secret Documentation (.env.example templates), Docker Compose Required Secret Enforcement, Queue Reliability (BullMQ backoffs), Ingress Rate Limiting (`APP_GUARD` + Redis Throttler), Audit Logging (`AuditService` and transactional audit persistence), Container Hardening (Node `dist` execution, workspace-aware production Docker runner slimming), Observability (Structured Pino logging, request/job correlation propagation, sensitive credential redaction, and URL sanitization), Staging/Deployment Hardening (unified NGINX ingress, staging compose isolation, required secret enforcement, automated configuration tests, CI smoke test extension).
4. **Exact Phase 6 items partially implemented**: Secret management (environment configuration, fail-fast startup validation, and staging compose secret enforcement complete; production external secrets vault integration remains deferred).
5. **Exact Phase 6 items not started**: None (staging/deployment hardening configuration and tests implemented; live VPS deployment and external secret vault deferred/pending operator actions).
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
import '@testing-library/jest-dom';
```
to:
```typescript
import '@testing-library/jest-dom/vitest';
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
       res.cookie('session', session.sessionId, {
         httpOnly: true,
         secure: process.env.NODE_ENV === 'production',
         sameSite: 'lax',
         expires: session.expiresAt,
       });
       res.cookie('csrfToken', session.csrfToken, {
         httpOnly: false,
         secure: process.env.NODE_ENV === 'production',
         sameSite: 'lax',
         expires: session.expiresAt,
       });
       ```
       Because no explicit `path` option is provided, Express defaults `path: '/'`. Because no explicit `domain` option is provided, Express emits a host-only cookie for the request host.
     - At logout ([`auth.controller.ts#L115-L116`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/auth/auth.controller.ts#L115-L116)):
       ```typescript
       res.clearCookie('session');
       res.clearCookie('csrfToken');
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
    1. *Option A (Shared Parent Domain Cookie)*: Configure `COOKIE_DOMAIN=.example.com` so the browser permits subdomains to share the cookie.
    2. *Option B (Dedicated Token Handshake Endpoint)*: Expose an unauthenticated or session-authenticated `GET /api/v1/auth/csrf-token` endpoint returning `{ csrfToken }` in the JSON response body, enabling the client to store the CSRF token in memory.
    3. *Option C (Login Response Body Payload)*: Return `csrfToken` in the `/login` JSON response body alongside user metadata.
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

| Priority Tier | Backlog Item | Target Components / Files | Status | Severity / Classification | Next Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 1: Tenant Isolation** | Cross-tenant sync IDOR vulnerability | `apps/worker/src/sync/sync.processor.ts` | **MERGED** (PR #1, `cb37719`) | High / Resolved | Complete |
| **Tier 2: Auth Bypass** | Open redirect on login (`returnUrl`) | `apps/api/src/modules/auth/auth.controller.ts` | **MERGED** (PR #2, `862372c`) | High / Resolved | Complete |
| **Tier 2: Auth Bypass** | Trust Proxy unconfigured spoofing & rate-limit defeat | `apps/api/src/config/trust-proxy.ts`, `apps/api/src/main.ts` | **MERGED** (PR #3, `f382a93`) | High / Resolved | Complete |
| **Tier 2: Auth Bypass** | Logout cookie clear omitting `Secure`/`SameSite` | `apps/api/src/modules/auth/auth.controller.ts` | **DISMISSED** | **FALSE POSITIVE** (RFC 6265 Section 5.3 + Redis revocation) | None (Closed) |
| **Tier 3: Publishing / Data Loss** | **Ambiguous Publication Reconciliation Transactionality, Metadata Synchronization, and Attributed RBAC** | [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts#L496-L623), [`apps/api/src/modules/publishing/controllers/publications.controller.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/controllers/publications.controller.ts#L194-L207), [`docs/AMBIGUOUS_PUBLICATION_RECONCILIATION_ARCHITECTURE.md`](file:///C:/Users/bappa/agency-os/docs/AMBIGUOUS_PUBLICATION_RECONCILIATION_ARCHITECTURE.md) | **MERGED** (PR #7, `d7f2d71`) | High / Resolved & Hardened | Complete |
| **Tier 4: Provider Token** | Centralized worker token refresh & lifecycle management | `packages/providers/`, `apps/worker/src/publishing/token.service.ts` | **MERGED** (PR #5, `0d862ca`) | High / Resolved | Complete |
| **Tier 5: API / OAuth Contract** | Deterministic `API_PUBLIC_URL` for OAuth callbacks | `apps/api/src/config/public-url.ts`, `apps/api/src/modules/oauth/oauth.controller.ts` | **MERGED** (PR #4, `28b9a2c`) | Medium / Resolved | Complete |
| **Tier 5: Product Core Feature** | **Phase 5: Unified Workspace Analytics Dashboard & Account Detail View** | `apps/web/src/app/[workspaceId]/analytics/` | **MERGED / CLOSED** (PR #33, `90e6447`) | Medium / Core Product Capability | Authenticated workspace overview metrics, per-account breakdown, 30-day historical trend charts via recharts, loading/empty/403 states, 20 unit tests |
| **Tier 6: Deployment Hardening** | **Phase 6: Environment Secret Management & Fail-Fast Token Encryption Startup Validation** | `packages/database/src/crypto/encryption.ts`, `apps/api/src/main.ts`, `apps/worker/src/main.ts`, `docker-compose.yml`, `.env.example` | **MERGED / CLOSED** (PR #35, `cb63286`) | Medium / Security Hardening | 64-hex key validation, fail-fast startup checks, required compose secret interpolation, CI smoke test key provisioning, 23 unit tests |
| **Tier 6: Deployment Hardening** | **Security Event Audit Logging Coverage & Explicit Persistence Semantics** | [`apps/api/src/modules/core/audit.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/core/audit.service.ts), [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts), [`packages/database/src/repositories/AuditLogRepository.ts`](file:///C:/Users/bappa/agency-os/packages/database/src/repositories/AuditLogRepository.ts) | **MERGED** (PR #11, `546316a`) | Medium / Resolved & Audited | Complete |
| **Tier 6: Deployment Hardening** | Cross-Subdomain CSRF Deployment Architecture | `apps/api/src/modules/auth/auth.controller.ts`, `docs/phase-6-readiness.md` | **DOCUMENTED ARCHITECTURE CONSTRAINT** | Informational / Ingress Topology Requirement | Front web & API under unified reverse proxy or configure parent domain |
| **Tier 6: Deployment Hardening** | Global Distributed Rate Limiting via Redis Throttler | `apps/api/src/app.module.ts`, `apps/api/src/modules/core/redis-throttler.storage.ts` | **VERIFIED COMPLETE** | Medium / Ingress Abuse Prevention | Complete (`APP_GUARD` + Redis store verified) |
| **Tier 6: Deployment Hardening** | **Phase 6.5: Unified Ingress Reverse Proxy & Staging Compose Configuration** | [`docker/nginx/nginx.conf`](file:///C:/Users/bappa/agency-os/docker/nginx/nginx.conf), [`docker-compose.staging.yml`](file:///C:/Users/bappa/agency-os/docker-compose.staging.yml), [`apps/api/src/config/staging-deployment.spec.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/config/staging-deployment.spec.ts) | **MERGED** (PR #39, `dbc8938`) | Medium / Deployment Hardening | Non-root NGINX ingress, host port isolation, required staging secret enforcement, 23 automated regression tests, CI smoke test |
| **Tier 7: Concurrency & Data Integrity** | **Token Refresh `REAUTH_REQUIRED` CAS TOCTOU Fencing** | [`apps/worker/src/publishing/token.service.ts`](file:///C:/Users/bappa/agency-os/apps/worker/src/publishing/token.service.ts#L359-L540), [`apps/worker/src/publishing/token.service.spec.ts`](file:///C:/Users/bappa/agency-os/apps/worker/src/publishing/token.service.spec.ts#L688-L1075) | **MERGED** (PR #9, `4752a15`) | High / Resolved & Fenced | Complete |
| **Tier 7: Concurrency & Data Integrity** | **Transactional Audit Writes for Draft Operations** | [`packages/database/src/repositories/AuditLogRepository.ts`](file:///C:/Users/bappa/agency-os/packages/database/src/repositories/AuditLogRepository.ts), [`apps/api/src/modules/core/audit.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/core/audit.service.ts), [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts) | **MERGED** (PR #12, `8e94c62`) | Medium / Resolved & Audited | Complete |
| **Tier 7: Concurrency & Data Integrity** | **`updateDraft` In-Transaction Locked-Variant Concurrency Serialization** | [`packages/database/src/repositories/PublishingRepository.ts`](file:///C:/Users/bappa/agency-os/packages/database/src/repositories/PublishingRepository.ts), [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts), [`apps/api/test/publishing.e2e-spec.ts`](file:///C:/Users/bappa/agency-os/apps/api/test/publishing.e2e-spec.ts) | **MERGED** (PR #14, `279b4c5`) | Low / Resolved & Fenced | Complete |
| **Tier 7: Concurrency & Data Integrity** | **`deletePost` Locked-Variant Check TOCTOU Fencing** | [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts), [`apps/api/test/publishing.e2e-spec.ts`](file:///C:/Users/bappa/agency-os/apps/api/test/publishing.e2e-spec.ts) | **MERGED** (PR #15, `a702601`) | Low / Resolved & Fenced | Complete |
| **Tier 7: Cleanup / Optimization** | Container Runtime Transpilation (`tsx` vs compiled `dist`) | `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `packages/*/package.json`, `docs/phase-6-readiness.md` | **MERGED / CLOSED** (PR #17, `c7ec09b`) | Low / Performance & Startup Optimization | Complete (Compiled workspace packages & node dist execution verified) |
| **Tier 7: Non-Blocking Follow-Ups** | Production Docker Runner Image Slimming & Attack Surface Pruning | `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile` | **MERGED / CLOSED** (PR #31, `673e401`) | Low / Image Optimization & Security | Pruned workspace devDependencies across runners via scoped prod reinstall, preserved Prisma runtime, and hardened CI smoke test |
| **Tier 7: Non-Blocking Follow-Ups** | TokenService CAS Failure Recheck `DISCONNECTED` Guard | `apps/worker/src/publishing/token.service.ts` | **MERGED / CLOSED** (PR #19, `cfc7924`) | Low / Concurrency Safety Hardening | Fenced `recheckAccount.status === DISCONNECTED` to prevent returning recovered credentials or overwriting status |
| **Tier 7: Non-Blocking Follow-Ups** | TokenService Integration Test via `SocialAccountRepository.upsertWithConnection` | `apps/worker/src/publishing/token.service.spec.ts` | **MERGED / CLOSED** (PR #19, `cfc7924`) | Low / Integration Test Hardening | Direct domain repository integration tests for concurrent OAuth reconnects against stale failure handlers |
| **Tier 7: Non-Blocking Follow-Ups** | TokenService CAS-Recheck Reconnect Recovery Coverage & Test 11 Spy Cleanup | `apps/worker/src/publishing/token.service.spec.ts` | **MERGED / CLOSED** (PR #21, `365653f`) | Low / Test Suite Resilience | Test 11 `try/finally` spy cleanup and Test 14 Step 5 CAS conflict recheck credential recovery |
| **Tier 7: Non-Blocking Follow-Ups** | ESLint `no-floating-promises` Rule Escalation | `apps/api/eslint.config.mjs`, `apps/worker/eslint.config.mjs` | **MERGED / CLOSED** (PR #29, `57e8c21`) | Low / Static Analysis Hardening | Evaluate escalating ESLint `no-floating-promises` from warning to error; check existing violations & migration scope |
| **Tier 7: Non-Blocking Follow-Ups** | Failed Login Audit Accuracy Enrichment | `apps/api/src/modules/auth/auth.controller.ts` | **MERGED / CLOSED** (PR #27, `f41afaf`) | Low / Security Audit Detail | Record actual auth failure reason for `AUTH_LOGIN_FAILED` without logging credentials, tokens, or secrets |
| **Tier 7: Non-Blocking Follow-Ups** | OAuth Callback Missing Parameter Failure Audit | `apps/api/src/modules/oauth/oauth.controller.ts` | **MERGED / CLOSED** (PR #23, `9512337`) | Low / Security Audit Detail | Best-effort `OAUTH_CONNECTION_FAILED` audit logging on missing `code` or `state` with safe metadata |
| **Tier 7: Non-Blocking Follow-Ups** | Deterministic Discovery Submit Async Control | `apps/web/src/app/[workspaceId]/accounts/discovery/discovery-client.spec.tsx` | **MERGED / CLOSED** (PR #25, `c6e312b`) | Low / Test Suite Resilience | Replaced fragile 10ms timer with controlled deferred promise in discovery double-submit test |
| **Tier 7: Future Feature Dependency** | Worker `PublishingProcessor` Catch-Path Disconnect Fencing | `apps/worker/src/publishing/publishing.processor.ts` | **FUTURE DEPENDENCY** | Low / Dependent on Future Disconnect API | Guard processor catch paths against resurrecting `DISCONNECTED` accounts |
| **Tier 7: CI / Test Optimization** | CI PostgreSQL Service Publishing E2E Execution | `apps/api/test/publishing.e2e-spec.ts`, `.github/workflows/ci.yml` | **MERGED** (PR #13, `6bab30d`) | Low / Pipeline Test Breadth | Complete (Dedicated CI Job Verified) |
| **Tier 7: CI / Test Optimization** | Broader API E2E CI Coverage (Accounts, Analytics, Auth, Media Storage) | `apps/api/test/*.e2e-spec.ts`, `.github/workflows/ci.yml` | **MERGED / CLOSED** (PR #16, `42723ab`) | Low / Pipeline Test Breadth | Complete (5/5 API E2E suites verified in CI) |

---

### 4. Current Implementation Focus: Completed Hardening & Next Priorities

- **Recently Completed**:
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
  - *Context*: In `TokenService.handlePermanentAuthFailure()`, if `tx.socialAccount.updateMany` returns `count: 0` (indicating a CAS conflict), the helper re-reads `recheckAccount`. If `recheckAccount.connection` has valid credentials, it previously returned `recovered` without checking account status.
  - *Hardening*: Implemented in PR #19 (`apps/worker/src/publishing/token.service.ts` L489-L493). If `recheckAccount.status === SocialAccountStatus.DISCONNECTED`, immediately returns `{ outcome: 'disconnected' }` and throws `AuthRequiredError` without leaking credentials or mutating status.
  - *Status*: **RESOLVED & MERGED** (PR #19, merge commit [`cfc7924`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cfc7924fb7d3704988ec7f81b3f13160a8799737), reviewed HEAD [`9a44a2a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9a44a2aa792861e586ab371b45df12ba2b3ceeea)).
- **Follow-Up B — Integration Test Through Real `upsertWithConnection`**:
  - *Context*: Existing unit tests in `token.service.spec.ts` simulated concurrent reconnect by writing directly to Prisma.
  - *Hardening*: Implemented in PR #19 (`apps/worker/src/publishing/token.service.spec.ts` tests 12 and 13). Direct integration tests exercising OAuth reconnect via `SocialAccountRepository.upsertWithConnection()` against stale worker permanent failure calls, verifying that new credentials win and the account remains `ACTIVE`.
  - *Status*: **RESOLVED & MERGED** (PR #19, merge commit [`cfc7924`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/cfc7924fb7d3704988ec7f81b3f13160a8799737), reviewed HEAD [`9a44a2a`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/9a44a2aa792861e586ab371b45df12ba2b3ceeea)).
- **Follow-Up C — Future Disconnect Endpoint Worker Handling**:
  - *Context*: No disconnect API endpoint currently exists in the application.
  - *Future Dependency*: When account disconnect functionality is implemented, review the `PublishingProcessor` `AuthRequiredError` catch handlers. Those handlers currently perform unconditional status updates to `REAUTH_REQUIRED`. If a user disconnects an account while a publication job is in flight, the processor could resurrect `DISCONNECTED` to `REAUTH_REQUIRED`.
  - *Requirement*: Before shipping a disconnect endpoint, fence worker-level `REAUTH_REQUIRED` transitions in `publishing.processor.ts` against `status: { not: DISCONNECTED }`.
  - *Status*: FUTURE FEATURE DEPENDENCY.

### 5. Test Coverage & Verification
- **10 Focused Concurrency & Concurrency-Fence Tests Added in `apps/worker/src/publishing/token.service.spec.ts`**:
  1. *Genuine permanent refresh failure*: Unchanged credential snapshot transitions account to `REAUTH_REQUIRED` and throws `AuthRequiredError`.
  2. *Concurrent successful refresh*: Newer DB credentials allow stale worker to recover fresh access token without marking `REAUTH_REQUIRED`.
  3. *Concurrent manual OAuth reconnect*: Stale failure does not set `REAUTH_REQUIRED`; fresh credentials returned.
  4. *Refresh-token rotation*: Newer rotated refresh token in DB prevents stale worker from mutating account status.
  5. *Disconnect race*: Stale failure leaves `DISCONNECTED` status unchanged.
  6. *Genuine `invalid_grant` regression*: Unchanged snapshot transitions to `REAUTH_REQUIRED`.
  7. *Non-refreshable expired token*: Transitions to `REAUTH_REQUIRED` when snapshot is unchanged.
  8. *Non-refreshable expired token + concurrent reconnect*: Stale worker recovers fresh credentials without overwriting `ACTIVE`.
  9. *Account CAS conflict*: `updateMany` count 0 skips stale mutation and preserves latest account state.
  10. *No stale `ACTIVE` restoration*: Stale worker encountering changed credentials never blindly forces account status to `ACTIVE`.
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
    - *Best-Effort*: `AuthController` (login success/failure, logout), `OAuthController` (connect, callback, select), `AccountsController` (triggerSync), and `MediaService` (initiateUpload, completeUpload) use `logActionBestEffort`. An audit DB outage never causes authentication/OAuth denial-of-service or rolls back S3 upload completion.
    - *Awaited / Reliable*: Post and publication mutations in `PublishingApplicationService` await `logAction(...)`.
    - *Transactionally Coupled*: Manual reconciliation in `PublishingApplicationService.reconcile()` retains its existing transactional `tx.auditLog.create` inside the PostgreSQL interactive transaction, providing rollback atomicity.
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
  - In `updateDraft`, the locked variant check (`post.variants.find(...)`) executes *prior* to `this.prisma.$transaction`.
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
   - *Context*: In `updateDraft`, the locked variant check (`post.variants.find(...)`) executed outside and prior to `this.prisma.$transaction`.
   - *Hazard*: A concurrent variant transition to `QUEUED`, `PUBLISHING`, or `PUBLISHED` (via `requestPublish` or background worker) could race between the initial read and `tx.post.update`.
   - *Resolution*: Implemented repository-level row locks (`lockPostForUpdate` and `lockVariantsForUpdate` with `ORDER BY id ASC` to eliminate deadlocks) executed inside `this.prisma.$transaction`. Re-evaluates variant statuses under exclusive row locks; rejects with HTTP 403 `ForbiddenException: Cannot edit post while a publication is in ${status} state` if any publication variant is in a locked state (`QUEUED`, `PUBLISHING`, `PUBLISHED`, `UNKNOWN`, `SCHEDULED`). Non-DB media validation remains outside transaction to keep lock hold duration minimal (<5ms). Verified with 8 deterministic Jest E2E tests (static rejection, transition-first serialization with 403 rejection, edit-first serialization with atomic audit attribution, and workspace/post tenant isolation).
   - *Status*: **MERGED / CLOSED** (PR #14, merge commit [`279b4c5b3f7656fcb149746cfb2efda95e73e4f8`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/279b4c5b3f7656fcb149746cfb2efda95e73e4f8) / `279b4c5`, merged 2026-10-23).
2. **Run Jest E2E tests in GitHub Actions CI**:
   - *Context*: Dedicated GitHub Actions CI job `e2e` (`Publishing E2E Tests`) added to `.github/workflows/ci.yml` in PR #13 (reviewed HEAD [`e7b14da65e67c00ab9b18d0f272a967c211e2ced`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/e7b14da65e67c00ab9b18d0f272a967c211e2ced) / `e7b14da`, merge commit [`6bab30dc00a045b7238be8011e8e9ab63fef5540`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/6bab30dc00a045b7238be8011e8e9ab63fef5540) / `6bab30d`, merged 2026-10-21).
   - *Architecture*: Runs `pnpm --filter @agency-os/api test:e2e test/publishing.e2e-spec.ts` against isolated `postgres:15-alpine` (`agency_os_test`) and `redis:7-alpine` service containers with health checks, explicit test credentials, Prisma client generation, and schema migration deployment (`prisma migrate deploy`).
   - *Scope Limitation*: Only `apps/api/test/publishing.e2e-spec.ts` currently runs in this dedicated CI job. Broader E2E test suites (`accounts.e2e-spec.ts`, `analytics.e2e-spec.ts`, `auth.e2e-spec.ts`, and `media.storage.e2e-spec.ts`) are not executed in this job and remain tracked separately.
   - *Verification Evidence*:
     - Local PostgreSQL Jest E2E execution: 33/33 passed across 1 suite (7.397 s).
     - GitHub Actions CI execution: Job `Publishing E2E Tests` succeeded in 54s ([run 39629862242, job 119324880432](https://github.com/AbhishekGadmale/Social-Media-Handler/actions/runs/39629862242/job/119324880432)); all 6/6 checks passed on PR #13 HEAD.
   - *Status*: **MERGED / CLOSED** (PR #13, merge commit `6bab30d`). Closes PR #12 follow-up #2 for publishing E2E tests.

3. **Broader API E2E CI Coverage (Accounts, Analytics, Auth, Media Storage)**:
   - *Context*: Other E2E test suites in `apps/api/test/` (`accounts.e2e-spec.ts`, `analytics.e2e-spec.ts`, `auth.e2e-spec.ts`, and `media.storage.e2e-spec.ts`) require additional service dependencies (such as MinIO for S3 object storage in `media.storage.e2e-spec.ts`) and mock credentials.
   - *Next Step*: Define dedicated CI service jobs or extend CI service dependencies to safely execute remaining API E2E suites without flakiness or cross-suite pollution.
   - *Status*: OPEN (Low / Pipeline Test Coverage).

4. **Revalidate locked-variant state inside the `deletePost` transaction (TOCTOU Fencing)**:
   - *Context*: In `deletePost` ([`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts)), unsafe variant status checks (`post.variants.find(...)`) currently execute outside a transaction and prior to `repo.posts.delete`.
   - *Hazard*: A concurrent state transition could change a variant to `QUEUED`, `PUBLISHING`, or `PUBLISHED` (via `requestPublish` or background worker) after the initial check but before `repo.posts.delete` commits.
   - *Resolution*: Implemented row-level locks (`lockPostForUpdate` and `lockVariantsForUpdate` ordered by primary key `id ASC`) inside `this.prisma.$transaction`. Re-evaluates variant statuses under exclusive locks and throws HTTP 403 `ForbiddenException` if any publication variant is in a locked state (`QUEUED`, `PUBLISHING`, `PUBLISHED`, `UNKNOWN`, `SCHEDULED`). Inside transaction, executes `tx.post.delete` (cascading variants and media) and atomic `audit.logAction(..., tx)`. Verified with unit tests (60/60) and 10 dedicated Jest E2E tests in `publishing.e2e-spec.ts` (51/51).
   - *Status*: **MERGED / CLOSED** (PR #15, merge commit [`a7026019fa9c9aff6caedaf7a83e19d1963e23ca`](https://github.com/AbhishekGadmale/Social-Media-Handler/commit/a7026019fa9c9aff6caedaf7a83e19d1963e23ca) / `a702601`, merged 2026-10-23).

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
    {"status":"ok","info":{"database":{"status":"up"},"redis":{"status":"up"}}}
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
         outcome: 'disconnected' as const,
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
  - `Test 11`: *CAS conflict recheck DISCONNECTED guard*: Intercepts CAS update to simulate concurrent disconnect (`count: 0`). Asserts `handlePermanentAuthFailure` rejects with `AuthRequiredError` indicating account is disconnected, never returns recovered credentials, and leaves PostgreSQL status as `DISCONNECTED`.
  - `Test 12`: *Repository integration*: Connects account via `SocialAccountRepository.upsertWithConnection()`, reads stale failure snapshot, performs concurrent re-auth via `upsertWithConnection()`, and verifies stale worker failure handling recovers reconnected credentials while account remains `ACTIVE`.
  - `Test 13`: *Repository integration with REAUTH_REQUIRED account*: Reconnects a previously degraded account via `upsertWithConnection()`, asserting that stale worker failure cannot revert the restored `ACTIVE` status.
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
    - *Implementation merged into `main`*: **YES** (Standard merge commit `dbc89382310cd02a5671bbd210264be871cb0d82`).
    - *Required PR CI checks passed on reviewed HEAD (`160bcd7`)*: **YES** (All 6 check runs successful: GitGuardian Security Checks, Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test).
    - *Post-merge CI checks passed on merge commit (`dbc8938`)*: **YES** (All 5 push check runs successful on `main`: Application Builds, Code Quality, API E2E Tests, Tests, Docker Build & Smoke Test).
    - *Automated unit & regression tests passed*: **YES** (23/23 tests in `staging-deployment.spec.ts`, 12/12 tests in `auth.controller.spec.ts`, 253 API unit tests across 21 test files, 17 database crypto tests).
    - *CI staging Compose smoke test passed*: **YES** (Exercises core ingress and application stack: PostgreSQL, Redis, database migrations, API, Worker, Web, and Ingress behind NGINX port 8080 with zero host exposure for internal services; MinIO excluded due to Docker Hub registry pull restrictions).
  - **Still Pending Live Operator Verification (External Infrastructure)**:
    - *Staging DNS*: **PENDING OPERATOR DNS PROVISIONING** (Provisioning DNS A/CNAME record on registrar pointing to staging host).
    - *TLS certificate provisioning or edge TLS configuration*: **PENDING OPERATOR TLS CONFIGURATION** (Edge TLS via Cloudflare/ALB with `TRUST_PROXY=1` or host-level ACME/Certbot provisioning).
    - *Origin firewall rules*: **PENDING OPERATOR FIREWALL CONFIGURATION** (Restricting host ingress port 80/8080 strictly to trusted edge proxy CIDRs).
    - *Live VPS deployment*: **PENDING OPERATOR DEPLOYMENT RUN** (Executing `docker compose -f docker-compose.staging.yml up -d` on live target host with production environment secrets).
    - *Live endpoint, authentication, and infrastructure health verification*: **PENDING LIVE DEPLOYMENT** (Probing live domain `/healthz`, `/api/health/ready`, and production login flow on real infrastructure).

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
