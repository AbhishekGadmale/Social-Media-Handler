# Agency Social OS - Master Context

This is the definitive handoff document for Claude Code, Antigravity, OpenCode, Gemini, and future developers.

## 1. Product Vision
A multi-tenant social media management platform allowing agencies to connect client social accounts, schedule and publish posts, and track analytics across platforms.

## 2. Current Architecture
Monorepo architecture (Turborepo + pnpm) separating frontend (Next.js), backend (NestJS API), background processing (NestJS Worker via BullMQ), and shared domain logic (Prisma Database, Providers).

## 3. Monorepo Map
- `apps/web`: Next.js frontend application.
- `apps/api`: NestJS REST API.
- `apps/worker`: NestJS background worker (BullMQ).
- `packages/database`: Prisma schema, migrations, and repository layer.
- `packages/providers`: Abstracted social media integrations.

## 4. Current Database Models
- **Core**: `User`, `Organization`, `Workspace`, `WorkspaceMember`
- **Accounts**: `SocialAccount`, `SocialConnection`
- **Publishing**: `Post`, `PostPlatformVariant`, `PublicationAttempt`
- **Media**: `MediaAsset`, `PostMedia`
- **Analytics/Audit**: `AccountMetricDaily`, `AuditLog`, `WebhookEvent`, `SyncRun`

## 5. Tenancy
Logical tenancy model. Users are assigned `WorkspaceMember` records within a `Workspace`. `WorkspaceGuard` enforces tenancy boundaries on all scoped routes.

## 6. Auth/session/CSRF
- **Auth**: Email/password authentication yielding HTTP-only session cookies.
- **Session**: Redis-backed via `SessionManager`.
- **CSRF**: Enforced on all mutations via `x-csrf-token` header matching a secure cookie.

## 7. RBAC
Roles (`OWNER`, `MANAGER`, `EDITOR`, `CLIENT_APPROVER`, `VIEWER`) map to granular permissions via a `PermissionMatrix`. `PermissionGuard` intercepts and validates these.

## 8. Provider Architecture
Contract-first design (`ISocialProvider`, `IPublishingProvider`). Capabilities are resolved per-provider to gracefully handle missing features across social networks.

## 9. Implemented LinkedIn Capabilities
OAuth, text publishing, single image publishing, video publishing, document publishing, and remote post deletion.

## 10. Publishing State Machine
Valid transitions managed for: `DRAFT, SCHEDULED, QUEUED, PUBLISHING, PARTIAL, PUBLISHED, FAILED, UNKNOWN, DELETING, DELETED`.

## 11. BullMQ/worker flow
Strictly typed queues execute optimistic locking (`dispatchVersion`), credentials injection, capability checks, and robust backoff handling for API limits/transient errors.

## 12. Current Frontend State
Framework scaffolded (Next.js App Router, React Query). Basic authentication and dashboard exist, but frontend lags significantly behind backend capabilities. Frontend being next is NOT an authoritative roadmap decision unless supported by repo evidence.

## 13. Test/Local Environment Setup
- `agency_os` (Dev database), `agency_os_test` (Isolated Test database).
- **Test Workflow**: `pnpm --filter @agency-os/database run test:migrate` followed by `pnpm turbo run test`.
- **Root `.env`**: Required to exist for tests due to `test-setup.ts` enforcement.
- **CI Baseline**: lint, typecheck, and tests are explicitly 100% PASS uncached.

## 14. Migration Rules
- **Rule 1**: Do NOT alter enums without verifying provider compatibility.
- **Rule 2**: Old history is squashed. Never manually edit applied migrations.

## 15. Current Clean Migration Baseline
The previous 13-migration corrupted history was squashed pre-production.
**Baseline**: `000000000000_squashed_init`.
Fresh `prisma migrate deploy` verified successfully.
(Historical recovery pointer: `backup/pre-migration-squash`).

## 16. Known Technical Debt
- API/Worker runtimes currently rely on `tsx` in containers, increasing image size and initialization speed.
- Frontend implementation is substantially behind backend feature parity.

## 17. Licensing Restrictions
Refer to local `LICENSE` file. Private proprietary software.

## 18. Agent Operating Rules
- Verify `package.json` before tool usage.
- Never assert CI/CD is green from cache; always force validate (`turbo run test --force`).
- Prioritize technical rigor over performative agreement.

## 19. Source-of-Truth Precedence
1. Application Code / `schema.prisma`
2. Git History
3. This Master Context
4. Old `docs/` (Treat as stale)

## 20. Exact Current Continuation Point
- **Status**: VERIFIED LOCAL / UNSHIPPED
- **Confirmed Implementation Point**: Phase 8.8 (LinkedIn Remote Post Deletion)
- **Latest Relevant Commit**: `a099491`

---
# SCOPE CATEGORIES

## CONFIRMED IMPLEMENTED
- Turborepo / Docker Compose Scaffold
- Tenancy, Auth, Session, CSRF, RBAC
- Provider Core Architecture
- LinkedIn OAuth & Full Publishing Lifecycle (including Documents and Deletion)
- BullMQ Worker Queues with backoff and optimistic locking
- Audit Logging and Security Rate Limiting (Redis)
- Clean Migration Baseline (`000000000000_squashed_init`)

## DOCUMENTED BUT NOT IMPLEMENTED
- Other Social Providers (Meta, Twitter, TikTok, YouTube).
- Advanced Frontend UI (Composer, Unified Analytics Dashboard).
- Complex Notification System / Unified Inbox.

## FUTURE / RESEARCH ONLY
- Open-Source research on usage metering and SaaS entitlement tracking.
- Advanced monetization strategies.

## OUT OF MVP SCOPE
- Monetization (Stripe/Plans/Subscriptions) explicitly listed out of scope in Phase-7 publishing design.
