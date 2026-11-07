'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '../../lib/api/client';

type VerificationState = 'verifying' | 'success' | 'invalid';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<VerificationState>(() => {
    if (!token || !token.trim()) {
      return 'invalid';
    }
    return 'verifying';
  });

  const [resendEmail, setResendEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const hasRequestedRef = useRef(false);

  useEffect(() => {
    if (!token || !token.trim()) {
      return;
    }

    if (hasRequestedRef.current) {
      return;
    }
    hasRequestedRef.current = true;

    async function verify() {
      try {
        await api.post('auth/verify-email', { token: token!.trim() });
        setStatus('success');
      } catch {
        setStatus('invalid');
      }
    }

    verify();
  }, [token]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendLoading(true);
    setResendNotice(null);
    setResendError(null);

    const emailToUse = resendEmail.trim();

    try {
      await api.post('auth/resend-verification', { email: emailToUse });
      setResendNotice(
        'If an unverified account exists for this email, a verification link has been sent.',
      );
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
          const errData = err.data as Record<string, unknown> | undefined;
          if (typeof errData?.message === 'string') {
            setResendError(errData.message);
          } else {
            setResendError('Unable to send verification email. Please try again.');
          }
        }
      } else {
        setResendError('Unable to reach the server. Please try again.');
      }
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow">
        {status === 'verifying' && (
          <div className="text-center space-y-4">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">
              Verifying your email...
            </h2>
            <p className="text-sm text-gray-600">
              Please wait while we verify your email address.
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center space-y-6">
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
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                Email verified successfully.
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                Your email address has been verified. You can now sign in to your account.
              </p>
            </div>
            <div>
              <Link
                href="/login"
                className="inline-flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Sign in
              </Link>
            </div>
          </div>
        )}

        {status === 'invalid' && (
          <div className="space-y-6">
            <div className="text-center">
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
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 8.25h.008v.008H12v-.008z"
                  />
                </svg>
              </div>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-gray-900">
                Invalid or expired verification token
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                This verification link is invalid, expired, or has already been used. You can request a new verification link below.
              </p>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <form onSubmit={handleResend} className="space-y-4">
                <div>
                  <label
                    htmlFor="resend-email"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Email address
                  </label>
                  <input
                    id="resend-email"
                    name="email"
                    type="email"
                    required
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    placeholder="Enter your email"
                    className="mt-1 block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                    disabled={resendLoading}
                  />
                </div>

                {resendNotice && (
                  <div
                    className="rounded-md bg-blue-50 p-3 text-sm text-blue-700"
                    role="status"
                  >
                    {resendNotice}
                  </div>
                )}

                {resendError && (
                  <div
                    className="rounded-md bg-red-50 p-3 text-sm text-red-600"
                    role="alert"
                  >
                    {resendError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={resendLoading}
                  className="flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-400"
                >
                  {resendLoading ? 'Sending...' : 'Resend verification email'}
                </button>
              </form>
            </div>

            <div className="text-center text-sm text-gray-600">
              <Link
                href="/login"
                className="font-medium text-blue-600 hover:text-blue-500"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
          <div className="text-gray-600 text-sm">Loading verification...</div>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
