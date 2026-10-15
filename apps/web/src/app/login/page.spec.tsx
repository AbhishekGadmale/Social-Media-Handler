import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockPush = vi.fn();
let currentSearchParamRedirect: string | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (param: string) => (param === 'redirect' ? currentSearchParamRedirect : null),
  }),
}));

const mockApiPost = vi.fn();
const mockApiGet = vi.fn();

vi.mock('../../lib/api/client', () => ({
  api: {
    post: (...args: unknown[]) => mockApiPost(...args),
    get: (...args: unknown[]) => mockApiGet(...args),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public data: unknown,
      message: string
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

const defaultMemberships = [
  {
    id: 'mem-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    role: 'ADMIN',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    workspace: { id: 'ws-1', name: 'Workspace 1' },
  },
];

const renderLogin = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LoginPage />
    </QueryClientProvider>
  );
};

const performLogin = async () => {
  fireEvent.change(screen.getByLabelText(/email address/i), {
    target: { value: 'user@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: 'secret123' },
  });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
};

describe('LoginPage post-login redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParamRedirect = null;
    mockApiPost.mockResolvedValue({});
    mockApiGet.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'Test User' },
      memberships: defaultMemberships,
    });
  });

  describe('Valid internal redirects', () => {
    it('redirects to valid internal path /workspace-1/publishing', async () => {
      currentSearchParamRedirect = '/workspace-1/publishing';
      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/workspace-1/publishing');
      });
    });

    it('preserves query strings on valid internal path /workspace-1/publishing?tab=drafts', async () => {
      currentSearchParamRedirect = '/workspace-1/publishing?tab=drafts';
      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/workspace-1/publishing?tab=drafts');
      });
    });

    it('preserves hash fragments on valid internal path /workspace-1/publishing#section', async () => {
      currentSearchParamRedirect = '/workspace-1/publishing#section';
      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/workspace-1/publishing#section');
      });
    });

    it('preserves both query and hash fragments', async () => {
      currentSearchParamRedirect = '/workspace-1/publishing?tab=drafts#top';
      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/workspace-1/publishing?tab=drafts#top');
      });
    });
  });

  describe('Invalid redirects with fallback to membership analytics route', () => {
    const invalidTargets = [
      ['https://evil.example.com', 'absolute https URL'],
      ['http://evil.example.com', 'absolute http URL'],
      ['//evil.example.com', 'protocol-relative URL'],
      ['/\\evil.example.com', 'slash-backslash bypass'],
      ['/%2f%2fevil.com', 'encoded protocol-relative URL'],
      ['javascript:alert(1)', 'javascript scheme'],
      ['data:text/html,test', 'data scheme'],
      ['evil.example.com', 'domain without leading slash'],
      ['', 'empty string'],
    ];

    for (const [target, description] of invalidTargets) {
      it(`rejects ${description} (${target}) and redirects to first membership analytics`, async () => {
        currentSearchParamRedirect = target;
        renderLogin();
        await performLogin();

        await waitFor(() => {
          expect(mockPush).toHaveBeenCalledWith('/ws-1/analytics');
        });
      });
    }

    it('falls back to first membership analytics when redirect param is missing (null)', async () => {
      currentSearchParamRedirect = null;
      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/ws-1/analytics');
      });
    });
  });

  describe('Fallback to /dashboard when user has no memberships', () => {
    beforeEach(() => {
      mockApiGet.mockResolvedValue({
        user: { id: 'user-1', email: 'user@example.com', name: 'Test User' },
        memberships: [],
      });
    });

    it('redirects to /dashboard on invalid redirect when memberships is empty', async () => {
      currentSearchParamRedirect = 'https://evil.example.com';
      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/dashboard');
      });
    });

    it('redirects to /dashboard when redirect param is missing and memberships is empty', async () => {
      currentSearchParamRedirect = null;
      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/dashboard');
      });
    });
  });
});
