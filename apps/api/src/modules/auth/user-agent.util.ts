export interface ParsedUserAgent {
  browser: string;
  os: string;
}

/**
 * Dependency-free parser extracting high-level browser and OS from a User-Agent string.
 * Uses ordered substring checks to avoid misleading tokens (e.g. Edge containing Chrome/Safari,
 * Android containing Linux, iOS containing Mac OS X).
 */
export function parseUserAgent(userAgent?: string | null): ParsedUserAgent {
  if (!userAgent || !userAgent.trim()) {
    return { browser: 'Unknown browser', os: 'Unknown OS' };
  }

  const ua = userAgent;

  // Browser detection (order matters)
  let browser = 'Unknown browser';
  if (ua.includes('Edg/')) {
    browser = 'Microsoft Edge';
  } else if (ua.includes('SamsungBrowser/')) {
    browser = 'Samsung Internet';
  } else if (ua.includes('OPR/') || ua.includes('Opera')) {
    browser = 'Opera';
  } else if (ua.includes('Chrome/') || ua.includes('CriOS')) {
    browser = 'Google Chrome';
  } else if (ua.includes('Firefox/') || ua.includes('FxiOS')) {
    browser = 'Firefox';
  } else if (ua.includes('Safari/')) {
    browser = 'Safari';
  }

  // OS detection (order matters: iOS before macOS, Android before Linux)
  let os = 'Unknown OS';
  if (ua.includes('Windows NT')) {
    os = 'Windows';
  } else if (
    ua.includes('iPhone') ||
    ua.includes('iPad') ||
    ua.includes('CPU OS') ||
    ua.includes('CPU iPhone OS')
  ) {
    os = 'iOS';
  } else if (ua.includes('Android')) {
    os = 'Android';
  } else if (ua.includes('Mac OS X') || ua.includes('Macintosh')) {
    os = 'macOS';
  } else if (ua.includes('Linux')) {
    os = 'Linux';
  }

  return { browser, os };
}
