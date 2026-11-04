import { Module } from '@nestjs/common';
import { AuthController, WorkspaceTestController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  EMAIL_DELIVERY_SERVICE,
  MockEmailDeliveryService,
  NoopEmailDeliveryService,
} from './email-delivery.service';

@Module({
  controllers: [AuthController, WorkspaceTestController],
  providers: [
    AuthService,
    {
      provide: EMAIL_DELIVERY_SERVICE,
      useClass:
        process.env.NODE_ENV === 'production'
          ? NoopEmailDeliveryService
          : MockEmailDeliveryService,
    },
  ],
  exports: [AuthService, EMAIL_DELIVERY_SERVICE],
})
export class AuthModule {}
