import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportsService } from './services/reports.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('ReportsService Client Scoping & Branding Fallback', () => {
  let service: ReportsService;
  let mockPrisma: any;
  let mockAudit: any;

  beforeEach(() => {
    mockPrisma = {
      workspace: {
        findUnique: vi.fn(),
      },
      client: {
        findFirst: vi.fn(),
      },
      socialAccount: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
      },
      postPlatformVariant: {
        count: vi.fn().mockResolvedValue(0),
      },
      accountMetricDaily: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    mockAudit = {
      logAction: vi.fn().mockResolvedValue(undefined),
    };

    service = new ReportsService(mockPrisma, mockAudit);
  });

  it('throws 400 BadRequestException if both clientId and socialAccountId are provided', async () => {
    await expect(
      service.assembleReportData(
        'ws-1',
        '2026-10-01',
        '2026-10-31',
        'acc-1',
        'client-1',
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'clientId and socialAccountId cannot be used together.',
      ),
    );
  });

  it('throws 404 NotFoundException if clientId is specified but not found in workspace', async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({
      id: 'ws-1',
      name: 'Agency Workspace',
    });
    mockPrisma.client.findFirst.mockResolvedValue(null);

    await expect(
      service.assembleReportData(
        'ws-1',
        '2026-10-01',
        '2026-10-31',
        undefined,
        'nonexistent-client',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('uses client branding when client.brandDisplayName is set (whiteLabeled: true)', async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({
      id: 'ws-1',
      name: 'Agency Workspace',
      brandDisplayName: 'Workspace Brand',
      brandLogoUrl: 'https://agency.com/logo.png',
      brandAccentColor: '#111111',
    });
    mockPrisma.client.findFirst.mockResolvedValue({
      id: 'client-1',
      name: 'Client Corp',
      brandDisplayName: 'Client Custom Brand',
      brandLogoUrl: 'https://client.com/logo.png',
      brandAccentColor: '#222222',
    });
    mockPrisma.socialAccount.findMany.mockResolvedValue([]);

    const data = await service.assembleReportData(
      'ws-1',
      '2026-10-01',
      '2026-10-31',
      undefined,
      'client-1',
    );

    expect(data.branding).toEqual({
      displayName: 'Client Custom Brand',
      logoUrl: 'https://client.com/logo.png',
      accentColor: '#222222',
      whiteLabeled: true,
    });
  });

  it('falls back to workspace branding when client.brandDisplayName is not set but workspace has branding', async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({
      id: 'ws-1',
      name: 'Agency Workspace',
      brandDisplayName: 'Workspace Brand',
      brandLogoUrl: 'https://agency.com/logo.png',
      brandAccentColor: '#111111',
    });
    mockPrisma.client.findFirst.mockResolvedValue({
      id: 'client-1',
      name: 'Client Corp',
      brandDisplayName: null,
      brandLogoUrl: null,
      brandAccentColor: null,
    });
    mockPrisma.socialAccount.findMany.mockResolvedValue([]);

    const data = await service.assembleReportData(
      'ws-1',
      '2026-10-01',
      '2026-10-31',
      undefined,
      'client-1',
    );

    expect(data.branding).toEqual({
      displayName: 'Workspace Brand',
      logoUrl: 'https://agency.com/logo.png',
      accentColor: '#111111',
      whiteLabeled: true,
    });
  });

  it('falls back to platform default when neither client nor workspace has brandDisplayName (whiteLabeled: false)', async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({
      id: 'ws-1',
      name: 'Agency Workspace',
      brandDisplayName: null,
      brandLogoUrl: null,
      brandAccentColor: null,
    });
    mockPrisma.client.findFirst.mockResolvedValue({
      id: 'client-1',
      name: 'Client Corp',
      brandDisplayName: null,
      brandLogoUrl: null,
      brandAccentColor: null,
    });
    mockPrisma.socialAccount.findMany.mockResolvedValue([]);

    const data = await service.assembleReportData(
      'ws-1',
      '2026-10-01',
      '2026-10-31',
      undefined,
      'client-1',
    );

    expect(data.branding).toEqual({
      displayName: 'Agency Workspace',
      logoUrl: null,
      accentColor: '#111827',
      whiteLabeled: false,
    });
  });
});
