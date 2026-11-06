import { Module } from '@nestjs/common';
import { PrismaClient, WorkspaceMemberRepository } from '@agency-os/database';
import { AuthModule } from '../auth/auth.module';
import { EMAIL_DELIVERY_SERVICE } from '../auth/email-delivery.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';
import { RazorpayService } from './razorpay.service';
import { WorkspaceWritableGuard } from './guards/workspace-writable.guard';
import { validateBillingConfig } from './billing.config';

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [
    PrismaClient,
    WorkspaceMemberRepository,
    WorkspaceWritableGuard,
    {
      provide: RazorpayService,
      useFactory: () => {
        const credentials = validateBillingConfig();
        return new RazorpayService(credentials);
      },
    },
    {
      provide: BillingService,
      useFactory: (
        prisma: PrismaClient,
        razorpayService: RazorpayService,
        emailDeliveryService: any,
      ) => {
        return new BillingService(
          prisma,
          razorpayService,
          emailDeliveryService,
        );
      },
      inject: [PrismaClient, RazorpayService, EMAIL_DELIVERY_SERVICE],
    },
    EntitlementsService,
  ],
  exports: [
    BillingService,
    EntitlementsService,
    RazorpayService,
    WorkspaceWritableGuard,
  ],
})
export class BillingModule {}
