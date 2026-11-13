import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardShell } from './dashboard-shell';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1' }),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/ws-1/analytics',
}));

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('../lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
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

const mockVerifiedUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  emailVerified: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const mockUnverifiedUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  emailVerified: false,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const mockMemberships = [
  {
    id: 'mem-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    role: 'OWNER',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    workspace: {
      id: 'ws-1',
      name: 'Test Workspace',
    },
  },
];

const renderWithShell = (children = <div data-testid="child-content">Workspace Content</div>) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardShell>{children}</DashboardShell>
    </QueryClientProvider>,
  );
};

describe('DashboardShell Verification Gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children and navigation for verified user with a valid workspace membership', async () => {
    mockApiGet.mockResolvedValue({
      user: mockVerifiedUser,
      memberships: mockMemberships,
    });

    renderWithShell();

    await waitFor(() => {
      expect(screen.getByTestId('child-content')).toBeInTheDocument();
    });
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders user email in name position when user.name is null', async () => {
    mockApiGet.mockResolvedValue({
      user: {
        id: 'user-null-name',
        email: 'fallback@example.com',
        name: null,
        emailVerified: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      memberships: mockMemberships,
    });

    renderWithShell();

    await waitFor(() => {
      expect(screen.getByTestId('child-content')).toBeInTheDocument();
    });

    const emailOccurrences = screen.getAllByText('fallback@example.com');
    expect(emailOccurrences.length).toBe(2);
    expect(emailOccurrences[0]).toHaveClass('font-medium');
  });

  it('renders verification gate and hides children and sidebar nav for unverified user', async () => {
    mockApiGet.mockResolvedValue({
      user: mockUnverifiedUser,
      memberships: mockMemberships,
    });

    renderWithShell();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('heading', { name: /verify your email to unlock your workspace/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Email verification is required to access workspace features. Please check your inbox for a verification link.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /resend verification email/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('posts auth/resend-verification with user email and shows notice on resend click', async () => {
    mockApiGet.mockResolvedValue({
      user: mockUnverifiedUser,
      memberships: mockMemberships,
    });
    mockApiPost.mockResolvedValue({});

    renderWithShell();

    const resendButton = await screen.findByRole('button', {
      name: /resend verification email/i,
    });
    fireEvent.click(resendButton);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('auth/resend-verification', {
        email: 'test@example.com',
      });
    });
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(
        'If an unverified account exists for this email, a verification link has been sent.',
      ),
    ).toBeInTheDocument();
  });

  it('renders retry message when resend is rejected with 429 and retry-after header', async () => {
    const { ApiError } = await import('../lib/api/client');
    mockApiGet.mockResolvedValue({
      user: mockUnverifiedUser,
      memberships: mockMemberships,
    });
    mockApiPost.mockRejectedValueOnce(
      new ApiError(
        429,
        { error: { message: 'Too Many Requests' } },
        'Too Many Requests',
        new Headers({ 'retry-after': '45' }),
      ),
    );

    renderWithShell();

    const resendButton = await screen.findByRole('button', {
      name: /resend verification email/i,
    });
    fireEvent.click(resendButton);

    await waitFor(() => {
      expect(
        screen.getByText('Too many attempts. Please try again in 45 seconds.'),
      ).toBeInTheDocument();
    });
  });
});
