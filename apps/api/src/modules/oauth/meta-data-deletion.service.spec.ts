import { Test, TestingModule } from '@nestjs/testing';
import { OAuthService } from './oauth.service';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EntitlementsService } from '../billing/entitlements.service';
import {
  SocialAccountRepository,
  AuditLogRepository,
  SocialProvider,
  AuditAction,
} from '@agency-os/database';
import { AuditService } from '../core/audit.service';
import { getLoggerToken } from 'nestjs-pino';
import crypto from 'node:crypto';
import { vi } from 'vitest';

describe('OAuthService - Meta Data Deletion (§87)', () => {
  let service: OAuthService;
  let mockRedis: any;
  let mockSocialAccountRepo: any;
  let mockAuditLogRepo: any;
  let mockAuditService: any;
  const mockAppSecret = 'test_meta_app_secret_12345';

  function createSignedRequest(
    payloadObj: Record<string, any>,
    secret: string = mockAppSecret,
    tamperSig: boolean = false,
  ): string {
    const payloadJson = JSON.stringify(payloadObj);
    const payloadStr = Buffer.from(payloadJson).toString('base64url');
    let sigBuffer = crypto
      .createHmac('sha256', secret)
      .update(payloadStr)
      .digest();

    if (tamperSig) {
      sigBuffer = crypto
        .createHmac('sha256', 'wrong_secret')
        .update(payloadStr)
        .digest();
    }

    const encodedSig = sigBuffer.toString('base64url');
    return `${encodedSig}.${payloadStr}`;
  }

  beforeAll(() => {
    process.env.META_CLIENT_SECRET = mockAppSecret;
    process.env.FRONTEND_URL = 'http://localhost:3000';
  });

  afterAll(() => {
    delete process.env.META_CLIENT_SECRET;
  });

  beforeEach(async () => {
    const store: Record<string, string> = {};
    mockRedis = {
      set: vi.fn((key, value) => {
        store[key] = value;
      }),
      get: vi.fn((key) => store[key] || null),
      del: vi.fn((key) => {
        delete store[key];
      }),
    };

    mockSocialAccountRepo = {
      deleteByProviderAndExternalId: vi
        .fn()
        .mockResolvedValue(['account-meta-1']),
    };

    mockAuditLogRepo = {
      findByActionAndConfirmationCode: vi.fn().mockResolvedValue(null),
    };

    mockAuditService = {
      logActionBestEffort: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedis,
        },
        {
          provide: SocialAccountRepository,
          useValue: mockSocialAccountRepo,
        },
        {
          provide: AuditLogRepository,
          useValue: mockAuditLogRepo,
        },
        {
          provide: 'BullQueue_sync',
          useValue: { add: vi.fn() },
        },
        {
          provide: EntitlementsService,
          useValue: {},
        },
        {
          provide: getLoggerToken(OAuthService.name),
          useValue: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
  });

  describe('parseAndVerifySignedRequest', () => {
    it('successfully parses and verifies a valid HMAC-SHA256 signed request', () => {
      const signedRequest = createSignedRequest({
        user_id: 'meta-user-456',
        algorithm: 'HMAC-SHA256',
        issued_at: 1700000000,
      });

      const parsed = service.parseAndVerifySignedRequest(
        signedRequest,
        mockAppSecret,
      );

      expect(parsed).toEqual({
        user_id: 'meta-user-456',
        algorithm: 'HMAC-SHA256',
        issued_at: 1700000000,
      });
    });

    it('rejects an invalid signature with BadRequestException', () => {
      const tamperedSignedRequest = createSignedRequest(
        {
          user_id: 'meta-user-456',
          algorithm: 'HMAC-SHA256',
        },
        mockAppSecret,
        true, // tamper signature
      );

      expect(() =>
        service.parseAndVerifySignedRequest(
          tamperedSignedRequest,
          mockAppSecret,
        ),
      ).toThrow(BadRequestException);

      expect(() =>
        service.parseAndVerifySignedRequest(
          tamperedSignedRequest,
          mockAppSecret,
        ),
      ).toThrow('Invalid signed_request signature');
    });

    it('rejects malformed signed_request without dot separator', () => {
      expect(() =>
        service.parseAndVerifySignedRequest('nodotinthisstring', mockAppSecret),
      ).toThrow('Malformed signed_request: expected signature.payload');
    });

    it('rejects non-HMAC-SHA256 algorithm', () => {
      const badAlgoRequest = createSignedRequest({
        user_id: 'meta-user-456',
        algorithm: 'MD5',
      });

      expect(() =>
        service.parseAndVerifySignedRequest(badAlgoRequest, mockAppSecret),
      ).toThrow('Unsupported algorithm in signed_request');
    });

    it('rejects payload missing user_id', () => {
      const noUserRequest = createSignedRequest({
        algorithm: 'HMAC-SHA256',
      });

      expect(() =>
        service.parseAndVerifySignedRequest(noUserRequest, mockAppSecret),
      ).toThrow('Missing user_id in signed_request payload');
    });
  });

  describe('handleMetaDataDeletion', () => {
    it('executes deletion, purges tokens, records audit log, and returns valid confirmation code response shape', async () => {
      const signedRequest = createSignedRequest({
        user_id: 'meta-user-456',
        algorithm: 'HMAC-SHA256',
        issued_at: 1700000000,
      });

      const result = await service.handleMetaDataDeletion(signedRequest, {
        ip: '192.168.1.1',
        userAgent: 'Meta-Bot/1.0',
        requestId: 'req-meta-123',
      });

      // Confirmation-code response shape assertions:
      expect(result).toBeDefined();
      expect(result.confirmation_code).toBeDefined();
      expect(typeof result.confirmation_code).toBe('string');
      // Must be prefixed with del_ followed by 32 hex chars
      expect(result.confirmation_code).toMatch(/^del_[a-f0-9]{32}$/);

      // Status URL assertions:
      expect(result.url).toBeDefined();
      expect(result.url).toContain('/data-deletion?code=');
      expect(result.url).toContain(result.confirmation_code);

      // Verify delegation to repository:
      expect(
        mockSocialAccountRepo.deleteByProviderAndExternalId,
      ).toHaveBeenCalledWith(
        [SocialProvider.FACEBOOK, SocialProvider.INSTAGRAM],
        'meta-user-456',
      );

      // Verify Redis status persistence:
      expect(mockRedis.set).toHaveBeenCalledWith(
        `meta_data_deletion:${result.confirmation_code}`,
        expect.stringContaining('"status":"COMPLETED"'),
        'EX',
        expect.any(Number),
      );

      // Verify audit log call:
      expect(mockAuditService.logActionBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.META_DATA_DELETION,
          targetType: 'MetaUser',
          targetId: 'meta-user-456',
          requestId: 'req-meta-123',
          metadata: expect.objectContaining({
            confirmationCode: result.confirmation_code,
            accountsDeletedCount: 1,
          }),
        }),
      );
    });

    it('throws InternalServerErrorException when META_CLIENT_SECRET is missing', async () => {
      const savedSecret = process.env.META_CLIENT_SECRET;
      delete process.env.META_CLIENT_SECRET;

      try {
        const signedRequest = createSignedRequest({
          user_id: '123',
          algorithm: 'HMAC-SHA256',
        });
        await expect(
          service.handleMetaDataDeletion(signedRequest),
        ).rejects.toThrow(InternalServerErrorException);
      } finally {
        process.env.META_CLIENT_SECRET = savedSecret;
      }
    });
  });

  describe('getMetaDataDeletionStatus', () => {
    it('returns status from Redis cache when present', async () => {
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          confirmationCode: 'del_cached_123',
          userId: 'meta-user-456',
          status: 'COMPLETED',
          accountsDeleted: 2,
          requestedAt: '2026-11-24T12:00:00.000Z',
        }),
      );

      const status = await service.getMetaDataDeletionStatus('del_cached_123');

      expect(status).toEqual({
        confirmation_code: 'del_cached_123',
        status: 'COMPLETED',
        requested_at: '2026-11-24T12:00:00.000Z',
        accounts_deleted: 2,
      });
    });

    it('falls back to AuditLog when not in Redis', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockAuditLogRepo.findByActionAndConfirmationCode.mockResolvedValueOnce({
        id: 'log-1',
        action: AuditAction.META_DATA_DELETION,
        createdAt: new Date('2026-11-24T13:00:00.000Z'),
        metadata: {
          confirmationCode: 'del_db_456',
          accountsDeletedCount: 1,
        },
      });

      const status = await service.getMetaDataDeletionStatus('del_db_456');

      expect(status).toEqual({
        confirmation_code: 'del_db_456',
        status: 'COMPLETED',
        requested_at: '2026-11-24T13:00:00.000Z',
        accounts_deleted: 1,
      });
    });

    it('throws NotFoundException when code does not exist in Redis or DB', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockAuditLogRepo.findByActionAndConfirmationCode.mockResolvedValueOnce(
        null,
      );

      await expect(
        service.getMetaDataDeletionStatus('del_nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
