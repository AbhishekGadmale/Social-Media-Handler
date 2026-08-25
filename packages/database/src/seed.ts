import { PrismaClient } from '@prisma/client';
import { generateId } from './id.js';

const prisma = new PrismaClient();

async function main() {
  const orgId = generateId();
  await prisma.organization.create({
    data: {
      id: orgId,
      name: 'Agency OS Test Org',
    },
  });

  const workspaceAId = generateId();
  await prisma.workspace.create({
    data: {
      id: workspaceAId,
      name: 'Workspace A',
      organizationId: orgId,
    },
  });

  const workspaceBId = generateId();
  await prisma.workspace.create({
    data: {
      id: workspaceBId,
      name: 'Workspace B',
      organizationId: orgId,
    },
  });

  const userId = generateId();
  await prisma.user.create({
    data: {
      id: userId,
      email: 'owner@workspace-a.com',
      hashedPassword: 'hashed_password_mock',
    },
  });

  await prisma.workspaceMember.create({
    data: {
      id: generateId(),
      workspaceId: workspaceAId,
      userId: userId,
      role: 'OWNER',
    },
  });

  const socialAccountIdA = generateId();
  await prisma.socialAccount.create({
    data: {
      id: socialAccountIdA,
      workspaceId: workspaceAId,
      provider: 'TWITTER',
      externalId: 'ext_tw_1',
      name: 'Twitter A',
      capabilities: ['POST', 'READ'],
      status: 'ACTIVE',
    },
  });

  await prisma.accountMetricDaily.create({
    data: {
      id: generateId(),
      socialAccountId: socialAccountIdA,
      date: new Date(),
      followers: 1000,
      engagement: 50,
    },
  });

  const socialAccountIdB = generateId();
  await prisma.socialAccount.create({
    data: {
      id: socialAccountIdB,
      workspaceId: workspaceBId,
      provider: 'LINKEDIN',
      externalId: 'ext_li_1',
      name: 'LinkedIn B',
      capabilities: ['POST', 'READ'],
      status: 'ACTIVE',
    },
  });

  await prisma.accountMetricDaily.create({
    data: {
      id: generateId(),
      socialAccountId: socialAccountIdB,
      date: new Date(),
      followers: 500,
      engagement: 20,
    },
  });

  console.log('Seed successful');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
