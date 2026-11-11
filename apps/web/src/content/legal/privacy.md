# Agency OS — Privacy Policy (DRAFT)

**Status:** DRAFT prepared 2026-11-10, updated 2026-11-11 (email, address, grievance officer filled per owner) from the legal research brief (`~/workspace/research_notes/agency-os-legal-terms-privacy-india-20261110-1423/report.md`). **This is not legal advice and has not been reviewed by a lawyer.** Do not publish until the placeholders are filled and a lawyer has reviewed the flagged items.

**Data fiduciary:** Gadmale Technologies, a sole proprietorship, Maharashtra, India (Udyam-registered; GSTIN pending). Product: **Agency OS**. Contact: `agadmale335@gmail.com`. Address: `Shihu, Tal-Pen, Dist-Raigad, Maharashtra, 402106, India`.

**Placeholders filled 2026-11-11:** business email (agadmale335@gmail.com), address (Shihu, Tal-Pen, Dist-Raigad, Maharashtra, 402106, India), grievance officer (Abhishek Gadmale, agadmale335@gmail.com). **Still open:** `[HOSTING REGION/COUNTRY]`, `[COOKIE/ANALYTICS LIST — confirm what trackers the site actually uses]`, `[EFFECTIVE DATE]`.

**Key dates from the research:** the DPDP Act 2023 and DPDP Rules 2025 were notified 13 Nov 2025; the core fiduciary duties (notice, consent, rights, breach notification, retention) come into force **13 May 2027** (some sources say 14 May — confirm against the Gazette). Until then, the IT Act 2000 s.43A and the SPDI Rules 2011 remain the operative privacy regime. This policy is drafted to work under both.

---

## 1. Who we are and what this policy covers

