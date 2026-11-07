# Auth Production Readiness Audit: Signup/Signin vs. a Real SaaS (1,000 Paying Users)

**Date**: November 7, 2026  
**Repository**: `AbhishekGadmale/Social-Media-Handler`  
**Base Commit**: `85deaf0dbfdce358b1498ba4fc96141b20a63c5e` (`main`)  
**Branch**: `docs/auth-production-readiness`  
**Audit Scope**: Full authentication surface (`apps/api/src/modules/auth/`, `apps/web/src/app/(auth)/`, `packages/session/`, `packages/database/prisma/schema.prisma`, rate limiting, billing integration, operational security).

---

## 1. Executive Summary: The Three Critical Findings

This audit evaluated the current authentication system in Agency OS against the standard operational and security requirements of a B2B SaaS platform serving 1,000 paying agency customers ($499–$3,999/mo). While the foundation features solid architectural components (Argon2id password hashing, atomic tenant provisioning, sliding Redis sessions, and single-use email verification tokens), three critical flaws would immediately cause catastrophic support overload, user drop-off, and security vulnerabilities upon onboarding paying customers:

### Finding 1: Zero Password Reset / Account Recovery Mechanism (Severity: P0)
- **The Reality**: There is **no password reset or account recovery flow anywhere in the codebase**. A comprehensive search across the repository for `resetPassword`, `forgotPassword`, `reset-password`, and `forgot-password` yields zero endpoints, zero database models, zero service methods, zero email dispatchers, and zero UI links on the login screen (`apps/web/src/app/login/page.tsx:137-142`).
- **Consequence for 1,000 Paying Users**: A customer paying ₹3,999/month who forgets their password is permanently locked out of their account, their client social media accounts, and their active billing workspace. The only recovery mechanism currently possible is manual database intervention by an engineering operator executing raw SQL to overwrite `hashedPassword` in PostgreSQL.

### Finding 2: Returning Unverified User Redirect Trap & Frontend Error Silencing (Severity: P0)
- **The Reality**: Two cascading defects break the onboarding and error-reporting loops:
  1. **The Redirect Trap**: When an unverified user logs in at `/login`, `apps/web/src/app/login/page.tsx:40-42` checks `if (authData.memberships.length > 0)` and redirects the user directly to `/${workspaceId}/analytics`. However, `apps/api/src/modules/auth/guards/workspace.guard.ts:23-27` blocks unverified users from all workspace routes with HTTP 403 (`"Email verification required to access workspaces"`). The analytics page (`apps/web/src/app/[workspaceId]/analytics/page.tsx:174-178`) catches the 403 and displays a generic dead-end: *"Access Denied: You don't have permission to view analytics in this workspace."* The user is never directed to `/dashboard` where the amber resend-verification banner exists (`apps/web/src/app/dashboard/page.tsx:69-112`), leaving them trapped without an explanation or a resend button.
  2. **The Error Silencing Bug**: The API's global exception filter (`apps/api/src/filters/all-exceptions.filter.ts:85-91`) returns errors in the format `{ error: { code, message, requestId } }`. However, all frontend auth pages (`apps/web/src/app/login/page.tsx:66`, `apps/web/src/app/signup/page.tsx:90-97`, `apps/web/src/app/dashboard/page.tsx:54`) attempt to read `err.data.message`. Because `err.data.message` is `undefined`, every real error—such as DTO validation rejections, password complexity failures, or HTTPS protocol rejections—is silenced and replaced with generic placeholder text (*"An error occurred during signup."* or *"An error occurred during login."*).

