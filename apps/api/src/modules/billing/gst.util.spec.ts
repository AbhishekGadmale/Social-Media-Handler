import { describe, it, expect } from 'vitest';
import { calculateGstSplit, GST_RATE_PERCENT } from './gst.util';

describe('GST Math Utility (gst.util)', () => {
  it('has GST rate locked at 18%', () => {
    expect(GST_RATE_PERCENT).toBe(18);
  });

  describe('Monthly Prices GST Split (Paise)', () => {
    it('correctly splits Solo tier ₹499 (49,900 paise)', () => {
      const split = calculateGstSplit(49900);
      expect(split.baseAmountPaise).toBe(42288);
      expect(split.gstAmountPaise).toBe(7612);
      expect(split.baseAmountPaise + split.gstAmountPaise).toBe(49900);
      expect(split.gstRate).toBe(18);
    });

    it('correctly splits Studio tier ₹999 (99,900 paise)', () => {
      const split = calculateGstSplit(99900);
      expect(split.baseAmountPaise).toBe(84661);
      expect(split.gstAmountPaise).toBe(15239);
      expect(split.baseAmountPaise + split.gstAmountPaise).toBe(99900);
      expect(split.gstRate).toBe(18);
    });

    it('correctly splits Founding Agency tier ₹2,999 (299,900 paise)', () => {
      const split = calculateGstSplit(299900);
      expect(split.baseAmountPaise).toBe(254153);
      expect(split.gstAmountPaise).toBe(45747);
      expect(split.baseAmountPaise + split.gstAmountPaise).toBe(299900);
      expect(split.gstRate).toBe(18);
    });

    it('correctly splits Agency tier ₹3,999 (399,900 paise)', () => {
      const split = calculateGstSplit(399900);
      expect(split.baseAmountPaise).toBe(338898);
      expect(split.gstAmountPaise).toBe(61002);
      expect(split.baseAmountPaise + split.gstAmountPaise).toBe(399900);
      expect(split.gstRate).toBe(18);
    });
  });

  describe('Annual Prices GST Split (Paise — 10x Monthly)', () => {
    it('correctly splits Solo Annual ₹4,990 (499,000 paise)', () => {
      const split = calculateGstSplit(499000);
      expect(split.baseAmountPaise).toBe(422881);
      expect(split.gstAmountPaise).toBe(76119);
      expect(split.baseAmountPaise + split.gstAmountPaise).toBe(499000);
      expect(split.gstRate).toBe(18);
    });

    it('correctly splits Studio Annual ₹9,990 (999,000 paise)', () => {
      const split = calculateGstSplit(999000);
      expect(split.baseAmountPaise).toBe(846610);
      expect(split.gstAmountPaise).toBe(152390);
      expect(split.baseAmountPaise + split.gstAmountPaise).toBe(999000);
      expect(split.gstRate).toBe(18);
    });

    it('correctly splits Founding Agency Annual ₹29,990 (2,999,000 paise)', () => {
      const split = calculateGstSplit(2999000);
      expect(split.baseAmountPaise).toBe(2541525);
      expect(split.gstAmountPaise).toBe(457475);
      expect(split.baseAmountPaise + split.gstAmountPaise).toBe(2999000);
      expect(split.gstRate).toBe(18);
    });

    it('correctly splits Agency Annual ₹39,990 (3,999,000 paise)', () => {
      const split = calculateGstSplit(3999000);
      expect(split.baseAmountPaise).toBe(3388983);
      expect(split.gstAmountPaise).toBe(610017);
      expect(split.baseAmountPaise + split.gstAmountPaise).toBe(3999000);
      expect(split.gstRate).toBe(18);
    });
  });

  describe('Input Validation & Strict Integer Invariants', () => {
    it('handles 0 paise cleanly', () => {
      const split = calculateGstSplit(0);
      expect(split.baseAmountPaise).toBe(0);
      expect(split.gstAmountPaise).toBe(0);
      expect(split.gstRate).toBe(18);
    });

    it('throws error if amount is negative', () => {
      expect(() => calculateGstSplit(-100)).toThrow(
        'Amount must be a non-negative integer paise',
      );
    });

    it('throws error if amount is a float', () => {
      expect(() => calculateGstSplit(499.5)).toThrow(
        'Amount must be a non-negative integer paise',
      );
    });

    it('throws error if amount is NaN or Infinity', () => {
      expect(() => calculateGstSplit(NaN)).toThrow(
        'Amount must be a non-negative integer paise',
      );
      expect(() => calculateGstSplit(Infinity)).toThrow(
        'Amount must be a non-negative integer paise',
      );
    });
  });
});
