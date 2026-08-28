import { Module } from '@nestjs/common';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'sync',
    }),
  ],
  controllers: [OAuthController],
  providers: [OAuthService],
})
export class OAuthModule {}
