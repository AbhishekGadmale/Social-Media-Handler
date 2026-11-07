import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PLANS,
  validateBillingConfig,
  getGstin,
  getTrialGraceDays,
  ENTERPRISE_DETAILS,
} from './billing.config';

describe('Billing Configuration (billing.config)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Enterprise Details & Plan Definitions', () => {
    it('defines enterprise details for Gadmale Technologies, Maharashtra', () => {
      expect(ENTERPRISE_DETAILS.name).toBe('Gadmale Technologies');
      expect(ENTERPRISE_DETAILS.state).toBe('Maharashtra');
      expect(ENTERPRISE_DETAILS.stateCode).toBe('27');
    });

    it('defines all 4 required plans with integer paise prices and seat limits', () => {
      expect(PLANS.SOLO).toEqual({
        code: 'SOLO',
        name: 'Solo',
        monthlyPricePaise: 49900,
        annualPricePaise: 499000,
        seats: 1,
        isFounding: false,
      });

      expect(PLANS.STUDIO).toEqual({
        code: 'STUDIO',
        name: 'Studio',
        monthlyPricePaise: 99900,
        annualPricePaise: 999000,
        seats: 3,
        isFounding: false,
      });

      expect(PLANS.AGENCY).toEqual({
        code: 'AGENCY',
        name: 'Agency',
        monthlyPricePaise: 399900,
        annualPricePaise: 3999000,
        seats: 10,
        isFounding: false,
      });

      expect(PLANS.AGENCY_FOUNDING).toEqual({
        code: 'AGENCY_FOUNDING',
        name: 'Agency (Founding 50)',
        monthlyPricePaise: 299900,
        annualPricePaise: 2999000,
        seats: 10,
        isFounding: true,
      });
    });

    it('enforces that annual pricing is strictly 10x monthly pricing (2 months free)', () => {
      for (const plan of Object.values(PLANS)) {
        expect(plan.annualPricePaise).toBe(plan.monthlyPricePaise * 10);
      }
    });
  });

  describe('Trial Grace Days Configuration', () => {
    it('defaults to 0 grace days if TRIAL_END_GRACE_DAYS is unset', () => {
      delete process.env.TRIAL_END_GRACE_DAYS;
      expect(getTrialGraceDays()).toBe(0);
    });

    it('parses valid positive integer from TRIAL_END_GRACE_DAYS', () => {
      process.env.TRIAL_END_GRACE_DAYS = '3';
      expect(getTrialGraceDays()).toBe(3);
    });

    it('falls back to 0 if TRIAL_END_GRACE_DAYS is invalid or negative', () => {
      process.env.TRIAL_END_GRACE_DAYS = '-1';
      expect(getTrialGraceDays()).toBe(0);

      process.env.TRIAL_END_GRACE_DAYS = 'invalid';
      expect(getTrialGraceDays()).toBe(0);
    });
  });

  describe('GSTIN Validation & Enforcement', () => {
    it('throws fail-fast Error in production if GSTIN is unset', () => {
      delete process.env.GSTIN;
      expect(() => getGstin(true)).toThrow(
        'GSTIN must be configured in production for invoice generation',
      );
    });

    it('throws fail-fast Error in production if GSTIN is empty or whitespace', () => {
      process.env.GSTIN = '   ';
      expect(() => getGstin(true)).toThrow(
        'GSTIN must be configured in production for invoice generation',
      );
    });

    it('returns trimmed GSTIN when present in production', () => {
      process.env.GSTIN = ' 27ABCDE1234F1Z5 ';
      expect(getGstin(true)).toBe('27ABCDE1234F1Z5');
    });

    it('returns fallback dummy GSTIN in development/test when unset', () => {
      delete process.env.GSTIN;
      expect(getGstin(false)).toBe('27TESTGSTIN0001');
    });
  });

  describe('validateBillingConfig', () => {
    it('passes in development without Razorpay keys', () => {
      const config = validateBillingConfig({
        NODE_ENV: 'development',
      });
      expect(config.keyId).toBeDefined();
      expect(config.keySecret).toBeDefined();
      expect(config.webhookSecret).toBeDefined();
    });

    it('fails fast in production if RAZORPAY_KEY_ID is missing', () => {
      expect(() =>
        validateBillingConfig({
          NODE_ENV: 'production',
          RAZORPAY_KEY_SECRET: 'secret',
          RAZORPAY_WEBHOOK_SECRET: 'whsec',
        }),
      ).toThrow('RAZORPAY_KEY_ID must be configured in production');
    });

    it('fails fast in production if RAZORPAY_KEY_SECRET is missing', () => {
      expect(() =>
        validateBillingConfig({
          NODE_ENV: 'production',
          RAZORPAY_KEY_ID: 'rzp_test_123',
          RAZORPAY_WEBHOOK_SECRET: 'whsec',
        }),
      ).toThrow('RAZORPAY_KEY_SECRET must be configured in production');
    });

    it('fails fast in production if RAZORPAY_WEBHOOK_SECRET is missing', () => {
      expect(() =>
        validateBillingConfig({
          NODE_ENV: 'production',
          RAZORPAY_KEY_ID: 'rzp_test_123',
          RAZORPAY_KEY_SECRET: 'secret',
        }),
      ).toThrow('RAZORPAY_WEBHOOK_SECRET must be configured in production');
    });

    it('succeeds in production when all Razorpay keys are provided', () => {
      const config = validateBillingConfig({
        NODE_ENV: 'production',
        RAZORPAY_KEY_ID: 'rzp_test_123',
        RAZORPAY_KEY_SECRET: 'secret',
        RAZORPAY_WEBHOOK_SECRET: 'whsec',
      });
      expect(config.keyId).toBe('rzp_test_123');
      expect(config.keySecret).toBe('secret');
      expect(config.webhookSecret).toBe('whsec');
    });
  });
});
