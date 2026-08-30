'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authQueries } from '../lib/query/auth';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { api } from '../lib/api/client';
import React, { useEffect, useState } from 'react';
import { Menu, BarChart, Users, LogOut, ChevronDown } from 'lucide-react';
import Link from 'next/link';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data: authData, isLoading } = useQuery(authQueries.me());
  
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isWorkspaceSwitcherOpen, setIsWorkspaceSwitcherOpen] = useState(false);

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

  if (isLoading || !authData || !isValidWorkspace || !currentMembership) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading workspace...</div>
      </div>
    );
  }

  const navItems = [
    { name: 'Overview / Analytics', href: `/${currentWorkspaceId}/analytics`, icon: BarChart },
    { name: 'Accounts', href: `/${currentWorkspaceId}/accounts`, icon: Users },
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
