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

  it('should call auditRepo.create on logAction', () => {
    service.logAction({
      action: AuditAction.AUTH_LOGIN_SUCCEEDED,
      targetType: 'User',
      metadata: { safe: true },
    });

    expect(mockAuditRepo.create).toHaveBeenCalledWith({
      action: AuditAction.AUTH_LOGIN_SUCCEEDED,
      targetType: 'User',
      metadata: { safe: true },
    });
  });

  it('should not throw if auditRepo.create rejects (fire-and-forget)', async () => {
    mockAuditRepo.create.mockRejectedValueOnce(new Error('DB Error'));

    // This should not throw synchronously or asynchronously to the caller
    expect(() => {
      service.logAction({
        action: AuditAction.AUTH_LOGIN_SUCCEEDED,
        targetType: 'User',
      });
    }).not.toThrow();

    // Wait a tick for the unhandled promise catch
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((Logger.prototype.error as any).mock.calls.length).toBeGreaterThan(
      0,
    );
  });
});
