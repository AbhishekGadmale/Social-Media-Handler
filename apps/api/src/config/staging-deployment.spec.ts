import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('Phase 6: Staging/Deployment Hardening & Unified Ingress Configuration', () => {
  const rootDir = path.resolve(__dirname, '../../../../');
  const nginxConfPath = path.join(rootDir, 'docker/nginx/nginx.conf');
  const nginxDockerfilePath = path.join(rootDir, 'docker/nginx/Dockerfile');
  const stagingComposePath = path.join(rootDir, 'docker-compose.staging.yml');
  const baseComposePath = path.join(rootDir, 'docker-compose.yml');

  describe('NGINX Ingress Configuration (docker/nginx/nginx.conf)', () => {
    it('exists and is readable', () => {
      expect(fs.existsSync(nginxConfPath)).toBe(true);
      expect(fs.existsSync(nginxDockerfilePath)).toBe(true);
    });

    it('pins the unprivileged alpine base image with exact version (L1)', () => {
      const dockerfile = fs.readFileSync(nginxDockerfilePath, 'utf8');
      expect(dockerfile).toContain(
        'FROM nginxinc/nginx-unprivileged:1.31.7-alpine',
      );
    });

    it('runs as unprivileged non-root with writable temporary paths', () => {
      const conf = fs.readFileSync(nginxConfPath, 'utf8');

      expect(conf).toContain('pid /tmp/nginx.pid;');
      expect(conf).toContain('proxy_temp_path /tmp/proxy_temp;');
      expect(conf).toContain('client_body_temp_path /tmp/client_temp;');
      expect(conf).toContain('listen 8080;');
    });

    it('prevents OAuth credential leakage in access logs by omitting query strings (H1)', () => {
      const conf = fs.readFileSync(nginxConfPath, 'utf8');

      // Must log method, normalized URI path, and server protocol without query parameters
      expect(conf).toContain('"$request_method $uri $server_protocol"');

      // Must NOT log raw $request, $query_string, or $args which leak OAuth code/state/token parameters
      expect(conf).not.toContain('"$request"');
      expect(conf).not.toContain('$query_string');
      expect(conf).not.toContain('$args');
      expect(conf).not.toContain('$request_uri');
    });

    it('sets client_max_body_size to 512m matching verified application upload limit', () => {
      const conf = fs.readFileSync(nginxConfPath, 'utf8');

      // Verified MEDIA_MAX_UPLOAD_BYTES is 524288000 bytes (500MB).
      // 512m provides 500MB payload support plus 12MB headroom for multipart form boundary and header overhead.
      expect(conf).toMatch(/client_max_body_size\s+512m;/);
    });

    it('defines upstreams with keepalive connections for API and Web', () => {
      const conf = fs.readFileSync(nginxConfPath, 'utf8');

      expect(conf).toContain('upstream api_upstream {');
      expect(conf).toContain('server api:3001;');
      expect(conf).toContain('upstream web_upstream {');
      expect(conf).toContain('server web:3000;');
      expect(conf).toMatch(/keepalive\s+32;/);
    });

    it('configures WebSocket upgrade mapping that preserves HTTP/1.1 upstream keepalive (L2)', () => {
      const conf = fs.readFileSync(nginxConfPath, 'utf8');

      expect(conf).toContain('map $http_upgrade $connection_upgrade {');
      expect(conf).toContain('default upgrade;');
      // Must map empty $http_upgrade to empty string '', NOT 'close', preserving keepalive to web_upstream
      expect(conf).toContain("'' '';");
      expect(conf).not.toContain("'' close;");
    });

    it('configures trusted forwarded proto mapping for TLS termination (H2, L8)', () => {
      const conf = fs.readFileSync(nginxConfPath, 'utf8');

      expect(conf).toContain('map $http_x_forwarded_proto $forwarded_proto {');
      expect(conf).toContain('default $scheme;');
      expect(conf).toContain('https   https;');
    });

    it('routes /api to api_upstream preserving exact URI and forwarded headers (L3)', () => {
      const conf = fs.readFileSync(nginxConfPath, 'utf8');

      expect(conf).toContain('location /api {');
      // proxy_pass without URI preserves the request URI verbatim (does not strip /api prefix)
      expect(conf).toContain('proxy_pass http://api_upstream;');
      expect(conf).toContain('proxy_set_header Host $host;');
      expect(conf).toContain('proxy_set_header X-Real-IP $remote_addr;');
      expect(conf).toContain(
        'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      );
      expect(conf).toContain(
        'proxy_set_header X-Forwarded-Proto $forwarded_proto;',
      );
      expect(conf).toContain('proxy_set_header X-Forwarded-Host $host;');
      expect(conf).toContain('proxy_set_header Connection "";');
    });

    it('routes root and frontend requests to web_upstream with conditional WebSocket upgrade (L3)', () => {
      const conf = fs.readFileSync(nginxConfPath, 'utf8');

      expect(conf).toContain('location / {');
      expect(conf).toContain('proxy_pass http://web_upstream;');
      expect(conf).toContain('proxy_set_header Host $host;');
      expect(conf).toContain('proxy_set_header X-Real-IP $remote_addr;');
      expect(conf).toContain(
        'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      );
      expect(conf).toContain(
        'proxy_set_header X-Forwarded-Proto $forwarded_proto;',
      );
      expect(conf).toContain('proxy_set_header X-Forwarded-Host $host;');
      expect(conf).toContain('proxy_set_header Upgrade $http_upgrade;');
      expect(conf).toContain(
        'proxy_set_header Connection $connection_upgrade;',
      );
    });

    it('documents actual proxy timeouts: 60s connect, 120s send/read (L5)', () => {
      const conf = fs.readFileSync(nginxConfPath, 'utf8');

      expect(conf).toContain('proxy_connect_timeout 60s;');
      expect(conf).toContain('proxy_send_timeout 120s;');
      expect(conf).toContain('proxy_read_timeout 120s;');
    });

    it('exposes /healthz endpoint returning healthy\\n (L4)', () => {
      const conf = fs.readFileSync(nginxConfPath, 'utf8');

      expect(conf).toContain('location = /healthz {');
      expect(conf).toContain('return 200 "healthy\\n";');
    });

    it('includes essential security headers', () => {
      const conf = fs.readFileSync(nginxConfPath, 'utf8');

      expect(conf).toContain(
        'add_header X-Content-Type-Options "nosniff" always;',
      );
      expect(conf).toContain('add_header X-Frame-Options "SAMEORIGIN" always;');
    });

    it('passes nginx -t configuration test in container when docker and image are available', () => {
      try {
        // Check if docker daemon is accessible
        try {
          execSync('docker info', { stdio: 'ignore', timeout: 3000 });
        } catch {
          console.warn(
            'Docker daemon not accessible; skipped runtime nginx -t container test',
          );
          return;
        }

        // Check if image is available locally to avoid network pull latency/timeout during unit tests
        const imgCheck = execSync(
          'docker image ls -q nginxinc/nginx-unprivileged:1.31.7-alpine',
          { encoding: 'utf-8', timeout: 3000 },
        ).trim();

        if (!imgCheck) {
          console.warn(
            'nginxinc/nginx-unprivileged:1.31.7-alpine not locally cached; skipped runtime container test in unit test suite',
          );
          return;
        }

        // Run nginx -t inside container with mock hosts for upstream resolution (redirect stderr to stdout)
        const out = execSync(
          `docker run --rm --add-host api:127.0.0.1 --add-host web:127.0.0.1 -v "${nginxConfPath}":/etc/nginx/nginx.conf:ro nginxinc/nginx-unprivileged:1.31.7-alpine nginx -t 2>&1`,
          { encoding: 'utf-8', timeout: 15000 },
        );
        expect(out).toContain('syntax is ok');
        expect(out).toContain('test is successful');
      } catch (err: any) {
        // If docker daemon is unavailable in this test environment, skip runtime check gracefully
        const errMsg = err?.message || '';
        if (
          errMsg.includes('docker: command not found') ||
          errMsg.includes('Cannot connect to the Docker daemon') ||
          errMsg.includes('daemon is not running')
        ) {
          console.warn(
            'Docker daemon not accessible; skipped runtime nginx -t container test',
          );
          return;
        }
        // If docker was present but nginx -t failed, rethrow
        throw err;
      }
    }, 30000);
  });

  describe('Staging Docker Compose Configuration (docker-compose.staging.yml)', () => {
    it('exists and documents minimum Compose version v2.20.0 for !reset (L11)', () => {
      expect(fs.existsSync(stagingComposePath)).toBe(true);
      const stagingYaml = fs.readFileSync(stagingComposePath, 'utf8');
      expect(stagingYaml).toMatch(/Docker Compose v2\.20\.0 or higher/i);
    });

    it('resets host published ports for postgres, redis, minio, api, and web', () => {
      const stagingYaml = fs.readFileSync(stagingComposePath, 'utf8');

      // Verify that internal services reset their ports
      const servicesToCheck = ['postgres', 'redis', 'minio', 'api', 'web'];
      for (const service of servicesToCheck) {
        // Should contain "ports: !reset []" for each internal service
        const serviceBlockRegex = new RegExp(
          `${service}:[\\s\\S]*?ports:\\s*!reset\\s*\\[\\]`,
        );
        expect(stagingYaml).toMatch(serviceBlockRegex);
      }
    });

    it('publishes ports exclusively on the ingress service', () => {
      const stagingYaml = fs.readFileSync(stagingComposePath, 'utf8');

      expect(stagingYaml).toContain('ingress:');
      expect(stagingYaml).toMatch(
        /ingress:[\s\S]*?- "\$\{STAGING_PORT:-80\}:8080"/,
      );
    });

    it('does NOT require unused secrets SESSION_SECRET, JWT_SECRET, COOKIE_SECRET (M1)', () => {
      const stagingYaml = fs.readFileSync(stagingComposePath, 'utf8');

      // Confirmed unused by application/worker code; must NOT be required in staging compose
      expect(stagingYaml).not.toContain('SESSION_SECRET');
      expect(stagingYaml).not.toContain('JWT_SECRET');
      expect(stagingYaml).not.toContain('COOKIE_SECRET');
    });

    it('enforces genuinely required staging secrets with zero default development fallbacks (M1)', () => {
      const stagingYaml = fs.readFileSync(stagingComposePath, 'utf8');

      // Must require POSTGRES_PASSWORD without fallback
      expect(stagingYaml).toContain(
        '${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set for staging}',
      );

      // Must require TOKEN_ENCRYPTION_KEY without fallback
      expect(stagingYaml).toContain(
        '${TOKEN_ENCRYPTION_KEY:?TOKEN_ENCRYPTION_KEY must be set; generate one with openssl rand -hex 32}',
      );

      // Must require MinIO credentials without fallback
      expect(stagingYaml).toContain(
        '${OBJECT_STORAGE_ACCESS_KEY_ID:?OBJECT_STORAGE_ACCESS_KEY_ID must be set for staging}',
      );
      expect(stagingYaml).toContain(
        '${OBJECT_STORAGE_SECRET_ACCESS_KEY:?OBJECT_STORAGE_SECRET_ACCESS_KEY must be set for staging}',
      );

      // Must require FRONTEND_URL and API_PUBLIC_URL without fallback
      expect(stagingYaml).toContain(
        '${FRONTEND_URL:?FRONTEND_URL must be set for staging}',
      );
      expect(stagingYaml).toContain(
        '${API_PUBLIC_URL:?API_PUBLIC_URL must be set for staging}',
      );

      // Must require NEXT_PUBLIC_API_URL without fallback
      expect(stagingYaml).toContain(
        '${NEXT_PUBLIC_API_URL:?NEXT_PUBLIC_API_URL must be set for staging}',
      );

      // Must NOT contain insecure development fallbacks in staging compose
      expect(stagingYaml).not.toContain('development-secret-1234');
      expect(stagingYaml).not.toContain('00000000000000000000000000000000');
    });

    it('configures production NODE_ENV, TRUST_PROXY, and ALLOW_INSECURE_HTTP_AUTH override (H2)', () => {
      const stagingYaml = fs.readFileSync(stagingComposePath, 'utf8');

      // API environment
      expect(stagingYaml).toMatch(/api:[\s\S]*?NODE_ENV:\s*production/);
      expect(stagingYaml).toMatch(/api:[\s\S]*?TRUST_PROXY:\s*"1"/);
      expect(stagingYaml).toMatch(
        /api:[\s\S]*?ALLOW_INSECURE_HTTP_AUTH:\s*\$\{ALLOW_INSECURE_HTTP_AUTH:-false\}/,
      );

      // Worker environment
      expect(stagingYaml).toMatch(/worker:[\s\S]*?NODE_ENV:\s*production/);

      // Web environment
      expect(stagingYaml).toMatch(/web:[\s\S]*?NODE_ENV:\s*production/);
    });

    it('resolves compose config without unused secrets and only ingress publishing ports (M1)', () => {
      try {
        const testEnv = {
          ...process.env,
          POSTGRES_PASSWORD: 'test-staging-password',
          TOKEN_ENCRYPTION_KEY:
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          FRONTEND_URL: 'http://localhost:8080',
          API_PUBLIC_URL: 'http://localhost:8080',
          NEXT_PUBLIC_API_URL: 'http://localhost:8080/api/v1',
          OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
          OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
        };

        const resolvedYaml = execSync(
          'docker compose -f "' + stagingComposePath + '" config',
          { env: testEnv, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
        );

        // Find all published ports in resolved config
        const lines = resolvedYaml.split('\n');
        const publishedServices: string[] = [];
        let currentService = '';

        for (const line of lines) {
          const serviceMatch = line.match(/^ {2}([a-z0-9_-]+):$/);
          if (serviceMatch) {
            currentService = serviceMatch[1];
          }
          if (line.includes('published:') && currentService) {
            publishedServices.push(currentService);
          }
        }

        // Only ingress must appear in published services
        expect(publishedServices).toEqual(['ingress']);
      } catch (err: any) {
        if (err.message?.includes('docker: command not found')) {
          console.warn(
            'Docker CLI not accessible; skipped docker compose config test',
          );
          return;
        }
        throw err;
      }
    });

    it('fails fast when genuinely required staging secrets are missing (M1)', () => {
      try {
        // Clone process.env but explicitly strip genuinely required staging secrets
        const strippedEnv = { ...process.env };
        delete strippedEnv.POSTGRES_PASSWORD;
        delete strippedEnv.TOKEN_ENCRYPTION_KEY;
        delete strippedEnv.FRONTEND_URL;
        delete strippedEnv.API_PUBLIC_URL;
        delete strippedEnv.NEXT_PUBLIC_API_URL;
        delete strippedEnv.OBJECT_STORAGE_ACCESS_KEY_ID;
        delete strippedEnv.OBJECT_STORAGE_SECRET_ACCESS_KEY;

        execSync(`docker compose -f "${stagingComposePath}" config 2>&1`, {
          env: strippedEnv,
          encoding: 'utf-8',
        });
        // If it didn't throw, fail
        expect.unreachable(
          'Expected docker compose config to fail on missing secrets',
        );
      } catch (err: any) {
        const output = (
          err.stdout ||
          err.stderr ||
          err.message ||
          ''
        ).toString();
        expect(output).toMatch(/required variable .* is missing/i);
      }
    });

    it('preserves base docker-compose.yml for local development', () => {
      const baseYaml = fs.readFileSync(baseComposePath, 'utf8');

      // Base compose must still have development defaults and local host port bindings
      expect(baseYaml).toContain('3001:3001');
      expect(baseYaml).toContain('3000:3000');
      expect(baseYaml).toContain('5432:5432');
      expect(baseYaml).toContain('6379:6379');
    });
  });
});
