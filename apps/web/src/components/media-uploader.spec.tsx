import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import { MediaUploader } from './media-uploader';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../lib/api/client';

vi.mock('../lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'completed-media-id' });
});

const renderUploader = () => {
  const queryClient = new QueryClient();
  const handleUploadsChange = vi.fn();
  const handleUploadingStateChange = vi.fn();
  
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MediaUploader 
        workspaceId="test-ws" 
        onUploadsChange={handleUploadsChange} 
        onUploadingStateChange={handleUploadingStateChange} 
      />
    </QueryClientProvider>
  );

  return { ...utils, handleUploadsChange, handleUploadingStateChange };
};

test('A. supported PDF accepted', async () => {
  renderUploader();
  const fileInput = screen.getByLabelText(/Select files/i);
  const pdfFile = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
  await userEvent.upload(fileInput, pdfFile);
  expect(screen.getByText('test.pdf')).toBeInTheDocument();
});

test('B. unsupported type rejected', async () => {
  renderUploader();
  const fileInput = screen.getByLabelText(/Select files/i);
  const txtFile = new File(['dummy'], 'test.txt', { type: 'text/plain' });
  fireEvent.change(fileInput, { target: { files: [txtFile] } });
  expect(await screen.findByText('Some files were ignored due to unsupported format.')).toBeInTheDocument();
  expect(screen.queryByText('test.txt')).not.toBeInTheDocument();
});

test('C. document cannot be mixed with image/video', async () => {
  renderUploader();
  const fileInput = screen.getByLabelText(/Select files/i);
  const pdfFile = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
  await userEvent.upload(fileInput, pdfFile);
  
  const imageFile = new File(['dummy'], 'test.png', { type: 'image/png' });
  await userEvent.upload(fileInput, imageFile);
  expect(await screen.findByText('Images and video cannot be mixed with a document.')).toBeInTheDocument();
});

test('D. more than one document rejected', async () => {
  renderUploader();
  const fileInput = screen.getByLabelText(/Select files/i);
  const pdfFile1 = new File(['dummy content 1'], 'test1.pdf', { type: 'application/pdf' });
  await userEvent.upload(fileInput, pdfFile1);
  
  const pdfFile2 = new File(['dummy content 2'], 'test2.pdf', { type: 'application/pdf' });
  await userEvent.upload(fileInput, pdfFile2);
  expect(await screen.findByText('Document posts support one document only.')).toBeInTheDocument();
});

test('E. oversized PDF rejected', async () => {
  renderUploader();
  const fileInput = screen.getByLabelText(/Select files/i);
  
  // Make a file larger than 100MB
  const largePdfFile = new File(['dummy content'], 'large.pdf', { type: 'application/pdf' });
  Object.defineProperty(largePdfFile, 'size', { value: 105 * 1024 * 1024 });
  
  await userEvent.upload(fileInput, largePdfFile);
  expect(await screen.findByText('Document size exceeds the 100MB limit.')).toBeInTheDocument();
});

test('F. selected document can be removed and G. replaced', async () => {
  renderUploader();
  const fileInput = screen.getByLabelText(/Select files/i);
  const pdfFile = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
  await userEvent.upload(fileInput, pdfFile);
  expect(screen.getByText('test.pdf')).toBeInTheDocument();
  
  // F. Remove
  const removeBtn = screen.getByRole('button', { name: /Remove test.pdf/i });
  fireEvent.click(removeBtn);
  expect(screen.queryByText('test.pdf')).not.toBeInTheDocument();
  
  // G. Replace
  const pdfFile2 = new File(['dummy'], 'test2.pdf', { type: 'application/pdf' });
  await userEvent.upload(fileInput, pdfFile2);
  expect(screen.getByText('test2.pdf')).toBeInTheDocument();
});

test('H. correct media completion/mediaId path is used', async () => {
  renderUploader();
  const fileInput = screen.getByLabelText(/Select files/i);
  const pdfFile = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
  
  (api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    mediaAssetId: 'media-123',
    uploadUrl: 'http://fake-upload'
  });
  
  class XHRMock {
    open = vi.fn();
    setRequestHeader = vi.fn();
    send = vi.fn(function(this: XMLHttpRequest) {
      this.status = 200;
      if (this.onload) this.onload();
    });
    upload = { addEventListener: vi.fn() };
    abort = vi.fn();
  }
  vi.stubGlobal('XMLHttpRequest', XHRMock);
  
  await userEvent.upload(fileInput, pdfFile);
  
  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith('workspaces/test-ws/media/uploads', expect.any(Object));
    expect(api.post).toHaveBeenCalledWith('workspaces/test-ws/media/media-123/complete');
  });
});
