import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma, SocialAccount } from '@prisma/client';
import { WorkspaceScopedRepository } from './WorkspaceScopedRepository';
import { generateId } from '../id';

class SocialAccountRepository extends WorkspaceScopedRepository<
  Prisma.SocialAccountDelegate,
  SocialAccount,
  Prisma.SocialAccountWhereInput,
  Prisma.SocialAccountCreateInput,
  Prisma.SocialAccountUpdateInput
> {
  constructor(prisma: PrismaClient, workspaceId: string) {
    super(prisma, prisma.socialAccount, workspaceId);
  }
}

const prisma = new PrismaClient();

describe('WorkspaceScopedRepository Isolation', () => {
  let orgId: string;
  let workspaceAId: string;
  let workspaceBId: string;
  let socialAccountBId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('test')) {
      throw new Error('SAFETY CHECK FAILED: Tests that clear the database must run against a test database. DATABASE_URL does not contain "test".');
    }

    orgId = generateId();
    await prisma.organization.create({
      data: { id: orgId, name: 'Test Org' },
    });

    workspaceAId = generateId();
    await prisma.workspace.create({
      data: { id: workspaceAId, name: 'Workspace A', organizationId: orgId },
    });

    workspaceBId = generateId();
    await prisma.workspace.create({
      data: { id: workspaceBId, name: 'Workspace B', organizationId: orgId },
    });

    socialAccountBId = generateId();
    await prisma.socialAccount.create({
      data: {
        id: socialAccountBId,
        workspaceId: workspaceBId,
        provider: 'TWITTER',
        externalId: 'ext_test_1',
        name: 'Account B',
        capabilities: [],
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await prisma.socialAccount.deleteMany({ where: { workspaceId: { in: [workspaceAId, workspaceBId] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('fails to fetch a record belonging to another workspace', async () => {
    // Instantiate repository for Workspace A
    const repoA = new SocialAccountRepository(prisma, workspaceAId);

    // Try to fetch Account B which belongs to Workspace B
    const result = await repoA.findFirst({
      where: { id: socialAccountBId },
    });

    // Should return null, enforcing tenant isolation
    expect(result).toBeNull();
  });
  
  it('succeeds to fetch a record belonging to its own workspace', async () => {
    // Create an account in Workspace A
    const socialAccountAId = generateId();
    await prisma.socialAccount.create({
      data: {
        id: socialAccountAId,
        workspaceId: workspaceAId,
        provider: 'LINKEDIN',
        externalId: 'ext_test_2',
        name: 'Account A',
        capabilities: [],
        status: 'ACTIVE',
      },
    });

    // Instantiate repository for Workspace A
    const repoA = new SocialAccountRepository(prisma, workspaceAId);

    // Try to fetch Account A
    const result = await repoA.findFirst({
      where: { id: socialAccountAId },
    });

    // Should return the record
    expect(result).not.toBeNull();
    expect(result?.id).toBe(socialAccountAId);
  });
});
