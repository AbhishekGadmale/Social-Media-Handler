'use client';

import { Suspense, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '../../lib/api/client';

type ResetState = 'form' | 'success' | 'invalid';

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<ResetState>(() => {
    if (!token || !token.trim()) {
      return 'invalid';
    }
    return 'form';
  });

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSubmittingRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8 || newPassword.length > 128) {
      setError('Password must be between 8 and 128 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;
    setLoading(true);

    try {
      await api.post('auth/reset-password', {
        token: token!.trim(),
        newPassword,
      });
      setStatus('success');
    } catch (err) {
      isSubmittingRef.current = false;

      if (err instanceof ApiError) {
        if (err.status === 429) {
          const retryAfter = err.headers['retry-after'];
          const seconds = retryAfter ? parseInt(retryAfter, 10) : NaN;
          if (!isNaN(seconds)) {
            setError(`Too many attempts. Please try again in ${seconds} seconds.`);
          } else {
            setError('Too many attempts. Please try again in a few minutes.');
          }
        } else if (err.status >= 500) {
          setError('Something went wrong. Please try again.');
        } else if (err.status === 0) {
          setError('Unable to reach the server. Please try again.');
        } else {
          const messageStr = err.message || '';
          if (messageStr.toLowerCase().includes('invalid or expired')) {
            setStatus('invalid');
          } else {
            setError(messageStr || 'An error occurred during password reset.');
          }
        }
      } else {
        setError('Unable to reach the server. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow">
        {status === 'success' && (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg
                className="h-6 w-6 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">
              Password reset successfully
            </h2>
            <p className="text-sm text-gray-600">
              Your password has been updated. You can now sign in with your new password.
            </p>
            <div className="pt-2">
              <Link
                href="/login"
                className="group relative flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Sign in
              </Link>
            </div>
          </div>
        )}

        {status === 'invalid' && (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg
                className="h-6 w-6 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">
              Invalid or expired reset link
            </h2>
            <p className="text-sm text-gray-600">
              This password reset link is invalid or has expired. Please request a new link to reset your password.
            </p>
            <div className="pt-2">
              <Link
                href="/forgot-password"
                className="group relative flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Request a new link
              </Link>
            </div>
          </div>
        )}

        {status === 'form' && (
          <>
            <div>
              <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">
                Choose a new password
              </h2>
              <p className="mt-2 text-center text-sm text-gray-600">
                Please enter a new password for your Agency OS account.
              </p>
            </div>

            <form className="mt-8 space-y-6" onSubmit={handleSubmit} noValidate>
              <div className="space-y-4">
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
                    required
                    className="mt-1 block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>

                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Confirm new password
                  </label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="mt-1 block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              {error && (
                <div
                  className="text-sm text-red-600 bg-red-50 p-3 rounded-md"
                  role="alert"
                >
                  {error}
                </div>
              )}

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="group relative flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-400"
                >
                  {loading ? 'Updating password...' : 'Reset password'}
                </button>
              </div>

              <div className="text-center text-sm text-gray-600">
                <Link
                  href="/login"
                  className="font-medium text-blue-600 hover:text-blue-500"
                >
                  Back to sign in
                </Link>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
          <div className="text-gray-600 text-sm">Loading reset form...</div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
