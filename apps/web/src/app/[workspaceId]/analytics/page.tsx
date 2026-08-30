'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { analyticsQueries } from '../../../lib/query/analytics';
import { ApiError } from '../../../lib/api/client';
import { AlertCircle, RefreshCw, BarChart3, Users, Link as LinkIcon, Activity, PlaySquare, HelpCircle, CheckCircle2, ChevronRight, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export default function AnalyticsDashboard() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  const {
    data,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery(analyticsQueries.overview(workspaceId));

  const formatNumber = (num: number) => new Intl.NumberFormat('en-US').format(num);

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(dateString));
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics Overview</h1>
        <p className="mt-2 text-sm text-gray-600">
          High-level metrics for your connected social accounts.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-8" role="status" aria-label="Loading analytics">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white border rounded-xl p-6 shadow-sm animate-pulse">
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
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" aria-hidden="true" />
          {error instanceof ApiError && error.status === 403 ? (
            <>
              <h3 className="text-xl font-semibold text-red-900">Access Denied</h3>
              <p className="mt-2 text-red-700">
                You don&apos;t have permission to view analytics in this workspace.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-xl font-semibold text-red-900">Failed to load analytics</h3>
              <p className="mt-2 text-red-700 max-w-md">
                An error occurred while fetching your overview metrics. Please try again.
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
          <h3 className="text-xl font-semibold text-gray-900">No data available</h3>
          <p className="mt-3 text-gray-500 max-w-md">
            Connect your social media accounts to start seeing followers, engagement, and performance metrics here.
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
                <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5 sm:mt-0 mr-3 flex-shrink-0" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-medium text-yellow-800">
                    Action Required: {data.accountsRequiringReauth} account{data.accountsRequiringReauth > 1 ? 's' : ''} need reconnection
                  </h3>
                  <p className="mt-1 text-sm text-yellow-700">
                    Some accounts have lost their connection and are no longer syncing data.
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
                <Users className="w-5 h-5 mr-2 text-blue-500" aria-hidden="true" />
                Total Followers
              </div>
              <div className="text-3xl font-bold text-gray-900">{formatNumber(data?.totalFollowers || 0)}</div>
            </div>

            <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col">
              <div className="flex items-center text-sm font-medium text-gray-500 mb-4">
                <Activity className="w-5 h-5 mr-2 text-indigo-500" aria-hidden="true" />
                Total Engagement
              </div>
              <div className="text-3xl font-bold text-gray-900">{formatNumber(data?.totalEngagement || 0)}</div>
            </div>

            <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col">
              <div className="flex items-center text-sm font-medium text-gray-500 mb-4">
                <LinkIcon className="w-5 h-5 mr-2 text-emerald-500" aria-hidden="true" />
                Connected Accounts
              </div>
              <div className="text-3xl font-bold text-gray-900">{formatNumber(data?.accountsConnected || 0)}</div>
            </div>

            <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col">
              <div className="flex items-center text-sm font-medium text-gray-500 mb-4">
                <CheckCircle2 className="w-5 h-5 mr-2 text-green-500" aria-hidden="true" />
                Active Accounts
              </div>
              <div className="text-3xl font-bold text-gray-900">{formatNumber(data?.accountsActive || 0)}</div>
            </div>
          </div>

          {/* Accounts Breakdown */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b bg-gray-50/50">
              <h2 className="text-lg font-semibold text-gray-900">Account Performance</h2>
            </div>
            
            <div className="divide-y divide-gray-100">
              {data?.accounts.map((account) => {
                const isYoutube = account.provider === 'YOUTUBE';
                const isActive = account.status === 'ACTIVE';
                
                return (
                  <div key={account.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 transition-colors hover:bg-gray-50/50">
                    <div className="flex items-center gap-4 min-w-[240px]">
                      <div className={`p-3 rounded-full flex-shrink-0 ${isYoutube ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                        {isYoutube ? <PlaySquare className="w-6 h-6" aria-hidden="true" /> : <HelpCircle className="w-6 h-6" aria-hidden="true" />}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 truncate max-w-[200px]">{account.name || 'Unnamed Account'}</h3>
                        <div className="flex items-center mt-1 space-x-2 text-xs">
                          <span className="text-gray-500 capitalize">{account.provider.toLowerCase()}</span>
                          <span className="text-gray-300">&bull;</span>
                          <span className={isActive ? 'text-green-600 font-medium' : 'text-yellow-600 font-medium'}>
                            {account.status}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-8 items-center border-t md:border-t-0 pt-4 md:pt-0 border-gray-100">
                      {account.latestMetrics ? (
                        <>
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Followers</span>
                            <span className="text-lg font-semibold text-gray-900">{formatNumber(account.latestMetrics.followers)}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Engagement</span>
                            <span className="text-lg font-semibold text-gray-900">{formatNumber(account.latestMetrics.engagement)}</span>
                          </div>
                          <div className="flex flex-col col-span-2 md:col-span-1">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Last Updated</span>
                            <span className="text-sm text-gray-700">{formatDate(account.latestMetrics.date)}</span>
                          </div>
                        </>
                      ) : (
                        <div className="col-span-2 md:col-span-3 py-2 px-4 bg-gray-50 rounded-lg text-sm text-gray-500 border border-gray-100 flex items-center justify-center">
                          No analytics data yet
                        </div>
                      )}
                    </div>

                    <div className="hidden md:flex ml-4">
                      <Link
                        href={`/${workspaceId}/analytics/${account.id}`}
                        className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
                        aria-label={`View details for ${account.name || 'Unnamed Account'}`}
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
