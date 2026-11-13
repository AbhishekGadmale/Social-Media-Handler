import { Module } from '@nestjs/common';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { BullModule } from '@nestjs/bullmq';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'sync',
    }),
    BillingModule,
  ],
  controllers: [OAuthController],
  providers: [OAuthService],
})
export class OAuthModule {}
