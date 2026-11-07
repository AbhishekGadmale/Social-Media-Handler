/**
 * GST Calculation Utility for Kyosys Agency OS
 *
 * Enterprise: Gadmale Technologies (sole proprietorship, Maharashtra)
 * GST Regime: Voluntary registration, regular scheme, 18% GST rate.
 * Price Invariant: All prices are GST-INCLUSIVE.
 * Precision Invariant: All values strictly in integer paise. Zero floating point math.
 */

export const GST_RATE_PERCENT = 18;

export interface GstSplitResult {
  baseAmountPaise: number;
  gstAmountPaise: number;
  gstRate: number;
}

/**
 * Calculates base amount and 18% GST component for a GST-inclusive total in paise.
 * Formula:
 *   baseAmountPaise = Math.round(totalPaise / 1.18)
 *   gstAmountPaise = totalPaise - baseAmountPaise
 */
export function calculateGstSplit(totalAmountPaise: number): GstSplitResult {
  if (
    typeof totalAmountPaise !== 'number' ||
    !Number.isInteger(totalAmountPaise) ||
    totalAmountPaise < 0
  ) {
    throw new Error('Amount must be a non-negative integer paise');
  }

  if (totalAmountPaise === 0) {
    return {
      baseAmountPaise: 0,
      gstAmountPaise: 0,
      gstRate: GST_RATE_PERCENT,
    };
  }

  // Base calculation with rounding to nearest paise
  const baseAmountPaise = Math.round(totalAmountPaise / 1.18);
  const gstAmountPaise = totalAmountPaise - baseAmountPaise;

  return {
    baseAmountPaise,
    gstAmountPaise,
    gstRate: GST_RATE_PERCENT,
  };
}
