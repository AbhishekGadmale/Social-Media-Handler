import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { AuditLogRepository, AuditAction } from '@agency-os/database';
import { vi } from 'vitest';
import { Logger } from '@nestjs/common';

describe('AuditService', () => {
  let service: AuditService;
  let mockAuditRepo: any;

  beforeEach(async () => {
    mockAuditRepo = {
      create: vi.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: AuditLogRepository, useValue: mockAuditRepo },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    // Suppress console error in tests
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  it('awaited logAction: resolves after repository insert resolves', async () => {
    mockAuditRepo.create.mockResolvedValueOnce({ id: 'audit-1' });

    await expect(
      service.logAction({
        action: AuditAction.AUTH_LOGIN_SUCCEEDED,
        targetType: 'User',
        metadata: { safe: true },
      }),
    ).resolves.toBeUndefined();

    expect(mockAuditRepo.create).toHaveBeenCalledWith({
      action: AuditAction.AUTH_LOGIN_SUCCEEDED,
      targetType: 'User',
      metadata: { safe: true },
    });
  });

  it('awaited logAction: rejects when repository insert fails', async () => {
    const dbError = new Error('DB connection failure');
    mockAuditRepo.create.mockRejectedValueOnce(dbError);

    await expect(
      service.logAction({
        action: AuditAction.POST_CREATED,
        targetType: 'POST',
      }),
    ).rejects.toThrow('DB connection failure');

    expect(mockAuditRepo.create).toHaveBeenCalledWith({
      action: AuditAction.POST_CREATED,
      targetType: 'POST',
    });
  });

  it('best-effort logActionBestEffort: calls repository and does not throw if insert rejects, logging error', async () => {
    mockAuditRepo.create.mockRejectedValueOnce(
      new Error('Transient DB timeout'),
    );

    expect(() => {
      service.logActionBestEffort({
        action: AuditAction.AUTH_LOGIN_FAILED,
        targetType: 'User',
      });
    }).not.toThrow();

    // Wait a tick for the promise catch handler
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((Logger.prototype.error as any).mock.calls.length).toBeGreaterThan(
      0,
    );
  });

  it('best-effort logActionBestEffort: calls repository on success without throwing', async () => {
    mockAuditRepo.create.mockResolvedValueOnce({ id: 'audit-2' });

    expect(() => {
      service.logActionBestEffort({
        action: AuditAction.AUTH_LOGIN_SUCCEEDED,
        targetType: 'User',
      });
    }).not.toThrow();

    expect(mockAuditRepo.create).toHaveBeenCalledWith({
      action: AuditAction.AUTH_LOGIN_SUCCEEDED,
      targetType: 'User',
    });
  });
});
