import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BillingPage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-test-123' }),
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('../../../lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, public data: unknown, message: string) {
      super(message);
    }
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'QueryClientWrapper';
  return Wrapper;
};

describe('BillingPage', () => {
  const mockPlansResponse = {
    plans: [
      {
        id: 'plan-solo',
        code: 'SOLO',
        name: 'Solo',
        monthlyPricePaise: 49900,
        annualPricePaise: 499000,
        seats: 1,
        isFounding: false,
      },
      {
        id: 'plan-studio',
        code: 'STUDIO',
        name: 'Studio',
        monthlyPricePaise: 99900,
        annualPricePaise: 999000,
        seats: 3,
        isFounding: false,
      },
      {
        id: 'plan-agency',
        code: 'AGENCY',
        name: 'Agency',
        monthlyPricePaise: 399900,
        annualPricePaise: 3999000,
        seats: 10,
        isFounding: false,
      },
      {
        id: 'plan-founding',
        code: 'AGENCY_FOUNDING',
        name: 'Agency (Founding 50)',
        monthlyPricePaise: 299900,
        annualPricePaise: 2999000,
        seats: 10,
        isFounding: true,
      },
    ],
    foundingAvailable: true,
  };

  const mockBillingResponse = {
    workspaceId: 'ws-test-123',
    trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    subscription: null,
  };

  const mockInvoicesResponse = [
    {
      id: 'inv-1',
      workspaceId: 'ws-test-123',
      invoiceNumber: 'INV-2026-00001',
      amountPaise: 49900,
      baseAmountPaise: 42288,
      gstAmountPaise: 7612,
      gstRate: 18,
      gstin: '27TESTGSTIN0001',
      status: 'PAID',
      createdAt: '2026-11-01T10:00:00Z',
      subscription: {
        plan: {
          name: 'Solo',
        },
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('billing/plans')) {
        return Promise.resolve(mockPlansResponse);
      }
      if (url.includes('billing/invoices')) {
        return Promise.resolve(mockInvoicesResponse);
      }
      if (url.endsWith('billing')) {
        return Promise.resolve(mockBillingResponse);
      }
      return Promise.resolve({});
    });
  });

  it('renders all 4 plans with correct monthly prices', async () => {
    render(<BillingPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Choose Your Plan')).toBeInTheDocument();
    });

    expect(screen.getByTestId('card-plan-SOLO')).toBeInTheDocument();
    expect(screen.getByTestId('card-plan-STUDIO')).toBeInTheDocument();
    expect(screen.getByTestId('card-plan-AGENCY')).toBeInTheDocument();
    expect(screen.getByTestId('card-plan-AGENCY_FOUNDING')).toBeInTheDocument();

    const soloCard = screen.getByTestId('card-plan-SOLO');
    const studioCard = screen.getByTestId('card-plan-STUDIO');
    const agencyCard = screen.getByTestId('card-plan-AGENCY');
    const foundingCard = screen.getByTestId('card-plan-AGENCY_FOUNDING');

    expect(within(soloCard).getByText('₹499')).toBeInTheDocument();
    expect(within(studioCard).getByText('₹999')).toBeInTheDocument();
    expect(within(agencyCard).getByText('₹3,999')).toBeInTheDocument();
    expect(within(foundingCard).getByText('₹2,999')).toBeInTheDocument();
  });

  it('toggles to Annual billing and updates prices (2 months free)', async () => {
    const user = userEvent.setup();
    render(<BillingPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Choose Your Plan')).toBeInTheDocument();
    });

    const annualButton = screen.getByRole('button', { name: /annual/i });
    await user.click(annualButton);

    // Annual prices (10x monthly)
    expect(screen.getByText('₹4,990')).toBeInTheDocument();
    expect(screen.getByText('₹9,990')).toBeInTheDocument();
    expect(screen.getByText('₹39,990')).toBeInTheDocument();
    expect(screen.getByText('₹29,990')).toBeInTheDocument();
  });

  it('disables founding plan card when foundingAvailable is false', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('billing/plans')) {
        return Promise.resolve({
          ...mockPlansResponse,
          foundingAvailable: false,
        });
      }
      if (url.includes('billing/invoices')) {
        return Promise.resolve([]);
      }
      return Promise.resolve(mockBillingResponse);
    });

    render(<BillingPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Sold Out')).toBeInTheDocument();
    });

    const soldOutButton = screen.getByRole('button', { name: /sold out/i });
    expect(soldOutButton).toBeDisabled();
  });

  it('renders payment processing banner when returning from Razorpay', async () => {
    mockSearchParams = new URLSearchParams('payment=processing');

    render(<BillingPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        screen.getByTestId('banner-payment-processing'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText('Payment processing — awaiting gateway confirmation'),
    ).toBeInTheDocument();
  });

  it('renders trial countdown banner when in trial', async () => {
    render(<BillingPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('banner-trial')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/14-Day Free Trial \(Agency Tier\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/remaining in your full-featured trial/i)).toBeInTheDocument();
  });

  it('renders invoice table with download link', async () => {
    render(<BillingPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('INV-2026-00001')).toBeInTheDocument();
    });

    const invoiceTable = screen.getByRole('table');
    expect(within(invoiceTable).getByText('Solo')).toBeInTheDocument();
    expect(within(invoiceTable).getByText('PAID')).toBeInTheDocument();
    const downloadLink = screen.getByRole('link', { name: /download pdf/i });
    expect(downloadLink).toHaveAttribute(
      'href',
      expect.stringContaining('/billing/invoices/inv-1/pdf'),
    );
  });

  it('opens cancel dialog for active subscriptions and confirms cancellation', async () => {
    const user = userEvent.setup();
    mockApiGet.mockImplementation((url: string) => {
      if (url.endsWith('billing')) {
        return Promise.resolve({
          workspaceId: 'ws-test-123',
          subscription: {
            id: 'sub-active',
            status: 'ACTIVE',
            billingInterval: 'MONTHLY',
            isFounding: false,
            currentPeriodEnd: '2026-12-01T00:00:00Z',
            plan: {
              code: 'STUDIO',
              name: 'Studio',
            },
          },
        });
      }
      if (url.includes('billing/plans')) {
        return Promise.resolve(mockPlansResponse);
      }
      if (url.includes('billing/invoices')) {
        return Promise.resolve(mockInvoicesResponse);
      }
      return Promise.resolve({});
    });

    render(<BillingPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('banner-active')).toBeInTheDocument();
    });

    const cancelButton = screen.getByRole('button', {
      name: /cancel subscription/i,
    });
    await user.click(cancelButton);

    // Cancel modal appears
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Cancel Subscription?')).toBeInTheDocument();

    mockApiPost.mockResolvedValueOnce({ success: true });

    const confirmButton = screen.getByRole('button', {
      name: /confirm cancellation/i,
    });
    await user.click(confirmButton);

    expect(mockApiPost).toHaveBeenCalledWith(
      'workspaces/ws-test-123/billing/cancel',
      { cancelAtPeriodEnd: true },
    );
  });
});
