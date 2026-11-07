import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
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
      message: string,
      headers?: Headers,
    ) {
      super(message);
      this.name = 'ApiError';
      this.headers = {};
      if (headers) {
        headers.forEach((val, key) => {
          this.headers[key.toLowerCase()] = val;
        });
      }
    }
  },
}));

const renderDashboard = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>,
  );
};

describe('Dashboard Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not display email verification banner when user is verified', async () => {
    mockApiGet.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        email: 'verified@example.com',
        name: 'Verified User',
        emailVerified: true,
      },
      memberships: [],
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Welcome back,/i)).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/Verify your email to unlock your workspace/i),
    ).not.toBeInTheDocument();
  });

  it('displays email verification banner and resends verification link when user is unverified', async () => {
    mockApiGet.mockResolvedValueOnce({
      user: {
        id: 'user-2',
        email: 'unverified@example.com',
        name: 'Unverified User',
        emailVerified: false,
      },
      memberships: [],
    });
    mockApiPost.mockResolvedValueOnce({
      message: 'If an unverified account exists for this email, a verification link has been sent.',
    });

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText(/Verify your email to unlock your workspace/i),
      ).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText(/Email for verification resend/i);
    expect(emailInput).toHaveValue('unverified@example.com');

    const resendBtn = screen.getByRole('button', { name: /Resend verification email/i });
    fireEvent.click(resendBtn);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('auth/resend-verification', {
        email: 'unverified@example.com',
      });
      expect(
        screen.getByText(/If an unverified account exists for this email, a verification link has been sent./i),
      ).toBeInTheDocument();
    });
  });
});
