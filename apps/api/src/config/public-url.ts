/**
 * Validates and normalizes the API_PUBLIC_URL configuration for public API base URL derivation
 * (e.g. OAuth callback URLs, external integrations).
 *
 * Supported behavior:
 * - Production (NODE_ENV === 'production'):
 *     - API_PUBLIC_URL is REQUIRED. Missing or empty string throws a fail-fast Error.
 *     - Protocol must be HTTPS (https://), except for loopback hosts (localhost, 127.0.0.1, [::1])
 *       to support production-like local Docker Compose environments.
 *     - Must be a valid WHATWG URL.
 *     - Must not contain query parameters, hash fragments, or embedded credentials.
 *     - Trailing slashes are stripped/normalized.
 * - Non-production (development, test):
 *     - API_PUBLIC_URL is OPTIONAL.
 *     - If absent or empty, falls back to `http://localhost:${port}` (defaults to port 3001).
 *     - If provided, validated and normalized (http:// and https:// both allowed).
 */
export function parseApiPublicUrl(
  apiUrlEnv: string | undefined,
  isProduction: boolean = process.env.NODE_ENV === 'production',
  port: string | number = process.env.PORT || 3001,
): string {
  if (apiUrlEnv === undefined || apiUrlEnv.trim() === '') {
    if (isProduction) {
      throw new Error(
        'API_PUBLIC_URL environment variable is required in production.',
      );
    }
    return `http://localhost:${port}`;
  }

  const trimmed = apiUrlEnv.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Invalid API_PUBLIC_URL: "${apiUrlEnv}" is not a valid URL.`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid API_PUBLIC_URL: scheme must be http: or https:, got "${parsed.protocol}".`,
    );
  }

  const isLoopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]';

  if (isProduction && parsed.protocol !== 'https:' && !isLoopback) {
    throw new Error(
      `Invalid API_PUBLIC_URL: production requires HTTPS except for loopback hosts (localhost, 127.0.0.1, [::1]), got "${parsed.protocol}".`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      'Invalid API_PUBLIC_URL: URL must not contain username or password credentials.',
    );
  }

  if (parsed.search) {
    throw new Error(
      'Invalid API_PUBLIC_URL: URL must not contain query parameters.',
    );
  }

  if (parsed.hash) {
    throw new Error(
      'Invalid API_PUBLIC_URL: URL must not contain a hash fragment.',
    );
  }

  const pathname =
    parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
}

/**
 * Returns the validated and normalized public API base URL.
 */
export function getPublicApiUrl(
  apiUrlEnv: string | undefined = process.env.API_PUBLIC_URL,
  isProduction: boolean = process.env.NODE_ENV === 'production',
  port: string | number = process.env.PORT || 3001,
): string {
  return parseApiPublicUrl(apiUrlEnv, isProduction, port);
}
