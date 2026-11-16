'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authQueries, SessionInfo } from '../../../lib/query/auth';
import { api } from '../../../lib/api/client';
import { Laptop, Smartphone, Globe, Shield, AlertCircle } from 'lucide-react';

function getDeviceTitle(browser: string, os: string): string {
  if (browser === 'Unknown browser' && os === 'Unknown OS') {
    return 'Unknown device';
  }
  return `${browser} on ${os}`;
}

function getDeviceIcon(os: string) {
  if (os === 'iOS' || os === 'Android') {
    return <Smartphone className="w-5 h-5 text-gray-500" aria-hidden="true" />;
  }
  if (os === 'Windows' || os === 'macOS' || os === 'Linux') {
    return <Laptop className="w-5 h-5 text-gray-500" aria-hidden="true" />;
  }
  return <Globe className="w-5 h-5 text-gray-500" aria-hidden="true" />;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery(authQueries.sessions());

  const revokeMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      setRevokingId(sessionId);
      setRevokeError(null);
      await api.delete(`auth/sessions/${sessionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Failed to revoke session.';
      setRevokeError(message);
    },
    onSettled: () => {
      setRevokingId(null);
    },
  });

  const sessions: SessionInfo[] = data?.sessions || [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Account Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your account preferences and active sessions.
        </p>
      </div>

      {/* Active Sessions Card */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Shield className="w-5 h-5 text-blue-600" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Active Sessions</h2>
              <p className="text-sm text-gray-500">
                Devices and browsers currently signed into your account.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {revokeError && (
            <div
              className="p-3 bg-red-50 border border-red-200 rounded-md flex items-center space-x-2 text-sm text-red-700"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span>{revokeError}</span>
            </div>
          )}

          {isLoading && (
            <div className="space-y-3 py-4" role="status" aria-label="Loading sessions">
              <div className="animate-pulse flex items-center justify-between p-3 bg-gray-50 rounded-md">
                <div className="flex items-center space-x-3">
                  <div className="rounded-full bg-gray-200 h-8 w-8" />
                  <div className="space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-36" />
                    <div className="h-3 bg-gray-200 rounded w-24" />
                  </div>
                </div>
                <div className="h-8 bg-gray-200 rounded w-16" />
              </div>
            </div>
          )}

          {isError && (
            <div
              className="p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex items-center justify-between"
              role="alert"
            >
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span>Failed to load sessions.</span>
              </div>
              <button
                type="button"
                onClick={() => refetch()}
                className="text-xs font-semibold text-red-800 underline hover:text-red-900"
              >
                Retry
              </button>
            </div>
          )}

          {!isLoading && !isError && sessions.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">
              No active sessions found.
            </p>
          )}

          {!isLoading && !isError && sessions.length > 0 && (
            <ul className="divide-y divide-gray-100" role="list">
              {sessions.map((session) => {
                const title = getDeviceTitle(session.browser, session.os);
                const isRevoking = revokingId === session.sessionId;

                return (
                  <li
                    key={session.sessionId}
                    className="py-4 flex items-center justify-between first:pt-0 last:pb-0"
                    data-testid={`session-row-${session.sessionId}`}
                  >
                    <div className="flex items-start space-x-3">
                      <div className="p-2 bg-gray-100 rounded-md mt-0.5">
                        {getDeviceIcon(session.os)}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-gray-900">
                            {title}
                          </span>
                          {session.isCurrent && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              This device
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-1 space-x-2">
                          <span>{session.ipAddress || 'Unknown IP'}</span>
                          <span>•</span>
                          <span>Signed in {new Date(session.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    {!session.isCurrent && (
                      <button
                        type="button"
                        onClick={() => revokeMutation.mutate(session.sessionId)}
                        disabled={isRevoking}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500"
                        aria-label={`Revoke session on ${title}`}
                      >
                        {isRevoking ? 'Revoking...' : 'Revoke'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
