import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ForgotPasswordPage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockApiPost = vi.fn();

vi.mock('../../lib/api/client', () => ({
  api: {
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
      if (data && typeof data === 'object') {
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

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders email input, submit button, and back to sign in link', () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('validates email format client-side before calling the API', async () => {
    render(<ForgotPasswordPage />);

    const emailInput = screen.getByLabelText(/email address/i);
    const submitBtn = screen.getByRole('button', { name: /send reset link/i });

    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Please enter a valid email address');
    });

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('submits valid email to auth/forgot-password and switches to generic check your email screen', async () => {
    mockApiPost.mockResolvedValueOnce({
      message: 'If an account with that email exists, a password reset link has been sent.',
    });

    render(<ForgotPasswordPage />);

    const emailInput = screen.getByLabelText(/email address/i);
    const submitBtn = screen.getByRole('button', { name: /send reset link/i });

    fireEvent.change(emailInput, { target: { value: '  alice@example.com  ' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('auth/forgot-password', {
        email: 'alice@example.com',
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /check your email/i })).toBeInTheDocument();
      expect(
        screen.getByText('If an account with that email exists, we sent a password reset link.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
    });
  });

  it('displays rate-limit error message with retry-after when status is 429', async () => {
    const { ApiError } = await import('../../lib/api/client');
    mockApiPost.mockRejectedValueOnce(
      new ApiError(429, {}, 'Too Many Requests', new Headers({ 'retry-after': '45' })),
    );

    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Too many attempts. Please try again in 45 seconds.',
      );
    });
  });

  it('handles nested API validation errors correctly (err.data.error.message)', async () => {
    const { ApiError } = await import('../../lib/api/client');
    mockApiPost.mockRejectedValueOnce(
      new ApiError(
        400,
        {
          error: {
            code: 'BadRequestException',
            message: 'Invalid email address provided',
          },
        },
        'Bad Request',
      ),
    );

    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email address provided');
    });
  });

  it('handles server errors gracefully (>=500)', async () => {
    const { ApiError } = await import('../../lib/api/client');
    mockApiPost.mockRejectedValueOnce(new ApiError(500, {}, 'Internal Server Error'));

    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    });
  });
});
