import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  PrismaHealthIndicator,
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { PrismaClient } from '@agency-os/database';
import { SkipThrottle } from '@nestjs/throttler';
import type Redis from 'ioredis';

class RedisHealthIndicator extends HealthIndicator {
  constructor(private redis: Redis) {
    super();
  }
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.redis.ping();
      return this.getStatus(key, true, { status: 'up' });
    } catch (e) {
      throw new HealthCheckError(
        'Redis ping failed',
        this.getStatus(key, false, { message: e.message }),
      );
    }
  }
}

@Controller('health')
// Skip global rate limiting for health endpoints so orchestrated probes (e.g. from a load balancer)
// don't get accidentally blocked, falsely marking the API as unhealthy and triggering restarts.
@SkipThrottle()
export class HealthController {
  private redisIndicator: RedisHealthIndicator;

  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private prisma: PrismaClient,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {
    this.redisIndicator = new RedisHealthIndicator(redis);
  }

  @Get('live')
  checkLiveness() {
    // Purely checks if the Node.js process is responsive. No external dependencies.
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  checkReadiness() {
    // Checks if critical dependencies (Postgres, Redis) are available.
    return this.health.check([
      // Postgres check using the existing PrismaClient
      () => this.prismaHealth.pingCheck('database', this.prisma),

      // Redis check using the existing REDIS_CLIENT connection config via PING
      () => this.redisIndicator.isHealthy('redis'),
    ]);
  }
}
