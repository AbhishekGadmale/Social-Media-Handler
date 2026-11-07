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
      message: string,
      headers?: Headers,
    ) {
      super(message);
      this.name = 'ApiError';
      this.headers = {};
      if (headers) {
        headers.forEach((val, key) => {
          this.headers[key.toLowerCase()] = val;
        });
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
        new ApiError(400, { message: 'Invalid or expired token' }, 'Bad Request'),
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
  });
});
