import { render, screen } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import PublishingPage from './page';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('../../../lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient();
});

test('renders approval status badges for pending, approved, and changes requested posts', async () => {
  queryClient.setQueryData(['workspaces', 'ws-1', 'posts', { skip: 0, take: 50 }], [
    {
      id: 'post-1',
      workspaceId: 'ws-1',
      content: 'Pending Post',
      status: 'DRAFT',
      approvalStatus: 'PENDING',
      updatedAt: new Date().toISOString(),
      media: [],
      variants: [],
    },
    {
      id: 'post-2',
      workspaceId: 'ws-1',
      content: 'Approved Post',
      status: 'DRAFT',
      approvalStatus: 'APPROVED',
      updatedAt: new Date().toISOString(),
      media: [],
      variants: [],
    },
    {
      id: 'post-3',
      workspaceId: 'ws-1',
      content: 'Changes Requested Post',
      status: 'DRAFT',
      approvalStatus: 'CHANGES_REQUESTED',
      updatedAt: new Date().toISOString(),
      media: [],
      variants: [],
    },
    {
      id: 'post-4',
      workspaceId: 'ws-1',
      content: 'Unsubmitted Post',
      status: 'DRAFT',
      approvalStatus: 'NOT_SUBMITTED',
      updatedAt: new Date().toISOString(),
      media: [],
      variants: [],
    },
  ]);

  render(
    <QueryClientProvider client={queryClient}>
      <PublishingPage />
    </QueryClientProvider>,
  );

  expect(await screen.findByText('Pending Approval')).toBeInTheDocument();
  expect(screen.getByText('Approved')).toBeInTheDocument();
  expect(screen.getByText('Changes Requested')).toBeInTheDocument();
  expect(screen.queryByText('Not Submitted')).not.toBeInTheDocument();
});