### Finding 3: Rate Limiting Flaws: Vulnerable to Proxy Rotation and Prone to Office-Wide Collateral Lockouts (Severity: P0)
- **The Reality**: Authentication rate limiting (`RateLimitPolicies.auth = { limit: 5, ttl: 900000 }`, `apps/api/src/modules/core/rate-limit.policies.ts:5`) is implemented strictly per client IP in Redis (`apps/api/src/modules/core/redis-throttler.storage.ts:24`). There is **no per-account failed login counter, lockout timestamp, or status field** in the `User` database model (`packages/database/prisma/schema.prisma:83-95`).
- **Consequence for 1,000 Paying Users**:
  1. **Vulnerability to Credential Stuffing**: An attacker using rotating proxy IPs or residential botnets can target any user account with brute-force attacks indefinitely, because no account-level lockout exists.
  2. **Collateral Lockout of Entire Agencies**: Multiple users working from the same office or VPN egress IP share an IP address. If one employee fails to log in 5 times, **every employee in that entire agency** is locked out from logging in, signing up, or verifying email for 15 minutes.
  3. **No Registration Bot Defense**: There is no CAPTCHA (Cloudflare Turnstile) or honeypot on `/signup`, allowing automated bot traffic to exhaust transactional email quotas and pollute the database with orphaned tenant workspaces.

---

## 2. Current State: Journey-by-Journey Trace with Code Evidence

### Journey 1: New User Signup → Verification → First Workspace Access

1. **Visitor Navigates to Registration**:
   - Visitor navigates to `/signup` (`apps/web/src/app/signup/page.tsx:7`).
   - `AuthGuard` (`apps/web/src/components/auth-guard.tsx:9, 13`) checks `PUBLIC_ROUTES.includes('/signup')` and allows the page to render without redirection.
2. **Form Submission & Validation**:
   - User inputs email, password, confirm password, optional organization name, and optional workspace name.
   - Client-side validation (`apps/web/src/app/signup/page.tsx:24-39`) validates regex format, password length (8–128), and matching password confirmation.
   - Form submits payload to `POST /api/v1/auth/signup` (`apps/web/src/app/signup/page.tsx:71`).
3. **Backend Registration & Atomic Provisioning**:
   - `AuthController.signup` (`apps/api/src/modules/auth/auth.controller.ts:46-62`) verifies HTTPS if `NODE_ENV === 'production'` unless `ALLOW_INSECURE_HTTP_AUTH === 'true'` (lines 50–58).
   - `AuthService.signup` (`apps/api/src/modules/auth/auth.service.ts:67-157`):
     - Normalizes email to lowercase.
     - Performs anti-enumeration check (`auth.service.ts:74-85`): if user exists, runs dummy Argon2 work (`line 76`) and returns generic `{ message: 'Registration request received.' }` without sending any email or resetting passwords.
     - Hashes password using Argon2id (`auth.service.ts:88` via `@node-rs/argon2`).
     - Generates 32-byte cryptographic random token (`rawToken`) and SHA-256 hash (`tokenHash`) with 24-hour expiration (`auth.service.ts:91-93`).
     - Executes `UserRepository.createWithTenantTransaction` (`packages/database/src/repositories/UserRepository.ts:77-138`), which atomically provisions `User`, `Organization`, `Workspace` (with 14-day `trialEndsAt`, `UserRepository.ts:104-113`), `WorkspaceMember` with `role: OWNER` (`UserRepository.ts:115-122`), and `EmailVerificationToken` (`UserRepository.ts:124-134`).
     - Best-effort dispatch of verification email via `EmailDeliveryService.sendVerificationEmail` (`auth.service.ts:111-119`).
4. **Email Dispatch**:
   - `ResendEmailDeliveryService` (`apps/api/src/modules/auth/email-delivery.service.ts:79-133`) formats link: `${frontendUrl}/verify-email?token=${encodeURIComponent(rawToken)}` (line 103) and posts to Resend API (`line 105`).
   - Note: In non-production, `MockEmailDeliveryService` records the token in memory (`email-delivery.service.ts:32`), while `NoopEmailDeliveryService` logs a warning (`line 63`). In production, missing `RESEND_API_KEY` throws a fail-fast error on startup (`apps/api/src/config/email-delivery.ts:19-24`).
5. **UI Transition**:
   - Web signup switches state to `isSubmitted = true` (`apps/web/src/app/signup/page.tsx:74, 150-227`), displaying the "Check your email" screen with honest copy: *"Your workspace is created with a 14-day trial. Verify your email to enter it."*
