import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  MockEmailDeliveryService,
  NoopEmailDeliveryService,
  ResendEmailDeliveryService,
} from './email-delivery.service';

describe('EmailDeliveryService (Safety & Environment Controls)', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalEmailFrom = process.env.EMAIL_FROM;
  const originalFrontendUrl = process.env.FRONTEND_URL;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalResendKey !== undefined) {
      process.env.RESEND_API_KEY = originalResendKey;
    } else {
      delete process.env.RESEND_API_KEY;
    }
    if (originalEmailFrom !== undefined) {
      process.env.EMAIL_FROM = originalEmailFrom;
    } else {
      delete process.env.EMAIL_FROM;
    }
    if (originalFrontendUrl !== undefined) {
      process.env.FRONTEND_URL = originalFrontendUrl;
    } else {
      delete process.env.FRONTEND_URL;
    }
    vi.restoreAllMocks();
  });

  describe('MockEmailDeliveryService', () => {
    it('Scenario 15: throws an error immediately if invoked in production environment', async () => {
      process.env.NODE_ENV = 'production';
      const service = new MockEmailDeliveryService();

      await expect(
        service.sendVerificationEmail(
          'victim@example.com',
          'raw-secret-token-32-bytes',
        ),
      ).rejects.toThrow(
        'MockEmailDeliveryService must NEVER be used in production.',
      );

      expect(service.sentEmails).toHaveLength(0);
    });

    it('records simulated email in memory during test/development', async () => {
      process.env.NODE_ENV = 'test';
      const service = new MockEmailDeliveryService();

      await service.sendVerificationEmail('test@example.com', 'raw-test-token');

      expect(service.sentEmails).toHaveLength(1);
      expect(service.sentEmails[0]).toEqual({
        toEmail: 'test@example.com',
        rawToken: 'raw-test-token',
      });
    });
  });

  describe('NoopEmailDeliveryService', () => {
    it('executes safely without side effects in any environment', async () => {
      process.env.NODE_ENV = 'production';
      const service = new NoopEmailDeliveryService();

      await expect(
        service.sendVerificationEmail('prod@example.com', 'raw-token'),
      ).resolves.toBeUndefined();
    });
  });

  describe('ResendEmailDeliveryService', () => {
    it('throws an error if RESEND_API_KEY is not configured', async () => {
      delete process.env.RESEND_API_KEY;
      const service = new ResendEmailDeliveryService();

      await expect(
        service.sendVerificationEmail('user@example.com', 'raw-token-123'),
      ).rejects.toThrow('Resend API key is not configured');
    });

    it('successfully sends email via Resend API', async () => {
      process.env.RESEND_API_KEY = 'mock-resend-api-key-test';
      process.env.EMAIL_FROM = 'Test App <auth@example.com>';
      process.env.FRONTEND_URL = 'https://app.example.com';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'email-resend-id' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ResendEmailDeliveryService();
      await service.sendVerificationEmail(
        'alice@example.com',
        'raw-test-token-value',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.resend.com/emails');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        Authorization: 'Bearer mock-resend-api-key-test',
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(options.body);
      expect(body.from).toBe('Test App <auth@example.com>');
      expect(body.to).toEqual(['alice@example.com']);
      expect(body.subject).toBe('Verify your Agency OS account');
      expect(body.html).toContain(
        'https://app.example.com/verify-email?token=raw-test-token-value',
      );
      expect(body.text).toContain(
        'https://app.example.com/verify-email?token=raw-test-token-value',
      );
    });

    it('throws an error when Resend API returns non-2xx', async () => {
      process.env.RESEND_API_KEY = 'mock-resend-api-key-test';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Domain not verified',
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ResendEmailDeliveryService();
      await expect(
        service.sendVerificationEmail('bob@example.com', 'raw-token'),
      ).rejects.toThrow('Failed to send verification email via Resend (403)');
    });
  });
});
