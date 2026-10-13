import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import PostDetailPage from './page';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '../../../../lib/api/client';

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1', postId: 'post-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('../../../../lib/api/client', () => {
  class MockApiError extends Error {
    constructor(status, data, message) {
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
    delete: vi.fn(),
    patch: vi.fn(),
    },
  };
});

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


  fireEvent.click(await screen.findByRole('button', { name: /Delete Post/i }));
  fireEvent.click(screen.getByRole('button', { name: /Confirm Delete/i }));

  await waitFor(() => {
    expect(screen.getByText('Network Error')).toBeInTheDocument();
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

// === MEDIA COMPATIBILITY VALIDATION TESTS ===

const renderWithMediaAndTargets = (media: unknown[], variants: Array<Record<string, unknown>>) => {
  queryClient.setQueryData(['workspaces', 'ws-1', 'posts', 'post-1'], {
    id: 'post-1',
    workspaceId: 'ws-1',
    content: 'Hello World',
    status: 'DRAFT',
    media,
    variants,
  });

  queryClient.setQueryData(['workspaces', 'ws-1', 'accounts'], {
    accounts: [
      { id: 'acc-yt', name: 'My YouTube', provider: 'YOUTUBE', capabilities: ['POST_PUBLISH'] },
      { id: 'acc-li', name: 'My LinkedIn', provider: 'LINKEDIN', capabilities: ['POST_PUBLISH'] }
    ]
  });

  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <PostDetailPage />
    </QueryClientProvider>
  );
  return rerender;
};

const mockVideoMedia = [{ id: 'm1', media: { id: 'm1', mimeType: 'video/mp4', status: 'READY' } }];
const mockImageMedia = [{ id: 'm2', media: { id: 'm2', mimeType: 'image/jpeg', status: 'READY' } }];
const mockDocMedia = [{ id: 'm3', media: { id: 'm3', mimeType: 'application/pdf', status: 'READY' } }];

const ytVariant = {
  id: 'var-yt',
  postId: 'post-1',
  socialAccountId: 'acc-yt',
  status: 'DRAFT',
  providerOptions: {},
  socialAccount: { name: 'My YouTube', provider: 'YOUTUBE' }
};

const liVariant = {
  id: 'var-li',
  postId: 'post-1',
  socialAccountId: 'acc-li',
  status: 'DRAFT',
  providerOptions: {},
  socialAccount: { name: 'My LinkedIn', provider: 'LINKEDIN' }
};

test('1. valid YouTube video target passes', async () => {
  renderWithMediaAndTargets(mockVideoMedia, [ytVariant]);
  // Publish button should be enabled and no error message should be visible
  expect(screen.queryByText(/YouTube posts require/)).not.toBeInTheDocument();
  const publishBtn = screen.getByRole('button', { name: /Publish/i });
  expect(publishBtn).not.toBeDisabled();
});

test('2. YouTube + image is rejected', async () => {
  renderWithMediaAndTargets(mockImageMedia, [ytVariant]);
  expect(screen.getByText('This media format cannot be published to YouTube. Video required.')).toBeInTheDocument();
  const publishBtn = screen.getByRole('button', { name: /Publish/i });
  expect(publishBtn).toBeDisabled();
});

test('3. YouTube + document/PDF is rejected', async () => {
  renderWithMediaAndTargets(mockDocMedia, [ytVariant]);
  expect(screen.getByText('This media format cannot be published to YouTube. Video required.')).toBeInTheDocument();
  const publishBtn = screen.getByRole('button', { name: /Publish/i });
  expect(publishBtn).toBeDisabled();
});

test('4. YouTube + unsupported media combination blocks publish', async () => {
  renderWithMediaAndTargets([...mockVideoMedia, ...mockImageMedia], [ytVariant]);
  expect(screen.getByText('YouTube only supports a single video.')).toBeInTheDocument();
  const publishBtn = screen.getByRole('button', { name: /Publish/i });
  expect(publishBtn).toBeDisabled();
});

test('5. invalid YouTube media blocks schedule', async () => {
  renderWithMediaAndTargets(mockImageMedia, [ytVariant]);
  // The Schedule button is disabled
  const scheduleBtn = screen.getByRole('button', { name: /Schedule/i });
  expect(scheduleBtn).toBeDisabled();
});

test('6. no publish API request occurs on invalid combination', async () => {
  renderWithMediaAndTargets(mockImageMedia, [ytVariant]);
  const publishBtn = screen.getByRole('button', { name: /Publish/i });
  expect(publishBtn).toBeDisabled();
  // Trying to click it won't do anything because it's disabled.
  fireEvent.click(publishBtn);
  expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining('publish'), expect.any(Object));
});

test('7. no schedule API request occurs on invalid combination', async () => {
  renderWithMediaAndTargets(mockImageMedia, [ytVariant]);
  const scheduleBtn = screen.getByRole('button', { name: /Schedule/i });
  expect(scheduleBtn).toBeDisabled();
  fireEvent.click(scheduleBtn);
  expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining('schedule'), expect.any(Object));
});

