/**
 * Validates and normalizes the OBJECT_STORAGE_PUBLIC_ENDPOINT configuration for browser-accessible
 * presigned media upload and download URLs.
 *
 * Supported behavior:
 * - Production (NODE_ENV === 'production'):
 *     - OBJECT_STORAGE_PUBLIC_ENDPOINT is REQUIRED. Missing or empty string throws a fail-fast Error.
 *     - Hostname MUST NOT be the internal Docker service name (e.g. "minio" or "minio:9000") because
 *       internal container DNS names cannot be resolved by external client browsers.
 *     - Protocol must be HTTPS (https://), except for local loopback hosts (localhost, 127.0.0.1, [::1])
 *       to support local production-like Docker Compose smoke test environments.
 *     - Must be a valid WHATWG URL.
 *     - Must not contain query parameters, hash fragments, or embedded credentials.
 *     - Trailing slashes are stripped/normalized.
 * - Non-production (development, test):
 *     - OBJECT_STORAGE_PUBLIC_ENDPOINT is OPTIONAL.
 *     - If absent or empty, falls back to `http://localhost:9000`.
 *     - If provided, validated and normalized (http:// and https:// both allowed).
 */
export function parseStoragePublicEndpoint(
  endpointEnv: string | undefined,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): string {
  if (endpointEnv === undefined || endpointEnv.trim() === '') {
    if (isProduction) {
      throw new Error(
        'OBJECT_STORAGE_PUBLIC_ENDPOINT environment variable is required in production. Must be a browser-reachable URL (e.g. Cloudflare R2 or AWS S3 public endpoint).',
      );
    }
    return 'http://localhost:9000';
  }

  const trimmed = endpointEnv.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Invalid OBJECT_STORAGE_PUBLIC_ENDPOINT: "${endpointEnv}" is not a valid URL.`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid OBJECT_STORAGE_PUBLIC_ENDPOINT: scheme must be http: or https:, got "${parsed.protocol}".`,
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  // Internal Docker hostnames are not reachable by external client browsers
  if (hostname === 'minio') {
    throw new Error(
      `Invalid OBJECT_STORAGE_PUBLIC_ENDPOINT: "${endpointEnv}". Internal Docker hostname "minio" cannot be resolved by external client browsers. Configure a public browser-reachable endpoint (e.g. Cloudflare R2 or AWS S3).`,
    );
  }

  const isLoopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]';

  if (isProduction && parsed.protocol !== 'https:' && !isLoopback) {
    throw new Error(
      `Invalid OBJECT_STORAGE_PUBLIC_ENDPOINT: production requires HTTPS except for loopback hosts (localhost, 127.0.0.1, [::1]), got "${parsed.protocol}".`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      'Invalid OBJECT_STORAGE_PUBLIC_ENDPOINT: URL must not contain username or password credentials.',
    );
  }

  if (parsed.search) {
    throw new Error(
      'Invalid OBJECT_STORAGE_PUBLIC_ENDPOINT: URL must not contain query parameters.',
    );
  }

  if (parsed.hash) {
    throw new Error(
      'Invalid OBJECT_STORAGE_PUBLIC_ENDPOINT: URL must not contain a hash fragment.',
    );
  }

  const pathname =
    parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
}

/**
 * Returns the validated and normalized public storage endpoint.
 */
export function validateStoragePublicEndpoint(
  endpointEnv: string | undefined = process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): string {
  return parseStoragePublicEndpoint(endpointEnv, isProduction);
}
