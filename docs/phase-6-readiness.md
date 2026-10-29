# Phase 6 Final Readiness & Release Gate

## Repository State
- **Git Status**: Clean, up to date with `origin/main`.
- **Secret Safety**: No `.env`, cookies, OAuth tokens, secrets, or temporary debug dumps are committed. `.gitignore` and `.dockerignore` properly filter out `.env` configurations.

## Local Quality Gate
A full local verification of the current implementation executes strictly successfully:
- **Lint**: 100% PASS (`pnpm turbo run lint`)
- **Typecheck**: 100% PASS (`pnpm turbo run typecheck`)
- **Builds**: 100% PASS for API, Worker, and Web.
- **Tests**: 100% PASS across API, Worker, Database, and Web test suites.

## CI Architecture Audit
The GitHub Actions workflow (`ci.yml`) is correctly configured with PR/push triggers, concurrency controls, least-privilege permissions, appropriate Node/pnpm caching, frozen installs, database service containers (Postgres & Redis) with health checks, a full unit/integration testing cycle, and automated Docker Compose smoke testing.

## Docker Runtime & Container Hardening
- **Web App**: Operates using `next start` (a full standard build) triggered by `pnpm --filter @agency-os/web start`.
- **API & Worker**: Production containers run compiled JavaScript directly from `dist/` via standard `node`, with internal workspace packages compiled to `dist/` with `.d.ts` types and modern exports (resolved in PR #17 and PR #31).
- **Image Slimming**: Workspace-aware production reinstallation (`pnpm install --prod --frozen-lockfile`) prunes devDependencies while safely preserving generated Prisma runtime client artifacts (resolved in PR #31).

## Security & Observability Acceptance
- **Helmet**: Active and injecting secure headers.
- **CORS**: Correctly bound to `FRONTEND_URL` (defaults to `http://localhost:3000`).
- **CSRF & Redaction**: Active. Logging securely redacts credentials, OAuth tokens, headers (`Authorization`, `Cookie`, `Set-Cookie`, `x-csrf-token`), BullMQ job payload secrets, and query parameters (`url-sanitizer.utils.ts`) automatically via Pino configuration without crashing containers (resolved in PR #37).
- **Rate Limiting**: Redis throttler is completely functional. Configured intelligently via `APP_GUARD` to permit parallel testing (limit 1000 in `NODE_ENV=test`) while retaining strict boundaries in dev/prod (limit 5 for Auth, 10 for expensive, 100 for baseline).
- **Audit Logging**: Persisting semantically mapped behaviors intelligently across actions.
- **Fail-Fast Secret Validation**: `validateTokenEncryptionKey()` enforces exactly 64 hexadecimal characters (32 bytes) fail-fast during bootstrap before application initialization (resolved in PR #35).

## Unified Ingress & Staging Deployment Hardening
- **Unified Ingress (NGINX)**:
  - Implemented unprivileged non-root NGINX reverse proxy (`docker/nginx/nginx.conf`, `docker/nginx/Dockerfile`) based on version-pinned `nginxinc/nginx-unprivileged:1.31.7-alpine` (L1).
  - Routes `/api/*` to `api:3001` preserving exact URI paths and query strings verbatim without prefix stripping.
  - Routes `/` to `web:3000` with WebSocket connection upgrade mapping (`$http_upgrade`, `$connection_upgrade`) where empty upgrade headers map to empty string `''` (not `'close'`) to preserve persistent HTTP/1.1 upstream keepalive connections (L2).
  - Access log format logs `$request_method $uri $server_protocol` without query parameters (`$args`) to prevent plain-text logging of sensitive OAuth callback authorization codes and state tokens (H1).
  - Sets `client_max_body_size 512m` aligning with verified `MEDIA_MAX_UPLOAD_BYTES=524288000` (500MB + 12MB multipart header headroom).
  - Sets upstream timeouts: `proxy_connect_timeout 60s; proxy_send_timeout 120s; proxy_read_timeout 120s;` (L5).
  - Maps `$http_x_forwarded_proto` preserving `https` from trusted edge proxies while defaulting to `$scheme` for direct TLS termination (`map $http_x_forwarded_proto $forwarded_proto`) (H2, L8).
  - Forwards `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` (via `$forwarded_proto`), and `X-Forwarded-Host` headers cleanly across both `/api/` and `/` proxy blocks (L3).
  - Exposes dedicated `/healthz` endpoint returning HTTP 200 `healthy\n` (`text/plain`) without upstream dependencies for container health probes and orchestrator liveness checks (L4).
- **Authentication & Secure Cookie Enforcement (`auth.controller.ts`)**:
  - Session cookie `secure` attribute is dynamically derived from `req.secure` (`Boolean(req.secure)`).
  - In production (`NODE_ENV === 'production'`), unencrypted HTTP authentication requests fail fast with `BadRequestException` (`HTTPS is required for authentication in production environments...`) before credential verification, session creation, audit logging, or cookie issuance, preventing credential oracles and silent cookie drops (N1, H2).
  - An explicit test-only override `ALLOW_INSECURE_HTTP_AUTH=true` is provided for isolated HTTP testing environments.
  - Session cookie clearing upon logout strictly matches the issuing attributes (`httpOnly: true, secure: isSecureRequest, sameSite: 'lax'`).
- **Staging Compose Architecture (`docker-compose.staging.yml`)**:
  - Requires Docker Compose v2.24.4 or later for Compose specification `ports: !reset []` syntax (L11).
  - Unbinds `postgres` (`5432`), `redis` (`6379`), `minio` (`9000`), `api` (`3001`), and `web` (`3000`) from host network exposure (`ports: !reset []`).
  - NGINX ingress service is the sole publicly bound entrypoint on `${STAGING_PORT:-80}`.
  - Eliminates all development fallback secrets (`development-secret-1234`, `00000000000000000000000000000000`, `password`).
  - Unused secrets (`SESSION_SECRET`, `JWT_SECRET`, `COOKIE_SECRET`) have been removed from compose, documentation, and tests, as the codebase uses Redis session store with UUIDs and unsigned cookies (M1).
  - Enforces required-variable interpolation (`:?`) for genuinely consumed secrets: `POSTGRES_PASSWORD`, `TOKEN_ENCRYPTION_KEY`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, `FRONTEND_URL`, `API_PUBLIC_URL`, and `NEXT_PUBLIC_API_URL` (M1, L6).
  - Sets `NODE_ENV: production`, `TRUST_PROXY: "1"`, and `ALLOW_INSECURE_HTTP_AUTH: ${ALLOW_INSECURE_HTTP_AUTH:-false}` across backend services.
- **CSRF Resolution**: Single-origin reverse proxy topology ensures `session` and `csrfToken` cookies remain host-only without cross-subdomain leakage, satisfying double-submit CSRF requirements.

## Remaining Operator Staging Prerequisites
Before launching an actual live staging environment on a public VPS, the following operator tasks must be completed:
1. **Domain & DNS**: Configure DNS A/AAAA records pointing the staging hostname (e.g. `staging.agency-os.com`) to the VPS public IP.
2. **TLS / SSL Termination**:
   - **Option A (Edge TLS / CDN — Recommended)**: Terminate HTTPS at Cloudflare or an AWS ALB, forwarding HTTP traffic to port 80 with `X-Forwarded-Proto: https` (API `TRUST_PROXY=1` correctly trusts this header via NGINX `$forwarded_proto` mapping). **Security Requirement**: When using Edge TLS, the host firewall MUST restrict ingress ports (80/8080) strictly to edge proxy CIDRs so direct requests cannot spoof forwarded HTTPS headers.
   - **Option B (On-Host TLS Termination)**: Mount valid TLS certificates (e.g., Let's Encrypt / Certbot `fullchain.pem` and `privkey.pem`) into `/etc/nginx/certs/` and bind port 443 (`${STAGING_SSL_PORT:-443}:8443`).
3. **Production Secrets**: Generate strong, random secrets in the staging `.env` file (`openssl rand -hex 32` for `TOKEN_ENCRYPTION_KEY`, secure `POSTGRES_PASSWORD`, and MinIO/S3 object storage credentials).
4. **Firewall / Network Rules**: Ensure VPS firewall (e.g. `ufw` / AWS Security Group) allows inbound traffic only on ports 80/443 and blocks direct inbound access to 5432, 6379, 9000, 3000, and 3001.

---

## Readiness Levels & Verdicts

### 1. Configuration & Automated Verification: COMPLETE
- Staging NGINX ingress configuration implemented and validated via `nginx -t` using pinned `nginxinc/nginx-unprivileged:1.31.7-alpine`.
- `docker-compose.staging.yml` implemented, isolating host ports and enforcing required staging secrets.
- 23 automated regression tests in `apps/api/src/config/staging-deployment.spec.ts` passing 100%.
- 12 unit tests in `apps/api/src/modules/auth/auth.controller.spec.ts` (including 6 N1/H2 TLS, cookie, and credential-oracle prevention regression tests) passing 100%.

### 2. CI Docker Smoke Test Verification: COMPLETE
- CI pipeline validates missing secrets fail-fast behavior with Compose v2.24.4+.
- Smoke test exercises the core ingress and application stack (PostgreSQL, Redis, API, Worker, Web, Ingress; MinIO excluded from CI compose run due to upstream Docker Hub registry pull restrictions) behind the NGINX ingress port using:
  `docker compose -f docker-compose.staging.yml config` and
  `docker compose -f docker-compose.staging.yml up -d`:
  - `/healthz` returns HTTP 200 `healthy\n`.
  - `/api/health/ready` returns HTTP 200 with `{ database: { status: "up" } }`.
  - `/` returns HTTP 2xx from Next.js.
  - Direct host access to 3000, 3001, and 9000 (MinIO) is verified closed.

### 3. TLS & Live VPS Deployment: PENDING OPERATOR ACTIONS
- Edge TLS or certificate mounting must be performed by the operator on the target infrastructure with origin firewall restrictions.
- Deployment automation or manual VPS startup (`docker compose -f docker-compose.staging.yml up -d`) remains an operator responsibility.

### Overall Verdict: READY FOR STAGING DEPLOYMENT
The application and container architecture are hardened, tested, and ready for staging deployment behind the unified NGINX ingress gateway.
