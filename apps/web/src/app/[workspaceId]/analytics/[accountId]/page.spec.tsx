import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AccountAnalyticsPage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { api, ApiError } from '../../../../lib/api/client';

const mockPush = vi.fn();
const mockBack = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-test-123', accountId: 'acc-li-1' }),
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

vi.mock('../../../../lib/api/client', () => {
  class MockApiError extends Error {
    public status: number;
    public data: unknown;
    public headers: Record<string, string> = {};
    constructor(status: number, data: unknown, message: string) {
      super(message);
      this.status = status;
      this.data = data;
      this.name = 'ApiError';
    }
  }
  return {
    ApiError: MockApiError,
    api: {
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

// Mock recharts ResponsiveContainer to avoid 0x0 size in happy-dom
vi.mock('recharts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="mock-responsive-container" style={{ width: 800, height: 400 }}>
        {children}
      </div>
    ),
  };
});

const mockAccountData = {
  account: {
    id: 'acc-li-1',
    provider: 'LINKEDIN',
    name: 'Executive LinkedIn',
    status: 'ACTIVE',
  },
  metrics: [
    {
      date: '2026-10-25T00:00:00.000Z',
      followers: 1000,
      engagement: 50,
    },
    {
      date: '2026-10-26T00:00:00.000Z',
      followers: 1050,
      engagement: 65,
    },
    {
      date: '2026-10-27T00:00:00.000Z',
      followers: 1100,
      engagement: 80,
    },
  ],
};

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

const renderPage = (client?: QueryClient) => {
  const queryClient = client || createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountAnalyticsPage />
    </QueryClientProvider>
  );
};

describe('AccountAnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading skeleton when fetching account data', () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    renderPage();

    expect(screen.getByRole('status', { name: /loading account metrics/i })).toBeDefined();
    expect(screen.getByText('Loading account metrics...')).toBeDefined();
  });

  it('renders 404 Account Not Found with Go Back button', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(
      new ApiError(404, { message: 'Account not found in workspace' }, 'Account not found')
    );
    renderPage();

    expect(await screen.findByText('Account Not Found')).toBeDefined();
    expect(
      screen.getByText('The account you are looking for does not exist in this workspace.')
    ).toBeDefined();

    const goBackBtn = screen.getByRole('button', { name: /go back/i });
    fireEvent.click(goBackBtn);
    expect(mockBack).toHaveBeenCalled();
  });

  it('renders 403 Access Denied when user lacks permission', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(
      new ApiError(403, { message: 'Forbidden' }, 'Forbidden')
    );
    renderPage();

    expect(await screen.findByText('Access Denied')).toBeDefined();
    expect(
      screen.getByText("You don't have permission to view analytics for this account.")
    ).toBeDefined();
  });

  it('renders generic error with retry action', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(
      new ApiError(500, { message: 'Internal Server Error' }, 'Server error')
    );
    renderPage();

    expect(await screen.findByText('Failed to load analytics')).toBeDefined();

    const retryBtn = screen.getByRole('button', { name: /retry loading analytics/i });
    vi.mocked(api.get).mockResolvedValueOnce(mockAccountData);
    fireEvent.click(retryBtn);

    expect(await screen.findByText('Executive LinkedIn')).toBeDefined();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('renders account details and latest metrics', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockAccountData);
    renderPage();

    expect(await screen.findByText('Executive LinkedIn')).toBeDefined();
    expect(screen.getByText('LinkedIn')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();

    // Summary cards
    expect(screen.getByText('Current Followers')).toBeDefined();
    expect(screen.getByText('1,100')).toBeDefined();
    expect(screen.getByText('Current Engagement')).toBeDefined();
    expect(screen.getByText('80')).toBeDefined();

    // History section
    expect(screen.getByText('Performance History')).toBeDefined();
    expect(screen.getByTestId('mock-responsive-container')).toBeDefined();

    // Endpoint verified
    expect(api.get).toHaveBeenCalledWith('workspaces/ws-test-123/analytics/accounts/acc-li-1');
  });

  it('renders reconnect alert when account status is REAUTH_REQUIRED', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      account: {
        id: 'acc-li-1',
        provider: 'LINKEDIN',
        name: 'Executive LinkedIn',
        status: 'REAUTH_REQUIRED',
      },
      metrics: [],
    });
    renderPage();

    expect(await screen.findByText('Connection Lost')).toBeDefined();
    expect(
      screen.getByText(
        'We can no longer fetch new analytics for this account. Please reconnect to resume data collection.'
      )
    ).toBeDefined();

    const reconnectLink = screen.getByRole('link', { name: /reconnect in accounts/i });
    expect(reconnectLink.getAttribute('href')).toBe('/ws-test-123/accounts');
  });

  it('renders zero-data state when metrics array is empty', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      account: {
        id: 'acc-li-1',
        provider: 'LINKEDIN',
        name: 'Executive LinkedIn',
        status: 'ACTIVE',
      },
      metrics: [],
    });
    renderPage();

    expect(await screen.findByText('No historical data available yet')).toBeDefined();
    expect(screen.getAllByText('--').length).toBe(2);
  });

  it('renders single-data-point state when only 1 metric is available', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      account: {
        id: 'acc-li-1',
        provider: 'LINKEDIN',
        name: 'Executive LinkedIn',
        status: 'ACTIVE',
      },
      metrics: [
        {
          date: '2026-10-27T00:00:00.000Z',
          followers: 500,
          engagement: 25,
        },
      ],
    });
    renderPage();

    expect(await screen.findByText('Not enough data to chart')).toBeDefined();
    expect(screen.getByText(/We have successfully recorded your first data point/i)).toBeDefined();
  });

  it('refreshes account analytics when header Refresh button is clicked', async () => {
    vi.mocked(api.get).mockResolvedValue(mockAccountData);
    renderPage();

    await screen.findByText('Executive LinkedIn');
    expect(api.get).toHaveBeenCalledTimes(1);

    const refreshBtn = screen.getByRole('button', { name: /refresh account analytics/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });
});
