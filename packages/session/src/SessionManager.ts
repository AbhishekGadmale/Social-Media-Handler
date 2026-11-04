import Redis from "ioredis";
import { generateId } from "@agency-os/database";

export interface SessionData {
  userId: string;
  createdAt: string;
  expiresAt: string;
  securityEpoch?: number;
}

/**
 * Lua Scripts for Atomic Redis Operations
 *
 * NOTE on Redis Topology:
 * These Lua scripts provide strict atomicity on standalone Redis and Redis with Sentinel.
 * In a multi-node Redis Cluster without hash tags, cross-key scripts can encounter CROSSSLOT
 * errors if keys map to different hash slots. For Redis Cluster compatibility, sessions
 * must either be routed to a dedicated session instance or keys must share a hash tag.
 * The verified infrastructure for Agency OS is standalone Redis 7.
 *
 * NOTE on Authentication Races vs Session Storage:
 * These scripts guarantee atomicity of the session storage lifecycle (create, validate,
 * destroy, revoke-all). They do NOT eliminate the separate application-level race where
 * an in-flight login authenticates using a password validated right before a password-change
 * security event. To reject such in-flight authentications, a tokenVersion/securityEpoch
 * check on the User database model is required in future auth flows.
 */

const CREATE_SESSION_SCRIPT = `
local sessionKey = KEYS[1]
local userSessionsKey = KEYS[2]
local sessionDataJson = ARGV[1]
local ttlSeconds = tonumber(ARGV[2])
local sessionId = ARGV[3]

-- 1. Store session data with TTL
redis.call('SET', sessionKey, sessionDataJson, 'EX', ttlSeconds)

-- 2. Add sessionId to user sessions set
redis.call('SADD', userSessionsKey, sessionId)

-- 3. Ensure user sessions set TTL is refreshed to at least match session TTL
local currentTtl = redis.call('TTL', userSessionsKey)
if currentTtl < ttlSeconds then
  redis.call('EXPIRE', userSessionsKey, ttlSeconds)
end

return 'OK'
`;

const VALIDATE_SESSION_SCRIPT = `
local sessionKey = KEYS[1]
local userSessionsPrefix = ARGV[1]
local ttlSeconds = tonumber(ARGV[2])
local newExpiresAtIso = ARGV[3]
local sessionId = ARGV[4]

-- 1. Check if session key exists. If revoked or expired, return nil immediately.
local rawData = redis.call('GET', sessionKey)
if not rawData then
  return nil
end

-- 2. Decode session data safely with pcall to prevent unhandled script exceptions on corrupt JSON
local ok, data = pcall(cjson.decode, rawData)
if not ok or type(data) ~= 'table' then
  return nil
end

data['expiresAt'] = newExpiresAtIso
local updatedJson = cjson.encode(data)

-- 3. Refresh session key with updated data and full TTL
redis.call('SET', sessionKey, updatedJson, 'EX', ttlSeconds)

-- 4. Refresh user sessions set TTL and self-heal missing index entry
if data['userId'] and sessionId and sessionId ~= '' then
  local userSessionsKey = userSessionsPrefix .. data['userId']
  redis.call('SADD', userSessionsKey, sessionId)
  local currentTtl = redis.call('TTL', userSessionsKey)
  if currentTtl < ttlSeconds then
    redis.call('EXPIRE', userSessionsKey, ttlSeconds)
  end
end

return updatedJson
`;

const DESTROY_SESSION_SCRIPT = `
local sessionKey = KEYS[1]
local userSessionsPrefix = ARGV[1]
local sessionId = ARGV[2]

local rawData = redis.call('GET', sessionKey)
if rawData then
  local ok, data = pcall(cjson.decode, rawData)
  if ok and type(data) == 'table' and data['userId'] then
    local userSessionsKey = userSessionsPrefix .. data['userId']
    redis.call('SREM', userSessionsKey, sessionId)
  end
end

redis.call('DEL', sessionKey)
return 'OK'
`;

const DESTROY_ALL_USER_SESSIONS_SCRIPT = `
local userSessionsKey = KEYS[1]
local sessionPrefix = ARGV[1]

local sessionIds = redis.call('SMEMBERS', userSessionsKey)
for _, sid in ipairs(sessionIds) do
  redis.call('DEL', sessionPrefix .. sid)
end
redis.call('DEL', userSessionsKey)
return sessionIds
`;

