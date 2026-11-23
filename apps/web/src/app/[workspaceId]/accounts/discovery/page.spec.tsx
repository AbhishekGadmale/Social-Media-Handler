import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DiscoveryPage from './page';
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

describe('DiscoveryPage (Server Page Component)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps async params Promise and queries discovery session with real workspaceId', async () => {
    const workspaceId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockGet.mockReturnValue('disc-1');
    mockApiGet.mockResolvedValue({
      id: 'disc-1',
      provider: 'META',
      profiles: [{ id: 'p1', name: 'Page One', avatarUrl: null, provider: 'FACEBOOK' }],
    });

    const params = Promise.resolve({ workspaceId });
    const pageElement = await DiscoveryPage({ params });

    render(pageElement, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Page One')).toBeInTheDocument();
    });

    expect(mockApiGet).toHaveBeenCalledWith(
      `workspaces/${workspaceId}/oauth/discoveries/disc-1`
    );
    expect(mockApiGet).not.toHaveBeenCalledWith(
      'workspaces/undefined/oauth/discoveries/disc-1'
    );
  });
});
