import Redis from 'ioredis';
import { generateId } from '@agency-os/database';

export interface SessionData {
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export class SessionManager {
  private readonly SESSION_PREFIX = 'session:';
  private readonly SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

  constructor(private readonly redis: Redis) {}

  /**
   * Creates a new session for a user.
   * @param userId The ID of the user.
   * @returns The newly generated session ID.
   */
  async createSession(userId: string): Promise<string> {
    const sessionId = generateId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.SESSION_TTL_SECONDS * 1000);

    const data: SessionData = {
      userId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await this.redis.set(
      `${this.SESSION_PREFIX}${sessionId}`,
      JSON.stringify(data),
      'EX',
      this.SESSION_TTL_SECONDS
    );

    return sessionId;
  }

  /**
   * Validates a session by its ID, and slides the expiration window.
   * @param sessionId The session ID.
   * @returns The SessionData if valid, or null if invalid/expired.
   */
  async validateSession(sessionId: string): Promise<SessionData | null> {
    const key = `${this.SESSION_PREFIX}${sessionId}`;
    const rawData = await this.redis.get(key);

    if (!rawData) {
      return null;
    }

    try {
      const data = JSON.parse(rawData) as SessionData;

      // Sliding expiration: Update TTL
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.SESSION_TTL_SECONDS * 1000);
      data.expiresAt = expiresAt.toISOString();

      // Update redis
      await this.redis.set(
        key,
        JSON.stringify(data),
        'EX',
        this.SESSION_TTL_SECONDS
      );

      return data;
    } catch (e) {
      return null;
    }
  }

  /**
   * Destroys a session.
   * @param sessionId The session ID.
   */
  async destroySession(sessionId: string): Promise<void> {
    await this.redis.del(`${this.SESSION_PREFIX}${sessionId}`);
  }
}
