import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResetPasswordPage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React, { StrictMode } from 'react';

let currentToken: string | null = 'test-valid-token-32-chars-long';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (param: string) => (param === 'token' ? currentToken : null),
  }),
}));

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

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentToken = 'test-valid-token-32-chars-long';
  });

  it('renders invalid state without calling API when token is missing or blank', () => {
    currentToken = null;
    render(<ResetPasswordPage />);

    expect(
      screen.getByRole('heading', { name: /invalid or expired reset link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /request a new link/i }),
    ).toHaveAttribute('href', '/forgot-password');
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('never leaks the raw token into the DOM', () => {
    const secretToken = 'ultra-secret-token-not-to-be-rendered-in-dom';
    currentToken = secretToken;

    const { container } = render(<ResetPasswordPage />);

    expect(container.innerHTML).not.toContain(secretToken);
  });

  it('validates password length client-side without calling API', async () => {
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Password must be between 8 and 128 characters long',
      );
    });

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('validates password match client-side without calling API', async () => {
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'Password123!' },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: 'DifferentPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
    });

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('submits token and newPassword to auth/reset-password and displays success screen', async () => {
    mockApiPost.mockResolvedValueOnce({
      message: 'Password reset successfully.',
    });

    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'NewSecretPass123!' },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: 'NewSecretPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('auth/reset-password', {
        token: 'test-valid-token-32-chars-long',
        newPassword: 'NewSecretPass123!',
      });
    });

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /password reset successfully/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
        'href',
        '/login',
      );
    });
  });

  it('prevents duplicate submissions under rapid clicks / StrictMode', async () => {
    mockApiPost.mockResolvedValueOnce({
      message: 'Password reset successfully.',
    });

    render(
      <StrictMode>
        <ResetPasswordPage />
      </StrictMode>,
    );

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'NewSecretPass123!' },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: 'NewSecretPass123!' },
    });

    const button = screen.getByRole('button', { name: /reset password/i });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledTimes(1);
    });
  });

  it('transitions to invalid state when API responds with invalid/expired link', async () => {
    const { ApiError } = await import('../../lib/api/client');
    mockApiPost.mockRejectedValueOnce(
      new ApiError(
        400,
        {
          error: {
            code: 'BadRequestException',
            message: 'Invalid or expired reset link',
          },
        },
        'Invalid or expired reset link',
      ),
    );

    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'NewSecretPass123!' },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: 'NewSecretPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /invalid or expired reset link/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /request a new link/i }),
      ).toHaveAttribute('href', '/forgot-password');
    });
  });

  it('displays validation error alert when new password equals current password', async () => {
    const { ApiError } = await import('../../lib/api/client');
    mockApiPost.mockRejectedValueOnce(
      new ApiError(
        400,
        {
          error: {
            code: 'BadRequestException',
            message: 'New password cannot be the same as the current password',
          },
        },
        'New password cannot be the same as the current password',
      ),
    );

    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'SameOldPass123!' },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: 'SameOldPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'New password cannot be the same as the current password',
      );
    });
    expect(
      screen.queryByRole('heading', { name: /invalid or expired reset link/i }),
    ).not.toBeInTheDocument();
  });
});
