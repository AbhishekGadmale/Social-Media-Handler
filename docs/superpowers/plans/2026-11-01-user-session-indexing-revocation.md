# User Session Indexing and Revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement secure user-to-session indexing (`user_sessions:${userId}`) and all-session revocation (`destroyAllUserSessions(userId)`) in the Redis-backed `SessionManager`, with comprehensive tests covering 9 security & lifecycle scenarios.

**Architecture:** Extend `@agency-os/session`'s `SessionManager` with a Redis Set index per user (`user_sessions:${userId}`) maintained atomically during session creation, validation (sliding TTL refresh), and destruction. Expose `destroyAllUserSessions(userId)` with strict pipeline error handling, and expose `revokeAllUserSessions(userId)` on `AuthService`.

**Tech Stack:** TypeScript, ioredis, Vitest, NestJS, Turbo monorepo.

**Spec:** Kyosys Agency OS Phase 7.1, PR 1 Requirements.

## Global Constraints

- Do NOT implement public signup or email verification endpoints.
- Do NOT implement organization/workspace schema migrations.
- Do NOT implement invitations or member management endpoints.
- Do NOT implement subscription, plan, or payment models.
- Do NOT implement legal policy pages.
- Do NOT deploy to staging or production.
- Do NOT merge the PR.
- Never log session IDs, cookies, authentication tokens or secrets.
- Use `user_sessions:${userId}` key pattern and atomic Redis pipelines.

---

### Task 1: Configure Test Harness in `@agency-os/session`

**Files:**

- Modify: `packages/session/package.json`
- Create: `packages/session/vitest.config.ts`
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**

- Produces: `pnpm --filter @agency-os/session test` executable command.

- [ ] **Step 1: Update `packages/session/package.json`**
      Add `"test": "vitest run"` script and devDependencies `"vitest": "^4.1.10"`, `"@types/node": "^20.0.0"`.

- [ ] **Step 2: Create `packages/session/vitest.config.ts`**
      Create Vitest config for `@agency-os/session` using node environment and setup file `../../test-setup.ts`.

- [ ] **Step 3: Run `pnpm install` and verify `pnpm --filter @agency-os/session test` runs**
      Run `pnpm install` to keep lockfile consistent for CI `--frozen-lockfile`. Verify runner works.

---

### Task 2: Implement TDD Tests for `SessionManager` Covering All 9 Scenarios

**Files:**

- Create: `packages/session/src/SessionManager.spec.ts`

**Interfaces:**

- Tests all 9 required scenarios:
  1. Sessions for 2 users indexed correctly.
  2. Destroying 1 session removes only that session from the user index.
  3. Destroying all user sessions invalidates every session for that user.
  4. Revoking User A sessions leaves User B sessions valid.
  5. Ordinary logout revokes only current session.
  6. Sliding TTL refresh keeps session and index expiry aligned.
  7. Expired/stale session IDs cleaned up safely.
  8. Redis errors during revocation bubble up (no false success).
  9. Concurrent creation/revocation safety.

- [ ] **Step 1: Write failing tests in `packages/session/src/SessionManager.spec.ts`**
      Implement the test suite mocking or simulating Redis behavior with complete fidelity to Redis semantics.

- [ ] **Step 2: Run tests to verify failures on missing features**
      Run: `pnpm --filter @agency-os/session test`
      Expected: FAIL due to missing `destroyAllUserSessions`, `getUserSessionIds`, and user indexing logic.

---

### Task 3: Implement User-to-Session Indexing & Revocation in `SessionManager`

**Files:**

- Modify: `packages/session/src/SessionManager.ts`

**Interfaces:**

- `createSession(userId: string): Promise<string>`
- `validateSession(sessionId: string): Promise<SessionData | null>`
- `destroySession(sessionId: string): Promise<void>`
- `destroyAllUserSessions(userId: string): Promise<void>`
- `getUserSessionIds(userId: string, cleanStale?: boolean): Promise<string[]>`

- [ ] **Step 1: Implement Redis pipeline indexing and sliding TTL in `SessionManager.ts`**
      Add `USER_SESSIONS_PREFIX = 'user_sessions:'`.
      Update `createSession` to pipeline session set, `sadd`, and `expire` on user index.
      Update `validateSession` to refresh session TTL and user index TTL.
      Update `destroySession` to delete session key and `srem` from user index.
      Implement `destroyAllUserSessions(userId)` to delete all user session keys and the user index key with pipeline error propagation.
      Implement `getUserSessionIds(userId, cleanStale)` with proactive stale session cleanup.

- [ ] **Step 2: Run tests to verify all 9 scenarios pass**
      Run: `pnpm --filter @agency-os/session test`
      Expected: PASS

---

### Task 4: Integrate with `AuthService` in `apps/api`

**Files:**

- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts`

**Interfaces:**

- Produces: `AuthService.revokeAllUserSessions(userId: string): Promise<void>`

- [ ] **Step 1: Add failing test for `revokeAllUserSessions` in `apps/api/src/modules/auth/auth.service.spec.ts`**
      Verify `authService.revokeAllUserSessions(userId)` calls `sessionManager.destroyAllUserSessions(userId)`.

- [ ] **Step 2: Implement `revokeAllUserSessions` in `apps/api/src/modules/auth/auth.service.ts`**
      Call `this.sessionManager.destroyAllUserSessions(userId)`.

- [ ] **Step 3: Run `auth.service.spec.ts` and `auth.controller.spec.ts`**
      Run: `pnpm --filter @agency-os/api test -- src/modules/auth/auth.service.spec.ts`
      Expected: PASS

---

### Task 5: Full Monorepo Quality & Build Verification

**Files:**

- Documentation: `IMPLEMENTATION_STATUS.md`

- [ ] **Step 1: Run full lint, typecheck, build, and unit test suites**
      Run:
- `pnpm turbo run lint`
- `pnpm turbo run typecheck`
- `pnpm turbo run build`
- `pnpm --filter @agency-os/session test`
- `pnpm --filter @agency-os/api test -- src/modules/auth/`
- `pnpm --filter @agency-os/web test`

- [ ] **Step 2: Update `IMPLEMENTATION_STATUS.md`**
      Record Phase 7.1 PR 1 changes, status, and verification evidence accurately.

- [ ] **Step 3: Commit and push feature branch `feat/user-session-indexing-revocation`**
      Push to remote and open GitHub PR targeting `main`.
      Request Muse review on exact PR HEAD. Do not merge.
