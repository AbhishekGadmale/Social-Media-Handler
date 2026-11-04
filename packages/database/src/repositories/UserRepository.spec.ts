/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRepository } from './UserRepository';
import { WorkspaceRole, Prisma } from '@prisma/client';

describe('UserRepository', () => {
  let prismaMock: any;
  let repo: UserRepository;

  beforeEach(() => {
    prismaMock = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    repo = new UserRepository(prismaMock);
  });

  describe('createWithTenantTransaction', () => {
    it('successfully provisions user, organization, workspace, and OWNER member atomically', async () => {
      const txMock = {
        user: {
          create: vi.fn().mockImplementation(({ data }) =>
            Promise.resolve({ ...data, createdAt: new Date(), updatedAt: new Date() }),
          ),
        },
        organization: {
          create: vi.fn().mockImplementation(({ data }) =>
            Promise.resolve({ ...data, createdAt: new Date(), updatedAt: new Date() }),
          ),
        },
        workspace: {
          create: vi.fn().mockImplementation(({ data }) =>
            Promise.resolve({ ...data, createdAt: new Date(), updatedAt: new Date() }),
          ),
        },
        workspaceMember: {
          create: vi.fn().mockImplementation(({ data }) =>
            Promise.resolve({ ...data, createdAt: new Date(), updatedAt: new Date() }),
          ),
        },
      };

      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback(txMock);
      });

      const result = await repo.createWithTenantTransaction({
        email: '  Alice@Example.COM  ',
        hashedPassword: '$argon2id$hashedpassword',
        organizationName: '  Alice Agency  ',
        workspaceName: '  Alice Main  ',
      });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

      // Verify User creation defaults: normalized email, emailVerified: false, securityEpoch: 1
      expect(txMock.user.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          email: 'alice@example.com',
          hashedPassword: '$argon2id$hashedpassword',
          emailVerified: false,
          emailVerifiedAt: null,
          securityEpoch: 1,
        },
      });

      // Verify Organization creation
      expect(txMock.organization.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          name: 'Alice Agency',
        },
      });

      // Verify Workspace creation linked to Org
      expect(txMock.workspace.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          organizationId: expect.any(String),
          name: 'Alice Main',
        },
      });

      // Verify WorkspaceMember creation with OWNER role
      expect(txMock.workspaceMember.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          workspaceId: expect.any(String),
          userId: expect.any(String),
          role: WorkspaceRole.OWNER,
        },
      });

      expect(result.user.email).toBe('alice@example.com');
      expect(result.membership.role).toBe(WorkspaceRole.OWNER);
    });

    it('rolls back the transaction if member creation fails', async () => {
      const txMock = {
        user: {
          create: vi.fn().mockResolvedValue({ id: 'user-1' }),
        },
        organization: {
          create: vi.fn().mockResolvedValue({ id: 'org-1' }),
        },
        workspace: {
          create: vi.fn().mockResolvedValue({ id: 'ws-1' }),
        },
        workspaceMember: {
          create: vi.fn().mockRejectedValue(new Error('Database disk full')),
        },
      };

      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback(txMock);
      });

      await expect(
        repo.createWithTenantTransaction({
          email: 'bob@example.com',
          hashedPassword: '$argon2id$hashed',
        }),
      ).rejects.toThrow('Database disk full');

      expect(txMock.workspaceMember.create).toHaveBeenCalledTimes(1);
    });

    it('propagates unique constraint error P2002 on duplicate email', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`email`)',
        {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['email'] },
        },
      );

      const txMock = {
        user: {
          create: vi.fn().mockRejectedValue(p2002Error),
        },
      };

      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback(txMock);
      });

      await expect(
        repo.createWithTenantTransaction({
          email: 'duplicate@example.com',
          hashedPassword: '$argon2id$hashed',
        }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });
  });

  describe('updatePasswordAndIncrementEpoch', () => {
    it('updates password and increments securityEpoch atomically', async () => {
      prismaMock.user.update.mockResolvedValue({
        id: 'user-1',
        hashedPassword: '$argon2id$newhash',
        securityEpoch: 2,
      });

      const result = await repo.updatePasswordAndIncrementEpoch(
        'user-1',
        '$argon2id$newhash',
      );

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          hashedPassword: '$argon2id$newhash',
          securityEpoch: { increment: 1 },
        },
      });
      expect(result.securityEpoch).toBe(2);
    });
  });

  describe('incrementSecurityEpoch', () => {
    it('increments securityEpoch in the database', async () => {
      prismaMock.user.update.mockResolvedValue({
        id: 'user-1',
        securityEpoch: 3,
      });

      const result = await repo.incrementSecurityEpoch('user-1');

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          securityEpoch: { increment: 1 },
        },
      });
      expect(result.securityEpoch).toBe(3);
    });
  });
});
