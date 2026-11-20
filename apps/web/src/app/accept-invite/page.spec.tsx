import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AcceptInvitePage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';

let currentToken: string | null = 'test-invite-token-abc';
const mockRouterPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
  useSearchParams: () => ({
    get: (param: string) => (param === 'token' ? currentToken : null),
  }),
}));

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('../../lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public data: unknown,
      message?: string,
    ) {
      super(message || 'API Error');
      this.name = 'ApiError';
    }
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('AcceptInvitePage', () => {
  const mockInviteInfo = {
    workspaceName: 'Acme Social Growth',
    email: 'invited@example.com',
    role: 'CLIENT_APPROVER',
    roleFormatted: 'Client Approver',
    expiresAt: '2026-11-27T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentToken = 'test-invite-token-abc';
  });

  it('renders invalid state when token is missing', () => {
    currentToken = null;
    renderWithClient(<AcceptInvitePage />);

    expect(
      screen.getByRole('heading', { name: /invalid or expired invitation/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/this invitation is no longer valid/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to sign in/i })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('renders invalid state when token is expired, revoked, or consumed on API', async () => {
    const { ApiError } = await import('../../lib/api/client');
    mockApiGet.mockImplementation((url: string) => {
      if (url.startsWith('invitations/info')) {
        return Promise.reject(new ApiError(400, null, 'This invitation has expired'));
      }
      return Promise.resolve(null);
    });

    renderWithClient(<AcceptInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /invalid or expired invitation/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('This invitation has expired')).toBeInTheDocument();
  });

  it('renders logged out state with login and signup links preserving token in redirect', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === 'auth/me') return Promise.resolve({ user: null, memberships: [] });
      if (url.startsWith('invitations/info')) return Promise.resolve(mockInviteInfo);
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    renderWithClient(<AcceptInvitePage />);

    expect(
      await screen.findByRole('heading', {
        name: /you have been invited to acme social growth/i,
      }),
    ).toBeInTheDocument();

    expect(screen.getByText('invited@example.com')).toBeInTheDocument();
    expect(screen.getByText('Client Approver')).toBeInTheDocument();

    const expectedReturn = encodeURIComponent('/accept-invite?token=test-invite-token-abc');
    expect(screen.getByRole('link', { name: /sign in to accept/i })).toHaveAttribute(
      'href',
      `/login?redirect=${expectedReturn}`,
    );
    expect(screen.getByRole('link', { name: /create account/i })).toHaveAttribute(
      'href',
      `/signup?redirect=${expectedReturn}`,
    );
  });

  it('renders account mismatch message when logged in with a different email', async () => {
    const loggedInUser = {
      user: { id: 'usr-different', email: 'different@example.com', name: 'Dan Different' },
      memberships: [],
    };

    mockApiGet.mockImplementation((url: string) => {
      if (url === 'auth/me') return Promise.resolve(loggedInUser);
      if (url.startsWith('invitations/info')) return Promise.resolve(mockInviteInfo);
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    renderWithClient(<AcceptInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /account mismatch/i }),
    ).toBeInTheDocument();

    expect(screen.getByText('invited@example.com')).toBeInTheDocument();
    expect(screen.getByText('different@example.com')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign out & switch account/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /go to my dashboard/i }),
    ).toHaveAttribute('href', '/dashboard');
  });

  it('renders invitation details and Accept button when logged in with matching email', async () => {
    const matchingUser = {
      user: { id: 'usr-match', email: 'invited@example.com', name: 'Ian Invitee' },
      memberships: [],
    };

    mockApiGet.mockImplementation((url: string) => {
      if (url === 'auth/me') return Promise.resolve(matchingUser);
      if (url.startsWith('invitations/info')) return Promise.resolve(mockInviteInfo);
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    mockApiPost.mockResolvedValue({
      success: true,
      workspaceId: 'ws-acme-789',
    });

    renderWithClient(<AcceptInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /join acme social growth/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/client approver/i)).toBeInTheDocument();

    const acceptButton = screen.getByRole('button', { name: /accept invitation/i });
    expect(acceptButton).toBeInTheDocument();

    fireEvent.click(acceptButton);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('invitations/accept', {
        token: 'test-invite-token-abc',
      });
    });

    expect(await screen.findByText(/welcome to acme social growth!/i)).toBeInTheDocument();
  });
});
