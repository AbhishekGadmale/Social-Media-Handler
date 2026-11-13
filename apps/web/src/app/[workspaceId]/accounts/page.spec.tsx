import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AccountsPage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ConnectedAccount } from '../../../lib/query/accounts';

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-test-123' }),
}));

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('../../../lib/api/client', () => ({
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

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'QueryClientWrapper';
  return Wrapper;
};

const createMockAccount = (overrides: Partial<ConnectedAccount> = {}): ConnectedAccount => ({
  id: 'acc-1',
  workspaceId: 'ws-test-123',
  provider: 'FACEBOOK',
  externalId: 'ext-1',
  name: 'Test Account',
  capabilities: ['POST_PUBLISH', 'ACCOUNT_READ'],
  status: 'ACTIVE',
  createdAt: '2026-11-13T12:00:00Z',
  updatedAt: '2026-11-13T12:00:00Z',
  ...overrides,
});

describe('AccountsPage - Meta (Facebook & Instagram) Connect Buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.href = 'http://localhost:3000/ws-test-123/accounts';
  });

  it('(a) empty state renders all four buttons: Connect YouTube, Connect LinkedIn, Connect Facebook, Connect Instagram', async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });

    render(<AccountsPage />, { wrapper: createWrapper() });

    expect(await screen.findByRole('button', { name: 'Connect YouTube' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect LinkedIn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Facebook' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Instagram' })).toBeInTheDocument();
  });

  it('(b) clicking Connect Facebook calls api.post with exactly workspaces/<workspaceId>/oauth/facebook/connect (no query string) and assigns window.location.href', async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockResolvedValueOnce({ url: 'https://www.facebook.com/v20.0/dialog/oauth?test=fb' });
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const fbBtn = await screen.findByRole('button', { name: 'Connect Facebook' });
    await user.click(fbBtn);

    expect(mockApiPost).toHaveBeenCalledWith('workspaces/ws-test-123/oauth/facebook/connect');
    expect(window.location.href).toBe('https://www.facebook.com/v20.0/dialog/oauth?test=fb');
  });

  it('(c) clicking Connect Instagram calls api.post with exactly workspaces/<workspaceId>/oauth/instagram/connect and assigns window.location.href', async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockResolvedValueOnce({ url: 'https://www.facebook.com/v20.0/dialog/oauth?test=ig' });
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const igBtn = await screen.findByRole('button', { name: 'Connect Instagram' });
    await user.click(igBtn);

    expect(mockApiPost).toHaveBeenCalledWith('workspaces/ws-test-123/oauth/instagram/connect');
    expect(window.location.href).toBe('https://www.facebook.com/v20.0/dialog/oauth?test=ig');
  });

  it('(d) api.post rejecting on the Facebook click shows Failed to initiate Facebook connection. Please try again.', async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockRejectedValueOnce(new Error('Network error'));
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const fbBtn = await screen.findByRole('button', { name: 'Connect Facebook' });
    await user.click(fbBtn);

    expect(await screen.findByText('Failed to initiate Facebook connection. Please try again.')).toBeInTheDocument();
  });

  it('(d) api.post rejecting on the Instagram click shows Failed to initiate Instagram connection. Please try again.', async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockRejectedValueOnce(new Error('Network error'));
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const igBtn = await screen.findByRole('button', { name: 'Connect Instagram' });
    await user.click(igBtn);

    expect(await screen.findByText('Failed to initiate Instagram connection. Please try again.')).toBeInTheDocument();
  });

  it('(e) with an ACTIVE FACEBOOK account in the list, Connect Facebook is NOT rendered and Connect Instagram IS rendered (header row)', async () => {
    mockApiGet.mockResolvedValueOnce({
      accounts: [createMockAccount({ provider: 'FACEBOOK', status: 'ACTIVE' })],
    });

    render(<AccountsPage />, { wrapper: createWrapper() });

    expect(await screen.findByText('Connected Accounts')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Connect Instagram' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Facebook' })).not.toBeInTheDocument();
  });

  it('(e) with an ACTIVE INSTAGRAM account in the list, Connect Facebook IS rendered and Connect Instagram is NOT rendered (header row)', async () => {
    mockApiGet.mockResolvedValueOnce({
      accounts: [createMockAccount({ provider: 'INSTAGRAM', status: 'ACTIVE' })],
    });

    render(<AccountsPage />, { wrapper: createWrapper() });

    expect(await screen.findByText('Connected Accounts')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Connect Facebook' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Instagram' })).not.toBeInTheDocument();
  });

  it('(f) a DISCONNECTED FACEBOOK account does NOT hide Connect Facebook (header row)', async () => {
    mockApiGet.mockResolvedValueOnce({
      accounts: [createMockAccount({ provider: 'FACEBOOK', status: 'DISCONNECTED' })],
    });

    render(<AccountsPage />, { wrapper: createWrapper() });

    expect(await screen.findByText('Connected Accounts')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Connect Facebook' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Instagram' })).toBeInTheDocument();
  });

  it('(g) regression: Connect YouTube still posts to workspaces/<workspaceId>/oauth/youtube/connect', async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockResolvedValueOnce({ url: 'https://accounts.google.com/o/oauth2/v2/auth' });
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const ytBtn = await screen.findByRole('button', { name: 'Connect YouTube' });
    await user.click(ytBtn);

    expect(mockApiPost).toHaveBeenCalledWith('workspaces/ws-test-123/oauth/youtube/connect');
    expect(window.location.href).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it('(g) regression: Connect LinkedIn still posts to workspaces/<workspaceId>/oauth/linkedin/connect?scopes=w_member_social', async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockResolvedValueOnce({ url: 'https://www.linkedin.com/oauth/v2/authorization' });
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const liBtn = await screen.findByRole('button', { name: 'Connect LinkedIn' });
    await user.click(liBtn);

    expect(mockApiPost).toHaveBeenCalledWith('workspaces/ws-test-123/oauth/linkedin/connect?scopes=w_member_social');
    expect(window.location.href).toBe('https://www.linkedin.com/oauth/v2/authorization');
  });

  it('(h) disables all connect buttons while any connect is in flight', async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    let resolvePost: (value: { url: string }) => void;
    mockApiPost.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePost = resolve;
    }));
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const fbBtn = await screen.findByRole('button', { name: 'Connect Facebook' });
    const igBtn = screen.getByRole('button', { name: 'Connect Instagram' });
    const ytBtn = screen.getByRole('button', { name: 'Connect YouTube' });
    const liBtn = screen.getByRole('button', { name: 'Connect LinkedIn' });

    await user.click(fbBtn);

    expect(fbBtn).toBeDisabled();
    expect(igBtn).toBeDisabled();
    expect(ytBtn).toBeDisabled();
    expect(liBtn).toBeDisabled();

    resolvePost!({ url: 'https://www.facebook.com/v20.0/dialog/oauth?test=done' });
  });
});
