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
    public headers: Record<string, string>;
    constructor(
      public status: number,
      public data: unknown,
      message?: string,
      headers?: Headers | Record<string, string>,
    ) {
      let resolvedMessage = message;
      if (!resolvedMessage && data && typeof data === 'object') {
        const dataObj = data as Record<string, unknown>;
        const nested = dataObj.error;
        let extracted: unknown;
        if (nested && typeof nested === 'object') {
          extracted = (nested as Record<string, unknown>).message;
        }
        if (extracted === undefined) {
          extracted = dataObj.message;
        }
        if (Array.isArray(extracted)) {
          resolvedMessage = extracted.join(', ');
        } else if (typeof extracted === 'string') {
          resolvedMessage = extracted;
        }
      }
      super(resolvedMessage || 'API Error');
      this.name = 'ApiError';
      this.headers = {};
      if (headers) {
        if (typeof (headers as Headers).forEach === 'function') {
          (headers as Headers).forEach((val, key) => {
            this.headers[key.toLowerCase()] = val;
          });
        } else {
          this.headers = headers as Record<string, string>;
        }
      }
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

  describe('Signup link', () => {
    it('renders a link to /signup', () => {
      renderLogin();
      const signupLink = screen.getByRole('link', { name: /create one/i });
      expect(signupLink).toBeInTheDocument();
      expect(signupLink).toHaveAttribute('href', '/signup');
    });

    it('renders a link to /forgot-password', () => {
      renderLogin();
      const forgotPasswordLink = screen.getByRole('link', { name: /forgot password\?/i });
      expect(forgotPasswordLink).toBeInTheDocument();
      expect(forgotPasswordLink).toHaveAttribute('href', '/forgot-password');
    });
  });

  describe('Error handling', () => {
    it('displays specific 400 validation error message from API (nested real shape)', async () => {
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(
          400,
          { error: { message: 'Account is temporarily suspended' } },
          'Account is temporarily suspended',
        ),
      );

      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Account is temporarily suspended');
      });
    });

    it('displays 401 invalid credentials error', async () => {
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(401, {}, 'Unauthorized'),
      );

      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.');
      });
    });

    it('displays 429 rate limit error with retry seconds', async () => {
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(429, {}, 'Too Many Requests', new Headers({ 'retry-after': '30' })),
      );

      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Too many login attempts. Please try again in 30 seconds.');
      });
    });

    it('displays 500 server error message', async () => {
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(500, {}, 'Internal Server Error'),
      );

      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
      });
    });

    it('displays status 0 network error message', async () => {
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(0, null, 'Network error'),
      );

      renderLogin();
      await performLogin();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Unable to reach the server. Please try again.');
      });
    });
  });
});
