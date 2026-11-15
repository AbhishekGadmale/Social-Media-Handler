import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { PwnedPasswordService } from './pwned-password.service';

describe('PwnedPasswordService', () => {
  let service: PwnedPasswordService;
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PwnedPasswordService],
    }).compile();

    service = module.get<PwnedPasswordService>(PwnedPasswordService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('case (a): returns true when suffix is present in range body (mixed case) and requests /range/<prefix>', async () => {
    const testPassword = 'TestPassword123!';
    const expectedSha1 = createHash('sha1')
      .update(testPassword)
      .digest('hex')
      .toUpperCase();
    const prefix = expectedSha1.slice(0, 5);
    const suffix = expectedSha1.slice(5);

    // Return suffix in mixed/lower case with count
    const mockResponseBody = `00000000000000000000000000000000000:1\n${suffix.toLowerCase()}:42\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:2\n`;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(mockResponseBody),
    });
    global.fetch = fetchMock as any;

    const result = await service.isBreached(testPassword);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toMatch(new RegExp(`/range/${prefix}$`));
  });

  it('case (b): returns false when suffix is absent from range body', async () => {
    const testPassword = 'SafePassword123!';
    const mockResponseBody = `00000000000000000000000000000000000:1\n11111111111111111111111111111111111:5\n`;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(mockResponseBody),
    });
    global.fetch = fetchMock as any;

    const result = await service.isBreached(testPassword);

    expect(result).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('case (c): returns false (fail-open) and does not throw when fetch rejects', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error('Network offline or DNS error'));
    global.fetch = fetchMock as any;

    const result = await service.isBreached('AnyPassword123!');

    expect(result).toBe(false);
  });

  it('case (d): returns false (fail-open) when fetch returns non-200 status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue('Service Unavailable'),
    });
    global.fetch = fetchMock as any;

    const result = await service.isBreached('AnyPassword123!');

    expect(result).toBe(false);
  });

  it('case (e): returns false with fetch NOT called when PASSWORD_BREACH_CHECK_ENABLED=false', async () => {
    process.env.PASSWORD_BREACH_CHECK_ENABLED = 'false';
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    const result = await service.isBreached('AnyPassword123!');

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
