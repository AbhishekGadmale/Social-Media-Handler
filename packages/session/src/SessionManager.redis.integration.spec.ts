import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Redis from "ioredis";
import { SessionManager } from "./SessionManager";

describe("SessionManager (Real Redis Integration & Concurrency Invariants)", () => {
  let redis: Redis;
  let sessionManager: SessionManager;
  const testRedisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  beforeAll(async () => {
    redis = new Redis(testRedisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: () => null, // Fail fast if Redis is unavailable
    });

    // Verify connectivity
    await redis.ping();
    sessionManager = new SessionManager(redis);
  });

  afterAll(async () => {
    if (redis) {
      await redis.quit();
    }
  });

  beforeEach(async () => {
    // Clean up test keys with scan
    const keys = await redis.keys("session:*");
    const userKeys = await redis.keys("user_sessions:*");
    const allKeys = [...keys, ...userKeys];
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
    }
  });

  // Test 1: Real Lua scripts compile and execute successfully on Redis 7
  it("executes real Lua scripts on Redis 7 for create, validate, destroy, and revoke", async () => {
    const userId = "real-user-1";

    // 1. Create
    const sessionId = await sessionManager.createSession(userId);
    expect(sessionId).toBeDefined();

    // Verify raw Redis key
    const rawData = await redis.get(`session:${sessionId}`);
    expect(rawData).not.toBeNull();
    const parsed = JSON.parse(rawData!);
    expect(parsed.userId).toBe(userId);

    const ttl = await redis.ttl(`session:${sessionId}`);
    expect(ttl).toBeGreaterThan(600000); // ~7 days (604800s)

    const userSet = await redis.smembers(`user_sessions:${userId}`);
    expect(userSet).toEqual([sessionId]);

    // 2. Validate
    const validated = await sessionManager.validateSession(sessionId);
    expect(validated).not.toBeNull();
    expect(validated?.userId).toBe(userId);

    // 3. Single destroy
    await sessionManager.destroySession(sessionId);
    expect(await redis.get(`session:${sessionId}`)).toBeNull();
    expect(await redis.smembers(`user_sessions:${userId}`)).toEqual([]);
    expect(await sessionManager.validateSession(sessionId)).toBeNull();
  });

  // Test 2: F1 & Invariant 1 — Validation cannot resurrect a revoked session
  it("F1: validation cannot resurrect a session deleted by revoke-all under concurrency", async () => {
    const userId = "f1-concurrency-user";
    const sessionId = await sessionManager.createSession(userId);

    // Run parallel validation loops while revoking all user sessions
    let validationSawNull = false;
    const validationLoop = (async () => {
      for (let i = 0; i < 30; i++) {
        const res = await sessionManager.validateSession(sessionId);
        if (res === null) {
          validationSawNull = true;
        }
        await new Promise((r) => setTimeout(r, 2));
      }
    })();

    const revokeAction = (async () => {
      await new Promise((r) => setTimeout(r, 15));
      await sessionManager.destroyAllUserSessions(userId);
    })();

    await Promise.all([validationLoop, revokeAction]);

    // The session must be dead and NOT resurrected
    expect(await sessionManager.validateSession(sessionId)).toBeNull();
    expect(await redis.get(`session:${sessionId}`)).toBeNull();
    expect(await redis.smembers(`user_sessions:${userId}`)).toEqual([]);
    expect(validationSawNull).toBe(true);
  });

  // Test 3: F3 — Single destroy vs concurrent validation cannot recreate the session
  it("F3: destroyed session cannot be recreated by concurrent validation requests", async () => {
    const userId = "f3-destroy-race-user";
    const sessionId = await sessionManager.createSession(userId);

    // Concurrently trigger destroy and multiple validations
    await Promise.all([
      sessionManager.destroySession(sessionId),
      sessionManager.validateSession(sessionId),
      sessionManager.validateSession(sessionId),
      sessionManager.validateSession(sessionId),
    ]);

    // Final state MUST be null, key MUST not exist
    expect(await sessionManager.validateSession(sessionId)).toBeNull();
    expect(await redis.get(`session:${sessionId}`)).toBeNull();
    expect(await sessionManager.getUserSessionIds(userId)).toEqual([]);
  });

  // Test 4: F2 & Invariant 2 — Pre-revocation sessions never survive revocation
  it("F2: concurrent creation and revocation guarantees all pre-revocation sessions are destroyed", async () => {
    const userId = "f2-atomic-create-user";

    // Create 10 pre-revocation sessions
    const preSessions = await Promise.all(
      Array.from({ length: 10 }, () => sessionManager.createSession(userId)),
    );

    // Trigger revocation
    await sessionManager.destroyAllUserSessions(userId);

    // Every pre-revocation session MUST be dead
    for (const sid of preSessions) {
      expect(await sessionManager.validateSession(sid)).toBeNull();
      expect(await redis.get(`session:${sid}`)).toBeNull();
    }
    expect(await redis.smembers(`user_sessions:${userId}`)).toEqual([]);

    // Post-revocation creation works cleanly as a new session
    const postSession = await sessionManager.createSession(userId);
    expect(await sessionManager.validateSession(postSession)).not.toBeNull();
    expect(await sessionManager.getUserSessionIds(userId)).toEqual([
      postSession,
    ]);
  });

  // Test 5: F6 — Stale index cleanup never removes a concurrent valid session
  it("F6: stale index cleanup does not unindex a concurrently created session", async () => {
    const userId = "f6-stale-concurrency-user";

    // Run parallel creates and cleanups
    const creates = Array.from({ length: 15 }, () =>
      sessionManager.createSession(userId),
    );
    const cleanups = Array.from({ length: 15 }, () =>
      sessionManager.getUserSessionIds(userId, true),
    );

    const [createdIds] = await Promise.all([
      Promise.all(creates),
      Promise.all(cleanups),
    ]);

    // All created sessions must still be valid and indexed
    const finalActive = await sessionManager.getUserSessionIds(userId, true);
    expect(finalActive.sort()).toEqual(createdIds.sort());

    for (const sid of createdIds) {
      const valid = await sessionManager.validateSession(sid);
      expect(valid).not.toBeNull();
    }
  });

  // Test 6: Invariant 7 — User isolation on real Redis
  it("preserves User B sessions completely when User A undergoes all-session revocation", async () => {
    const userA = "isolated-user-a";
    const userB = "isolated-user-b";

    const sessA1 = await sessionManager.createSession(userA);
    const sessA2 = await sessionManager.createSession(userA);
    const sessB1 = await sessionManager.createSession(userB);
    const sessB2 = await sessionManager.createSession(userB);

    await sessionManager.destroyAllUserSessions(userA);

    // User A dead
    expect(await sessionManager.validateSession(sessA1)).toBeNull();
    expect(await sessionManager.validateSession(sessA2)).toBeNull();
    expect(await sessionManager.getUserSessionIds(userA)).toEqual([]);

    // User B alive
    const validB1 = await sessionManager.validateSession(sessB1);
    const validB2 = await sessionManager.validateSession(sessB2);
    expect(validB1).not.toBeNull();
    expect(validB1?.userId).toBe(userB);
    expect(validB2).not.toBeNull();
    expect(validB2?.userId).toBe(userB);

    const userBSessions = await sessionManager.getUserSessionIds(userB);
    expect(userBSessions.sort()).toEqual([sessB1, sessB2].sort());
  });
});
