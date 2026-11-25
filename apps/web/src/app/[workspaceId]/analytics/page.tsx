"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { analyticsQueries } from "../../../lib/query/analytics";
import { authQueries } from "../../../lib/query/auth";
import { clientQueries } from "../../../lib/query/clients";
import { canGenerateReports, canViewClients } from "../../../lib/permissions";
import { downloadClientReportPdf } from "../../../lib/query/reports";
import { ApiError } from "../../../lib/api/client";
import { PLATFORM_BRANDS } from "../../../components/platform-badge";
import {
  AlertCircle,
  RefreshCw,
  BarChart3,
  Users,
  Link as LinkIcon,
  Activity,
  MessageSquare,
  Video,
  Globe,
  CheckCircle2,
  ChevronRight,
  AlertTriangle,
  FileText,
  Download,
} from "lucide-react";
import Link from "next/link";

function renderBrandIcon(brand: { path: string; color: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      fill={brand.color}
      aria-hidden="true"
    >
      <path d={brand.path} />
    </svg>
  );
}

function getProviderBadge(provider: string) {
  const p = (provider || "").toUpperCase();
  switch (p) {
    case "LINKEDIN":
      return {
        icon: renderBrandIcon(PLATFORM_BRANDS.LINKEDIN),
        containerClass: "bg-blue-50 text-blue-700",
        label: "LinkedIn",
      };
    case "YOUTUBE":
      return {
        icon: renderBrandIcon(PLATFORM_BRANDS.YOUTUBE),
        containerClass: "bg-red-50 text-red-700",
        label: "YouTube",
      };
    case "TWITTER":
      return {
        icon: (
          <MessageSquare className="w-5 h-5 text-sky-600" aria-hidden="true" />
        ),
        containerClass: "bg-sky-50 text-sky-700",
        label: "Twitter / X",
      };
    case "INSTAGRAM":
      return {
        icon: renderBrandIcon(PLATFORM_BRANDS.INSTAGRAM),
        containerClass: "bg-pink-50 text-pink-700",
        label: "Instagram",
      };
    case "FACEBOOK":
      return {
        icon: renderBrandIcon(PLATFORM_BRANDS.FACEBOOK),
        containerClass: "bg-indigo-50 text-indigo-700",
        label: "Facebook",
      };
    case "TIKTOK":
      return {
        icon: <Video className="w-5 h-5 text-slate-700" aria-hidden="true" />,
        containerClass: "bg-slate-100 text-slate-800",
        label: "TikTok",
      };
    default:
      return {
        icon: <Globe className="w-5 h-5 text-gray-600" aria-hidden="true" />,
        containerClass: "bg-gray-100 text-gray-700",
        label: provider || "Other",
      };
  }
}

function getStatusBadge(status: string) {
  const s = (status || "").toUpperCase();
  switch (s) {
    case "ACTIVE":
      return {
        label: "Active",
        className: "bg-green-50 text-green-700 border-green-200",
      };
    case "REAUTH_REQUIRED":
      return {
        label: "Reauth Required",
        className: "bg-amber-50 text-amber-800 border-amber-200",
      };
    case "DISCONNECTED":
      return {
        label: "Disconnected",
        className: "bg-gray-100 text-gray-700 border-gray-200",
      };
    default:
      return {
        label: status || "Unknown",
        className: "bg-gray-100 text-gray-700 border-gray-200",
      };
  }
}

