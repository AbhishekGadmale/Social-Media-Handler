'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { analyticsQueries } from '../../../../lib/query/analytics';
import { ApiError } from '../../../../lib/api/client';
import { AlertCircle, ArrowLeft, PlaySquare, HelpCircle, CheckCircle2, AlertTriangle, RefreshCw, BarChart3, Users, Activity } from 'lucide-react';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function AccountAnalyticsPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;
  const accountId = params.accountId as string;

  const {
    data,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery(analyticsQueries.account(workspaceId, accountId));

  const formatNumber = (num: number) => new Intl.NumberFormat('en-US').format(num);

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric'
    }).format(new Date(dateString));
  };

  const isYoutube = data?.account?.provider === 'YOUTUBE';
  const isActive = data?.account?.status === 'ACTIVE';
  const isReauthRequired = data?.account?.status === 'REAUTH_REQUIRED';

  const metrics = data?.metrics || [];
  const latestMetric = metrics.length > 0 ? metrics[metrics.length - 1] : null;

  // Format data for Recharts
  const chartData = metrics.map(m => ({
    ...m,
    formattedDate: formatDate(m.date),
  }));

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[50vh]">
        <AlertCircle className="w-16 h-16 text-gray-400 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900">Account Not Found</h2>
        <p className="mt-2 text-gray-600">The account you are looking for does not exist in this workspace.</p>
        <button
          onClick={() => router.back()}
          className="mt-6 inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Navigation & Header */}
      <div>
        <Link
          href={`/${workspaceId}/analytics`}
          className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          Back to Overview
        </Link>
        
        {isLoading ? (
          <div className="flex items-center gap-4 animate-pulse">
            <div className="w-16 h-16 bg-gray-200 rounded-full" />
            <div className="space-y-2">
              <div className="h-8 w-48 bg-gray-200 rounded" />
              <div className="h-4 w-24 bg-gray-200 rounded" />
            </div>
          </div>
        ) : data?.account ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-4 rounded-full flex-shrink-0 ${isYoutube ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                {isYoutube ? <PlaySquare className="w-8 h-8" aria-hidden="true" /> : <HelpCircle className="w-8 h-8" aria-hidden="true" />}
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{data.account.name || 'Unnamed Account'}</h1>
                <div className="flex items-center mt-2 space-x-3 text-sm">
                  <span className="text-gray-600 font-medium capitalize">{data.account.provider.toLowerCase()}</span>
                  <span className="text-gray-300">&bull;</span>
                  {isActive ? (
                    <span className="inline-flex items-center text-green-700 font-medium">
                      <CheckCircle2 className="w-4 h-4 mr-1.5" aria-hidden="true" />
                      Active
                    </span>
                  ) : isReauthRequired ? (
                    <span className="inline-flex items-center text-yellow-700 font-medium">
                      <AlertTriangle className="w-4 h-4 mr-1.5" aria-hidden="true" />
                      Reconnection Required
                    </span>
                  ) : (
                    <span className="text-gray-500 font-medium">{data.account.status}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {isError && !(error instanceof ApiError && error.status === 404) ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 flex flex-col items-center text-center max-w-2xl mx-auto mt-12">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" aria-hidden="true" />
          {error instanceof ApiError && error.status === 403 ? (
            <>
              <h3 className="text-xl font-semibold text-red-900">Access Denied</h3>
              <p className="mt-2 text-red-700">
                You don&apos;t have permission to view analytics for this account.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-xl font-semibold text-red-900">Failed to load analytics</h3>
              <p className="mt-2 text-red-700 max-w-md">
                An error occurred while fetching historical data. Please try again.
              </p>
              <button
                onClick={() => refetch()}
                className="mt-6 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
              >
                <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                Retry
              </button>
            </>
          )}
        </div>
      ) : isLoading ? (
        <div className="space-y-6" role="status">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2].map(i => (
              <div key={i} className="bg-white border rounded-xl p-6 shadow-sm animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
                <div className="h-10 bg-gray-200 rounded w-1/2" />
              </div>
            ))}
          </div>
          <div className="bg-white border rounded-xl p-6 shadow-sm h-[400px] animate-pulse flex flex-col">
            <div className="h-6 bg-gray-200 rounded w-1/4 mb-6" />
            <div className="flex-1 bg-gray-100 rounded-lg" />
          </div>
        </div>
      ) : data ? (
        <>
          {isReauthRequired && (
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 sm:mt-0 mr-3 flex-shrink-0" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-medium text-yellow-800">Connection Lost</h3>
                  <p className="mt-1 text-sm text-yellow-700">
                    We can no longer fetch new analytics for this account. Please reconnect to resume data collection.
                  </p>
                </div>
              </div>
              <Link
                href={`/${workspaceId}/accounts`}
                className="whitespace-nowrap inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-yellow-600 hover:bg-yellow-700 transition-colors"
              >
                Reconnect in Accounts
              </Link>
            </div>
          )}

          {/* Latest Metrics Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col">
              <div className="flex items-center text-sm font-medium text-gray-500 mb-4">
                <Users className="w-5 h-5 mr-2 text-blue-500" aria-hidden="true" />
                Current Followers
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold text-gray-900">
                  {latestMetric ? formatNumber(latestMetric.followers) : '--'}
                </span>
              </div>
              {latestMetric && (
                <div className="mt-4 text-xs text-gray-500">
                  As of {formatDate(latestMetric.date)}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col">
              <div className="flex items-center text-sm font-medium text-gray-500 mb-4">
                <Activity className="w-5 h-5 mr-2 text-indigo-500" aria-hidden="true" />
                Current Engagement
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold text-gray-900">
                  {latestMetric ? formatNumber(latestMetric.engagement) : '--'}
                </span>
              </div>
              {latestMetric && (
                <div className="mt-4 text-xs text-gray-500">
                  As of {formatDate(latestMetric.date)}
                </div>
              )}
            </div>
          </div>

          {/* Historical Chart */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Performance History</h2>
                <p className="text-sm text-gray-500 mt-1">Followers and engagement over the last 30 days</p>
              </div>
            </div>

            {chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[300px] bg-gray-50 rounded-lg border border-dashed border-gray-200">
                <BarChart3 className="w-12 h-12 text-gray-300 mb-3" />
                <p className="text-gray-500 font-medium">No historical data available yet</p>
                <p className="text-gray-400 text-sm mt-1">Data will appear here once successfully synced.</p>
              </div>
            ) : chartData.length === 1 ? (
              <div className="flex flex-col items-center justify-center h-[300px] bg-gray-50 rounded-lg border border-dashed border-gray-200">
                <Activity className="w-12 h-12 text-indigo-300 mb-3" />
                <p className="text-gray-600 font-medium">Not enough data to chart</p>
                <p className="text-gray-500 text-sm mt-1 text-center max-w-sm">
                  We have successfully recorded your first data point on {chartData[0].formattedDate}.<br />
                  A chart will appear once more data is collected.
                </p>
              </div>
            ) : (
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis 
                      dataKey="formattedDate" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#6B7280', fontSize: 12 }}
                      dy={10}
                    />
                    <YAxis 
                      yAxisId="left"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#6B7280', fontSize: 12 }}
                      tickFormatter={(value) => 
                        value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : value
                      }
                      dx={-10}
                    />
                    <YAxis 
                      yAxisId="right"
                      orientation="right"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#6B7280', fontSize: 12 }}
                      tickFormatter={(value) => 
                        value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : value
                      }
                      dx={10}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid #E5E7EB', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                      labelStyle={{ fontWeight: 'bold', color: '#111827', marginBottom: '4px' }}
                    />
                    <Legend wrapperStyle={{ paddingTop: '20px' }} />
                    <Line 
                      yAxisId="left"
                      type="monotone" 
                      dataKey="followers" 
                      name="Followers"
                      stroke="#3B82F6" 
                      strokeWidth={3}
                      dot={{ r: 4, strokeWidth: 2 }}
                      activeDot={{ r: 6, strokeWidth: 0 }}
                    />
                    <Line 
                      yAxisId="right"
                      type="monotone" 
                      dataKey="engagement" 
                      name="Engagement"
                      stroke="#6366F1" 
                      strokeWidth={3}
                      dot={{ r: 4, strokeWidth: 2 }}
                      activeDot={{ r: 6, strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
