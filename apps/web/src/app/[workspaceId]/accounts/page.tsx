
'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { accountQueries } from '../../../lib/query/accounts';
import { AccountCard } from '../../../components/account-card';
import { ApiError, api } from '../../../lib/api/client';
import { AlertCircle, RefreshCw, Link as LinkIcon, Plus } from 'lucide-react';
import { Button } from '../../../components/ui/button';

export default function AccountsPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  const [isConnectingYt, setIsConnectingYt] = useState(false);
  const [isConnectingLi, setIsConnectingLi] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery(accountQueries.list(workspaceId));

  const accounts = data?.accounts || [];
  const hasYoutube = accounts.some(a => a.provider === 'YOUTUBE');
  const hasLinkedin = accounts.some(a => a.provider === 'LINKEDIN');

  const handleConnectYoutube = async () => {
    try {
      setIsConnectingYt(true);
      setConnectError(null);
      const res = await api.post<{ url: string }>(`workspaces/${workspaceId}/oauth/youtube/connect`);
      if (res.url) {
        window.location.href = res.url;
      } else {
        throw new Error('No authorization URL returned');
      }
    } catch {
      setConnectError('Failed to initiate YouTube connection. Please try again.');
      setIsConnectingYt(false);
    }
  };

  const handleConnectLinkedin = async () => {
    try {
      setIsConnectingLi(true);
      setConnectError(null);
      const res = await api.post<{ url: string }>(`workspaces/${workspaceId}/oauth/linkedin/connect?scopes=w_member_social`);
      if (res.url) {
        window.location.href = res.url;
      } else {
        throw new Error('No authorization URL returned');
      }
    } catch {
      setConnectError('Failed to initiate LinkedIn connection. Please try again.');
      setIsConnectingLi(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Connected Accounts</h1>
          <p className="mt-2 text-sm text-gray-600">
            Manage social media accounts connected to this workspace.
          </p>
        </div>
        
        {!isLoading && !isError && accounts.length > 0 && (
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              {!hasYoutube && (
                <Button onClick={handleConnectYoutube} disabled={isConnectingYt || isConnectingLi}>
                  {isConnectingYt ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                  )}
                  Connect YouTube
                </Button>
              )}
              {!hasLinkedin && (
                <Button onClick={handleConnectLinkedin} disabled={isConnectingYt || isConnectingLi}>
                  {isConnectingLi ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                  )}
                  Connect LinkedIn
                </Button>
              )}
            </div>
            {connectError && <p className="text-xs text-red-600">{connectError}</p>}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4" role="status" aria-label="Loading accounts">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white border rounded-lg shadow-sm p-5 animate-pulse flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gray-200 rounded-full flex-shrink-0" />
                <div className="space-y-2">
                  <div className="h-5 w-32 bg-gray-200 rounded" />
                  <div className="h-4 w-20 bg-gray-200 rounded" />
                </div>
              </div>
              <div className="h-6 w-24 bg-gray-200 rounded-full" />
            </div>
          ))}
          <span className="sr-only">Loading accounts...</span>
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex flex-col items-center text-center">
          <AlertCircle className="w-10 h-10 text-red-500 mb-3" aria-hidden="true" />
          {error instanceof ApiError && error.status === 403 ? (
            <>
              <h3 className="text-lg font-medium text-red-800">Access Denied</h3>
              <p className="mt-2 text-sm text-red-700">
                You don&apos;t have permission to view connected accounts in this workspace.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-medium text-red-800">Failed to load accounts</h3>
              <p className="mt-2 text-sm text-red-700 max-w-md">
                An error occurred while fetching connected accounts. Please try again.
              </p>
              <button
                onClick={() => refetch()}
                className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
                aria-label="Retry loading accounts"
              >
                <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                Retry
              </button>
            </>
          )}
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-12 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <LinkIcon className="w-8 h-8 text-gray-400" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No connected accounts</h3>
          <p className="mt-2 text-sm text-gray-500 max-w-sm">
            You haven&apos;t connected any social media accounts to this workspace yet.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <div className="flex gap-2">
              <Button onClick={handleConnectYoutube} disabled={isConnectingYt || isConnectingLi}>
                {isConnectingYt ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                )}
                Connect YouTube
              </Button>
              <Button onClick={handleConnectLinkedin} disabled={isConnectingYt || isConnectingLi}>
                {isConnectingLi ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                )}
                Connect LinkedIn
              </Button>
            </div>
            {connectError && <p className="text-xs text-red-600">{connectError}</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-4" aria-label="List of connected accounts">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </div>
      )}
    </div>
  );
}
