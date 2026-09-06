import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

export type DbFingerprint = {
  users: number;
  orgs: number;
  workspaces: number;
  members: number;
  hash: string;
};

export async function captureDbFingerprint(prisma: PrismaClient): Promise<DbFingerprint> {
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
  const orgs = await prisma.organization.findMany({ orderBy: { id: 'asc' } });
  const workspaces = await prisma.workspace.findMany({ orderBy: { id: 'asc' } });
  const members = await prisma.workspaceMember.findMany({ orderBy: { id: 'asc' } });

  const payload = JSON.stringify({
    users: users.map(u => ({ id: u.id, email: u.email })),
    orgs: orgs.map(o => ({ id: o.id, name: o.name })),
    workspaces: workspaces.map(w => ({ id: w.id, name: w.name })),
    members: members.map(m => ({ id: m.id, role: m.role, userId: m.userId, workspaceId: m.workspaceId })),
  });

  const hash = createHash('sha256').update(payload).digest('hex');

  return {
    users: users.length,
    orgs: orgs.length,
    workspaces: workspaces.length,
    members: members.length,
    hash,
  };
}

export function compareFingerprints(a: DbFingerprint, b: DbFingerprint): boolean {
  return (
    a.users === b.users &&
    a.orgs === b.orgs &&
    a.workspaces === b.workspaces &&
    a.members === b.members &&
    a.hash === b.hash
  );
}
