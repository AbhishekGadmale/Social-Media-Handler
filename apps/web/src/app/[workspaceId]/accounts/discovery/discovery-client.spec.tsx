import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DiscoveryClientPage from './discovery-client';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockPush = vi.fn();
const mockGet = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: mockGet }),
}));

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('../../../../lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'QueryClientWrapper';
  return Wrapper;
};

describe('DiscoveryClientPage', () => {
  const workspaceId = 'ws-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. missing discoveryId -> safe error', () => {
    mockGet.mockReturnValue(null);
    render(<DiscoveryClientPage workspaceId={workspaceId} />, { wrapper: createWrapper() });

    expect(screen.getByText('Invalid Request')).toBeInTheDocument();
    expect(screen.getByText('Missing connection session ID.')).toBeInTheDocument();
  });

  it('2. loading state', () => {
    mockGet.mockReturnValue('disc-1');
    mockApiGet.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(<DiscoveryClientPage workspaceId={workspaceId} />, { wrapper: createWrapper() });
    expect(screen.getByRole('status')).toHaveTextContent('Loading discovered accounts...');
  });

  it('3/4/5/16. renders accounts accurately, no tokens rendered, safe fallbacks', async () => {
    mockGet.mockReturnValue('disc-1');
    mockApiGet.mockResolvedValue({
      id: 'disc-1',
      provider: 'META',
      profiles: [
        { id: 'p1', name: 'Page One', avatarUrl: null, provider: 'FACEBOOK' },
        { id: 'p2', name: 'Page Two', avatarUrl: 'img.png', provider: null }, // Fallback to META
        { id: 'p3', name: null, avatarUrl: null, provider: 'UNKNOWN' } // Fallback to Social account
      ]
    });

    render(<DiscoveryClientPage workspaceId={workspaceId} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Page One')).toBeInTheDocument();
    });

    // Types
    expect(screen.getAllByText('Facebook Page')).toHaveLength(2); // p1 and p2(fallback to META)
    expect(screen.getByText('Social account')).toBeInTheDocument(); // p3

    // No credentials shown (we didn't even mock any but making sure the DOM doesn't expect them)
    expect(screen.queryByText(/token|secret|credential/i)).not.toBeInTheDocument();
  });

  it('6/7/8. selection toggles, count updates, disables submit if none', async () => {
    const user = userEvent.setup();
    mockGet.mockReturnValue('disc-1');
    mockApiGet.mockResolvedValue({
      id: 'disc-1',
      provider: 'META',
      profiles: [
        { id: 'p1', name: 'Page One' },
        { id: 'p2', name: 'Page Two' }
      ]
    });

    render(<DiscoveryClientPage workspaceId={workspaceId} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Page One')).toBeInTheDocument();
    });

    // Default is all selected
    expect(screen.getByText(/of 2 selected/i)).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();

    // Toggle off p1
    await user.click(checkboxes[0]);
    expect(screen.getByText(/1 of 2 selected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Accounts' })).not.toBeDisabled();

    // Toggle off p2
    await user.click(checkboxes[1]);
    expect(screen.getByText(/0 of 2 selected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Accounts' })).toBeDisabled();

    // Labels are accessible
    expect(checkboxes[0]).toHaveAccessibleName('Select Page One');
  });

  it('9/10/11. submit sends only profileIds, prevents double submit, redirects on success', async () => {
    const user = userEvent.setup();
    mockGet.mockReturnValue('disc-1');
    mockApiGet.mockResolvedValue({
      id: 'disc-1',
      provider: 'META',
      profiles: [{ id: 'p1', name: 'Page One' }, { id: 'p2', name: 'Page Two' }]
    });

    // Mock post with a slight delay
    mockApiPost.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 10)));

    render(<DiscoveryClientPage workspaceId={workspaceId} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Page One')).toBeInTheDocument();
    });

    // Submit
    const connectBtn = screen.getByRole('button', { name: 'Connect Accounts' });
    await user.click(connectBtn);

    // Double submit prevent
    expect(connectBtn).toBeDisabled();
    expect(connectBtn).toHaveTextContent('Connecting...');

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('workspaces/ws-1/oauth/discoveries/disc-1/select', {
        profileIds: ['p1', 'p2']
      });
      expect(mockPush).toHaveBeenCalledWith('/ws-1/accounts');
    });
  });

  it('12/13/14. expired/403/error discovery shows reconnect message safely', async () => {
    mockGet.mockReturnValue('disc-1');
    mockApiGet.mockRejectedValue(new Error('404 Not Found'));

    render(<DiscoveryClientPage workspaceId={workspaceId} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Session Expired')).toBeInTheDocument();
    });

    // Does not expose raw error
    expect(screen.queryByText('404 Not Found')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/session expired or is invalid/i);
  });

  it('15. cancel navigates to accounts without consuming', async () => {
    const user = userEvent.setup();
    mockGet.mockReturnValue('disc-1');
    mockApiGet.mockResolvedValue({
      id: 'disc-1',
      provider: 'META',
      profiles: [{ id: 'p1', name: 'Page One' }]
    });

    render(<DiscoveryClientPage workspaceId={workspaceId} />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Page One')).toBeInTheDocument();
    });

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelBtn);

    expect(mockApiPost).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/ws-1/accounts');
  });
});

