import Link from 'next/link';
import {
  CheckCircle2,
  Share2,
  Calendar,
  Layers,
  BarChart,
  Users,
  Lock,
  FileText,
  CreditCard,
  ShieldCheck,
  Check,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      {/* 1. Header/nav */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-tight text-gray-900 hover:text-blue-600 transition-colors">
            Agency OS
          </Link>
          <nav className="flex items-center space-x-4">
            <Link
              href="/login"
              className="text-sm font-medium text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md shadow-sm transition-colors"
            >
              Start free trial
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-grow">
        {/* 2. Hero */}
        <section className="py-20 sm:py-24 bg-white border-b border-gray-100">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 tracking-tight">
              Social media management for agencies and small teams — plan, publish, and measure client accounts from one workspace
            </h1>
            <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto">
              Coordinate multi-platform social media publishing across Facebook, Instagram, LinkedIn, and YouTube. Organize client content, tailor per-network variants, track account performance, and collaborate with your team without switching between tabs.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-md shadow-sm transition-colors"
              >
                Start 14-day free trial
              </Link>
              <Link
                href="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center text-base font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-300 px-6 py-3 rounded-md transition-colors"
              >
                Sign in
              </Link>
            </div>
            <p className="text-xs text-gray-500">
              No credit card required.
            </p>
          </div>
        </section>

        {/* 3. Risk-reversal strip */}
        <section className="bg-gray-50 border-b border-gray-200 py-6">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
              <div className="p-3 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-blue-600 mb-1" aria-hidden="true" />
                <span className="text-xs font-medium text-gray-800">14-day free trial — no credit card</span>
              </div>
              <div className="p-3 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-blue-600 mb-1" aria-hidden="true" />
                <span className="text-xs font-medium text-gray-800">Monthly billing — cancel anytime</span>
              </div>
              <div className="p-3 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-blue-600 mb-1" aria-hidden="true" />
                <span className="text-xs font-medium text-gray-800">7-day money-back guarantee</span>
              </div>
              <div className="p-3 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col items-center justify-center">
                <CreditCard className="w-5 h-5 text-blue-600 mb-1" aria-hidden="true" />
                <span className="text-xs font-medium text-gray-800">UPI and cards accepted via Razorpay</span>
              </div>
              <div className="p-3 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col items-center justify-center">
                <FileText className="w-5 h-5 text-blue-600 mb-1" aria-hidden="true" />
                <span className="text-xs font-medium text-gray-800">GST invoice on every payment</span>
              </div>
              <div className="p-3 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-blue-600 mb-1" aria-hidden="true" />
                <span className="text-xs font-medium text-gray-800">Prices include GST</span>
              </div>
            </div>
          </div>
        </section>

        {/* 4. How it works — 3 steps */}
        <section className="py-16 sm:py-20 bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">How it works</h2>
              <p className="mt-2 text-base text-gray-600">Three straightforward steps to run your agency publishing operations.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="p-6 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg">1</div>
                <h3 className="text-lg font-semibold text-gray-900">Connect your accounts</h3>
                <p className="text-sm text-gray-600">
                  Connect Facebook, Instagram, LinkedIn, and YouTube profiles. Users authorize on the platform&apos;s own site via official OAuth integrations.
                </p>
              </div>
              <div className="p-6 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg">2</div>
                <h3 className="text-lg font-semibold text-gray-900">Compose and schedule</h3>
                <p className="text-sm text-gray-600">
                  One composer, per-platform variants, media library. Adapt text and creative assets for each target network while creating once.
                </p>
              </div>
              <div className="p-6 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg">3</div>
                <h3 className="text-lg font-semibold text-gray-900">Publish and measure</h3>
                <p className="text-sm text-gray-600">
                  Publishing calendar/status and per-account analytics to track delivery and monitor reach, impressions, and engagement.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Features — SHIPPED capabilities ONLY */}
        <section className="py-16 sm:py-20 bg-gray-50 border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Shipped features</h2>
              <p className="mt-2 text-base text-gray-600">Core capabilities available right now in your agency workspace.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <Share2 className="w-5 h-5 text-blue-600" aria-hidden="true" />
                <h3 className="text-base font-semibold text-gray-900">Multi-platform publishing</h3>
                <p className="text-xs text-gray-600">Publish to Facebook, Instagram, LinkedIn, and YouTube from a single unified composer.</p>
              </div>
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <Calendar className="w-5 h-5 text-blue-600" aria-hidden="true" />
                <h3 className="text-base font-semibold text-gray-900">Post scheduling</h3>
                <p className="text-xs text-gray-600">Queue content in advance and review scheduled releases on an interactive publishing calendar.</p>
              </div>
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <Layers className="w-5 h-5 text-blue-600" aria-hidden="true" />
                <h3 className="text-base font-semibold text-gray-900">Per-platform post variants</h3>
                <p className="text-xs text-gray-600">Tailor captions, hashtags, and formatting separately for each network while composing once.</p>
              </div>
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <FileText className="w-5 h-5 text-blue-600" aria-hidden="true" />
                <h3 className="text-base font-semibold text-gray-900">Media library</h3>
                <p className="text-xs text-gray-600">Upload, store, and organize images and video assets ready for immediate or scheduled publishing.</p>
              </div>
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <BarChart className="w-5 h-5 text-blue-600" aria-hidden="true" />
                <h3 className="text-base font-semibold text-gray-900">Analytics dashboard</h3>
                <p className="text-xs text-gray-600">Examine reach, impressions, engagement rates, and follower growth trends across connected accounts.</p>
              </div>
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <Users className="w-5 h-5 text-blue-600" aria-hidden="true" />
                <h3 className="text-base font-semibold text-gray-900">Team workspaces & roles</h3>
                <p className="text-xs text-gray-600">Manage client accounts in distinct workspaces with defined roles: Owner, Manager, Editor, Client Approver, and Viewer.</p>
              </div>
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <Lock className="w-5 h-5 text-blue-600" aria-hidden="true" />
                <h3 className="text-base font-semibold text-gray-900">Account security</h3>
                <p className="text-xs text-gray-600">Built-in authentication defense with per-device sessions management and login lockout protections.</p>
              </div>
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <CreditCard className="w-5 h-5 text-blue-600" aria-hidden="true" />
                <h3 className="text-base font-semibold text-gray-900">GST-ready billing</h3>
                <p className="text-xs text-gray-600">Transparent GST-inclusive billing with downloadable invoices available immediately after each payment.</p>
              </div>
            </div>
          </div>
        </section>

        {/* 6. Pricing — three tiers with MONTHLY prices only */}
        <section className="py-16 sm:py-20 bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-6">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Pricing</h2>
              <p className="mt-2 text-base text-gray-600">Predictable plans for agencies of every size. All plans include 14-day free trial.</p>
              <div className="mt-3 inline-block bg-blue-50 text-blue-700 text-sm font-semibold px-3 py-1 rounded-full border border-blue-200">
                Annual billing: 2 months free
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-10">
              {/* Solo Card */}
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col p-6">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Solo</h3>
                  <p className="text-xs text-gray-500 mt-1">For independent creators and solo managers.</p>
                  <div className="mt-4 flex items-baseline">
                    <span className="text-4xl font-extrabold text-gray-900">₹499</span>
                    <span className="text-sm font-medium text-gray-500 ml-1">/month</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">GST inclusive (18%)</p>
                  <p className="text-sm font-semibold text-gray-700 mt-3">1 seat included</p>
                </div>
                <ul className="mt-6 space-y-3 text-xs text-gray-600 flex-grow">
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>Multi-platform publishing</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>Post scheduling & calendar</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>Media library</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>Account analytics</span>
                  </li>
                </ul>
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <Link
                    href="/signup"
                    className="w-full inline-flex items-center justify-center text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-4 py-2 rounded-md transition-colors"
                  >
                    Start free trial
                  </Link>
                </div>
              </div>

              {/* Studio Card */}
              <div className="bg-white rounded-lg border border-blue-300 shadow-md overflow-hidden flex flex-col p-6 relative">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Studio</h3>
                  <p className="text-xs text-gray-500 mt-1">For boutique agencies and social media teams.</p>
                  <div className="mt-4 flex items-baseline">
                    <span className="text-4xl font-extrabold text-gray-900">₹999</span>
                    <span className="text-sm font-medium text-gray-500 ml-1">/month</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">GST inclusive (18%)</p>
                  <p className="text-sm font-semibold text-gray-700 mt-3">3 seats included</p>
                </div>
                <ul className="mt-6 space-y-3 text-xs text-gray-600 flex-grow">
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>All Solo capabilities</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>3 team member seats</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>Team workspace permissions</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>Per-platform post variants</span>
                  </li>
                </ul>
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <Link
                    href="/signup"
                    className="w-full inline-flex items-center justify-center text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md shadow-sm transition-colors"
                  >
                    Start free trial
                  </Link>
                </div>
              </div>

              {/* Agency Card */}
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col p-6">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Agency</h3>
                  <p className="text-xs text-gray-500 mt-1">For established agencies scaling client operations.</p>
                  <div className="mt-4 flex items-baseline">
                    <span className="text-4xl font-extrabold text-gray-900">₹3,999</span>
                    <span className="text-sm font-medium text-gray-500 ml-1">/month</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">GST inclusive (18%)</p>
                  <p className="text-sm font-semibold text-gray-700 mt-3">10 seats included</p>

                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900 font-medium leading-relaxed">
                    Founding 50 — ₹2,999/month, price locked while your subscription stays active, for the first 50 customers.
                  </div>
                </div>
                <ul className="mt-6 space-y-3 text-xs text-gray-600 flex-grow">
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>All Studio capabilities</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>10 team member seats</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>Workspace role controls</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span>Per-device sessions management</span>
                  </li>
                </ul>
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <Link
                    href="/signup"
                    className="w-full inline-flex items-center justify-center text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-4 py-2 rounded-md transition-colors"
                  >
                    Start free trial
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 7. FAQ */}
        <section className="py-16 sm:py-20 bg-gray-50 border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="text-center">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Frequently asked questions</h2>
              <p className="mt-2 text-base text-gray-600">Factual answers regarding accounts, billing, and platforms.</p>
            </div>
            <div className="space-y-4">
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">What are the terms of the free trial?</h3>
                <p className="text-sm text-gray-600">
                  Every new workspace gets a 14-day free trial with full access to all features and zero credit card required. Nothing is charged during or at the end of the trial period.
                </p>
              </div>
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">What payment methods are accepted?</h3>
                <p className="text-sm text-gray-600">
                  Payment is processed securely by Razorpay in INR using UPI and credit/debit cards.
                </p>
              </div>
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">Do prices include GST?</h3>
                <p className="text-sm text-gray-600">
                  Yes, all prices are GST inclusive at 18% GST. A compliant GST invoice is provided for every payment.
                </p>
              </div>
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">How do cancellations and refunds work?</h3>
                <p className="text-sm text-gray-600">
                  Subscriptions are billed monthly and you can cancel anytime. We provide a 7-day money-back guarantee in accordance with our{' '}
                  <Link href="/refund-cancellation" className="text-blue-600 underline hover:text-blue-700">
                    Refund &amp; Cancellation Policy
                  </Link>.
                </p>
              </div>
              <div className="p-5 bg-white rounded-lg border border-gray-200 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">Which social media platforms are supported?</h3>
                <p className="text-sm text-gray-600">
                  Agency OS supports Facebook, Instagram, LinkedIn, and YouTube for post publishing and account analytics.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 8. Footer */}
      <footer className="bg-white border-t border-gray-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
          <div>
            <span>&copy; Gadmale Technologies</span>
            <span className="mx-2">&bull;</span>
            <a href="mailto:agadmale335@gmail.com" className="hover:text-gray-900 underline">
              agadmale335@gmail.com
            </a>
          </div>
          <div className="flex items-center space-x-6">
            <Link href="/terms" className="hover:text-gray-900 underline">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-gray-900 underline">
              Privacy
            </Link>
            <Link href="/refund-cancellation" className="hover:text-gray-900 underline">
              Refund &amp; Cancellation
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
