import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'crypto';
import { RazorpayService } from './razorpay.service';

describe('RazorpayService', () => {
  let service: RazorpayService;
  const mockWebhookSecret = 'test_webhook_secret_key_12345';
  const mockKeyId = 'rzp_test_mockKeyId';
  const mockKeySecret = 'mockSecret123';

  beforeEach(() => {
    service = new RazorpayService({
      keyId: mockKeyId,
      keySecret: mockKeySecret,
      webhookSecret: mockWebhookSecret,
    });
  });

  describe('Webhook Signature Verification', () => {
    const rawPayload = JSON.stringify({
      entity: 'event',
      event: 'subscription.charged',
      payload: { subscription: { entity: { id: 'sub_123' } } },
    });

    it('verifies a valid HMAC-SHA256 signature against raw body payload', () => {
      const validSignature = crypto
        .createHmac('sha256', mockWebhookSecret)
        .update(rawPayload)
        .digest('hex');

      const isValid = service.verifyWebhookSignature(
        rawPayload,
        validSignature,
      );
      expect(isValid).toBe(true);
    });

    it('verifies a valid signature when raw body is provided as Buffer', () => {
      const bodyBuffer = Buffer.from(rawPayload, 'utf8');
      const validSignature = crypto
        .createHmac('sha256', mockWebhookSecret)
        .update(bodyBuffer)
        .digest('hex');

      const isValid = service.verifyWebhookSignature(
        bodyBuffer,
        validSignature,
      );
      expect(isValid).toBe(true);
    });

    it('rejects an invalid/tampered signature', () => {
      const tamperedSignature = crypto
        .createHmac('sha256', 'wrong_secret')
        .update(rawPayload)
        .digest('hex');

      const isValid = service.verifyWebhookSignature(
        rawPayload,
        tamperedSignature,
      );
      expect(isValid).toBe(false);
    });

    it('rejects a signature when payload has been tampered with', () => {
      const validSignature = crypto
        .createHmac('sha256', mockWebhookSecret)
        .update(rawPayload)
        .digest('hex');

      const tamperedPayload = rawPayload + ' ';
      const isValid = service.verifyWebhookSignature(
        tamperedPayload,
        validSignature,
      );
      expect(isValid).toBe(false);
    });

    it('rejects when signature is empty or undefined', () => {
      expect(service.verifyWebhookSignature(rawPayload, '')).toBe(false);
      expect(service.verifyWebhookSignature(rawPayload, undefined as any)).toBe(
        false,
      );
    });

    it('rejects when signature length does not match expected SHA-256 hex digest length', () => {
      expect(service.verifyWebhookSignature(rawPayload, 'short_sig')).toBe(
        false,
      );
    });
  });

  describe('Credentials Security', () => {
    it('does not expose raw secret in string representations or object inspect', () => {
      const str = service.toString();
      expect(str).not.toContain(mockKeySecret);
      expect(str).not.toContain(mockWebhookSecret);
    });
  });

  describe('Plan and Subscription API wrappers', () => {
    it('calls client.plans.create with correct parameters', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 'plan_123' });
      (service as any).client.plans = { create: mockCreate };

      const result = await service.createPlan({
        period: 'monthly',
        interval: 1,
        item: {
          name: 'Studio',
          amount: 99900,
          currency: 'INR',
        },
      });

      expect(mockCreate).toHaveBeenCalledWith({
        period: 'monthly',
        interval: 1,
        item: {
          name: 'Studio',
          amount: 99900,
          currency: 'INR',
        },
        notes: undefined,
      });
      expect(result.id).toBe('plan_123');
    });

    it('calls client.subscriptions.create with correct parameters', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 'sub_rzp_456' });
      (service as any).client.subscriptions = { create: mockCreate };

      const result = await service.createSubscription({
        planId: 'plan_123',
        totalCount: 120,
      });

      expect(mockCreate).toHaveBeenCalledWith({
        plan_id: 'plan_123',
        total_count: 120,
        quantity: 1,
        customer_notify: 1,
        notes: {},
      });
      expect(result.id).toBe('sub_rzp_456');
    });
  });
});
