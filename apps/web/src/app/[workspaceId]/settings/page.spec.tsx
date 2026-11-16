import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockApiGet = vi.fn();
const mockApiDelete = vi.fn();

vi.mock('../../../lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
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