const DESTROY_OTHER_USER_SESSIONS_SCRIPT = `
local userSessionsKey = KEYS[1]
local sessionPrefix = ARGV[1]
local keepSessionId = ARGV[2]
local ttlSeconds = tonumber(ARGV[3])
local newSecurityEpoch = tonumber(ARGV[4])

local sessionIds = redis.call('SMEMBERS', userSessionsKey)
local destroyedCount = 0

for _, sid in ipairs(sessionIds) do
  if sid ~= keepSessionId then
    redis.call('DEL', sessionPrefix .. sid)
    redis.call('SREM', userSessionsKey, sid)
    destroyedCount = destroyedCount + 1
  end
end

-- Ensure keepSessionId remains indexed with refreshed TTL
if keepSessionId and keepSessionId ~= '' then
  redis.call('SADD', userSessionsKey, keepSessionId)
  local currentTtl = redis.call('TTL', userSessionsKey)
  if currentTtl < ttlSeconds then
    redis.call('EXPIRE', userSessionsKey, ttlSeconds)
  end

  -- Update securityEpoch if newSecurityEpoch is provided
  if newSecurityEpoch then
    local keepKey = sessionPrefix .. keepSessionId
    local rawData = redis.call('GET', keepKey)
    if rawData then
      local ok, data = pcall(cjson.decode, rawData)
      if ok and type(data) == 'table' then
        data['securityEpoch'] = newSecurityEpoch
        local currentSessionTtl = redis.call('TTL', keepKey)
        if currentSessionTtl > 0 then
          redis.call('SET', keepKey, cjson.encode(data), 'EX', currentSessionTtl)
        else
          redis.call('SET', keepKey, cjson.encode(data), 'EX', ttlSeconds)
        end
      end
    end
  end
end

return destroyedCount
`;

const GET_AND_CLEAN_SESSIONS_SCRIPT = `
local userSessionsKey = KEYS[1]
local sessionPrefix = ARGV[1]

local sessionIds = redis.call('SMEMBERS', userSessionsKey)
local activeSessionIds = {}
for _, sid in ipairs(sessionIds) do
  local exists = redis.call('EXISTS', sessionPrefix .. sid)
  if exists == 1 then
    table.insert(activeSessionIds, sid)
  else
    redis.call('SREM', userSessionsKey, sid)
  end
end
return activeSessionIds
`;

export class SessionManager {
  private readonly SESSION_PREFIX = "session:";
  private readonly USER_SESSIONS_PREFIX = "user_sessions:";
  private readonly SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

  constructor(private readonly redis: Redis) {}

  /**
   * Atomically creates a new session in Redis and registers it in the user's session index.
   * Linearization point: atomic execution of CREATE_SESSION_SCRIPT in Redis.
   * @param userId The ID of the authenticated user.
   * @returns The newly generated session ID.
   */
  async createSession(userId: string, securityEpoch?: number): Promise<string> {
    const sessionId = generateId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.SESSION_TTL_SECONDS * 1000);

    const data: SessionData = {
      userId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ...(typeof securityEpoch === 'number' ? { securityEpoch } : {}),
    };

    const sessionKey = `${this.SESSION_PREFIX}${sessionId}`;
    const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;

