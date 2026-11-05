import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AccountsService } from './accounts.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { SocialAccountStatus } from '@agency-os/database';
import { providerRegistry } from '@agency-os/providers';

describe('AccountsService', () => {
  let service: AccountsService;
  let prismaMock: any;
  let repoMock: any;

  beforeEach(() => {
    prismaMock = {
      socialAccount: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
    };

    repoMock = {
      getDecryptedCredentials: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    service = new AccountsService(prismaMock, repoMock);
  });

  describe('disconnectAccount', () => {
    it('throws NotFoundException when account does not exist', async () => {
      prismaMock.socialAccount.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.disconnectAccount('ws-1', 'acc-missing', 'u-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when account belongs to another workspace (tenant isolation)', async () => {
      prismaMock.socialAccount.findUnique.mockResolvedValue({
        id: 'acc-foreign',
        workspaceId: 'ws-other',
        provider: 'LINKEDIN',
        connection: null,
      });

      await expect(
        service.disconnectAccount('ws-1', 'acc-foreign', 'u-1'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.disconnectAccount('ws-1', 'acc-foreign', 'u-1'),
      ).rejects.toThrow('Account does not belong to this workspace');
    });

    it('successfully revokes provider token and atomically wipes credentials on disconnect', async () => {
      const mockRevoke = vi.fn().mockResolvedValue(undefined);
      const mockProvider = {
        revokeToken: mockRevoke,
      };
      const origGet = providerRegistry.get.bind(providerRegistry);
      vi.spyOn(providerRegistry, 'get').mockImplementation((name: string) => {
        if (name === 'meta') return mockProvider as any;
        return origGet(name);
      });

      prismaMock.socialAccount.findUnique.mockResolvedValueOnce({
        id: 'acc-1',
        workspaceId: 'ws-1',
        provider: 'META',
        name: 'Meta Account',
        connection: { id: 'conn-1' },
      });

      repoMock.getDecryptedCredentials.mockResolvedValueOnce({
        accessToken: 'raw-access-token',
        refreshToken: 'raw-refresh-token',
      });

      const res = await service.disconnectAccount(
        'ws-1',
        'acc-1',
        'u-1',
        'req-1',
      );

      expect(res).toEqual({
        success: true,
        accountId: 'acc-1',
        status: SocialAccountStatus.DISCONNECTED,
      });

      expect(mockRevoke).toHaveBeenCalledWith({
        accessToken: 'raw-access-token',
        refreshToken: 'raw-refresh-token',
      });

      expect(repoMock.disconnect).toHaveBeenCalledWith(
        'ws-1',
        'acc-1',
        'u-1',
        {
          provider: 'META',
          accountName: 'Meta Account',
        },
        'req-1',
      );
    });

    it('continues and completes disconnect even if provider revoke throws an error (best-effort)', async () => {
      const mockRevoke = vi
        .fn()
        .mockRejectedValue(new Error('Provider API down'));
      const mockProvider = {
        revokeToken: mockRevoke,
      };
      vi.spyOn(providerRegistry, 'get').mockReturnValue(mockProvider as any);

      prismaMock.socialAccount.findUnique.mockResolvedValueOnce({
        id: 'acc-2',
        workspaceId: 'ws-1',
        provider: 'YOUTUBE',
        name: 'YT Account',
        connection: { id: 'conn-2' },
      });

      repoMock.getDecryptedCredentials.mockResolvedValueOnce({
        accessToken: 'raw-access-token',
      });

      const res = await service.disconnectAccount('ws-1', 'acc-2', 'u-2');

      expect(res.success).toBe(true);
      expect(res.status).toBe(SocialAccountStatus.DISCONNECTED);
      expect(repoMock.disconnect).toHaveBeenCalled();
    });

    it('completes disconnect if account has no connection record', async () => {
      prismaMock.socialAccount.findUnique.mockResolvedValueOnce({
        id: 'acc-no-conn',
        workspaceId: 'ws-1',
        provider: 'LINKEDIN',
        name: 'LinkedIn Account',
        connection: null,
      });

      const res = await service.disconnectAccount('ws-1', 'acc-no-conn', 'u-1');

      expect(res.success).toBe(true);
      expect(res.status).toBe(SocialAccountStatus.DISCONNECTED);
      expect(repoMock.disconnect).toHaveBeenCalledWith(
        'ws-1',
        'acc-no-conn',
        'u-1',
        {
          provider: 'LINKEDIN',
          accountName: 'LinkedIn Account',
        },
        undefined,
      );
    });
  });
});
