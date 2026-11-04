import { describe, it, expect, beforeEach } from "vitest";
import { SessionManager } from "./SessionManager";
import type { SessionData } from "./SessionManager";

/**
 * In-memory Redis mock for SessionManager unit tests.
 * Implements faithful simulation of the 5 Lua scripts for fast local unit testing.
 */
class InMemoryRedisMock {
  public kvStore = new Map<string, string>();
  public setStore = new Map<string, Set<string>>();
  public ttlStore = new Map<string, number>();
  public evalFailures: Error[] = [];

  async get(key: string): Promise<string | null> {
    return this.kvStore.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    mode?: string,
    ttl?: number,
  ): Promise<"OK"> {
    this.kvStore.set(key, value);
    if (mode === "EX" && typeof ttl === "number") {
      this.ttlStore.set(key, ttl);
    }
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.kvStore.delete(key)) count++;
      if (this.setStore.delete(key)) count++;
      this.ttlStore.delete(key);
    }
    return count;
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.setStore.get(key);
    return set ? Array.from(set) : [];
  }

  async ttl(key: string): Promise<number> {
    return this.ttlStore.get(key) ?? -2;
  }

  eval(script: string, numKeys: number, ...args: any[]): Promise<any> {
    if (this.evalFailures.length > 0) {
      const err = this.evalFailures.shift()!;
      return Promise.reject(err);
    }

    // 1. CREATE_SESSION_SCRIPT (has ARGV[3] as sessionId and SET with sessionDataJson)
    if (script.includes("local sessionDataJson = ARGV[1]")) {
      const sessionKey = args[0];
      const userSessionsKey = args[1];
      const sessionDataJson = args[2];
      const ttlSeconds = parseInt(args[3], 10);
      const sessionId = args[4];

      this.kvStore.set(sessionKey, sessionDataJson);
      this.ttlStore.set(sessionKey, ttlSeconds);

      let set = this.setStore.get(userSessionsKey);
      if (!set) {
        set = new Set<string>();
        this.setStore.set(userSessionsKey, set);
      }
      set.add(sessionId);

      const currentTtl = this.ttlStore.get(userSessionsKey) ?? -2;
      if (currentTtl < ttlSeconds) {
        this.ttlStore.set(userSessionsKey, ttlSeconds);
      }
      return Promise.resolve("OK");
    }

    // 2. VALIDATE_SESSION_SCRIPT (has newExpiresAtIso)
    if (script.includes("local newExpiresAtIso = ARGV[3]")) {
      const sessionKey = args[0];
      const userSessionsPrefix = args[1];
      const ttlSeconds = parseInt(args[2], 10);
      const newExpiresAtIso = args[3];
      const sessionId = args[4];

      const rawData = this.kvStore.get(sessionKey);
      if (!rawData) {
        return Promise.resolve(null);
      }

      let data: any;
      try {
        data = JSON.parse(rawData);
        if (!data || typeof data !== "object") {
          return Promise.resolve(null);
        }
      } catch {
        return Promise.resolve(null);
      }

      data.expiresAt = newExpiresAtIso;
      const updatedJson = JSON.stringify(data);

      this.kvStore.set(sessionKey, updatedJson);
      this.ttlStore.set(sessionKey, ttlSeconds);

      if (data.userId) {
        const userSessionsKey = `${userSessionsPrefix}${data.userId}`;
        let set = this.setStore.get(userSessionsKey);
        if (!set) {
          set = new Set<string>();
          this.setStore.set(userSessionsKey, set);
        }
        if (sessionId) {
          set.add(sessionId);
        }
        const currentTtl = this.ttlStore.get(userSessionsKey) ?? -2;
        if (currentTtl < ttlSeconds) {
          this.ttlStore.set(userSessionsKey, ttlSeconds);
        }
      }

      return Promise.resolve(updatedJson);
    }

    // 3. DESTROY_SESSION_SCRIPT (has DEL sessionKey)
    if (script.includes("redis.call('DEL', sessionKey)")) {
      const sessionKey = args[0];
      const userSessionsPrefix = args[1];
      const sessionId = args[2];

      const rawData = this.kvStore.get(sessionKey);
      if (rawData) {
        try {
          const data = JSON.parse(rawData);
          if (data && data.userId) {
            const userSessionsKey = `${userSessionsPrefix}${data.userId}`;
            const set = this.setStore.get(userSessionsKey);
            if (set) {
              set.delete(sessionId);
              if (set.size === 0) {
                this.setStore.delete(userSessionsKey);
                this.ttlStore.delete(userSessionsKey);
              }
            }
          }
        } catch {
          // ignore json parse error
        }
      }

      this.kvStore.delete(sessionKey);
      this.ttlStore.delete(sessionKey);
      return Promise.resolve("OK");
    }

    // 4. DESTROY_ALL_USER_SESSIONS_SCRIPT (has DEL userSessionsKey)
    if (script.includes("redis.call('DEL', userSessionsKey)")) {
      const userSessionsKey = args[0];
      const sessionPrefix = args[1];

      const set = this.setStore.get(userSessionsKey);
      const sessionIds = set ? Array.from(set) : [];
      for (const sid of sessionIds) {
        this.kvStore.delete(`${sessionPrefix}${sid}`);
        this.ttlStore.delete(`${sessionPrefix}${sid}`);
      }
      this.setStore.delete(userSessionsKey);
      this.ttlStore.delete(userSessionsKey);
      return Promise.resolve(sessionIds);
    }

    // 5. GET_AND_CLEAN_SESSIONS_SCRIPT (has activeSessionIds)
    if (script.includes("local activeSessionIds = {}")) {
      const userSessionsKey = args[0];
      const sessionPrefix = args[1];

      const set = this.setStore.get(userSessionsKey);
      const sessionIds = set ? Array.from(set) : [];
      const activeSessionIds: string[] = [];

      for (const sid of sessionIds) {
        if (this.kvStore.has(`${sessionPrefix}${sid}`)) {
          activeSessionIds.push(sid);
        } else if (set) {
          set.delete(sid);
        }
      }

      if (set && set.size === 0) {
        this.setStore.delete(userSessionsKey);
        this.ttlStore.delete(userSessionsKey);
      }

      return Promise.resolve(activeSessionIds);
    }

    // 6. DESTROY_OTHER_USER_SESSIONS_SCRIPT (has keepSessionId)
    if (script.includes("local keepSessionId = ARGV[2]")) {
      const userSessionsKey = args[0];
      const sessionPrefix = args[1];
      const keepSessionId = args[2];
      const ttlSeconds = parseInt(args[3], 10);
      const newSecurityEpoch = args[4] && args[4] !== "" ? parseInt(args[4], 10) : undefined;

      const set = this.setStore.get(userSessionsKey);
      const sessionIds = set ? Array.from(set) : [];
      let destroyedCount = 0;

      for (const sid of sessionIds) {
        if (sid !== keepSessionId) {
          this.kvStore.delete(`${sessionPrefix}${sid}`);
          this.ttlStore.delete(`${sessionPrefix}${sid}`);
          if (set) {
            set.delete(sid);
          }
          destroyedCount++;
        }
      }

      if (keepSessionId) {
        if (!set) {
          const newSet = new Set<string>();
          newSet.add(keepSessionId);
          this.setStore.set(userSessionsKey, newSet);
        } else {
          set.add(keepSessionId);
        }
        const currentTtl = this.ttlStore.get(userSessionsKey) ?? -2;
        if (currentTtl < ttlSeconds) {
          this.ttlStore.set(userSessionsKey, ttlSeconds);
        }

        if (typeof newSecurityEpoch === "number" && !isNaN(newSecurityEpoch)) {
          const keepKey = `${sessionPrefix}${keepSessionId}`;
          const rawData = this.kvStore.get(keepKey);
          if (rawData) {
            try {
              const data = JSON.parse(rawData);
              if (data && typeof data === "object") {
                data.securityEpoch = newSecurityEpoch;
                this.kvStore.set(keepKey, JSON.stringify(data));
              }
            } catch {
              // ignore parse error
            }
          }
        }
      }

      return Promise.resolve(destroyedCount);
    }

    return Promise.reject(new Error(`Unrecognized script in mock: ${script}`));
  }
}

