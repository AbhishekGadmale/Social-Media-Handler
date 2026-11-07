import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingInterval } from '@agency-os/database';
import { BillingController } from './billing.controller';

describe('BillingController', () => {
  let controller: BillingController;
  let billingServiceMock: any;
  let razorpayServiceMock: any;
  let entitlementsServiceMock: any;
  let pdfInvoiceServiceMock: any;

  const mockWorkspaceId = 'ws-test-123';

  beforeEach(() => {
    billingServiceMock = {
      processWebhook: vi.fn(),
      getWorkspaceBilling: vi.fn(),
      getPlansWithAvailability: vi.fn(),
      getWorkspaceInvoices: vi.fn(),
      getInvoiceRecord: vi.fn(),
      createSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
    };

    razorpayServiceMock = {
      verifyWebhookSignature: vi.fn(),
    };

    entitlementsServiceMock = {
      getWorkspaceEntitlements: vi.fn(),
    };

    pdfInvoiceServiceMock = {
      generatePdf: vi.fn(),
    };

    controller = new BillingController(
      billingServiceMock,
      razorpayServiceMock,
      entitlementsServiceMock,
      pdfInvoiceServiceMock,
    );
  });

  describe('POST /api/v1/billing/webhook', () => {
    const rawPayload = JSON.stringify({
      id: 'event_test_123',
      event: 'subscription.charged',
      payload: {},
    });
    const validSignature = 'valid_hex_signature';

    it('rejects with 400 Bad Request when signature header is missing', async () => {
      const mockReq = {
        rawBody: Buffer.from(rawPayload),
        body: JSON.parse(rawPayload),
        headers: {},
      } as any;

      await expect(
        controller.handleWebhook(mockReq, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(billingServiceMock.processWebhook).not.toHaveBeenCalled();
    });

    it('rejects with 400 Bad Request when signature verification fails', async () => {
      razorpayServiceMock.verifyWebhookSignature.mockReturnValue(false);

      const mockReq = {
        rawBody: Buffer.from(rawPayload),
        body: JSON.parse(rawPayload),
        headers: { 'x-razorpay-signature': 'invalid_sig' },
      } as any;

      await expect(
        controller.handleWebhook(mockReq, 'invalid_sig'),
      ).rejects.toThrow(BadRequestException);
      expect(billingServiceMock.processWebhook).not.toHaveBeenCalled();
    });

    it('accepts and processes valid webhook payload', async () => {
      razorpayServiceMock.verifyWebhookSignature.mockReturnValue(true);
      billingServiceMock.processWebhook.mockResolvedValue({
        processed: true,
        eventId: 'event_test_123',
      });

      const parsedBody = JSON.parse(rawPayload);
      const mockReq = {
        rawBody: Buffer.from(rawPayload),
        body: parsedBody,
        headers: { 'x-razorpay-signature': validSignature },
      } as any;

      const response = await controller.handleWebhook(mockReq, validSignature);

      expect(razorpayServiceMock.verifyWebhookSignature).toHaveBeenCalledWith(
        mockReq.rawBody,
        validSignature,
      );
      expect(billingServiceMock.processWebhook).toHaveBeenCalledWith(
        parsedBody,
      );
      expect(response).toEqual({ status: 'ok', eventId: 'event_test_123' });
    });
  });

  describe('GET /api/v1/workspaces/:workspaceId/billing', () => {
    it('returns workspace billing and entitlements scoped to workspaceId', async () => {
      const billingData = {
        workspaceId: mockWorkspaceId,
        trialEndsAt: new Date(),
        subscription: null,
      };
      const entitlements = {
        isReadOnly: false,
        seats: 10,
        planCode: 'AGENCY_TRIAL',
      };

      billingServiceMock.getWorkspaceBilling.mockResolvedValue(billingData);
      entitlementsServiceMock.getWorkspaceEntitlements.mockResolvedValue(
        entitlements,
      );

      const result = await controller.getWorkspaceBilling(mockWorkspaceId);

      expect(billingServiceMock.getWorkspaceBilling).toHaveBeenCalledWith(
        mockWorkspaceId,
      );
      expect(
        entitlementsServiceMock.getWorkspaceEntitlements,
      ).toHaveBeenCalledWith(mockWorkspaceId);
      expect(result).toEqual({
        ...billingData,
        entitlements,
      });
    });
  });

  describe('POST /api/v1/workspaces/:workspaceId/billing/subscribe', () => {
    it('creates subscription for specified plan', async () => {
      billingServiceMock.createSubscription.mockResolvedValue({
        id: 'sub-new',
        workspaceId: mockWorkspaceId,
        planId: 'plan-studio',
      });

      const result = await controller.createSubscription(mockWorkspaceId, {
        planCode: 'STUDIO',
        interval: BillingInterval.MONTHLY,
      });

      expect(billingServiceMock.createSubscription).toHaveBeenCalledWith(
        mockWorkspaceId,
        'STUDIO',
        BillingInterval.MONTHLY,
      );
      expect(result.id).toBe('sub-new');
    });
  });

  describe('POST /api/v1/workspaces/:workspaceId/billing/cancel', () => {
    it('cancels subscription and marks cancelAtPeriodEnd', async () => {
      billingServiceMock.cancelSubscription.mockResolvedValue({
        id: 'sub-1',
        isFounding: false,
        cancelAtPeriodEnd: true,
      });

      const result = await controller.cancelSubscription(mockWorkspaceId, {
        cancelAtPeriodEnd: true,
      });

      expect(billingServiceMock.cancelSubscription).toHaveBeenCalledWith(
        mockWorkspaceId,
        true,
      );
      expect(result.isFounding).toBe(false);
    });
  });

  describe('GET /api/v1/workspaces/:workspaceId/billing/plans', () => {
    it('returns plans with foundingAvailable boolean', async () => {
      const mockPlansData = {
        plans: [
          { code: 'SOLO', monthlyPricePaise: 49900 },
          { code: 'STUDIO', monthlyPricePaise: 99900 },
        ],
        foundingAvailable: true,
      };

      billingServiceMock.getPlansWithAvailability.mockResolvedValue(
        mockPlansData,
      );

      const result = await controller.getPlans(mockWorkspaceId);

      expect(billingServiceMock.getPlansWithAvailability).toHaveBeenCalled();
      expect(result).toEqual(mockPlansData);
    });
  });

  describe('GET /api/v1/workspaces/:workspaceId/billing/invoices', () => {
    it('returns invoices for workspace newest first', async () => {
      const mockInvoices = [
        { id: 'inv-2', invoiceNumber: 'INV-2026-00002', amountPaise: 99900 },
        { id: 'inv-1', invoiceNumber: 'INV-2026-00001', amountPaise: 49900 },
      ];

      billingServiceMock.getWorkspaceInvoices.mockResolvedValue(mockInvoices);

      const result = await controller.getWorkspaceInvoices(mockWorkspaceId);

      expect(billingServiceMock.getWorkspaceInvoices).toHaveBeenCalledWith(
        mockWorkspaceId,
      );
      expect(result).toEqual(mockInvoices);
    });
  });

  describe('GET /api/v1/workspaces/:workspaceId/billing/invoices/:invoiceId/pdf', () => {
    const mockInvoiceId = 'i0000000-0000-0000-0000-000000000001';

    it('streams generated PDF with correct headers on valid invoice', async () => {
      const mockInvoice = {
        id: mockInvoiceId,
        invoiceNumber: 'INV-2026-00001',
        workspaceId: mockWorkspaceId,
      };
      const mockPdfBuffer = Buffer.from('%PDF-1.3 fake pdf content');

      billingServiceMock.getInvoiceRecord.mockResolvedValue(mockInvoice);
      pdfInvoiceServiceMock.generatePdf.mockResolvedValue(mockPdfBuffer);

      const res = {
        setHeader: vi.fn(),
        end: vi.fn(),
      } as any;

      await controller.getInvoicePdf(mockWorkspaceId, mockInvoiceId, res);

      expect(billingServiceMock.getInvoiceRecord).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockInvoiceId,
      );
      expect(pdfInvoiceServiceMock.generatePdf).toHaveBeenCalledWith(
        mockInvoice,
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="invoice-INV-2026-00001.pdf"',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Length',
        mockPdfBuffer.length.toString(),
      );
      expect(res.end).toHaveBeenCalledWith(mockPdfBuffer);
    });

    it('propagates 404 NotFoundException for missing or foreign workspace invoices', async () => {
      billingServiceMock.getInvoiceRecord.mockRejectedValue(
        new NotFoundException('Invoice not found'),
      );

      const res = {
        setHeader: vi.fn(),
        end: vi.fn(),
      } as any;

      await expect(
        controller.getInvoicePdf(mockWorkspaceId, mockInvoiceId, res),
      ).rejects.toThrow(NotFoundException);
      expect(pdfInvoiceServiceMock.generatePdf).not.toHaveBeenCalled();
    });
  });
});