    try {
      await this.redis.eval(
        CREATE_SESSION_SCRIPT,
        2,
        sessionKey,
        userSessionsKey,
        JSON.stringify(data),
        this.SESSION_TTL_SECONDS.toString(),
        sessionId,
      );
      return sessionId;
    } catch (err: any) {
      throw new Error(`Failed to create session in Redis: ${err.message}`);
    }
  }

  /**
   * Atomically validates an existing session and refreshes its sliding TTL window.
   * If the session was revoked or expired, returns null and DOES NOT resurrect the session.
   * Linearization point: atomic execution of VALIDATE_SESSION_SCRIPT in Redis.
   * @param sessionId The session ID.
   * @returns The SessionData if valid, or null if invalid/expired.
   */
  async validateSession(sessionId: string): Promise<SessionData | null> {
    const sessionKey = `${this.SESSION_PREFIX}${sessionId}`;
    const now = new Date();
    const newExpiresAt = new Date(
      now.getTime() + this.SESSION_TTL_SECONDS * 1000,
    ).toISOString();

    try {
      const rawResult = (await this.redis.eval(
        VALIDATE_SESSION_SCRIPT,
        1,
        sessionKey,
        this.USER_SESSIONS_PREFIX,
        this.SESSION_TTL_SECONDS.toString(),
        newExpiresAt,
        sessionId,
      )) as string | null;

      if (!rawResult) {
        return null;
      }

      return JSON.parse(rawResult) as SessionData;
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        return null;
      }
      throw new Error(`Failed to validate session in Redis: ${err.message}`);
    }
  }

  /**
   * Atomically destroys a single session (ordinary logout) and removes it from the user index.
   * Linearization point: atomic execution of DESTROY_SESSION_SCRIPT in Redis.
   * @param sessionId The session ID.
   */
  async destroySession(sessionId: string): Promise<void> {
    const sessionKey = `${this.SESSION_PREFIX}${sessionId}`;

    try {
      await this.redis.eval(
        DESTROY_SESSION_SCRIPT,
        1,
        sessionKey,
        this.USER_SESSIONS_PREFIX,
        sessionId,
      );
    } catch (err: any) {
      throw new Error(`Failed to destroy session in Redis: ${err.message}`);
    }
  }

  /**
   * Atomically destroys all active sessions for a user EXCEPT the specified keepSessionId
   * (e.g. on password change where the current device session is preserved).
   * Linearization point: atomic execution of DESTROY_OTHER_USER_SESSIONS_SCRIPT in Redis.
   * @param userId The user ID whose other sessions should be invalidated.
   * @param keepSessionId The current session ID that must remain active.
   * @returns The number of other sessions destroyed.
   */
  async destroyOtherUserSessions(
    userId: string,
    keepSessionId: string,
    newSecurityEpoch?: number,
  ): Promise<number> {
    const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;

    try {
      const result = await this.redis.eval(
        DESTROY_OTHER_USER_SESSIONS_SCRIPT,
        1,
        userSessionsKey,
        this.SESSION_PREFIX,
        keepSessionId,
        this.SESSION_TTL_SECONDS.toString(),
        newSecurityEpoch !== undefined ? newSecurityEpoch.toString() : "",
      );
      return Number(result) || 0;
    } catch (err: any) {
      throw new Error(
        `Failed to revoke other user sessions in Redis: ${err.message}`,
      );
    }
  }

  /**
   * Atomically destroys all active sessions for a user (security revocation / password change)
   * and deletes the user's session index.
   * Linearization point: atomic execution of DESTROY_ALL_USER_SESSIONS_SCRIPT in Redis.
   * @param userId The user ID whose sessions should be invalidated.
   */
  async destroyAllUserSessions(userId: string): Promise<void> {
    const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;

    try {
      await this.redis.eval(
        DESTROY_ALL_USER_SESSIONS_SCRIPT,
        1,
        userSessionsKey,
        this.SESSION_PREFIX,
      );
    } catch (err: any) {
      throw new Error(
        `Failed to revoke all user sessions in Redis: ${err.message}`,
      );
    }
  }

  /**
   * Retrieves active session IDs for a user, atomically cleaning up stale IDs whose
   * underlying session keys have expired in Redis.
   * Linearization point: atomic execution of GET_AND_CLEAN_SESSIONS_SCRIPT in Redis.
   * @param userId The user ID.
   * @param cleanStale Whether to remove expired/stale session IDs from the index.
   */
  async getUserSessionIds(
    userId: string,
    cleanStale = true,
  ): Promise<string[]> {
    const userSessionsKey = `${this.USER_SESSIONS_PREFIX}${userId}`;

    try {
      if (!cleanStale) {
        return (await this.redis.smembers(userSessionsKey)) ?? [];
      }

      const activeIds = (await this.redis.eval(
        GET_AND_CLEAN_SESSIONS_SCRIPT,
        1,
        userSessionsKey,
        this.SESSION_PREFIX,
      )) as string[] | null;

      return activeIds ?? [];
    } catch (err: any) {
      throw new Error(
        `Failed to retrieve user session IDs from Redis: ${err.message}`,
      );
    }
  }
}
