import { PrismaClient } from '@prisma/client';

async function main() {
  const email = 'test@agencyos.local';
  const password = 'TestPass123!';
  const baseUrl = 'http://localhost:3001/api/v1';

  // 1. Successful login
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  console.log('Login Status:', loginRes.status);
  const cookiesArr = loginRes.headers.getSetCookie();
  const sessionCookie = cookiesArr.find(c => c.startsWith('session='));
  const sessionString = sessionCookie?.split(';')[0];
  const csrfCookie = cookiesArr.find(c => c.startsWith('csrfToken='));
  const csrfToken = csrfCookie?.split('=')[1]?.split(';')[0];
  
  // 2. Logout
  const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `${sessionString}; ${csrfCookie?.split(';')[0]}`,
      'x-csrf-token': csrfToken || '',
    },
  });
  console.log('Logout Status:', logoutRes.status);

  // 3. Login again
  const loginRes2 = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  console.log('Login 2 Status:', loginRes2.status);
  
  const cookiesArr2 = loginRes2.headers.getSetCookie();
  const sessionCookie2 = cookiesArr2.find(c => c.startsWith('session='));
  const sessionString2 = sessionCookie2?.split(';')[0];
  const csrfCookie2 = cookiesArr2.find(c => c.startsWith('csrfToken='));
  const csrfToken2 = csrfCookie2?.split('=')[1]?.split(';')[0];

  // Find workspaceId
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
  const workspaceId = user?.memberships[0]?.workspaceId;

  if (workspaceId) {
    // 4. Manual sync trigger (simulate)
    // Create a fake social account for testing
    const account = await prisma.socialAccount.upsert({
      where: { id: '123e4567-e89b-12d3-a456-426614174000' },
      update: {},
      create: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        workspaceId,
        provider: 'YOUTUBE',
        externalId: 'ext-123',
        status: 'ACTIVE',
      }
    });

    const syncRes = await fetch(`${baseUrl}/workspaces/${workspaceId}/accounts/${account.id}/sync`, {
      method: 'POST',
      headers: {
        'Cookie': `${sessionString2}; ${csrfCookie2?.split(';')[0]}`,
        'x-csrf-token': csrfToken2 || '',
      },
    });
    console.log('Sync Status:', syncRes.status);
    console.log('Sync Body:', await syncRes.text());
  }

  // Fetch AuditLogs
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log('\nAudit Logs from Prisma DB:');
  console.log(JSON.stringify(logs, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
