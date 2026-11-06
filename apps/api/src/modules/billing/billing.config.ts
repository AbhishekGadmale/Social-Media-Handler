/**
 * Billing Configuration & Validation for Kyosys Agency OS
 *
 * Enterprise: Gadmale Technologies (sole proprietorship, Maharashtra)
 * Prices: GST-inclusive, integer paise.
 * Credentials: Test mode only, key/secret never logged.
 */

export const ENTERPRISE_DETAILS = {
  name: 'Gadmale Technologies',
  tradeName: 'Kyosys Agency OS',
  state: 'Maharashtra',
  stateCode: '27',
};

export const TRIAL_DURATION_DAYS = 14;

export interface PlanConfig {
  code: 'SOLO' | 'STUDIO' | 'AGENCY' | 'AGENCY_FOUNDING';
  name: string;
  monthlyPricePaise: number;
  annualPricePaise: number;
  seats: number;
  isFounding: boolean;
}

export const PLANS: Record<string, PlanConfig> = {
  SOLO: {
    code: 'SOLO',
    name: 'Solo',
    monthlyPricePaise: 49900,
    annualPricePaise: 499000,
    seats: 1,
    isFounding: false,
  },
  STUDIO: {
    code: 'STUDIO',
    name: 'Studio',
    monthlyPricePaise: 99900,
    annualPricePaise: 999000,
    seats: 3,
    isFounding: false,
  },
  AGENCY: {
    code: 'AGENCY',
    name: 'Agency',
    monthlyPricePaise: 399900,
    annualPricePaise: 3999000,
    seats: 10,
    isFounding: false,
  },
  AGENCY_FOUNDING: {
    code: 'AGENCY_FOUNDING',
    name: 'Agency (Founding 50)',
    monthlyPricePaise: 299900,
    annualPricePaise: 2999000,
    seats: 10,
    isFounding: true,
  },
};

export const FOUNDING_PLAN_MAX_SEATS = 50;

/**
 * Returns configured trial grace days from environment (defaults to 0).
 */
export function getTrialGraceDays(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.TRIAL_END_GRACE_DAYS;
  if (!raw) return 0;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

/**
 * Retrieves GSTIN.
 * In production, throws an explicit fail-fast Error if GSTIN is not set.
 */
export function getGstin(
  isProduction: boolean = process.env.NODE_ENV === 'production',
  env: NodeJS.ProcessEnv = process.env,
): string {
  const gstin = env.GSTIN?.trim();
  if (isProduction) {
    if (!gstin) {
      throw new Error(
        'GSTIN must be configured in production for invoice generation',
      );
    }
    return gstin;
  }
  return gstin || '27TESTGSTIN0001';
}

export interface BillingCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/**
 * Validates Billing and Razorpay configuration on boot.
 */
export function validateBillingConfig(
  env: NodeJS.ProcessEnv = process.env,
): BillingCredentials {
  const isProduction = env.NODE_ENV === 'production';
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim();

  if (isProduction) {
    if (!keyId) {
      throw new Error('RAZORPAY_KEY_ID must be configured in production');
    }
    if (!keySecret) {
      throw new Error('RAZORPAY_KEY_SECRET must be configured in production');
    }
    if (!webhookSecret) {
      throw new Error(
        'RAZORPAY_WEBHOOK_SECRET must be configured in production',
      );
    }
    return { keyId, keySecret, webhookSecret };
  }

  return {
    keyId: keyId || 'rzp_test_dummy_key_id',
    keySecret: keySecret || 'dummy_razorpay_secret',
    webhookSecret: webhookSecret || 'dummy_webhook_secret',
  };
}
