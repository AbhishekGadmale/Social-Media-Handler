import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreModule } from './modules/core/core.module';
import { AuthModule } from './modules/auth/auth.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';

import { OAuthModule } from './modules/oauth/oauth.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { HealthModule } from './modules/health/health.module';

import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './modules/core/redis-throttler.storage';
import { RateLimitPolicies } from './modules/core/rate-limit.policies';
import type Redis from 'ioredis';

import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from './modules/core/logger.config';
import { TerminusModule } from '@nestjs/terminus';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    TerminusModule,
    HealthModule,
    ThrottlerModule.forRootAsync({
      inject: ['REDIS_CLIENT'],
      useFactory: (redis: Redis) => ({
        storage: new RedisThrottlerStorage(redis),
        throttlers: [{ name: 'default', ...RateLimitPolicies.baseline }],
      }),
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_URL
          ? new URL(process.env.REDIS_URL).hostname
          : 'localhost',
        port: process.env.REDIS_URL
          ? parseInt(new URL(process.env.REDIS_URL).port || '6379', 10)
          : 6379,
      },
    }),
    CoreModule,
    AuthModule,
    OAuthModule,
    AccountsModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
