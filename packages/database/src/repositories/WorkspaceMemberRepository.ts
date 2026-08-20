import { PrismaClient, WorkspaceMember } from '@prisma/client';

/**
 * Note: This repository deviates from WorkspaceScopedRepository intentionally.
 * Because it is injected globally as a singleton into route guards (e.g. WorkspaceGuard),
 * we cannot bind `workspaceId` in the constructor dynamically per request.
 *
 * Use this pattern for cross-workspace or guard-level lookups.
 * Use WorkspaceScopedRepository for normal business logic strictly bound to one tenant.
 */
export class WorkspaceMemberRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByWorkspaceAndUserId(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    return this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId,
      },
    });
  }

  findMembershipsByUserId(userId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
    });
  }
}

