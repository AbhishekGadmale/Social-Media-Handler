import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { PrismaClient, PostStatus, AuditAction } from '@agency-os/database';
import { AuditService } from '../../core/audit.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ReportsService', () => {
  let service: ReportsService;
  let prismaMock: any;
  let auditMock: any;

  beforeEach(async () => {
    prismaMock = {
      workspace: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      socialAccount: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      postPlatformVariant: {
        count: vi.fn(),
      },
      accountMetricDaily: {
        findMany: vi.fn(),
      },
    };

    auditMock = {
      logAction: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: PrismaClient,
          useValue: prismaMock,
        },
        {
          provide: AuditService,
          useValue: auditMock,
        },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  describe('getBranding', () => {
    it('returns branding for workspace', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({
        brandDisplayName: 'Acme Agency',
        brandLogoUrl: 'https://example.com/logo.png',
        brandAccentColor: '#FF5500',
      });

      const result = await service.getBranding('ws-1');

      expect(result).toEqual({
        brandDisplayName: 'Acme Agency',
        brandLogoUrl: 'https://example.com/logo.png',
        brandAccentColor: '#FF5500',
      });
      expect(prismaMock.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        select: {
          brandDisplayName: true,
          brandLogoUrl: true,
          brandAccentColor: true,
        },
      });
    });

    it('returns nulls when branding fields are unset', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({
        brandDisplayName: null,
        brandLogoUrl: null,
        brandAccentColor: null,
      });

      const result = await service.getBranding('ws-1');

      expect(result).toEqual({
        brandDisplayName: null,
        brandLogoUrl: null,
        brandAccentColor: null,
      });
    });

    it('throws NotFoundException when workspace does not exist', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue(null);

      await expect(service.getBranding('ws-none')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateBranding', () => {
    it('updates branding, logs audit action, and returns updated branding', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({ id: 'ws-1' });
      prismaMock.workspace.update.mockResolvedValue({
        brandDisplayName: 'Nova Brand',
        brandLogoUrl: 'https://cdn.example.com/logo.png',
        brandAccentColor: '#3B82F6',
      });

      const result = await service.updateBranding('ws-1', 'user-1', {
        brandDisplayName: 'Nova Brand',
        brandLogoUrl: 'https://cdn.example.com/logo.png',
        brandAccentColor: '#3B82F6',
      });

      expect(result).toEqual({
        brandDisplayName: 'Nova Brand',
        brandLogoUrl: 'https://cdn.example.com/logo.png',
        brandAccentColor: '#3B82F6',
      });

      expect(prismaMock.workspace.update).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        data: {
          brandDisplayName: 'Nova Brand',
          brandLogoUrl: 'https://cdn.example.com/logo.png',
          brandAccentColor: '#3B82F6',
        },
        select: {
          brandDisplayName: true,
          brandLogoUrl: true,
          brandAccentColor: true,
        },
      });

      expect(auditMock.logAction).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: AuditAction.WORKSPACE_BRANDING_UPDATED,
        targetType: 'WORKSPACE',
        targetId: 'ws-1',
        metadata: {
          brandDisplayName: 'Nova Brand',
          brandLogoUrl: 'https://cdn.example.com/logo.png',
          brandAccentColor: '#3B82F6',
        },
      });
    });

    it('clears fields to null when given empty strings', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({ id: 'ws-1' });
      prismaMock.workspace.update.mockResolvedValue({
        brandDisplayName: null,
        brandLogoUrl: null,
        brandAccentColor: null,
      });

      const result = await service.updateBranding('ws-1', 'user-1', {
        brandDisplayName: '   ',
        brandLogoUrl: '',
        brandAccentColor: '',
      });

      expect(prismaMock.workspace.update).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        data: {
          brandDisplayName: null,
          brandLogoUrl: null,
          brandAccentColor: null,
        },
        select: {
          brandDisplayName: true,
          brandLogoUrl: true,
          brandAccentColor: true,
        },
      });

      expect(result).toEqual({
        brandDisplayName: null,
        brandLogoUrl: null,
        brandAccentColor: null,
      });
    });

    it('rejects invalid URL for brandLogoUrl', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({ id: 'ws-1' });

      await expect(
        service.updateBranding('ws-1', 'user-1', {
          brandLogoUrl: 'ftp://not-http.com/logo.png',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateBranding('ws-1', 'user-1', {
          brandLogoUrl: 'just-a-string',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid hex code for brandAccentColor', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({ id: 'ws-1' });

      await expect(
        service.updateBranding('ws-1', 'user-1', {
          brandAccentColor: '#123',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateBranding('ws-1', 'user-1', {
          brandAccentColor: 'blue',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateBranding('ws-1', 'user-1', {
          brandAccentColor: '#ZZZZZZ',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when workspace does not exist', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue(null);

      await expect(
        service.updateBranding('ws-none', 'user-1', {
          brandDisplayName: 'Test',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('assembleReportData', () => {
    it('correctly assembles metrics, math, published counts, and totals across accounts', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        name: 'Alpha Marketing',
        brandDisplayName: 'Alpha Branding Agency',
        brandLogoUrl: 'https://example.com/logo.png',
        brandAccentColor: '#0055FF',
      });

      prismaMock.socialAccount.findMany.mockResolvedValue([
        {
          id: 'acc-1',
          provider: 'LINKEDIN',
          externalId: 'ext-1',
          name: 'Alpha LinkedIn Page',
        },
        {
          id: 'acc-2',
          provider: 'YOUTUBE',
          externalId: 'ext-2',
          name: null,
        },
      ]);

      // Account 1: 3 published posts
      prismaMock.postPlatformVariant.count
        .mockResolvedValueOnce(3) // acc-1
        .mockResolvedValueOnce(1); // acc-2

      // Account 1: 3 days of metrics
      prismaMock.accountMetricDaily.findMany
        .mockResolvedValueOnce([
          { followers: 1000, engagement: 25 },
          { followers: 1060, engagement: 35 },
          { followers: 1120, engagement: 40 },
        ]) // acc-1
        .mockResolvedValueOnce([]); // acc-2: no metrics

      const report = await service.assembleReportData(
        'ws-1',
        '2026-01-01',
        '2026-01-31',
      );

      expect(report.workspaceId).toBe('ws-1');
      expect(report.workspaceName).toBe('Alpha Marketing');
      expect(report.period.from).toBe('2026-01-01');
      expect(report.period.to).toBe('2026-01-31');

      // Branding check
      expect(report.branding).toEqual({
        displayName: 'Alpha Branding Agency',
        logoUrl: 'https://example.com/logo.png',
        accentColor: '#0055FF',
        whiteLabeled: true,
      });

      // Account 1 check
      expect(report.accounts[0]).toEqual({
        id: 'acc-1',
        provider: 'LINKEDIN',
        name: 'Alpha LinkedIn Page',
        postsPublished: 3,
        followersStart: 1000,
        followersEnd: 1120,
        followerGrowth: 120,
        engagementTotal: 100,
        hasMetrics: true,
      });

      // Account 2 check: no metrics -> nulls, fallback name
      expect(report.accounts[1]).toEqual({
        id: 'acc-2',
        provider: 'YOUTUBE',
        name: 'YOUTUBEext-2',
        postsPublished: 1,
        followersStart: null,
        followersEnd: null,
        followerGrowth: null,
        engagementTotal: null,
        hasMetrics: false,
      });

      // Totals check: posts = 3 + 1 = 4; followers/engagement only over accounts with metrics
      expect(report.totals).toEqual({
        postsPublished: 4,
        followerGrowth: 120,
        engagementTotal: 100,
      });

      // Verify published query bounds
      expect(prismaMock.postPlatformVariant.count).toHaveBeenCalledWith({
        where: {
          workspaceId: 'ws-1',
          socialAccountId: 'acc-1',
          status: PostStatus.PUBLISHED,
          publishedAt: {
            gte: new Date('2026-01-01T00:00:00.000Z'),
            lte: new Date('2026-01-31T23:59:59.999Z'),
          },
        },
      });
    });

    it('resolves branding fallback to workspace name, whiteLabeled false, and default accent', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        name: 'Original Name',
        brandDisplayName: null,
        brandLogoUrl: null,
        brandAccentColor: null,
      });

      prismaMock.socialAccount.findMany.mockResolvedValue([]);

      const report = await service.assembleReportData(
        'ws-1',
        '2026-02-01',
        '2026-02-15',
      );

      expect(report.branding).toEqual({
        displayName: 'Original Name',
        logoUrl: null,
        accentColor: '#111827',
        whiteLabeled: false,
      });
    });

    it('scopes query to a single social account when socialAccountId is specified', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        name: 'WS',
        brandDisplayName: null,
        brandLogoUrl: null,
        brandAccentColor: null,
      });

      prismaMock.socialAccount.findFirst.mockResolvedValue({
        id: 'acc-target',
        provider: 'LINKEDIN',
        externalId: 'xyz',
        name: 'Target Account',
      });

      prismaMock.postPlatformVariant.count.mockResolvedValue(2);
      prismaMock.accountMetricDaily.findMany.mockResolvedValue([
        { followers: 500, engagement: 10 },
      ]);

      const report = await service.assembleReportData(
        'ws-1',
        '2026-01-01',
        '2026-01-10',
        'acc-target',
      );

      expect(prismaMock.socialAccount.findFirst).toHaveBeenCalledWith({
        where: { id: 'acc-target', workspaceId: 'ws-1' },
        select: { id: true, provider: true, externalId: true, name: true },
      });
      expect(report.accounts).toHaveLength(1);
      expect(report.accounts[0].id).toBe('acc-target');
      expect(report.totals.postsPublished).toBe(2);
      expect(report.totals.followerGrowth).toBe(0);
      expect(report.totals.engagementTotal).toBe(10);
    });

    it('throws NotFoundException when socialAccountId does not belong to workspace', async () => {
      prismaMock.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        name: 'WS',
      });
      prismaMock.socialAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.assembleReportData(
          'ws-1',
          '2026-01-01',
          '2026-01-10',
          'acc-foreign',
        ),
      ).rejects.toThrow(new NotFoundException('Social account not found'));
    });

    it('rejects invalid date range when from > to', async () => {
      await expect(
        service.assembleReportData('ws-1', '2026-02-01', '2026-01-01'),
      ).rejects.toThrow(new BadRequestException('Invalid report date range.'));
    });

    it('rejects range exceeding 366 days', async () => {
      await expect(
        service.assembleReportData('ws-1', '2025-01-01', '2026-02-01'),
      ).rejects.toThrow(new BadRequestException('Invalid report date range.'));
    });

    it('rejects unparseable date strings', async () => {
      await expect(
        service.assembleReportData('ws-1', 'not-a-date', '2026-01-01'),
      ).rejects.toThrow(new BadRequestException('Invalid report date range.'));
    });
  });
});