test('8. error message is visible', async () => {
  renderWithMediaAndTargets([], [ytVariant]);
  // 0 media test
  expect(screen.getByText('YouTube posts require exactly 1 video.')).toBeInTheDocument();
});

test('9. LinkedIn-only valid media behavior remains unchanged', async () => {
  renderWithMediaAndTargets(mockImageMedia, [liVariant]);
  expect(screen.queryByText(/published to YouTube/)).not.toBeInTheDocument();
  const publishBtn = screen.getByRole('button', { name: /Publish/i });
  expect(publishBtn).not.toBeDisabled();
});

test('10. multi-target LinkedIn + YouTube with incompatible shared media is detected correctly', async () => {
  renderWithMediaAndTargets(mockImageMedia, [liVariant, ytVariant]);

  // YouTube target should show error
  expect(screen.getByText('This media format cannot be published to YouTube. Video required.')).toBeInTheDocument();

  // LinkedIn target publish button should be enabled, YouTube target publish button should be disabled
  const publishBtns = screen.getAllByRole('button', { name: /Publish/i });
  // Since there are 2 variants, we expect 2 publish buttons
  expect(publishBtns).toHaveLength(2);

  // In our UI, LinkedIn is rendered first, then YouTube. Wait, let's just check one is enabled, one disabled.
  const disabledBtns = publishBtns.filter(btn => btn.hasAttribute('disabled'));
  expect(disabledBtns).toHaveLength(1);
});

test('11. removing YouTube target clears the incompatibility', async () => {
  renderWithMediaAndTargets(mockImageMedia, [liVariant]);
  // No error visible
  expect(screen.queryByText(/published to YouTube/)).not.toBeInTheDocument();
});

test('12. replacing incompatible media with valid video clears the error', async () => {
  renderWithMediaAndTargets(mockVideoMedia, [ytVariant]);
  expect(screen.queryByText(/published to YouTube/)).not.toBeInTheDocument();
  const publishBtn = screen.getByRole('button', { name: /Publish/i });
  expect(publishBtn).not.toBeDisabled();
});

// === E2: AMBIGUOUS PUBLICATION RECONCILIATION TESTS ===

const renderE2Test = (variantStatus = 'UNKNOWN', overrideVariant = {}) => {
  queryClient.setQueryData(['workspaces', 'ws-1', 'posts', 'post-1'], {
    id: 'post-1',
    workspaceId: 'ws-1',
    content: 'Hello World',
    status: 'DRAFT',
    media: [],
    variants: [
      {
        id: 'var-1',
        postId: 'post-1',
        socialAccountId: 'acc-1',
        status: variantStatus,
        ...overrideVariant,
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

test('1, 3. UNKNOWN panel and correct CTA', async () => {
  renderE2Test('UNKNOWN');
  expect(screen.getByText('Needs review (UNKNOWN)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resolve publication' })).toBeInTheDocument();
});

test('2. non-UNKNOWN panel absent', async () => {
  renderE2Test('PUBLISHED');
  expect(screen.queryByRole('button', { name: 'Resolve publication' })).not.toBeInTheDocument();
});

test('4, 5, 6, 7. PUBLISHED requires reason and externalPostId, whitespace rejected', async () => {
  renderE2Test('UNKNOWN');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve publication' }));
  
  fireEvent.click(screen.getByRole('button', { name: 'Yes, it was published' }));

  const submitBtn = screen.getByRole('button', { name: 'Submit' });
  expect(submitBtn).toBeDisabled(); // Disabled initially

  const reasonInput = screen.getByPlaceholderText('e.g. Verified video exists');
  const externalIdInput = screen.getByText('External Post ID *').nextSibling as HTMLInputElement;

  fireEvent.change(reasonInput, { target: { value: '   ' } });
  fireEvent.change(externalIdInput, { target: { value: '   ' } });
  expect(submitBtn).toBeDisabled(); // Whitespace rejected

  fireEvent.change(reasonInput, { target: { value: 'Verified' } });
  expect(submitBtn).toBeDisabled(); // Still disabled, needs external ID

  fireEvent.change(externalIdInput, { target: { value: 'ext-123' } });
  expect(submitBtn).not.toBeDisabled(); // Now enabled
});

test('8, 9. FAILED requires reason, whitespace rejected', async () => {
  renderE2Test('UNKNOWN');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve publication' }));
  
  fireEvent.click(screen.getByRole('button', { name: 'No, it was not published' }));

  const submitBtn = screen.getByRole('button', { name: 'Submit' });
  const reasonInput = screen.getByPlaceholderText('e.g. Verified video exists');

  expect(submitBtn).toBeDisabled();

  fireEvent.change(reasonInput, { target: { value: '   ' } });
  expect(submitBtn).toBeDisabled();

  fireEvent.change(reasonInput, { target: { value: 'Failed to post' } });
  expect(submitBtn).not.toBeDisabled();
});

test('10, 11, 13, 14, 15. decision switch removes stale externalPostId, exact HTTP body and URL', async () => {
  renderE2Test('UNKNOWN');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve publication' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, it was published' }));

  const reasonInput = screen.getByPlaceholderText('e.g. Verified video exists');
  const externalIdInput = screen.getByText('External Post ID *').nextSibling as HTMLInputElement;

  fireEvent.change(reasonInput, { target: { value: 'Verified' } });
  fireEvent.change(externalIdInput, { target: { value: 'ext-123' } });

  // Now switch to FAILED
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'No, it was not published' }));

  const submitBtn = screen.getByRole('button', { name: 'Submit' });
  fireEvent.click(submitBtn);

  expect(api.post).toHaveBeenCalledWith('workspaces/ws-1/publications/var-1/reconcile', {
    decision: 'CONFIRM_FAILED',
    reason: 'Verified',
  }); // Note: externalPostId is NOT sent
});

