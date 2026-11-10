/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PasswordResetTokenRepository } from "./PasswordResetTokenRepository";
import * as crypto from "crypto";

describe("PasswordResetTokenRepository", () => {
  let prismaMock: any;
  let repo: PasswordResetTokenRepository;

  beforeEach(() => {
    prismaMock = {
      passwordResetToken: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        updateMany: vi.fn(),
      },
      user: {
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (cb: any) => cb(prismaMock)),
    };
    repo = new PasswordResetTokenRepository(prismaMock);
  });

  describe("createToken", () => {
    it("hashes the raw token with SHA-256 and persists tokenHash with 1h expiration", async () => {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const expectedHash = PasswordResetTokenRepository.hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      prismaMock.passwordResetToken.create.mockResolvedValue({
        id: "prt-1",
        tokenHash: expectedHash,
        userId: "user-1",
        expiresAt,
        consumedAt: null,
      });

      const result = await repo.createToken("user-1", rawToken, expiresAt);

      expect(prismaMock.passwordResetToken.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          tokenHash: expectedHash,
          userId: "user-1",
          expiresAt,
          consumedAt: null,
        },
      });
      // Assert raw token is NEVER persisted in the database record
      expect(result.tokenHash).toBe(expectedHash);
      expect((result as any).token).toBeUndefined();
    });
  });

  describe("findByTokenHash", () => {
    it("retrieves token record by tokenHash", async () => {
      const tokenHash = "test-sha256-hash";
      prismaMock.passwordResetToken.findUnique.mockResolvedValue({
        id: "prt-1",
        tokenHash,
        userId: "user-1",
      });

      const result = await repo.findByTokenHash(tokenHash);
      expect(prismaMock.passwordResetToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash },
      });
      expect(result?.id).toBe("prt-1");
    });
  });

  describe("invalidateActiveUserTokens", () => {
    it("updates all unconsumed tokens for the user with consumedAt", async () => {
      prismaMock.passwordResetToken.updateMany.mockResolvedValue({
        count: 2,
      });

      const count = await repo.invalidateActiveUserTokens("user-1");

      expect(prismaMock.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          consumedAt: null,
        },
        data: {
          consumedAt: expect.any(Date),
        },
      });
      expect(count).toBe(2);
    });
  });

  describe("consumeToken", () => {
    it("successfully consumes unconsumed, unexpired token and returns user without altering emailVerified", async () => {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = PasswordResetTokenRepository.hashToken(rawToken);
      const futureDate = new Date(Date.now() + 100000);

      prismaMock.passwordResetToken.findUnique.mockResolvedValue({
        id: "prt-1",
        userId: "user-1",
        tokenHash,
        expiresAt: futureDate,
        consumedAt: null,
      });

      prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

      prismaMock.user.findUniqueOrThrow.mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        emailVerified: false, // Does NOT modify emailVerified
      });

      prismaMock.passwordResetToken.findUniqueOrThrow.mockResolvedValue({
        id: "prt-1",
        tokenHash,
        consumedAt: expect.any(Date),
      });

      const result = await repo.consumeToken(rawToken);

      expect(result).not.toBeNull();
      expect(result?.user.id).toBe("user-1");
      expect(prismaMock.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash,
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: {
          consumedAt: expect.any(Date),
        },
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("returns null when token does not exist", async () => {
      prismaMock.passwordResetToken.findUnique.mockResolvedValue(null);

      const result = await repo.consumeToken("non-existent-token");
      expect(result).toBeNull();
      expect(prismaMock.passwordResetToken.updateMany).not.toHaveBeenCalled();
    });

    it("returns null when token is already consumed", async () => {
      const rawToken = "consumed-token";
      const tokenHash = PasswordResetTokenRepository.hashToken(rawToken);

      prismaMock.passwordResetToken.findUnique.mockResolvedValue({
        id: "prt-1",
        userId: "user-1",
        tokenHash,
        expiresAt: new Date(Date.now() + 100000),
        consumedAt: new Date(Date.now() - 5000),
      });

      const result = await repo.consumeToken(rawToken);
      expect(result).toBeNull();
      expect(prismaMock.passwordResetToken.updateMany).not.toHaveBeenCalled();
    });

    it("returns null when token is expired", async () => {
      const rawToken = "expired-token";
      const tokenHash = PasswordResetTokenRepository.hashToken(rawToken);

      prismaMock.passwordResetToken.findUnique.mockResolvedValue({
        id: "prt-1",
        userId: "user-1",
        tokenHash,
        expiresAt: new Date(Date.now() - 5000),
        consumedAt: null,
      });

      const result = await repo.consumeToken(rawToken);
      expect(result).toBeNull();
      expect(prismaMock.passwordResetToken.updateMany).not.toHaveBeenCalled();
    });

    it("returns null when concurrent CAS updateMany claims count === 0", async () => {
      const rawToken = "concurrent-token";
      const tokenHash = PasswordResetTokenRepository.hashToken(rawToken);

      prismaMock.passwordResetToken.findUnique.mockResolvedValue({
        id: "prt-1",
        userId: "user-1",
        tokenHash,
        expiresAt: new Date(Date.now() + 100000),
        consumedAt: null,
      });

      prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

      const result = await repo.consumeToken(rawToken);
      expect(result).toBeNull();
      expect(prismaMock.user.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });
});
