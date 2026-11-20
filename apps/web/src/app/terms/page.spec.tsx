import { render, screen } from '@testing-library/react';
import TermsPage from './page';
import { describe, it, expect } from 'vitest';

describe('TermsPage', () => {
  it('renders DRAFT status header and first heading', () => {
    render(<TermsPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Agency OS — Terms of Service (DRAFT)' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/DRAFT prepared 2026-11-10/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: '1. The service' }),
    ).toBeInTheDocument();
  });

  it('contains the exact operator line Gadmale Technologies', () => {
    render(<TermsPage />);

    expect(screen.getAllByText(/Gadmale Technologies/i).length).toBeGreaterThan(0);
  });

  it('contains the exact string 7 days in the refund summary', () => {
    render(<TermsPage />);

    expect(screen.getAllByText(/7 days/i).length).toBeGreaterThan(0);
  });

  it('contains the correct annual subscription prices matching billing config', () => {
    render(<TermsPage />);

    expect(screen.getByText(/Solo ₹4,990\/year/i)).toBeInTheDocument();
    expect(screen.getByText(/Studio ₹9,990\/year/i)).toBeInTheDocument();
    expect(screen.getByText(/Agency ₹39,990\/year/i)).toBeInTheDocument();
    expect(screen.getByText(/₹29,990\/year/i)).toBeInTheDocument();
  });
});