1.1 Gadmale Technologies ("we", "us") operates Agency OS, a multi-tenant SaaS for social media management. This policy explains what personal data we collect, why, who we share it with, how long we keep it, and your rights.
1.2 **Our two roles.** For data we determine the purpose of — our account holders' and their staff's data, website visitors, billing contacts — we are a **Data Fiduciary** under the DPDP Act. For data belonging to your clients (for example a client's Page followers or commenters) and content you manage for them, we are likely a **Data Processor** acting on your instructions, and you are the fiduciary for that data. [LAWYER TO CONFIRM: role mapping for agency-client/follower data, and the data-processing agreement (DPA) to offer agency customers.]
1.3 This policy is not the DPDP consent notice. At sign-up we give you a separate, short, standalone notice (in plain language) listing the data we collect, the specific purpose, and how to withdraw consent and complain. This policy mirrors that notice and links to it. Consent is never bundled into the Terms, and we do not use pre-ticked boxes.

## 2. Data we collect

| Category | What | Purpose |
|---|---|---|
| Account data | Name, email, password (hashed — see §5), workspace and team details | Provide the service, identify you, let your team collaborate |
| Billing data | Legal name, billing address, GSTIN (if any), Razorpay payment references, last 4 digits and issuer of a saved card | Charge you, issue GST invoices, give input-tax-credit details |
| Social-account data | Account/profile IDs, Page/channel metadata, posts, comments and analytics received via the Meta, LinkedIn and YouTube APIs, only for accounts you connect | Publish/schedule at your direction and show you analytics |
| OAuth tokens | Access and refresh tokens for connected accounts | Authorise publishing and analytics on your behalf |
| Usage and logs | Pages used, features used, IP address, device/browser information, error and audit logs | Security, troubleshooting, abuse prevention, service improvement |
| Support data | Messages you send us, and any files you attach | Answer you and resolve issues |
| Cookies/trackers | See §10 | Session/security, and analytics only with your consent |

2.1 We collect data directly from you, from the social platforms you connect, and from our processors (Razorpay for payment status, Resend for email delivery).
2.2 We do **not** knowingly collect data from children. The service is for adults/business users (18+) only. If an agency connects an account featuring a child, tell us and we will advise on removal. [LAWYER TO CONFIRM: position where agencies manage child-focused or minor accounts — DPDP requires verifiable parental consent for under-18s, and prohibits tracking/behavioural monitoring/targeted advertising directed at children.]
2.3 We do not collect your card number, CVV or expiry date. See §6.

## 3. How we use your data (lawful basis)

3.1 We process your data on the basis of **your consent** (given by clear affirmative action at sign-up, after the standalone notice) and, where applicable, to perform our contract with you and to comply with legal obligations (for example tax invoicing). We do not rely on "legitimate use" for marketing without consent.
3.2 We use your data only for the purposes listed in §2, and for the specific purposes stated in the sign-up notice. We do not sell your personal data, use it to build or augment profiles, or combine it with other data except as stated here.
3.3 **Withdrawing consent** is as easy as giving it: use the account settings or email `agadmale335@gmail.com`. On withdrawal we (and our processors) will stop processing within a reasonable time, subject to data we must keep by law (invoices, logs — see §7).

## 4. Who we share your data with

4.1 **Processors we use (and where the data goes):**

| Processor | What for | Where |
|---|---|---|
| Hosting provider (VPS + object storage) | Runs the app and stores your data | `[HOSTING REGION/COUNTRY — to confirm]` |
| Razorpay (Razorpay Payments Pvt Ltd) | Payment processing and subscriptions | India (payment data is stored only in India, per RBI directions) |
| Resend | Transactional email (verification, password reset, invoices, dunning) | United States |
| Meta / LinkedIn / YouTube APIs | Publishing and analytics, only for accounts you connect and only the data you authorise | United States |

4.2 We engage processors only under contracts requiring them to protect your data. We remain responsible for your data even when a processor fails.
4.3 **Cross-border transfers.** India has no blanket data-localisation rule and, as of late 2026, no country has been notified as restricted for transfers under the DPDP Act. We will update this list if the Government restricts a destination. We do not promise "your data never leaves India" — hosting, email and the social APIs are outside India, as listed above. We do not export payment data abroad.
4.4 We share data with anyone else only: (a) with your consent or direction (for example publishing a post to a platform you connected); (b) to comply with a court order or law; or (c) to protect our legal rights. We do not sell personal data to anyone.

## 5. How we protect your data

5.1 We use reasonable security safeguards appropriate to the data: OAuth tokens are encrypted at rest with **AES-256-GCM**, decrypted only in server memory during authorised operations, never written to logs and never shared; access is controlled by role (RBAC); we keep logs, monitoring and backups so processing can continue after a compromise.
5.2 No system is perfectly secure. If you believe your account or a connected token has been compromised, tell us immediately at `agadmale335@gmail.com` and disconnect the affected account.
5.3 **Breach notification.** If we become aware of a personal data breach, we will notify each affected person without delay (by email or in-app: what happened, likely consequences, mitigation, self-protection steps, and a contact) and notify the Data Protection Board of India without delay, with a detailed report within 72 hours. Separately, cyber incidents reportable to CERT-In follow a 6-hour track. [LAWYER TO CONFIRM: what counts as "becoming aware" for a token leak at a platform, and who notifies whom when the breach is at a sub-processor.]

## 6. Payments — what we do and do not store

6.1 Payments are processed by **Razorpay** on its PCI-DSS-compliant checkout. Card details are entered on Razorpay's pages, never on ours.
6.2 **We do not store your card numbers, CVV or expiry dates.** Where you save a card, it is tokenised by the card network under the RBI's card-on-file rules. We receive only a token/reference, the last 4 digits and the issuer name.
6.3 Refunds go back to the original payment method only, typically within 5–7 business days of approval, with a GST credit note where GST was charged. See the Refund & Cancellation Policy.

## 7. How long we keep your data

| Data | Retention |
|---|---|
| Account and workspace data (posts, schedules, analytics, connected accounts) | While your account is active; **30 days read-only/export grace period after cancellation**, then permanently deleted |
| OAuth tokens | Deleted immediately on disconnect, and purged within 7 days; also deleted when the platform revokes them |
| Logs (processing, traffic, audit) | At least **1 year** from processing, then erased (DPDP Rules 6/8) |
| Invoices and accounting records | As tax law requires (typically 6–8 years — [CA TO CONFIRM]; do not invent a number here) |
| YouTube Authorized Data | Kept only as necessary for the consented purpose and **no longer than 30 calendar days — delete or refresh**; authorisation rechecked at least every 30 days for analytics kept longer |
| Meta Platform Data | Deleted promptly on request, and as soon as reasonably possible when no longer necessary, when the product stops operating, or when Meta requests deletion |

7.1 Erasure: we erase personal data once its purpose is served or consent is withdrawn, unless another law requires us to keep it (see the table). Deleting your Agency OS account or disconnecting an integration does **not** delete content already published to a social platform — you must delete that on the platform itself.

## 8. Your rights

8.1 Under the DPDP Act you have the right to:
- **Access** — a summary of the personal data we process about you, what we do with it, and who we shared it with;
- **Correction, completion and updating** of your data;
- **Erasure** of your data (subject to §7 legal-retention exceptions);
- **Grievance redressal** — complain to us first (see §8.2), then to the Data Protection Board of India if unresolved;
- **Nomination** — nominate a person to exercise your rights if you die or become incapacitated.
8.2 **How to exercise a right:** email `agadmale335@gmail.com` (or use the in-app request form, when built) and tell us your username/customer ID so we can identify your account. We acknowledge grievances within **48 hours** and respond within **one month** (the SPDI/E-Commerce timeline); the DPDP ceiling is 90 days, and we promise the shorter period. There is no data-portability, objection or automated-decision right under DPDP (unlike GDPR) — we will not invent one in this policy.
8.3 **Data protection contact:** Abhishek Gadmale, proprietor, `agadmale335@gmail.com`. A full-time Data Protection Officer based in India is required only for Significant Data Fiduciaries; we are not currently notified as one, and will update this policy if that changes.

## 9. Third-party platforms — what you should know

9.1 **Meta (Facebook/Instagram).** We use Platform Data only for the purposes you consented to. We do not sell it or use it to build profiles. If you remove our app or request deletion, Meta sends us a signed deletion request; we verify it, delete your Platform Data, and return a confirmation code and status URL. Our data-deletion instructions are at [TO CONFIRM: URL — this page must exist on a public, non-geoblocked URL and be entered in the Meta App Dashboard].
9.2 **LinkedIn.** Member data from LinkedIn's APIs **cannot be exported out of the application — including to you, our customer** — and other members' profile data may be cached for **24 hours only**. Our LinkedIn features are designed within those limits; we do not promise indefinite LinkedIn analytics retention. [LAWYER + PLATFORM REVIEW REQUIRED — product-scope question, see Terms §9.3.]
9.3 **YouTube.** By using Agency OS to publish to YouTube, you agree to be bound by the YouTube Terms of Service (https://www.youtube.com/t/terms). You can revoke our access at any time at https://security.google.com/settings/security/permissions; Google's Privacy Policy (https://policies.google.com/privacy) also applies. You can ask us to delete stored YouTube data at any time — we delete it as soon as possible and **within 7 calendar days**. If you revoke via Google's settings, we delete the related data within 30 calendar days. Deleting data in Agency OS does not delete anything held by YouTube/Google.
9.4 Each platform's own terms and privacy policy apply to your account on that platform. A platform may suspend our app or revoke tokens; if it does, the affected features stop until access is restored.

## 10. Cookies and trackers

10.1 There is no standalone cookie law in India, and the DPDP Act does not mention cookies — but a cookie that identifies you is personal data under DPDP, so from 13 May 2027 non-essential cookies need the same standalone notice and clear affirmative consent as other personal data: no pre-ticked boxes, granular choice by category, as easy to withdraw as to give, and a persistent "Cookie settings" control. Accept and Reject must have equal weight — a bright "Accept" with a hidden "Reject" is a dark pattern.
10.2 **Our cookies/trackers:** `[TO CONFIRM — list each by name, provider, purpose, duration, first- vs third-party. If we use no third-party analytics at all, say so expressly — that is a strong, verifiable statement. Resend, Razorpay checkout, and the platforms' own pixels/SDKs must be listed if present.]`
10.3 Strictly necessary cookies (login/session, security, load-balancing) do not need consent. Analytics and marketing tags are blocked until you consent. You can withdraw consent at any time via the cookie-settings control or your browser settings.
10.4 If an EU/UK visitor signs up or is targeted, GDPR/ePrivacy rules apply separately — this policy's Indian cookie banner does not satisfy GDPR. [LAWYER IF WE LATER TARGET OUTSIDE INDIA.]

## 11. Changes to this policy

11.1 We may update this policy from time to time. Material changes will be notified by email or in-app before they take effect, and the "last updated" date above will change. If a transfer destination changes because the Government restricts it, that is a policy update, not a breach of a promise — we word destinations as "we currently host/process in [X]" for that reason.

## 12. Contact

12.1 **Data fiduciary:** Gadmale Technologies, `Shihu, Tal-Pen, Dist-Raigad, Maharashtra, 402106, India`. Email: `agadmale335@gmail.com`.
12.2 **Grievance / data-protection contact:** `Abhishek Gadmale, proprietor`, `agadmale335@gmail.com`. Acknowledgement within 48 hours; response within one month (DPDP ceiling: 90 days).
12.3 Complaints to the regulator: Data Protection Board of India — route and details to be added when the Board publishes its complaint process. [TO CONFIRM at publication.]

---
*Draft only. Sources: research brief 2026-11-10 (§§1–8). Not legal advice; lawyer review required before publication. Placeholders in [BRACKETS] must be filled, not published as-is. Do not hard-code IT Rules 2021 takedown deadlines from secondary sources — verify the current Rule 3 text on meity.gov.in before publishing (the brief flags conflicting secondaries).*
