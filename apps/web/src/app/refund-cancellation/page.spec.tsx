import { render, screen } from '@testing-library/react';
import RefundCancellationPage from './page';
import { describe, it, expect } from 'vitest';

describe('RefundCancellationPage', () => {
  it('renders DRAFT status header and first heading', () => {
    render(<RefundCancellationPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Agency OS — Refund & Cancellation Policy (DRAFT)' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/DRAFT prepared 2026-11-10/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: '1. Free trial — no charge, no refund needed' }),
    ).toBeInTheDocument();
  });
});
