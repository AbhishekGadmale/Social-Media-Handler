import {
  PrismaClient,
  EmailVerificationToken,
  User,
  Prisma,
} from "@prisma/client";
import { generateId } from "../id";
import * as crypto from "crypto";

export class EmailVerificationTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static hashToken(rawToken: string): string {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
  }

  static generateRawToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  async createToken(
    userId: string,
    rawToken: string,
    expiresAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<EmailVerificationToken> {
    const client = tx ?? this.prisma;
    const tokenHash = EmailVerificationTokenRepository.hashToken(rawToken);

    return client.emailVerificationToken.create({
      data: {
        id: generateId(),
        userId,
        tokenHash,
        expiresAt,
        consumedAt: null,
      },
    });
  }

  /**
   * Invalidates any active (unconsumed) verification tokens for a given user.
   * Useful when re-issuing a verification email to ensure prior links are retired.
   */
  async invalidateActiveUserTokens(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.emailVerificationToken.updateMany({
      where: {
        userId,
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });
    return result.count;
  }

  async findByTokenHash(
    tokenHash: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EmailVerificationToken | null> {
    const client = tx ?? this.prisma;
    return client.emailVerificationToken.findUnique({
      where: { tokenHash },
    });
  }

  /**
   * Atomically consumes a verification token in a single conditional update.
   * Succeeds if and only if:
   * 1. A token matching the SHA-256 hash exists.
   * 2. consumedAt IS NULL (single-use invariant).
   * 3. expiresAt > NOW() (not expired).
   *
   * If valid, updates consumedAt to NOW() and updates the User's emailVerified to true in the same transaction.
   * Under concurrent consumption attempts, database row locks ensure exactly one caller receives count === 1.
   */
  async consumeToken(
    rawToken: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ token: EmailVerificationToken; user: User } | null> {
    const tokenHash = EmailVerificationTokenRepository.hashToken(rawToken);

    const execute = async (client: Prisma.TransactionClient) => {
      const existing = await client.emailVerificationToken.findUnique({
        where: { tokenHash },
      });

      if (!existing) {
        return null;
      }

      const now = new Date();
      if (existing.consumedAt !== null || existing.expiresAt <= now) {
        return null;
      }

      const updateResult = await client.emailVerificationToken.updateMany({
        where: {
          tokenHash,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          consumedAt: now,
        },
      });

      if (updateResult.count !== 1) {
        return null;
      }

      const user = await client.user.update({
        where: { id: existing.userId },
        data: {
          emailVerified: true,
          emailVerifiedAt: now,
        },
      });

      const updatedToken = await client.emailVerificationToken.findUniqueOrThrow({
        where: { tokenHash },
      });

      return { token: updatedToken, user };
    };

    if (tx) {
      return execute(tx);
    }

    return this.prisma.$transaction(async (t) => execute(t));
  }
}
