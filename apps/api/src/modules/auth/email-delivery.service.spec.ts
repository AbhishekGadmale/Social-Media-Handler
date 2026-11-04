import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MockEmailDeliveryService,
  NoopEmailDeliveryService,
} from './email-delivery.service';

describe('EmailDeliveryService (Safety & Environment Controls)', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
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
});