6. **Token Verification**:
   - User clicks email link and visits `/verify-email?token=<rawToken>`.
   - `AuthGuard` allows access as `/verify-email` is in `PUBLIC_ROUTES` (`apps/web/src/components/auth-guard.tsx:9`).
   - `VerifyEmailContent` (`apps/web/src/app/verify-email/page.tsx:10-48`) validates token presence, enforces CAS execution via `hasRequestedRef` (preventing double-invocation under React 18 StrictMode, lines 26, 33–37), and calls `POST /api/v1/auth/verify-email`.
   - Backend `EmailVerificationTokenRepository.consumeToken` (`packages/database/src/repositories/EmailVerificationTokenRepository.ts:82-137`):
     - Calculates SHA-256 hash of token.
     - Atomically updates `consumedAt: now` and sets `user.emailVerified = true`, `user.emailVerifiedAt = now` in a single transaction (lines 102–123).
   - Frontend displays success checkmark and "Sign in" CTA (`apps/web/src/app/verify-email/page.tsx:107-142`).
7. **Sign In & Workspace Landing**:
   - User clicks "Sign in" to land on `/login` (`apps/web/src/app/login/page.tsx`).
   - Enters credentials; `POST /api/v1/auth/login` validates password and creates session in Redis (`apps/api/src/modules/auth/auth.service.ts:279-331`).
   - Cookies set: `session` (HttpOnly, SameSite=Lax, 7d TTL) and `csrfToken` (SameSite=Lax, 7d TTL) (`apps/api/src/modules/auth/auth.controller.ts:182-195`).
   - `LoginPage` fetches `authQueries.me()` (`apps/web/src/app/login/page.tsx:33`), observes `memberships.length > 0`, and navigates to `/${authData.memberships[0].workspaceId}/analytics` (`line 41`).
   - `WorkspaceGuard` (`apps/api/src/modules/auth/guards/workspace.guard.ts:23-27`) validates `user.emailVerified === true` and allows full workspace access.

---

### Journey 2: Returning User Login (Edge Cases & Failure Paths)

#### Path A: Wrong Password
- User submits incorrect password at `/login`.
- `AuthService.login` (`apps/api/src/modules/auth/auth.service.ts:290-293`) verifies password with `argon2.verify`, fails, and throws `InvalidCredentialsException('INVALID_PASSWORD', user.id)`.
- `AuthController` catches exception, logs `AUTH_LOGIN_FAILED` audit entry (`apps/api/src/modules/auth/auth.controller.ts:159-166`), and rethrows.
- `AllExceptionsFilter` (`apps/api/src/filters/all-exceptions.filter.ts:85-91`) sends HTTP 401 `{ error: { code: 'UnauthorizedException', message: 'Invalid credentials', requestId } }`.
- Frontend (`apps/web/src/app/login/page.tsx:47-48`) catches status 401 and renders: *"Invalid email or password."*

#### Path B: Login with Unverified Email (The Broken Path)
- User signs up, fails to click verification link, and attempts to log in on `/login`.
- `AuthService.login` does **not** check `user.emailVerified`. Login **succeeds** (HTTP 200).
- Session cookies are set; `queryClient.fetchQuery(authQueries.me())` returns `user.emailVerified: false` and `memberships: [ { workspaceId: '...', role: 'OWNER' } ]`.
- `LoginPage` (`apps/web/src/app/login/page.tsx:40-42`) executes:
  ```ts
  if (authData.memberships.length > 0) {
    router.push(`/${authData.memberships[0].workspaceId}/analytics`);
  }
  ```
- Browser lands on `/[workspaceId]/analytics`. The page issues `analyticsQueries.overview(workspaceId)` (`apps/web/src/app/[workspaceId]/analytics/page.tsx:87`).
- `WorkspaceGuard` (`apps/api/src/modules/auth/guards/workspace.guard.ts:23-27`) executes:
  ```ts
  if (!user.emailVerified) {
    throw new ForbiddenException('Email verification required to access workspaces');
  }
  ```
- Analytics page catches HTTP 403 (`apps/web/src/app/[workspaceId]/analytics/page.tsx:174-178`) and renders:
  ```tsx
  <h3 className="text-xl font-semibold text-red-900">Access Denied</h3>
  <p className="mt-2 text-red-700">You don't have permission to view analytics in this workspace.</p>
  ```