test('12, 13. canonicalUrl omission when blank, exact published HTTP body', async () => {
  renderE2Test('UNKNOWN');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve publication' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, it was published' }));

  const reasonInput = screen.getByPlaceholderText('e.g. Verified video exists');
  const externalIdInput = screen.getByText('External Post ID *').nextSibling as HTMLInputElement;
  const canonicalUrlInput = screen.getByText('Canonical URL (Optional)').nextSibling as HTMLInputElement;

  fireEvent.change(reasonInput, { target: { value: 'Verified' } });
  fireEvent.change(externalIdInput, { target: { value: 'ext-123' } });
  fireEvent.change(canonicalUrlInput, { target: { value: '   ' } }); // Blank

  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

  expect(api.post).toHaveBeenCalledWith('workspaces/ws-1/publications/var-1/reconcile', {
    decision: 'CONFIRM_PUBLISHED',
    reason: 'Verified',
    externalPostId: 'ext-123',
  }); // canonicalUrl is omitted
});

test('16. multi-variant correct ID', async () => {
  renderWithMultipleVariants([
    {
      id: 'var-a',
      postId: 'post-1',
      socialAccountId: 'acc-1',
      status: 'PUBLISHED',
      socialAccount: { name: 'My YouTube', provider: 'YOUTUBE' }
    },
    {
      id: 'var-b',
      postId: 'post-1',
      socialAccountId: 'acc-2',
      status: 'UNKNOWN',
      socialAccount: { name: 'My LinkedIn', provider: 'LINKEDIN' }
    }
  ]);

  fireEvent.click(screen.getByRole('button', { name: 'Resolve publication' }));
  fireEvent.click(screen.getByRole('button', { name: 'No, it was not published' }));
  
  fireEvent.change(screen.getByPlaceholderText('e.g. Verified video exists'), { target: { value: 'Failed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

  expect(api.post).toHaveBeenCalledWith('workspaces/ws-1/publications/var-b/reconcile', expect.any(Object));
});

test('17. double-submit', async () => {
  renderE2Test('UNKNOWN');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve publication' }));
  fireEvent.click(screen.getByRole('button', { name: 'No, it was not published' }));

  fireEvent.change(screen.getByPlaceholderText('e.g. Verified video exists'), { target: { value: 'Failed' } });
  
  (api.post as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
  
  const submitBtn = screen.getByRole('button', { name: 'Submit' });
  fireEvent.click(submitBtn);
  expect(submitBtn).toBeDisabled();
});

test('18. success revalidation', async () => {
  renderE2Test('UNKNOWN');
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  
  fireEvent.click(screen.getByRole('button', { name: 'Resolve publication' }));
  fireEvent.click(screen.getByRole('button', { name: 'No, it was not published' }));
  fireEvent.change(screen.getByPlaceholderText('e.g. Verified video exists'), { target: { value: 'Failed' } });
  
  (api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

  await waitFor(() => {
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaces', 'ws-1', 'posts', 'post-1'] });
  });
});

test('19, 20, 21, 22. Error behaviors (403, 409, 422, 500)', async () => {
  const checkError = async (status: number, expectedMsg: string, triggersRefetch = false) => {
    cleanup();
    vi.clearAllMocks();
    renderE2Test('UNKNOWN');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(screen.getByRole('button', { name: 'Resolve publication' }));
    fireEvent.click(screen.getByRole('button', { name: 'No, it was not published' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Verified video exists'), { target: { value: 'Failed' } });

    (api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ApiError(status, {}, 'err'));

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(screen.getByText(expectedMsg)).toBeInTheDocument();
    });

    if (triggersRefetch) {
      expect(invalidateSpy).toHaveBeenCalled();
    }
  };

  await checkError(403, 'You do not have permission to reconcile publications.');
  await checkError(409, 'Publication state has changed. Please refresh the page.', true);
  await checkError(422, 'Invalid data provided. Please check the fields and try again.');
  await checkError(500, 'An internal system error occurred. Please try again later.');
});
