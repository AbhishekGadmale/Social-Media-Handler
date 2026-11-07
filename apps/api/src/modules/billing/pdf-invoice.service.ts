import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { ENTERPRISE_DETAILS, getGstin } from './billing.config';

export interface InvoiceWithRelations {
  id: string;
  workspaceId: string;
  subscriptionId?: string | null;
  invoiceNumber: string;
  amountPaise: number;
  baseAmountPaise: number;
  gstAmountPaise: number;
  gstRate: number;
  gstin: string;
  customerBillingDetails?: any;
  status: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  workspace: {
    id: string;
    name: string;
  };
  subscription?: {
    id: string;
    isFounding?: boolean;
    plan?: {
      code: string;
      name: string;
    } | null;
  } | null;
}

export function isInterStateGst(customerBillingDetails?: any): boolean {
  if (!customerBillingDetails || typeof customerBillingDetails !== 'object') {
    return false;
  }

  const state = customerBillingDetails.state
    ? String(customerBillingDetails.state).trim().toLowerCase()
    : null;
  const stateCode = customerBillingDetails.stateCode
    ? String(customerBillingDetails.stateCode).trim().toLowerCase()
    : null;

  if (state) {
    if (state === 'maharashtra' || state === 'mh' || state === '27') {
      return false;
    }
    return true; // Known non-Maharashtra state -> Inter-State (IGST)
  }

  if (stateCode) {
    if (stateCode === '27' || stateCode === 'mh') {
      return false;
    }
    return true; // Known non-Maharashtra state code -> Inter-State (IGST)
  }

  return false; // Unknown state -> Intra-State (CGST + SGST)
}