- **Observed User Experience**: The user is completely stranded. They are not informed that their email is unverified, there is no resend verification button, and they cannot reach `/dashboard` unless they guess the URL path.

#### Path C: Login After Trial Expiry
- User logs in after their 14-day trial period (`trialEndsAt + graceDays`) has elapsed.
- Login succeeds (HTTP 200). Session created.
- User redirected to `/${workspaceId}/analytics`.
- `analytics.controller.ts` uses `AuthGuard, WorkspaceGuard, PermissionGuard`, but does **not** include `WorkspaceWritableGuard` (`apps/api/src/modules/analytics/analytics.controller.ts:21, 30`).
- User successfully views analytics overview in read-only mode.
- If user navigates to publishing (`POST /v1/workspaces/:workspaceId/posts`), `WorkspaceWritableGuard` (`apps/api/src/modules/billing/guards/workspace-writable.guard.ts:17`) calls `EntitlementsService.assertWorkspaceWritable` (`apps/api/src/modules/billing/entitlements.service.ts:173-178`), which throws HTTP 403: *"Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue."*

#### Path D: Login While Past Due / Subscription Halted
- Razorpay subscription webhook transitions subscription to `HALTED` or `PAST_DUE` (`apps/api/src/modules/billing/entitlements.service.ts:64-91`).
- User logs in normally; sessions and reads remain intact. Write mutations (publishing, scheduling) throw HTTP 403 via `WorkspaceWritableGuard`.
- Note: Media uploads (`apps/api/src/modules/media/media.controller.ts:18-44`) and OAuth account connections (`apps/api/src/modules/oauth/oauth.controller.ts:46-49`) **lack** `WorkspaceWritableGuard`, allowing users with halted or expired subscriptions to continue uploading media files and connecting accounts.

---

### Journey 3: Locked-Out User (Forgot Password)

- User navigates to `/login`.
- **Search Result**: No "Forgot password?" or "Reset password" link exists anywhere on `/login` (`apps/web/src/app/login/page.tsx:137-142`).
- **Backend Search Result**: A codebase-wide search across `apps/api/src/` for `forgot-password`, `reset-password`, `requestPasswordReset`, or `resetPassword` returns **zero occurrences**.
- **Database Search Result**: `packages/database/prisma/schema.prisma` contains no password reset token model, expiration timestamp, or reset hash.
- **Outcome**: The user has no self-serve mechanism to recover their account. They cannot access their account, invite team members, or cancel an active Razorpay subscription without contacting support for manual database modification.

---

### Journey 4: Attacker Scenarios

#### Scenario A: Brute-Force Password Guessing & Credential Stuffing
- **Mechanism**: Attacker targets a specific user (`victim@agency.com`) using automated HTTP POST requests to `/api/v1/auth/login`.
- **Defense**: `@Throttle({ default: RateLimitPolicies.auth })` limits requests to 5 per 15 minutes per IP (`apps/api/src/modules/core/rate-limit.policies.ts:5`).
- **Vulnerability**:
  - The rate limit key is `throttler:default:<IP_ADDRESS>` (`apps/api/src/modules/core/redis-throttler.storage.ts:24`).
  - There is **no account-based lockout**. The `User` model (`packages/database/prisma/schema.prisma:83-95`) has no `failedAttempts`, `lockedUntil`, or `isLocked` columns.
  - An attacker rotating IP addresses via proxy networks can attempt thousands of passwords against `victim@agency.com` without ever triggering an account lockout or alerting the victim.
  - No breach detection checks (e.g. HaveIBeenPwned API) exist on password entry.

#### Scenario B: Denial of Service via Shared IP Collateral Lockout
- **Mechanism**: Attacker targets any account from a shared corporate IP, VPN, or public Wi-Fi network and sends 5 failed login attempts.
- **Outcome**: `RedisThrottlerStorage` records 5 hits for that IP. The entire IP is blocked for 15 minutes.
- **Consequence**: Legitimate users sharing that IP cannot log in, register, or request email verification, receiving HTTP 429 *"Too many login attempts"*.

