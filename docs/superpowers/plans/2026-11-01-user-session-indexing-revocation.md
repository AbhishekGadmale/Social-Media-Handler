# User Session Indexing and Revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement secure user-to-session indexing (`user_sessions:${userId}`) and all-session revocation (`destroyAllUserSessions(userId)`) in the Redis-backed `SessionManager`, with full atomicity guarantees via Redis Lua scripts and real-Redis concurrency tests.

**Architecture:** Extend `@agency-os/session`'s `SessionManager` with atomic Redis Lua scripts for session creation, validation/sliding TTL refresh, single session destruction, all-session revocation, and stale index cleanup. Expose `revokeAllUserSessions(userId)` on `AuthService`.

**Tech Stack:** TypeScript, ioredis, Redis 7 (standalone / Sentinel), Vitest, NestJS, Turbo monorepo.

**Spec:** Kyosys Agency OS Phase 7.1, PR 1 Requirements & Muse Security Review Remediation.

## Global Constraints

- Do NOT implement public signup or email verification endpoints.
- Do NOT implement organization/workspace schema migrations.
- Do NOT implement invitations or member management endpoints.
- Do NOT implement subscription, plan, or payment models.
- Do NOT implement legal policy pages.
- Do NOT deploy to staging or production.
- Do NOT merge the PR.
- Never log session IDs, cookies, authentication tokens or secrets.
- Use `user_sessions:${userId}` key pattern and atomic Redis Lua scripts. Redis pipelines are NOT atomic and must NOT be relied upon for concurrency-sensitive session lifecycle state.
- Supported Redis topology: Standalone Redis 7 (or Sentinel-backed Redis). Redis Cluster multi-key scripting is not supported unless keys share hash slots or sessions are routed to a dedicated instance.
- Application-level authentication race limitation: Redis Lua scripts ensure atomicity of session storage operations. They do not prevent in-flight authentication where credentials were validated immediately before a password change; addressing that separate lifecycle race requires a database-level `tokenVersion` or `securityEpoch` on the User model in future auth phases.

---

### Task 1: Configure Test Harness in `@agency-os/session`

**Files:**

- Modify: `packages/session/package.json`
- Create: `packages/session/vitest.config.ts`
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**

- Produces: `pnpm --filter @agency-os/session test` executable command.

- [x] **Step 1: Update `packages/session/package.json`**
      Add `"test": "vitest run"` script and devDependencies `"vitest": "^4.1.10"`, `"@types/node": "^20.0.0"`.

- [x] **Step 2: Create `packages/session/vitest.config.ts`**
      Create Vitest config for `@agency-os/session` using node environment and setup file `../../test-setup.ts`.

- [x] **Step 3: Run `pnpm install` and verify test runner works**
      Run `pnpm install` to keep lockfile consistent for CI `--frozen-lockfile`.

---

### Task 2: Implement Atomic Lua Scripts in `SessionManager`

**Files:**

- Modify: `packages/session/src/SessionManager.ts`

**Interfaces:**

- `createSession(userId: string): Promise<string>`: Atomic `SET` + `SADD` + `EXPIRE` via Lua.
- `validateSession(sessionId: string): Promise<SessionData | null>`: Atomic `GET` + decode + update `expiresAt` + `SET` + index `EXPIRE` via Lua. Never resurrects deleted sessions.
- `destroySession(sessionId: string): Promise<void>`: Atomic `GET` + `SREM` + `DEL` via Lua.
- `destroyAllUserSessions(userId: string): Promise<void>`: Atomic `SMEMBERS` + delete all sessions + delete index set via Lua.
- `getUserSessionIds(userId: string, cleanStale?: boolean): Promise<string[]>`: Atomic `EXISTS` check + `SREM` stale IDs via Lua.

- [x] **Step 1: Implement 5 atomic Lua scripts in `SessionManager.ts`**
      Eliminate non-atomic pipelines. Every operation is linearizable at Redis server level.

---

### Task 3: Author Unit & Real-Redis Concurrency Integration Tests

**Files:**

- Modify: `packages/session/src/SessionManager.spec.ts`
- Create: `packages/session/src/SessionManager.redis.integration.spec.ts`

**Interfaces:**

- Unit tests: Faithful mock simulation with unambiguous deterministic assertions.
- Real Redis integration tests: Executes against live Redis 7 (`localhost:6379`), testing concurrent validation vs revoke-all (F1), concurrent create vs revoke-all (F2), destroy vs validation (F3), and stale cleanup vs creation (F6).

- [x] **Step 1: Update unit tests in `SessionManager.spec.ts`**
- [x] **Step 2: Implement real Redis integration tests in `SessionManager.redis.integration.spec.ts`**

---

### Task 4: Integrate with `AuthService` in `apps/api`

**Files:**

- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts`

**Interfaces:**

- `AuthService.revokeAllUserSessions(userId: string): Promise<void>`

- [x] **Step 1: Add unit tests in `apps/api/src/modules/auth/auth.service.spec.ts`**
- [x] **Step 2: Implement `revokeAllUserSessions` in `apps/api/src/modules/auth/auth.service.ts`**

---

### Task 5: Full Monorepo Quality & Build Verification

**Files:**

- Documentation: `IMPLEMENTATION_STATUS.md`

- [x] **Step 1: Run full lint, typecheck, build, and test suites**
- [x] **Step 2: Update `IMPLEMENTATION_STATUS.md` with accurate remediation records**
- [ ] **Step 3: Commit and push feature branch `feat/user-session-indexing-revocation` to PR #47**
- [ ] **Step 4: Request Muse review on exact PR HEAD**
