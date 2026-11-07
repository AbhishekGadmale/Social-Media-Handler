import { Module } from '@nestjs/common';
import { PrismaClient } from '@agency-os/database';
import { CoreModule } from '../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { EMAIL_DELIVERY_SERVICE } from '../auth/email-delivery.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';
import { RazorpayService } from './razorpay.service';
import { PdfInvoiceGeneratorService } from './pdf-invoice.service';
import { WorkspaceWritableGuard } from './guards/workspace-writable.guard';
import { validateBillingConfig } from './billing.config';

@Module({
  imports: [CoreModule, AuthModule],
  controllers: [BillingController],
  providers: [
    WorkspaceWritableGuard,
    PdfInvoiceGeneratorService,
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
    PdfInvoiceGeneratorService,
    WorkspaceWritableGuard,
  ],
})
export class BillingModule {}