#### Scenario C: Signup Spam & Resource Exhaustion
- **Mechanism**: Attacker posts fake emails to `/api/v1/auth/signup`.
- **Defense**: IP rate limited to 5 signups per 15 minutes.
- **Vulnerability**:
  - No CAPTCHA (Turnstile/reCAPTCHA) and no honeypot fields exist in `apps/web/src/app/signup/page.tsx`.
  - An attacker rotating IPs can flood the registration endpoint, consuming Resend API credits (`apps/api/src/modules/auth/email-delivery.service.ts:105`) and creating orphaned `User`, `Organization`, and `Workspace` rows in PostgreSQL.

#### Scenario D: Token Replay Attack
- **Mechanism**: Attacker obtains an email verification link and attempts to replay `POST /api/v1/auth/verify-email`.
- **Defense**: `EmailVerificationTokenRepository.consumeToken` (`packages/database/src/repositories/EmailVerificationTokenRepository.ts:102-115`) uses a conditional atomic update:
  ```ts
  where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
  data: { consumedAt: now }
  ```
  If `updateResult.count !== 1`, it immediately returns `null`, and `AuthService.verifyEmail` (`apps/api/src/modules/auth/auth.service.ts:176-186`) throws HTTP 400 *"Invalid or expired verification token"*. Token replay is completely prevented.

#### Scenario E: Session Theft & Fixation
- **Mechanism**: Attacker steals a session cookie via local network interception, proxy logs, or physical device access.
- **Defense**:
  - `session` cookie is marked `httpOnly: true`, `sameSite: 'lax'`, and `secure: Boolean(req.secure)` (`apps/api/src/modules/auth/auth.controller.ts:182-187`), protecting against client-side script theft via XSS.
  - CSRF protection (`AuthGuard`, `apps/api/src/modules/auth/guards/auth.guard.ts:63-71`) enforces `x-csrf-token` header match for state-changing requests.
- **Vulnerabilities**:
  - Sessions have no IP or User-Agent binding in Redis (`packages/session/src/SessionManager.ts:4-9, 295-298`). A stolen session cookie can be used from any device or location worldwide.
  - Sessions use a 7-day **sliding window** (`SessionManager.ts:187, 235-265`). Every API call extends the expiration by another 7 days. An active session can remain valid indefinitely unless the user explicitly logs out or revokes sessions.
  - **No Session Rotation on Password Change**: When a user changes their password (`AuthService.changePassword`, `apps/api/src/modules/auth/auth.service.ts:414-418`), other sessions are revoked, but the **current session ID is retained** without being rotated to a new cryptographic identifier.

---

## 3. Production Readiness Gap Table (SaaS Bar for 1,000 Paying Users)

**Severity Definitions**:
- **P0**: Critical launch blocker. Security vulnerability, severe data loss risk, or immediate customer churn/support failure.
- **P1**: Essential for 1,000 paying users. Required for standard business operations, enterprise compliance, and account safety.
- **P2**: Post-launch enhancement. Quality-of-life, advanced enterprise features, or secondary optimizations.

