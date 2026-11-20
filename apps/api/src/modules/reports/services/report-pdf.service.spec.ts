import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReportPdfService } from './report-pdf.service';
import { ReportData } from './reports.service';

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

describe('ReportPdfService', () => {
  const service = new ReportPdfService();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseReportData: ReportData = {
    workspaceId: 'ws-1',
    workspaceName: 'Acme Growth Labs',
    period: {
      from: '2026-10-01',
      to: '2026-10-31',
      fromDate: new Date('2026-10-01T00:00:00.000Z'),
      toDate: new Date('2026-10-31T23:59:59.999Z'),
    },
    branding: {
      displayName: 'Acme Digital Agency',
      logoUrl: null,
      accentColor: '#4F46E5',
      whiteLabeled: true,
    },
    totals: {
      postsPublished: 12,
      followerGrowth: 450,
      engagementTotal: 3200,
    },
    accounts: [
      {
        id: 'acc-1',
        name: 'Acme Twitter',
        provider: 'TWITTER',
        hasMetrics: true,
        postsPublished: 8,
        followersStart: 1200,
        followersEnd: 1500,
        followerGrowth: 300,
        engagementTotal: 2100,
      },
      {
        id: 'acc-2',
        name: 'Acme LinkedIn',
        provider: 'LINKEDIN',
        hasMetrics: true,
        postsPublished: 4,
        followersStart: 800,
        followersEnd: 950,
        followerGrowth: 150,
        engagementTotal: 1100,
      },
      {
        id: 'acc-3',
        name: 'Acme YouTube (New)',
        provider: 'YOUTUBE',
        hasMetrics: false,
        postsPublished: 0,
        followersStart: null,
        followersEnd: null,
        followerGrowth: null,
        engagementTotal: null,
      },
    ],
  };

  it('generates a valid PDF buffer starting with %PDF', async () => {
    const pdf = await service.renderClientReportPdf(baseReportData);
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.subarray(0, 4).toString('utf-8')).toBe('%PDF');
  });

  it('renders a white-labeled report without Agency OS or Gadmale strings anywhere in buffer', async () => {
    const pdf = await service.renderClientReportPdf(baseReportData);
    const rawBufferStr = pdf.toString('latin1');
    const pdfText = extractTextFromPdf(pdf);

    expect(pdfText).toContain('Acme Digital Agency');
    expect(pdfText).toContain('Acme Growth Labs');
    expect(pdfText).toContain('Period: 2026-10-01 to 2026-10-31');

    // White-label mandate: strings "Agency OS" and "Gadmale" must not appear anywhere in doc, including raw buffer
    expect(rawBufferStr).not.toContain('Agency OS');
    expect(rawBufferStr).not.toContain('Gadmale');
    expect(pdfText).not.toContain('Agency OS');
    expect(pdfText).not.toContain('Gadmale');
  });

  it('renders default branding with Agency OS footer and metadata when not white-labeled', async () => {
    const unbrandedData: ReportData = {
      ...baseReportData,
      branding: {
        displayName: 'Acme Growth Labs',
        logoUrl: null,
        accentColor: '#111827',
        whiteLabeled: false,
      },
    };

    const pdf = await service.renderClientReportPdf(unbrandedData);
    const rawBufferStr = pdf.toString('latin1');
    const pdfText = extractTextFromPdf(pdf);

    expect(pdfText).toContain('Generated with Agency OS');
    expect(rawBufferStr).toContain('Agency OS');
    expect(rawBufferStr).not.toContain('Gadmale');
  });

  it('silently falls back when logoUrl fetch fails or times out without throwing error', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Network error'));

    const dataWithLogo: ReportData = {
      ...baseReportData,
      branding: {
        ...baseReportData.branding,
        logoUrl: 'https://example.com/logo.png',
      },
    };

    const pdf = await service.renderClientReportPdf(dataWithLogo);
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.subarray(0, 4).toString('utf-8')).toBe('%PDF');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('renders accounts with and without metrics correctly (No data for unmeasured)', async () => {
    const pdf = await service.renderClientReportPdf(baseReportData);
    const pdfText = extractTextFromPdf(pdf);

    // Measured account checks
    expect(pdfText).toContain('Acme Twitter');
    expect(pdfText).toContain('1200 -> 1500');
    expect(pdfText).toContain('+300');
    expect(pdfText).toContain('2100');

    // Unmeasured account checks
    expect(pdfText).toContain('Acme YouTube');
    expect(pdfText).toContain('No data');
  });

  it('renders empty state message when workspace has no accounts', async () => {
    const emptyAccountsData: ReportData = {
      ...baseReportData,
      accounts: [],
      totals: {
        postsPublished: 0,
        followerGrowth: 0,
        engagementTotal: 0,
      },
    };

    const pdf = await service.renderClientReportPdf(emptyAccountsData);
    const pdfText = extractTextFromPdf(pdf);

    expect(pdfText).toContain('No accounts connected to workspace.');
  });

  it('paginates and repeats table header across pages when accounts exceed 25 without losing rows', async () => {
    const manyAccounts = Array.from({ length: 30 }, (_, i) => ({
      id: `acc-${i + 1}`,
      name: `Client Account ${i + 1}`,
      provider: 'INSTAGRAM',
      hasMetrics: true,
      postsPublished: i + 1,
      followersStart: 1000 + i * 10,
      followersEnd: 1100 + i * 10,
      followerGrowth: 100,
      engagementTotal: 500 + i * 5,
    }));

    const paginatedReportData: ReportData = {
      ...baseReportData,
      accounts: manyAccounts,
    };

    const pdf = await service.renderClientReportPdf(paginatedReportData);
    expect(pdf).toBeInstanceOf(Buffer);

    const rawStr = pdf.toString('latin1');
    const pageMatches = rawStr.match(/\/Type\s*\/Page\b/g);
    expect(pageMatches).not.toBeNull();
    expect(pageMatches!.length).toBeGreaterThanOrEqual(2);

    const pdfText = extractTextFromPdf(pdf);

    // Every single row is preserved across pages
    for (let i = 1; i <= 30; i++) {
      expect(pdfText).toContain(`Client Account ${i}`);
    }

    // Table header is repeated on each page
    const headerMatches = pdfText.match(/Followers \(start -> end\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBeGreaterThanOrEqual(2);
  });
});
