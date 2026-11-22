import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClientsService } from './clients.service';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AuditAction } from '@agency-os/database';

describe('ClientsService', () => {
  let service: ClientsService;
  let mockPrisma: any;
  let mockAudit: any;

  beforeEach(() => {
    mockPrisma = {
      client: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      workspaceMember: {
        count: vi.fn(),
      },
    };

    mockAudit = {
      logAction: vi.fn().mockResolvedValue(undefined),
    };

    service = new ClientsService(mockPrisma, mockAudit);
  });

  describe('createClient', () => {
    it('creates a client and logs audit CLIENT_CREATED', async () => {
      const mockCreated = {
        id: 'client-1',
        workspaceId: 'ws-1',
        name: 'Acme Corp',
        brandDisplayName: 'Acme Brand',
        brandLogoUrl: 'https://example.com/logo.png',
        brandAccentColor: '#112233',
      };
      mockPrisma.client.create.mockResolvedValue(mockCreated);

      const result = await service.createClient('ws-1', 'user-1', {
        name: '  Acme Corp  ',
        brandDisplayName: '  Acme Brand  ',
        brandLogoUrl: '  https://example.com/logo.png  ',
        brandAccentColor: '  #112233  ',
      });

      expect(mockPrisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          name: 'Acme Corp',
          brandDisplayName: 'Acme Brand',
          brandLogoUrl: 'https://example.com/logo.png',
          brandAccentColor: '#112233',
        }),
      });

      expect(mockAudit.logAction).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: AuditAction.CLIENT_CREATED,
        targetType: 'CLIENT',
        targetId: 'client-1',
        metadata: { name: 'Acme Corp' },
      });

      expect(result).toEqual(mockCreated);
    });

    it('throws BadRequestException if name is empty or whitespace', async () => {
      await expect(
        service.createClient('ws-1', 'user-1', { name: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listClients', () => {
    it('returns clients with accountCount and scopedMemberCount', async () => {
      mockPrisma.client.findMany.mockResolvedValue([
        {
          id: 'c1',
          workspaceId: 'ws-1',
          name: 'Client 1',
          brandDisplayName: null,
          brandLogoUrl: null,
          brandAccentColor: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { accounts: 3, members: 1 },
        },
      ]);

      const result = await service.listClients('ws-1');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'c1',
        name: 'Client 1',
        accountCount: 3,
        scopedMemberCount: 1,
      });
    });
  });

  describe('getClient', () => {
    it('returns client if found in workspace', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'c1',
        workspaceId: 'ws-1',
        name: 'Client 1',
        brandDisplayName: null,
        brandLogoUrl: null,
        brandAccentColor: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { accounts: 2, members: 0 },
      });

      const res = await service.getClient('ws-1', 'c1');
      expect(res.id).toBe('c1');
      expect(res.accountCount).toBe(2);
    });

    it('throws NotFoundException if client not in workspace', async () => {
      mockPrisma.client.findFirst.mockResolvedValue(null);
      await expect(service.getClient('ws-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateClient', () => {
    it('updates client fields and logs CLIENT_UPDATED', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'c1',
        workspaceId: 'ws-1',
        name: 'Old Name',
      });
      mockPrisma.client.update.mockResolvedValue({
        id: 'c1',
        workspaceId: 'ws-1',
        name: 'New Name',
      });

      const res = await service.updateClient('ws-1', 'c1', 'user-1', {
        name: '  New Name  ',
      });

      expect(mockPrisma.client.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({ name: 'New Name' }),
      });
      expect(mockAudit.logAction).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: AuditAction.CLIENT_UPDATED,
        targetType: 'CLIENT',
        targetId: 'c1',
        metadata: { name: 'New Name' },
      });
      expect(res.name).toBe('New Name');
    });

    it('throws NotFoundException if client not found', async () => {
      mockPrisma.client.findFirst.mockResolvedValue(null);
      await expect(
        service.updateClient('ws-1', 'c1', 'user-1', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if updating to empty name', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'c1',
        workspaceId: 'ws-1',
      });
      await expect(
        service.updateClient('ws-1', 'c1', 'user-1', { name: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteClient', () => {
    it('rejects with 409 Conflict if scoped members exist', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'c1',
        workspaceId: 'ws-1',
        name: 'Client 1',
      });
      mockPrisma.workspaceMember.count.mockResolvedValue(1);

      await expect(
        service.deleteClient('ws-1', 'c1', 'user-1'),
      ).rejects.toThrow(
        new ConflictException(
          "Remove or reassign this client's approver first.",
        ),
      );

      expect(mockPrisma.client.delete).not.toHaveBeenCalled();
    });

    it('deletes client and logs CLIENT_DELETED if 0 scoped members', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'c1',
        workspaceId: 'ws-1',
        name: 'Client 1',
      });
      mockPrisma.workspaceMember.count.mockResolvedValue(0);
      mockPrisma.client.delete.mockResolvedValue({ id: 'c1' });

      const res = await service.deleteClient('ws-1', 'c1', 'user-1');

      expect(mockPrisma.client.delete).toHaveBeenCalledWith({
        where: { id: 'c1' },
      });
      expect(mockAudit.logAction).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: AuditAction.CLIENT_DELETED,
        targetType: 'CLIENT',
        targetId: 'c1',
        metadata: { name: 'Client 1' },
      });
      expect(res).toEqual({ success: true });
    });

    it('throws NotFoundException if client not found in workspace', async () => {
      mockPrisma.client.findFirst.mockResolvedValue(null);
      await expect(
        service.deleteClient('ws-1', 'c1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
