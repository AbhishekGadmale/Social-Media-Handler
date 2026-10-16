import { describe, it, expect } from 'vitest';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Express, Request, Response } from 'express';
import request from 'supertest';
import { parseTrustProxy, configureTrustProxy } from './trust-proxy';

describe('Trust Proxy Configuration', () => {
  describe('parseTrustProxy unit tests', () => {
    it('development with no TRUST_PROXY defaults to false (disabled)', () => {
      expect(parseTrustProxy(undefined, false)).toBe(false);
      expect(parseTrustProxy('', false)).toBe(false);
      expect(parseTrustProxy('   ', false)).toBe(false);
    });

    it('production with no TRUST_PROXY defaults to 1 (one hop)', () => {
      expect(parseTrustProxy(undefined, true)).toBe(1);
      expect(parseTrustProxy('', true)).toBe(1);
      expect(parseTrustProxy('   ', true)).toBe(1);
    });

    it('explicit numeric TRUST_PROXY is honored', () => {
      expect(parseTrustProxy('1', false)).toBe(1);
      expect(parseTrustProxy('2', false)).toBe(2);
      expect(parseTrustProxy('5', true)).toBe(5);
    });

    it('explicit boolean values are parsed', () => {
      expect(parseTrustProxy('true', false)).toBe(true);
      expect(parseTrustProxy('false', true)).toBe(false);
      expect(parseTrustProxy('0', true)).toBe(false);
    });

    it('malformed TRUST_PROXY fails fast', () => {
      expect(() => parseTrustProxy('invalid', false)).toThrow(
        /Invalid TRUST_PROXY configuration/,
      );
      expect(() => parseTrustProxy('-1', false)).toThrow(
        /Invalid TRUST_PROXY configuration/,
      );
      expect(() => parseTrustProxy('1.5', false)).toThrow(
        /Invalid TRUST_PROXY configuration/,
      );
      expect(() => parseTrustProxy('NaN', false)).toThrow(
        /Invalid TRUST_PROXY configuration/,
      );
      expect(() => parseTrustProxy('yes', false)).toThrow(
        /Invalid TRUST_PROXY configuration/,
      );
    });
  });

  describe('Express integration tests with real requests', () => {
    const createTestApp = (trustProxyEnv?: string, isProduction = false) => {
      const adapter = new ExpressAdapter();
      const app: Express = adapter.getInstance<Express>();
      configureTrustProxy(app, trustProxyEnv, isProduction);
      app.get('/test-proxy', (req: Request, res: Response) => {
        res.json({
          ip: req.ip,
          ips: req.ips,
          protocol: req.protocol,
          secure: req.secure,
        });
      });
      return app;
    };

    it('development with no TRUST_PROXY does not trust forwarded IP headers', async () => {
      const app = createTestApp(undefined, false);
      const res = await request(app)
        .get('/test-proxy')
        .set('X-Forwarded-For', '203.0.113.195')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);
      expect(res.body.ip).not.toBe('203.0.113.195');
      expect(res.body.protocol).toBe('http');
      expect(res.body.secure).toBe(false);
      expect(res.body.ips).toEqual([]);
    });

    it('forwarded client IP resolves correctly through one trusted hop in production default', async () => {
      const app = createTestApp(undefined, true);
      const res = await request(app)
        .get('/test-proxy')
        .set('X-Forwarded-For', '198.51.100.25')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);
      expect(res.body.ip).toBe('198.51.100.25');
      expect(res.body.protocol).toBe('https');
      expect(res.body.secure).toBe(true);
    });

    it('spoofed leftmost X-Forwarded-For does not become the trusted client IP when trusting 1 hop', async () => {
      const app = createTestApp('1', false);
      // Attacker spoofed 1.1.1.1, upstream proxy appended real client IP 203.0.113.50
      const res = await request(app)
        .get('/test-proxy')
        .set('X-Forwarded-For', '1.1.1.1, 203.0.113.50')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);
      expect(res.body.ip).toBe('203.0.113.50');
      expect(res.body.ip).not.toBe('1.1.1.1');
    });

    it('explicit numeric TRUST_PROXY=2 trusts two hops', async () => {
      const app = createTestApp('2', false);
      const res = await request(app)
        .get('/test-proxy')
        .set('X-Forwarded-For', '203.0.113.195, 198.51.100.17');

      expect(res.status).toBe(200);
      expect(res.body.ip).toBe('203.0.113.195');
    });

    it('X-Forwarded-Proto=https makes req.protocol resolve correctly when proxy trust is enabled', async () => {
      const app = createTestApp('1', false);
      const res = await request(app)
        .get('/test-proxy')
        .set('X-Forwarded-For', '198.51.100.25')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);
      expect(res.body.protocol).toBe('https');
      expect(res.body.secure).toBe(true);
    });

    it('3-entry spoof chain with trust=1 only trusts rightmost upstream-appended address', async () => {
      const app = createTestApp('1', false);
      const res = await request(app)
        .get('/test-proxy')
        .set('X-Forwarded-For', '1.1.1.1, 2.2.2.2, 203.0.113.50');

      expect(res.status).toBe(200);
      expect(res.body.ip).toBe('203.0.113.50');
      expect(res.body.ip).not.toBe('1.1.1.1');
      expect(res.body.ip).not.toBe('2.2.2.2');
    });

    it('pin dangerous TRUST_PROXY=true semantics (trusts leftmost attacker-controlled address)', async () => {
      const app = createTestApp('true', false);
      const res = await request(app)
        .get('/test-proxy')
        .set('X-Forwarded-For', '1.1.1.1, 203.0.113.50');

      expect(res.status).toBe(200);
      expect(res.body.ip).toBe('1.1.1.1');
    });
  });
});
