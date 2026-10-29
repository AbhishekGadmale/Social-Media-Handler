/**
 * Sanitizes URLs to remove sensitive credentials and tokens from query parameters
 * before paths are logged or recorded in telemetry.
 */
export const SENSITIVE_QUERY_PARAMS = [
  'code',
  'state',
  'session',
  'csrfToken',
  'csrf_token',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'clientSecret',
  'client_secret',
  'password',
  'secret',
];

export function sanitizeRequestUrl(urlStr: string): string {
  if (!urlStr) return '';
  try {
    const parsedUrl = new URL(urlStr, 'http://localhost');
    let modified = false;
    for (const param of SENSITIVE_QUERY_PARAMS) {
      if (parsedUrl.searchParams.has(param)) {
        parsedUrl.searchParams.set(param, '[REDACTED]');
        modified = true;
      }
    }
    if (!modified) {
      return urlStr;
    }
    const cleanSearch = parsedUrl.searchParams
      .toString()
      .replace(/%5BREDACTED%5D/g, '[REDACTED]');

    if (urlStr.startsWith('/') || urlStr.startsWith('?')) {
      return `${parsedUrl.pathname}?${cleanSearch}`;
    }
    return `${parsedUrl.origin}${parsedUrl.pathname}?${cleanSearch}`;
  } catch {
    // If URL parsing fails completely, strip all query parameters
    return urlStr.split('?')[0];
  }
}
