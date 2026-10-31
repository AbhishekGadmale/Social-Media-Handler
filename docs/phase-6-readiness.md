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
  - `OBJECT_STORAGE_PUBLIC_ENDPOINT` strictly requires HTTPS in production (e.g. Cloudflare R2 or AWS S3), preventing the internal Docker hostname `http://minio:9000` from being returned to browsers. A local loopback exception (`http://localhost`, `http://127.0.0.1`, `http://[::1]`) is permitted exclusively for isolated Docker Compose smoke testing and development.
  - Sets `NODE_ENV: production`, `TRUST_PROXY: "${TRUST_PROXY:-2}"`, and `ALLOW_INSECURE_HTTP_AUTH: ${ALLOW_INSECURE_HTTP_AUTH:-false}` across backend services.
- **CSRF Resolution**: Single-origin reverse proxy topology ensures `session` and `csrfToken` cookies remain host-only without cross-subdomain leakage, satisfying double-submit CSRF requirements.

## Recommended Staging Architecture: Cloudflare Tunnel + Cloudflare R2

### 1. Ingress & Origin Isolation (Cloudflare Tunnel)
- **Zero Inbound Open Ports:** The VPS host firewall blocks all incoming connections on ports 80, 443, 3000, 3001, 5432, 6379, and 9000.
- `cloudflared` runs on the host (or container) establishing an outbound encrypted QUIC/Wireguard tunnel to Cloudflare.
- Compose ingress binds to loopback (`STAGING_BIND_IP=127.0.0.1`, `STAGING_PORT=80`), accessible solely by `cloudflared`.
- **Header Spoofing Immunity:** Direct public requests cannot reach NGINX or NestJS over plain HTTP because no external ports are listening.
- **Proxy Hop Count:** `TRUST_PROXY: "${TRUST_PROXY:-2}"` is the default in `docker-compose.staging.yml` for the 2-hop reverse proxy chain:
  `Client -> Cloudflare Edge -> cloudflared (127.0.0.1) -> NGINX Ingress (172.x) -> NestJS API`.
  - Express trusts 2 hops from the right: NGINX and `cloudflared`.
  - In `X-Forwarded-For: <client_ip>, 127.0.0.1`, Express correctly extracts `<client_ip>` as `req.ip` for rate limiting and audit logging.
  - Setting `TRUST_PROXY=1` in this architecture improperly collapses all client IPs to `127.0.0.1`, breaking per-client rate limiting.
  - **Non-Tunnel Reverse Proxies:** Deployments utilizing a single-hop direct reverse proxy (e.g. AWS ALB or direct TLS on NGINX with public exposure) must explicitly set `TRUST_PROXY=1` in their environment file and verify their own client IP resolution. Do not present `1` or `2` as universally applicable without verifying the actual proxy hop topology.

### 2. Operational Invocations & Environment Loading
Docker Compose does **not** automatically read `.env.staging` unless explicitly passed via the `--env-file` flag. Every staging Compose command on the host must consistently specify the environment file:
```bash
# Verify configuration
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging config

# Build containers
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging build

# Start services
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging up -d

# Execute database migrations
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging up -d migration

# Check service status and ports
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging ps
```

### 3. Browser-Reachable Media Storage (Cloudflare R2)
- Media uploads use Cloudflare R2 (or AWS S3) with `OBJECT_STORAGE_ENDPOINT` and `OBJECT_STORAGE_PUBLIC_ENDPOINT` set to the public R2 endpoint.
- **Production Validation:** In production (`NODE_ENV=production`), `validateStoragePublicEndpoint()` strictly enforces HTTPS for non-loopback endpoints and rejects internal Docker service names (`minio`). The loopback HTTP exception is constrained exclusively to local smoke-test environments.
- **Worker Configuration:** The background worker (`@agency-os/worker`) communicates with object storage strictly backend-to-backend via `OBJECT_STORAGE_ENDPOINT` (e.g. streaming media directly to platform APIs via `getStream`). The worker does not serve browsers or generate presigned upload/download URLs, and therefore does not validate or require `OBJECT_STORAGE_PUBLIC_ENDPOINT` on bootstrap.
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

### 4. Forwarded-Protocol & TLS Verification Architecture
- **Automated Verification Coverage (In-Repository):**
  - NGINX configuration syntax (`nginx -t`) and `$forwarded_proto` mapping in `docker/nginx/nginx.conf`.
  - Express `trust proxy: 2` integration tests in `trust-proxy.spec.ts` verifying that `X-Forwarded-Proto: https` sets `req.secure = true` and `req.protocol = 'https'`.
  - Express `trust proxy: 2` client IP resolution tests verifying `req.ip` resolution over `[<client_ip>, 127.0.0.1]` and rejection of prepended spoofed headers.
  - NestJS `AuthController` HTTPS enforcement unit tests in `auth.controller.spec.ts` asserting unencrypted requests fail fast with `BadRequestException` in production.
