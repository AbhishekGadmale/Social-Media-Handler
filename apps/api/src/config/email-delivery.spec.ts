import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateEmailDeliveryConfig } from './email-delivery';

describe('Email Delivery Startup Configuration (email-delivery.ts)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateEmailDeliveryConfig in production', () => {
    const isProduction = true;

    it('throws fail-fast error when RESEND_API_KEY is missing (undefined)', () => {
      expect(() =>
        validateEmailDeliveryConfig(undefined, isProduction),
      ).toThrow(
        /RESEND_API_KEY environment variable is required in production/i,
      );
    });

    it('throws fail-fast error when RESEND_API_KEY is an empty string', () => {
      expect(() => validateEmailDeliveryConfig('', isProduction)).toThrow(
        /RESEND_API_KEY environment variable is required in production/i,
      );
    });

    it('throws fail-fast error when RESEND_API_KEY is whitespace-only', () => {
      expect(() =>
        validateEmailDeliveryConfig('   \t\n  ', isProduction),
      ).toThrow(
        /RESEND_API_KEY environment variable is required in production/i,
      );
    });

    it('verifies the error message explicitly identifies the variable, the lockout consequence, and the fix', () => {
      try {
        validateEmailDeliveryConfig(undefined, isProduction);
        expect.unreachable('Should have thrown an Error');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        const message = (err as Error).message;
        // 1. Names the variable
        expect(message).toContain('RESEND_API_KEY');
        // 2. Names the consequence
        expect(message).toContain('Verification emails cannot be delivered');
        expect(message).toContain('locked out by 403 email verification gates');
        // 3. Names the fix
        expect(message).toContain('Set RESEND_API_KEY');
      }
    });

    it('passes and returns trimmed key when RESEND_API_KEY is present', () => {
      expect(
        validateEmailDeliveryConfig('re_live_abcdef123456789', isProduction),
      ).toBe('re_live_abcdef123456789');

      expect(
        validateEmailDeliveryConfig('  re_live_padded_key_999  ', isProduction),
      ).toBe('re_live_padded_key_999');
    });
  });

  describe('validateEmailDeliveryConfig in non-production (development, test)', () => {
    const isProduction = false;

    it('passes without throwing when RESEND_API_KEY is missing (undefined)', () => {
      expect(() =>
        validateEmailDeliveryConfig(undefined, isProduction),
      ).not.toThrow();
      expect(
        validateEmailDeliveryConfig(undefined, isProduction),
      ).toBeUndefined();
    });

    it('passes without throwing when RESEND_API_KEY is empty or whitespace', () => {
      expect(() => validateEmailDeliveryConfig('', isProduction)).not.toThrow();
      expect(() =>
        validateEmailDeliveryConfig('   ', isProduction),
      ).not.toThrow();
    });

    it('passes and returns trimmed key when RESEND_API_KEY is present', () => {
      expect(validateEmailDeliveryConfig('re_dev_key_123', isProduction)).toBe(
        're_dev_key_123',
      );

      expect(
        validateEmailDeliveryConfig('  re_dev_padded_key  ', isProduction),
      ).toBe('re_dev_padded_key');
    });
  });

  describe('validateEmailDeliveryConfig environment variable defaults', () => {
    it('uses process.env.RESEND_API_KEY and process.env.NODE_ENV when parameters are omitted', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.RESEND_API_KEY;

      expect(() => validateEmailDeliveryConfig()).toThrow(
        /RESEND_API_KEY environment variable is required in production/i,
      );

      process.env.RESEND_API_KEY = 're_env_key_456';
      expect(validateEmailDeliveryConfig()).toBe('re_env_key_456');

      process.env.NODE_ENV = 'development';
      delete process.env.RESEND_API_KEY;
      expect(() => validateEmailDeliveryConfig()).not.toThrow();
    });
  });
});
