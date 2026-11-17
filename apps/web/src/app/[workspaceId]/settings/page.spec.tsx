import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockApiGet, mockApiDelete, mockApiPost, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    public status: number;
    public data: unknown;
    public headers: Record<string, string> = {};
    constructor(status: number, data: unknown, message?: string) {
      super(message || 'API Error');
      this.status = status;
      this.data = data;
      this.name = 'ApiError';
    }
  }

  return {
    mockApiGet: vi.fn(),
    mockApiDelete: vi.fn(),
    mockApiPost: vi.fn(),
    MockApiError,
  };
});

vi.mock('../../../lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
  ApiError: MockApiError,
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}

describe('SettingsPage - Active Sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    mockApiGet.mockReturnValue(new Promise(() => {})); // Never resolves
    renderWithClient(<SettingsPage />);

    expect(screen.getByRole('status', { name: /loading sessions/i })).toBeInTheDocument();
  });

  it('renders error banner when query fails', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));
    renderWithClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load sessions.')).toBeInTheDocument();
    });
  });

  it('renders empty message when no active sessions are returned', async () => {
    mockApiGet.mockResolvedValue({ sessions: [] });
    renderWithClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('No active sessions found.')).toBeInTheDocument();
    });
  });

  it('renders active sessions with device title, IP, This device badge, and revoke button logic', async () => {
    const mockSessions = [
      {
        sessionId: 'sess-current',
        ipAddress: '192.168.1.100',
        userAgent: 'Chrome on Win',
        browser: 'Google Chrome',
        os: 'Windows',
        createdAt: '2026-11-16T10:00:00.000Z',
        expiresAt: '2026-11-23T10:00:00.000Z',
        isCurrent: true,
      },
      {
        sessionId: 'sess-other-mobile',
        ipAddress: '10.0.0.1',
        userAgent: 'Safari on iOS',
        browser: 'Safari',
        os: 'iOS',
        createdAt: '2026-11-15T09:00:00.000Z',
        expiresAt: '2026-11-22T09:00:00.000Z',
        isCurrent: false,
      },
      {
        sessionId: 'sess-legacy',
        ipAddress: null,
        userAgent: null,
        browser: 'Unknown browser',
        os: 'Unknown OS',
        createdAt: '2026-11-14T08:00:00.000Z',
        expiresAt: '2026-11-21T08:00:00.000Z',
        isCurrent: false,
      },
    ];

    mockApiGet.mockResolvedValue({ sessions: mockSessions });
    renderWithClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Google Chrome on Windows')).toBeInTheDocument();
    });

    // Row 1: Current session
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.1\.100/)).toBeInTheDocument();
    const currentRow = screen.getByTestId('session-row-sess-current');
    expect(currentRow.querySelector('button')).toBeNull(); // NO revoke button for current session

    // Row 2: Safari on iOS
    expect(screen.getByText('Safari on iOS')).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.1/)).toBeInTheDocument();
    const otherRow = screen.getByTestId('session-row-sess-other-mobile');
    const revokeBtn = otherRow.querySelector('button');
    expect(revokeBtn).not.toBeNull();
    expect(revokeBtn).toHaveTextContent('Revoke');

    // Row 3: Unknown device with Unknown IP
    expect(screen.getByText('Unknown device')).toBeInTheDocument();
    expect(screen.getByText(/Unknown IP/)).toBeInTheDocument();
  });

  it('clicking Revoke calls api.delete with session id', async () => {
    const mockSessions = [
      {
        sessionId: 'sess-to-revoke',
        ipAddress: '172.16.0.5',
        userAgent: 'Firefox on Linux',
        browser: 'Firefox',
        os: 'Linux',
        createdAt: '2026-11-16T08:00:00.000Z',
        expiresAt: '2026-11-23T08:00:00.000Z',
        isCurrent: false,
      },
    ];

    mockApiGet.mockResolvedValue({ sessions: mockSessions });
    mockApiDelete.mockResolvedValue({ message: 'Session revoked successfully' });

    renderWithClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Firefox on Linux')).toBeInTheDocument();
    });

    const revokeButton = screen.getByRole('button', { name: /revoke session on firefox on linux/i });
    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(mockApiDelete).toHaveBeenCalledWith('auth/sessions/sess-to-revoke');
    });
  });

  it('displays error message when revoke mutation fails', async () => {
    const mockSessions = [
      {
        sessionId: 'sess-fail',
        ipAddress: '172.16.0.5',
        userAgent: 'Firefox',
        browser: 'Firefox',
        os: 'Linux',
        createdAt: '2026-11-16T08:00:00.000Z',
        expiresAt: '2026-11-23T08:00:00.000Z',
        isCurrent: false,
      },
    ];

    mockApiGet.mockResolvedValue({ sessions: mockSessions });
    mockApiDelete.mockRejectedValue(new Error('Session not found'));

    renderWithClient(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Firefox on Linux')).toBeInTheDocument();
    });

    const revokeButton = screen.getByRole('button', { name: /revoke/i });
    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Session not found');
    });
  });
});

