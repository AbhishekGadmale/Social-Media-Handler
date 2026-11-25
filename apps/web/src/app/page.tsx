import Image from 'next/image';
import Link from 'next/link';
import { HeroBrand } from '@/components/hero-brand';
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
  UserCheck,
  Palette,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      {/* 1. Header/nav — sticky with backdrop blur */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.svg"
              width={32}
              height={32}
              alt="Agency OS"
              className="h-8 w-8 shrink-0"
            />
            <span className="text-xl font-bold tracking-tight text-gray-900 hover:text-blue-600 transition-colors">
              Agency OS
            </span>
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
        {/* 2. Hero with subtle blue-to-slate gradient wash */}
        <section className="py-20 sm:py-28 bg-gradient-to-b from-blue-50/60 via-slate-50/30 to-white border-b border-gray-100">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 tracking-tight leading-tight">
              Social media management for agencies and small teams — plan, publish, and measure client accounts from one workspace
            </h1>
            <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
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
                className="w-full sm:w-auto inline-flex items-center justify-center text-base font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 px-6 py-3 rounded-md shadow-sm transition-colors"
              >
                Sign in
              </Link>
            </div>
            <p className="text-xs text-gray-500">
              No credit card required.
            </p>
            <HeroBrand />
          </div>
        </section>

        {/* 3. Risk-reversal strip */}
        <section className="bg-slate-50 border-b border-gray-200 py-6">
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

        {/* 4. How it works — 3 steps with desktop connecting line */}
        <section className="py-16 sm:py-24 bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-2">Workflow</p>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">How it works</h2>
              <p className="mt-2 text-base text-gray-600">Three straightforward steps to run your agency publishing operations.</p>
            </div>
            <div className="relative">
              {/* Desktop connecting line between step markers */}
              <div
                className="hidden md:block absolute top-6 left-[16%] right-[16%] h-0.5 bg-blue-100 z-0"
                aria-hidden="true"
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
                <div className="p-6 bg-slate-50/80 rounded-xl border border-gray-200/80 space-y-3 flex flex-col items-center text-center md:items-start md:text-left">
                  <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                    1
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 pt-1">Connect your accounts</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Connect Facebook, Instagram, LinkedIn, and YouTube profiles. Users authorize on the platform&apos;s own site via official OAuth integrations.
                  </p>
                </div>
                <div className="p-6 bg-slate-50/80 rounded-xl border border-gray-200/80 space-y-3 flex flex-col items-center text-center md:items-start md:text-left">
                  <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                    2
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 pt-1">Compose and schedule</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    One composer, per-platform variants, media library. Adapt text and creative assets for each target network while creating once.
                  </p>
                </div>
                <div className="p-6 bg-slate-50/80 rounded-xl border border-gray-200/80 space-y-3 flex flex-col items-center text-center md:items-start md:text-left">
                  <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                    3
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 pt-1">Publish and measure</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Publishing calendar/status and per-account analytics to track delivery and monitor reach, impressions, and engagement.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Features — SHIPPED capabilities ONLY */}
        <section className="py-16 sm:py-24 bg-slate-50 border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-2">Capabilities</p>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Shipped features</h2>
              <p className="mt-2 text-base text-gray-600">Core capabilities available right now in your agency workspace.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
              {/* Card 1: Multi-platform publishing */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4 flex-shrink-0">
                  <Share2 className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">Multi-platform publishing</h3>
                <p className="text-xs text-gray-600 leading-relaxed flex-grow">
                  Publish to Facebook, Instagram, LinkedIn, and YouTube from a single unified composer.
                </p>
              </div>

              {/* Card 2: Post scheduling */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4 flex-shrink-0">
                  <Calendar className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">Post scheduling</h3>
                <p className="text-xs text-gray-600 leading-relaxed flex-grow">
                  Queue content in advance and review scheduled releases on an interactive publishing calendar.
                </p>
              </div>

              {/* Card 3: Per-platform post variants */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4 flex-shrink-0">
                  <Layers className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">Per-platform post variants</h3>
                <p className="text-xs text-gray-600 leading-relaxed flex-grow">
                  Tailor captions, hashtags, and formatting separately for each network while composing once.
                </p>
              </div>

              {/* Card 4: Media library */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4 flex-shrink-0">
                  <FileText className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">Media library</h3>
                <p className="text-xs text-gray-600 leading-relaxed flex-grow">
                  Upload, store, and organize images and video assets ready for immediate or scheduled publishing.
                </p>
              </div>

              {/* Card 5: Analytics dashboard */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4 flex-shrink-0">
                  <BarChart className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">Analytics dashboard</h3>
                <p className="text-xs text-gray-600 leading-relaxed flex-grow">
                  Examine reach, impressions, engagement rates, and follower growth trends across connected accounts.
                </p>
              </div>

              {/* Card 6: Team workspaces & roles */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4 flex-shrink-0">
                  <Users className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">Team workspaces & roles</h3>
                <p className="text-xs text-gray-600 leading-relaxed flex-grow">
                  Manage client accounts in distinct workspaces with defined roles: Owner, Manager, Editor, Client Approver, and Viewer.
                </p>
              </div>

              {/* Card 7: Client approvals (NEW) */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4 flex-shrink-0">
                  <UserCheck className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">Client approvals</h3>
                <p className="text-xs text-gray-600 leading-relaxed flex-grow">
                  Clients review and approve posts before they publish; change requests come back with comments, and nothing goes live while approval is pending.
                </p>
              </div>

              {/* Card 8: White-label reports (NEW) */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4 flex-shrink-0">
                  <Palette className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">White-label reports</h3>
                <p className="text-xs text-gray-600 leading-relaxed flex-grow">
                  Client-ready PDF reports with your agency&apos;s name, logo and brand colour instead of ours.
                </p>
              </div>

              {/* Card 9: Account security */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4 flex-shrink-0">
                  <Lock className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">Account security</h3>
                <p className="text-xs text-gray-600 leading-relaxed flex-grow">
                  Built-in authentication defense with per-device sessions management and login lockout protections.
                </p>
              </div>

              {/* Card 10: GST-ready billing */}
              <div className="bg-white rounded-xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4 flex-shrink-0">
                  <CreditCard className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">GST-ready billing</h3>
                <p className="text-xs text-gray-600 leading-relaxed flex-grow">
                  Transparent GST-inclusive billing with downloadable invoices available immediately after each payment.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 6. Pricing — three tiers with MONTHLY prices only */}
        <section className="py-16 sm:py-24 bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-2">Transparent Pricing</p>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Pricing</h2>
              <p className="mt-2 text-base text-gray-600">Predictable plans for agencies of every size. All plans include 14-day free trial.</p>
              <div className="mt-4 inline-block bg-blue-50 text-blue-700 text-sm font-semibold px-4 py-1.5 rounded-full border border-blue-200">
                Annual billing: 2 months free
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12 items-stretch">
              {/* Solo Card */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col p-6 sm:p-8">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Solo</h3>
                  <p className="text-xs text-gray-500 mt-1">For independent creators and solo managers.</p>
                  <div className="mt-5 flex items-baseline">
                    <span className="text-4xl font-extrabold text-gray-900">₹499</span>
                    <span className="text-sm font-medium text-gray-500 ml-1">/month</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">GST inclusive (18%)</p>
                  <p className="text-sm font-semibold text-gray-700 mt-4">1 seat included</p>
                </div>
                <ul className="mt-6 space-y-3 text-xs text-gray-600 flex-grow">
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span className="font-medium text-gray-800">Up to 5 social accounts</span>
                  </li>
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
                <div className="mt-8 pt-4 border-t border-gray-100">
                  <Link
                    href="/signup"
                    className="w-full inline-flex items-center justify-center text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-4 py-2.5 rounded-md transition-colors"
                  >
                    Start free trial
                  </Link>
                </div>
              </div>

              {/* Studio Card */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col p-6 sm:p-8">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Studio</h3>
                  <p className="text-xs text-gray-500 mt-1">For boutique agencies and social media teams.</p>
                  <div className="mt-5 flex items-baseline">
                    <span className="text-4xl font-extrabold text-gray-900">₹999</span>
                    <span className="text-sm font-medium text-gray-500 ml-1">/month</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">GST inclusive (18%)</p>
                  <p className="text-sm font-semibold text-gray-700 mt-4">3 seats included</p>
                </div>
                <ul className="mt-6 space-y-3 text-xs text-gray-600 flex-grow">
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span className="font-medium text-gray-800">Up to 15 social accounts</span>
                  </li>
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
                <div className="mt-8 pt-4 border-t border-gray-100">
                  <Link
                    href="/signup"
                    className="w-full inline-flex items-center justify-center text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-4 py-2.5 rounded-md transition-colors"
                  >
                    Start free trial
                  </Link>
                </div>
              </div>

              {/* Agency Card — visually elevated */}
              <div className="bg-white rounded-xl border-2 border-blue-600 shadow-lg relative flex flex-col p-6 sm:p-8">
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold uppercase tracking-wider px-3.5 py-1 rounded-full shadow-sm">
                  For agencies
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Agency</h3>
                  <p className="text-xs text-gray-500 mt-1">For established agencies scaling client operations.</p>
                  <div className="mt-5 flex items-baseline">
                    <span className="text-4xl font-extrabold text-gray-900">₹3,999</span>
                    <span className="text-sm font-medium text-gray-500 ml-1">/month</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">GST inclusive (18%)</p>
                  <p className="text-sm font-semibold text-gray-700 mt-4">10 seats included</p>

                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900 font-medium leading-relaxed">
                    Founding 50 — ₹2,999/month, price locked while your subscription stays active, for the first 50 customers.
                  </div>
                </div>
                <ul className="mt-6 space-y-3 text-xs text-gray-600 flex-grow">
                  <li className="flex items-center space-x-2">
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                    <span className="font-medium text-gray-800">Up to 30 social accounts</span>
                  </li>
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
                <div className="mt-8 pt-4 border-t border-gray-100">
                  <Link
                    href="/signup"
                    className="w-full inline-flex items-center justify-center text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2.5 rounded-md shadow-sm transition-colors"
                  >
                    Start free trial
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 7. FAQ */}
        <section className="py-16 sm:py-24 bg-slate-50 border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-2">FAQ</p>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Frequently asked questions</h2>
              <p className="mt-2 text-base text-gray-600">Factual answers regarding accounts, billing, and platforms.</p>
            </div>
            <div className="space-y-4">
              <div className="p-6 bg-white rounded-xl border border-gray-200/80 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">What are the terms of the free trial?</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Every new workspace gets a 14-day free trial with full access to all features and zero credit card required. Nothing is charged during or at the end of the trial period.
                </p>
              </div>
              <div className="p-6 bg-white rounded-xl border border-gray-200/80 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">Can my clients approve posts before they go live?</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Yes: send a post for approval, the client approves or requests changes with a comment, and publishing stays blocked until it&apos;s approved.
                </p>
              </div>
              <div className="p-6 bg-white rounded-xl border border-gray-200/80 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">Can I send reports with my own branding?</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Yes: add your agency name, logo and brand colour in settings and client reports carry your brand, not Agency OS.
                </p>
              </div>
              <div className="p-6 bg-white rounded-xl border border-gray-200/80 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">What payment methods are accepted?</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Payment is processed securely by Razorpay in INR using UPI and credit/debit cards.
                </p>
              </div>
              <div className="p-6 bg-white rounded-xl border border-gray-200/80 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">Do prices include GST?</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Yes, all prices are GST inclusive at 18% GST. A compliant GST invoice is provided for every payment.
                </p>
              </div>
              <div className="p-6 bg-white rounded-xl border border-gray-200/80 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">How do cancellations and refunds work?</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Subscriptions are billed monthly and you can cancel anytime. We provide a 7-day money-back guarantee in accordance with our{' '}
                  <Link href="/refund-cancellation" className="text-blue-600 underline hover:text-blue-700">
                    Refund &amp; Cancellation Policy
                  </Link>.
                </p>
              </div>
              <div className="p-6 bg-white rounded-xl border border-gray-200/80 shadow-sm space-y-2">
                <h3 className="text-base font-semibold text-gray-900">Which social media platforms are supported?</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Agency OS supports Facebook, Instagram, LinkedIn, and YouTube for post publishing and account analytics.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 8. Final CTA Band before footer */}
        <section className="bg-gradient-to-b from-blue-50/80 via-blue-50/50 to-white border-t border-b border-blue-100 py-16 sm:py-20 text-center">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
              Ready to streamline your agency publishing?
            </h2>
            <p className="text-base text-gray-600 max-w-xl mx-auto">
              Get full access to all features with a 14-day free trial — no credit card required.
            </p>
            <div className="pt-2">
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 px-8 py-3.5 rounded-md shadow-sm transition-colors"
              >
                Start free trial
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* 9. Footer */}
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
            <Link href="/data-deletion" className="hover:text-gray-900 underline">
              Data Deletion
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
