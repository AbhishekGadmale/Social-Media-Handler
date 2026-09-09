import { PrismaClient } from '@prisma/client';
import { generateId } from './src/id';
import * as argon2 from '@node-rs/argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Restoring dev data...');

  // 1. Find or create User
  const email = 'test@agencyos.local';
  let user = await prisma.user.findUnique({ where: { email } });
  
  if (!user) {
    const hashedPassword = await argon2.hash('TestPass123!');
    user = await prisma.user.create({
      data: {
        id: generateId(),
        email,
        hashedPassword,
      },
    });
    console.log(`Created User: ${user.id}`);
  } else {
    console.log(`Found existing User: ${user.id}`);
  }

  // 2. Find or create Organization
  let org = await prisma.organization.findFirst({
    where: { name: 'Test Organization' }
  });
  
  if (!org) {
    org = await prisma.organization.create({
      data: {
        id: generateId(),
        name: 'Test Organization',
      }
    });
    console.log(`Created Organization: ${org.id}`);
  } else {
    console.log(`Found existing Organization: ${org.id}`);
  }

  // Find or create Workspace
  let workspace = await prisma.workspace.findFirst({
    where: { 
      name: 'Test Workspace',
      organizationId: org.id
    }
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        id: generateId(),
        name: 'Test Workspace',
        organizationId: org.id,
      }
    });
    console.log(`Created Workspace: ${workspace.id}`);
  } else {
    console.log(`Found existing Workspace: ${workspace.id}`);
  }

  // 3. Find or create WorkspaceMember
  let member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: user.id
      }
    }
  });

  if (!member) {
    member = await prisma.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
      }
    });
    console.log(`Created WorkspaceMember: ${member.id}`);
  } else {
    console.log(`Found existing WorkspaceMember: ${member.id}`);
  }

  // 4. Print final workspaceId
  console.log(`\n================================`);
  console.log(`FINAL WORKSPACE ID: ${workspace.id}`);
  console.log(`================================\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
