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
    patch: vi.fn(),
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


// === YOUTUBE TARGET OPTIONS TESTS ===

const renderWithMultipleVariants = (variants: Array<Record<string, unknown>>) => {
  queryClient.setQueryData(['workspaces', 'ws-1', 'posts', 'post-1'], {
    id: 'post-1',
    workspaceId: 'ws-1',
    content: 'Hello World',
    status: 'DRAFT',
    media: [],
    variants,
  });

  render(
    <QueryClientProvider client={queryClient}>
      <PostDetailPage />
    </QueryClientProvider>
  );
};

test('YouTube target renders categoryId and tags fields, LinkedIn does not', async () => {
  renderWithMultipleVariants([
    {
      id: 'var-yt',
      postId: 'post-1',
      socialAccountId: 'acc-yt',
      status: 'DRAFT',
      providerOptions: { categoryId: '22', tags: ['music', 'live'] },
      socialAccount: { name: 'My YouTube', provider: 'YOUTUBE' }
    },
    {
      id: 'var-li',
      postId: 'post-1',
      socialAccountId: 'acc-li',
      status: 'DRAFT',
      providerOptions: {},
      socialAccount: { name: 'My LinkedIn', provider: 'LINKEDIN' }
    }
  ]);

  // 1 & 2. YouTube renders fields
  expect(screen.getByPlaceholderText('e.g. 22')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('e.g. tag1, tag2, tag3')).toBeInTheDocument();

  // 3. LinkedIn does NOT render YouTube-only fields (only 1 of each exists in the whole DOM)
  expect(screen.getAllByPlaceholderText('e.g. 22')).toHaveLength(1);
  expect(screen.getAllByPlaceholderText('e.g. tag1, tag2, tag3')).toHaveLength(1);

  // 4 & 5. existing metadata hydrates correctly
  expect(screen.getByDisplayValue('22')).toBeInTheDocument();
  expect(screen.getByDisplayValue('music, live')).toBeInTheDocument();
});

test('Category/Tags change updates the correct YouTube target only, cleans whitespace/empty', async () => {
  renderWithMultipleVariants([
    {
      id: 'var-yt',
      postId: 'post-1',
      socialAccountId: 'acc-yt',
      status: 'DRAFT',
      providerOptions: { privacyStatus: 'PRIVATE' },
      socialAccount: { name: 'My YouTube', provider: 'YOUTUBE' }
    }
  ]);

  const catInput = screen.getByPlaceholderText('e.g. 22');
  const tagsInput = screen.getByPlaceholderText('e.g. tag1, tag2, tag3');

  // 6. category change updates correct target
  fireEvent.change(catInput, { target: { value: '27' } });
  fireEvent.blur(catInput);

  await waitFor(() => {
    expect(api.patch).toHaveBeenCalledWith(
      'workspaces/ws-1/publications/var-yt',
      expect.objectContaining({
        providerOptions: expect.objectContaining({
          categoryId: '27',
          privacyStatus: 'PRIVATE'
        })
      })
    );
  });

  (api.patch as ReturnType<typeof vi.fn>).mockClear();

  // 7 & 8. commas to array, whitespace/empty cleaned
  fireEvent.change(tagsInput, { target: { value: ' tech,  programming ,, software  ' } });
  fireEvent.blur(tagsInput);

  await waitFor(() => {
    expect(api.patch).toHaveBeenCalledWith(
      'workspaces/ws-1/publications/var-yt',
      expect.objectContaining({
        providerOptions: expect.objectContaining({
          tags: ['tech', 'programming', 'software']
        })
      })
    );
  });
});
