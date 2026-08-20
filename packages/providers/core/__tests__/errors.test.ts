import { describe, it, expect } from 'vitest';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderApiError,
  ProviderCapabilityError,
} from '../errors';

describe('Error Hierarchy', () => {
  it('instantiates and narrows ProviderAuthError', () => {
    try {
      throw new ProviderAuthError('Invalid credentials');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderAuthError);
      expect(err).toBeInstanceOf(Error);
      if (err instanceof ProviderAuthError) {
        expect(err.name).toBe('ProviderAuthError');
        expect(err.message).toBe('Invalid credentials');
      }
    }
  });

  it('instantiates and narrows ProviderRateLimitError with retryAfter', () => {
    try {
      throw new ProviderRateLimitError('Too many requests', 120);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderRateLimitError);
      if (err instanceof ProviderRateLimitError) {
        expect(err.name).toBe('ProviderRateLimitError');
        expect(err.message).toBe('Too many requests');
        expect(err.retryAfter).toBe(120);
        expect(typeof err.retryAfter).toBe('number');
      }
    }
  });

  it('instantiates and narrows ProviderApiError with statusCode', () => {
    try {
      throw new ProviderApiError('Bad Request', 400);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderApiError);
      if (err instanceof ProviderApiError) {
        expect(err.name).toBe('ProviderApiError');
        expect(err.message).toBe('Bad Request');
        expect(err.statusCode).toBe(400);
        expect(typeof err.statusCode).toBe('number');
      }
    }
  });

  it('instantiates and narrows ProviderCapabilityError', () => {
    try {
      throw new ProviderCapabilityError('POST_PUBLISH');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderCapabilityError);
      if (err instanceof ProviderCapabilityError) {
        expect(err.name).toBe('ProviderCapabilityError');
        expect(err.message).toContain('POST_PUBLISH');
      }
    }
  });
});
