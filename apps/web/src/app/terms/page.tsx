import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow space-y-6 text-gray-800 leading-relaxed">
        <div className="border-b border-gray-200 pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Agency OS — Terms of Service (DRAFT)
          </h1>
          <div className="mt-4 p-4 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-900 space-y-2">
            <p>
              <strong>Status:</strong> DRAFT prepared 2026-11-10, updated 2026-11-11 (email, address, grievance officer, 7-day refund window filled per owner) from the legal research brief (<code>~/workspace/research_notes/agency-os-legal-terms-privacy-india-20261110-1423/report.md</code>). <strong>This is not legal advice and has not been reviewed by a lawyer.</strong> Do not publish until the placeholders below are filled and a lawyer has reviewed the flagged items.
            </p>
            <p>
              <strong>Operator:</strong> Gadmale Technologies, a sole proprietorship registered in Maharashtra, India (Udyam-registered; GST registration in progress — GSTIN to be added when issued). Product name: <strong>Agency OS</strong>. Website: [TO CONFIRM: domain, e.g. agencyos.example — not yet confirmed].
            </p>
            <div>
              <p className="font-semibold">Placeholders to fill before publishing (do not guess these):</p>
              <ol className="list-decimal pl-5 mt-1 space-y-1">
                <li>Business email — FILLED 2026-11-11: agadmale335@gmail.com.</li>
                <li>Registered address — FILLED 2026-11-11: Shihu, Tal-Pen, Dist-Raigad, Maharashtra, 402106, India. NOTE: the proprietor&apos;s location on record was PIN 402107; the owner gave 402106 on 2026-11-11 — verify against the Udyam certificate before publishing.</li>
                <li><code>[GRIEVANCE OFFICER]</code> — FILLED 2026-11-11: Abhishek Gadmale, proprietor, agadmale335@gmail.com.</li>
                <li>Refund window — FILLED 2026-11-11: 7 days (owner&apos;s choice; matches the pricing-table draft of 2026-10-09). Use 7 days identically here, in the Refund Policy, and on the pricing page.</li>
                <li><code>[COURT CITY]</code> — jurisdiction city in Maharashtra (e.g. Mumbai or Raigad district court town) — owner/lawyer to pick. &quot;Maharashtra&quot; alone is not a court.</li>
                <li><code>[GSTIN]</code> — add when GST registration completes. Do not charge GST on invoices until registration is confirmed — see §5.</li>
                <li><code>[EFFECTIVE DATE]</code> / <code>[LAST UPDATED]</code> — date of first publication.</li>
              </ol>
            </div>
            <p>
              <strong>Lawyer-needed before publishing (from the research brief):</strong> liability-cap level and carve-outs; arbitration vs courts; whether a sole-proprietor customer can still claim as a &quot;consumer&quot;; founding-price-lock wording; LinkedIn analytics design (see §9); whether to claim IT Act s.79 safe harbour at all; children&apos;s-data position if agencies manage minor/child-focused accounts.
            </p>
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">1. The service</h2>
          <p>
            1.1 Agency OS is a multi-tenant software-as-a-service for social media management: agencies and small teams connect their clients&apos; Facebook, Instagram, LinkedIn and YouTube accounts, and use Agency OS to schedule and publish posts and view analytics, at the agency&apos;s direction.
          </p>
          <p>
            1.2 We provide the software. We do not create, approve or own your content, and we are not your agency, your publisher of record, or a party to your relationship with your clients.
          </p>
          <p>
            1.3 The service is for business use by adults (18+). You must not use it to manage accounts belonging to children, or to collect children&apos;s data, unless a lawyer has confirmed the arrangement complies with the DPDP Act (see Privacy Policy §9).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">2. Accounts, eligibility and security</h2>
          <p>
            2.1 You must provide accurate account and billing details and keep them up to date, including your legal name, billing address and GSTIN if you are GST-registered (without a GSTIN on the invoice you cannot claim input tax credit).
          </p>
          <p>
            2.2 You are responsible for everything done under your account, including by your team members within your seat limit, and for keeping your password and session secure. Tell us immediately at <code>agadmale335@gmail.com</code> if you believe your account has been compromised.
          </p>
          <p>
            2.3 One account per customer, unless we agree otherwise in writing. You must not share logins beyond your plan&apos;s seat limit or resell access to the service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">3. Plans, trial and payment</h2>
          <p>
            3.1 <strong>Plans and prices (INR, GST-inclusive).</strong> Solo ₹499/month, Studio ₹999/month, Agency ₹3,999/month; annual billing is 2 months free (Solo ₹4,999/year, Studio ₹9,999/year, Agency ₹39,999/year). <strong>Founding lock:</strong> the first 50 paying Agency customers pay ₹2,999/month (₹29,999/year) for as long as their subscription remains continuously active without lapse, downgrade or plan change. The lock does not survive cancellation and re-subscription or a change of plan. [LAWYER TO CONFIRM: exact lock duration and lapse wording — a vague &quot;locked forever&quot; is a contractual liability.]
          </p>
          <p>
            3.2 Prices shown are GST-inclusive at 18% GST (9% CGST + 9% SGST for Maharashtra buyers; 18% IGST for buyers outside Maharashtra). Every invoice breaks out the taxable value and the GST separately and states the SAC code (998314 — [CA TO CONFIRM: 998314 vs 997331]).
          </p>
          <p>
            3.3 <strong>Free trial.</strong> New workspaces get a 14-day free trial with full Agency entitlements and <strong>no card required</strong>. The trial starts on registration and ends automatically after 14 calendar days. Nothing is charged during or at the end of the trial. When the trial ends, the workspace becomes read-only until you choose a paid plan. Trial accounts are not eligible for refunds.
          </p>
          <p>
            3.4 <strong>Paid subscriptions.</strong> A paid subscription starts only when you affirmatively choose a plan and authorise payment. Payment is processed by Razorpay (our payment aggregator) in INR by UPI, card or netbanking. We do not store your card number, CVV or expiry date — see Privacy Policy §6.
          </p>
          <p>
            3.5 <strong>Recurring billing and mandates.</strong> Subscriptions renew automatically at the end of each billing period until cancelled. Recurring debits run under the RBI e-mandate framework: your mandate has a maximum per-debit amount (ceiling); you will receive a pre-debit notification at least 24 hours before each recurring debit; and you can revoke the mandate at any time from your bank or UPI app. Revoking the mandate in your bank app stops renewal but does not by itself cancel your Agency OS account or delete your data — cancel in Agency OS as well (§4). A price increase above your mandate ceiling requires a fresh authorisation from you.
          </p>
          <p>
            3.6 <strong>Price changes.</strong> We may change plan prices with at least 30 days&apos; advance notice. A change applies from your next renewal, never mid-period to a paid term. If the GST rate or law changes, the GST component of your price will change accordingly.
          </p>
          <p>
            3.7 <strong>Failed payments.</strong> If a payment fails we will retry and notify you by email (dunning). If payment remains unpaid after notice and a grace period, we may suspend the workspace (read-only) and then terminate it under §8. You remain liable for amounts due for the period you used.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">4. Cancellation</h2>
          <p>
            4.1 You may cancel at any time in the app or by email to <code>agadmale335@gmail.com</code>. Cancellation stops future renewals. You keep access until the end of the period you have already paid for. There is no pro-rata refund for the unused part of the current period except as the Refund &amp; Cancellation Policy provides.
          </p>
          <p>
            4.2 Cancelling does not delete your data immediately. Your workspace and its data are kept for a <strong>30-day read-only/export grace period</strong> after cancellation, then permanently deleted — except logs (kept at least 1 year) and invoices/accounting records (kept as tax law requires). Exporting your data during the grace period is your responsibility. See Privacy Policy §7.
          </p>
          <p>
            4.3 Annual plans: cancellation takes effect at the end of the paid annual term; there is no conversion to monthly mid-term and no pro-rata refund except within the refund window in the Refund &amp; Cancellation Policy.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">5. Refunds</h2>
          <p>
            5.1 Our refund promise is in the separate <strong>Refund &amp; Cancellation Policy</strong> (published at <Link href="/refund-cancellation" className="text-blue-600 underline">/refund-cancellation</Link>), summarised here: a money-back guarantee of 7 days on your <strong>first</strong> paid payment only; non-refundable after that; duplicate charges, billing errors and charges made after cancellation are always refunded in full to the original payment method, typically within 5–7 business days, with a GST credit note where GST was charged.
          </p>
          <p>
            5.2 No law in India requires a cooling-off period for digital subscriptions. Our refund window is our own contractual promise, and we will honour it as stated. Do not rely on any refund promise in an advertisement that contradicts this policy — if you see one, tell us and we will correct it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">6. Your content and acceptable use</h2>
          <p>
            6.1 You (and your clients) own your content — posts, captions, media and comments. You grant us a licence to host, process and publish it solely to provide the service, and to sub-license it to the social platforms&apos; APIs as necessary to publish it.
          </p>
          <p>
            6.2 You warrant that you own or have the rights to everything you publish through Agency OS, that you will comply with each platform&apos;s terms for your own accounts, and that your content does not infringe anyone&apos;s rights.
          </p>
          <p>
            6.3 <strong>You must not use Agency OS to:</strong> publish unlawful, defamatory, obscene, hateful or child-harmful content; send spam or unsolicited bulk messages; scrape data or circumvent platform limits; misrepresent your identity; sell followers or engagement; or use the service for gambling, adult or otherwise illegal businesses.
          </p>
          <p>
            6.4 We may remove content and suspend or terminate an account that breaches this section, with notice where practicable. We may also suspend access if a platform revokes our API access for your account.
          </p>
          <p>
            6.5 <strong>Disconnecting is not deleting.</strong> Disconnecting an integration or deleting your Agency OS account does <strong>not</strong> delete content already published to Facebook, Instagram, LinkedIn or YouTube. You must delete that content on the platform itself.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">7. Our intellectual property</h2>
          <p>
            7.1 Gadmale Technologies owns the platform, software, trademarks and all intellectual property in Agency OS. You receive a limited, non-exclusive, non-transferable licence to use the service during your subscription.
          </p>
          <p>
            7.2 We may use aggregated, de-identified data to improve the service. We will not use identifiable customer or platform data to train models or build profiles without separate, specific consent. Feedback and suggestions you send us may be used without compensation.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">8. Suspension and termination</h2>
          <p>
            8.1 <strong>By you:</strong> cancel any time under §4.
          </p>
          <p>
            8.2 <strong>By us:</strong> we may suspend or terminate for non-payment (after notice and a grace period), breach of these Terms or the Acceptable Use rules in §6, illegal use, platform revocation, or prolonged inactivity (period to be stated here: [TO CONFIRM]).
          </p>
          <p>
            8.3 On termination, access ends, connected-account tokens are revoked, and data is handled under the 30-day grace period in §4.2. No refund of the current period is due except under the Refund Policy. Accrued payment obligations, IP, confidentiality, liability and governing-law clauses survive termination.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">9. Third-party platforms</h2>
          <p>
            9.1 Agency OS depends on the APIs of Meta (Facebook/Instagram), LinkedIn and YouTube. Each platform can change, suspend or revoke API access, and each platform&apos;s own terms and privacy policy apply to your use of that platform. By using Agency OS to publish to YouTube, you agree to be bound by the YouTube Terms of Service (https://www.youtube.com/t/terms).
          </p>
          <p>
            9.2 We are not liable for platform-side outages, policy changes, quota limits or account actions taken by a platform against your account. If a platform revokes access, the affected publishing features will stop working until access is restored.
          </p>
          <p>
            9.3 <strong>LinkedIn — important limit.</strong> LinkedIn&apos;s API terms restrict how member data may be used and stored, including a prohibition on exporting member data out of the application to our customers and a 24-hour caching limit on other members&apos; profile data. Our LinkedIn analytics features are designed within those limits, and we do not promise indefinite retention of LinkedIn analytics. [LAWYER + PLATFORM REVIEW REQUIRED: this is a product-scope question, not a wording fix — confirm the analytics design against LinkedIn&apos;s current Restricted Use Cases before launch.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">10. Availability and warranties</h2>
          <p>
            10.1 The service is provided <strong>&quot;as is&quot; and &quot;as available&quot;</strong> on a best-efforts basis. We do not guarantee any uptime and do not offer an SLA unless a separate written agreement says so. Scheduled maintenance may occur with notice.
          </p>
          <p>
            10.2 Any uptime or feature figure in our marketing or on the pricing page is a promise we must keep — we will not advertise a feature that is not live. To the extent permitted by law, we disclaim implied warranties.
          </p>
          <p>
            10.3 We take reasonable security measures (see Privacy Policy §5), but no internet service is perfectly secure, and we do not warrant that the service will be uninterrupted or error-free.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">11. Limitation of liability</h2>
          <p>
            11.1 [LAWYER TO CONFIRM the cap and carve-outs before publishing.] <strong>Draft position:</strong> our total aggregate liability to you is limited to the fees you paid in the 12 months before the claim arose. We are not liable for indirect or consequential loss, including loss of profit, goodwill, data or business interruption.
          </p>
          <p>
            11.2 Nothing in this section excludes liability for fraud, wilful misconduct, intellectual-property infringement, breach of confidentiality, or non-payment, or anything that cannot be excluded by law. A total bar on damages (a ₹0 cap) is not used here — it invites challenge under the Indian Contract Act, 1872.
          </p>
          <p>
            11.3 If you are a sole proprietor buying Agency OS to earn a livelihood by self-employment, you may qualify as a &quot;consumer&quot; under the Consumer Protection Act, 2019, and a consumer-forum claim may not be limited by this clause. [LAWYER TO CONFIRM.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">12. Indemnity</h2>
          <p>
            12.1 You will indemnify us against third-party claims arising from your content, your use of the service in breach of these Terms, or your breach of a platform&apos;s terms — including reasonable legal costs.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">13. Changes to these Terms</h2>
          <p>
            13.1 We may update these Terms from time to time. Material changes will be notified by email or in-app at least 30 days before they take effect (price changes: §3.6). Continued use after the effective date is acceptance. If you do not agree to a material change, cancel before it takes effect under §4.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">14. Governing law and disputes</h2>
          <p>
            14.1 These Terms are governed by the laws of India. Subject to §14.2, the courts at <code>[COURT CITY]</code>, Maharashtra have jurisdiction.
          </p>
          <p>
            14.2 [LAWYER TO PICK ONE — do not list alternatives in the published document.] Draft option: before filing in court, the parties will try to resolve the dispute by good-faith negotiation for 30 days. [Arbitration vs courts is undecided — an arbitration clause does not bar a consumer from the consumer Commissions.]
          </p>
          <p>
            14.3 A consumer complaint, if you qualify as a consumer, may be filed where you reside or work, and a jurisdiction clause does not reliably defeat that.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">15. Contact and grievances</h2>
          <p>
            15.1 <strong>Operator:</strong> Gadmale Technologies, <code>Shihu, Tal-Pen, Dist-Raigad, Maharashtra, 402106, India</code>. Email: <code>agadmale335@gmail.com</code>. GSTIN: <code>[GSTIN — pending]</code>. Udyam-registered.
          </p>
          <p>
            15.2 <strong>Grievance Officer:</strong> <code>Abhishek Gadmale, proprietor, agadmale335@gmail.com</code>. We acknowledge grievances within 48 hours and resolve them within one month (the shortest applicable timeline across the IT/SPDI and E-Commerce Rules; the DPDP timeline is up to 90 days — see Privacy Policy §8).
          </p>
          <p>
            15.3 For data-protection requests (access, correction, erasure, grievance), see Privacy Policy §8 — same contact, same acknowledgement timeline.
          </p>
        </section>

        <div className="border-t border-gray-200 pt-6 text-sm text-gray-500 italic">
          Draft only. Sources: research brief 2026-11-10 (§§1–8). Not legal advice; lawyer review required before publication. Placeholders in [BRACKETS] must be filled, not published as-is.
        </div>
      </div>
    </div>
  );
}
