import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { TerminusModule } from '@nestjs/terminus';
import { CoreModule } from '../core/core.module';

@Module({
  imports: [TerminusModule, CoreModule],
  controllers: [HealthController],
})
export class HealthModule {}
