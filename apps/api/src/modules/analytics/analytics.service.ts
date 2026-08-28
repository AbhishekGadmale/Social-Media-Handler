import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, Prisma, SocialAccountStatus } from '@agency-os/database';
import { WorkspaceScopedRepository } from '@agency-os/database';

export interface OverviewMetrics {
  workspaceId: string;
  accountsConnected: number;
  accountsActive: number;
  accountsRequiringReauth: number;
  totalFollowers: number;
  totalEngagement: number;
  accounts: Array<{
    id: string;
    provider: string;
    name: string | null;
    status: SocialAccountStatus;
    latestMetrics: {
      date: Date;
      followers: number;
      engagement: number;
    } | null;
  }>;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  async getWorkspaceOverview(workspaceId: string): Promise<OverviewMetrics> {
    const repo = new WorkspaceScopedRepository<
      Prisma.SocialAccountDelegate,
      any,
      Prisma.SocialAccountWhereInput,
      Prisma.SocialAccountCreateInput,
      Prisma.SocialAccountUpdateInput
    >(this.prisma, this.prisma.socialAccount, workspaceId);

    const accounts = await repo.findMany({
      select: {
        id: true,
        provider: true,
        name: true,
        status: true,
        metrics: {
          orderBy: { date: 'desc' },
          take: 1,
          select: {
            date: true,
            followers: true,
            engagement: true,
          },
        },
      },
    });

    let totalFollowers = 0;
    let totalEngagement = 0;
    let accountsActive = 0;
    let accountsRequiringReauth = 0;

    const mappedAccounts = accounts.map((account) => {
      if (account.status === SocialAccountStatus.ACTIVE) {
        accountsActive++;
      } else if (account.status === SocialAccountStatus.REAUTH_REQUIRED) {
        accountsRequiringReauth++;
      }

      const latestMetrics = account.metrics[0] || null;
      if (latestMetrics) {
        totalFollowers += latestMetrics.followers;
        totalEngagement += latestMetrics.engagement;
      }

      return {
        id: account.id,
        provider: account.provider,
        name: account.name,
        status: account.status,
        latestMetrics,
      };
    });

    return {
      workspaceId,
      accountsConnected: accounts.length,
      accountsActive,
      accountsRequiringReauth,
      totalFollowers,
      totalEngagement,
      accounts: mappedAccounts,
    };
  }

  async getAccountAnalytics(workspaceId: string, accountId: string) {
    const repo = new WorkspaceScopedRepository<
      Prisma.SocialAccountDelegate,
      any,
      Prisma.SocialAccountWhereInput,
      Prisma.SocialAccountCreateInput,
      Prisma.SocialAccountUpdateInput
    >(this.prisma, this.prisma.socialAccount, workspaceId);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setUTCHours(0, 0, 0, 0);

    const account = await repo.findFirst({
      where: {
        id: accountId,
      },
      select: {
        id: true,
        provider: true,
        name: true,
        status: true,
        metrics: {
          where: {
            date: {
              gte: thirtyDaysAgo,
            },
          },
          orderBy: {
            date: 'asc',
          },
          select: {
            date: true,
            followers: true,
            engagement: true,
          },
        },
      },
    });

    if (!account) {
      throw new NotFoundException('Account not found in workspace');
    }

    return {
      account: {
        id: account.id,
        provider: account.provider,
        name: account.name,
        status: account.status,
      },
      metrics: account.metrics,
    };
  }
}
