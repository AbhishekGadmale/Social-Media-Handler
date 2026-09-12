// DIAGNOSTIC SCRIPT: Read-only check for OAuth connection state and encryption.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function check() {
  const accountCount = await prisma.socialAccount.count({ where: { provider: 'LINKEDIN' } });
  
  const accounts = await prisma.socialAccount.findMany({ where: { provider: 'LINKEDIN' }, include: { workspace: true, connection: true } });
  
  let connectionCount = 0;
  if (accounts.length > 0) {
    connectionCount = await prisma.socialConnection.count({ where: { socialAccountId: accounts[0].id } });
  }

  console.log('LinkedIn SocialAccount count:', accountCount);
  console.log('LinkedIn SocialConnection count:', connectionCount);
  
  if (accounts.length > 0) {
    const acc = accounts[0];
    console.log('Workspace ownership:', acc.workspaceId ? 'PASS' : 'FAIL');
    console.log('Granted scopes:', JSON.stringify(acc.connection?.grantedScopes));
    console.log('Capabilities:', JSON.stringify(acc.capabilities));
    console.log('Credentials encrypted:', (acc.connection?.credentials as string)?.includes('U2FsdGVkX1') || (acc.connection?.credentials?.length ?? 0) > 100);
  }
}
check().then(() => process.exit(0));

