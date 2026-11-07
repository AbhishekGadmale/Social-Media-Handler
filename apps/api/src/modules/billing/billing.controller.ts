import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  Req,
  Res,
  UseGuards,
  HttpCode,
  BadRequestException,
  ParseUUIDPipe,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { WorkspaceGuard } from '../auth/guards/workspace.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/permission.decorator';
import { BillingService } from './billing.service';
import { RazorpayService } from './razorpay.service';
import { EntitlementsService } from './entitlements.service';
import { PdfInvoiceGeneratorService } from './pdf-invoice.service';
import { SubscribeDto, CancelSubscriptionDto } from './dto/subscribe.dto';

@Controller('v1')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly razorpayService: RazorpayService,
    private readonly entitlementsService: EntitlementsService,
    private readonly pdfInvoiceService: PdfInvoiceGeneratorService,
  ) {}

  /**
   * Razorpay Webhook Ingestion Endpoint
   * Validates HMAC-SHA256 signature using RAZORPAY_WEBHOOK_SECRET.
   * Rejects invalid or unsigned requests immediately with 400 Bad Request.
   */
  @Post('billing/webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature?: string,
  ) {
    if (!signature) {
      this.logger.warn('Rejected webhook: missing x-razorpay-signature header');
      throw new BadRequestException('Missing x-razorpay-signature header');
    }

    const rawPayload =
      req.rawBody ||
      (typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body
          : undefined);

    if (!rawPayload) {
      this.logger.warn(
        'Rejected webhook: raw body missing for signature verification',
      );
      throw new BadRequestException(
        'Raw body required for signature verification',
      );
    }

    const isValid = this.razorpayService.verifyWebhookSignature(
      rawPayload,
      signature,
    );

    if (!isValid) {
      this.logger.warn('Rejected webhook: invalid HMAC-SHA256 signature');
      throw new BadRequestException('Invalid webhook signature');
    }

    const payload =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const result = await this.billingService.processWebhook(payload);

    return {
      status: 'ok',
      eventId: result.eventId,
      ...(result.duplicate ? { duplicate: true } : {}),
    };
  }

  /**
   * Retrieves workspace billing status, plan details, and active entitlements.
   */
  @Get('workspaces/:workspaceId/billing')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('billing.view')
  async getWorkspaceBilling(@Param('workspaceId') workspaceId: string) {
    const billing = await this.billingService.getWorkspaceBilling(workspaceId);
    const entitlements =
      await this.entitlementsService.getWorkspaceEntitlements(workspaceId);

    return {
      ...billing,
      entitlements,
    };
  }

  /**
   * Retrieves all active plans with founding availability flag.
   */
  @Get('workspaces/:workspaceId/billing/plans')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('billing.view')
  async getPlans(@Param('workspaceId') _workspaceId: string) {
    return this.billingService.getPlansWithAvailability();
  }

  /**
   * Retrieves workspace invoices newest first.
   */
  @Get('workspaces/:workspaceId/billing/invoices')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('billing.view')
  async getWorkspaceInvoices(@Param('workspaceId') workspaceId: string) {
    return this.billingService.getWorkspaceInvoices(workspaceId);
  }

  /**
   * Generates and streams a tax invoice PDF.
   * Scoped to workspace; returns 404 for missing or foreign workspace invoices.
   */
  @Get('workspaces/:workspaceId/billing/invoices/:invoiceId/pdf')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('billing.view')
  async getInvoicePdf(
    @Param('workspaceId') workspaceId: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Res() res: Response,
  ) {
    const invoice = await this.billingService.getInvoiceRecord(
      workspaceId,
      invoiceId,
    );
    const pdfBuffer = await this.pdfInvoiceService.generatePdf(invoice);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="invoice-${invoice.invoiceNumber}.pdf"`,
    );
    res.setHeader('Content-Length', pdfBuffer.length.toString());
    res.end(pdfBuffer);
  }

  /**
   * Subscribes a workspace to a plan.
   * Special case: AGENCY_FOUNDING requires atomic claim check (< 50).
   */
  @Post('workspaces/:workspaceId/billing/subscribe')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  @HttpCode(200)
  async createSubscription(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: SubscribeDto,
  ) {
    return this.billingService.createSubscription(
      workspaceId,
      dto.planCode,
      dto.interval,
    );
  }

  /**
   * Cancels workspace subscription.
   * If founding plan, permanently revokes founding lock.
   */
  @Post('workspaces/:workspaceId/billing/cancel')
  @UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  @HttpCode(200)
  async cancelSubscription(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.billingService.cancelSubscription(
      workspaceId,
      dto.cancelAtPeriodEnd ?? true,
    );
  }
}
