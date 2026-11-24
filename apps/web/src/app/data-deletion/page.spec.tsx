import { render, screen, fireEvent } from '@testing-library/react';
import DataDeletionPage from './page';
import { describe, it, beforeEach, expect, vi } from 'vitest';

let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

describe('DataDeletionPage', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
  });

  it('renders heading and instructions when no code is in query params', () => {
    render(<DataDeletionPage />);

    expect(
      screen.getByRole('heading', {
        name: /Agency OS — User Data Deletion Instructions/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', {
        name: /2\. How to Request Data Deletion via Meta/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: /3\. Scope of Data Deleted/i }),
    ).toBeInTheDocument();

    expect(screen.queryByTestId('status-banner')).not.toBeInTheDocument();
  });

  it('renders status banner when code is present in query parameters', () => {
    mockSearchParams = new URLSearchParams('code=del_test_123456');
    render(<DataDeletionPage />);

    const banner = screen.getByTestId('status-banner');
    expect(banner).toBeInTheDocument();
    expect(screen.getByText('Status: Completed')).toBeInTheDocument();
    expect(screen.getByText('del_test_123456')).toBeInTheDocument();
    expect(
      screen.getByText(/Your data deletion request has been processed/i),
    ).toBeInTheDocument();
  });

  it('allows user to enter confirmation code in the form to view status', () => {
    render(<DataDeletionPage />);

    expect(screen.queryByTestId('status-banner')).not.toBeInTheDocument();

    const input = screen.getByLabelText(/Confirmation code/i);
    const button = screen.getByRole('button', { name: /Check Status/i });

    fireEvent.change(input, { target: { value: 'del_manual_input_code' } });
    fireEvent.click(button);

    const banner = screen.getByTestId('status-banner');
    expect(banner).toBeInTheDocument();
    expect(screen.getByText('del_manual_input_code')).toBeInTheDocument();
  });

  it('renders links to Privacy Policy and Terms of Service', () => {
    render(<DataDeletionPage />);

    const privacyLink = screen.getByRole('link', { name: 'Privacy Policy' });
    expect(privacyLink).toHaveAttribute('href', '/privacy');

    const termsLink = screen.getByRole('link', { name: 'Terms of Service' });
    expect(termsLink).toHaveAttribute('href', '/terms');
  });
});
