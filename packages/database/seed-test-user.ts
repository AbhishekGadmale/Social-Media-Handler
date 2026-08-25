import { PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import * as argon2 from '@node-rs/argon2';

const prisma = new PrismaClient();

async function main() {
  const email = 'test@agencyos.local';
  const password = 'TestPass123!';
  const hashedPassword = await argon2.hash(password);

  const userId = uuidv7();
  const orgId = uuidv7();
  const workspaceId = uuidv7();
  
  console.log('Creating User...');
  const user = await prisma.user.create({
    data: {
      id: userId,
      email,
      hashedPassword,
    },
  });

  console.log('Creating Organization...');
  const org = await prisma.organization.create({
    data: {
      id: orgId,
      name: 'Test Organization',
    },
  });

  console.log('Creating Workspace...');
  const workspace = await prisma.workspace.create({
    data: {
      id: workspaceId,
      name: 'Test Workspace',
      organizationId: org.id,
    },
  });

  console.log('Creating WorkspaceMember...');
  await prisma.workspaceMember.create({
    data: {
      id: uuidv7(),
      userId: user.id,
      workspaceId: workspace.id,
      role: 'OWNER',
    },
  });

  console.log(`\nSuccessfully created test resources!`);
  console.log(`userId: ${user.id}`);
  console.log(`workspaceId: ${workspace.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
