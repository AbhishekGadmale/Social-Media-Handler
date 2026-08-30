import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import * as crypto from 'crypto';

async function main() {
  const prisma = new PrismaClient();
  const redis = new Redis('redis://localhost:6379');
  
  const email = 'test@agencyos.local';
  const user = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
  const workspaceId = user?.memberships[0]?.workspaceId;

  // Set account to REAUTH_REQUIRED
  await prisma.socialAccount.upsert({
    where: { id: 'yt-channel-123' },
    update: { status: 'REAUTH_REQUIRED' },
    create: {
      id: 'yt-channel-123',
      workspaceId: workspaceId!,
      provider: 'YOUTUBE',
      externalId: 'ext-123',
      status: 'REAUTH_REQUIRED',
    }
  });

  // Login
  const loginRes = await fetch(`http://localhost:3001/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPass123!' }),
  });
  
  const cookiesArr = loginRes.headers.getSetCookie();
  const sessionCookie = cookiesArr.find(c => c.startsWith('session='));
  const sessionString = sessionCookie?.split(';')[0];
  const csrfCookie = cookiesArr.find(c => c.startsWith('csrfToken='));
  const csrfToken = csrfCookie?.split('=')[1]?.split(';')[0];

  // Initiate Connect to generate state in Redis
  const connectRes = await fetch(`http://localhost:3001/api/v1/workspaces/${workspaceId}/oauth/youtube/connect`, {
    method: 'POST',
    headers: {
      'Cookie': `${sessionString}; ${csrfCookie?.split(';')[0]}`,
      'x-csrf-token': csrfToken || '',
    },
  });
  const connectData = await connectRes.json();
  console.log('Connect URL:', connectData.url);

  // We can't fake the callback easily because handleOAuthCallback will hit real Google API.
  // We've verified this via unit tests already.

  await prisma.$disconnect();
  redis.disconnect();
}

main().catch(console.error);
