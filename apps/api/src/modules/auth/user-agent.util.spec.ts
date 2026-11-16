import { describe, it, expect } from 'vitest';
import { parseUserAgent } from './user-agent.util';

describe('user-agent.util - parseUserAgent', () => {
  it('returns Unknown for undefined, null, or empty string', () => {
    expect(parseUserAgent()).toEqual({
      browser: 'Unknown browser',
      os: 'Unknown OS',
    });
    expect(parseUserAgent(null)).toEqual({
      browser: 'Unknown browser',
      os: 'Unknown OS',
    });
    expect(parseUserAgent('')).toEqual({
      browser: 'Unknown browser',
      os: 'Unknown OS',
    });
    expect(parseUserAgent('   ')).toEqual({
      browser: 'Unknown browser',
      os: 'Unknown OS',
    });
  });

  it('detects Google Chrome on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(parseUserAgent(ua)).toEqual({
      browser: 'Google Chrome',
      os: 'Windows',
    });
  });

  it('detects Microsoft Edge on Windows (order priority over Chrome)', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    expect(parseUserAgent(ua)).toEqual({
      browser: 'Microsoft Edge',
      os: 'Windows',
    });
  });

  it('detects Safari on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15';
    expect(parseUserAgent(ua)).toEqual({
      browser: 'Safari',
      os: 'macOS',
    });
  });

  it('detects Google Chrome on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(parseUserAgent(ua)).toEqual({
      browser: 'Google Chrome',
      os: 'macOS',
    });
  });

  it('detects Safari on iOS / iPhone (order priority over macOS)', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1';
    expect(parseUserAgent(ua)).toEqual({
      browser: 'Safari',
      os: 'iOS',
    });
  });

  it('detects Google Chrome on Android (order priority over Linux)', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36';
    expect(parseUserAgent(ua)).toEqual({
      browser: 'Google Chrome',
      os: 'Android',
    });
  });

  it('detects Firefox on Linux', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';
    expect(parseUserAgent(ua)).toEqual({
      browser: 'Firefox',
      os: 'Linux',
    });
  });

  it('detects Samsung Internet on Android (order priority over Chrome)', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36';
    expect(parseUserAgent(ua)).toEqual({
      browser: 'Samsung Internet',
      os: 'Android',
    });
  });

  it('detects Opera on Windows (order priority over Chrome)', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0';
    expect(parseUserAgent(ua)).toEqual({
      browser: 'Opera',
      os: 'Windows',
    });
  });

  it('falls back to Unknown for unrecognized user-agent', () => {
    expect(parseUserAgent('curl/7.88.1')).toEqual({
      browser: 'Unknown browser',
      os: 'Unknown OS',
    });
  });
});
