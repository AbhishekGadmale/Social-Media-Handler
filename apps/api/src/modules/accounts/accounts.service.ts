import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  PrismaClient,
  Prisma,
  SocialAccountStatus,
  SocialAccountRepository,
  AuditAction,
} from '@agency-os/database';
import { WorkspaceScopedRepository } from '@agency-os/database';
import { providerRegistry } from '@agency-os/providers';
import { AuditService } from '../core/audit.service';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly socialAccountRepo: SocialAccountRepository,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async listWorkspaceAccounts(workspaceId: string, scopeClientId?: string) {
    const repo = new WorkspaceScopedRepository<
      Prisma.SocialAccountDelegate,
      any,
      Prisma.SocialAccountWhereInput,
      Prisma.SocialAccountCreateInput,
      Prisma.SocialAccountUpdateInput
    >(this.prisma, this.prisma.socialAccount, workspaceId);

    const accounts = await repo.findMany({
      where: scopeClientId ? { clientId: scopeClientId } : undefined,
      select: {
        id: true,
        workspaceId: true,
        clientId: true,
        client: {
          select: {
            id: true,
            name: true,
          },
        },
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

  async getWorkspaceAccount(
    workspaceId: string,
    accountId: string,
    scopeClientId?: string,
  ) {
    const repo = new WorkspaceScopedRepository<
      Prisma.SocialAccountDelegate,
      any,
      Prisma.SocialAccountWhereInput,
      Prisma.SocialAccountCreateInput,
      Prisma.SocialAccountUpdateInput
    >(this.prisma, this.prisma.socialAccount, workspaceId);

    const account = await repo.findById(accountId, {
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    if (!account) {
      throw new NotFoundException('Account not found in workspace');
    }

    if (scopeClientId && account.clientId !== scopeClientId) {
      throw new NotFoundException('Account not found in workspace');
    }

    return account;
  }

  async assignClient(
    workspaceId: string,
    accountId: string,
    clientId: string | null,
    actorId: string,
  ) {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id: accountId, workspaceId },
    });

    if (!account) {
      throw new NotFoundException('Account not found in workspace');
    }

    if (clientId !== null) {
      const client = await this.prisma.client.findFirst({
        where: { id: clientId, workspaceId },
      });
      if (!client) {
        throw new NotFoundException('Client not found');
      }
    }

    const updated = await this.prisma.socialAccount.update({
      where: { id: accountId },
      data: { clientId },
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (this.auditService) {
      await this.auditService.logAction({
        workspaceId,
        actorId,
        action: AuditAction.ACCOUNT_CLIENT_ASSIGNED,
        targetType: 'SocialAccount',
        targetId: accountId,
        metadata: {
          fromClientId: account.clientId,
          toClientId: clientId,
        },
      });
    }

    return updated;
  }

  async disconnectAccount(
    workspaceId: string,
    accountId: string,
    userId: string,
    requestId?: string,
  ) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { id: accountId },
      include: { connection: true },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    if (account.workspaceId !== workspaceId) {
      throw new ForbiddenException('Account does not belong to this workspace');
    }

    // 1. Best-effort provider revoke FIRST
    if (account.connection) {
      try {
        const credentials =
          await this.socialAccountRepo.getDecryptedCredentials(accountId);

        if (credentials?.accessToken) {
          const providerKey = String(account.provider).toLowerCase();
          const provider = providerRegistry.get(providerKey);
          if (provider && typeof (provider as any).revokeToken === 'function') {
            await (provider as any).revokeToken({
              accessToken: credentials.accessToken,
              ...(credentials.refreshToken
                ? { refreshToken: credentials.refreshToken }
                : {}),
            });
          }
        }
      } catch (err: any) {
        // Must never block disconnect on provider revoke failure
        this.logger.warn(
          `Provider token revocation failed for account ${accountId} (${account.provider}): ${err?.message || err}`,
        );
      }
    }

    // 2. Atomic credential wipe and status update via repository
    await this.socialAccountRepo.disconnect(
      workspaceId,
      accountId,
      userId,
      {
        provider: account.provider,
        accountName: account.name,
      },
      requestId,
    );

    return {
      success: true,
      accountId,
      status: SocialAccountStatus.DISCONNECTED,
    };
  }
}
