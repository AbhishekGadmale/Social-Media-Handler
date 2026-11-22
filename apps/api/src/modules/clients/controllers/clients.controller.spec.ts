import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ClientsController } from './clients.controller';
import { WorkspaceWritableGuard } from '../../billing/guards/workspace-writable.guard';
import { PERMISSION_KEY } from '../../auth/decorators/permission.decorator';

describe('ClientsController', () => {
  let controller: ClientsController;
  let mockClientsService: any;

  beforeEach(() => {
    mockClientsService = {
      createClient: vi.fn(),
      listClients: vi.fn(),
      getClient: vi.fn(),
      updateClient: vi.fn(),
      deleteClient: vi.fn(),
    };

    controller = new ClientsController(mockClientsService);
  });

  describe('Guards and Permissions', () => {
    it('decorates createClient, updateClient, and deleteClient with WorkspaceWritableGuard', () => {
      const createGuards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (ClientsController.prototype as any).createClient,
        ) || [];
      const updateGuards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (ClientsController.prototype as any).updateClient,
        ) || [];
      const deleteGuards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          (ClientsController.prototype as any).deleteClient,
        ) || [];

      expect(createGuards).toContain(WorkspaceWritableGuard);
      expect(updateGuards).toContain(WorkspaceWritableGuard);
      expect(deleteGuards).toContain(WorkspaceWritableGuard);
    });

    it('requires clients.manage for createClient, updateClient, deleteClient', () => {
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY,
          (ClientsController.prototype as any).createClient,
        ),
      ).toBe('clients.manage');
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY,
          (ClientsController.prototype as any).updateClient,
        ),
      ).toBe('clients.manage');
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY,
          (ClientsController.prototype as any).deleteClient,
        ),
      ).toBe('clients.manage');
    });

    it('requires clients.view for listClients and getClient', () => {
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY,
          (ClientsController.prototype as any).listClients,
        ),
      ).toBe('clients.view');
      expect(
        Reflect.getMetadata(
          PERMISSION_KEY,
          (ClientsController.prototype as any).getClient,
        ),
      ).toBe('clients.view');
    });
  });

  describe('Delegations', () => {
    it('delegates createClient to service', async () => {
      mockClientsService.createClient.mockResolvedValue({ id: 'c1' });
      const res = await controller.createClient(
        'ws-1',
        { id: 'u1' },
        {
          name: 'Client A',
        },
      );
      expect(mockClientsService.createClient).toHaveBeenCalledWith(
        'ws-1',
        'u1',
        { name: 'Client A' },
      );
      expect(res).toEqual({ id: 'c1' });
    });

    it('delegates listClients to service and returns wrapped object', async () => {
      mockClientsService.listClients.mockResolvedValue([{ id: 'c1' }]);
      const res = await controller.listClients('ws-1');
      expect(mockClientsService.listClients).toHaveBeenCalledWith('ws-1');
      expect(res).toEqual({ clients: [{ id: 'c1' }] });
    });

    it('delegates getClient to service', async () => {
      mockClientsService.getClient.mockResolvedValue({ id: 'c1' });
      const res = await controller.getClient('ws-1', 'c1');
      expect(mockClientsService.getClient).toHaveBeenCalledWith('ws-1', 'c1');
      expect(res).toEqual({ id: 'c1' });
    });

    it('delegates updateClient to service', async () => {
      mockClientsService.updateClient.mockResolvedValue({
        id: 'c1',
        name: 'New',
      });
      const res = await controller.updateClient(
        'ws-1',
        'c1',
        { id: 'u1' },
        {
          name: 'New',
        },
      );
      expect(mockClientsService.updateClient).toHaveBeenCalledWith(
        'ws-1',
        'c1',
        'u1',
        { name: 'New' },
      );
      expect(res).toEqual({ id: 'c1', name: 'New' });
    });

    it('delegates deleteClient to service', async () => {
      mockClientsService.deleteClient.mockResolvedValue({ success: true });
      const res = await controller.deleteClient('ws-1', 'c1', { id: 'u1' });
      expect(mockClientsService.deleteClient).toHaveBeenCalledWith(
        'ws-1',
        'c1',
        'u1',
      );
      expect(res).toEqual({ success: true });
    });
  });
});
