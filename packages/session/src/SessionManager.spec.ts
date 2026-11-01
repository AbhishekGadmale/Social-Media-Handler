import { describe, it, expect, beforeEach } from "vitest";
import { SessionManager } from "./SessionManager";
import type { SessionData } from "./SessionManager";

/**
 * High-fidelity in-memory Redis simulator for SessionManager unit tests.
 * Accurately implements key-value, set operations, TTL tracking, eval, and pipelining.
 */
class InMemoryRedisMock {
  public kvStore = new Map<string, string>();
  public setStore = new Map<string, Set<string>>();
  public ttlStore = new Map<string, number>();
  public pipelineFailures: Error[] = [];

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

  async sadd(key: string, ...members: string[]): Promise<number> {
    let set = this.setStore.get(key);
    if (!set) {
      set = new Set<string>();
      this.setStore.set(key, set);
    }
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.setStore.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    if (set.size === 0) {
      this.setStore.delete(key);
    }
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.setStore.get(key);
    return set ? Array.from(set) : [];
  }

  async scard(key: string): Promise<number> {
    const set = this.setStore.get(key);
    return set ? set.size : 0;
  }

  async exists(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.kvStore.has(key) || this.setStore.has(key)) count++;
    }
    return count;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.kvStore.has(key) || this.setStore.has(key)) {
      this.ttlStore.set(key, seconds);
      return 1;
    }
    return 0;
  }

  async ttl(key: string): Promise<number> {
    return this.ttlStore.get(key) ?? -2;
  }

  eval(script: string, numKeys: number, ...args: any[]): Promise<any> {
    if (this.pipelineFailures.length > 0) {
      const err = this.pipelineFailures.shift()!;
      return Promise.reject(err);
    }

    // Atomic simulation of destroyAllUserSessions Lua script
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

  pipeline() {
    const commands: Array<() => Promise<any>> = [];
    const client = this;

    const pipe = {
      set(key: string, val: string, mode?: string, ttl?: number) {
        commands.push(() => client.set(key, val, mode, ttl));
        return pipe;
      },
      del(...keys: string[]) {
        commands.push(() => client.del(...keys));
        return pipe;
      },
      sadd(key: string, ...members: string[]) {
        commands.push(() => client.sadd(key, ...members));
        return pipe;
      },
      srem(key: string, ...members: string[]) {
        commands.push(() => client.srem(key, ...members));
        return pipe;
      },
      expire(key: string, seconds: number) {
        commands.push(() => client.expire(key, seconds));
        return pipe;
      },
      exists(key: string) {
        commands.push(() => client.exists(key));
        return pipe;
      },
      async exec(): Promise<Array<[Error | null, any]>> {
        if (client.pipelineFailures.length > 0) {
          const err = client.pipelineFailures.shift()!;
          return [[err, null]];
        }
        const results: Array<[Error | null, any]> = [];
        for (const cmd of commands) {
          try {
            const res = await cmd();
            results.push([null, res]);
          } catch (e: any) {
            results.push([e, null]);
          }
        }
        return results;
      },
    };

    return pipe;
  }
}

