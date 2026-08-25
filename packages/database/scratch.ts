import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  try {
    // 1. Find the User
    const user = await prisma.user.findUnique({
      where: { email: 'test@agencyos.local' },
    });
    
    if (!user) {
      console.log('User not found!');
      return;
    }
    console.log('User:', user.email);

    // 2. Query SocialAccount to get the full workspaceId
    const accounts = await prisma.socialAccount.findMany();
    const account = accounts.find(a => a.workspaceId.startsWith('3631eae4-a981-4600-969f'));
    
    if (!account) {
      console.log('SocialAccount not found!');
      return;
    }
    
    const workspaceId = account.workspaceId;
    console.log('Full WorkspaceId:', workspaceId);

    // 3. Create a WorkspaceMember row linking user and workspace
    const existingMember = await prisma.workspaceMember.findFirst({
      where: {
        userId: user.id,
        workspaceId: workspaceId,
      },
    });
    
    if (existingMember) {
      console.log('WorkspaceMember already exists:', existingMember);
      return;
    }
    
    const newMember = await prisma.workspaceMember.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        workspaceId: workspaceId,
        role: 'OWNER',
      },
    });
    
    // 4. Print final WorkspaceMember
    console.log('Created WorkspaceMember:', newMember);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
