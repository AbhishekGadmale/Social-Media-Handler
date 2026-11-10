import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiError } from './client';

describe('apiClient error normalization', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('normalizes nested {error: {message}} string', async () => {
    const rawError = {
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        requestId: 'req-1',
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => rawError,
    });

    await expect(apiClient('/test')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.message).toBe('Invalid email or password');
      expect(apiErr.data).toEqual(rawError);
      return true;
    });
  });

  it('normalizes nested {error: {message}} array joined with ", "', async () => {
    const rawError = {
      error: {
        code: 'VALIDATION_FAILED',
        message: ['Email is invalid', 'Password too short'],
        requestId: 'req-2',
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => rawError,
    });

    await expect(apiClient('/test')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.message).toBe('Email is invalid, Password too short');
      expect(apiErr.data).toEqual(rawError);
      return true;
    });
  });

  it('normalizes top-level {message} string', async () => {
    const rawError = {
      message: 'Direct error message',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => rawError,
    });

    await expect(apiClient('/test')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.message).toBe('Direct error message');
      expect(apiErr.data).toEqual(rawError);
      return true;
    });
  });

  it('normalizes top-level {message} array joined with ", "', async () => {
    const rawError = {
      message: ['First error', 'Second error'],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => rawError,
    });

    await expect(apiClient('/test')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.message).toBe('First error, Second error');
      expect(apiErr.data).toEqual(rawError);
      return true;
    });
  });

  it('handles non-object errorData (string, number, null) by falling back to statusText then API Error', async () => {
    // String payload
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers(),
      json: async () => 'Plain string error',
    });

    await expect(apiClient('/test')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.message).toBe('Bad Request');
      expect(apiErr.data).toBe('Plain string error');
      return true;
    });

    // Number payload
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers(),
      json: async () => 12345,
    });

    await expect(apiClient('/test')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.message).toBe('Bad Request');
      expect(apiErr.data).toBe(12345);
      return true;
    });

    // Null payload with empty statusText
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: '',
      headers: new Headers(),
      json: async () => null,
    });

    await expect(apiClient('/test')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.message).toBe('API Error');
      expect(apiErr.data).toBeNull();
      return true;
    });
  });

  it('falls back to statusText on non-JSON error body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });

    await expect(apiClient('/test')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(502);
      expect(apiErr.message).toBe('Bad Gateway');
      return true;
    });
  });

  it('preserves error message and assigns status 0 on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    await expect(apiClient('/test')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(0);
      expect(apiErr.message).toBe('Connection refused');
      expect(apiErr.data).toBeNull();
      return true;
    });
  });

  it('asserts data still holds raw errorData in the nested case', async () => {
    const rawError = {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded',
        requestId: 'req-3',
      },
      meta: {
        retryAfter: 60,
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers(),
      json: async () => rawError,
    });

    await expect(apiClient('/test')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.data).toEqual(rawError);
      expect((apiErr.data as typeof rawError).error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect((apiErr.data as typeof rawError).meta.retryAfter).toBe(60);
      expect(apiErr.message).toBe('Rate limit exceeded');
      return true;
    });
  });
});
