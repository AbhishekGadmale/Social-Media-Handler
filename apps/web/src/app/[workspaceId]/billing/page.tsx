'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { billingQueries, BillingPlan } from '../../../lib/query/billing';
import { ApiError, api } from '../../../lib/api/client';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  CreditCard,
  Download,
  RefreshCw,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';

export default function BillingPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const workspaceId = params.workspaceId as string;

  const [interval, setInterval] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [subscribingCode, setSubscribingCode] = useState<string | null>(null);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const {
    data: billingData,
    isLoading: isBillingLoading,
    isError: isBillingError,
    error: billingError,
    refetch: refetchBilling,
  } = useQuery(billingQueries.status(workspaceId));

  const {
    data: plansData,
    isLoading: isPlansLoading,
    isError: isPlansError,
    error: plansError,
    refetch: refetchPlans,
  } = useQuery(billingQueries.plans(workspaceId));

  const {
    data: invoicesData,
    isLoading: isInvoicesLoading,
    isError: isInvoicesError,
    refetch: refetchInvoices,
  } = useQuery(billingQueries.invoices(workspaceId));

  const isLoading = isBillingLoading || isPlansLoading;
  const isError = isBillingError || isPlansError;
  const error = billingError || plansError;

  const isPaymentProcessing =
    searchParams.get('payment') === 'processing' ||
    searchParams.get('razorpay_payment_id') !== null;

  const subscription = billingData?.subscription;
  const trialEndsAt = billingData?.trialEndsAt
    ? new Date(billingData.trialEndsAt)
    : null;
  const now = new Date();

  // Days remaining in trial
  const trialDaysRemaining = useMemo(() => {
    if (!trialEndsAt) return 0;
    const diffMs = trialEndsAt.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }, [trialEndsAt, now]);

  // Static fallback plans in case API list is still populating
  const displayPlans = useMemo(() => {
    const rawPlans = plansData?.plans || [];
    const defaults: Record<string, Partial<BillingPlan>> = {
      SOLO: {
        code: 'SOLO',
        name: 'Solo',
        monthlyPricePaise: 49900,
        annualPricePaise: 499000,
        seats: 1,
      },
      STUDIO: {
        code: 'STUDIO',
        name: 'Studio',
        monthlyPricePaise: 99900,
        annualPricePaise: 999000,
        seats: 3,
      },
      AGENCY: {
        code: 'AGENCY',
        name: 'Agency',
        monthlyPricePaise: 399900,
        annualPricePaise: 3999000,
        seats: 10,
      },
      AGENCY_FOUNDING: {
        code: 'AGENCY_FOUNDING',
        name: 'Agency (Founding 50)',
        monthlyPricePaise: 299900,
        annualPricePaise: 2999000,
        seats: 10,
        isFounding: true,
      },
    };

    const merged = ['SOLO', 'STUDIO', 'AGENCY', 'AGENCY_FOUNDING'].map((code) => {
      const found = rawPlans.find((p) => p.code === code);
      return {
        id: found?.id || code,
        code,
        name: found?.name || defaults[code].name || code,
        monthlyPricePaise:
          found?.monthlyPricePaise ?? defaults[code].monthlyPricePaise ?? 0,
        annualPricePaise:
          found?.annualPricePaise ?? defaults[code].annualPricePaise ?? 0,
        seats: found?.seats ?? defaults[code].seats ?? 1,
        isFounding: found?.isFounding ?? (code === 'AGENCY_FOUNDING'),
        isActive: found?.isActive ?? true,
      };
    });

    return merged;
  }, [plansData]);

  const foundingAvailable = plansData?.foundingAvailable ?? true;

  const handleSubscribe = async (planCode: string) => {
    try {
      setSubscribingCode(planCode);
      setSubscribeError(null);
      const res = await api.post<{ short_url?: string; shortUrl?: string }>(
        `workspaces/${workspaceId}/billing/subscribe`,
        {
          planCode,
          interval,
        },
      );

      const redirectUrl = res.short_url || res.shortUrl;
      if (redirectUrl) {
        window.location.assign(redirectUrl);
      } else {
        await refetchBilling();
        setSubscribingCode(null);
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setSubscribeError(
        errorObj?.message ||
          'Failed to initiate checkout. Please try again.',
      );
      setSubscribingCode(null);
    }
  };

  const handleCancelSubscription = async () => {
    try {
      setIsCancelling(true);
      setCancelError(null);
      await api.post(`workspaces/${workspaceId}/billing/cancel`, {
        cancelAtPeriodEnd: true,
      });
      await refetchBilling();
      setIsCancelModalOpen(false);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setCancelError(
        errorObj?.message ||
          'Failed to cancel subscription. Please try again.',
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Workspace Billing</h1>
        <p className="mt-2 text-sm text-gray-600">
          Manage your subscription plans, view payment status, and download tax
          invoices.
        </p>
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="space-y-6" role="status" aria-label="Loading billing information">
          <div className="h-20 bg-gray-200 rounded-lg animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-80 bg-gray-200 rounded-lg animate-pulse" />
            ))}
          </div>
          <span className="sr-only">Loading billing details...</span>
        </div>
      ) : isError ? (
        /* Error & 403 States */
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex flex-col items-center text-center">
          <AlertCircle className="w-10 h-10 text-red-500 mb-3" aria-hidden="true" />
          {error instanceof ApiError && error.status === 403 ? (
            <>
              <h3 className="text-lg font-medium text-red-800">Access Denied</h3>
              <p className="mt-2 text-sm text-red-700">
                You do not have permission to view billing information for this
                workspace.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-medium text-red-800">
                Failed to load billing details
              </h3>
              <p className="mt-2 text-sm text-red-700 max-w-md">
                An error occurred while fetching billing details. Please try again.
              </p>
              <button
                onClick={() => {
                  refetchBilling();
                  refetchPlans();
                  refetchInvoices();
                }}
                className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
                aria-label="Retry loading billing details"
              >
                <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                Retry
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Gateway Return Processing Banner */}
          {isPaymentProcessing && (
            <div
              className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3"
              role="status"
              data-testid="banner-payment-processing"
            >
              <Clock className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0 animate-spin" />
              <div>
                <h3 className="text-sm font-semibold text-amber-900">
                  Payment processing — awaiting gateway confirmation
                </h3>
                <p className="text-xs text-amber-700 mt-0.5">
                  Your checkout transaction was received. Your workspace status will
                  automatically update as soon as the secure webhook is verified.
                </p>
              </div>
            </div>
          )}

          {/* Current Subscription Status Banners */}
          {subscription?.status === 'ACTIVE' && (
            <div
              className="bg-emerald-50 border border-emerald-200 rounded-lg p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              data-testid="banner-active"
            >
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-emerald-600 flex-shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-emerald-900">
                      {subscription.plan?.name || 'Active Subscription'}
                    </span>
                    <span className="text-xs bg-emerald-200 text-emerald-800 font-medium px-2 py-0.5 rounded-full uppercase">
                      Active
                    </span>
                    {subscription.isFounding && (
                      <span className="text-xs bg-purple-100 text-purple-700 font-medium px-2 py-0.5 rounded-full">
                        Founding Rate Locked
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-emerald-700 mt-1">
                    Billed {subscription.billingInterval.toLowerCase()} • Renews on{' '}
                    {subscription.currentPeriodEnd
                      ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                      : 'end of cycle'}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="text-red-600 border-red-200 hover:bg-red-50 text-xs"
                onClick={() => setIsCancelModalOpen(true)}
              >
                Cancel Subscription
              </Button>
            </div>
          )}

          {subscription?.status === 'CANCELLED' && (
            <div
              className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3"
              data-testid="banner-cancelled"
            >
              <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-orange-900">
                  Subscription Cancelled
                </h3>
                <p className="text-xs text-orange-700 mt-0.5">
                  Your subscription is cancelled, but access is retained until{' '}
                  <span className="font-medium">
                    {subscription.currentPeriodEnd
                      ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                      : 'the end of your current billing period'}
                  </span>
                  .
                </p>
              </div>
            </div>
          )}

          {(!subscription || subscription.status === 'TRIAL') && (
            <div
              className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3"
              data-testid="banner-trial"
            >
              <Clock className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-blue-900">
                  14-Day Free Trial (Agency Tier)
                </h3>
                <p className="text-xs text-blue-700 mt-0.5">
                  You have <span className="font-bold">{trialDaysRemaining} days</span>{' '}
                  remaining in your full-featured trial (ends{' '}
                  {trialEndsAt ? trialEndsAt.toLocaleDateString() : 'soon'}). Choose a
                  plan below to ensure uninterrupted service.
                </p>
              </div>
            </div>
          )}

          {(subscription?.status === 'PAST_DUE' ||
            subscription?.status === 'HALTED' ||
            subscription?.status === 'EXPIRED') && (
            <div
              className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3"
              data-testid="banner-readonly"
            >
              <ShieldAlert className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-red-900">
                  Workspace is in Read-Only Mode
                </h3>
                <p className="text-xs text-red-700 mt-0.5">
                  Publishing and scheduling are paused because your subscription is{' '}
                  {subscription?.status.toLowerCase().replace('_', ' ')}. Please
                  subscribe to an active plan to restore write access.
                </p>
              </div>
            </div>
          )}

          {/* Pricing Plans Section */}
          <section aria-labelledby="pricing-plans-heading" className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
              <div>
                <h2
                  id="pricing-plans-heading"
                  className="text-xl font-bold text-gray-900"
                >
                  Choose Your Plan
                </h2>
                <p className="text-sm text-gray-500">
                  All prices are GST-inclusive totals. No hidden taxes or surprises.
                </p>
              </div>

              {/* Monthly / Annual Toggle */}
              <div className="inline-flex items-center bg-gray-100 p-1 rounded-lg self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setInterval('MONTHLY')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    interval === 'MONTHLY'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setInterval('ANNUAL')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                    interval === 'ANNUAL'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Annual
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    2 months free
                  </span>
                </button>
              </div>
            </div>

            {subscribeError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
                {subscribeError}
              </div>
            )}

            {/* Plans Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {displayPlans.map((plan) => {
                const isFoundingPlan = plan.code === 'AGENCY_FOUNDING';
                const isFoundingSoldOut = isFoundingPlan && !foundingAvailable;

                const pricePaise =
                  interval === 'ANNUAL'
                    ? plan.annualPricePaise
                    : plan.monthlyPricePaise;
                const formattedPrice = `₹${(pricePaise / 100).toLocaleString('en-IN')}`;
                const periodLabel = interval === 'ANNUAL' ? '/year' : '/month';

                const isCurrentPlan =
                  subscription?.plan?.code === plan.code &&
                  subscription?.status === 'ACTIVE';

                return (
                  <div
                    key={plan.code}
                    data-testid={`card-plan-${plan.code}`}
                    className={`rounded-xl border bg-white p-6 shadow-sm flex flex-col justify-between relative transition-all ${
                      isFoundingPlan
                        ? 'border-purple-300 ring-1 ring-purple-200 bg-gradient-to-b from-purple-50/30 to-white'
                        : 'border-gray-200 hover:border-gray-300'
                    } ${isFoundingSoldOut ? 'opacity-60 bg-gray-50' : ''}`}
                  >
                    {isFoundingPlan && (
                      <span className="absolute -top-3 right-4 bg-purple-700 text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-sm flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        First 50 Only
                      </span>
                    )}

                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        {plan.name}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1">
                        {plan.seats === 1
                          ? '1 Seat included'
                          : `${plan.seats} Seats included`}
                      </p>

                      <div className="mt-4 mb-6">
                        <span className="text-3xl font-extrabold text-gray-900">
                          {formattedPrice}
                        </span>
                        <span className="text-xs text-gray-500 font-medium ml-1">
                          {periodLabel}
                        </span>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          GST inclusive (18%)
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {isCurrentPlan ? (
                        <Button
                          disabled
                          className="w-full bg-emerald-600 text-white text-xs cursor-default"
                        >
                          Current Plan
                        </Button>
                      ) : (
                        <Button
                          onClick={() => handleSubscribe(plan.code)}
                          disabled={
                            subscribingCode !== null || isFoundingSoldOut
                          }
                          className={`w-full text-xs font-semibold ${
                            isFoundingPlan
                              ? 'bg-purple-700 hover:bg-purple-800 text-white'
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                          }`}
                        >
                          {subscribingCode === plan.code ? (
                            <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                          ) : null}
                          {isFoundingSoldOut
                            ? 'Sold Out'
                            : isFoundingPlan
                              ? 'Claim Founding Lock'
                              : 'Subscribe'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Customer Portal: Invoices Section */}
          <section aria-labelledby="invoices-heading" className="space-y-4 pt-4 border-t">
            <div>
              <h2 id="invoices-heading" className="text-xl font-bold text-gray-900">
                Invoice History
              </h2>
              <p className="text-sm text-gray-500">
                Download official GST tax invoices for accounting and tax filing.
              </p>
            </div>

            {isInvoicesLoading ? (
              <div className="h-32 bg-gray-100 rounded-lg animate-pulse" />
            ) : isInvoicesError ? (
              <p className="text-xs text-red-600">Failed to load invoice history.</p>
            ) : !invoicesData || invoicesData.length === 0 ? (
              <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg p-8 text-center">
                <CreditCard className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <h4 className="text-sm font-semibold text-gray-700">
                  No invoices yet
                </h4>
                <p className="text-xs text-gray-500 mt-1">
                  Tax invoices will appear here after your first subscription payment.
                </p>
              </div>
            ) : (
              <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
                <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
                  <thead className="bg-gray-50 text-gray-600 font-semibold uppercase tracking-wider">
                    <tr>
                      <th scope="col" className="px-6 py-3">
                        Invoice #
                      </th>
                      <th scope="col" className="px-6 py-3">
                        Date
                      </th>
                      <th scope="col" className="px-6 py-3">
                        Plan
                      </th>
                      <th scope="col" className="px-6 py-3">
                        Total Amount
                      </th>
                      <th scope="col" className="px-6 py-3">
                        Status
                      </th>
                      <th scope="col" className="px-6 py-3 text-right">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {invoicesData.map((inv) => (
                      <tr key={inv.id} className="hover:bg-gray-50/60">
                        <td className="px-6 py-4 font-mono font-medium text-gray-900">
                          {inv.invoiceNumber}
                        </td>
                        <td className="px-6 py-4 text-gray-500">
                          {new Date(inv.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-gray-700">
                          {inv.subscription?.plan?.name || 'Subscription'}
                        </td>
                        <td className="px-6 py-4 font-semibold text-gray-900">
                          ₹{(inv.amountPaise / 100).toLocaleString('en-IN')}
                        </td>
                        <td className="px-6 py-4">
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <a
                            href={`${apiBaseUrl}/workspaces/${workspaceId}/billing/invoices/${inv.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium gap-1 text-xs"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download PDF
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Cancellation Confirmation Modal */}
          {isCancelModalOpen && (
            <div
              className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancel-modal-title"
            >
              <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <h3
                      id="cancel-modal-title"
                      className="text-base font-bold text-gray-900"
                    >
                      Cancel Subscription?
                    </h3>
                    <p className="text-xs text-gray-600 mt-1">
                      Are you sure you want to cancel? Your access will continue
                      normally until{' '}
                      <span className="font-semibold text-gray-900">
                        {subscription?.currentPeriodEnd
                          ? new Date(
                              subscription.currentPeriodEnd,
                            ).toLocaleDateString()
                          : 'the end of your current billing period'}
                      </span>
                      . After that, your workspace will enter read-only mode.
                    </p>
                    {subscription?.isFounding && (
                      <p className="text-xs text-purple-700 bg-purple-50 p-2 rounded mt-2 border border-purple-200">
                        <strong>Warning:</strong> You currently hold a Founding 50
                        rate lock. If you cancel, your founding seat is permanently
                        forfeited.
                      </p>
                    )}
                  </div>
                </div>

                {cancelError && (
                  <p className="text-xs text-red-600 bg-red-50 p-2 rounded">
                    {cancelError}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsCancelModalOpen(false)}
                    disabled={isCancelling}
                  >
                    Keep Subscription
                  </Button>
                  <Button
                    onClick={handleCancelSubscription}
                    disabled={isCancelling}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    {isCancelling ? (
                      <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : null}
                    Confirm Cancellation
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
