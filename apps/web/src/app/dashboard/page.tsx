'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authQueries } from '../../lib/query/auth';
import { api, ApiError } from '../../lib/api/client';
import { useRouter } from 'next/navigation';

export default function Dashboard() {
  const { data: authData } = useQuery(authQueries.me());
  const router = useRouter();

  const [resendEmail, setResendEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const handleLogout = async () => {
    try {
      await api.post('auth/logout');
      router.push('/login');
    } catch (e) {
      console.error('Logout failed', e);
    }
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendLoading(true);
    setResendNotice(null);
    setResendError(null);

    const emailToSend = resendEmail || authData?.user?.email || '';

    try {
      await api.post('auth/resend-verification', { email: emailToSend });
      setResendNotice('If an unverified account exists for this email, a verification link has been sent.');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const retryAfter = err.headers['retry-after'];
          const seconds = retryAfter ? parseInt(retryAfter, 10) : NaN;
          if (!isNaN(seconds)) {
            setResendError(`Too many attempts. Please try again in ${seconds} seconds.`);
          } else {
            setResendError('Too many attempts. Please try again in a few minutes.');
          }
        } else if (err.status >= 500) {
          setResendError('Something went wrong. Please try again.');
        } else if (err.status === 0) {
          setResendError('Unable to reach the server. Please try again.');
        } else {
          setResendError(
            ((err.data as Record<string, unknown>)?.message as string) ||
              'Unable to send verification email. Please try again.',
          );
        }
      } else {
        setResendError('Unable to reach the server. Please try again.');
      }
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow p-6">
        {authData?.user && authData.user.emailVerified === false && (
          <div
            className="mb-6 rounded-md bg-amber-50 border border-amber-200 p-4"
            role="alert"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-amber-800">
                  Verify your email to unlock your workspace
                </h2>
                <p className="mt-1 text-sm text-amber-700">
                  Check your inbox for a verification link to access all workspace features.
                </p>
              </div>
              <form onSubmit={handleResend} className="flex items-center gap-2">
                <input
                  type="email"
                  value={resendEmail || authData.user.email || ''}
                  onChange={(e) => setResendEmail(e.target.value)}
                  required
                  aria-label="Email for verification resend"
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={resendLoading}
                  className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:bg-amber-400"
                >
                  {resendLoading ? 'Sending...' : 'Resend verification email'}
                </button>
              </form>
            </div>
            {resendNotice && (
              <div className="mt-3 text-sm text-amber-900 bg-amber-100/60 p-2 rounded">
                {resendNotice}
              </div>
            )}
            {resendError && (
              <div className="mt-3 text-sm text-red-700 bg-red-100/60 p-2 rounded">
                {resendError}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-gray-600">
            Welcome back, <span className="font-semibold text-gray-900">{authData?.user.name}</span>
          </p>

          {authData?.memberships?.length ? (
            <div className="mt-8 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Your Workspaces</h2>
              {authData.memberships.map((membership) => (
                <div key={membership.id} className="p-4 border rounded-md hover:bg-gray-50 flex justify-between items-center">
                  <div>
                    <h3 className="font-medium text-gray-900">{membership.workspace.name}</h3>
                    <p className="text-sm text-gray-500">Role: {membership.role}</p>
                  </div>
                  <button
                    onClick={() => router.push(`/${membership.workspaceId}/analytics`)}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                  >
                    Enter Workspace
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-8 p-4 bg-yellow-50 text-yellow-700 rounded-md">
              You do not currently have any workspaces.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
