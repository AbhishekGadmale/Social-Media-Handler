import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  onModuleDestroy() {
    // Optionally close redis connection if we created it,
    // but here we just inject the shared BullMQ/Redis connection.
  }

  async increment(
    key: string,
    ttl: number, // in milliseconds in @nestjs/throttler v6+
    limit: number,
    blockDuration: number, // in milliseconds
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttler:${throttlerName}:${key}`;

    // We use a simple Lua script to increment and set expiry if it doesn't exist
    const script = `
      local key = KEYS[1]
      local ttl = tonumber(ARGV[1])
      
      local current = redis.call("INCR", key)
      if current == 1 then
        redis.call("PEXPIRE", key, ttl)
      end
      
      local pttl = redis.call("PTTL", key)
      
      return {current, pttl}
    `;

    const result = (await this.redis.eval(script, 1, redisKey, ttl)) as [
      number,
      number,
    ];
    const totalHits = result[0];
    const pttl = result[1];

    // Convert ms to seconds for standard HTTP headers (Retry-After, X-RateLimit-Reset)
    const timeToExpireSec = Math.ceil((pttl > 0 ? pttl : ttl) / 1000);
    const isBlocked = totalHits > limit;

    return {
      totalHits,
      timeToExpire: timeToExpireSec,
      isBlocked,
      timeToBlockExpire: isBlocked ? timeToExpireSec : 0,
    };
  }
}
