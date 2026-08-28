import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreModule } from './core/core.module';
import { SyncModule } from './sync/sync.module';

import { BullModule } from '@nestjs/bullmq';

import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from './logger.config';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    CoreModule,
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
    SyncModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
