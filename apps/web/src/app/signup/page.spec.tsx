import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SignupPage from './page';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mockPush = vi.fn();
const currentSearchParamRedirect: string | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (param: string) =>
      param === 'redirect' ? currentSearchParamRedirect : null,
  }),
}));

interface TurnstileStub {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ) => string;
  remove?: (widgetId: string) => void;
}

const setTurnstileOnWindow = (stub?: TurnstileStub) => {
  const win = window as unknown as { turnstile?: TurnstileStub };
  if (stub) {
    win.turnstile = stub;
  } else {
    delete win.turnstile;
  }
};

const mockApiPost = vi.fn();
const mockApiGet = vi.fn();

vi.mock('../../lib/api/client', () => ({
  api: {
    post: (...args: unknown[]) => mockApiPost(...args),
    get: (...args: unknown[]) => mockApiGet(...args),
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

describe('SignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form fields, labels, submit button, and sign in link', () => {
    render(<SignupPage />);

    expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/workspace name/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i })).toBeInTheDocument();
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

  describe('Terms and Privacy Policy consent', () => {
    it('blocks submit and shows inline error when checkbox is unchecked (api.post not called)', async () => {
      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'SecurePass123!' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'SecurePass123!' },
      });

      // Do NOT check the terms checkbox
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        'You must accept the Terms of Service and Privacy Policy to create an account.',
      );
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('submits signup payload with termsAccepted: true when checkbox is checked', async () => {
      mockApiPost.mockResolvedValueOnce({
        message: 'Registration request received.',
      });

      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/full name/i), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'SecurePass123!' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'SecurePass123!' },
      });
      fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('auth/signup', {
          name: 'Test User',
          email: 'user@example.com',
          password: 'SecurePass123!',
          termsAccepted: true,
        });
      });
    });

    it('renders the Full name field and submitting posts trimmed name in payload', async () => {
      mockApiPost.mockResolvedValueOnce({
        message: 'Registration request received.',
      });

      render(<SignupPage />);

      const nameInput = screen.getByLabelText(/full name/i);
      expect(nameInput).toBeInTheDocument();
      expect(nameInput).toHaveAttribute('type', 'text');
      expect(nameInput).toHaveAttribute('required');

      fireEvent.change(nameInput, {
        target: { value: '   Jane Doe   ' },
      });
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'jane@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'SecurePass123!' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'SecurePass123!' },
      });
      fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('auth/signup', {
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'SecurePass123!',
          termsAccepted: true,
        });
      });
    });

    it('renders Terms of Service and Privacy Policy links with correct hrefs and target _blank', () => {
      render(<SignupPage />);

      const termsLink = screen.getByRole('link', { name: /terms of service/i });
      expect(termsLink).toHaveAttribute('href', '/terms');
      expect(termsLink).toHaveAttribute('target', '_blank');

      const privacyLink = screen.getByRole('link', { name: /privacy policy/i });
      expect(privacyLink).toHaveAttribute('href', '/privacy');
      expect(privacyLink).toHaveAttribute('target', '_blank');
    });
  });

  describe('Form submission and Check Email screen', () => {
    it('submits signup payload and renders check email screen with honest trial copy', async () => {
      mockApiPost.mockResolvedValueOnce({
        message: 'Registration request received.',
      });

      render(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/full name/i), {
        target: { value: 'New User' },
      });
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
      fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('auth/signup', {
          name: 'New User',
          email: 'newuser@example.com',
          password: 'SecurePass123!',
          termsAccepted: true,
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
      fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));

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
      fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));

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
      fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));

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
      fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));

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
      fireEvent.click(screen.getByRole('checkbox', { name: /terms of service and privacy policy/i }));

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Something went wrong. Please try again.',
        );
      });
    });
  });

  describe('Turnstile bot verification', () => {
    const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    afterEach(() => {
      if (originalSiteKey === undefined) {
        delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
      } else {
        process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSiteKey;
      }
      setTurnstileOnWindow(undefined);
    });

    it('(a) with NEXT_PUBLIC_TURNSTILE_SITE_KEY unset, the form renders without a Turnstile container and submits the payload exactly as before', async () => {
      delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
      setTurnstileOnWindow(undefined);
      mockApiPost.mockResolvedValueOnce({
        message: 'Registration request received.',
      });

      render(<SignupPage />);

      expect(
        screen.queryByTestId('turnstile-container'),
      ).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/full name/i), {
        target: { value: 'Alice User' },
      });
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'alice@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'Password123!' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'Password123!' },
      });
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: /terms of service and privacy policy/i,
        }),
      );

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('auth/signup', {
          name: 'Alice User',
          email: 'alice@example.com',
          password: 'Password123!',
          termsAccepted: true,
        });
      });
    });

    it('(b) with the site key set and window.turnstile stubbed, submitting sends a payload whose turnstileToken is test-token-123', async () => {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key-123';
      const renderMock = vi.fn(
        (
          _container: HTMLElement,
          options: {
            sitekey: string;
            callback: (token: string) => void;
            'expired-callback'?: () => void;
            'error-callback'?: () => void;
          },
        ) => {
          options.callback('test-token-123');
          return 'widget-id-abc';
        },
      );
      const removeMock = vi.fn();
      setTurnstileOnWindow({
        render: renderMock,
        remove: removeMock,
      });

      mockApiPost.mockResolvedValueOnce({
        message: 'Registration request received.',
      });

      render(<SignupPage />);

      expect(screen.getByTestId('turnstile-container')).toBeInTheDocument();
      expect(renderMock).toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText(/full name/i), {
        target: { value: 'Bob User' },
      });
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'bob@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password/i), {
        target: { value: 'Password123!' },
      });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'Password123!' },
      });
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: /terms of service and privacy policy/i,
        }),
      );

      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('auth/signup', {
          name: 'Bob User',
          email: 'bob@example.com',
          password: 'Password123!',
          termsAccepted: true,
          turnstileToken: 'test-token-123',
        });
      });
    });
  });

  describe('Google Identity Services (Sign in with Google on signup)', () => {
    interface TestWindowWithGoogle {
      google?: {
        accounts?: {
          id?: {
            initialize: ReturnType<typeof vi.fn>;
            renderButton: ReturnType<typeof vi.fn>;
            prompt: ReturnType<typeof vi.fn>;
          };
        };
      };
    }

    const originalGoogleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

    beforeEach(() => {
      mockPush.mockReset();
      mockApiPost.mockReset();
      mockApiGet.mockReset();
    });

    afterEach(() => {
      if (originalGoogleClientId === undefined) {
        delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      } else {
        process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = originalGoogleClientId;
      }
      delete (window as unknown as TestWindowWithGoogle).google;
    });

    it('renders nothing when NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset', () => {
      delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      render(<SignupPage />);

      expect(
        screen.queryByTestId('google-button-container'),
      ).not.toBeInTheDocument();
    });

    it('gates Google UI with hidden class until terms are accepted', () => {
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id.apps.google.com';

      const initializeMock = vi.fn();
      const renderButtonMock = vi.fn();
      const promptMock = vi.fn();

      (window as unknown as TestWindowWithGoogle).google = {
        accounts: {
          id: {
            initialize: initializeMock,
            renderButton: renderButtonMock,
            prompt: promptMock,
          },
        },
      };

      render(<SignupPage />);

      const googleContainer = screen.getByTestId('google-button-container');
      expect(googleContainer).toBeInTheDocument();
      // Initially hidden because terms are not accepted
      expect(googleContainer).toHaveClass('hidden');

      // Accept terms
      const checkbox = screen.getByRole('checkbox', {
        name: /terms of service and privacy policy/i,
      });
      fireEvent.click(checkbox);

      // Now visible
      expect(googleContainer).not.toHaveClass('hidden');

      // Uncheck terms
      fireEvent.click(checkbox);
      expect(googleContainer).toHaveClass('hidden');
    });

    it('posts credential and termsAccepted on GIS callback and navigates on success', async () => {
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id.apps.google.com';

      let capturedCallback: ((res: { credential: string }) => void) | null = null;
      (window as unknown as TestWindowWithGoogle).google = {
        accounts: {
          id: {
            initialize: vi.fn(({ callback }) => {
              capturedCallback = callback;
            }),
            renderButton: vi.fn(),
            prompt: vi.fn(),
          },
        },
      };

      mockApiPost.mockResolvedValueOnce({ message: 'Logged in successfully' });
      mockApiGet.mockResolvedValueOnce({
        user: { id: 'u1', email: 'alice@example.com', emailVerified: true },
        memberships: [{ workspaceId: 'ws-signup-google-1' }],
      });

      render(<SignupPage />);

      // Accept terms first
      const checkbox = screen.getByRole('checkbox', {
        name: /terms of service and privacy policy/i,
      });
      fireEvent.click(checkbox);

      expect(capturedCallback).not.toBeNull();
      await capturedCallback!({ credential: 'valid-signup-google-token' });

      expect(mockApiPost).toHaveBeenCalledWith('auth/google', {
        credential: 'valid-signup-google-token',
        termsAccepted: true,
      });

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/ws-signup-google-1/analytics');
      });
    });

    it('surfaces error message when Google sign-in fails', async () => {
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id.apps.google.com';

      const { ApiError } = await import('../../lib/api/client');
      let capturedCallback: ((res: { credential: string }) => void) | null = null;
      (window as unknown as TestWindowWithGoogle).google = {
        accounts: {
          id: {
            initialize: vi.fn(({ callback }) => {
              capturedCallback = callback;
            }),
            renderButton: vi.fn(),
            prompt: vi.fn(),
          },
        },
      };

      mockApiPost.mockRejectedValueOnce(
        new ApiError(400, {}, 'No account exists for this email. Please sign up first.'),
      );

      render(<SignupPage />);

      await capturedCallback!({ credential: 'token-without-account' });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'No account exists for this email. Please sign up first.',
        );
      });
    });
  });
});
