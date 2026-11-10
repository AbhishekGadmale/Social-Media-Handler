'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authQueries } from '../lib/query/auth';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { api, ApiError } from '../lib/api/client';
import React, { useEffect, useState } from 'react';
import { Menu, BarChart, Users, LogOut, ChevronDown, Send, CreditCard } from 'lucide-react';
import Link from 'next/link';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data: authData, isLoading } = useQuery(authQueries.me());
  
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isWorkspaceSwitcherOpen, setIsWorkspaceSwitcherOpen] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const currentWorkspaceId = params.workspaceId as string;
  const memberships = React.useMemo(() => authData?.memberships || [], [authData?.memberships]);
  
  // Validate workspace
  const currentMembership = memberships.find(m => m.workspaceId === currentWorkspaceId);
  const isValidWorkspace = !!currentMembership;

  useEffect(() => {
    if (!isLoading && authData && !isValidWorkspace) {
      if (memberships.length > 0) {
        router.replace(`/${memberships[0].workspaceId}/analytics`);
      } else {
        router.replace('/dashboard');
      }
    }
  }, [isLoading, authData, isValidWorkspace, memberships, router]);

  const handleLogout = async () => {
    try {
      await api.post('auth/logout');
      queryClient.clear();
      router.push('/login');
    } catch (e) {
      console.error('Logout failed', e);
    }
  };

  const handleResend = async () => {
    setResendLoading(true);
    setResendNotice(null);
    setResendError(null);

    try {
      await api.post('auth/resend-verification', { email: authData?.user?.email });
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
            err.message || 'Unable to send verification email. Please try again.',
          );
        }
      } else {
        setResendError('Unable to reach the server. Please try again.');
      }
    } finally {
      setResendLoading(false);
    }
  };

  if (isLoading || !authData || !isValidWorkspace || !currentMembership) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading workspace...</div>
      </div>
    );
  }

  if (authData.user.emailVerified === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow space-y-4">
          <div
            className="rounded-md bg-amber-50 border border-amber-200 p-4"
            role="alert"
          >
            <div className="space-y-3">
              <div>
                <h2 className="text-base font-semibold text-amber-800">
                  Verify your email to unlock your workspace
                </h2>
                <p className="mt-1 text-sm text-amber-700">
                  Email verification is required to access workspace features. Please check your inbox for a verification link.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendLoading}
                  className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:bg-amber-400"
                >
                  {resendLoading ? 'Sending...' : 'Resend verification email'}
                </button>
                <Link
                  href="/dashboard"
                  className="text-sm font-medium text-amber-800 hover:text-amber-900 underline"
                >
                  Go to Dashboard
                </Link>
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
          </div>
        </div>
      </div>
    );
  }

  const navItems = [
    { name: 'Overview / Analytics', href: `/${currentWorkspaceId}/analytics`, icon: BarChart },
    { name: 'Accounts', href: `/${currentWorkspaceId}/accounts`, icon: Users },
    { name: 'Publishing', href: `/${currentWorkspaceId}/publishing`, icon: Send },
    { name: 'Billing', href: `/${currentWorkspaceId}/billing`, icon: CreditCard },
  ];

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Mobile sidebar backdrop */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-gray-600 bg-opacity-75 md:hidden transition-opacity" 
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          {/* Workspace Switcher */}
          <div className="relative border-b p-4">
            <button 
              className="flex items-center justify-between w-full p-2 bg-gray-50 hover:bg-gray-100 rounded-md text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              onClick={() => setIsWorkspaceSwitcherOpen(!isWorkspaceSwitcherOpen)}
              aria-haspopup="listbox"
              aria-expanded={isWorkspaceSwitcherOpen}
              aria-label="Switch workspace"
            >
              <div className="flex flex-col items-start truncate mr-2">
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Workspace</span>
                <span className="text-sm font-semibold text-gray-900 truncate w-full">{currentMembership.workspace.name}</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isWorkspaceSwitcherOpen ? 'transform rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {isWorkspaceSwitcherOpen && (
              <div className="absolute top-full left-4 right-4 mt-1 bg-white border rounded-md shadow-lg z-50 py-1" role="listbox">
                {memberships.map((m) => {
                  const isSelected = m.workspaceId === currentWorkspaceId;
                  return (
                    <button
                      key={m.workspaceId}
                      role="option"
                      aria-selected={isSelected}
                      className={`block w-full text-left px-4 py-2 text-sm transition-colors hover:bg-gray-100 ${isSelected ? 'bg-blue-50 text-blue-700 font-medium hover:bg-blue-100' : 'text-gray-700'}`}
                      onClick={() => {
                        setIsWorkspaceSwitcherOpen(false);
                        setIsMobileMenuOpen(false);
                        if (!isSelected) {
                          const section = pathname.split('/').pop();
                          const targetSection = ['accounts', 'analytics'].includes(section || '') ? section : 'analytics';
                          router.push(`/${m.workspaceId}/${targetSection}`);
                        }
                      }}
                    >
                      <span className="truncate block">{m.workspace.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isActive 
                      ? 'bg-blue-50 text-blue-700' 
                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <item.icon className={`mr-3 h-5 w-5 flex-shrink-0 ${isActive ? 'text-blue-700' : 'text-gray-400'}`} aria-hidden="true" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* User profile & Logout */}
          <div className="border-t p-4 space-y-3">
            <div className="flex items-center px-3 py-2 text-sm text-gray-700">
              <div className="flex flex-col truncate">
                <span className="font-medium text-gray-900 truncate">{authData.user.name}</span>
                <span className="text-xs text-gray-500 truncate">{authData.user.email}</span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex w-full items-center px-3 py-2 text-sm font-medium text-red-600 rounded-md transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <LogOut className="mr-3 h-5 w-5 flex-shrink-0" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="flex md:hidden items-center justify-between p-4 border-b bg-white">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="text-gray-500 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md p-1 -ml-1"
            aria-label="Open navigation menu"
          >
            <Menu className="h-6 w-6" aria-hidden="true" />
          </button>
          <span className="font-semibold text-gray-900 truncate px-4">{currentMembership.workspace.name}</span>
          <div className="w-6" /> {/* Spacer for centering */}
        </header>

        {/* Main Content Scrollable Area */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
