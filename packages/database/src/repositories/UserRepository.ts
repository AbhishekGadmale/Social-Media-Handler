import {
  PrismaClient,
  User,
  Organization,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from "@prisma/client";
import { generateId } from "../id";

export interface CreateUserWithTenantInput {
  name: string;
  email: string;
  hashedPassword: string;
  organizationName?: string;
  workspaceName?: string;
  termsAcceptedAt?: Date | null;
  verificationToken?: {
    tokenHash: string;
    expiresAt: Date;
  };
}

export interface CreateUserWithTenantResult {
  user: User;
  organization: Organization;
  workspace: Workspace;
  membership: WorkspaceMember;
}

export class UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async updatePassword(id: string, hashedPassword: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { hashedPassword },
    });
  }

  async updatePasswordAndIncrementEpoch(
    id: string,
    hashedPassword: string,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        hashedPassword,
        securityEpoch: { increment: 1 },
      },
    });
  }

  async incrementSecurityEpoch(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        securityEpoch: { increment: 1 },
      },
    });
  }

  async incrementFailedLoginAttempts(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        failedLoginAttempts: { increment: 1 },
      },
    });
  }

  async lockUserAccount(id: string, lockedUntil: Date): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        lockedUntil,
        failedLoginAttempts: 0,
      },
    });
  }

  async clearFailedLoginAttempts(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
  }

  /**
   * Atomically provisions a new User, Organization, Workspace, and OWNER WorkspaceMember.
   * If any step fails or an email uniqueness conflict occurs, rolls back the entire transaction.
   */
  async createWithTenantTransaction(
    input: CreateUserWithTenantInput,
  ): Promise<CreateUserWithTenantResult> {
    const userId = generateId();
    const orgId = generateId();
    const workspaceId = generateId();
    const memberId = generateId();

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: userId,
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          hashedPassword: input.hashedPassword,
          emailVerified: false,
          emailVerifiedAt: null,
          securityEpoch: 1,
          ...(input.termsAcceptedAt !== undefined && {
            termsAcceptedAt: input.termsAcceptedAt,
          }),
        },
      });

      const organization = await tx.organization.create({
        data: {
          id: orgId,
          name: input.organizationName?.trim() || "My Organization",
        },
      });

      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      const workspace = await tx.workspace.create({
        data: {
          id: workspaceId,
          organizationId: orgId,
          name: input.workspaceName?.trim() || "Default Workspace",
          trialEndsAt,
        },
      });

      const membership = await tx.workspaceMember.create({
        data: {
          id: memberId,
          workspaceId,
          userId,
          role: WorkspaceRole.OWNER,
        },
      });

      if (input.verificationToken) {
        await tx.emailVerificationToken.create({
          data: {
            id: generateId(),
            userId,
            tokenHash: input.verificationToken.tokenHash,
            expiresAt: input.verificationToken.expiresAt,
            consumedAt: null,
          },
        });
      }

      return { user, organization, workspace, membership };
    });
  }
}