describe('SettingsPage - Change Password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ sessions: [] });
  });

  // 1. Renders the Change Password card with the three labelled fields and the policy helper text.
  it('renders the Change Password card with the three labelled fields and the policy helper text', () => {
    renderWithClient(<SettingsPage />);

    expect(screen.getByRole('heading', { name: 'Change Password' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument();
    expect(
      screen.getByText('At least 8 characters, with uppercase, lowercase, a number, and a special character.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeInTheDocument();
  });

  // 2. Submitting with a mismatched confirmation shows 'New password and confirmation do not match.' and api.post is NOT called.
  it('submitting with a mismatched confirmation shows "New password and confirmation do not match." and api.post is NOT called', () => {
    renderWithClient(<SettingsPage />);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'CurrentPass123!' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'NewPassword123!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'MismatchPassword123!' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    expect(screen.getByText('New password and confirmation do not match.')).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  // 3. Submitting with a new password shorter than 8 characters shows 'New password must be at least 8 characters long' and api.post is NOT called.
  it('submitting with a new password shorter than 8 characters shows "New password must be at least 8 characters long" and api.post is NOT called', () => {
    renderWithClient(<SettingsPage />);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'CurrentPass123!' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'Short1!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'Short1!' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    expect(screen.getByText('New password must be at least 8 characters long')).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  // 4. A valid submit calls api.post with exactly ('auth/change-password', { currentPassword: '<current>', newPassword: '<new>' }) — no confirmation field in the payload — then shows 'Password changed successfully' and clears all three fields.
  it('a valid submit calls api.post with exactly ("auth/change-password", { currentPassword, newPassword }), shows success banner and clears all three fields', async () => {
    mockApiPost.mockResolvedValue({ message: 'Password changed successfully' });
    renderWithClient(<SettingsPage />);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'CurrentPass123!' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'NewSecurePass123!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'NewSecurePass123!' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('auth/change-password', {
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewSecurePass123!',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Password changed successfully')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  // 5. A server rejection (mocked ApiError with message 'Invalid credentials') shows that message in the error banner.
  it('a server rejection (mocked ApiError with message "Invalid credentials") shows that message in the error banner', async () => {
    mockApiPost.mockRejectedValue(
      new MockApiError(401, { message: 'Invalid credentials' }, 'Invalid credentials')
    );
    renderWithClient(<SettingsPage />);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'WrongPass123!' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'NewSecurePass123!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'NewSecurePass123!' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
    });
  });

  // 6. A deferred-cleanup success response shows the deferred message (the long 'terminating other active sessions failed' text) as the banner content.
  it('a deferred-cleanup success response shows the deferred message as the banner content', async () => {
    const deferredMessage =
      'Password changed successfully, but terminating other active sessions failed. Stale sessions will be invalidated on their next request via security epoch enforcement.';

    mockApiPost.mockResolvedValue({
      message: deferredMessage,
      sessionCleanupDeferred: true,
    });
    renderWithClient(<SettingsPage />);

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'CurrentPass123!' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'NewSecurePass123!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'NewSecurePass123!' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(screen.getByText(deferredMessage)).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });
});
