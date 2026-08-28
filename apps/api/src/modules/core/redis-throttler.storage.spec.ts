import { RedisThrottlerStorage } from './redis-throttler.storage';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage;
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = {
      eval: vi.fn(),
    };
    storage = new RedisThrottlerStorage(mockRedis);
  });

  it('should call redis.eval with correct arguments', async () => {
    mockRedis.eval.mockResolvedValue([1, 60000]);

    const result = await storage.increment(
      'test-key',
      60000,
      10,
      60000,
      'default',
    );

    expect(mockRedis.eval).toHaveBeenCalled();
    expect(mockRedis.eval.mock.calls[0][1]).toBe(1); // number of keys
    expect(mockRedis.eval.mock.calls[0][2]).toBe('throttler:default:test-key');
    expect(mockRedis.eval.mock.calls[0][3]).toBe(60000); // ttl

    expect(result.totalHits).toBe(1);
    expect(result.isBlocked).toBe(false);
    expect(result.timeToExpire).toBe(60); // 60000 / 1000
  });

  it('should return isBlocked=true if limit exceeded', async () => {
    mockRedis.eval.mockResolvedValue([11, 50000]);

    const result = await storage.increment(
      'test-key',
      60000,
      10,
      60000,
      'default',
    );

    expect(result.totalHits).toBe(11);
    expect(result.isBlocked).toBe(true);
    expect(result.timeToBlockExpire).toBe(50); // 50000 / 1000
  });
});
