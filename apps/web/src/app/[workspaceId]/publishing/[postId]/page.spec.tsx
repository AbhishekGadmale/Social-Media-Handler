import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import PostDetailPage from './page';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../../../../lib/api/client';

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1', postId: 'post-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('../../../../lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient();
  vi.stubGlobal('alert', vi.fn());
});

const renderPage = (variantStatus = 'PUBLISHED', externalPostId: string | null = 'ext-123') => {
  queryClient.setQueryData(['workspaces', 'ws-1', 'posts', 'post-1'], {
    id: 'post-1',
    workspaceId: 'ws-1',
    content: 'Hello World',
    status: variantStatus,
    media: [],
    variants: [
      {
        id: 'var-1',
        postId: 'post-1',
        socialAccountId: 'acc-1',
        status: variantStatus,
        externalPostId,
        canonicalUrl: 'https://linkedin.com/post/123',
        socialAccount: { name: 'My LinkedIn', provider: 'LINKEDIN' }
      }
    ]
  });

  render(
    <QueryClientProvider client={queryClient}>
      <PostDetailPage />
    </QueryClientProvider>
  );
};

test('A & E. delete action visible for eligible LinkedIn published variant, correct identifiers sent', async () => {
  renderPage('PUBLISHED', 'ext-123');
  const deleteBtn = await screen.findByRole('button', { name: /Delete Post/i });
  expect(deleteBtn).toBeInTheDocument();
  
  fireEvent.click(deleteBtn); // C. confirmation required
  expect(screen.getByText('Delete from LINKEDIN?')).toBeInTheDocument();
  
  const confirmBtn = screen.getByRole('button', { name: /Confirm Delete/i });
  fireEvent.click(confirmBtn);
  
  expect(api.delete).toHaveBeenCalledWith('workspaces/ws-1/publications/var-1/remote');
});

test('B. delete action NOT visible for ineligible status or missing external ID', async () => {
  // Missing external ID
  renderPage('PUBLISHED', null);
  expect(screen.queryByRole('button', { name: /Delete Post/i })).not.toBeInTheDocument();

  // Or not published
  renderPage('FAILED', 'ext-123');
  expect(screen.queryByRole('button', { name: /Delete Post/i })).not.toBeInTheDocument();
});

test('D. cancelling confirmation makes no API request', async () => {
  renderPage('PUBLISHED', 'ext-123');
  fireEvent.click(await screen.findByRole('button', { name: /Delete Post/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  
  expect(screen.queryByText('Delete from LINKEDIN?')).not.toBeInTheDocument();
  expect(api.delete).not.toHaveBeenCalled();
});

test('F & G. DELETING and DELETED states render correctly', async () => {
  renderPage('DELETING', 'ext-123');
  expect(await screen.findByText('DELETING')).toHaveClass('bg-orange-200');
  
  renderPage('DELETED', 'ext-123');
  expect(await screen.findByText('DELETED')).toHaveClass('line-through');
});

test('H. API failure does not falsely display DELETED and shows error', async () => {
  renderPage('PUBLISHED', 'ext-123');
  
  // Mock API failure
  (api.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network Error'));
  
  // Mock window alert
  const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});

  fireEvent.click(await screen.findByRole('button', { name: /Delete Post/i }));
  fireEvent.click(screen.getByRole('button', { name: /Confirm Delete/i }));
  
  await waitFor(() => {
    expect(alertMock).toHaveBeenCalledWith('Network Error');
  });
  
  // Shouldn't mutate cache directly to DELETED if API failed
  const cacheData = queryClient.getQueryData<{ variants: { status: string }[] }>(['workspaces', 'ws-1', 'posts', 'post-1']);
  expect(cacheData?.variants[0].status).toBe('PUBLISHED'); // remains published
});

test('I. success invalidates/refetches the relevant query', async () => {
  renderPage('PUBLISHED', 'ext-123');
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  
  (api.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
  
  fireEvent.click(await screen.findByRole('button', { name: /Delete Post/i }));
  fireEvent.click(screen.getByRole('button', { name: /Confirm Delete/i }));
  
  await waitFor(() => {
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaces', 'ws-1', 'posts', 'post-1'] });
  });
});
