"use client";

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { oauthQueries, selectOAuthDiscoveryProfiles } from '../../../../lib/query/oauth';
import { Button } from '../../../../components/ui/button';

export default function DiscoveryClientPage({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const discoveryId = searchParams.get('id');

  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false);

  const { data: session, isLoading, error } = useQuery({
    ...(discoveryId ? oauthQueries.discovery(workspaceId, discoveryId) : { queryKey: ['_skip'] }),
    enabled: !!discoveryId,
  });

  if (session?.profiles && !hasInitializedSelection) {
    // Default to selecting all profiles
    setSelectedProfiles(new Set(session.profiles.map((p) => p.id)));
    setHasInitializedSelection(true);
  }

  const selectMutation = useMutation({
    mutationFn: (profileIds: string[]) => {
      if (!discoveryId) throw new Error('No discovery ID');
      return selectOAuthDiscoveryProfiles(workspaceId, discoveryId, profileIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'accounts'] });
      router.push('/' + workspaceId + '/accounts');
    },
  });

  if (!discoveryId) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-white border rounded-lg shadow-sm p-6 text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid Request</h2>
          <p className="text-gray-500 mb-6">Missing connection session ID.</p>
          <Button onClick={() => router.push('/' + workspaceId + '/accounts')}>
            Return to Accounts
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p role="status">Loading discovered accounts...</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-white border rounded-lg shadow-sm p-6 text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Session Expired</h2>
          <p className="text-red-600 mb-6" role="alert">
            Your connection session expired or is invalid. Please connect the account again.
          </p>
          <Button onClick={() => router.push('/' + workspaceId + '/accounts')}>
            Return to Accounts
          </Button>
        </div>
      </div>
    );
  }

  const toggleSelection = (id: string) => {
    const next = new Set(selectedProfiles);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedProfiles(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedProfiles.size === 0 || selectMutation.isPending) return;
    selectMutation.mutate(Array.from(selectedProfiles));
  };

  const formatProviderType = (provider?: string) => {
    if (!provider) return 'Social account';
    if (provider === 'META' || provider === 'FACEBOOK') return 'Facebook Page';
    if (provider === 'INSTAGRAM') return 'Instagram Professional';
    if (provider === 'LINKEDIN') return 'LinkedIn';
    if (provider === 'YOUTUBE') return 'YouTube';
    return 'Social account';
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Discovered Accounts</h1>
        <p className="text-gray-500 mt-2">
          We found multiple accounts. Select the ones you want to connect to your workspace.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border rounded-lg shadow-sm overflow-hidden">
        <div className="divide-y">
          {session.profiles.map((profile) => (
            <label
              key={profile.id}
              className="flex items-center p-5 hover:bg-gray-50 cursor-pointer transition-colors focus-within:bg-gray-50"
            >
              <div className="flex-shrink-0 mr-4">
                <input
                  type="checkbox"
                  className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                  checked={selectedProfiles.has(profile.id)}
                  onChange={() => toggleSelection(profile.id)}
                  disabled={selectMutation.isPending}
                  aria-label={'Select ' + (profile.name || 'account')}
                />
              </div>

              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt=""
                  className="w-12 h-12 rounded-full object-cover border bg-gray-100 mr-4"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mr-4">
                  <span className="text-gray-400 font-medium">
                    {(profile.name || '?').charAt(0).toUpperCase()}
                  </span>
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {profile.name || 'Unnamed Account'}
                </p>
                <p className="text-sm text-gray-500 truncate">
                  {formatProviderType(profile.provider || session.provider)}
                </p>
              </div>
            </label>
          ))}
        </div>

        <div className="p-5 bg-gray-50 border-t flex items-center justify-between">
          <div className="text-sm text-gray-600">
            <strong>{selectedProfiles.size} of {session.profiles.length} selected</strong>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push('/' + workspaceId + '/accounts')}
              disabled={selectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={selectedProfiles.size === 0 || selectMutation.isPending}
            >
              {selectMutation.isPending ? 'Connecting...' : 'Connect Accounts'}
            </Button>
          </div>
        </div>
      </form>

      {selectMutation.isError && (
        <div className="mt-4 p-4 text-sm text-red-700 bg-red-50 rounded-lg border border-red-200" role="alert">
          Failed to connect selected accounts. The session may have expired or been consumed.
        </div>
      )}
    </div>
  );
}
