'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api/client';
import { authQueries } from '../../lib/query/auth';
import { getValidRedirect } from '../../lib/redirect';

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      theme?: string;
      size?: string;
      width?: string | number;
      text?: string;
    },
  ) => void;
  prompt: () => void;
}

interface WindowWithGoogle {
  google?: {
    accounts?: {
      id?: GoogleAccountsId;
    };
  };
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  const handleGoogleSignIn = useCallback(
    async (credential: string) => {
      setLoading(true);
      setError(null);

      try {
        await api.post('auth/google', { credential, termsAccepted: false });

        await queryClient.invalidateQueries({
          queryKey: authQueries.me().queryKey,
        });

        const authData = await queryClient.fetchQuery(authQueries.me());

        if (!authData.user.emailVerified) {
          router.push('/dashboard');
        } else {
          const redirectTo = searchParams.get('redirect');
          const validRedirect = getValidRedirect(redirectTo);
          if (validRedirect) {
            router.push(validRedirect);
          } else if (authData.memberships.length > 0) {
            router.push(`/${authData.memberships[0].workspaceId}/analytics`);
          } else {
            router.push('/dashboard');
          }
        }
      } catch (err: unknown) {
        if (err instanceof ApiError) {
          setError(err.message || 'Google sign-in failed. Please try again.');
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Unable to reach the server. Please try again.');
        }
      } finally {
        setLoading(false);
      }
    },
    [queryClient, router, searchParams],
  );

  useEffect(() => {
    if (!googleClientId) return;

    let isCancelled = false;

    const initGoogle = () => {
      const google = (window as unknown as WindowWithGoogle)?.google;
      if (isCancelled || !google?.accounts?.id) return;

      try {
        google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response: { credential: string }) => {
            if (!isCancelled && response?.credential) {
              handleGoogleSignIn(response.credential);
            }
          },
        });

        if (googleButtonRef.current) {
          google.accounts.id.renderButton(googleButtonRef.current, {
            theme: 'outline',
            size: 'large',
            width: '100%',
            text: 'signin_with',
          });
        }

        google.accounts.id.prompt();
      } catch {
        // Safe catch for GIS rendering
      }
    };

    const google = (window as unknown as WindowWithGoogle)?.google;
    if (google?.accounts?.id) {
      initGoogle();
    } else {
      const existingScript = document.getElementById(
        'google-gsi-client',
      ) as HTMLScriptElement | null;
      if (!existingScript) {
        const script = document.createElement('script');
        script.id = 'google-gsi-client';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => initGoogle();
        document.head.appendChild(script);
      } else {
        existingScript.addEventListener('load', initGoogle);
      }
    }

    return () => {
      isCancelled = true;
    };
  }, [googleClientId, handleGoogleSignIn]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      await api.post('auth/login', { email, password });
      
      // Invalidate and refetch auth query
      await queryClient.invalidateQueries({ queryKey: authQueries.me().queryKey });
      
      // Wait for auth/me to be available
      const authData = await queryClient.fetchQuery(authQueries.me());
      
      // Redirect logic
      if (!authData.user.emailVerified) {
        router.push('/dashboard');
      } else {
        const redirectTo = searchParams.get('redirect');
        const validRedirect = getValidRedirect(redirectTo);
        if (validRedirect) {
          router.push(validRedirect);
        } else if (authData.memberships.length > 0) {
          router.push(`/${authData.memberships[0].workspaceId}/analytics`);
        } else {
          router.push('/dashboard');
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('Invalid email or password.');
        } else if (err.status === 429) {
          const retryAfter = err.headers['retry-after'];
          if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds)) {
              setError(`Too many login attempts. Please try again in ${seconds} seconds.`);
            } else {
              setError('Too many login attempts. Please try again in a few minutes.');
            }
          } else {
            setError('Too many login attempts. Please try again in a few minutes.');
          }
        } else if (err.status >= 500) {
          setError('Something went wrong. Please try again.');
        } else if (err.status === 0) {
          setError('Unable to reach the server. Please try again.');
        } else {
          setError(err.message || 'An error occurred during login.');
        }
      } else {
        // Fallback for non-ApiError (e.g. TypeError from fetch failing)
        setError('Unable to reach the server. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
            Sign in to your account
          </h2>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {Boolean(googleClientId) && (
            <div className="space-y-4">
              <div
                ref={googleButtonRef}
                data-testid="google-button-container"
                className="flex justify-center"
              />
              <div className="relative flex items-center justify-center">
                <div className="w-full border-t border-gray-300" />
                <span className="bg-gray-50 px-2 text-xs text-gray-500 uppercase">
                  Or continue with email
                </span>
              </div>
            </div>
          )}
          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-1 block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium text-blue-600 hover:text-blue-500"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="mt-1 block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md" role="alert">
              {error}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-400"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>

          <div className="text-center text-sm text-gray-600">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="font-medium text-blue-600 hover:text-blue-500">
              Create one
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