| Category | Requirement / Capability | Status | Severity | Consequence / Risk | Code Evidence (File:Line) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Passkeys & Recovery** | Self-serve password reset / forgot password flow | **MISSING** | **P0** | Paying users who forget passwords are permanently locked out; requires manual database manipulation by engineers. | Not found in repo (`apps/api/src/`, `apps/web/src/`, `packages/`) |
| **UX & Lifecycle** | Post-login routing for unverified accounts | **BROKEN** | **P0** | Unverified users who log in are redirected to a broken 403 "Access Denied" analytics page instead of dashboard verification banner. | `apps/web/src/app/login/page.tsx:40-42`, `apps/api/src/modules/auth/guards/workspace.guard.ts:23-27` |
| **UX & Contract** | API error mapping to frontend UI | **BROKEN** | **P0** | API error details (`code`, `message`) are nested under `err.data.error.message`, but web reads `err.data.message`, silencing all backend validation/auth errors. | `apps/api/src/filters/all-exceptions.filter.ts:85-91`, `apps/web/src/app/signup/page.tsx:90-97`, `apps/web/src/app/login/page.tsx:66` |
| **Security & Rate Limit** | Account-level lockout on consecutive failed logins | **MISSING** | **P0** | Distributed credential stuffing bypasses IP throttling; brute force attacks against individual accounts can run indefinitely. | `packages/database/prisma/schema.prisma:83-95` (no `failedAttempts` or `lockedUntil`), `apps/api/src/modules/core/redis-throttler.storage.ts:24` |
| **Signup & Compliance** | Terms of Service and Privacy Policy consent checkbox | **MISSING** | **P0** | Legal liability under GDPR/DPDP; no record of customer agreement to terms or billing commitments. | `apps/web/src/app/signup/page.tsx:241-373` (no terms checkbox or links) |
| **Signup & Anti-Abuse** | Bot & spam resistance (Turnstile / CAPTCHA) | **MISSING** | **P1** | Automated bots can spam registration, exhaust transactional email credits, and bloat database with orphaned tenants. | `apps/web/src/app/signup/page.tsx:241-373` (no CAPTCHA or honeypot) |
| **Signup & Anti-Enum** | Duplicate email recovery notification | **PARTIAL** | **P1** | Duplicate signups receive generic "Check your email" UI, but no email is dispatched to the existing account holder, causing user confusion. | `apps/api/src/modules/auth/auth.service.ts:74-85` |
| **Password Security** | Password strength & complexity enforcement | **PARTIAL** | **P1** | Allows trivial passwords like `12345678` or `password123`; only checks min length 8. | `apps/api/src/modules/auth/dto/signup.dto.ts:17-19`, `change-password.dto.ts:10-12` |
| **Password Security** | Breached-password verification (HaveIBeenPwned) | **MISSING** | **P1** | Users can register with known compromised passwords from public data dumps. | Not found in `apps/api/src/modules/auth/` |
| **Password Security** | Notification email on password change | **MISSING** | **P1** | If an account is hijacked and password changed, victim receives zero notification and cannot intervene. | `apps/api/src/modules/auth/auth.service.ts:373-450` (no email dispatched on change) |
| **Sessions** | Session rotation on password change | **PARTIAL** | **P1** | Current session preserves its old cryptographic ID upon password change; violates session fixation hygiene. | `apps/api/src/modules/auth/auth.service.ts:414-418` |
| **Sessions** | Active device list & per-device revocation | **MISSING** | **P1** | Users cannot see logged-in devices/locations or terminate a specific suspicious session; only "Revoke all" exists. | `packages/session/src/SessionManager.ts:4-9`, `apps/api/src/modules/auth/auth.controller.ts:288-312` |
| **Sessions** | Session binding (IP / User-Agent fingerprinting) | **MISSING** | **P1** | Stolen cookies can be utilized anywhere globally without triggering anomaly detection. | `packages/session/src/SessionManager.ts:4-9` (no IP/UA stored) |
| **MFA / 2FA** | Two-Factor Authentication (TOTP / Authenticator App) | **MISSING** | **P1** | Standard expectation for B2B agencies handling corporate social media credentials; no 2FA support exists. | Not found in repo (`schema.prisma`, `apps/api/src/modules/auth/`) |
| **Account Lifecycle** | Self-serve email address change | **MISSING** | **P1** | Agency operators changing corporate domains or handing over accounts must file support tickets. | Not found in repo |
| **Account Lifecycle** | Self-serve account deletion & data erasure (GDPR) | **MISSING** | **P1** | No automated mechanism to fulfill GDPR "Right to be Forgotten" or clean tenant resources. | Not found in repo |
| **Billing Gates** | Comprehensive mutation gating across all modules | **PARTIAL** | **P1** | `WorkspaceWritableGuard` protects posts and publishing, but media uploads and OAuth connections remain ungated for expired/halted tenants. | `apps/api/src/modules/media/media.controller.ts:18`, `apps/api/src/modules/oauth/oauth.controller.ts:46` |
| **Audit Logging** | IP address and User-Agent capture in AuditLog | **PARTIAL** | **P1** | `AuditLog` captures actor and action, but lacks client IP and User-Agent for forensic investigations. | `packages/database/prisma/schema.prisma:344-360`, `AuditLogRepository.ts:47-55` |
| **Social Login** | Sign in with Google / OAuth SSO | **MISSING** | **P2** | Increases signup conversion; OAuth module currently only supports connecting publishing accounts. | `apps/api/src/modules/oauth/oauth.controller.ts:46-55` |
| **UX & Accessibility** | Show/hide password visibility toggle | **MISSING** | **P2** | Reduces user friction and typing errors on mobile devices. | `apps/web/src/app/login/page.tsx:107-117`, `signup/page.tsx:263-303` |

