import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  PrismaClient,
  Prisma,
  PostStatus,
  AuditAction,
} from '@agency-os/database';
import { AuditService } from '../../core/audit.service';
import { UpdateBrandingDto } from '../dto/report.dto';

export interface ReportAccountData {
  id: string;
  provider: string;
  name: string;
  postsPublished: number;
  followersStart: number | null;
  followersEnd: number | null;
  followerGrowth: number | null;
  engagementTotal: number | null;
  hasMetrics: boolean;
}

export interface ReportBranding {
  displayName: string;
  logoUrl: string | null;
  accentColor: string;
  whiteLabeled: boolean;
}

export interface ReportData {
  workspaceId: string;
  workspaceName: string;
  period: {
    from: string;
    to: string;
    fromDate: Date;
    toDate: Date;
  };
  branding: ReportBranding;
  accounts: ReportAccountData[];
  totals: {
    postsPublished: number;
    followerGrowth: number;
    engagementTotal: number;
  };
}

export interface WorkspaceBrandingResult {
  brandDisplayName: string | null;
  brandLogoUrl: string | null;
  brandAccentColor: string | null;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async getBranding(workspaceId: string): Promise<WorkspaceBrandingResult> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        brandDisplayName: true,
        brandLogoUrl: true,
        brandAccentColor: true,
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return {
      brandDisplayName: workspace.brandDisplayName,
      brandLogoUrl: workspace.brandLogoUrl,
      brandAccentColor: workspace.brandAccentColor,
    };
  }

  async updateBranding(
    workspaceId: string,
    actorId: string,
    dto: UpdateBrandingDto,
  ): Promise<WorkspaceBrandingResult> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    if (
      dto.brandLogoUrl !== undefined &&
      dto.brandLogoUrl !== null &&
      dto.brandLogoUrl !== ''
    ) {
      try {
        const parsed = new URL(dto.brandLogoUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new BadRequestException(
            'brandLogoUrl must be a valid http or https URL.',
          );
        }
      } catch {
        throw new BadRequestException(
          'brandLogoUrl must be a valid http or https URL.',
        );
      }
    }

    if (
      dto.brandAccentColor !== undefined &&
      dto.brandAccentColor !== null &&
      dto.brandAccentColor !== ''
    ) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(dto.brandAccentColor)) {
        throw new BadRequestException(
          'brandAccentColor must match /^#[0-9A-Fa-f]{6}$/',
        );
      }
    }

    const data: Prisma.WorkspaceUpdateInput = {};
    if (dto.brandDisplayName !== undefined) {
      data.brandDisplayName =
        dto.brandDisplayName.trim() === '' ? null : dto.brandDisplayName.trim();
    }
    if (dto.brandLogoUrl !== undefined) {
      data.brandLogoUrl =
        dto.brandLogoUrl.trim() === '' ? null : dto.brandLogoUrl.trim();
    }
    if (dto.brandAccentColor !== undefined) {
      data.brandAccentColor =
        dto.brandAccentColor.trim() === '' ? null : dto.brandAccentColor.trim();
    }

    const updated = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data,
      select: {
        brandDisplayName: true,
        brandLogoUrl: true,
        brandAccentColor: true,
      },
    });

    await this.audit.logAction({
      workspaceId,
      actorId,
      action: AuditAction.WORKSPACE_BRANDING_UPDATED,
      targetType: 'WORKSPACE',
      targetId: workspaceId,
      metadata: {
        brandDisplayName: updated.brandDisplayName,
        brandLogoUrl: updated.brandLogoUrl,
        brandAccentColor: updated.brandAccentColor,
      },
    });

    return {
      brandDisplayName: updated.brandDisplayName,
      brandLogoUrl: updated.brandLogoUrl,
      brandAccentColor: updated.brandAccentColor,
    };
  }

  async assembleReportData(
    workspaceId: string,
    from: string,
    to: string,
    socialAccountId?: string,
    clientId?: string,
  ): Promise<ReportData> {
    if (clientId && socialAccountId) {
      throw new BadRequestException(
        'clientId and socialAccountId cannot be used together.',
      );
    }
    const fromDate = new Date(`${from.slice(0, 10)}T00:00:00.000Z`);
    const toDate = new Date(`${to.slice(0, 10)}T23:59:59.999Z`);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid report date range.');
    }
    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('Invalid report date range.');
    }

    const diffMs = toDate.getTime() - fromDate.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays > 366) {
      throw new BadRequestException('Invalid report date range.');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        brandDisplayName: true,
        brandLogoUrl: true,
        brandAccentColor: true,
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    let client: {
      id: string;
      name: string;
      brandDisplayName: string | null;
      brandLogoUrl: string | null;
      brandAccentColor: string | null;
    } | null = null;

    let accounts: Array<{
      id: string;
      provider: string;
      externalId: string;
      name: string | null;
    }>;

    if (clientId) {
      client = await this.prisma.client.findFirst({
        where: { id: clientId, workspaceId },
        select: {
          id: true,
          name: true,
          brandDisplayName: true,
          brandLogoUrl: true,
          brandAccentColor: true,
        },
      });
      if (!client) {
        throw new NotFoundException('Client not found');
      }
      accounts = await this.prisma.socialAccount.findMany({
        where: { workspaceId, clientId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, provider: true, externalId: true, name: true },
      });
    } else if (socialAccountId) {
      const account = await this.prisma.socialAccount.findFirst({
        where: { id: socialAccountId, workspaceId },
        select: { id: true, provider: true, externalId: true, name: true },
      });
      if (!account) {
        throw new NotFoundException('Social account not found');
      }
      accounts = [account];
    } else {
      accounts = await this.prisma.socialAccount.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, provider: true, externalId: true, name: true },
      });
    }

    const accountsData: ReportAccountData[] = [];

    for (const account of accounts) {
      const postsPublished = await this.prisma.postPlatformVariant.count({
        where: {
          workspaceId,
          socialAccountId: account.id,
          status: PostStatus.PUBLISHED,
          publishedAt: {
            gte: fromDate,
            lte: toDate,
          },
        },
      });

      const metrics = await this.prisma.accountMetricDaily.findMany({
        where: {
          socialAccountId: account.id,
          date: {
            gte: fromDate,
            lte: toDate,
          },
        },
        orderBy: { date: 'asc' },
        select: {
          followers: true,
          engagement: true,
        },
      });

      if (metrics.length > 0) {
        const followersStart = metrics[0].followers;
        const followersEnd = metrics[metrics.length - 1].followers;
        const followerGrowth = followersEnd - followersStart;
        const engagementTotal = metrics.reduce(
          (sum, r) => sum + r.engagement,
          0,
        );

        accountsData.push({
          id: account.id,
          provider: account.provider,
          name: account.name || `${account.provider}${account.externalId}`,
          postsPublished,
          followersStart,
          followersEnd,
          followerGrowth,
          engagementTotal,
          hasMetrics: true,
        });
      } else {
        accountsData.push({
          id: account.id,
          provider: account.provider,
          name: account.name || `${account.provider}${account.externalId}`,
          postsPublished,
          followersStart: null,
          followersEnd: null,
          followerGrowth: null,
          engagementTotal: null,
          hasMetrics: false,
        });
      }
    }

    const totalPosts = accountsData.reduce(
      (sum, a) => sum + a.postsPublished,
      0,
    );
    const totalFollowerGrowth = accountsData
      .filter((a) => a.hasMetrics)
      .reduce((sum, a) => sum + (a.followerGrowth ?? 0), 0);
    const totalEngagement = accountsData
      .filter((a) => a.hasMetrics)
      .reduce((sum, a) => sum + (a.engagementTotal ?? 0), 0);

    let branding: ReportBranding;
    if (client?.brandDisplayName) {
      branding = {
        displayName: client.brandDisplayName,
        logoUrl: client.brandLogoUrl || workspace.brandLogoUrl,
        accentColor:
          client.brandAccentColor || workspace.brandAccentColor || '#111827',
        whiteLabeled: true,
      };
    } else if (workspace.brandDisplayName) {
      branding = {
        displayName: workspace.brandDisplayName,
        logoUrl: workspace.brandLogoUrl,
        accentColor: workspace.brandAccentColor || '#111827',
        whiteLabeled: true,
      };
    } else {
      branding = {
        displayName: workspace.name,
        logoUrl: null,
        accentColor: '#111827',
        whiteLabeled: false,
      };
    }

    return {
      workspaceId,
      workspaceName: workspace.name,
      period: {
        from: from.slice(0, 10),
        to: to.slice(0, 10),
        fromDate,
        toDate,
      },
      branding,
      accounts: accountsData,
      totals: {
        postsPublished: totalPosts,
        followerGrowth: totalFollowerGrowth,
        engagementTotal: totalEngagement,
      },
    };
  }
}