export default function AnalyticsDashboard() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  const { data: authData } = useQuery({
    ...authQueries.me(),
    staleTime: Infinity,
  });
  const currentMembership = authData?.memberships?.find(
    (m) => m.workspaceId === workspaceId,
  );
  const currentRole = currentMembership?.role;
  const canReport = canGenerateReports(currentRole);
  const canSeeClients = canViewClients(currentRole);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery(
    analyticsQueries.overview(workspaceId),
  );

  const { data: clientsData } = useQuery({
    ...clientQueries.list(workspaceId),
    enabled: !!workspaceId && canSeeClients,
  });
  const clients = clientsData?.clients || [];

  const [reportFrom, setReportFrom] = useState(() =>
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [reportTo, setReportTo] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [reportAccount, setReportAccount] = useState("");
  const [reportClient, setReportClient] = useState("");
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const handleDownloadReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportError(null);
    setIsDownloadingReport(true);
    try {
      await downloadClientReportPdf(
        workspaceId,
        reportFrom,
        reportTo,
        reportAccount || undefined,
        reportClient || undefined,
      );
    } catch (err) {
      setReportError(
        err instanceof Error
          ? err.message
          : "Failed to download client report.",
      );
    } finally {
      setIsDownloadingReport(false);
    }
  };

  const formatNumber = (num: number) =>
    new Intl.NumberFormat("en-US").format(num);

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(dateString));
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Analytics Overview
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Latest recorded daily snapshot metrics across your connected social
            accounts.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="self-start sm:self-auto inline-flex items-center px-3.5 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-60 transition-colors"
          aria-label="Refresh analytics data"
        >
          <RefreshCw
            className={`w-4 h-4 mr-2 text-gray-500 ${isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {isFetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-8" role="status" aria-label="Loading analytics">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-white border rounded-xl p-6 shadow-sm animate-pulse"
              >
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4"></div>
              </div>
            ))}
          </div>
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden animate-pulse">
            <div className="h-16 border-b bg-gray-50"></div>
            <div className="p-6 space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-lg"></div>
              ))}
            </div>
          </div>
          <span className="sr-only">Loading analytics...</span>
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 flex flex-col items-center text-center max-w-2xl mx-auto mt-12">
          <AlertCircle
            className="w-12 h-12 text-red-500 mb-4"
            aria-hidden="true"
          />
          {error instanceof ApiError && error.status === 403 ? (
            <>
              <h3 className="text-xl font-semibold text-red-900">
                Access Denied
              </h3>
              <p className="mt-2 text-red-700">
                You don&apos;t have permission to view analytics in this
                workspace.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-xl font-semibold text-red-900">
                Failed to load analytics
              </h3>
              <p className="mt-2 text-red-700 max-w-md">
                An error occurred while fetching your overview metrics. Please
                try again.
              </p>
              <button
                onClick={() => refetch()}
                className="mt-6 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
                aria-label="Retry loading analytics"
              >
                <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                Retry
              </button>
            </>
          )}
        </div>
      ) : data?.accountsConnected === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 flex flex-col items-center text-center max-w-2xl mx-auto mt-12">
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6">
            <BarChart3 className="w-10 h-10 text-gray-400" aria-hidden="true" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900">
            No data available
          </h3>
          <p className="mt-3 text-gray-500 max-w-md">
            Connect your social media accounts to start seeing followers,
            engagement, and performance metrics here.
          </p>
          <Link
            href={`/${workspaceId}/accounts`}
            className="mt-8 inline-flex items-center px-6 py-3 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            Go to Accounts
            <ChevronRight className="ml-2 w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div className="space-y-8 animate-in fade-in duration-500">
          {data && data.accountsRequiringReauth > 0 && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg flex items-start sm:items-center justify-between flex-col sm:flex-row gap-4">
              <div className="flex items-start sm:items-center">
                <AlertTriangle
                  className="h-5 w-5 text-yellow-500 mt-0.5 sm:mt-0 mr-3 flex-shrink-0"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-sm font-medium text-yellow-800">
                    {`Action Required: ${data.accountsRequiringReauth} account${
                      data.accountsRequiringReauth > 1 ? "s need" : " needs"
                    } reconnection`}
                  </h3>
                  <p className="mt-1 text-sm text-yellow-700">
                    Some accounts have lost their connection and are no longer
                    syncing data.
                  </p>
                </div>
              </div>
              <Link
                href={`/${workspaceId}/accounts`}
                className="whitespace-nowrap inline-flex items-center px-3 py-1.5 border border-yellow-400 text-xs font-medium rounded-md text-yellow-800 bg-yellow-100 hover:bg-yellow-200 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
              >
                Go to Accounts
              </Link>
            </div>
          )}

          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col">
              <div className="flex items-center text-sm font-medium text-gray-500 mb-4">
                <Users
                  className="w-5 h-5 mr-2 text-blue-500"
                  aria-hidden="true"
                />
                Total Followers
              </div>
              <div className="text-3xl font-bold text-gray-900">
                {formatNumber(data?.totalFollowers || 0)}
              </div>
            </div>

            <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col">
              <div className="flex items-center text-sm font-medium text-gray-500 mb-4">
                <Activity
                  className="w-5 h-5 mr-2 text-indigo-500"
                  aria-hidden="true"
                />
                Total Engagement
              </div>
              <div className="text-3xl font-bold text-gray-900">
                {formatNumber(data?.totalEngagement || 0)}
              </div>
            </div>

            <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col">
              <div className="flex items-center text-sm font-medium text-gray-500 mb-4">
                <LinkIcon
                  className="w-5 h-5 mr-2 text-emerald-500"
                  aria-hidden="true"
                />
                Connected Accounts
              </div>
              <div className="text-3xl font-bold text-gray-900">
                {formatNumber(data?.accountsConnected || 0)}
              </div>
            </div>

            <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col">
              <div className="flex items-center text-sm font-medium text-gray-500 mb-4">
                <CheckCircle2
                  className="w-5 h-5 mr-2 text-green-500"
                  aria-hidden="true"
                />
                Active Accounts
              </div>
              <div className="text-3xl font-bold text-gray-900">
                {formatNumber(data?.accountsActive || 0)}
              </div>
            </div>
          </div>

          {/* Client Report Card */}
          {canReport && (
            <div
              className="bg-white rounded-xl border shadow-sm p-6"
              data-testid="client-report-card"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
                    <FileText className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      Client Performance Report
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Generate and download a branded PDF performance report for
                      a selected date range.
                    </p>
                  </div>
                </div>
              </div>

              {reportError && (
                <div
                  className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2 text-sm text-red-700"
                  role="alert"
                >
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span>{reportError}</span>
                </div>
              )}

              <form
                onSubmit={handleDownloadReport}
                className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end"
              >
                <div>
                  <label
                    htmlFor="reportFrom"
                    className="block text-xs font-medium text-gray-700 mb-1"
                  >
                    From Date
                  </label>
                  <input
                    id="reportFrom"
                    type="date"
                    value={reportFrom}
                    onChange={(e) => setReportFrom(e.target.value)}
                    required
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="reportTo"
                    className="block text-xs font-medium text-gray-700 mb-1"
                  >
                    To Date
                  </label>
                  <input
                    id="reportTo"
                    type="date"
                    value={reportTo}
                    onChange={(e) => setReportTo(e.target.value)}
                    required
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {canSeeClients && clients.length > 0 && (
                  <div>
                    <label
                      htmlFor="reportClient"
                      className="block text-xs font-medium text-gray-700 mb-1"
                    >
                      Client Filter
                    </label>
                    <select
                      id="reportClient"
                      aria-label="Client Filter"
                      value={reportClient}
                      disabled={!!reportAccount}
                      onChange={(e) => {
                        setReportClient(e.target.value);
                        if (e.target.value) {
                          setReportAccount("");
                        }
                      }}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white disabled:opacity-50 disabled:bg-gray-100"
                    >
                      <option value="">All clients</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="reportAccount"
                    className="block text-xs font-medium text-gray-700 mb-1"
                  >
                    Account Filter
                  </label>
                  <select
                    id="reportAccount"
                    aria-label="Account Filter"
                    value={reportAccount}
                    disabled={!!reportClient}
                    onChange={(e) => {
                      setReportAccount(e.target.value);
                      if (e.target.value) {
                        setReportClient("");
                      }
                    }}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white disabled:opacity-50 disabled:bg-gray-100"
                  >
                    <option value="">All accounts</option>
                    {data?.accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name || "Unnamed"} ({acc.provider})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <button
                    type="submit"
                    disabled={isDownloadingReport}
                    className="w-full inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                  >
                    <Download
                      className={`w-4 h-4 mr-2 ${isDownloadingReport ? "animate-bounce" : ""}`}
                      aria-hidden="true"
                    />
                    {isDownloadingReport ? "Generating..." : "Download PDF"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Accounts Breakdown */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b bg-gray-50/50 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Account Performance
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Latest recorded performance per connected social profile.
                </p>
              </div>
            </div>

            <div className="divide-y divide-gray-100">
              {data?.accounts.map((account) => {
                const providerInfo = getProviderBadge(account.provider);
                const statusInfo = getStatusBadge(account.status);

                return (
                  <div
                    key={account.id}
                    className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 transition-colors hover:bg-gray-50/50"
                  >
                    <div className="flex items-center gap-4 min-w-[240px]">
                      <div
                        className={`p-3 rounded-full flex-shrink-0 ${providerInfo.containerClass}`}
                      >
                        {providerInfo.icon}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 truncate max-w-[200px]">
                          {account.name || "Unnamed Account"}
                        </h3>
                        <div className="flex items-center mt-1 space-x-2 text-xs">
                          <span className="text-gray-500">
                            {providerInfo.label}
                          </span>
                          <span className="text-gray-300" aria-hidden="true">
                            &bull;
                          </span>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border ${statusInfo.className}`}
                          >
                            {statusInfo.label}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-8 items-center border-t md:border-t-0 pt-4 md:pt-0 border-gray-100">
                      {account.latestMetrics ? (
                        <>
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                              Followers
                            </span>
                            <span className="text-lg font-semibold text-gray-900">
                              {formatNumber(account.latestMetrics.followers)}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                              Engagement
                            </span>
                            <span className="text-lg font-semibold text-gray-900">
                              {formatNumber(account.latestMetrics.engagement)}
                            </span>
                          </div>
                          <div className="flex flex-col col-span-2 md:col-span-1">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                              Last Updated
                            </span>
                            <span className="text-sm text-gray-700">
                              {formatDate(account.latestMetrics.date)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="col-span-2 md:col-span-3 py-2 px-4 bg-gray-50 rounded-lg text-sm text-gray-500 border border-gray-100 flex items-center justify-center">
                          No analytics data yet
                        </div>
                      )}
                    </div>

                    <div className="flex items-center ml-2 sm:ml-4">
                      <Link
                        href={`/${workspaceId}/analytics/${account.id}`}
                        className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
                        aria-label={`View details for ${account.name || "Unnamed Account"}`}
                      >
                        <ChevronRight className="w-5 h-5" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
