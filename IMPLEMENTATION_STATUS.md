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
**Status**: PARTIAL
- **Evidence (Backend - COMPLETE)**: `apps/api/src/modules/analytics` exposes endpoints reading from `AccountMetricDaily` using Prisma. `apps/worker/src/sync/sync.processor.ts` successfully implements token decryption, calls provider capabilities (`getAccountMetrics`), and upserts data idempotently into PostgreSQL. Extensive unit tests exist in `sync.processor.spec.ts`.
- **Evidence (Frontend - NOT STARTED)**: `apps/web/src/app/page.tsx` is an empty, default Next.js scaffold. The required unified workspace/account analytics dashboard does not exist.

### Phase 6: Hardening
**Status**: PARTIAL
- **Evidence**:
  - **Security Hardening (Token Encryption)**: PARTIAL. AES-256-GCM encryption is fully implemented in `packages/database/src/crypto/encryption.ts` and used in the worker. However, `.env.example` is missing the `TOKEN_ENCRYPTION_KEY`.
  - **Rate Limiting**: PARTIAL. `@nestjs/throttler` is registered in `app.module.ts`, and `ThrottlerGuard` is applied specifically to the `/login` route in `auth.controller.ts`. Global API rate limiting is not yet active.
  - **Audit Logging**: NOT STARTED. No audit modules, services, or middleware exist in `apps/api`.
  - **Staging/Deployment Hardening**: NOT STARTED. No staging configurations or deployment workflows exist.
  - **Secret Management**: PARTIAL. Core encryption exists, but advanced secrets management is pending.
  - **Observability**: NOT STARTED. The specification requires Structured Pino logs, but standard NestJS `Logger` is still being used across the API and worker.
  - **Tenancy Verification**: COMPLETE AND VERIFIED. Cross-workspace checks and `WorkspaceGuard` are enforced (e.g., in `analytics.controller.ts`).
  - **OAuth Hardening (CSRF/PKCE)**: COMPLETE AND VERIFIED. `auth.guard.ts` enforces CSRF headers for mutations. `linkedin.provider.ts` supports PKCE via `codeChallenge` and `codeVerifier`.
  - **Queue Reliability**: COMPLETE AND VERIFIED. `sync.processor.ts` implements intelligent backoff using `moveToDelayed` for `ProviderRateLimitError`, gracefully handles `401 Unauthorized` by marking accounts for re-authentication, and handles failed jobs properly.
  - **CI/Testing Hardening**: PARTIAL. High-quality isolated tests exist for the worker (`sync.processor.spec.ts`), but full E2E testing across API and frontend is missing.

---

## Executive Summary

