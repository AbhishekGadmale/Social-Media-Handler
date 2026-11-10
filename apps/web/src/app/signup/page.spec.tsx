import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SignupPage from './page';
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

describe('SignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form fields, labels, submit button, and sign in link', () => {
    render(<SignupPage />);

    expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/workspace name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  describe('Client validation', () => {
    it('shows error when email is invalid', async () => {
      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'invalid-email' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'password123' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(screen.getByRole('alert')).toHaveTextContent(/please enter a valid email address/i);
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('shows error when password is less than 8 characters', async () => {
      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'short' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'short' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(screen.getByRole('alert')).toHaveTextContent(/password must be at least 8 characters/i);
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('shows error when passwords do not match', async () => {
      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'passwordXYZ' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(screen.getByRole('alert')).toHaveTextContent(/passwords do not match/i);
      expect(mockApiPost).not.toHaveBeenCalled();
    });
  });

  describe('Form submission and Check Email screen', () => {
    it('submits signup payload and renders check email screen with honest trial copy', async () => {
      mockApiPost.mockResolvedValueOnce({
        message: 'Registration request received.',
      });

      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'newuser@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'SecurePass123!' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'SecurePass123!' },
      });
      fireEvent.change(screen.getByLabelText(/organization name/i), {
        target: { value: 'Acme Agency' },
      });
      fireEvent.change(screen.getByLabelText(/workspace name/i), {
        target: { value: 'Acme Main' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('auth/signup', {
          email: 'newuser@example.com',
          password: 'SecurePass123!',
          organizationName: 'Acme Agency',
          workspaceName: 'Acme Main',
        });
      });

      // Assert "Check your email" screen is displayed
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /check your email/i })).toBeInTheDocument();
      });

      // Honest trial copy verification
      expect(
        screen.getByText(/your workspace is created with a 14-day trial\. verify your email to enter it\./i),
      ).toBeInTheDocument();
      expect(screen.getByText(/newuser@example.com/i)).toBeInTheDocument();

      // Sign in link present
      expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    });

    it('anti-enumeration: duplicate email registration shows the same check-email screen', async () => {
      mockApiPost.mockResolvedValueOnce({
        message: 'Registration request received.',
      });

      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'duplicate@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'SecurePass123!' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'SecurePass123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /check your email/i })).toBeInTheDocument();
      });

      expect(
        screen.getByText(/your workspace is created with a 14-day trial\. verify your email to enter it\./i),
      ).toBeInTheDocument();
    });

    it('allows resending verification email from check-email screen with generic success message', async () => {
      mockApiPost
        .mockResolvedValueOnce({ message: 'Registration request received.' })
        .mockResolvedValueOnce({
          message: 'If an unverified account exists for this email, a verification link has been sent.',
        });

      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'testresend@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'SecurePass123!' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'SecurePass123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /check your email/i })).toBeInTheDocument();
      });

      const resendBtn = screen.getByRole('button', { name: /resend verification email/i });
      fireEvent.click(resendBtn);

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('auth/resend-verification', {
          email: 'testresend@example.com',
        });
      });

      expect(
        screen.getByText(
          /if an unverified account exists for this email, a verification link has been sent\./i,
        ),
      ).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('displays 400 validation error message from API', async () => {
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(400, { error: { message: 'Password is too weak' } }, 'Password is too weak'),
      );

      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'password123' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Password is too weak');
      });
    });

    it('displays 429 rate limit error message with retry seconds', async () => {
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(429, {}, 'Too Many Requests', new Headers({ 'retry-after': '45' })),
      );

      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'password123' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Too many signup attempts. Please try again in 45 seconds.',
        );
      });
    });

    it('displays 500 server error message', async () => {
      const { ApiError } = await import('../../lib/api/client');
      mockApiPost.mockRejectedValueOnce(
        new ApiError(500, {}, 'Internal Server Error'),
      );

      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'password123' },
      });

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Something went wrong. Please try again.',
        );
      });
    });
  });
});
