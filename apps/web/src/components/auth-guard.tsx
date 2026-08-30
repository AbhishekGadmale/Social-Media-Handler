'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { authQueries } from '../lib/query/auth';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLoginPage = pathname === '/login';

  const { data: authData, isLoading, isError } = useQuery({
    ...authQueries.me(),
    retry: false, // Ensure we don't retry on 401
  });

  useEffect(() => {
    if (isLoading) return;

    if (isError) {
      if (!isLoginPage) {
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      }
    } else if (authData && isLoginPage) {
      // Authenticated user trying to access login page
      if (authData.memberships.length > 0) {
        router.replace(`/${authData.memberships[0].workspaceId}/analytics`);
      } else {
        router.replace('/dashboard');
      }
    }
  }, [isLoading, isError, authData, isLoginPage, pathname, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // If on a protected route and not authenticated, don't render children
  if (isError && !isLoginPage) {
    return null;
  }

  // If on login page and authenticated, don't render children (avoid flash of login)
  if (!isError && authData && isLoginPage) {
    return null;
  }

  return <>{children}</>;
}
