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
      message?: string,
      headers?: Headers | Record<string, string>,
    ) {
      let resolvedMessage = message;
      if (data && typeof data === 'object') {
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

  it('displays specific 400 validation error message from API (nested real shape)', async () => {
    mockApiGet.mockResolvedValueOnce({
      user: {
        id: 'user-2',
        email: 'unverified@example.com',
        name: 'Unverified User',
        emailVerified: false,
      },
      memberships: [],
    });
    const { ApiError } = await import('../../lib/api/client');
    mockApiPost.mockRejectedValueOnce(
      new ApiError(
        400,
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'Email address is invalid',
          },
        },
        'Email address is invalid',
      ),
    );

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText(/Verify your email to unlock your workspace/i),
      ).toBeInTheDocument();
    });

    const resendBtn = screen.getByRole('button', { name: /Resend verification email/i });
    fireEvent.click(resendBtn);

    await waitFor(() => {
      expect(screen.getByText('Email address is invalid')).toBeInTheDocument();
    });
  });

  it('displays 429 rate limit error with retry seconds', async () => {
    mockApiGet.mockResolvedValueOnce({
      user: {
        id: 'user-2',
        email: 'unverified@example.com',
        name: 'Unverified User',
        emailVerified: false,
      },
      memberships: [],
    });
    const { ApiError } = await import('../../lib/api/client');
    mockApiPost.mockRejectedValueOnce(
      new ApiError(429, {}, 'Too Many Requests', new Headers({ 'retry-after': '45' })),
    );

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText(/Verify your email to unlock your workspace/i),
      ).toBeInTheDocument();
    });

    const resendBtn = screen.getByRole('button', { name: /Resend verification email/i });
    fireEvent.click(resendBtn);

    await waitFor(() => {
      expect(
        screen.getByText('Too many attempts. Please try again in 45 seconds.'),
      ).toBeInTheDocument();
    });
  });

  it('displays 500 server error message', async () => {
    mockApiGet.mockResolvedValueOnce({
      user: {
        id: 'user-2',
        email: 'unverified@example.com',
        name: 'Unverified User',
        emailVerified: false,
      },
      memberships: [],
    });
    const { ApiError } = await import('../../lib/api/client');
    mockApiPost.mockRejectedValueOnce(
      new ApiError(500, {}, 'Internal Server Error'),
    );

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText(/Verify your email to unlock your workspace/i),
      ).toBeInTheDocument();
    });

    const resendBtn = screen.getByRole('button', { name: /Resend verification email/i });
    fireEvent.click(resendBtn);

    await waitFor(() => {
      expect(
        screen.getByText('Something went wrong. Please try again.'),
      ).toBeInTheDocument();
    });
  });
});
