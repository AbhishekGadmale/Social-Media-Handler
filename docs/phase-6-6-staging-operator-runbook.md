# Phase 6.6 Staging Operator Runbook

> [!CAUTION]
> **LIVE STAGING DEPLOYMENT STATUS: STRICT NO-GO**
> Passing CI runs, unit tests, and integration smoke tests prove codebase correctness and container configuration validity within isolated environments. They do **NOT** constitute authorization or readiness for live staging deployment.
> Live deployment remains strictly **NO-GO** until every physical and external infrastructure prerequisite in this runbook is provisioned, verified, and signed off by the staging operator on the target VPS.

---

## 1. Purpose, Scope, Prerequisites, and Explicit NO-GO Status

### 1.1 Purpose
This runbook provides an authoritative, step-by-step operational procedure for provisioning, deploying, verifying, and maintaining the Agency OS staging environment. It translates the hardening merged in PR #41 (`1086418aa22d59620038c0d8516494611f75810a`) and documented in PR #42 (`80366a02899061d928bae98744c311b20d59bca3`) into unambiguous, executable operator actions.

### 1.2 Scope
- **Target Environment:** Dedicated Linux VPS host (Ubuntu 22.04/24.04 LTS or Debian 12 recommended).
- **Orchestration:** Docker Compose v2.24.4+ executing `docker-compose.staging.yml`.
- **Environment Configuration:** `/opt/agency-os/.env.staging` (mandatory `--env-file` parameter for all Compose commands).
- **Ingress Architecture:** Cloudflare Tunnel (`cloudflared`) terminating external TLS and proxying to loopback NGINX ingress (`127.0.0.1:80`).
- **Media Object Storage:** Cloudflare R2 (or AWS S3) with verified bucket CORS policies and browser-reachable endpoints.
- **Data Persistence & Recovery:** PostgreSQL 16 database, Redis 7 session/cache store, manual backup runbooks, and isolated restore drills.

### 1.3 Operator Prerequisites (External to Repository)
The following resources must be provisioned and accessible before proceeding:
1. **Target VPS:** Dedicated host with root or sudo access, static IP, and egress connectivity to Cloudflare and GitHub.
2. **Cloudflare Account & Zone:** Active Cloudflare zone (e.g., `agency-os.com`) with Zero Trust Tunnel capability.
3. **Cloudflare R2 Bucket:** Provisioned bucket (e.g., `agency-os-staging-media`) with R2 API tokens (Access Key ID and Secret Access Key).
4. **OAuth Applications (Optional for Auth, Required for Platform Integrations):** Valid LinkedIn and YouTube client IDs and secrets configured with the staging redirect URI (`https://staging.agency-os.com/api/v1/oauth/...`).

---

## 2. Server Preflight & Docker Compose Version Requirements

### 2.1 Host System Requirements
- **Architecture:** `x86_64` / `amd64`.
- **Compute:** Minimum 2 vCPUs, 4 GB RAM, 20 GB available SSD storage mounted at `/` or `/var/lib/docker`.
- **Operating System:** Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, or Debian 12.

### 2.2 Docker Engine & Compose Specification Compatibility
`docker-compose.staging.yml` utilizes the Compose Specification attribute override syntax (`ports: !reset []`) to strip published host ports from backing services (`postgres`, `redis`, `minio`, `api`, `web`). This feature strictly requires **Docker Compose v2.24.4 or later**.

Run the preflight check on the host:
```bash
# Verify Docker daemon is running
docker version

# Verify Docker Compose version (MUST be >= 2.24.4)
docker compose version
```

> [!WARNING]
> **STOP CONDITION: Docker Compose Version**
> If `docker compose version` reports a version older than `v2.24.4`, `docker compose config` will fail with a YAML parsing or unrecognized tag error (`unknown tag !reset`).
> **Action:** Do NOT edit compose files to remove `!reset []`. Upgrade Docker Compose using official Docker repositories (`sudo apt-get update && sudo apt-get install docker-compose-plugin`).

