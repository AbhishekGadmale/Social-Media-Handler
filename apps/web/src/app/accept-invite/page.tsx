'use client';

import { Suspense, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authQueries } from '../../lib/query/auth';
import { membersQueries } from '../../lib/query/members';
import { api, ApiError } from '../../lib/api/client';
import {
  Users,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  LogOut,
} from 'lucide-react';

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const token = searchParams.get('token')?.trim() || '';

  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const isSubmittingRef = useRef(false);

  // Queries
  const { data: authData, isLoading: isAuthLoading } = useQuery(authQueries.me());
  const {
    data: inviteInfo,
    isLoading: isInviteLoading,
    isError: isInviteError,
    error: inviteFetchError,
  } = useQuery(membersQueries.invitationInfo(token));

  const handleLogoutAndSwitch = async () => {
    try {
      await api.post('auth/logout');
      queryClient.clear();
      router.push(`/login?redirect=${encodeURIComponent(`/accept-invite?token=${token}`)}`);
    } catch {
      router.push('/login');
    }
  };

  const handleAccept = async () => {
    if (isSubmittingRef.current || accepting) return;
    isSubmittingRef.current = true;
    setAccepting(true);
    setAcceptError(null);

    try {
      const res = await api.post<{ success: boolean; workspaceId: string }>(
        'invitations/accept',
        { token },
      );
      setIsSuccess(true);
      await queryClient.invalidateQueries({
        queryKey: authQueries.me().queryKey,
      });

      setTimeout(() => {
        router.push(`/${res.workspaceId}/analytics`);
      }, 1000);
    } catch (err: unknown) {
      isSubmittingRef.current = false;
      setAccepting(false);
      if (err instanceof ApiError) {
        setAcceptError(err.message || 'Failed to accept invitation');
      } else {
        setAcceptError('An unexpected error occurred while accepting invitation');
      }
    }
  };

  // 1. Missing token or invalid/expired/revoked token
  if (!token || isInviteError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-6 rounded-lg bg-white p-8 shadow text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold tracking-tight text-gray-900">
              Invalid or Expired Invitation
            </h2>
            <p className="text-sm text-gray-500">
              {inviteFetchError instanceof ApiError && inviteFetchError.message
                ? inviteFetchError.message
                : 'This invitation is no longer valid.'}
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/login"
              className="inline-flex w-full justify-center items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Go to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 2. Loading state
  if (isInviteLoading || isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="text-gray-500 text-sm font-medium animate-pulse">
          Loading invitation...
        </div>
      </div>
    );
  }

  const workspaceName = inviteInfo?.workspaceName || 'a workspace';
  const roleName = inviteInfo?.roleFormatted || inviteInfo?.role || 'Team Member';
  const invitedEmail = inviteInfo?.email || '';
  const currentUser = authData?.user;

  // 3. Accepted Success state
  if (isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-6 rounded-lg bg-white p-8 shadow text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold tracking-tight text-gray-900">
              Welcome to {workspaceName}!
            </h2>
            <p className="text-sm text-gray-500">
              You have joined the workspace as {roleName}. Redirecting to your dashboard...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 4. Logged out state
  if (!currentUser) {
    const returnUrl = `/accept-invite?token=${token}`;
    const loginUrl = `/login?redirect=${encodeURIComponent(returnUrl)}`;
    const signupUrl = `/signup?redirect=${encodeURIComponent(returnUrl)}`;

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow">
          <div className="text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <Users className="h-6 w-6 text-blue-600" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              You have been invited to {workspaceName}
            </h1>
            <p className="text-sm text-gray-600">
              This invitation was sent to <strong className="text-gray-900">{invitedEmail}</strong> to join as <strong className="text-gray-900">{roleName}</strong>.
            </p>
            <p className="text-xs text-gray-500">
              Please sign in or create an account with this email to accept your invitation.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <Link
              href={loginUrl}
              className="flex w-full justify-center items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Sign in to accept
            </Link>
            <Link
              href={signupUrl}
              className="flex w-full justify-center items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 5. Logged in with mismatched email
  const isEmailMatch = currentUser.email.toLowerCase() === invitedEmail.toLowerCase();
  if (!isEmailMatch) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-6 rounded-lg bg-white p-8 shadow text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <AlertCircle className="h-6 w-6 text-red-600" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold tracking-tight text-gray-900">
              Account Mismatch
            </h2>
            <p className="text-sm text-gray-600">
              This invitation was sent to <strong className="text-gray-900">{invitedEmail}</strong>. You are currently signed in as <strong className="text-gray-900">{currentUser.email}</strong>.
            </p>
            <p className="text-xs text-gray-500">
              To accept this invitation, sign out and sign in with the invited email address.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <button
              onClick={handleLogoutAndSwitch}
              className="flex w-full justify-center items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out & switch account
            </button>
            <Link
              href="/dashboard"
              className="flex w-full justify-center items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Go to my dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 6. Logged in with correct email - Ready to accept
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
          <Users className="h-6 w-6 text-blue-600" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Join {workspaceName}
          </h1>
          <p className="text-sm text-gray-600">
            You have been invited to join as <strong className="text-gray-900 font-semibold">{roleName}</strong>.
          </p>
        </div>

        {acceptError && (
          <div className="rounded-md bg-red-50 p-4 border border-red-200 text-left">
            <p className="text-sm font-medium text-red-800">{acceptError}</p>
          </div>
        )}

        <div className="pt-2">
          <button
            onClick={handleAccept}
            disabled={accepting}
            className="flex w-full justify-center items-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {accepting ? (
              'Accepting invitation...'
            ) : (
              <>
                Accept Invitation
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
          <div className="text-gray-500 text-sm font-medium animate-pulse">
            Loading invitation...
          </div>
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}
