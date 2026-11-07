import { describe, it, expect } from 'vitest';
import {
  PdfInvoiceGeneratorService,
  InvoiceWithRelations,
  isInterStateGst,
} from './pdf-invoice.service';

function extractTextFromPdf(buf: Buffer): string {
  const str = buf.toString('latin1');
  let text = '';
  const hexMatches = str.match(/<([0-9a-fA-F]+)>/g) || [];
  for (const h of hexMatches) {
    text += Buffer.from(h.slice(1, -1), 'hex').toString('utf-8');
  }
  const literalMatches = str.match(/\(([^)]+)\)/g) || [];
  for (const l of literalMatches) {
    text += ' ' + l.slice(1, -1);
  }
  return text;
}

describe('PdfInvoiceGeneratorService', () => {
  const service = new PdfInvoiceGeneratorService();

  const mockBaseInvoice: InvoiceWithRelations = {
    id: 'a0000000-0000-0000-0000-000000000001',
    workspaceId: 'w0000000-0000-0000-0000-000000000001',
    subscriptionId: 's0000000-0000-0000-0000-000000000001',
    invoiceNumber: 'INV-2026-00001',
    amountPaise: 49900,
    baseAmountPaise: 42288,
    gstAmountPaise: 7612,
    gstRate: 18,
    gstin: '27AABCU9603R1ZM',
    status: 'PAID',
    createdAt: new Date('2026-11-07T10:00:00Z'),
    updatedAt: new Date('2026-11-07T10:00:00Z'),
    periodStart: new Date('2026-11-07T00:00:00Z'),
    periodEnd: new Date('2026-12-07T00:00:00Z'),
    workspace: {
      id: 'w0000000-0000-0000-0000-000000000001',
      name: 'Kyosys Media Hub',
    },
    subscription: {
      id: 's0000000-0000-0000-0000-000000000001',
      plan: {
        code: 'SOLO',
        name: 'Solo Plan',
      },
    },
  };

  it('generates a valid PDF buffer containing mandatory invoice and seller details', async () => {
    const pdfBuffer = await service.generatePdf(mockBaseInvoice);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(500);

    const pdfText = extractTextFromPdf(pdfBuffer);
    expect(pdfText).toContain('TAX INVOICE');
    expect(pdfText).toContain('INV-2026-00001');
    expect(pdfText).toContain('Gadmale Technologies');
    expect(pdfText).toContain('27AABCU9603R1ZM');
    expect(pdfText).toContain('Kyosys Media Hub');
    expect(pdfText).toContain('Solo Plan');
    expect(pdfText).toContain('422.88');
    expect(pdfText).toContain('76.12');
    expect(pdfText).toContain('499.00');
  });

  it('applies Intra-State regime (CGST + SGST) when buyer state is Maharashtra or unspecified', async () => {
    const invoiceInState: InvoiceWithRelations = {
      ...mockBaseInvoice,
      customerBillingDetails: {
        legalName: 'Kyosys Corp',
        state: 'Maharashtra',
      },
    };

    expect(isInterStateGst(invoiceInState.customerBillingDetails)).toBe(false);

    const pdfBuffer = await service.generatePdf(invoiceInState);
    const pdfText = extractTextFromPdf(pdfBuffer);

    expect(pdfText).toContain('Intra-State');
    expect(pdfText).toContain('CGST (9%)');
    expect(pdfText).toContain('SGST (9%)');
    expect(pdfText).toContain('Kyosys Corp');

    // 7612 paise total GST split into 3806 CGST and 3806 SGST
    expect(pdfText).toContain('38.06');
  });

  it('guarantees CGST and SGST split sums exactly to stored GST on odd-paise amounts', async () => {
    // 7611 paise: Math.round(7611 / 2) = 3806 CGST, SGST = 7611 - 3806 = 3805. Total = 7611.
    const oddPaiseInvoice: InvoiceWithRelations = {
      ...mockBaseInvoice,
      amountPaise: 49900,
      baseAmountPaise: 42289,
      gstAmountPaise: 7611,
    };

    const cgstPaise = Math.round(oddPaiseInvoice.gstAmountPaise / 2);
    const sgstPaise = oddPaiseInvoice.gstAmountPaise - cgstPaise;
    expect(cgstPaise + sgstPaise).toBe(oddPaiseInvoice.gstAmountPaise);
    expect(cgstPaise).toBe(3806);
    expect(sgstPaise).toBe(3805);

    const pdfBuffer = await service.generatePdf(oddPaiseInvoice);
    const pdfText = extractTextFromPdf(pdfBuffer);

    expect(pdfText).toContain('38.06');
    expect(pdfText).toContain('38.05');
  });

  it('applies Inter-State regime (IGST 18%) when buyer state is known and outside Maharashtra', async () => {
    const invoiceOutState: InvoiceWithRelations = {
      ...mockBaseInvoice,
      customerBillingDetails: {
        legalName: 'Bangalore Tech Agency',
        state: 'Karnataka',
        gstin: '29AABCT1332L1ZV',
        address: '100 Outer Ring Road',
        city: 'Bengaluru',
        postalCode: '560103',
      },
    };

    expect(isInterStateGst(invoiceOutState.customerBillingDetails)).toBe(true);

    const pdfBuffer = await service.generatePdf(invoiceOutState);
    const pdfText = extractTextFromPdf(pdfBuffer);

    expect(pdfText).toContain('Inter-State');
    expect(pdfText).toContain('IGST (18%)');
    expect(pdfText).not.toContain('CGST (9%)');
    expect(pdfText).not.toContain('SGST (9%)');
    expect(pdfText).toContain('Bangalore Tech Agency');
    expect(pdfText).toContain('29AABCT1332L1ZV');
    expect(pdfText).toContain('100 Outer Ring Road');
    expect(pdfText).toContain('Bengaluru');
    expect(pdfText).toContain('560103');
  });

  it('gracefully falls back when subscription or plan is absent', async () => {
    const invoiceNoSub: InvoiceWithRelations = {
      ...mockBaseInvoice,
      subscription: null,
      periodStart: null,
      periodEnd: null,
    };

    const pdfBuffer = await service.generatePdf(invoiceNoSub);
    const pdfText = extractTextFromPdf(pdfBuffer);

    expect(pdfText).toContain('Subscription');
    expect(pdfText).toContain('Current Period');
  });
});
