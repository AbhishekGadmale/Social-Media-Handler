import { render, screen } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import NewDraftPage from './page';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('../../../../lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../../../components/media-uploader', () => ({
  MediaUploader: () => <div data-testid="media-uploader">Media Uploader</div>,
}));

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

test('renders draft composer for OWNER or EDITOR', async () => {
  queryClient.setQueryData(['auth', 'me'], {
    user: { id: 'usr-1', email: 'owner@example.com' },
    memberships: [
      {
        id: 'mem-1',
        workspaceId: 'ws-1',
        userId: 'usr-1',
        role: 'OWNER',
        workspace: { id: 'ws-1', name: 'Test Agency' },
      },
    ],
  });

  render(
    <QueryClientProvider client={queryClient}>
      <NewDraftPage />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole('heading', { name: 'New Draft' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /save draft/i })).toBeInTheDocument();
});

test('renders access-denied state for CLIENT_APPROVER without redirect', async () => {
  queryClient.setQueryData(['auth', 'me'], {
    user: { id: 'usr-2', email: 'approver@example.com' },
    memberships: [
      {
        id: 'mem-2',
        workspaceId: 'ws-1',
        userId: 'usr-2',
        role: 'CLIENT_APPROVER',
        workspace: { id: 'ws-1', name: 'Test Agency' },
      },
    ],
  });

  render(
    <QueryClientProvider client={queryClient}>
      <NewDraftPage />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole('heading', { name: 'Access Denied' })).toBeInTheDocument();
  expect(
    screen.getByText(
      "Access denied — you don't have permission to create posts in this workspace.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument();
});