@Injectable()
export class PdfInvoiceGeneratorService {
  /**
   * Generates a tax invoice PDF for the given invoice record.
   * Pure server-side PDFKit generation with zero external browser dependencies.
   */
  async generatePdf(invoice: InvoiceWithRelations): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, compress: false });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => reject(err));

        const sellerGstin = invoice.gstin || getGstin();
        const billingDetails = invoice.customerBillingDetails as Record<
          string,
          any
        > | null;
        const isInterState = isInterStateGst(billingDetails);

        const baseAmount = (invoice.baseAmountPaise / 100).toFixed(2);
        const totalAmount = (invoice.amountPaise / 100).toFixed(2);
        const totalGst = (invoice.gstAmountPaise / 100).toFixed(2);

        // CGST / SGST split rule: Math.round for CGST, remainder for SGST so sum is exact
        const cgstPaise = Math.round(invoice.gstAmountPaise / 2);
        const sgstPaise = invoice.gstAmountPaise - cgstPaise;
        const cgstAmount = (cgstPaise / 100).toFixed(2);
        const sgstAmount = (sgstPaise / 100).toFixed(2);

        const planName = invoice.subscription?.plan?.name || 'Subscription';
        const formattedDate = invoice.createdAt.toISOString().slice(0, 10);

        let periodStr = 'Current Period';
        if (invoice.periodStart && invoice.periodEnd) {
          const pStart = invoice.periodStart.toISOString().slice(0, 10);
          const pEnd = invoice.periodEnd.toISOString().slice(0, 10);
          periodStr = `${pStart} to ${pEnd}`;
        }

        // Header
        doc.fontSize(22).font('Helvetica-Bold').text('TAX INVOICE', {
          align: 'left',
        });
        doc.moveDown(0.5);

        // Invoice Metadata Bar
        doc.fontSize(10).font('Helvetica');
        doc.text(`Invoice Number: ${invoice.invoiceNumber}`);
        doc.text(`Invoice Date: ${formattedDate}`);
        doc.text(`Status: ${invoice.status}`);
        doc.moveDown(1);

        // Horizontal line
        doc
          .strokeColor('#e5e7eb')
          .lineWidth(1)
          .moveTo(50, doc.y)
          .lineTo(562, doc.y)
          .stroke();
        doc.moveDown(1);

        // Seller and Buyer section
        const sectionY = doc.y;

        // Seller (Left Column)
        doc.fontSize(12).font('Helvetica-Bold').text('SELLER', 50, sectionY);
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica-Bold').text(ENTERPRISE_DETAILS.name);
        doc.font('Helvetica');
        doc.text(
          `State: ${ENTERPRISE_DETAILS.state} (${ENTERPRISE_DETAILS.stateCode})`,
        );
        doc.text(`GSTIN: ${sellerGstin}`);

        // Buyer (Right Column)
        doc.fontSize(12).font('Helvetica-Bold').text('BUYER', 320, sectionY);
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica-Bold').text(invoice.workspace.name);
        doc.font('Helvetica');

        if (billingDetails) {
          if (billingDetails.legalName) {
            doc.text(`Legal Name: ${billingDetails.legalName}`);
          }
          if (billingDetails.gstin) {
            doc.text(`GSTIN: ${billingDetails.gstin}`);
          }
          if (billingDetails.address) {
            doc.text(`Address: ${billingDetails.address}`);
          }
          if (billingDetails.city) {
            doc.text(`City: ${billingDetails.city}`);
          }
          if (billingDetails.state) {
            doc.text(`State: ${billingDetails.state}`);
          }
          if (billingDetails.postalCode || billingDetails.pincode) {
            doc.text(
              `PIN: ${billingDetails.postalCode || billingDetails.pincode}`,
            );
          }
        }

        doc.y = Math.max(doc.y, sectionY + 90);
        doc.x = 50;
        doc.moveDown(1);

        // Divider
        doc
          .strokeColor('#e5e7eb')
          .lineWidth(1)
          .moveTo(50, doc.y)
          .lineTo(562, doc.y)
          .stroke();
        doc.moveDown(1);

        // Line Items Table Header
        const tableY = doc.y;
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Description', 50, tableY);
        doc.text('Billing Period', 240, tableY);
        doc.text('Taxable Amount', 440, tableY, { align: 'right', width: 120 });
        doc.moveDown(0.5);

        doc
          .strokeColor('#9ca3af')
          .lineWidth(0.5)
          .moveTo(50, doc.y)
          .lineTo(562, doc.y)
          .stroke();
        doc.moveDown(0.5);

        // Line Item
        const itemY = doc.y;
        doc.font('Helvetica');
        doc.text(planName, 50, itemY);
        doc.text(periodStr, 240, itemY);
        doc.text(`INR ${baseAmount}`, 440, itemY, {
          align: 'right',
          width: 120,
        });
        doc.moveDown(1);

        doc
          .strokeColor('#e5e7eb')
          .lineWidth(0.5)
          .moveTo(50, doc.y)
          .lineTo(562, doc.y)
          .stroke();
        doc.moveDown(1);

        // GST Breakdown Table
        const breakdownY = doc.y;
        doc.x = 300;
        doc.fontSize(10).font('Helvetica');

        doc.text('Taxable Base Amount:', 300, doc.y, { width: 140 });
        doc.text(`INR ${baseAmount}`, 440, doc.y - doc.currentLineHeight(), {
          align: 'right',
          width: 120,
        });
        doc.moveDown(0.4);

        if (isInterState) {
          doc.text('Regime: Inter-State', 300, doc.y, { width: 140 });
          doc.moveDown(0.4);
          doc.text('IGST (18%):', 300, doc.y, { width: 140 });
          doc.text(`INR ${totalGst}`, 440, doc.y - doc.currentLineHeight(), {
            align: 'right',
            width: 120,
          });
          doc.moveDown(0.4);
        } else {
          doc.text('Regime: Intra-State', 300, doc.y, { width: 140 });
          doc.moveDown(0.4);
          doc.text('CGST (9%):', 300, doc.y, { width: 140 });
          doc.text(`INR ${cgstAmount}`, 440, doc.y - doc.currentLineHeight(), {
            align: 'right',
            width: 120,
          });
          doc.moveDown(0.4);
          doc.text('SGST (9%):', 300, doc.y, { width: 140 });
          doc.text(`INR ${sgstAmount}`, 440, doc.y - doc.currentLineHeight(), {
            align: 'right',
            width: 120,
          });
          doc.moveDown(0.4);
        }

        doc.text('Total GST (18%):', 300, doc.y, { width: 140 });
        doc.text(`INR ${totalGst}`, 440, doc.y - doc.currentLineHeight(), {
          align: 'right',
          width: 120,
        });
        doc.moveDown(0.6);

        doc
          .strokeColor('#111827')
          .lineWidth(1)
          .moveTo(300, doc.y)
          .lineTo(562, doc.y)
          .stroke();
        doc.moveDown(0.6);

        // Total
        doc.fontSize(12).font('Helvetica-Bold');
        doc.text('Total Amount (GST-Inclusive):', 250, doc.y, { width: 190 });
        doc.text(`INR ${totalAmount}`, 440, doc.y - doc.currentLineHeight(), {
          align: 'right',
          width: 120,
        });
        doc.moveDown(2);

        // Footer
        doc.fontSize(8).font('Helvetica').fillColor('#6b7280');
        doc.text(
          'This is a computer-generated tax invoice issued by Gadmale Technologies. No signature required.',
          50,
          720,
          { align: 'center', width: 512 },
        );

        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
