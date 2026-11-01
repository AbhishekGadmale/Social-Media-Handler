import Redis from "ioredis";
import { generateId } from "@agency-os/database";

export interface SessionData {
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export class SessionManager {
  private readonly SESSION_PREFIX = "session:";
  private readonly USER_SESSIONS_PREFIX = "user_sessions:";
  private readonly SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

  constructor(private readonly redis: Redis) {}

  /**
   * Validates Redis pipeline execution results, propagating errors when any command fails.
   */
  private checkPipelineResults(
    results: Array<[Error | null, any]> | null,
    operationName: string,
  ): asserts results is Array<[Error | null, any]> {
    if (!results) {
      throw new Error(
        `Redis pipeline returned no results for ${operationName}`,
      );
    }
    for (const [err] of results) {
      if (err) {
        throw new Error(
          `Redis operation failed during ${operationName}: ${err.message}`,
        );
      }
    }
  }

  /**
   * Creates a new session for a user and updates the user-to-session index.
   * @param userId The ID of the authenticated user.
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

    const sessionKey = `${this.SESSION_PREFIX}${sessionId}`;
    const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;

    const pipeline = this.redis.pipeline();
    pipeline.set(
      sessionKey,
      JSON.stringify(data),
      "EX",
      this.SESSION_TTL_SECONDS,
    );
    pipeline.sadd(userSessionsKey, sessionId);
    pipeline.expire(userSessionsKey, this.SESSION_TTL_SECONDS);

    const results = await pipeline.exec();
    this.checkPipelineResults(results, "createSession");

    return sessionId;
  }

  /**
   * Validates a session by its ID and slides the expiration window for both
   * the session key and the user session index.
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
      const expiresAt = new Date(
        now.getTime() + this.SESSION_TTL_SECONDS * 1000,
      );
      data.expiresAt = expiresAt.toISOString();

      const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${data.userId}`;

      // Update redis session and refresh user index TTL
      const pipeline = this.redis.pipeline();
      pipeline.set(key, JSON.stringify(data), "EX", this.SESSION_TTL_SECONDS);
      pipeline.expire(userSessionsKey, this.SESSION_TTL_SECONDS);

      const results = await pipeline.exec();
      this.checkPipelineResults(results, "validateSession");

      return data;
    } catch (e) {
      if (e instanceof SyntaxError) {
        return null;
      }
      throw e;
    }
  }

  /**
   * Destroys a single session (ordinary logout) and removes its ID from the user index.
   * @param sessionId The session ID.
   */
  async destroySession(sessionId: string): Promise<void> {
    const sessionKey = `${this.SESSION_PREFIX}${sessionId}`;
    const rawData = await this.redis.get(sessionKey);

    if (rawData) {
      try {
        const data = JSON.parse(rawData) as SessionData;
        const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${data.userId}`;

        const pipeline = this.redis.pipeline();
        pipeline.del(sessionKey);
        pipeline.srem(userSessionsKey, sessionId);

        const results = await pipeline.exec();
        this.checkPipelineResults(results, "destroySession");
        return;
      } catch (e) {
        if (!(e instanceof SyntaxError)) {
          throw e;
        }
      }
    }

    // Fallback if session was already missing or payload corrupted
    await this.redis.del(sessionKey);
  }

  /**
   * Destroys all active sessions for a user (revocation for security/password-change)
   * and clears the user session index atomically.
   * @param userId The user ID whose sessions should be invalidated.
   */
  async destroyAllUserSessions(userId: string): Promise<void> {
    const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;

    // Atomic session revocation via Lua script:
    // Fetches all session IDs in user_sessions:${userId}, deletes every session key,
    // and deletes the user index key in a single atomic Redis step.
    // This prevents race conditions with concurrent session creation.
    const script = `
      local userSessionsKey = KEYS[1]
      local sessionPrefix = ARGV[1]
      local sessionIds = redis.call('SMEMBERS', userSessionsKey)
      for _, sid in ipairs(sessionIds) do
        redis.call('DEL', sessionPrefix .. sid)
      end
      redis.call('DEL', userSessionsKey)
      return sessionIds
    `;

    try {
      await this.redis.eval(script, 1, userSessionsKey, this.SESSION_PREFIX);
    } catch (err: any) {
      throw new Error(
        `Redis operation failed during destroyAllUserSessions: ${err.message}`,
      );
    }
  }

  /**
   * Retrieves active session IDs for a user, optionally purging stale IDs that no
   * longer exist in Redis.
   * @param userId The user ID.
   * @param cleanStale Whether to remove expired/stale session IDs from the index.
   */
  async getUserSessionIds(
    userId: string,
    cleanStale = true,
  ): Promise<string[]> {
    const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;
    const sessionIds = await this.redis.smembers(userSessionsKey);

    if (!sessionIds || sessionIds.length === 0) {
      return [];
    }

    if (!cleanStale) {
      return sessionIds;
    }

    // Verify which session keys actually exist in Redis
    const pipeline = this.redis.pipeline();
    for (const sid of sessionIds) {
      pipeline.exists(`${this.SESSION_PREFIX}${sid}`);
    }
    const results = await pipeline.exec();
    this.checkPipelineResults(results, "getUserSessionIds");

    const activeSessionIds: string[] = [];
    const staleSessionIds: string[] = [];

    sessionIds.forEach((sid, idx) => {
      const exists = results[idx]?.[1] === 1;
      if (exists) {
        activeSessionIds.push(sid);
      } else {
        staleSessionIds.push(sid);
      }
    });

    if (staleSessionIds.length > 0) {
      await this.redis.srem(userSessionsKey, ...staleSessionIds);
    }

    return activeSessionIds;
  }
}