### 2.3 Base Directory Preparation
Create the application directory structure:
```bash
sudo mkdir -p /opt/agency-os
sudo mkdir -p -m 700 /opt/agency-os/backups
sudo chown -R $USER:$USER /opt/agency-os
```

Clone the repository and check out `main`:
```bash
cd /opt/agency-os
git clone https://github.com/AbhishekGadmale/Social-Media-Handler.git repo
cd repo
git checkout main
```

---

## 3. Secure Staging Environment-File Permissions & Secret Validation

Docker Compose does **not** automatically load `.env.staging` unless explicitly passed via `--env-file`. The operator must create `/opt/agency-os/.env.staging` with strict filesystem permissions.

### 3.1 File Permissions
```bash
touch /opt/agency-os/.env.staging
chmod 600 /opt/agency-os/.env.staging
ls -l /opt/agency-os/.env.staging
# Verify output permissions are strictly: -rw-------
```

### 3.2 Environment Variable Matrix
Populate `/opt/agency-os/.env.staging` with production-grade secrets. Every variable below must be explicitly set without development fallbacks:

```bash
# /opt/agency-os/.env.staging

# Core Environment
NODE_ENV=production

# Database Credentials
POSTGRES_USER=postgres
POSTGRES_PASSWORD="<GENERATE_STRONG_PASSWORD_32_CHARS>"
POSTGRES_DB=agency_os

# Credential Encryption (AES-256-GCM)
# MUST be exactly 64 hexadecimal characters (32 bytes).
# Generate via: openssl rand -hex 32
TOKEN_ENCRYPTION_KEY="<GENERATE_64_HEX_CHARACTERS>"

# Domain & Ingress Routing
FRONTEND_URL="https://staging.agency-os.com"
API_PUBLIC_URL="https://staging.agency-os.com"
NEXT_PUBLIC_API_URL="https://staging.agency-os.com/api/v1"

# Ingress Loopback Binding (Cloudflare Tunnel Isolation)
STAGING_BIND_IP="127.0.0.1"
STAGING_PORT="80"

# Express Proxy Trust
# Value MUST be 2 for the 2-hop chain: Cloudflare Edge -> cloudflared (127.0.0.1) -> NGINX -> API
TRUST_PROXY="2"

# Security Enforcement
# MUST remain false in staging and production
ALLOW_INSECURE_HTTP_AUTH="false"

# Cloudflare R2 / Object Storage Configuration
OBJECT_STORAGE_ACCESS_KEY_ID="<R2_ACCESS_KEY_ID>"
OBJECT_STORAGE_SECRET_ACCESS_KEY="<R2_SECRET_ACCESS_KEY>"
OBJECT_STORAGE_PUBLIC_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
OBJECT_STORAGE_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
OBJECT_STORAGE_BUCKET="agency-os-staging-media"
OBJECT_STORAGE_REGION="auto"
OBJECT_STORAGE_FORCE_PATH_STYLE="true"
MEDIA_MAX_UPLOAD_BYTES="524288000"
MEDIA_UPLOAD_URL_TTL_SECONDS="900"

# Third-Party OAuth (Optional if not testing OAuth in staging)
YOUTUBE_CLIENT_ID=""
YOUTUBE_CLIENT_SECRET=""
LINKEDIN_CLIENT_ID=""
LINKEDIN_CLIENT_SECRET=""
```

### 3.3 Safe Secret Validation (Zero Value Exposure)
Run the following script on the host to validate required variables, presence, and key format **without printing secret values** to the terminal or system logs:

