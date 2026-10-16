import { describe, it, expect } from 'vitest';
import { parseApiPublicUrl, getPublicApiUrl } from './public-url';

describe('Public API URL Configuration', () => {
  describe('parseApiPublicUrl', () => {
    it('validates and normalizes valid production URL', () => {
      expect(parseApiPublicUrl('https://api.agency-os.com', true)).toBe(
        'https://api.agency-os.com',
      );
    });

    it('normalizes trailing slashes without leaving double slashes', () => {
      expect(parseApiPublicUrl('https://api.agency-os.com/', true)).toBe(
        'https://api.agency-os.com',
      );
      expect(parseApiPublicUrl('https://api.agency-os.com///', true)).toBe(
        'https://api.agency-os.com',
      );
      expect(
        parseApiPublicUrl('https://api.agency-os.com/subpath///', true),
      ).toBe('https://api.agency-os.com/subpath');
    });

    it('fails fast when API_PUBLIC_URL is missing or empty in production', () => {
      expect(() => parseApiPublicUrl(undefined, true)).toThrow(
        'API_PUBLIC_URL environment variable is required in production.',
      );
      expect(() => parseApiPublicUrl('', true)).toThrow(
        'API_PUBLIC_URL environment variable is required in production.',
      );
      expect(() => parseApiPublicUrl('   ', true)).toThrow(
        'API_PUBLIC_URL environment variable is required in production.',
      );
    });

    it('rejects insecure http in production', () => {
      expect(() => parseApiPublicUrl('http://api.example.com', true)).toThrow(
        'Invalid API_PUBLIC_URL: production requires https://, got "http:".',
      );
    });

    it('rejects non-http(s) schemes', () => {
      expect(() => parseApiPublicUrl('ftp://api.example.com', false)).toThrow(
        'Invalid API_PUBLIC_URL: scheme must be http: or https:, got "ftp:".',
      );
      expect(() => parseApiPublicUrl('file:///etc/passwd', false)).toThrow(
        'Invalid API_PUBLIC_URL: scheme must be http: or https:, got "file:".',
      );
    });

    it('rejects URLs with query strings', () => {
      expect(() =>
        parseApiPublicUrl('https://api.example.com?x=1', false),
      ).toThrow(
        'Invalid API_PUBLIC_URL: URL must not contain query parameters.',
      );
    });

    it('rejects URLs with hash fragments', () => {
      expect(() =>
        parseApiPublicUrl('https://api.example.com#section', false),
      ).toThrow(
        'Invalid API_PUBLIC_URL: URL must not contain a hash fragment.',
      );
    });

    it('rejects URLs with embedded credentials', () => {
      expect(() =>
        parseApiPublicUrl('https://user:pass@api.example.com', false),
      ).toThrow(
        'Invalid API_PUBLIC_URL: URL must not contain username or password credentials.',
      );
    });

    it('rejects malformed URLs', () => {
      expect(() => parseApiPublicUrl('not-a-url', false)).toThrow(
        'Invalid API_PUBLIC_URL: "not-a-url" is not a valid URL.',
      );
      expect(() => parseApiPublicUrl('://missing-scheme', false)).toThrow(
        'Invalid API_PUBLIC_URL: "://missing-scheme" is not a valid URL.',
      );
    });

    it('falls back to local port in development when API_PUBLIC_URL is unset', () => {
      expect(parseApiPublicUrl(undefined, false, 3001)).toBe(
        'http://localhost:3001',
      );
      expect(parseApiPublicUrl('', false, '4000')).toBe(
        'http://localhost:4000',
      );
      expect(parseApiPublicUrl('   ', false, 3001)).toBe(
        'http://localhost:3001',
      );
    });

    it('allows http://localhost and custom hosts in development', () => {
      expect(parseApiPublicUrl('http://localhost:3001', false)).toBe(
        'http://localhost:3001',
      );
      expect(parseApiPublicUrl('http://127.0.0.1:8080/', false)).toBe(
        'http://127.0.0.1:8080',
      );
      expect(parseApiPublicUrl('https://tunnel.ngrok.io///', false)).toBe(
        'https://tunnel.ngrok.io',
      );
    });
  });

  describe('getPublicApiUrl', () => {
    it('uses process.env.API_PUBLIC_URL when set', () => {
      const result = getPublicApiUrl('https://api.agency-os.com', true, 3001);
      expect(result).toBe('https://api.agency-os.com');
    });

    it('uses default fallback port when env is unset in development', () => {
      const result = getPublicApiUrl(undefined, false, 3001);
      expect(result).toBe('http://localhost:3001');
    });
  });
});
