import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccountCard } from './account-card';
import { ConnectedAccount } from '../lib/query/accounts';
import { api } from '../lib/api/client';

vi.mock('../lib/api/client', () => ({
  api: {
    post: vi.fn(),
  },
}));

const baseAccount: ConnectedAccount = {
  id: 'acc-1',
  workspaceId: 'ws-1',
  provider: 'YOUTUBE',
  externalId: 'ext-1',
  name: 'My YouTube Channel',
  capabilities: [],
  status: 'ACTIVE',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('AccountCard Capabilities UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. YouTube publishing-enabled account shows publishing capability', () => {
    const account = { ...baseAccount, capabilities: ['POST_PUBLISH', 'ACCOUNT_READ'] };
    render(<AccountCard account={account} />);
    expect(screen.getByText('Publishing: Enabled')).toBeInTheDocument();
    expect(screen.getByText('Account Read: Enabled')).toBeInTheDocument();
  });

  it('2. YouTube account lacking publishing capability does NOT falsely show enabled', () => {
    const account = { ...baseAccount, capabilities: ['ACCOUNT_READ'] };
    render(<AccountCard account={account} />);
    expect(screen.queryByText('Publishing: Enabled')).not.toBeInTheDocument();
    expect(screen.getByText('Publishing: Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Reconnect account to grant required permission')).toBeInTheDocument();
  });

  it('3. LinkedIn capability display uses LinkedIn-specific data', () => {
    const account = { ...baseAccount, provider: 'LINKEDIN', capabilities: ['ACCOUNT_READ'] };
    render(<AccountCard account={account} />);
    expect(screen.getByText('Publishing: Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Account Read: Enabled')).toBeInTheDocument();
  });

  it('4. provider capabilities do not leak across accounts', () => {
    const ytAccount = { ...baseAccount, id: 'acc-1', provider: 'YOUTUBE', capabilities: ['POST_PUBLISH'] };
    const liAccount = { ...baseAccount, id: 'acc-2', provider: 'LINKEDIN', capabilities: [] };

    const { container } = render(
      <div>
        <AccountCard account={ytAccount} />
        <AccountCard account={liAccount} />
      </div>
    );

    const cards = container.querySelectorAll('.bg-white.border.rounded-lg');
    expect(cards[0].textContent).toContain('Publishing: Enabled');
    expect(cards[0].textContent).not.toContain('Publishing: Unavailable');

    expect(cards[1].textContent).toContain('Publishing: Unavailable');
    expect(cards[1].textContent).not.toContain('Publishing: Enabled');
  });

  it('5. reconnect/action appears only when supported and needed', async () => {
    // Missing publish scope -> shows reconnect
    const account = { ...baseAccount, provider: 'LINKEDIN', capabilities: [] };
    render(<AccountCard account={account} />);
    const btn = screen.getByRole('button', { name: /Grant Publishing Access/i });
    expect(btn).toBeInTheDocument();

    // With publish scope -> NO reconnect
    const accountWithScope = { ...baseAccount, provider: 'LINKEDIN', capabilities: ['POST_PUBLISH'] };
    cleanup();
    render(<AccountCard account={accountWithScope} />);
    expect(screen.queryByRole('button', { name: /Grant Publishing Access/i })).not.toBeInTheDocument();
  });

  it('6. normal connected account UI still renders', () => {
    const account = { ...baseAccount, name: 'Awesome Brand' };
    render(<AccountCard account={account} />);
    expect(screen.getByText('Awesome Brand')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('7. raw secrets/tokens are never rendered', () => {
    const account = { ...baseAccount, capabilities: ['POST_PUBLISH'] };
    const { container } = render(<AccountCard account={account} />);
    // There are no tokens in the connected account DTO, but verify anyway
    expect(container.textContent).not.toContain('token');
  });

  it('8. unknown/unsupported capability data fails safely', () => {
    const account = { ...baseAccount, provider: 'UNKNOWN_PROVIDER', capabilities: ['UNKNOWN_CAP'] };
    render(<AccountCard account={account} />);
    // Should render name but neither publishing enabled nor unavailable
    expect(screen.getByText('My YouTube Channel')).toBeInTheDocument();
    expect(screen.queryByText(/Publishing:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Account Read:/)).not.toBeInTheDocument();
  });

  it('triggers the correct OAuth endpoint when Grant Publishing Access is clicked (LinkedIn)', async () => {
    const account = { ...baseAccount, provider: 'LINKEDIN', capabilities: [] };
    render(<AccountCard account={account} />);

    vi.mocked(api.post).mockResolvedValueOnce({ url: 'http://auth.url' });

    const btn = screen.getByRole('button', { name: /Grant Publishing Access/i });
    fireEvent.click(btn);

    expect(api.post).toHaveBeenCalledWith('workspaces/ws-1/oauth/linkedin/connect?scopes=w_member_social');
  });

  it('triggers the correct OAuth endpoint when Grant Publishing Access is clicked (YouTube)', async () => {
    const account = { ...baseAccount, provider: 'YOUTUBE', capabilities: [] };
    render(<AccountCard account={account} />);

    vi.mocked(api.post).mockResolvedValueOnce({ url: 'http://auth.url' });

    const btn = screen.getByRole('button', { name: /Grant Publishing Access/i });
    fireEvent.click(btn);

    expect(api.post).toHaveBeenCalledWith('workspaces/ws-1/oauth/youtube/connect');
  });
});