```bash
# Execute safe environment validation
bash -c '
ENV_FILE="/opt/agency-os/.env.staging"
echo "=== Validating Environment Configuration: ${ENV_FILE} ==="

if [ ! -f "$ENV_FILE" ]; then
  echo "FATAL: ${ENV_FILE} does not exist!"
  exit 1
fi

PERMS=$(stat -c "%a" "$ENV_FILE" 2>/dev/null || stat -f "%Lp" "$ENV_FILE" 2>/dev/null)
if [ "$PERMS" != "600" ]; then
  echo "WARNING: Permissions on ${ENV_FILE} are ${PERMS}. Setting to 600..."
  chmod 600 "$ENV_FILE"
fi

ERRORS=0
REQUIRED_VARS=(
  "POSTGRES_PASSWORD"
  "TOKEN_ENCRYPTION_KEY"
  "FRONTEND_URL"
  "API_PUBLIC_URL"
  "NEXT_PUBLIC_API_URL"
  "OBJECT_STORAGE_ACCESS_KEY_ID"
  "OBJECT_STORAGE_SECRET_ACCESS_KEY"
  "OBJECT_STORAGE_PUBLIC_ENDPOINT"
)

for VAR in "${REQUIRED_VARS[@]}"; do
  VAL=$(grep -E "^${VAR}=" "$ENV_FILE" | cut -d"=" -f2- | tr -d "\"\r\n")
  if [ -z "$VAL" ]; then
    echo "ERROR: Variable ${VAR} is missing or empty!"
    ERRORS=$((ERRORS + 1))
  else
    echo "OK: ${VAR} is present (length: ${#VAL})"
  fi
done

# Validate TOKEN_ENCRYPTION_KEY length and hex encoding
ENC_KEY=$(grep -E "^TOKEN_ENCRYPTION_KEY=" "$ENV_FILE" | cut -d"=" -f2- | tr -d "\"\r\n")
if echo "$ENC_KEY" | grep -Eq "^[0-9a-fA-F]{64}$"; then
  echo "OK: TOKEN_ENCRYPTION_KEY matches required 64-hexadecimal character specification"
else
  echo "ERROR: TOKEN_ENCRYPTION_KEY is INVALID. Must be exactly 64 hexadecimal characters (32 bytes)."
  ERRORS=$((ERRORS + 1))
fi

# Validate OBJECT_STORAGE_PUBLIC_ENDPOINT protocol and non-docker hostname
R2_ENDPOINT=$(grep -E "^OBJECT_STORAGE_PUBLIC_ENDPOINT=" "$ENV_FILE" | cut -d"=" -f2- | tr -d "\"\r\n")
if [[ "$R2_ENDPOINT" =~ ^https:// ]]; then
  if [[ "$R2_ENDPOINT" =~ minio ]]; then
    echo "ERROR: OBJECT_STORAGE_PUBLIC_ENDPOINT contains internal hostname minio!"
    ERRORS=$((ERRORS + 1))
  else
    echo "OK: OBJECT_STORAGE_PUBLIC_ENDPOINT uses HTTPS and non-internal host"
  fi
else
  echo "ERROR: OBJECT_STORAGE_PUBLIC_ENDPOINT must start with https://"
  ERRORS=$((ERRORS + 1))
fi

# Validate ALLOW_INSECURE_HTTP_AUTH
INSECURE_AUTH=$(grep -E "^ALLOW_INSECURE_HTTP_AUTH=" "$ENV_FILE" | cut -d"=" -f2- | tr -d "\"\r\n")
if [ "$INSECURE_AUTH" = "true" ]; then
  echo "SECURITY VIOLATION: ALLOW_INSECURE_HTTP_AUTH=true is set! Must be false."
  ERRORS=$((ERRORS + 1))
fi

unset ENC_KEY VAL R2_ENDPOINT INSECURE_AUTH

if [ $ERRORS -gt 0 ]; then
  echo "VALIDATION FAILED: $ERRORS error(s) detected. Fix before proceeding."
  exit 1
else
  echo "ENVIRONMENT VALIDATION SUCCESSFUL"
fi
'
```

---

## 4. Compose Configuration Validation

Validate that `docker-compose.staging.yml` parses correctly against `/opt/agency-os/.env.staging` and that all interpolation expressions (`:?`) are satisfied:

```bash
cd /opt/agency-os/repo

# Validate configuration syntax and required variables quietly
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging config --quiet
echo "Exit code: $?" # Must be 0
```

