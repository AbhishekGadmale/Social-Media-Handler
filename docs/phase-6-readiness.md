# Phase 6 Final Readiness & Release Gate

## Repository State
- **Git Status**: Clean, feature branch tracking `main`.
- **Secret Safety**: No `.env`, cookies, OAuth tokens, secrets, or temporary debug dumps are committed. `.gitignore` and `.dockerignore` properly filter out `.env` configurations.

## Local Quality Gate
A full local verification of the current implementation executes strictly successfully:
- **Lint**: 100% PASS (`pnpm turbo run lint`)
- **Typecheck**: 100% PASS (`pnpm turbo run typecheck`)
- **Builds**: 100% PASS for API, Worker, and Web.
- **Tests**: 100% PASS across API, Worker, Database, and Web test suites.

## CI Architecture Audit
The GitHub Actions workflow (`ci.yml`) is correctly configured with PR/push triggers, concurrency controls, least-privilege permissions, appropriate Node/pnpm caching, frozen installs, database service containers (Postgres & Redis) with health checks, a full unit/integration testing cycle, automated Docker port inspection, and automated Docker Compose smoke testing.

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
  - NGINX ingress service binds by default to loopback: `"${STAGING_BIND_IP:-127.0.0.1}:${STAGING_PORT:-80}:8080"`, ensuring ZERO inbound ports are exposed to the public internet when using Cloudflare Tunnel on the host.
  - Eliminates all development fallback secrets (`development-secret-1234`, `00000000000000000000000000000000`, `password`).
  - Unused secrets (`SESSION_SECRET`, `JWT_SECRET`, `COOKIE_SECRET`) have been removed from compose, documentation, and tests, as the codebase uses Redis session store with UUIDs and unsigned cookies (M1).
  - Enforces required-variable interpolation (`:?`) for genuinely consumed secrets: `POSTGRES_PASSWORD`, `TOKEN_ENCRYPTION_KEY`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, `OBJECT_STORAGE_PUBLIC_ENDPOINT`, `FRONTEND_URL`, `API_PUBLIC_URL`, and `NEXT_PUBLIC_API_URL` (M1, L6).
  - `OBJECT_STORAGE_PUBLIC_ENDPOINT` strictly requires a browser-reachable HTTPS URL in production (e.g. Cloudflare R2 or AWS S3), preventing the internal Docker hostname `http://minio:9000` from being returned to browsers.
  - Sets `NODE_ENV: production`, `TRUST_PROXY: "${TRUST_PROXY:-1}"`, and `ALLOW_INSECURE_HTTP_AUTH: ${ALLOW_INSECURE_HTTP_AUTH:-false}` across backend services.
- **CSRF Resolution**: Single-origin reverse proxy topology ensures `session` and `csrfToken` cookies remain host-only without cross-subdomain leakage, satisfying double-submit CSRF requirements.

## Recommended Staging Architecture: Cloudflare Tunnel + Cloudflare R2

### 1. Ingress & Origin Isolation (Cloudflare Tunnel)
- **Zero Inbound Open Ports:** The VPS host firewall blocks all incoming connections on ports 80, 443, 3000, 3001, 5432, 6379, and 9000.
- `cloudflared` runs on the host (or container) establishing an outbound encrypted QUIC/Wireguard tunnel to Cloudflare.
- Compose ingress binds to loopback (`STAGING_BIND_IP=127.0.0.1`, `STAGING_PORT=80`), accessible solely by `cloudflared`.
- **Header Spoofing Immunity:** Direct public requests cannot reach NGINX or NestJS over plain HTTP because no external ports are listening.
- **Proxy Hop Count:** `TRUST_PROXY=2` is configured in `.env.staging` for the request chain:
  `Client -> Cloudflare Edge -> cloudflared -> NGINX Ingress -> NestJS API`.

### 2. Browser-Reachable Media Storage (Cloudflare R2)
- Media uploads use Cloudflare R2 (or AWS S3) with `OBJECT_STORAGE_ENDPOINT` and `OBJECT_STORAGE_PUBLIC_ENDPOINT` set to the R2 endpoint.
- **Required Bucket CORS Policy:**
  ```json
  [
    {
      "AllowedOrigins": ["https://staging.agency-os.com"],
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

### 3. Backup, Disaster Recovery & Migration Rollback
- **Database Backups:** Scheduled with strict permissions (`umask 077` generating `0600` files inside `0700` directories):
  ```bash
  (umask 077 && docker compose -f docker-compose.staging.yml exec -T postgres \
    pg_dump -U postgres -d agency_os -F c -b > /opt/agency-os/backups/db_$(date +%Y%m%d_%H%M%S).dump)
  ```
- **Media Volume Backups:** Back up the `minio_data` volume:
  ```bash
  (umask 077 && docker run --rm -v agency-os_minio_data:/data -v /opt/agency-os/backups:/backup alpine \
    tar -czf /backup/minio_data_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .)
  ```
- **Prisma Migration Rollback Limitation:** Prisma Migrate is **forward-only** (`prisma migrate deploy`). There is no native `migrate down` command. Taking a pre-deployment database dump is **mandatory** before executing migrations; recovery requires restoring the pre-migration dump (`pg_restore`) or deploying an explicit forward-compensating migration.
- **Port Isolation Inspection:** Verify via Docker daemon inspection and host socket checks:
  ```bash
  docker compose -f docker-compose.staging.yml ps --format 'table {{.Service}}\t{{.Ports}}'
  ss -tulpn | grep -E ':(3000|3001|5432|6379|9000|9001)\b'
  ```

---

## Remaining Operator Staging Prerequisites
Before launching live staging on a VPS, the operator must complete:
1. **Cloudflare Tunnel Provisioning:** Set up `cloudflared` pointing hostname to `http://127.0.0.1:80`.
2. **Cloudflare R2 Provisioning & CORS:** Create bucket and apply the CORS JSON policy.
3. **Environment Secrets:** Populate `/opt/agency-os/.env.staging` with `chmod 600`.
4. **Backup Rehearsal:** Execute an end-to-end backup and test restore to prove recoverability.

---

## Readiness Levels & Verdicts

### 1. Configuration & Automated Verification: COMPLETE
- Staging NGINX ingress configuration implemented and validated via `nginx -t` using pinned `nginxinc/nginx-unprivileged:1.31.7-alpine`.
- `docker-compose.staging.yml` isolates host ports, binds ingress to loopback by default, and enforces required staging secrets including `OBJECT_STORAGE_PUBLIC_ENDPOINT`.
- `validateStoragePublicEndpoint` rejects internal Docker hostnames (`minio`) in production.
- 24 automated regression tests in `apps/api/src/config/staging-deployment.spec.ts` passing 100%.
- 12 unit tests in `apps/api/src/config/storage-endpoint.spec.ts` passing 100%.
- 12 unit tests in `apps/api/src/modules/auth/auth.controller.spec.ts` passing 100%.

### 2. CI Docker Smoke Test Verification: COMPLETE
- CI pipeline validates missing secrets fail-fast behavior with Compose v2.24.4+.
- Smoke test exercises the core ingress and application stack behind NGINX loopback binding with automated Docker port inspection.

### 3. Live VPS Deployment Gate: NO-GO UNTIL INFRASTRUCTURE PREREQUISITES MET
- The repository-level configuration is fully hardened and tested.
- Live deployment remains **NO-GO** until the operator configures Cloudflare Tunnel, applies R2 bucket CORS, and successfully executes a backup test restore on the target infrastructure.