1. **Last definitely completed phase**: Phase 4 (First OAuth provider).
2. **Current active phase**: Phase 5 (Analytics) & Phase 6 (Hardening) being worked concurrently.
3. **Exact Phase 6 items already finished**: Tenancy verification (WorkspaceGuard), OAuth Hardening (PKCE + CSRF), Token Encryption (AES-256-GCM logic), Queue Reliability (BullMQ backoffs).
4. **Exact Phase 6 items partially implemented**: Rate limiting (Throttler started but not global), Secret management (keys missing from env).
5. **Exact Phase 6 items not started**: Audit logging, Observability (Pino), Staging/deployment hardening.
6. **Most likely last task Claude Code was working on**: Implementing the background analytics synchronization worker (`apps/worker/src/sync/sync.processor.ts`) and writing its tests, while concurrently adding initial Phase 6 queue reliability and token encryption logic necessary for the worker to function securely.
7. **Exact next task that should be continued**: Build the Next.js frontend dashboard (`apps/web`) to complete Phase 5, followed by finishing the remaining Phase 6 backend hardening (Audit logs, Pino observability, Global rate limiting).

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
| **Tier 6: Deployment Hardening** | **Security Event Audit Logging Coverage & Explicit Persistence Semantics** | [`apps/api/src/modules/core/audit.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/core/audit.service.ts), [`apps/api/src/modules/publishing/services/publishing-application.service.ts`](file:///C:/Users/bappa/agency-os/apps/api/src/modules/publishing/services/publishing-application.service.ts), [`packages/database/src/repositories/AuditLogRepository.ts`](file:///C:/Users/bappa/agency-os/packages/database/src/repositories/AuditLogRepository.ts) | **PR OPEN** (Branch `fix/audit-logging-coverage`) | Medium / Resolved & Audited | Awaiting CI & Muse Review |
| **Tier 6: Deployment Hardening** | Cross-Subdomain CSRF Deployment Architecture | `apps/api/src/modules/auth/auth.controller.ts`, `docs/phase-6-readiness.md` | **DOCUMENTED ARCHITECTURE CONSTRAINT** | Informational / Ingress Topology Requirement | Front web & API under unified reverse proxy or configure parent domain |
| **Tier 6: Deployment Hardening** | Global Distributed Rate Limiting via Redis Throttler | `apps/api/src/app.module.ts`, `apps/api/src/modules/core/redis-throttler.storage.ts` | **VERIFIED COMPLETE** | Medium / Ingress Abuse Prevention | Complete (`APP_GUARD` + Redis store verified) |
| **Tier 7: Concurrency & Data Integrity** | **Token Refresh `REAUTH_REQUIRED` CAS TOCTOU Fencing** | [`apps/worker/src/publishing/token.service.ts`](file:///C:/Users/bappa/agency-os/apps/worker/src/publishing/token.service.ts#L359-L540), [`apps/worker/src/publishing/token.service.spec.ts`](file:///C:/Users/bappa/agency-os/apps/worker/src/publishing/token.service.spec.ts#L688-L1075) | **MERGED** (PR #9, `4752a15`) | High / Resolved & Fenced | Complete |
| **Tier 7: Cleanup / Optimization** | Container Runtime Transpilation (`tsx` vs compiled `dist`) | `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `docs/phase-6-readiness.md` | **OPEN** | Low / Performance & Startup Optimization | Add build output transpilation for monorepo internal packages |
| **Tier 7: Non-Blocking Follow-Ups** | TokenService CAS Failure Recheck `DISCONNECTED` Guard | `apps/worker/src/publishing/token.service.ts` | **QUEUED (NON-BLOCKING)** | Low / Theoretical Edge Case | Check `recheckAccount.status !== DISCONNECTED` before returning recovered |
| **Tier 7: Non-Blocking Follow-Ups** | TokenService Integration Test via `SocialAccountRepository.upsertWithConnection` | `apps/worker/src/publishing/token.service.spec.ts` | **QUEUED (NON-BLOCKING)** | Low / Test-Only Hardening | Exercise real repository upsert against stale failure handler |
| **Tier 7: Future Feature Dependency** | Worker `PublishingProcessor` Catch-Path Disconnect Fencing | `apps/worker/src/publishing/publishing.processor.ts` | **FUTURE DEPENDENCY** | Low / Dependent on Future Disconnect API | Guard processor catch paths against resurrecting `DISCONNECTED` accounts |
| **Tier 7: CI / Test Optimization** | CI PostgreSQL Service E2E Test Execution Gap | `apps/api/test/publishing.e2e-spec.ts`, `.github/workflows/ci.yml` | **OPEN** | Low / Pipeline Test Breadth | Add Jest E2E execution step against CI Postgres container |

---

### 4. Single Highest-Priority Next Focus Area: Container Runtime Transpilation (`tsx` vs Compiled `dist`)

- **Priority Tier**: **Tier 7 (Cleanup / Performance & Startup Optimization)**
- **Components**: [`apps/api/Dockerfile`](file:///C:/Users/bappa/agency-os/apps/api/Dockerfile), [`apps/worker/Dockerfile`](file:///C:/Users/bappa/agency-os/apps/worker/Dockerfile), [`docs/phase-6-readiness.md`](file:///C:/Users/bappa/agency-os/docs/phase-6-readiness.md)
- **Specification / Documentation**: [`docs/phase-6-readiness.md`](file:///C:/Users/bappa/agency-os/docs/phase-6-readiness.md#L45-L60)
- **Core Gap**:
  Currently, production container images for the API and Worker execute TypeScript directly via `tsx` rather than executing pre-compiled JavaScript from `dist/`. While functional, transpiling at startup incurs cold-start latency, elevated container memory overhead, and unoptimized execution in production Kubernetes/Docker environments.
- **Target Verification Plan**:
  Verify monorepo internal package build outputs (`packages/database`, `packages/providers`, `packages/session`, `packages/shared`), assess Docker multistage build layers, and confirm whether production containers can execute compiled `node dist/main.js` cleanly without breaking symlinked monorepo dependencies.

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
  - *Context*: In `TokenService.handlePermanentAuthFailure()`, if `tx.socialAccount.updateMany` returns `count: 0` (indicating a CAS conflict), the helper re-reads `recheckAccount`. If `recheckAccount.connection` has valid credentials, it currently returns `recovered`.
  - *Hardening*: Before returning `recovered`, explicitly verify that `recheckAccount.status !== SocialAccountStatus.DISCONNECTED`.
  - *Status*: NON-BLOCKING. The race window between earlier disconnect check and CAS conflict recheck is practically infinitesimal.
- **Follow-Up B — Integration Test Through Real `upsertWithConnection`**:
  - *Context*: Existing unit tests in `token.service.spec.ts` simulate concurrent reconnect by writing directly to Prisma.
  - *Hardening*: Author an integration test exercising OAuth reconnect / credential replacement via the actual `SocialAccountRepository.upsertWithConnection()` method, followed by a stale worker permanent failure call. Verify that new credentials win, the account remains `ACTIVE`, and no `REAUTH_REQUIRED` transition occurs.
  - *Status*: NON-BLOCKING TEST HARDENING.
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
- **Status**: **PR OPEN** (Branch `fix/audit-logging-coverage`)
- **Reviewer**: Muse (Pending Review)
- **CI Status**: All required checks running/verified.
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
   - `apps/api/src/modules/oauth/oauth.controller.ts`: Connect initiated, callback (success, reconnect, denied, failed), and select use `this.auditService.logActionBestEffort`.
   - `apps/api/src/modules/accounts/accounts.controller.ts`: Trigger sync uses `this.auditService.logActionBestEffort`.
   - `apps/api/src/modules/media/media.service.ts`: Initiate upload and complete upload use `this.audit.logActionBestEffort`.
   - `apps/api/src/modules/publishing/services/publishing-application.service.ts`: All 13 post and publication mutations uncommented/wired with `await this.audit.logAction({...})`. Removed `as any` from `requestRemoteDelete`.
   - `PublishingApplicationService.reconcile()`: Retains transactional `tx.auditLog.create` inside `$transaction`.

### 3. Test Coverage & Verification
- **Unit Test Suites Added & Updated**:
  - `apps/api/src/modules/core/audit.service.spec.ts`: 4 tests verifying reliable resolution, rejection propagation, best-effort non-throwing behavior, and error logging.
  - `apps/api/src/modules/auth/auth.controller.spec.ts`: 3 tests verifying best-effort audit emission on login success, login failure, and logout.
  - `apps/api/src/modules/oauth/oauth.controller.spec.ts`: 12 tests verified and updated with `mockAuditService.logActionBestEffort`.
  - `apps/api/src/modules/accounts/accounts.controller.spec.ts`: 2 tests verified and updated with `mockAuditService.logActionBestEffort`.
  - `apps/api/src/modules/publishing/services/publishing-application.service.spec.ts`: 45 tests total (29 reconcile tests + 16 new audit tests covering all 13 actions, rejection propagation, no-double-logging in reconcile, and metadata redaction).
- **Test Suite Results**:
  - API Vitest Suite (`pnpm --filter @agency-os/api test`): **PASS** (17/17 test files passed, 170/170 tests passing, +21 new unit tests).
  - Database Vitest Suite (`pnpm --filter @agency-os/database test`): **PASS** (9/9 test files passed, 73/73 tests passing).
  - Monorepo Tests (`pnpm turbo run test`): **PASS** (5/5 tasks successful across all packages).
  - Monorepo Typecheck (`pnpm turbo run typecheck`): **PASS** (5/5 tasks successful, 0 errors).
  - Monorepo Lint (`pnpm turbo run lint`): **PASS** (5/5 tasks successful, 0 errors).
  - Production Builds (`pnpm turbo run build`): **PASS** (3/3 builds successful across API, Web, and Worker).