describe("SessionManager (Unit Tests with Atomic Script Simulation)", () => {
  let redisMock: InMemoryRedisMock;
  let sessionManager: SessionManager;

  beforeEach(() => {
    redisMock = new InMemoryRedisMock();
    sessionManager = new SessionManager(redisMock as any);
  });

  // Scenario 1: Multi-user session indexing
  it("1. indexes sessions under correct user keys when sessions are created for two different users", async () => {
    const user1 = "user-uuid-1";
    const user2 = "user-uuid-2";

    const sess1 = await sessionManager.createSession(user1);
    const sess2 = await sessionManager.createSession(user1);
    const sess3 = await sessionManager.createSession(user2);

    const user1Sessions = await sessionManager.getUserSessionIds(user1);
    const user2Sessions = await sessionManager.getUserSessionIds(user2);

    expect(user1Sessions).toHaveLength(2);
    expect(user1Sessions).toContain(sess1);
    expect(user1Sessions).toContain(sess2);
    expect(user1Sessions).not.toContain(sess3);

    expect(user2Sessions).toHaveLength(1);
    expect(user2Sessions).toContain(sess3);
    expect(user2Sessions).not.toContain(sess1);
    expect(user2Sessions).not.toContain(sess2);

    const rawUser1Set = await redisMock.smembers(`user_sessions:${user1}`);
    const rawUser2Set = await redisMock.smembers(`user_sessions:${user2}`);
    expect(rawUser1Set.sort()).toEqual([sess1, sess2].sort());
    expect(rawUser2Set).toEqual([sess3]);
  });

  // Scenario 2: Single session destruction
  it("2. removes only the destroyed session from the user index upon single session destruction", async () => {
    const userId = "user-multisession";
    const sessA = await sessionManager.createSession(userId);
    const sessB = await sessionManager.createSession(userId);

    await sessionManager.destroySession(sessA);

    const remainingSessions = await sessionManager.getUserSessionIds(userId);
    expect(remainingSessions).toEqual([sessB]);

    // sessA must return null upon validation
    const validA = await sessionManager.validateSession(sessA);
    expect(validA).toBeNull();

    // sessB remains valid
    const validB = await sessionManager.validateSession(sessB);
    expect(validB).not.toBeNull();
    expect(validB?.userId).toBe(userId);
  });

  // Scenario 3: All-session invalidation
  it("3. invalidates all active sessions for a user when destroyAllUserSessions is called", async () => {
    const userId = "user-revocation-target";
    const sess1 = await sessionManager.createSession(userId);
    const sess2 = await sessionManager.createSession(userId);
    const sess3 = await sessionManager.createSession(userId);

    await sessionManager.destroyAllUserSessions(userId);

    expect(await sessionManager.validateSession(sess1)).toBeNull();
    expect(await sessionManager.validateSession(sess2)).toBeNull();
    expect(await sessionManager.validateSession(sess3)).toBeNull();

    const userSessions = await sessionManager.getUserSessionIds(userId);
    expect(userSessions).toEqual([]);

    expect(await redisMock.get(`session:${sess1}`)).toBeNull();
    expect(await redisMock.get(`session:${sess2}`)).toBeNull();
    expect(await redisMock.get(`session:${sess3}`)).toBeNull();
    expect(await redisMock.smembers(`user_sessions:${userId}`)).toEqual([]);
  });

  // Scenario 4: User isolation
  it("4. preserves valid sessions of User B when revoking all sessions of User A", async () => {
    const userA = "user-victim-revocation";
    const userB = "user-innocent-bystander";

    const sessA1 = await sessionManager.createSession(userA);
    const sessA2 = await sessionManager.createSession(userA);
    const sessB1 = await sessionManager.createSession(userB);

    await sessionManager.destroyAllUserSessions(userA);

    expect(await sessionManager.validateSession(sessA1)).toBeNull();
    expect(await sessionManager.validateSession(sessA2)).toBeNull();
    expect(await sessionManager.getUserSessionIds(userA)).toEqual([]);

    const validB = await sessionManager.validateSession(sessB1);
    expect(validB).not.toBeNull();
    expect(validB?.userId).toBe(userB);
    expect(await sessionManager.getUserSessionIds(userB)).toEqual([sessB1]);
  });

  // Scenario 5: Ordinary logout isolation
  it("5. preserves other user sessions during ordinary logout (destroySession)", async () => {
    const userId = "user-multi-device";
    const mobileSession = await sessionManager.createSession(userId);
    const desktopSession = await sessionManager.createSession(userId);

    await sessionManager.destroySession(mobileSession);

    expect(await sessionManager.validateSession(mobileSession)).toBeNull();

    const validDesktop = await sessionManager.validateSession(desktopSession);
    expect(validDesktop).not.toBeNull();
    expect(validDesktop?.userId).toBe(userId);

    const activeSessions = await sessionManager.getUserSessionIds(userId);
    expect(activeSessions).toEqual([desktopSession]);
  });

  // Scenario 6: Sliding TTL refresh
  it("6. keeps session and index expiry aligned during sliding TTL refresh (validateSession)", async () => {
    const userId = "user-sliding-ttl";
    const sessionId = await sessionManager.createSession(userId);

    const initialSessionTtl = await redisMock.ttl(`session:${sessionId}`);
    const initialIndexTtl = await redisMock.ttl(`user_sessions:${userId}`);
    expect(initialSessionTtl).toBe(7 * 24 * 60 * 60);
    expect(initialIndexTtl).toBe(7 * 24 * 60 * 60);

    // Simulate TTL decay
    redisMock.ttlStore.set(`session:${sessionId}`, 3600);
    redisMock.ttlStore.set(`user_sessions:${userId}`, 3600);

    const validated = await sessionManager.validateSession(sessionId);
    expect(validated).not.toBeNull();

    const refreshedSessionTtl = await redisMock.ttl(`session:${sessionId}`);
    const refreshedIndexTtl = await redisMock.ttl(`user_sessions:${userId}`);
    expect(refreshedSessionTtl).toBe(7 * 24 * 60 * 60);
    expect(refreshedIndexTtl).toBe(7 * 24 * 60 * 60);
  });

  // Scenario 7: Stale session ID cleanup
  it("7. safely cleans up stale/expired session IDs and never allows stale index entries to grant access", async () => {
    const userId = "user-stale-cleanup";
    const activeSession = await sessionManager.createSession(userId);
    const staleSession = await sessionManager.createSession(userId);

    // Simulate Redis TTL expiration of staleSession key
    await redisMock.del(`session:${staleSession}`);

    // Stale key must never grant access
    const staleValidation = await sessionManager.validateSession(staleSession);
    expect(staleValidation).toBeNull();

    // Querying with cleanup removes the stale ID
    const activeSessions = await sessionManager.getUserSessionIds(userId, true);
    expect(activeSessions).toEqual([activeSession]);

    const rawSet = await redisMock.smembers(`user_sessions:${userId}`);
    expect(rawSet).toEqual([activeSession]);
  });

  // Scenario 8: Error propagation
  it("8. propagates Redis errors during revocation and does not falsely report success", async () => {
    const userId = "user-error-handling";
    await sessionManager.createSession(userId);

    redisMock.evalFailures.push(new Error("Redis cluster connection failure"));

    await expect(sessionManager.destroyAllUserSessions(userId)).rejects.toThrow(
      /Failed to revoke all user sessions in Redis/,
    );
  });

  // Scenario 9: Deterministic creation vs revocation ordering
  it("9. strictly distinguishes pre-revocation sessions from post-revocation sessions without ambiguous assertions", async () => {
    const userId = "user-ordering-test";

    // 1. Sessions created BEFORE revocation
    const preRevocationSessions = await Promise.all([
      sessionManager.createSession(userId),
      sessionManager.createSession(userId),
      sessionManager.createSession(userId),
    ]);

    // 2. Linearization point: Revocation completes
    await sessionManager.destroyAllUserSessions(userId);

    // Every pre-revocation session MUST be dead
    for (const sid of preRevocationSessions) {
      expect(await sessionManager.validateSession(sid)).toBeNull();
    }
    expect(await sessionManager.getUserSessionIds(userId)).toEqual([]);

    // 3. Session created AFTER revocation completes
    const postRevocationSession = await sessionManager.createSession(userId);

    // Must be valid and correctly indexed as a new session
    const validPost = await sessionManager.validateSession(
      postRevocationSession,
    );
    expect(validPost).not.toBeNull();
    expect(validPost?.userId).toBe(userId);

    const activeSessions = await sessionManager.getUserSessionIds(userId);
    expect(activeSessions).toEqual([postRevocationSession]);
  });

  // Finding F1 verification: Validate cannot resurrect a deleted session
  it("F1. validateSession cannot resurrect a session that was deleted while validation was attempted", async () => {
    const userId = "user-f1-test";
    const sessionId = await sessionManager.createSession(userId);

    // Delete session from Redis (simulating concurrent revoke-all or logout)
    await redisMock.del(`session:${sessionId}`, `user_sessions:${userId}`);

    // Validation must return null and must NOT write back to Redis
    const validated = await sessionManager.validateSession(sessionId);
    expect(validated).toBeNull();
    expect(await redisMock.get(`session:${sessionId}`)).toBeNull();
  });

  // PR #48 Hardening 1: Self-healing missing user_sessions set on valid session validation
  it("PR48-1. validateSession self-heals a missing or evicted user_sessions index set", async () => {
    const userId = "user-self-heal";
    const sessionId = await sessionManager.createSession(userId);

    // Simulate eviction or deletion of the user_sessions set while session payload survives
    await redisMock.del(`user_sessions:${userId}`);
    expect(await redisMock.smembers(`user_sessions:${userId}`)).toEqual([]);

    // validateSession should heal the missing index entry
    const validated = await sessionManager.validateSession(sessionId);
    expect(validated).not.toBeNull();
    expect(validated?.userId).toBe(userId);

    // Index set should now contain the sessionId again
    const userSessions = await sessionManager.getUserSessionIds(userId);
    expect(userSessions).toContain(sessionId);
    expect(await redisMock.smembers(`user_sessions:${userId}`)).toEqual([
      sessionId,
    ]);
  });

  // PR #48 Hardening 2: Corrupt session JSON handling (fail-closed, returns null without authenticating or throwing)
  it("PR48-2. validateSession fails closed and returns null when session data in Redis is corrupt JSON", async () => {
    const sessionId = "sess-corrupt-data";
    // Write malformed non-JSON data directly to the session key
    await redisMock.set(
      `session:${sessionId}`,
      "{malformed-json:broken",
      "EX",
      3600,
    );

    const validated = await sessionManager.validateSession(sessionId);
    expect(validated).toBeNull();
  });

  // PR #48 Hardening 3: destroyOtherUserSessions preserves current session and invalidates all others
  it("PR48-3. destroyOtherUserSessions preserves the specified session and revokes all other sessions", async () => {
    const userId = "user-multi-device-change-pw";
    const currentSession = await sessionManager.createSession(userId);
    const otherSession1 = await sessionManager.createSession(userId);
    const otherSession2 = await sessionManager.createSession(userId);

    // Pre-condition: user has 3 active sessions
    expect(await sessionManager.getUserSessionIds(userId)).toHaveLength(3);

    // Revoke all OTHER sessions, keeping currentSession
    const destroyedCount = await (
      sessionManager as any
    ).destroyOtherUserSessions(userId, currentSession);
    expect(destroyedCount).toBe(2);

    // Current session remains fully valid
    const validCurrent = await sessionManager.validateSession(currentSession);
    expect(validCurrent).not.toBeNull();
    expect(validCurrent?.userId).toBe(userId);

    // Other sessions are completely destroyed
    expect(await sessionManager.validateSession(otherSession1)).toBeNull();
    expect(await sessionManager.validateSession(otherSession2)).toBeNull();
    expect(await redisMock.get(`session:${otherSession1}`)).toBeNull();
    expect(await redisMock.get(`session:${otherSession2}`)).toBeNull();

    // User index only contains currentSession
    const remainingIds = await sessionManager.getUserSessionIds(userId);
    expect(remainingIds).toEqual([currentSession]);
  });

  // PR #48 Hardening 4: destroyOtherUserSessions propagates Redis errors
  it("PR48-4. destroyOtherUserSessions propagates Redis errors gracefully", async () => {
    const userId = "user-error-other";
    const currentSession = await sessionManager.createSession(userId);

    redisMock.evalFailures.push(new Error("Redis connection dropped"));

    await expect(
      (sessionManager as any).destroyOtherUserSessions(userId, currentSession),
    ).rejects.toThrow(/Failed to revoke other user sessions in Redis/);
  });
  // PR #49 Hardening 1: createSession with securityEpoch
  it("PR49-1. createSession stores securityEpoch in session data and validateSession preserves it", async () => {
    const userId = "user-epoch-create";
    const sessionId = await sessionManager.createSession(userId, 3);

    const session = await sessionManager.validateSession(sessionId);
    expect(session).not.toBeNull();
    expect(session?.userId).toBe(userId);
    expect(session?.securityEpoch).toBe(3);
  });

  // PR #49 Hardening 2: destroyOtherUserSessions updates keepSessionId's securityEpoch
  it("PR49-2. destroyOtherUserSessions atomically updates securityEpoch on the preserved session", async () => {
    const userId = "user-epoch-update";
    const currentSession = await sessionManager.createSession(userId, 1);
    const otherSession = await sessionManager.createSession(userId, 1);

    const destroyedCount = await sessionManager.destroyOtherUserSessions(
      userId,
      currentSession,
      2,
    );
    expect(destroyedCount).toBe(1);

    // Other session is gone
    expect(await sessionManager.validateSession(otherSession)).toBeNull();

    // Current session is preserved and has epoch updated to 2
    const validatedCurrent = await sessionManager.validateSession(currentSession);
    expect(validatedCurrent).not.toBeNull();
    expect(validatedCurrent?.userId).toBe(userId);
    expect(validatedCurrent?.securityEpoch).toBe(2);
  });
});