---

## 4. Recommended Implementation Order (Phased Plan)

### Phase A: Hardening Before the First Paying Customer (Sprint 1)
*Focus: Eliminate security holes, fix broken routing, enable account recovery, and fix error reporting.*

1. **Self-Serve Password Reset Flow (Size: M)**
   - **Prerequisites**: Proven Resend email delivery path (`apps/api/src/modules/auth/email-delivery.service.ts:79`).
   - **Implementation**:
     - Prisma migration: Add `PasswordResetToken` model (`id`, `userId`, `tokenHash` @unique, `expiresAt` [1 hour], `consumedAt`).
     - Backend: Endpoints `POST /api/v1/auth/forgot-password` (anti-enumeration parity) and `POST /api/v1/auth/reset-password`.
     - Transactional email: Send secure password reset link via Resend.
     - Frontend: Create `/forgot-password` and `/reset-password` pages; add "Forgot password?" link to `/login`.
2. **Fix Returning Unverified User Routing Trap (Size: S)**
   - **Prerequisites**: None.
   - **Implementation**:
     - In `apps/web/src/app/login/page.tsx:40-44`, check `if (!authData.user.emailVerified)` before checking memberships, and redirect directly to `/dashboard`.
     - On all workspace pages (`/[workspaceId]/*`), if `WorkspaceGuard` returns 403 with `emailVerified === false`, show a clear verification alert banner with a 1-click resend button rather than generic "Access Denied".
3. **Fix Global API Error Parsing in Frontend (Size: S)**
   - **Prerequisites**: None.
   - **Implementation**:
     - Update `apps/web/src/lib/api/client.ts:83-96` to extract `message` from `errorData.error.message || errorData.message || response.statusText`.
     - Update error handlers in `login/page.tsx`, `signup/page.tsx`, `verify-email/page.tsx`, and `dashboard/page.tsx` to read the unified message format.
4. **Terms of Service & Privacy Consent on Signup (Size: S)**
   - **Prerequisites**: Published Terms of Service and Privacy Policy URLs.
   - **Implementation**:
     - Add mandatory checkbox to `apps/web/src/app/signup/page.tsx`: *"I agree to the Terms of Service and Privacy Policy"*.
     - Update `SignupDto` with `@IsBoolean()` validation.
5. **Close Mutation Gaps for Halted/Expired Tenants (Size: S)**
   - **Prerequisites**: None.
   - **Implementation**:
     - Add `@UseGuards(WorkspaceWritableGuard)` to `apps/api/src/modules/media/media.controller.ts:24, 35` and `apps/api/src/modules/oauth/oauth.controller.ts:46`.

---

### Phase B: Essential Features for 1,000 Paying Users (Sprint 2–3)
*Focus: Bot mitigation, account security, session management, and multi-user agency stability.*

1. **Account-Level Lockout & Credential Stuffing Defense (Size: M)**
   - **Implementation**:
     - Add `failedAttempts Int @default(0)` and `lockedUntil DateTime?` to `User` in Prisma.
     - On 5 consecutive incorrect passwords for a specific email, lock the account for 15 minutes and log security audit event.
     - Send security notification email to account holder: *"Multiple failed login attempts detected on your account"*.
2. **Cloudflare Turnstile Bot Resistance on Signup (Size: S)**
   - **Implementation**:
     - Add Cloudflare Turnstile invisible widget to `apps/web/src/app/signup/page.tsx`.
     - Validate turnstile token on backend `AuthController.signup`.
