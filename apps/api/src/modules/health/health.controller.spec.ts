import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaClient } from '@agency-os/database';
import { vi } from 'vitest';

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealthCheckService: any;
  let mockPrismaHealthIndicator: any;
  let mockPrismaClient: any;
  let mockRedis: any;

  beforeEach(async () => {
    mockHealthCheckService = {
      check: vi.fn((indicators) => {
        // Execute all indicators to simulate the check
        return Promise.all(indicators.map((i: any) => i()));
      }),
    };

    mockPrismaHealthIndicator = {
      pingCheck: vi.fn(),
    };

    mockPrismaClient = {};

    mockRedis = {
      ping: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: PrismaHealthIndicator, useValue: mockPrismaHealthIndicator },
        { provide: PrismaClient, useValue: mockPrismaClient },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('liveness should return status: ok', () => {
    expect(controller.checkLiveness()).toEqual({ status: 'ok' });
  });

  it('readiness should return healthy if db and redis are healthy', async () => {
    mockPrismaHealthIndicator.pingCheck.mockResolvedValue({
      database: { status: 'up' },
    });
    mockRedis.ping.mockResolvedValue('PONG');

    const result = await controller.checkReadiness();
    expect(result).toEqual([
      { database: { status: 'up' } },
      { redis: { status: 'up' } },
    ]);
  });

  it('readiness should fail if redis fails', async () => {
    mockPrismaHealthIndicator.pingCheck.mockResolvedValue({
      database: { status: 'up' },
    });
    mockRedis.ping.mockRejectedValue(new Error('Connection refused'));

    await expect(controller.checkReadiness()).rejects.toThrow(
      'Redis ping failed',
    );
  });

  it('readiness should fail if db fails', async () => {
    mockPrismaHealthIndicator.pingCheck.mockRejectedValue(
      new Error('DB Timeout'),
    );
    mockRedis.ping.mockResolvedValue('PONG');

    await expect(controller.checkReadiness()).rejects.toThrow('DB Timeout');
  });
});
