import { queryOptions } from '@tanstack/react-query';
import { api } from '../api/client';

export interface User {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  workspaceId: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  workspace: {
    id: string;
    name: string;
  };
}

export interface AuthMeResponse {
  user: User;
  memberships: WorkspaceMember[];
}

export interface SessionInfo {
  sessionId: string;
  ipAddress: string | null;
  userAgent: string | null;
  browser: string;
  os: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export const authQueries = {
  me: () =>
    queryOptions({
      queryKey: ['auth', 'me'],
      queryFn: () => api.get<AuthMeResponse>('auth/me'),
      retry: false, // Don't retry on auth queries to fail fast
    }),
  sessions: () =>
    queryOptions({
      queryKey: ['auth', 'sessions'],
      queryFn: () => api.get<{ sessions: SessionInfo[] }>('auth/sessions'),
      retry: false,
    }),
};
