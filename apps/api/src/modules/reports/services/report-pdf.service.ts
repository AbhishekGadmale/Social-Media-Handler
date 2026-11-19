import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { ReportData } from './reports.service';

@Injectable()
export class ReportPdfService {
  async renderClientReportPdf(data: ReportData): Promise<Buffer> {
    let logoBuffer: Buffer | null = null;

    if (data.branding.logoUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(data.branding.logoUrl, {
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const ct = (res.headers.get('content-type') || '').toLowerCase();
          if (
            ct.includes('image/png') ||
            ct.includes('image/jpeg') ||
            ct.includes('image/jpg')
          ) {
            const ab = await res.arrayBuffer();
            logoBuffer = Buffer.from(ab);
          }
        }
      } catch {
        // Silently fall back to name-only; never fail the report over a logo
      }
    }

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 40,
          compress: false,
          info: {
            Title: `${data.workspaceName} — Social Media Report`,
            Producer: data.branding.whiteLabeled
              ? data.branding.displayName
              : 'Agency OS',
            Creator: data.branding.whiteLabeled
              ? data.branding.displayName
              : 'Agency OS',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => reject(err));

        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        const accentColor = data.branding.accentColor || '#111827';

        // 1. Header band in accent color
        const headerHeight = 70;
        doc.rect(0, 0, pageWidth, headerHeight).fill(accentColor);

        let textStartX = 40;
        if (logoBuffer) {
          try {
            doc.image(logoBuffer, 40, 15, { fit: [40, 40] });
            textStartX = 90;
          } catch {
            // If image corrupt, continue with text only
            textStartX = 40;
          }
        }

        doc
          .fillColor('#FFFFFF')
          .fontSize(20)
          .font('Helvetica-Bold')
          .text(data.branding.displayName, textStartX, 24);

        // 2. Title & Period
        const contentStartY = headerHeight + 25;
        doc
          .fillColor('#111827')
          .fontSize(16)
          .font('Helvetica-Bold')
          .text(
            `${data.workspaceName} — Social Media Report`,
            40,
            contentStartY,
          );

        doc
          .fillColor('#4B5563')
          .fontSize(10)
          .font('Helvetica')
          .text(
            `Period: ${data.period.from} to ${data.period.to}`,
            40,
            contentStartY + 24,
          );

        // 3. Summary Cards
        const summaryY = contentStartY + 50;
        const cardWidth = 160;
        const cardHeight = 55;
        const gap = (515 - cardWidth * 3) / 2;

        const summaryMetrics = [
          {
            label: 'Posts published',
            value: String(data.totals.postsPublished),
          },
          {
            label: 'Follower growth',
            value:
              data.totals.followerGrowth > 0
                ? `+${data.totals.followerGrowth}`
                : String(data.totals.followerGrowth),
          },
          {
            label: 'Total engagement',
            value: String(data.totals.engagementTotal),
          },
        ];

        summaryMetrics.forEach((metric, index) => {
          const cardX = 40 + index * (cardWidth + gap);
          doc
            .roundedRect(cardX, summaryY, cardWidth, cardHeight, 4)
            .fillAndStroke('#F9FAFB', '#E5E7EB');

          doc
            .fillColor('#6B7280')
            .fontSize(9)
            .font('Helvetica')
            .text(metric.label, cardX + 12, summaryY + 10);

          doc
            .fillColor('#111827')
            .fontSize(16)
            .font('Helvetica-Bold')
            .text(metric.value, cardX + 12, summaryY + 26);
        });

        // 4. Accounts Table
        const tableY = summaryY + cardHeight + 30;
        doc
          .fillColor('#111827')
          .fontSize(12)
          .font('Helvetica-Bold')
          .text('Account Performance', 40, tableY);

        const colX = {
          account: 40,
          provider: 160,
          posts: 225,
          followers: 275,
          growth: 405,
          engagement: 470,
        };

        const headerRowY = tableY + 20;
        doc.rect(40, headerRowY, 515, 22).fill('#F3F4F6');

        doc
          .fillColor('#374151')
          .fontSize(8.5)
          .font('Helvetica-Bold')
          .text('Account', colX.account + 6, headerRowY + 6)
          .text('Provider', colX.provider, headerRowY + 6)
          .text('Posts', colX.posts, headerRowY + 6)
          .text('Followers (start -> end)', colX.followers, headerRowY + 6)
          .text('Growth', colX.growth, headerRowY + 6)
          .text('Engagement', colX.engagement, headerRowY + 6);

        let currentRowY = headerRowY + 22;

        if (data.accounts.length === 0) {
          doc
            .fillColor('#6B7280')
            .fontSize(9)
            .font('Helvetica')
            .text('No accounts connected to workspace.', 46, currentRowY + 8);
        } else {
          for (const account of data.accounts) {
            doc.rect(40, currentRowY, 515, 24).stroke('#E5E7EB');

            const followersStr = account.hasMetrics
              ? `${account.followersStart} -> ${account.followersEnd}`
              : 'No data';

            const growthStr = account.hasMetrics
              ? account.followerGrowth! > 0
                ? `+${account.followerGrowth}`
                : String(account.followerGrowth)
              : 'No data';

            const engagementStr = account.hasMetrics
              ? String(account.engagementTotal)
              : 'No data';

            doc
              .fillColor('#111827')
              .fontSize(8.5)
              .font('Helvetica')
              .text(account.name, colX.account + 6, currentRowY + 7, {
                width: 110,
                ellipsis: true,
              })
              .text(account.provider, colX.provider, currentRowY + 7)
              .text(String(account.postsPublished), colX.posts, currentRowY + 7)
              .text(followersStr, colX.followers, currentRowY + 7)
              .text(growthStr, colX.growth, currentRowY + 7)
              .text(engagementStr, colX.engagement, currentRowY + 7);

            currentRowY += 24;
          }
        }

        // 5. Footer
        const footerY = pageHeight - 35;
        doc
          .moveTo(40, footerY - 10)
          .lineTo(555, footerY - 10)
          .stroke('#E5E7EB');

        const footerText = data.branding.whiteLabeled
          ? data.branding.displayName
          : `${data.branding.displayName} • Generated with Agency OS`;

        doc
          .fillColor('#9CA3AF')
          .fontSize(8.5)
          .font('Helvetica')
          .text(footerText, 40, footerY, {
            width: 515,
            align: 'center',
          });

        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