3. **Password Security Policy & Breach Checking (Size: M)**
   - **Implementation**:
     - Add complexity requirements (minimum 1 uppercase, 1 lowercase, 1 number, 1 special character).
     - Integrate HaveIBeenPwned k-Anonymity API check during password creation and change.
     - Rotate session ID upon successful password change.
4. **Duplicate Email Signup Notification (Size: S)**
   - **Implementation**:
     - In `AuthService.signup`, when duplicate email is detected, asynchronously dispatch an email: *"Someone attempted to create an Agency OS account with this email address. If this was you, please sign in or reset your password."*
5. **Per-Device Active Session Management (Size: M)**
   - **Implementation**:
     - Store metadata (IP address, operating system, browser name, login timestamp) in Redis session hashes.
     - Provide `GET /api/v1/auth/sessions` and `DELETE /api/v1/auth/sessions/:sessionId` endpoints.
     - Add "Active Sessions" card to workspace account settings.
6. **Capture IP & User-Agent in Audit Logs (Size: S)**
   - **Implementation**:
     - Add `ipAddress String?` and `userAgent String?` columns to `AuditLog` table.
     - Pass `req.ip` and `req.headers['user-agent']` into `AuditService.logAction`.

---

### Phase C: Scale & Enterprise Hardening (Post-1,000 Users)
*Focus: Enterprise compliance, frictionless onboarding, and self-serve governance.*

1. **Two-Factor Authentication (TOTP / 2FA) (Size: L)**
   - Authenticator app support (QR code provisioning, TOTP secret encrypted in DB, recovery backup codes).
   - Enforceable at the Workspace level by Organization Owners.
2. **Social Login ("Sign in with Google") (Size: L)**
   - Google OAuth 2.0 integration specifically for user sign-in/registration (distinct from social media publishing connection).
   - Automatic email verification for Google-verified profiles.
3. **Self-Serve Account Lifecycle (Size: M)**
   - Self-serve email change with dual verification (token sent to old email + token sent to new email).
   - Self-serve GDPR account deletion and workspace data export.

---

## 5. Things We Should NOT Build at This Stage

1. **SMS-Based Two-Factor Authentication**:
   - *Reason*: High per-SMS carrier costs, international delivery unreliability, regulatory hurdles (10DLC/A2P registration in the US), and susceptibility to SIM-swapping attacks. Standard TOTP (Google Authenticator / 1Password) is more secure, zero-cost, and universally accepted by B2B agency users.
2. **Enterprise SAML / Okta / Azure AD SSO**:
   - *Reason*: Pre-mature optimization. At the 1,000 paying customer mark, 95%+ of Agency OS clients are SMB marketing agencies, freelance social media managers, and boutique studios using Google Workspace or standard email/passwords. Enterprise SAML should be deferred until introducing an Enterprise tier ($10,000+/year).
3. **Magic Link / Passwordless-Only Login**:
   - *Reason*: Magic links introduce external dependencies on email delivery speed for every single login. Email latency (e.g. 30–60 second greylisting) creates massive user friction during high-frequency daily logins.
4. **Complex Custom RBAC Builders**:
   - *Reason*: The current `PermissionMatrix` and standard roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) are sufficient for 1,000 agencies. Allowing custom permission-rule builders creates exponential test surface area without tangible revenue impact.

---

## 6. Open Decisions for the Owner

1. **Social Login Priority**: Should we support "Sign in with Google" before public launch, or is email/password with 14-day trial sufficient for the initial launch cohort?
2. **2FA Enforcement Policy**: When 2FA is implemented, should it be optional for all users, or should Workspace Owners be able to make 2FA mandatory for all members in their agency?
3. **Account Lockout Threshold**: Is 5 consecutive failed attempts with a 15-minute temporary lockout acceptable, or would you prefer 10 attempts to minimize false-positive lockouts for legitimate users?
4. **Terms of Service & Privacy URLs**: Where are the legal terms and privacy policies hosted, and what are their production URLs to link from the signup agreement checkbox?
5. **Transactional Email Domain**: Is a custom branded domain (e.g., `notifications.agencyos.dev` or `mail.agencyos.dev`) verified in Resend to replace the temporary `onboarding@resend.dev` sender address before taking paying customers?
