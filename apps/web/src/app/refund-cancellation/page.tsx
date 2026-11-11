import Link from 'next/link';

export default function RefundCancellationPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 rounded-lg shadow space-y-6 text-gray-800 leading-relaxed">
        <div className="border-b border-gray-200 pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Agency OS — Refund &amp; Cancellation Policy (DRAFT)
          </h1>
          <div className="mt-4 p-4 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-900 space-y-2">
            <p>
              <strong>Status:</strong> DRAFT prepared 2026-11-10, updated 2026-11-11 (email, address, 7-day refund window filled per owner). Razorpay requires this as a <strong>standalone published page</strong> with timelines — it must exist on the live website before merchant activation, alongside the Terms of Service and Privacy Policy. <strong>Not legal advice; lawyer review required before publication.</strong>
            </p>
            <p>
              <strong>Operator:</strong> Gadmale Technologies, sole proprietorship, Maharashtra, India. Contact: <code>agadmale335@gmail.com</code>. Address: <code>Shihu, Tal-Pen, Dist-Raigad, Maharashtra, 402106, India</code>.
            </p>
            <p>
              <strong>Refund window decided 2026-11-11: 7 days</strong> (owner&apos;s choice; matches the pricing-table draft of 2026-10-09). Use 7 days identically here, in the Terms (§5), and on the pricing page. There is <strong>no statutory cooling-off period</strong> for digital subscriptions in India — this window is our own contractual promise.
            </p>
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">1. Free trial — no charge, no refund needed</h2>
          <p>
            New workspaces get a 14-day free trial with full Agency entitlements and no card required. Nothing is charged during or at the end of the trial, and the trial ends automatically. Trial accounts are not eligible for refunds.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">2. Money-back guarantee — first paid payment only</h2>
          <p>
            2.1 If you are a new customer, you may request a full refund of your <strong>first</strong> paid subscription payment within 7 days of that payment.
          </p>
          <p>
            2.2 How to request: email <code>agadmale335@gmail.com</code> from your billing email, stating your workspace name and the payment date. We will confirm receipt within 48 hours and decide within 5 business days.
          </p>
          <p>
            2.3 After the window, subscriptions are <strong>non-refundable</strong>, including renewals. Annual plans: a pro-rata refund is available only within the same 7-day window (unused months at the monthly-equivalent rate, less the annual discount); after that, no pro-rata refund and no conversion to monthly mid-term.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">3. Always refunded in full</h2>
          <p>
            Regardless of the window above, we always refund in full: duplicate charges, billing errors, and any charge made after you cancelled. Tell us at <code>agadmale335@gmail.com</code> and we will refund to the <strong>original payment method only</strong>, typically within <strong>5–7 business days</strong> (bank/UPI-dependent — we never promise instant refunds). Where GST was charged on the refunded invoice, we issue a GST credit note.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">4. What is not refunded</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>The unused part of a current monthly or annual period when you cancel after the refund window (you keep access until the end of the paid period — see Terms §4).</li>
            <li>Charges for a period you used after the refund window, even if you cancel mid-period.</li>
            <li>Fees for add-ons (extra seats/workspaces) already used in the current period, unless the charge itself was a billing error.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">5. Cancellation</h2>
          <p>
            5.1 Cancel any time in the app or by email to <code>agadmale335@gmail.com</code>. Cancellation stops future renewals; you keep access until the end of the period already paid for.
          </p>
          <p>
            5.2 Cancelling in Agency OS does not automatically cancel your Razorpay e-mandate in your bank/UPI app, and cancelling the mandate in your bank app does not by itself cancel your Agency OS account. Cancel in both places, or ask us to cancel the mandate on your behalf and we will confirm when done.
          </p>
          <p>
            5.3 After cancellation, your data is kept for a <strong>30-day read-only/export grace period</strong>, then permanently deleted (except logs kept at least 1 year and invoices kept as tax law requires). See <Link href="/terms" className="text-blue-600 underline">Terms §4</Link> and <Link href="/privacy" className="text-blue-600 underline">Privacy Policy §7</Link>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900">6. How refunds are processed</h2>
          <p>
            Refunds are initiated by us in the Razorpay dashboard back to the original payment method. Razorpay does not decide whether you are entitled to a refund — that is this policy. The credit typically appears in 5–7 business days depending on your bank or UPI provider.
          </p>
        </section>

        <div className="border-t border-gray-200 pt-6 text-sm text-gray-500 italic">
          Draft only. Sources: research brief 2026-11-10 (§§3, 4, 5, 7). Not legal advice; lawyer review required before publication.
        </div>
      </div>
    </div>
  );
}
