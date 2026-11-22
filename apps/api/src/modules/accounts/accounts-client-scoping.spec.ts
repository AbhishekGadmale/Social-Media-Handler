import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AccountsService } from './accounts.service';
import { NotFoundException } from '@nestjs/common';
import { AuditAction } from '@agency-os/database';

describe('AccountsService Client Scoping & Assignment', () => {
  let service: AccountsService;
  let mockPrisma: any;
  let mockRepo: any;
  let mockAudit: any;

  beforeEach(() => {
    mockPrisma = {
      socialAccount: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      client: {
        findFirst: vi.fn(),
      },
    };
    mockRepo = {
      disconnect: vi.fn(),
      getDecryptedCredentials: vi.fn(),
    };
    mockAudit = {
      logAction: vi.fn().mockResolvedValue(undefined),
    };

    service = new AccountsService(mockPrisma, mockRepo, mockAudit);
  });

  describe('listWorkspaceAccounts', () => {
    it('applies clientId filter when scopeClientId is provided', async () => {
      mockPrisma.socialAccount.findMany.mockResolvedValue([
        { id: 'acc-1', clientId: 'client-1' },
      ]);

      const res = await service.listWorkspaceAccounts('ws-1', 'client-1');

      expect(mockPrisma.socialAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            clientId: 'client-1',
            workspaceId: 'ws-1',
          },
        }),
      );
      expect(res).toHaveLength(1);
    });

    it('returns all workspace accounts when scopeClientId is omitted', async () => {
      mockPrisma.socialAccount.findMany.mockResolvedValue([
        { id: 'acc-1', clientId: 'client-1' },
        { id: 'acc-2', clientId: null },
      ]);

      const res = await service.listWorkspaceAccounts('ws-1');

      expect(mockPrisma.socialAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workspaceId: 'ws-1',
          },
        }),
      );
      expect(res).toHaveLength(2);
    });
  });

  describe('getWorkspaceAccount scoping', () => {
    it('returns account when scopeClientId matches account clientId', async () => {
      mockPrisma.socialAccount.findFirst.mockResolvedValue({
        id: 'acc-1',
        workspaceId: 'ws-1',
        clientId: 'client-1',
      });

      const res = await service.getWorkspaceAccount(
        'ws-1',
        'acc-1',
        'client-1',
      );
      expect(res.id).toBe('acc-1');
    });

    it('throws 404 NotFoundException when scopeClientId does not match account clientId', async () => {
      mockPrisma.socialAccount.findFirst.mockResolvedValue({
        id: 'acc-1',
        workspaceId: 'ws-1',
        clientId: 'client-2',
      });

      await expect(
        service.getWorkspaceAccount('ws-1', 'acc-1', 'client-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('assignClient', () => {
    it('assigns account to a client and logs ACCOUNT_CLIENT_ASSIGNED', async () => {
      mockPrisma.socialAccount.findFirst.mockResolvedValue({
        id: 'acc-1',
        workspaceId: 'ws-1',
        clientId: null,
      });
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'client-1',
        workspaceId: 'ws-1',
      });
      mockPrisma.socialAccount.update.mockResolvedValue({
        id: 'acc-1',
        clientId: 'client-1',
        client: { id: 'client-1', name: 'Acme' },
      });

      const res = await service.assignClient(
        'ws-1',
        'acc-1',
        'client-1',
        'user-1',
      );

      expect(mockPrisma.socialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { clientId: 'client-1' },
        include: { client: { select: { id: true, name: true } } },
      });
      expect(mockAudit.logAction).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: AuditAction.ACCOUNT_CLIENT_ASSIGNED,
        targetType: 'SocialAccount',
        targetId: 'acc-1',
        metadata: {
          fromClientId: null,
          toClientId: 'client-1',
        },
      });
      expect(res.clientId).toBe('client-1');
    });

    it('unassigns account when clientId is null', async () => {
      mockPrisma.socialAccount.findFirst.mockResolvedValue({
        id: 'acc-1',
        workspaceId: 'ws-1',
        clientId: 'client-1',
      });
      mockPrisma.socialAccount.update.mockResolvedValue({
        id: 'acc-1',
        clientId: null,
        client: null,
      });

      const res = await service.assignClient('ws-1', 'acc-1', null, 'user-1');
      expect(mockPrisma.client.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.socialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { clientId: null },
        include: { client: { select: { id: true, name: true } } },
      });
      expect(res.clientId).toBeNull();
    });

    it('throws 404 NotFoundException if account not found in workspace', async () => {
      mockPrisma.socialAccount.findFirst.mockResolvedValue(null);
      await expect(
        service.assignClient('ws-1', 'nonexistent', 'client-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 NotFoundException if target client not found in workspace', async () => {
      mockPrisma.socialAccount.findFirst.mockResolvedValue({
        id: 'acc-1',
        workspaceId: 'ws-1',
      });
      mockPrisma.client.findFirst.mockResolvedValue(null);

      await expect(
        service.assignClient('ws-1', 'acc-1', 'nonexistent-client', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
