/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailVerificationTokenRepository } from './EmailVerificationTokenRepository';
import * as crypto from 'crypto';

describe('EmailVerificationTokenRepository', () => {
  let prismaMock: any;
  let repo: EmailVerificationTokenRepository;

  beforeEach(() => {
    prismaMock = {
      emailVerificationToken: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        updateMany: vi.fn(),
      },
      user: {
        update: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(prismaMock)),
    };
    repo = new EmailVerificationTokenRepository(prismaMock);
  });

  describe('createToken', () => {
    it('hashes the raw token with SHA-256 and persists tokenHash with 24h expiration', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const expectedHash = EmailVerificationTokenRepository.hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      prismaMock.emailVerificationToken.create.mockResolvedValue({
        id: 'evt-1',
        tokenHash: expectedHash,
        userId: 'user-1',
        expiresAt,
        consumedAt: null,
      });

      const result = await repo.createToken('user-1', rawToken, expiresAt);

      expect(prismaMock.emailVerificationToken.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          tokenHash: expectedHash,
          userId: 'user-1',
          expiresAt,
          consumedAt: null,
        },
      });
      // Assert raw token is NEVER persisted in the database record
      expect(result.tokenHash).toBe(expectedHash);
      expect((result as any).token).toBeUndefined();
    });
  });

  describe('findByTokenHash', () => {
    it('retrieves token record by tokenHash', async () => {
      const tokenHash = 'test-sha256-hash';
      prismaMock.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        tokenHash,
        userId: 'user-1',
      });

      const result = await repo.findByTokenHash(tokenHash);
      expect(prismaMock.emailVerificationToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash },
      });
      expect(result?.id).toBe('evt-1');
    });
  });

  describe('invalidateActiveUserTokens', () => {
    it('updates all unconsumed tokens for the user with consumedAt', async () => {
      prismaMock.emailVerificationToken.updateMany.mockResolvedValue({
        count: 2,
      });

      const count = await repo.invalidateActiveUserTokens('user-1');

      expect(prismaMock.emailVerificationToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          consumedAt: null,
        },
        data: {
          consumedAt: expect.any(Date),
        },
      });
      expect(count).toBe(2);
    });
  });

  describe('consumeToken', () => {
    it('successfully consumes unconsumed, unexpired token and marks user verified', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = EmailVerificationTokenRepository.hashToken(rawToken);
      const futureDate = new Date(Date.now() + 100000);

      prismaMock.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        tokenHash,
        userId: 'user-1',
        expiresAt: futureDate,
        consumedAt: null,
      });

      prismaMock.emailVerificationToken.updateMany.mockResolvedValue({
        count: 1,
      });

      prismaMock.user.update.mockResolvedValue({
        id: 'user-1',
        emailVerified: true,
      });

      prismaMock.emailVerificationToken.findUniqueOrThrow.mockResolvedValue({
        id: 'evt-1',
        tokenHash,
        userId: 'user-1',
        expiresAt: futureDate,
        consumedAt: new Date(),
      });

      const result = await repo.consumeToken(rawToken);

      expect(result).not.toBeNull();
      expect(result?.user.emailVerified).toBe(true);
      expect(prismaMock.emailVerificationToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash,
          consumedAt: null,
          expiresAt: {
            gt: expect.any(Date),
          },
        },
        data: {
          consumedAt: expect.any(Date),
        },
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          emailVerified: true,
          emailVerifiedAt: expect.any(Date),
        },
      });
    });

    it('returns null when token is already consumed or expired', async () => {
      const rawToken = 'stale-token';
      const tokenHash = EmailVerificationTokenRepository.hashToken(rawToken);

      // Token already consumed
      prismaMock.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        tokenHash,
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100000),
        consumedAt: new Date(Date.now() - 5000),
      });

      const result = await repo.consumeToken(rawToken);
      expect(result).toBeNull();
      expect(prismaMock.emailVerificationToken.updateMany).not.toHaveBeenCalled();
    });

    it('returns null when updateMany count is 0 (concurrent race loser)', async () => {
      const rawToken = 'race-token';
      const tokenHash = EmailVerificationTokenRepository.hashToken(rawToken);
      const futureDate = new Date(Date.now() + 100000);

      prismaMock.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        tokenHash,
        userId: 'user-1',
        expiresAt: futureDate,
        consumedAt: null,
      });

      // Another transaction updated it first
      prismaMock.emailVerificationToken.updateMany.mockResolvedValue({
        count: 0,
      });

      const result = await repo.consumeToken(rawToken);
      expect(result).toBeNull();
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('guarantees single-use consumption under concurrent race conditions', async () => {
      const rawToken = 'concurrent-race-token';
      const tokenHash = EmailVerificationTokenRepository.hashToken(rawToken);
      const futureDate = new Date(Date.now() + 100000);

      prismaMock.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        tokenHash,
        userId: 'user-1',
        expiresAt: futureDate,
        consumedAt: null,
      });

      let consumed = false;
      prismaMock.emailVerificationToken.updateMany.mockImplementation(async () => {
        if (!consumed) {
          consumed = true;
          return { count: 1 };
        }
        return { count: 0 };
      });

      prismaMock.user.update.mockResolvedValue({ id: 'user-1', emailVerified: true });
      prismaMock.emailVerificationToken.findUniqueOrThrow.mockResolvedValue({
        id: 'evt-1',
        tokenHash,
        userId: 'user-1',
        expiresAt: futureDate,
        consumedAt: new Date(),
      });

      // Launch 5 concurrent consumption attempts
      const results = await Promise.all([
        repo.consumeToken(rawToken),
        repo.consumeToken(rawToken),
        repo.consumeToken(rawToken),
        repo.consumeToken(rawToken),
        repo.consumeToken(rawToken),
      ]);

      const successfulAttempts = results.filter((r) => r !== null);
      const failedAttempts = results.filter((r) => r === null);

      expect(successfulAttempts).toHaveLength(1);
      expect(failedAttempts).toHaveLength(4);
    });
  });
});
