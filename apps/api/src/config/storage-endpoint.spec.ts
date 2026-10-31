import { describe, it, expect } from 'vitest';
import {
  parseStoragePublicEndpoint,
  validateStoragePublicEndpoint,
} from './storage-endpoint';

describe('Storage Public Endpoint Configuration (storage-endpoint.ts)', () => {
  describe('parseStoragePublicEndpoint in production', () => {
    const isProduction = true;

    it('accepts valid production HTTPS endpoints (e.g. Cloudflare R2, AWS S3)', () => {
      expect(
        parseStoragePublicEndpoint(
          'https://pub-abc123456789.r2.dev',
          isProduction,
        ),
      ).toBe('https://pub-abc123456789.r2.dev');

      expect(
        parseStoragePublicEndpoint(
          'https://0123456789abcdef.r2.cloudflarestorage.com',
          isProduction,
        ),
      ).toBe('https://0123456789abcdef.r2.cloudflarestorage.com');

      expect(
        parseStoragePublicEndpoint(
          'https://s3.us-east-1.amazonaws.com',
          isProduction,
        ),
      ).toBe('https://s3.us-east-1.amazonaws.com');
    });

    it('strips trailing slashes from the public endpoint', () => {
      expect(
        parseStoragePublicEndpoint(
          'https://pub-r2.agency-os.com///',
          isProduction,
        ),
      ).toBe('https://pub-r2.agency-os.com');
    });

    it('fails fast when OBJECT_STORAGE_PUBLIC_ENDPOINT is missing or empty in production', () => {
      expect(() => parseStoragePublicEndpoint(undefined, isProduction)).toThrow(
        /OBJECT_STORAGE_PUBLIC_ENDPOINT environment variable is required in production/i,
      );

      expect(() => parseStoragePublicEndpoint('', isProduction)).toThrow(
        /OBJECT_STORAGE_PUBLIC_ENDPOINT environment variable is required in production/i,
      );

      expect(() => parseStoragePublicEndpoint('   ', isProduction)).toThrow(
        /OBJECT_STORAGE_PUBLIC_ENDPOINT environment variable is required in production/i,
      );
    });

    it('strictly rejects the internal Docker hostname "minio" in production (B1)', () => {
      expect(() =>
        parseStoragePublicEndpoint('http://minio:9000', isProduction),
      ).toThrow(
        /Internal Docker hostname "minio" cannot be resolved by external client browsers/i,
      );

      expect(() =>
        parseStoragePublicEndpoint('https://minio:9000', isProduction),
      ).toThrow(
        /Internal Docker hostname "minio" cannot be resolved by external client browsers/i,
      );

      expect(() =>
        parseStoragePublicEndpoint('https://minio', isProduction),
      ).toThrow(
        /Internal Docker hostname "minio" cannot be resolved by external client browsers/i,
      );
    });

    it('rejects unencrypted HTTP for non-loopback domains in production', () => {
      expect(() =>
        parseStoragePublicEndpoint('http://storage.example.com', isProduction),
      ).toThrow(/production requires HTTPS except for loopback hosts/i);

      expect(() =>
        parseStoragePublicEndpoint(
          'http://r2.mycustomdomain.com',
          isProduction,
        ),
      ).toThrow(/production requires HTTPS except for loopback hosts/i);
    });

    it('permits loopback HTTP in production for local Compose smoke testing', () => {
      expect(
        parseStoragePublicEndpoint('http://localhost:9000', isProduction),
      ).toBe('http://localhost:9000');

      expect(
        parseStoragePublicEndpoint('http://127.0.0.1:9000', isProduction),
      ).toBe('http://127.0.0.1:9000');

      expect(
        parseStoragePublicEndpoint('http://[::1]:9000', isProduction),
      ).toBe('http://[::1]:9000');
    });

    it('rejects URLs containing username or password credentials', () => {
      expect(() =>
        parseStoragePublicEndpoint(
          'https://user:pass@pub-r2.agency-os.com',
          isProduction,
        ),
      ).toThrow(/must not contain username or password credentials/i);
    });

    it('rejects URLs containing query parameters or hash fragments', () => {
      expect(() =>
        parseStoragePublicEndpoint(
          'https://pub-r2.agency-os.com?key=value',
          isProduction,
        ),
      ).toThrow(/must not contain query parameters/i);

      expect(() =>
        parseStoragePublicEndpoint(
          'https://pub-r2.agency-os.com#section',
          isProduction,
        ),
      ).toThrow(/must not contain a hash fragment/i);
    });

    it('rejects invalid URL strings', () => {
      expect(() =>
        parseStoragePublicEndpoint('not-a-valid-url', isProduction),
      ).toThrow(/is not a valid URL/i);
    });
  });

  describe('parseStoragePublicEndpoint in non-production', () => {
    const isProduction = false;

    it('falls back to http://localhost:9000 when unset or empty', () => {
      expect(parseStoragePublicEndpoint(undefined, isProduction)).toBe(
        'http://localhost:9000',
      );
      expect(parseStoragePublicEndpoint('', isProduction)).toBe(
        'http://localhost:9000',
      );
    });

    it('accepts custom HTTP and HTTPS endpoints in development', () => {
      expect(
        parseStoragePublicEndpoint('http://localhost:9001', isProduction),
      ).toBe('http://localhost:9001');

      expect(
        parseStoragePublicEndpoint('https://dev-tunnel.ngrok.io', isProduction),
      ).toBe('https://dev-tunnel.ngrok.io');
    });
  });

  describe('validateStoragePublicEndpoint defaults', () => {
    it('uses process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT by default', () => {
      const origEnv = process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT;
      const origNodeEnv = process.env.NODE_ENV;

      try {
        process.env.NODE_ENV = 'production';
        process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT =
          'https://pub-r2.agency-os.com';
        expect(validateStoragePublicEndpoint()).toBe(
          'https://pub-r2.agency-os.com',
        );
      } finally {
        process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT = origEnv;
        process.env.NODE_ENV = origNodeEnv;
      }
    });
  });
});
