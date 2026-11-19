import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ReportsController } from './reports.controller';
import { WorkspaceWritableGuard } from '../../billing/guards/workspace-writable.guard';
import { PERMISSION_KEY } from '../../auth/decorators/permission.decorator';
import { AuditAction } from '@agency-os/database';

describe('ReportsController', () => {
  let controller: ReportsController;
  let mockReportsService: any;
  let mockPdfService: any;
  let mockAudit: any;

  beforeEach(() => {
    mockReportsService = {
      getBranding: vi.fn(),
      updateBranding: vi.fn(),
      assembleReportData: vi.fn(),
    };
    mockPdfService = {
      renderClientReportPdf: vi.fn(),
    };
    mockAudit = {
      logAction: vi.fn(),
    };

    controller = new ReportsController(
      mockReportsService,
      mockPdfService,
      mockAudit,
    );
  });

  describe('Guards and Permissions metadata', () => {
    it('decorates updateBranding with WorkspaceWritableGuard', () => {
      const guards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (ReportsController.prototype as any).updateBranding,
        ) || [];
      expect(guards).toContain(WorkspaceWritableGuard);
    });

    it('does NOT decorate getBranding or getClientReport with WorkspaceWritableGuard', () => {
      const getBrandingGuards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (ReportsController.prototype as any).getBranding,
        ) || [];
      const getReportGuards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (ReportsController.prototype as any).getClientReport,
        ) || [];

      expect(getBrandingGuards).not.toContain(WorkspaceWritableGuard);
      expect(getReportGuards).not.toContain(WorkspaceWritableGuard);
    });

    it('requires workspace.view permission for getBranding', () => {
      const permission = Reflect.getMetadata(
        PERMISSION_KEY,
        (ReportsController.prototype as any).getBranding,
      );
      expect(permission).toBe('workspace.view');
    });

    it('requires branding.manage permission for updateBranding', () => {
      const permission = Reflect.getMetadata(
        PERMISSION_KEY,
        (ReportsController.prototype as any).updateBranding,
      );
      expect(permission).toBe('branding.manage');
    });

    it('requires reports.generate permission for getClientReport', () => {
      const permission = Reflect.getMetadata(
        PERMISSION_KEY,
        (ReportsController.prototype as any).getClientReport,
      );
      expect(permission).toBe('reports.generate');
    });
  });

  describe('Endpoint delegations', () => {
    it('delegates getBranding to reportsService.getBranding', async () => {
      mockReportsService.getBranding.mockResolvedValueOnce({
        brandDisplayName: 'Acme',
        brandLogoUrl: null,
        brandAccentColor: null,
      });

      const res = await controller.getBranding('ws-1');
      expect(mockReportsService.getBranding).toHaveBeenCalledWith('ws-1');
      expect(res).toEqual({
        brandDisplayName: 'Acme',
        brandLogoUrl: null,
        brandAccentColor: null,
      });
    });

    it('delegates updateBranding to reportsService.updateBranding', async () => {
      const dto = {
        brandDisplayName: 'Acme Agency',
        brandLogoUrl: 'https://example.com/logo.png',
        brandAccentColor: '#123456',
      };
      mockReportsService.updateBranding.mockResolvedValueOnce({
        brandDisplayName: 'Acme Agency',
        brandLogoUrl: 'https://example.com/logo.png',
        brandAccentColor: '#123456',
      });

      const res = await controller.updateBranding(
        'ws-1',
        { id: 'user-1' },
        dto,
      );
      expect(mockReportsService.updateBranding).toHaveBeenCalledWith(
        'ws-1',
        'user-1',
        dto,
      );
      expect(res.brandDisplayName).toBe('Acme Agency');
    });

    it('assembles data, renders PDF, logs audit, and writes response headers in getClientReport', async () => {
      const mockReportData = {
        workspaceId: 'ws-1',
        workspaceName: 'Acme Workspace',
        period: {
          from: '2026-10-01',
          to: '2026-10-31',
          fromDate: new Date('2026-10-01T00:00:00.000Z'),
          toDate: new Date('2026-10-31T23:59:59.999Z'),
        },
        branding: {
          displayName: 'Acme',
          logoUrl: null,
          accentColor: '#111827',
          whiteLabeled: true,
        },
        totals: { postsPublished: 5, followerGrowth: 100, engagementTotal: 50 },
        accounts: [],
      };
      const mockBuffer = Buffer.from('%PDF-1.4 test report');

      mockReportsService.assembleReportData.mockResolvedValueOnce(
        mockReportData,
      );
      mockPdfService.renderClientReportPdf.mockResolvedValueOnce(mockBuffer);

      const mockRes: any = {
        set: vi.fn(),
        end: vi.fn(),
      };

      await controller.getClientReport(
        'ws-1',
        { id: 'user-1' },
        { from: '2026-10-01', to: '2026-10-31', socialAccountId: 'acc-1' },
        mockRes,
      );

      expect(mockReportsService.assembleReportData).toHaveBeenCalledWith(
        'ws-1',
        '2026-10-01',
        '2026-10-31',
        'acc-1',
      );
      expect(mockPdfService.renderClientReportPdf).toHaveBeenCalledWith(
        mockReportData,
      );
      expect(mockAudit.logAction).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: AuditAction.REPORT_GENERATED,
        targetType: 'WORKSPACE',
        targetId: 'ws-1',
        metadata: {
          from: '2026-10-01',
          to: '2026-10-31',
          socialAccountId: 'acc-1',
        },
      });

      expect(mockRes.set).toHaveBeenCalledWith({
        'Content-Type': 'application/pdf',
        'Content-Disposition':
          'attachment; filename="client-report-ws-1-2026-10-01-2026-10-31.pdf"',
        'Content-Length': mockBuffer.length.toString(),
      });
      expect(mockRes.end).toHaveBeenCalledWith(mockBuffer);
    });
  });
});