To inspect defined services and volumes without echoing sensitive variables:
```bash
# List services
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging config --services
# Expected output:
# postgres
# redis
# minio
# minio-create-bucket
# migration
# api
# worker
# web
# ingress

# List volumes
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging config --volumes
# Expected output:
# minio_data
# postgres_data
# redis_data
```

---

## 5. Ingress Binding, Docker Port Isolation, and Firewall Checks

### 5.1 Host Firewall Setup (UFW / iptables)
The staging architecture employs strict origin isolation. Because Cloudflare Tunnel (`cloudflared`) establishes outbound tunnels to Cloudflare, **inbound ports 80, 443, 3000, 3001, 5432, 6379, and 9000 must NOT be opened on the external firewall**.

```bash
# Configure UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment "SSH administration"
sudo ufw enable
sudo ufw status verbose
```

### 5.2 Build Images
Build the container images before launching services:
```bash
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging build
```

### 5.3 Docker Port Isolation Verification
Start the ingress service and inspect port bindings:
```bash
# Start backing services and ingress
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging up -d postgres redis ingress

# Inspect published ports
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging ps --format 'table {{.Service}}\t{{.Ports}}'
```

Execute the port isolation verification assertions:
```bash
bash -c '
PUBLISHED=$(docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging ps --format "{{.Service}}: {{.Ports}}")
echo "$PUBLISHED"

# 1. Assert non-ingress backing services publish zero host ports
if echo "$PUBLISHED" | grep -v "ingress:" | grep -- "->"; then
  echo "SECURITY VIOLATION: Internal service has published host ports!"
  exit 1
else
  echo "PASS: Backing services have zero published host ports."
fi

# 2. Assert ingress is bound exclusively to loopback 127.0.0.1
if ! echo "$PUBLISHED" | grep "ingress:" | grep -q "127\.0\.0\.1:"; then
  echo "SECURITY VIOLATION: Ingress is not bound to loopback 127.0.0.1!"
  exit 1
else
  echo "PASS: Ingress is bound to 127.0.0.1."
fi

# 3. Assert no service is bound to public wildcard interfaces (0.0.0.0 or :::)
if echo "$PUBLISHED" | grep -E "0\.0\.0\.0:|:::"; then
  echo "SECURITY VIOLATION: Host service exposed on public wildcard interface!"
  exit 1
else
  echo "PASS: Zero services exposed on 0.0.0.0 or :::"
fi

# 4. Host socket probe check
if ss -tulpn | grep -E ":(3000|3001|5432|6379|9000)\b"; then
  echo "SECURITY VIOLATION: Internal ports listening on host sockets!"
  exit 1
else
  echo "PASS: Internal ports closed on host sockets."
fi
'
```

---

## 6. Cloudflare Tunnel Setup & HTTPS Verification

### 6.1 Install and Authenticate Cloudflared
On the target VPS host:
```bash
# Download and install cloudflared Debian package
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
rm cloudflared.deb

# Verify installation
cloudflared --version
```

### 6.2 Configure Tunnel
The tunnel can be configured via Cloudflare Zero Trust Dashboard (Remotely-managed) or local configuration file:
- **Service Target:** `http://127.0.0.1:80` (or `http://localhost:80`).
- **Public Hostname:** `staging.agency-os.com`.
- **Cloudflare Edge SSL/TLS Mode:** Must be set to **Full** (or **Full Strict**). Do NOT select **Flexible**.

