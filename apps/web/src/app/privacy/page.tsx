export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow space-y-6 text-gray-800 leading-relaxed">
        <div className="border-b border-gray-200 pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Agency OS — Privacy Policy (DRAFT)
          </h1>
          <div className="mt-4 p-4 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-900 space-y-2">
            <p>
              <strong>Status:</strong> DRAFT prepared 2026-11-10, updated 2026-11-11 (email, address, grievance officer filled per owner) from the legal research brief (<code>~/workspace/research_notes/agency-os-legal-terms-privacy-india-20261110-1423/report.md</code>). <strong>This is not legal advice and has not been reviewed by a lawyer.</strong> Do not publish until the placeholders are filled and a lawyer has reviewed the flagged items.
            </p>
            <p>
              <strong>Data fiduciary:</strong> Gadmale Technologies, a sole proprietorship, Maharashtra, India (Udyam-registered; GSTIN pending). Product: <strong>Agency OS</strong>. Contact: <code>agadmale335@gmail.com</code>. Address: <code>Shihu, Tal-Pen, Dist-Raigad, Maharashtra, 402106, India</code>.
            </p>
            <p>
              <strong>Placeholders filled 2026-11-11:</strong> business email (agadmale335@gmail.com), address (Shihu, Tal-Pen, Dist-Raigad, Maharashtra, 402106, India), grievance officer (Abhishek Gadmale, agadmale335@gmail.com). <strong>Still open:</strong> <code>[HOSTING REGION/COUNTRY]</code>, <code>[COOKIE/ANALYTICS LIST — confirm what trackers the site actually uses]</code>, <code>[EFFECTIVE DATE]</code>.
            </p>
            <p>
              <strong>Key dates from the research:</strong> the DPDP Act 2023 and DPDP Rules 2025 were notified 13 Nov 2025; the core fiduciary duties (notice, consent, rights, breach notification, retention) come into force <strong>13 May 2027</strong> (some sources say 14 May — confirm against the Gazette). Until then, the IT Act 2000 s.43A and the SPDI Rules 2011 remain the operative privacy regime. This policy is drafted to work under both.
            </p>
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">1. Who we are and what this policy covers</h2>
          <p>
            1.1 Gadmale Technologies (&quot;we&quot;, &quot;us&quot;) operates Agency OS, a multi-tenant SaaS for social media management. This policy explains what personal data we collect, why, who we share it with, how long we keep it, and your rights.
          </p>
          <p>
            1.2 <strong>Our two roles.</strong> For data we determine the purpose of — our account holders&apos; and their staff&apos;s data, website visitors, billing contacts — we are a <strong>Data Fiduciary</strong> under the DPDP Act. For data belonging to your clients (for example a client&apos;s Page followers or commenters) and content you manage for them, we are likely a <strong>Data Processor</strong> acting on your instructions, and you are the fiduciary for that data. [LAWYER TO CONFIRM: role mapping for agency-client/follower data, and the data-processing agreement (DPA) to offer agency customers.]
          </p>
          <p>
            1.3 This policy is not the DPDP consent notice. At sign-up we give you a separate, short, standalone notice (in plain language) listing the data we collect, the specific purpose, and how to withdraw consent and complain. This policy mirrors that notice and links to it. Consent is never bundled into the Terms, and we do not use pre-ticked boxes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">2. Data we collect</h2>
          <div className="overflow-x-auto my-4">
            <table className="min-w-full divide-y divide-gray-200 border text-sm text-left">
              <thead className="bg-gray-50 font-semibold text-gray-900">
                <tr>
                  <th className="px-4 py-2 border">Category</th>
                  <th className="px-4 py-2 border">What</th>
                  <th className="px-4 py-2 border">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="px-4 py-2 border font-medium">Account data</td>
                  <td className="px-4 py-2 border">Name, email, password (hashed — see §5), workspace and team details</td>
                  <td className="px-4 py-2 border">Provide the service, identify you, let your team collaborate</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Billing data</td>
                  <td className="px-4 py-2 border">Legal name, billing address, GSTIN (if any), Razorpay payment references, last 4 digits and issuer of a saved card</td>
                  <td className="px-4 py-2 border">Charge you, issue GST invoices, give input-tax-credit details</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Social-account data</td>
                  <td className="px-4 py-2 border">Account/profile IDs, Page/channel metadata, posts, comments and analytics received via the Meta, LinkedIn and YouTube APIs, only for accounts you connect</td>
                  <td className="px-4 py-2 border">Publish/schedule at your direction and show you analytics</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">OAuth tokens</td>
                  <td className="px-4 py-2 border">Access and refresh tokens for connected accounts</td>
                  <td className="px-4 py-2 border">Authorise publishing and analytics on your behalf</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Usage and logs</td>
                  <td className="px-4 py-2 border">Pages used, features used, IP address, device/browser information, error and audit logs</td>
                  <td className="px-4 py-2 border">Security, troubleshooting, abuse prevention, service improvement</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Support data</td>
                  <td className="px-4 py-2 border">Messages you send us, and any files you attach</td>
                  <td className="px-4 py-2 border">Answer you and resolve issues</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Cookies/trackers</td>
                  <td className="px-4 py-2 border">See §10</td>
                  <td className="px-4 py-2 border">Session/security, and analytics only with your consent</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            2.1 We collect data directly from you, from the social platforms you connect, and from our processors (Razorpay for payment status, Resend for email delivery).
          </p>
          <p>
            2.2 We do <strong>not</strong> knowingly collect data from children. The service is for adults/business users (18+) only. If an agency connects an account featuring a child, tell us and we will advise on removal. [LAWYER TO CONFIRM: position where agencies manage child-focused or minor accounts — DPDP requires verifiable parental consent for under-18s, and prohibits tracking/behavioural monitoring/targeted advertising directed at children.]
          </p>
          <p>
            2.3 We do not collect your card number, CVV or expiry date. See §6.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">3. How we use your data (lawful basis)</h2>
          <p>
            3.1 We process your data on the basis of <strong>your consent</strong> (given by clear affirmative action at sign-up, after the standalone notice) and, where applicable, to perform our contract with you and to comply with legal obligations (for example tax invoicing). We do not rely on &quot;legitimate use&quot; for marketing without consent.
          </p>
          <p>
            3.2 We use your data only for the purposes listed in §2, and for the specific purposes stated in the sign-up notice. We do not sell your personal data, use it to build or augment profiles, or combine it with other data except as stated here.
          </p>
          <p>
            3.3 <strong>Withdrawing consent</strong> is as easy as giving it: use the account settings or email <code>agadmale335@gmail.com</code>. On withdrawal we (and our processors) will stop processing within a reasonable time, subject to data we must keep by law (invoices, logs — see §7).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">4. Who we share your data with</h2>
          <p>
            4.1 <strong>Processors we use (and where the data goes):</strong>
          </p>
          <div className="overflow-x-auto my-4">
            <table className="min-w-full divide-y divide-gray-200 border text-sm text-left">
              <thead className="bg-gray-50 font-semibold text-gray-900">
                <tr>
                  <th className="px-4 py-2 border">Processor</th>
                  <th className="px-4 py-2 border">What for</th>
                  <th className="px-4 py-2 border">Where</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="px-4 py-2 border font-medium">Hosting provider (VPS + object storage)</td>
                  <td className="px-4 py-2 border">Runs the app and stores your data</td>
                  <td className="px-4 py-2 border"><code>[HOSTING REGION/COUNTRY — to confirm]</code></td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Razorpay (Razorpay Payments Pvt Ltd)</td>
                  <td className="px-4 py-2 border">Payment processing and subscriptions</td>
                  <td className="px-4 py-2 border">India (payment data is stored only in India, per RBI directions)</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Resend</td>
                  <td className="px-4 py-2 border">Transactional email (verification, password reset, invoices, dunning)</td>
                  <td className="px-4 py-2 border">United States</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Meta / LinkedIn / YouTube APIs</td>
                  <td className="px-4 py-2 border">Publishing and analytics, only for accounts you connect and only the data you authorise</td>
                  <td className="px-4 py-2 border">United States</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            4.2 We engage processors only under contracts requiring them to protect your data. We remain responsible for your data even when a processor fails.
          </p>
          <p>
            4.3 <strong>Cross-border transfers.</strong> India has no blanket data-localisation rule and, as of late 2026, no country has been notified as restricted for transfers under the DPDP Act. We will update this list if the Government restricts a destination. We do not promise &quot;your data never leaves India&quot; — hosting, email and the social APIs are outside India, as listed above. We do not export payment data abroad.
          </p>
          <p>
            4.4 We share data with anyone else only: (a) with your consent or direction (for example publishing a post to a platform you connected); (b) to comply with a court order or law; or (c) to protect our legal rights. We do not sell personal data to anyone.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">5. How we protect your data</h2>
          <p>
            5.1 We use reasonable security safeguards appropriate to the data: OAuth tokens are encrypted at rest with <strong>AES-256-GCM</strong>, decrypted only in server memory during authorised operations, never written to logs and never shared; access is controlled by role (RBAC); we keep logs, monitoring and backups so processing can continue after a compromise.
          </p>
          <p>
            5.2 No system is perfectly secure. If you believe your account or a connected token has been compromised, tell us immediately at <code>agadmale335@gmail.com</code> and disconnect the affected account.
          </p>
          <p>
            5.3 <strong>Breach notification.</strong> If we become aware of a personal data breach, we will notify each affected person without delay (by email or in-app: what happened, likely consequences, mitigation, self-protection steps, and a contact) and notify the Data Protection Board of India without delay, with a detailed report within 72 hours. Separately, cyber incidents reportable to CERT-In follow a 6-hour track. [LAWYER TO CONFIRM: what counts as &quot;becoming aware&quot; for a token leak at a platform, and who notifies whom when the breach is at a sub-processor.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">6. Payments — what we do and do not store</h2>
          <p>
            6.1 Payments are processed by <strong>Razorpay</strong> on its PCI-DSS-compliant checkout. Card details are entered on Razorpay&apos;s pages, never on ours.
          </p>
          <p>
            6.2 <strong>We do not store your card numbers, CVV or expiry dates.</strong> Where you save a card, it is tokenised by the card network under the RBI&apos;s card-on-file rules. We receive only a token/reference, the last 4 digits and the issuer name.
          </p>
          <p>
            6.3 Refunds go back to the original payment method only, typically within 5–7 business days of approval, with a GST credit note where GST was charged. See the Refund &amp; Cancellation Policy.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">7. How long we keep your data</h2>
          <div className="overflow-x-auto my-4">
            <table className="min-w-full divide-y divide-gray-200 border text-sm text-left">
              <thead className="bg-gray-50 font-semibold text-gray-900">
                <tr>
                  <th className="px-4 py-2 border">Data</th>
                  <th className="px-4 py-2 border">Retention</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="px-4 py-2 border font-medium">Account and workspace data (posts, schedules, analytics, connected accounts)</td>
                  <td className="px-4 py-2 border">While your account is active; <strong>30 days read-only/export grace period after cancellation</strong>, then permanently deleted</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">OAuth tokens</td>
                  <td className="px-4 py-2 border">Deleted immediately on disconnect, and purged within 7 days; also deleted when the platform revokes them</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Logs (processing, traffic, audit)</td>
                  <td className="px-4 py-2 border">At least <strong>1 year</strong> from processing, then erased (DPDP Rules 6/8)</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Invoices and accounting records</td>
                  <td className="px-4 py-2 border">As tax law requires (typically 6–8 years — [CA TO CONFIRM]; do not invent a number here)</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">YouTube Authorized Data</td>
                  <td className="px-4 py-2 border">Kept only as necessary for the consented purpose and <strong>no longer than 30 calendar days — delete or refresh</strong>; authorisation rechecked at least every 30 days for analytics kept longer</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border font-medium">Meta Platform Data</td>
                  <td className="px-4 py-2 border">Deleted promptly on request, and as soon as reasonably possible when no longer necessary, when the product stops operating, or when Meta requests deletion</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            7.1 Erasure: we erase personal data once its purpose is served or consent is withdrawn, unless another law requires us to keep it (see the table). Deleting your Agency OS account or disconnecting an integration does <strong>not</strong> delete content already published to a social platform — you must delete that on the platform itself.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">8. Your rights</h2>
          <p>8.1 Under the DPDP Act you have the right to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Access</strong> — a summary of the personal data we process about you, what we do with it, and who we shared it with;</li>
            <li><strong>Correction, completion and updating</strong> of your data;</li>
            <li><strong>Erasure</strong> of your data (subject to §7 legal-retention exceptions);</li>
            <li><strong>Grievance redressal</strong> — complain to us first (see §8.2), then to the Data Protection Board of India if unresolved;</li>
            <li><strong>Nomination</strong> — nominate a person to exercise your rights if you die or become incapacitated.</li>
          </ul>
          <p>
            8.2 <strong>How to exercise a right:</strong> email <code>agadmale335@gmail.com</code> (or use the in-app request form, when built) and tell us your username/customer ID so we can identify your account. We acknowledge grievances within <strong>48 hours</strong> and respond within <strong>one month</strong> (the SPDI/E-Commerce timeline); the DPDP ceiling is 90 days, and we promise the shorter period. There is no data-portability, objection or automated-decision right under DPDP (unlike GDPR) — we will not invent one in this policy.
          </p>
          <p>
            8.3 <strong>Data protection contact:</strong> Abhishek Gadmale, proprietor, <code>agadmale335@gmail.com</code>. A full-time Data Protection Officer based in India is required only for Significant Data Fiduciaries; we are not currently notified as one, and will update this policy if that changes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">9. Third-party platforms — what you should know</h2>
          <p>
            9.1 <strong>Meta (Facebook/Instagram).</strong> We use Platform Data only for the purposes you consented to. We do not sell it or use it to build profiles. If you remove our app or request deletion, Meta sends us a signed deletion request; we verify it, delete your Platform Data, and return a confirmation code and status URL. Our data-deletion instructions are at [TO CONFIRM: URL — this page must exist on a public, non-geoblocked URL and be entered in the Meta App Dashboard].
          </p>
          <p>
            9.2 <strong>LinkedIn.</strong> Member data from LinkedIn&apos;s APIs <strong>cannot be exported out of the application — including to you, our customer</strong> — and other members&apos; profile data may be cached for <strong>24 hours only</strong>. Our LinkedIn features are designed within those limits; we do not promise indefinite LinkedIn analytics retention. [LAWYER + PLATFORM REVIEW REQUIRED — product-scope question, see Terms §9.3.]
          </p>
          <p>
            9.3 <strong>YouTube.</strong> By using Agency OS to publish to YouTube, you agree to be bound by the YouTube Terms of Service (https://www.youtube.com/t/terms). You can revoke our access at any time at https://security.google.com/settings/security/permissions; Google&apos;s Privacy Policy (https://policies.google.com/privacy) also applies. You can ask us to delete stored YouTube data at any time — we delete it as soon as possible and <strong>within 7 calendar days</strong>. If you revoke via Google&apos;s settings, we delete the related data within 30 calendar days. Deleting data in Agency OS does not delete anything held by YouTube/Google.
          </p>
          <p>
            9.4 Each platform&apos;s own terms and privacy policy apply to your account on that platform. A platform may suspend our app or revoke tokens; if it does, the affected features stop until access is restored.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">10. Cookies and trackers</h2>
          <p>
            10.1 There is no standalone cookie law in India, and the DPDP Act does not mention cookies — but a cookie that identifies you is personal data under DPDP, so from 13 May 2027 non-essential cookies need the same standalone notice and clear affirmative consent as other personal data: no pre-ticked boxes, granular choice by category, as easy to withdraw as to give, and a persistent &quot;Cookie settings&quot; control. Accept and Reject must have equal weight — a bright &quot;Accept&quot; with a hidden &quot;Reject&quot; is a dark pattern.
          </p>
          <p>
            10.2 <strong>Our cookies/trackers:</strong> <code>[TO CONFIRM — list each by name, provider, purpose, duration, first- vs third-party. If we use no third-party analytics at all, say so expressly — that is a strong, verifiable statement. Resend, Razorpay checkout, and the platforms&apos; own pixels/SDKs must be listed if present.]</code>
          </p>
          <p>
            10.3 Strictly necessary cookies (login/session, security, load-balancing) do not need consent. Analytics and marketing tags are blocked until you consent. You can withdraw consent at any time via the cookie-settings control or your browser settings.
          </p>
          <p>
            10.4 If an EU/UK visitor signs up or is targeted, GDPR/ePrivacy rules apply separately — this policy&apos;s Indian cookie banner does not satisfy GDPR. [LAWYER IF WE LATER TARGET OUTSIDE INDIA.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">11. Changes to this policy</h2>
          <p>
            11.1 We may update this policy from time to time. Material changes will be notified by email or in-app before they take effect, and the &quot;last updated&quot; date above will change. If a transfer destination changes because the Government restricts it, that is a policy update, not a breach of a promise — we word destinations as &quot;we currently host/process in [X]&quot; for that reason.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">12. Contact</h2>
          <p>
            12.1 <strong>Data fiduciary:</strong> Gadmale Technologies, <code>Shihu, Tal-Pen, Dist-Raigad, Maharashtra, 402106, India</code>. Email: <code>agadmale335@gmail.com</code>.
          </p>
          <p>
            12.2 <strong>Grievance / data-protection contact:</strong> <code>Abhishek Gadmale, proprietor</code>, <code>agadmale335@gmail.com</code>. Acknowledgement within 48 hours; response within one month (DPDP ceiling: 90 days).
          </p>
          <p>
            12.3 Complaints to the regulator: Data Protection Board of India — route and details to be added when the Board publishes its complaint process. [TO CONFIRM at publication.]
          </p>
        </section>

        <div className="border-t border-gray-200 pt-6 text-sm text-gray-500 italic">
          Draft only. Sources: research brief 2026-11-10 (§§1–8). Not legal advice; lawyer review required before publication. Placeholders in [BRACKETS] must be filled, not published as-is. Do not hard-code IT Rules 2021 takedown deadlines from secondary sources — verify the current Rule 3 text on meity.gov.in before publishing (the brief flags conflicting secondaries).
        </div>
      </div>
    </div>
  );
}
