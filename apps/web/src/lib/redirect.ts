/**
 * Validates that a redirect URL is a safe internal application path.
 *
 * Requirements:
 * - Must be an internal application path starting with '/'
 * - Must NOT start with '//' (protocol-relative URL)
 * - Must NOT start with '/\' (slash-backslash bypass)
 * - Must NOT contain backslashes
 * - Must NOT contain an external scheme (e.g. http:, https:, javascript:, data:)
 * - Preserves query strings and fragments on valid internal paths
 */
export function getValidRedirect(redirect: string | null | undefined): string | null {
  if (!redirect || typeof redirect !== 'string') {
    return null;
  }

  // Reject control characters (CRLF, null bytes, tabs, etc.)
  if (/[\x00-\x1F\x7F]/.test(redirect)) {
    return null;
  }

  // Must start with '/' and NOT '//' or '/\'
  if (!redirect.startsWith('/') || redirect.startsWith('//') || redirect.startsWith('/\\')) {
    return null;
  }

  // Reject backslashes to prevent parser confusion across browsers
  if (redirect.includes('\\')) {
    return null;
  }

  // Extract ONLY the path portion (substring before first '?' or '#')
  const pathPortion = redirect.split(/[?#]/)[0];

  // Decode path portion once, failing closed on invalid percent-encoding
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathPortion);
  } catch {
    return null;
  }

  // Reject encoded protocol-relative or backslash bypasses in the decoded path
  if (
    decodedPath.startsWith('//') ||
    decodedPath.startsWith('/\\') ||
    decodedPath.includes('\\')
  ) {
    return null;
  }

  // Validate using the WHATWG URL parser against a dummy local base
  try {
    const parsed = new URL(redirect, 'http://localhost');
    // Ensure origin and protocol remain local
    if (parsed.origin !== 'http://localhost' || parsed.protocol !== 'http:') {
      return null;
    }
    // Ensure the parsed pathname is still an internal path and not protocol-relative
    if (!parsed.pathname.startsWith('/') || parsed.pathname.startsWith('//')) {
      return null;
    }
  } catch {
    return null;
  }

  return redirect;
}

export function isValidRedirect(redirect: string | null | undefined): redirect is string {
  return getValidRedirect(redirect) !== null;
}
