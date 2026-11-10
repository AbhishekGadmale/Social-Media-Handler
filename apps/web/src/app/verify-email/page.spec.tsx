import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React, { StrictMode } from 'react';
import VerifyEmailPage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';

let currentToken: string | null = null;

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

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentToken = null;
  });

  describe('Missing or empty token', () => {
    it('shows invalid state immediately when token param is missing without calling API', () => {
      currentToken = null;
      render(<VerifyEmailPage />);

      expect(
        screen.getByRole('heading', { name: /invalid or expired verification token/i }),
      ).toBeInTheDocument();
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('shows invalid state immediately when token param is empty string without calling API', () => {
      currentToken = '   ';
      render(<VerifyEmailPage />);

      expect(
        screen.getByRole('heading', { name: /invalid or expired verification token/i }),
      ).toBeInTheDocument();
      expect(mockApiPost).not.toHaveBeenCalled();
    });
  });

  describe('Token verification flows', () => {
    const validTestToken = 'test-token-abcdef1234567890abcdef1234567890';

    it('successfully verifies email, shows success state and sign in CTA link', async () => {
      currentToken = validTestToken;
      mockApiPost.mockResolvedValueOnce({ message: 'Email verified successfully.' });

      render(<VerifyEmailPage />);

      // Initially verifying
      expect(screen.getByText(/verifying your email/i)).toBeInTheDocument();

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('auth/verify-email', {
          token: validTestToken,
        });
      });

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /email verified successfully\./i }),
        ).toBeInTheDocument();
      });

      const signInLink = screen.getByRole('link', { name: /sign in/i });
      expect(signInLink).toBeInTheDocument();
      expect(signInLink).toHaveAttribute('href', '/login');

      // Security assertion: raw token is NEVER rendered in DOM
      expect(screen.queryByText(validTestToken)).not.toBeInTheDocument();
    });

    it('renders invalid/expired state when API returns 400', async () => {
      currentToken = validTestToken;
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(
          400,
          {
            error: {
              code: 'BAD_REQUEST',
              message: 'Invalid or expired verification token',
            },
          },
          'Invalid or expired verification token',
        ),
      );

      render(<VerifyEmailPage />);

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /invalid or expired verification token/i }),
        ).toBeInTheDocument();
      });

      // Inline resend form is available
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /resend verification email/i }),
      ).toBeInTheDocument();

      // Security assertion: raw token is NEVER rendered in DOM
      expect(screen.queryByText(validTestToken)).not.toBeInTheDocument();
    });

    it('StrictMode guard: calls api.post only once even under React StrictMode double invocation', async () => {
      currentToken = validTestToken;
      mockApiPost.mockResolvedValueOnce({ message: 'Email verified successfully.' });

      render(
        <StrictMode>
          <VerifyEmailPage />
        </StrictMode>,
      );

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /email verified successfully\./i }),
        ).toBeInTheDocument();
      });

      expect(mockApiPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('Inline resend verification form', () => {
    it('submits resend verification and renders generic success message', async () => {
      currentToken = null; // triggers invalid state
      mockApiPost.mockResolvedValueOnce({
        message: 'If an unverified account exists for this email, a verification link has been sent.',
      });

      render(<VerifyEmailPage />);

      expect(
        screen.getByRole('heading', { name: /invalid or expired verification token/i }),
      ).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });

      fireEvent.click(
        screen.getByRole('button', { name: /resend verification email/i }),
      );

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('auth/resend-verification', {
          email: 'user@example.com',
        });
      });

      await waitFor(() => {
        expect(
          screen.getByText(
            /if an unverified account exists for this email, a verification link has been sent\./i,
          ),
        ).toBeInTheDocument();
      });
    });

    it('displays specific 400 validation error message from API (nested real shape)', async () => {
      currentToken = null;
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(
          400,
          {
            error: {
              code: 'BAD_REQUEST',
              message: 'Email address is invalid',
            },
          },
          'Email address is invalid',
        ),
      );

      render(<VerifyEmailPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'bad@example.com' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: /resend verification email/i }),
      );

      await waitFor(() => {
        expect(screen.getByText('Email address is invalid')).toBeInTheDocument();
      });
    });

    it('displays 429 rate limit error with retry seconds', async () => {
      currentToken = null;
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(429, {}, 'Too Many Requests', new Headers({ 'retry-after': '60' })),
      );

      render(<VerifyEmailPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: /resend verification email/i }),
      );

      await waitFor(() => {
        expect(
          screen.getByText('Too many attempts. Please try again in 60 seconds.'),
        ).toBeInTheDocument();
      });
    });

    it('displays 500 server error message', async () => {
      currentToken = null;
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(500, {}, 'Internal Server Error'),
      );

      render(<VerifyEmailPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: /resend verification email/i }),
      );

      await waitFor(() => {
        expect(
          screen.getByText('Something went wrong. Please try again.'),
        ).toBeInTheDocument();
      });
    });
  });
});