If using system service with token:
```bash
sudo cloudflared service install <CLOUDFLARE_TUNNEL_TOKEN>
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

### 6.3 Verification of Proxy Trust & HTTPS Header Forwarding
The application mandates HTTPS for authentication in production (`NODE_ENV=production`) in `apps/api/src/modules/auth/auth.controller.ts`:
```typescript
if (isProduction && !isSecureRequest && !allowInsecureHttp) {
  throw new BadRequestException(
    'HTTPS is required for authentication in production environments. Please configure TLS on your reverse proxy or custom domain.',
  );
}
```

Verify that Cloudflare Edge attaches `X-Forwarded-Proto: https` and that Express with `TRUST_PROXY=2` recognizes the request as secure:
```bash
# Test authentication endpoint through public Cloudflare Tunnel
curl -i -X POST https://staging.agency-os.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"probe@example.com","password":"invalid-password"}'
```

**Expected Result:**
- HTTP status: `401 Unauthorized` (indicating valid TLS resolution; credentials failed).
- **If you receive `400 Bad Request`** with body containing `HTTPS is required for authentication in production environments`:
  - `req.secure` evaluated to `false`.
  - Cloudflare Tunnel is not passing `X-Forwarded-Proto: https`, or `TRUST_PROXY` in `/opt/agency-os/.env.staging` does not match the actual number of proxy hops.
  - **STOP IMMEDIATELY.** Do NOT set `ALLOW_INSECURE_HTTP_AUTH=true`. Fix tunnel header forwarding.

---

## 7. R2/S3 Configuration, CORS, Presigned URLs, and Browser Upload Tests

### 7.1 Required Cloudflare R2 Bucket CORS Policy
Log in to the Cloudflare Dashboard, navigate to **R2** -> select your bucket (`agency-os-staging-media`) -> **Settings** -> **CORS Policy**, and apply:
```json
[
  {
    "AllowedOrigins": [
      "https://staging.agency-os.com"
    ],
    "AllowedMethods": [
      "PUT",
      "GET",
      "HEAD"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [
      "ETag"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

### 7.2 In-Repository Validation Grounding
The repository enforces the following in `apps/api/src/config/storage-endpoint.ts`:
- Rejects missing `OBJECT_STORAGE_PUBLIC_ENDPOINT` in production.
- Strictly rejects internal Docker hostname `minio` in production.
- Requires `https://` protocol for non-loopback endpoints.
- The background worker (`@agency-os/worker`) communicates with storage strictly backend-to-backend via `OBJECT_STORAGE_ENDPOINT` (e.g. `MediaRecoveryService` calling `headObject`, `copyObject`, and `deleteObject`). The worker does not generate presigned URLs and does not validate `OBJECT_STORAGE_PUBLIC_ENDPOINT`.

### 7.3 End-to-End Browser Upload Verification Procedure
1. Navigate to `https://staging.agency-os.com` in a browser.
2. Log in with staging operator credentials.
3. Open Browser Developer Tools (**F12** -> **Network** tab).
4. Navigate to the Media Upload interface.
5. Select a test image/video file (< 500 MB).
6. Verify the upload network flow:
   - Request 1: `POST /api/v1/workspaces/:id/media/uploads` -> Returns `201 Created` with a presigned `uploadUrl` on `https://<account_id>.r2.cloudflarestorage.com/...`.
   - Request 2: Browser issues direct `PUT <uploadUrl>` to Cloudflare R2.
   - Assert in Network tab: Status is `200 OK`, response header `Access-Control-Allow-Origin: https://staging.agency-os.com` is present, zero CORS console errors.
   - Request 3: `POST /api/v1/workspaces/:id/media/:mediaId/complete` -> Returns `200 OK`.
7. Verify asset thumbnail loads and asset state transitions to `READY`.

---

## 8. Safe Staging Startup & Health Verification

### 8.1 Ordered Deployment Sequence
Follow this strict service boot sequence on the target VPS:

```bash
cd /opt/agency-os/repo

# 1. Start core database and redis containers
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging up -d postgres redis

# 2. Wait for PostgreSQL readiness
echo "Waiting for postgres..."
for i in {1..30}; do
  docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging exec -T postgres pg_isready -U postgres -d agency_os && break
  sleep 2
done

# 3. Wait for Redis readiness
echo "Waiting for redis..."
for i in {1..30}; do
  docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging exec -T redis redis-cli ping && break
  sleep 2
done

# 4. Run Prisma database migrations
echo "Executing database migrations..."
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging up migration

# Verify migration container exited cleanly with status 0
MIGRATION_STATUS=$(docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging ps migration --format "{{.State}}")
echo "Migration exit state: ${MIGRATION_STATUS}"

# 5. Start remaining services: api, worker, web, and ingress
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging up -d api worker web ingress
```

### 8.2 Health Endpoint Verification
Verify internal and public health endpoints:

```bash
# 1. Ingress Local Healthz (No upstream dependencies)
curl -fsS http://127.0.0.1:80/healthz
# Expected output: healthy

# 2. API Readiness Probe through Ingress (Checks PostgreSQL and Redis)
curl -fsS http://127.0.0.1:80/api/health/ready
# Expected output: {"status":"ok","info":{"database":{"status":"up"},"redis":{"status":"up"}},...}

# 3. Web Frontend Probe through Ingress
curl -fsS -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:80/
# Expected output: HTTP 200 (or HTTP 307/308 redirect)

# 4. Public Domain Probes via Cloudflare Tunnel
curl -fsS https://staging.agency-os.com/healthz
curl -fsS https://staging.agency-os.com/api/health/ready
```

---

## 9. Database & Media Backup Procedures

> [!NOTE]
> No background automated backup daemon is bundled inside this repository. Backup execution is a manual operator runbook procedure or must be scheduled via host cron.

### 9.1 Database Backup Procedure
PostgreSQL backups use `pg_dump` with custom archive format (`-F c -b`), which enables compressed, atomic, consistent snapshots:

```bash
# Ensure secure backup directory
mkdir -p -m 700 /opt/agency-os/backups

# Execute custom-format backup with strict umask 077
(umask 077 && docker compose -f docker-compose.staging.yml \
  --env-file /opt/agency-os/.env.staging \
  exec -T postgres \
  pg_dump -U postgres -d agency_os -F c -b > "/opt/agency-os/backups/db_$(date +%Y%m%d_%H%M%S).dump")

# Verify backup file size and permissions
ls -lh /opt/agency-os/backups/db_*.dump
```

### 9.2 Media Volume Backup Procedure
If utilizing local MinIO volume storage in staging:
```bash
# Dynamically query compose volume name
MINIO_VOLUME=$(docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging config --volumes | grep -i minio || docker volume ls --filter name=minio_data -q | head -n 1)

# Archive media data
(umask 077 && docker run --rm \
  -v "${MINIO_VOLUME}":/data \
  -v /opt/agency-os/backups:/backup \
  alpine tar -czf "/backup/minio_data_$(date +%Y%m%d_%H%M%S).tar.gz" -C /data .)

# Verify backup archive
ls -lh /opt/agency-os/backups/minio_data_*.tar.gz
```

*Note for Cloudflare R2:* If media is stored in Cloudflare R2, files reside in Cloudflare's distributed object store. Backup is managed via Cloudflare bucket replication, object versioning, or R2-to-R2 synchronization tools.

---

## 10. Isolated Database & Media Restore Rehearsal

> [!CAUTION]
> **DESTRUCTIVE RESTORE WARNING**
> Database restoration uses `pg_restore --clean --if-exists`, which **drops existing schema tables, types, and constraints before recreating them**.
> **NEVER** run restore rehearsals against active staging or production databases.
> Rehearsals **MUST** be performed against an isolated, temporary database or test volume.

### 10.1 Isolated Database Restore Rehearsal
Because the PostgreSQL container does not mount the host backup folder `/opt/agency-os/backups`, stream the backup file directly into `pg_restore` standard input (`exec -T`):

```bash
# 1. Identify target backup dump
DUMP_FILE="db_YYYYMMDD_HHMMSS.dump" # Replace with actual dump filename

# 2. Create an isolated temporary test database
docker compose -f docker-compose.staging.yml \
  --env-file /opt/agency-os/.env.staging \
  exec -T postgres \
  psql -U postgres -c "CREATE DATABASE agency_os_rehearsal_test;"

# 3. Stream backup into the isolated test database via standard input
cat "/opt/agency-os/backups/${DUMP_FILE}" | \
  docker compose -f docker-compose.staging.yml \
    --env-file /opt/agency-os/.env.staging \
    exec -T postgres \
    pg_restore -U postgres -d agency_os_rehearsal_test --clean --if-exists

# 4. Verify table creation and integrity in test database
docker compose -f docker-compose.staging.yml \
  --env-file /opt/agency-os/.env.staging \
  exec -T postgres \
  psql -U postgres -d agency_os_rehearsal_test -c "\dt"

# 5. Cleanup: Drop isolated test database
docker compose -f docker-compose.staging.yml \
  --env-file /opt/agency-os/.env.staging \
  exec -T postgres \
  psql -U postgres -c "DROP DATABASE agency_os_rehearsal_test;"
```

### 10.2 Isolated Media Volume Restore Rehearsal
To rehearse volume recovery without overwriting active staging data:
```bash
# 1. Create a temporary rehearsal volume
docker volume create minio_data_rehearsal_test

# 2. Extract backup tar into temporary rehearsal volume
MEDIA_BACKUP_FILE="minio_data_YYYYMMDD_HHMMSS.tar.gz" # Replace with actual file

docker run --rm \
  -v minio_data_rehearsal_test:/data \
  -v /opt/agency-os/backups:/backup \
  alpine sh -c "rm -rf /data/* && tar -xzf /backup/${MEDIA_BACKUP_FILE} -C /data"

# 3. Verify file contents in test volume
docker run --rm -v minio_data_rehearsal_test:/data alpine ls -la /data

# 4. Cleanup: Remove temporary rehearsal volume
docker volume rm minio_data_rehearsal_test
```

### 10.3 Migration Rollback Limitation
Prisma Migrate is **forward-only** (`prisma migrate deploy`); it does **not** support `prisma migrate down`.
- Before executing migrations on staging or production, creating a database dump is **mandatory**.
- If a migration fails or introduces data corruption, rollback requires restoring the pre-migration dump via the standard-input restore procedure or deploying an explicit forward-compensating migration.

---

## 11. Troubleshooting & Explicit Stop Conditions

### 11.1 Explicit Stop Conditions
The operator must abort deployment and halt running containers if any of the following occur:

1. **Docker Compose Tag Parsing Failure:**
   - *Symptom:* `unknown tag !reset` during `docker compose config` or `up`.
   - *Root Cause:* Docker Compose is older than `v2.24.4`.
   - *Action:* Upgrade Docker Compose plugin immediately.
2. **Wildcard Interface Exposure:**
   - *Symptom:* `docker compose ps` reports any port mapped to `0.0.0.0` or `:::`.
   - *Root Cause:* Ingress or backing services missing loopback or reset configuration.
   - *Action:* Stop containers (`docker compose down`). Verify `STAGING_BIND_IP=127.0.0.1` and `ports: !reset []`.
3. **Internal Backing Ports Reachable on Host Sockets:**
   - *Symptom:* `curl http://localhost:5432` or `curl http://localhost:3001` responds.
   - *Root Cause:* Containers started with standard `docker-compose.yml` instead of `docker-compose.staging.yml`.
   - *Action:* Stop immediately. Re-run strictly with `-f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging`.
4. **HTTPS Enforcement Failure (Authentication 400 Bad Request):**
   - *Symptom:* `POST /api/v1/auth/login` returns `400 Bad Request` with `HTTPS is required for authentication in production environments`.
   - *Root Cause:* Tunnel is stripping `X-Forwarded-Proto`, or `TRUST_PROXY` does not match the 2-hop topology.
   - *Action:* Verify Cloudflare Tunnel configuration. Do NOT enable `ALLOW_INSECURE_HTTP_AUTH=true`.
5. **Storage Public Endpoint Rejection:**
   - *Symptom:* API container crashes on boot with `Invalid OBJECT_STORAGE_PUBLIC_ENDPOINT: Internal Docker hostname "minio" cannot be resolved`.
   - *Root Cause:* `OBJECT_STORAGE_PUBLIC_ENDPOINT` set to `http://minio:9000`.
   - *Action:* Configure a public, browser-reachable HTTPS endpoint (e.g., Cloudflare R2).
6. **Failed Database Migration:**
   - *Symptom:* `migration` container exits with non-zero code.
   - *Root Cause:* Database connection failure or unresolvable schema drift.
   - *Action:* Do NOT launch `api` or `web`. Inspect logs: `docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging logs migration`.

### 11.2 Common Container Log Inspection Commands
```bash
# Tail ingress access and error logs
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging logs -f ingress

# Tail API application logs
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging logs -f api

# Tail worker background processing logs
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging logs -f worker

# Tail web frontend Next.js logs
docker compose -f docker-compose.staging.yml --env-file /opt/agency-os/.env.staging logs -f web
```

---

## 12. Final GO/NO-GO Checklist & Deployment Evidence Log

### 12.1 Release Gate Checklist
Every item in this checklist must be verified and marked **PASS** before transitioning staging status from **NO-GO** to **GO**:

| Gate # | Category | Verification Requirement | Verification Method | Status |
| :---: | :--- | :--- | :--- | :---: |
| **G1** | Environment | Docker Compose version is `>= v2.24.4` | `docker compose version` | [ ] |
| **G2** | Secrets | `/opt/agency-os/.env.staging` has permissions `600` | `ls -l /opt/agency-os/.env.staging` | [ ] |
| **G3** | Secrets | `TOKEN_ENCRYPTION_KEY` is valid 64-hex without development fallback | Section 3.3 validation script | [ ] |
| **G4** | Secrets | Secret validation passes without echoing values | Section 3.3 validation script | [ ] |
| **G5** | Compose | `docker compose config` succeeds quietly | Section 4 command | [ ] |
| **G6** | Network | Host firewall blocks all inbound traffic except SSH | `sudo ufw status verbose` | [ ] |
| **G7** | Network | Backing services publish zero host ports | Section 5.3 grep assertion | [ ] |
| **G8** | Network | Ingress binds strictly to loopback `127.0.0.1:80` | Section 5.3 grep assertion | [ ] |
| **G9** | Ingress | Cloudflare Tunnel is running and routes to `http://127.0.0.1:80` | `systemctl status cloudflared` | [ ] |
| **G10** | TLS | Cloudflare Edge SSL mode is Full/Strict | Cloudflare Dashboard inspection | [ ] |
| **G11** | Storage | Cloudflare R2 bucket provisioned and CORS policy applied | Cloudflare Dashboard inspection | [ ] |
| **G12** | Storage | Browser direct upload/retrieval verified in devtools | Section 7.3 end-to-end test | [ ] |
| **G13** | Database | Prisma migrations completed with exit status 0 | `docker compose ps migration` | [ ] |
| **G14** | Health | `/healthz` returns `healthy` | `curl https://staging.agency-os.com/healthz` | [ ] |
| **G15** | Health | `/api/health/ready` reports database and redis `up` | `curl https://staging.agency-os.com/api/health/ready` | [ ] |
| **G16** | Auth | Login probe returns 401 (valid TLS / HTTPS forwarded) | Section 6.3 curl probe | [ ] |
| **G17** | Disaster Recovery | Pre-deployment database dump created | Section 9.1 backup command | [ ] |
| **G18** | Disaster Recovery | Stdin-streaming restore rehearsed on isolated test DB | Section 10.1 rehearsal command | [ ] |

### 12.2 Deployment Evidence Log
*(To be completed by the staging operator on the VPS host upon deployment execution)*:

- **Deployment Date:** `____________________`
- **Deploying Operator:** `____________________`
- **Target Host FQDN/IP:** `____________________`
- **Git Commit SHA Deployed:** `____________________`
- **Docker Compose Version Verified:** `____________________`
- **Backup File Generated:** `____________________`
- **Restore Rehearsal Completion Timestamp:** `____________________`
- **Operator Signature:** `____________________`
- **Final Staging Verdict:** `[  ] GO     [  ] NO-GO`
