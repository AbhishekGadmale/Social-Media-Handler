import { Module } from '@nestjs/common';
import { AuthController, WorkspaceTestController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  EMAIL_DELIVERY_SERVICE,
  MockEmailDeliveryService,
  NoopEmailDeliveryService,
  ResendEmailDeliveryService,
} from './email-delivery.service';
import { PasswordPolicyService } from './password-policy.service';
import { PwnedPasswordService } from './pwned-password.service';

@Module({
  controllers: [AuthController, WorkspaceTestController],
  providers: [
    AuthService,
    PwnedPasswordService,
    PasswordPolicyService,
    {
      provide: EMAIL_DELIVERY_SERVICE,
      useFactory: () => {
        if (process.env.NODE_ENV === 'production') {
          if (process.env.RESEND_API_KEY) {
            return new ResendEmailDeliveryService();
          }
          return new NoopEmailDeliveryService();
        }
        return new MockEmailDeliveryService();
      },
    },
  ],
  exports: [AuthService, EMAIL_DELIVERY_SERVICE],
})
export class AuthModule {}