- **Live Integration Verification (Operator Release Gate):**
  - Verifying that Cloudflare Edge attaches `X-Forwarded-Proto: https` to the tunnel session.
  - Verifying that `cloudflared` on the host forwards `X-Forwarded-Proto: https` to `127.0.0.1:80` without stripping or tampering.
  - Verifying live client IP delivery across the public internet.

### 5. Manual Backup Procedures, Disaster Recovery & Migration Rollback
No automated or scheduled backup daemon exists in this repository. Backups must be performed manually by the operator (or scheduled via host-level cron/systemd):
- **Backup Directory Preparation:**
  ```bash
  mkdir -p -m 700 /opt/agency-os/backups
  ```
- **Database Backup (Manual Procedure):**
  ```bash
  (umask 077 && docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging exec -T postgres \
    pg_dump -U postgres -d agency_os -F c -b > /opt/agency-os/backups/db_$(date +%Y%m%d_%H%M%S).dump)
  ```
- **Media Volume Backup (Manual Procedure):**
  Dynamically determine the actual Compose volume name to avoid assuming a fixed project prefix:
  ```bash
  MINIO_VOLUME=$(docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging config --volumes | grep -i minio || docker volume ls --filter name=minio_data -q | head -n 1)
  (umask 077 && docker run --rm -v "${MINIO_VOLUME}":/data -v /opt/agency-os/backups:/backup alpine \
    tar -czf /backup/minio_data_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .)
  ```
- **Database Restore Procedure:**
  ```bash
  docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging exec -T postgres \
    pg_restore -U postgres -d agency_os --clean --if-exists /backup/<dump_file>
  ```
- **Prisma Migration Rollback Limitation:**
  Prisma Migrate is **forward-only** (`prisma migrate deploy`). There is no native `migrate down` command. Taking a pre-deployment database dump using the command above is **mandatory** before executing migrations; recovery requires restoring the pre-migration dump (`pg_restore`) or deploying an explicit forward-compensating migration.
- **Optional Host Scheduling Template (Example — Not Pre-Installed in Repository):**
  *(If automated scheduling is desired, the operator may install a host cron job such as the following)*:
  ```cron
  # /etc/cron.d/agency-os-backup (Example host scheduling template)
  0 2 * * * root (umask 077 && cd /opt/agency-os && docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging exec -T postgres pg_dump -U postgres -d agency_os -F c -b > /opt/agency-os/backups/db_$(date +\%Y\%m\%d_\%H\%M\%S).dump)
  ```
- **Port Isolation Inspection:**
  Verify via Docker daemon inspection and host socket checks:
  ```bash
  docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging ps --format 'table {{.Service}}\t{{.Ports}}'
  ss -tulpn | grep -E ':(3000|3001|5432|6379|9000|9001)\b'
  ```

---

## Remaining Operator Staging Prerequisites
Before launching live staging on a VPS, the operator must complete:
1. **Cloudflare Tunnel Provisioning:** Set up `cloudflared` on host pointing to `http://127.0.0.1:80`.
2. **Cloudflare R2 Provisioning & CORS:** Create bucket and apply the CORS JSON policy.
3. **Environment Secrets:** Populate `/opt/agency-os/.env.staging` with `chmod 600`.
4. **Restore Drill Rehearsal:** Execute an end-to-end backup and test restore on target infrastructure to prove recoverability.

---

## Readiness Levels & Verdicts

### 1. Configuration & Automated Verification: COMPLETE
- Staging NGINX ingress configuration implemented and validated via `nginx -t` using pinned `nginxinc/nginx-unprivileged:1.31.7-alpine`.
- `docker-compose.staging.yml` isolates host ports, binds ingress to loopback by default, and enforces required staging secrets including `OBJECT_STORAGE_PUBLIC_ENDPOINT`.
- `validateStoragePublicEndpoint` rejects internal Docker hostnames (`minio`) in production, with loopback permitted strictly for smoke testing.
- Express proxy trust default set to 2 for Cloudflare Tunnel staging architecture, with comprehensive unit tests for 2-hop resolution, spoof resistance, and HTTPS enforcement.
- 24 automated regression tests in `apps/api/src/config/staging-deployment.spec.ts` passing 100%.
- 16 automated tests in `apps/api/src/config/trust-proxy.spec.ts` passing 100%.
- 12 unit tests in `apps/api/src/config/storage-endpoint.spec.ts` passing 100%.
- 12 unit tests in `apps/api/src/modules/auth/auth.controller.spec.ts` passing 100%.

### 2. CI Docker Smoke Test Verification: COMPLETE
- CI pipeline validates missing secrets fail-fast behavior with Compose v2.24.4+.
- Smoke test exercises the core ingress and application stack behind NGINX loopback binding with automated Docker port inspection asserting zero published ports for backing services.

### 3. Live VPS Deployment Gate: NO-GO UNTIL INFRASTRUCTURE PREREQUISITES MET
- The repository-level configuration is fully hardened and tested.
- Live deployment remains **NO-GO** until the operator configures Cloudflare Tunnel, applies R2 bucket CORS, and successfully executes a backup test restore on the target infrastructure.
