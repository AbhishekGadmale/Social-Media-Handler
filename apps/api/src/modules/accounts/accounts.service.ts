import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@agency-os/database';
import { WorkspaceScopedRepository } from '@agency-os/database';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaClient) {}

  async listWorkspaceAccounts(workspaceId: string) {
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
        workspaceId: true,
        provider: true,
        externalId: true,
        name: true,
        capabilities: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return accounts;
  }
}