describe("SessionManager (Phase 7.1 User Session Indexing & Revocation)", () => {
  let redisMock: InMemoryRedisMock;
  let sessionManager: SessionManager;

  beforeEach(() => {
    redisMock = new InMemoryRedisMock();
    sessionManager = new SessionManager(redisMock as any);
  });

  // Scenario 1: Creating sessions for two different users indexes each session under the correct user
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

    // Verify Redis Set keys directly
    const rawUser1Set = await redisMock.smembers(`user_sessions:${user1}`);
    const rawUser2Set = await redisMock.smembers(`user_sessions:${user2}`);
    expect(rawUser1Set.sort()).toEqual([sess1, sess2].sort());
    expect(rawUser2Set).toEqual([sess3]);
  });

  // Scenario 2: Destroying one session removes only that session from its index
  it("2. removes only the destroyed session from the user index upon single session destruction", async () => {
    const userId = "user-multisession";
    const sessA = await sessionManager.createSession(userId);
    const sessB = await sessionManager.createSession(userId);

    await sessionManager.destroySession(sessA);

    const remainingSessions = await sessionManager.getUserSessionIds(userId);
    expect(remainingSessions).toEqual([sessB]);

    // sessA should return null upon validation
    const validA = await sessionManager.validateSession(sessA);
    expect(validA).toBeNull();

    // sessB should remain valid
    const validB = await sessionManager.validateSession(sessB);
    expect(validB).not.toBeNull();
    expect(validB?.userId).toBe(userId);
  });

  // Scenario 3: Destroying all sessions for a user invalidates every session belonging to that user
  it("3. invalidates all active sessions for a user when destroyAllUserSessions is called", async () => {
    const userId = "user-revocation-target";
    const sess1 = await sessionManager.createSession(userId);
    const sess2 = await sessionManager.createSession(userId);
    const sess3 = await sessionManager.createSession(userId);

    await sessionManager.destroyAllUserSessions(userId);

    // All sessions should be invalidated
    expect(await sessionManager.validateSession(sess1)).toBeNull();
    expect(await sessionManager.validateSession(sess2)).toBeNull();
    expect(await sessionManager.validateSession(sess3)).toBeNull();

    // User index should be completely empty
    const userSessions = await sessionManager.getUserSessionIds(userId);
    expect(userSessions).toEqual([]);

    // Raw Redis keys should be gone
    expect(await redisMock.get(`session:${sess1}`)).toBeNull();
    expect(await redisMock.get(`session:${sess2}`)).toBeNull();
    expect(await redisMock.get(`session:${sess3}`)).toBeNull();
    expect(await redisMock.smembers(`user_sessions:${userId}`)).toEqual([]);
  });

  // Scenario 4: Revoking one user's sessions leaves another user's sessions valid
  it("4. preserves valid sessions of User B when revoking all sessions of User A", async () => {
    const userA = "user-victim-revocation";
    const userB = "user-innocent-bystander";

    const sessA1 = await sessionManager.createSession(userA);
    const sessA2 = await sessionManager.createSession(userA);
    const sessB1 = await sessionManager.createSession(userB);

    await sessionManager.destroyAllUserSessions(userA);

    // User A sessions are dead
    expect(await sessionManager.validateSession(sessA1)).toBeNull();
    expect(await sessionManager.validateSession(sessA2)).toBeNull();
    expect(await sessionManager.getUserSessionIds(userA)).toEqual([]);

    // User B session is alive and valid
    const validB = await sessionManager.validateSession(sessB1);
    expect(validB).not.toBeNull();
    expect(validB?.userId).toBe(userB);
    expect(await sessionManager.getUserSessionIds(userB)).toEqual([sessB1]);
  });

  // Scenario 5: Ordinary logout revokes only the current session
  it("5. preserves other user sessions during ordinary logout (destroySession)", async () => {
    const userId = "user-multi-device";
    const mobileSession = await sessionManager.createSession(userId);
    const desktopSession = await sessionManager.createSession(userId);

    // User logs out from mobile only
    await sessionManager.destroySession(mobileSession);

    expect(await sessionManager.validateSession(mobileSession)).toBeNull();

    const validDesktop = await sessionManager.validateSession(desktopSession);
    expect(validDesktop).not.toBeNull();
    expect(validDesktop?.userId).toBe(userId);

    const activeSessions = await sessionManager.getUserSessionIds(userId);
    expect(activeSessions).toEqual([desktopSession]);
  });

  // Scenario 6: Sliding TTL refresh keeps session and index expiry behavior consistent
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

    // validateSession triggers sliding TTL refresh
    const validated = await sessionManager.validateSession(sessionId);
    expect(validated).not.toBeNull();

    const refreshedSessionTtl = await redisMock.ttl(`session:${sessionId}`);
    const refreshedIndexTtl = await redisMock.ttl(`user_sessions:${userId}`);
    expect(refreshedSessionTtl).toBe(7 * 24 * 60 * 60);
    expect(refreshedIndexTtl).toBe(7 * 24 * 60 * 60);
  });

  // Scenario 7: Expired or stale session IDs are cleaned up safely
  it("7. safely cleans up stale/expired session IDs and never allows stale index entries to grant access", async () => {
    const userId = "user-stale-cleanup";
    const activeSession = await sessionManager.createSession(userId);
    const staleSession = await sessionManager.createSession(userId);

    // Simulate Redis TTL expiration of staleSession key without index removal
    await redisMock.del(`session:${staleSession}`);

    // Stale index entry must NEVER grant access
    const staleValidation = await sessionManager.validateSession(staleSession);
    expect(staleValidation).toBeNull();

    // Querying sessions with cleanup removes the stale ID
    const activeSessions = await sessionManager.getUserSessionIds(userId, true);
    expect(activeSessions).toEqual([activeSession]);

    // Verify the stale ID was removed from Redis set
    const rawSet = await redisMock.smembers(`user_sessions:${userId}`);
    expect(rawSet).toEqual([activeSession]);
  });

  // Scenario 8: Redis errors during revocation are handled without falsely reporting success
  it("8. propagates Redis errors during revocation and does not falsely report success", async () => {
    const userId = "user-error-handling";
    await sessionManager.createSession(userId);

    // Force failure during eval
    redisMock.pipelineFailures.push(
      new Error("Redis cluster connection failure"),
    );

    await expect(sessionManager.destroyAllUserSessions(userId)).rejects.toThrow(
      /Redis.*failure/i,
    );
  });

  // Scenario 9: Concurrent creation and revocation do not leave valid sessions unintentionally accessible after revocation completes
  it("9. handles concurrent session creation and revocation safely without leaving revoked sessions accessible", async () => {
    const userId = "user-concurrency-test";

    // Create initial 5 sessions
    const sessions = await Promise.all([
      sessionManager.createSession(userId),
      sessionManager.createSession(userId),
      sessionManager.createSession(userId),
      sessionManager.createSession(userId),
      sessionManager.createSession(userId),
    ]);

    // Concurrently trigger revocation and extra session creation
    let newCreatedSession = "";
    const [, newSession] = await Promise.all([
      sessionManager.destroyAllUserSessions(userId),
      sessionManager.createSession(userId).then((id) => {
        newCreatedSession = id;
        return id;
      }),
    ]);

    // Any session present before revocation must be invalid
    for (const sid of sessions) {
      const valid = await sessionManager.validateSession(sid);
      expect(valid).toBeNull();
    }

    // The newly created session is either valid with its own new index, or was caught in revocation
    const newSessionValid = await sessionManager.validateSession(newSession);
    const activeSessions = await sessionManager.getUserSessionIds(userId);

    if (newSessionValid) {
      expect(activeSessions).toContain(newCreatedSession);
    } else {
      expect(activeSessions).not.toContain(newCreatedSession);
    }
  });
});
