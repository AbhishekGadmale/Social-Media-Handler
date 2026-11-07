import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthGuard, PUBLIC_ROUTES } from './auth-guard';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockReplace = vi.fn();
let currentPathname = '/dashboard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => currentPathname,
}));

const mockApiGet = vi.fn();

vi.mock('../lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public data: unknown,
      message: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

const renderWithGuard = (children = <div>Protected Content</div>) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthGuard>{children}</AuthGuard>
    </QueryClientProvider>,
  );
};

describe('AuthGuard Route Logic & Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PUBLIC_ROUTES list', () => {
    it('defines exactly the 3 public routes', () => {
      expect(PUBLIC_ROUTES).toEqual(['/login', '/signup', '/verify-email']);
    });
  });

  describe('Logged-out visitors (unauthenticated / 401)', () => {
    beforeEach(() => {
      mockApiGet.mockRejectedValue(new Error('Unauthorized'));
    });

    it('renders signup form on /signup without redirecting to login', async () => {
      currentPathname = '/signup';
      renderWithGuard(<div data-testid="signup-page">Signup Form</div>);

      await waitFor(() => {
        expect(screen.getByTestId('signup-page')).toBeInTheDocument();
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('renders verification view on /verify-email without redirecting to login', async () => {
      currentPathname = '/verify-email';
      renderWithGuard(<div data-testid="verify-email-page">Verify Email View</div>);

      await waitFor(() => {
        expect(screen.getByTestId('verify-email-page')).toBeInTheDocument();
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('renders login page on /login without redirecting to login', async () => {
      currentPathname = '/login';
      renderWithGuard(<div data-testid="login-page">Login Form</div>);

      await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument();
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('bounces logged-out user from /dashboard to /login?redirect=%2Fdashboard and hides children', async () => {
      currentPathname = '/dashboard';
      renderWithGuard(<div data-testid="dashboard-content">Dashboard Content</div>);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/login?redirect=%2Fdashboard');
      });
      expect(screen.queryByTestId('dashboard-content')).not.toBeInTheDocument();
    });

    it('bounces logged-out user from protected workspace route to /login with redirect parameter', async () => {
      currentPathname = '/ws-123/analytics';
      renderWithGuard(<div data-testid="analytics-content">Analytics Content</div>);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/login?redirect=%2Fws-123%2Fanalytics');
      });
      expect(screen.queryByTestId('analytics-content')).not.toBeInTheDocument();
    });
  });

  describe('Logged-in users (authenticated)', () => {
    const mockAuthData = {
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        emailVerified: false,
      },
      memberships: [
        {
          id: 'mem-1',
          userId: 'user-1',
          workspaceId: 'ws-agency',
          role: 'OWNER',
        },
      ],
    };

    beforeEach(() => {
      mockApiGet.mockResolvedValue(mockAuthData);
    });

    it('redirects authenticated user from /login to their workspace analytics', async () => {
      currentPathname = '/login';
      renderWithGuard(<div data-testid="login-page">Login Form</div>);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/ws-agency/analytics');
      });
      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    });

    it('redirects authenticated user on /login to /dashboard if they have no memberships', async () => {
      mockApiGet.mockResolvedValueOnce({
        user: mockAuthData.user,
        memberships: [],
      });
      currentPathname = '/login';
      renderWithGuard(<div data-testid="login-page">Login Form</div>);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/dashboard');
      });
      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    });

    it('does not redirect authenticated user on /signup and renders children', async () => {
      currentPathname = '/signup';
      renderWithGuard(<div data-testid="signup-page">Signup Form</div>);

      await waitFor(() => {
        expect(screen.getByTestId('signup-page')).toBeInTheDocument();
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('does not redirect authenticated user on /verify-email and renders children', async () => {
      currentPathname = '/verify-email';
      renderWithGuard(<div data-testid="verify-email-page">Verify Email View</div>);

      await waitFor(() => {
        expect(screen.getByTestId('verify-email-page')).toBeInTheDocument();
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('allows authenticated user to view protected route', async () => {
      currentPathname = '/dashboard';
      renderWithGuard(<div data-testid="dashboard-content">Dashboard Content</div>);

      await waitFor(() => {
        expect(screen.getByTestId('dashboard-content')).toBeInTheDocument();
      });
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('Loading state', () => {
    it('shows loading indicator and suppresses children while checking auth', () => {
      mockApiGet.mockReturnValue(new Promise(() => {})); // never resolves
      currentPathname = '/dashboard';
      renderWithGuard(<div data-testid="content">Protected Content</div>);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });
  });
});
