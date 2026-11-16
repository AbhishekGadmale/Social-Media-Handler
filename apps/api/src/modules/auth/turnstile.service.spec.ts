import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TurnstileService } from './turnstile.service';

describe('TurnstileService', () => {
  let service: TurnstileService;
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  let fetchMock: any;

  beforeEach(() => {
    service = new TurnstileService();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('(a) no TURNSTILE_SECRET_KEY -> true, fetch NOT called', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_SITEVERIFY_URL;

    const result = await service.verify('some-token', '1.2.3.4');

    expect(result).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('(b) key set + token undefined/missing -> false, fetch NOT called', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';

    const resultUndefined = await service.verify(undefined, '1.2.3.4');
    expect(resultUndefined).toBe(false);

    const resultEmpty = await service.verify('', '1.2.3.4');
    expect(resultEmpty).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('(c) key set + siteverify returns { success: true } -> true, and assert request body contains secret, response, and remoteip when provided', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';
    process.env.TURNSTILE_SITEVERIFY_URL =
      'https://custom-turnstile.example.com/siteverify';

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    const result = await service.verify('test-token-123', '203.0.113.195');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [callUrl, callOptions] = fetchMock.mock.calls[0];
    expect(callUrl).toBe('https://custom-turnstile.example.com/siteverify');
    expect(callOptions.method).toBe('POST');
    expect(callOptions.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );

    const params = new URLSearchParams(callOptions.body);
    expect(params.get('secret')).toBe('test-secret-key');
    expect(params.get('response')).toBe('test-token-123');
    expect(params.get('remoteip')).toBe('203.0.113.195');
  });

  it('(d) key set + siteverify returns { success: false } -> false', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: false,
        'error-codes': ['invalid-input-response'],
      }),
    });

    const result = await service.verify('invalid-token', '1.2.3.4');

    expect(result).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('(e) fetch rejects (network error / timeout) -> true (fail-open)', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';

    fetchMock.mockRejectedValueOnce(
      new Error('Connection timeout / network error'),
    );

    const result = await service.verify('some-token', '1.2.3.4');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('(f) non-200 response -> true (fail-open)', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const result = await service.verify('some-token', '1.2.3.4');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles unparseable JSON response by failing open -> true', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token < in JSON at position 0');
      },
    });

    const result = await service.verify('some-token');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
