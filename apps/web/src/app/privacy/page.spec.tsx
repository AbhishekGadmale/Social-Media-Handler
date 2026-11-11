import { render, screen } from '@testing-library/react';
import PrivacyPage from './page';
import { describe, it, expect } from 'vitest';

describe('PrivacyPage', () => {
  it('renders DRAFT status header and first heading', () => {
    render(<PrivacyPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Agency OS — Privacy Policy (DRAFT)' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/DRAFT prepared 2026-11-10/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: '1. Who we are and what this policy covers' }),
    ).toBeInTheDocument();
  });
});
