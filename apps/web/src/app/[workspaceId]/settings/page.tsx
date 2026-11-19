'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authQueries, SessionInfo } from '../../../lib/query/auth';
import {
  reportsQueries,
  UpdateBrandingPayload,
  WorkspaceBranding,
} from '../../../lib/query/reports';
import { api } from '../../../lib/api/client';
import {
  Laptop,
  Smartphone,
  Globe,
  Shield,
  AlertCircle,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Palette,
} from 'lucide-react';

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
  const params = useParams();
  const workspaceId = (params?.workspaceId as string) || '';

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // Change Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordWarning, setPasswordWarning] = useState<string | null>(null);

  // Branding state (null means inherit from query)
  const [customDisplayName, setCustomDisplayName] = useState<string | null>(null);
  const [customLogoUrl, setCustomLogoUrl] = useState<string | null>(null);
  const [customAccentColor, setCustomAccentColor] = useState<string | null>(null);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSuccess, setBrandingSuccess] = useState<string | null>(null);

  const brandingQuery = useQuery(reportsQueries.branding(workspaceId));

  const brandDisplayName =
    customDisplayName !== null
      ? customDisplayName
      : brandingQuery.data?.brandDisplayName || '';
  const brandLogoUrl =
    customLogoUrl !== null
      ? customLogoUrl
      : brandingQuery.data?.brandLogoUrl || '';
  const brandAccentColor =
    customAccentColor !== null
      ? customAccentColor
      : brandingQuery.data?.brandAccentColor || '#111827';

  const saveBrandingMutation = useMutation({
    mutationFn: async (payload: UpdateBrandingPayload) => {
      return await api.put<WorkspaceBranding>(
        `workspaces/${workspaceId}/reports/branding`,
        payload
      );
    },
    onSuccess: (data) => {
      setBrandingSuccess('Branding updated successfully.');
      setCustomDisplayName(null);
      setCustomLogoUrl(null);
      setCustomAccentColor(null);
      queryClient.setQueryData(
        ['workspaces', workspaceId, 'reports', 'branding'],
        data
      );
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Failed to update branding.';
      setBrandingError(message);
    },
  });

  const handleSaveBranding = (e: React.FormEvent) => {
    e.preventDefault();
    setBrandingError(null);
    setBrandingSuccess(null);

    // Client-side validations
    if (brandLogoUrl.trim()) {
      try {
        const u = new URL(brandLogoUrl.trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          setBrandingError('Logo URL must be a valid http or https URL.');
          return;
        }
      } catch {
        setBrandingError('Logo URL must be a valid http or https URL.');
        return;
      }
    }

    if (
      brandAccentColor.trim() &&
      !/^#[0-9A-Fa-f]{6}$/.test(brandAccentColor.trim())
    ) {
      setBrandingError(
        'Accent color must be a valid 6-character hex color code (e.g. #111827).'
      );
      return;
    }

    saveBrandingMutation.mutate({
      brandDisplayName: brandDisplayName.trim(),
      brandLogoUrl: brandLogoUrl.trim(),
      brandAccentColor: brandAccentColor.trim(),
    });
  };

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

  const changePasswordMutation = useMutation({
    mutationFn: async (payload: { currentPassword: string; newPassword: string }) => {
      return await api.post<{ message: string; sessionCleanupDeferred?: boolean }>(
        'auth/change-password',
        payload
      );
    },
    onSuccess: (res) => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      if (res?.sessionCleanupDeferred) {
        setPasswordWarning(res.message);
      } else {
        setPasswordSuccess(res?.message || 'Password changed successfully');
      }
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Failed to change password.';
      setPasswordError(message);
    },
  });

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    setPasswordWarning(null);

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setPasswordError('All fields are required.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long');
      return;
    }
    if (newPassword.length > 128) {
      setPasswordError('New password must not exceed 128 characters');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

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

      {/* Change Password Card */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Lock className="w-5 h-5 text-blue-600" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Change Password</h2>
              <p className="text-sm text-gray-500">
                Change your password to keep your account secure. You will stay signed in on this device; all other devices will be signed out.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {passwordError && (
            <div
              className="p-3 bg-red-50 border border-red-200 rounded-md flex items-center space-x-2 text-sm text-red-700"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span>{passwordError}</span>
            </div>
          )}

          {passwordSuccess && (
            <div
              className="p-3 bg-green-50 border border-green-200 rounded-md flex items-center space-x-2 text-sm text-green-700"
              role="status"
            >
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span>{passwordSuccess}</span>
            </div>
          )}

          {passwordWarning && (
            <div
              className="p-3 bg-amber-50 border border-amber-200 rounded-md flex items-center space-x-2 text-sm text-amber-800"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>{passwordWarning}</span>
            </div>
          )}

          <form onSubmit={handleChangePassword} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="currentPassword"
                className="block text-sm font-medium text-gray-700"
              >
                Current password
              </label>
              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={changePasswordMutation.isPending}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm disabled:opacity-50 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label
                htmlFor="newPassword"
                className="block text-sm font-medium text-gray-700"
              >
                New password
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={changePasswordMutation.isPending}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm disabled:opacity-50 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">
                At least 8 characters, with uppercase, lowercase, a number, and a special character.
              </p>
            </div>

            <div>
              <label
                htmlFor="confirmNewPassword"
                className="block text-sm font-medium text-gray-700"
              >
                Confirm new password
              </label>
              <input
                id="confirmNewPassword"
                name="confirmNewPassword"
                type="password"
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                disabled={changePasswordMutation.isPending}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm disabled:opacity-50 disabled:bg-gray-50"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={changePasswordMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Branding Card */}
      <div
        className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
        data-testid="branding-card"
      >
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Palette className="w-5 h-5 text-blue-600" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Workspace Branding</h2>
              <p className="text-sm text-gray-500">
                Customize agency branding for client-facing performance reports.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {brandingError && (
            <div
              className="p-3 bg-red-50 border border-red-200 rounded-md flex items-center space-x-2 text-sm text-red-700"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span>{brandingError}</span>
            </div>
          )}

          {brandingSuccess && (
            <div
              className="p-3 bg-green-50 border border-green-200 rounded-md flex items-center space-x-2 text-sm text-green-700"
              role="status"
            >
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span>{brandingSuccess}</span>
            </div>
          )}

          <form onSubmit={handleSaveBranding} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="brandDisplayName"
                className="block text-sm font-medium text-gray-700"
              >
                Brand Display Name
              </label>
              <input
                id="brandDisplayName"
                name="brandDisplayName"
                type="text"
                maxLength={120}
                placeholder="e.g. Acme Marketing Agency"
                value={brandDisplayName}
                onChange={(e) => setCustomDisplayName(e.target.value)}
                disabled={saveBrandingMutation.isPending || brandingQuery.isLoading}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm disabled:opacity-50 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">
                Name displayed prominently on client PDF reports. Leave blank to use workspace name.
              </p>
            </div>

            <div>
              <label
                htmlFor="brandLogoUrl"
                className="block text-sm font-medium text-gray-700"
              >
                Brand Logo URL
              </label>
              <input
                id="brandLogoUrl"
                name="brandLogoUrl"
                type="url"
                maxLength={2048}
                placeholder="https://example.com/logo.png"
                value={brandLogoUrl}
                onChange={(e) => setCustomLogoUrl(e.target.value)}
                disabled={saveBrandingMutation.isPending || brandingQuery.isLoading}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm disabled:opacity-50 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">
                Direct URL to a PNG or JPEG logo (recommended square or landscape, at least 80x80px).
              </p>
            </div>

            <div>
              <label
                htmlFor="brandAccentColor"
                className="block text-sm font-medium text-gray-700"
              >
                Accent Color
              </label>
              <div className="mt-1 flex items-center space-x-3">
                <input
                  type="color"
                  value={
                    brandAccentColor.startsWith('#') && brandAccentColor.length === 7
                      ? brandAccentColor
                      : '#111827'
                  }
                  onChange={(e) => setCustomAccentColor(e.target.value)}
                  disabled={saveBrandingMutation.isPending || brandingQuery.isLoading}
                  className="h-9 w-9 rounded border border-gray-300 p-0.5 cursor-pointer disabled:opacity-50"
                  aria-label="Color picker"
                />
                <input
                  id="brandAccentColor"
                  name="brandAccentColor"
                  type="text"
                  placeholder="#111827"
                  maxLength={7}
                  value={brandAccentColor}
                  onChange={(e) => setCustomAccentColor(e.target.value)}
                  disabled={saveBrandingMutation.isPending || brandingQuery.isLoading}
                  className="block w-40 rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm disabled:opacity-50 disabled:bg-gray-50"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Hex color used for headers and accent bands in PDF reports (e.g. #111827).
              </p>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={saveBrandingMutation.isPending || brandingQuery.isLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {saveBrandingMutation.isPending ? 'Saving...' : 'Save Branding'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
