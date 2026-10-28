import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AnalyticsDashboard from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { api, ApiError } from '../../../lib/api/client';

const mockPush = vi.fn();
let currentWorkspaceId = 'ws-test-123';

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: currentWorkspaceId }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('../../../lib/api/client', () => {
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

const mockOverviewData = {
  workspaceId: 'ws-test-123',
  accountsConnected: 3,
  accountsActive: 2,
  accountsRequiringReauth: 1,
  totalFollowers: 12500,
  totalEngagement: 850,
  accounts: [
    {
      id: 'acc-li-1',
      provider: 'LINKEDIN',
      name: 'Agency LinkedIn',
      status: 'ACTIVE',
      latestMetrics: {
        date: '2026-10-27T00:00:00.000Z',
        followers: 7500,
        engagement: 500,
      },
    },
    {
      id: 'acc-yt-2',
      provider: 'YOUTUBE',
      name: 'Agency Channel',
      status: 'REAUTH_REQUIRED',
      latestMetrics: {
        date: '2026-10-26T00:00:00.000Z',
        followers: 5000,
        engagement: 350,
      },
    },
    {
      id: 'acc-tw-3',
      provider: 'TWITTER',
      name: 'Agency Twitter',
      status: 'ACTIVE',
      latestMetrics: null,
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

const renderDashboard = (client?: QueryClient) => {
  const queryClient = client || createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AnalyticsDashboard />
    </QueryClientProvider>
  );
};

describe('AnalyticsDashboard Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentWorkspaceId = 'ws-test-123';
  });

  it('renders loading skeleton when fetching overview', () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    renderDashboard();

    expect(screen.getByRole('status', { name: /loading analytics/i })).toBeDefined();
    expect(screen.getByText('Loading analytics...')).toBeDefined();
  });

  it('renders metric cards and account list with real API data', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
    renderDashboard();

    // Metric cards
    expect(await screen.findByText('12,500')).toBeDefined();
    expect(screen.getByText('Total Followers')).toBeDefined();
    expect(screen.getByText('850')).toBeDefined();
    expect(screen.getByText('Total Engagement')).toBeDefined();
    expect(screen.getByText('Connected Accounts')).toBeDefined();
    expect(screen.getByText('Active Accounts')).toBeDefined();

    // Accounts
    expect(screen.getByText('Agency LinkedIn')).toBeDefined();
    expect(screen.getByText('LinkedIn')).toBeDefined();
    expect(screen.getByText('7,500')).toBeDefined();

    expect(screen.getByText('Agency Channel')).toBeDefined();
    expect(screen.getByText('YouTube')).toBeDefined();
    expect(screen.getByText('5,000')).toBeDefined();

    expect(screen.getByText('Agency Twitter')).toBeDefined();
    expect(screen.getByText('Twitter / X')).toBeDefined();

    // Tenancy verification: check API endpoint called with workspaceId
    expect(api.get).toHaveBeenCalledWith('workspaces/ws-test-123/analytics/overview');
  });

  it('handles missing metrics honestly with "No analytics data yet"', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
    renderDashboard();

    expect(await screen.findByText('No analytics data yet')).toBeDefined();
  });

  it('renders reconnection banner when accounts need re-auth', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
    renderDashboard();

    expect(
      await screen.findByText('Action Required: 1 account needs reconnection')
    ).toBeDefined();
    const accountsLinks = screen.getAllByRole('link', { name: /go to accounts/i });
    expect(accountsLinks[0].getAttribute('href')).toBe('/ws-test-123/accounts');
  });

  it('renders plural reconnection banner when multiple accounts need re-auth', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...mockOverviewData,
      accountsRequiringReauth: 3,
    });
    renderDashboard();

    expect(
      await screen.findByText('Action Required: 3 accounts need reconnection')
    ).toBeDefined();
  });

  it('renders empty state when accountsConnected is 0', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      workspaceId: 'ws-test-123',
      accountsConnected: 0,
      accountsActive: 0,
      accountsRequiringReauth: 0,
      totalFollowers: 0,
      totalEngagement: 0,
      accounts: [],
    });
    renderDashboard();

    expect(await screen.findByText('No data available')).toBeDefined();
    expect(
      screen.getByText(
        'Connect your social media accounts to start seeing followers, engagement, and performance metrics here.'
      )
    ).toBeDefined();

    const link = screen.getByRole('link', { name: /go to accounts/i });
    expect(link.getAttribute('href')).toBe('/ws-test-123/accounts');
  });

  it('renders 403 Access Denied state', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(
      new ApiError(403, { message: 'Forbidden' }, 'Forbidden')
    );
    renderDashboard();

    expect(await screen.findByText('Access Denied')).toBeDefined();
    expect(
      screen.getByText("You don't have permission to view analytics in this workspace.")
    ).toBeDefined();
  });

  it('renders generic error state with working Retry button', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(
      new ApiError(500, { message: 'Internal Server Error' }, 'Internal Server Error')
    );
    renderDashboard();

    expect(await screen.findByText('Failed to load analytics')).toBeDefined();

    const retryBtn = screen.getByRole('button', { name: /retry loading analytics/i });
    expect(retryBtn).toBeDefined();

    // Now mock success for retry
    vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
    fireEvent.click(retryBtn);

    expect(await screen.findByText('12,500')).toBeDefined();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('triggers refetch when header Refresh button is clicked', async () => {
    vi.mocked(api.get).mockResolvedValue(mockOverviewData);
    renderDashboard();

    await screen.findByText('12,500');
    expect(api.get).toHaveBeenCalledTimes(1);

    const refreshBtn = screen.getByRole('button', { name: /refresh analytics data/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });

  it('renders accessible link to account drill-down', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
    renderDashboard();

    await screen.findByText('Agency LinkedIn');
    const drilldownLink = screen.getByRole('link', {
      name: /view details for agency linkedin/i,
    });
    expect(drilldownLink.getAttribute('href')).toBe('/ws-test-123/analytics/acc-li-1');
  });

  it('renders appropriate status badges for different account statuses', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...mockOverviewData,
      accounts: [
        {
          id: 'acc-1',
          provider: 'LINKEDIN',
          name: 'Active Account',
          status: 'ACTIVE',
          latestMetrics: null,
        },
        {
          id: 'acc-2',
          provider: 'YOUTUBE',
          name: 'Reauth Account',
          status: 'REAUTH_REQUIRED',
          latestMetrics: null,
        },
        {
          id: 'acc-3',
          provider: 'TWITTER',
          name: 'Disconnected Account',
          status: 'DISCONNECTED',
          latestMetrics: null,
        },
      ],
    });
    renderDashboard();

    expect(await screen.findByText('Active')).toBeDefined();
    expect(screen.getByText('Reauth Required')).toBeDefined();
    expect(screen.getByText('Disconnected')).toBeDefined();
  });
});
