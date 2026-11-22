import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AnalyticsDashboard from "./page";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { api, ApiError } from "../../../lib/api/client";

const mockPush = vi.fn();
let currentWorkspaceId = "ws-test-123";

const { mockDownloadClientReportPdf } = vi.hoisted(() => ({
  mockDownloadClientReportPdf: vi.fn(),
}));

vi.mock("../../../lib/query/reports", () => ({
  downloadClientReportPdf: (...args: unknown[]) =>
    mockDownloadClientReportPdf(...args),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: currentWorkspaceId }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../../../lib/api/client", () => {
  class MockApiError extends Error {
    public status: number;
    public data: unknown;
    public headers: Record<string, string> = {};
    constructor(status: number, data: unknown, message: string) {
      super(message);
      this.status = status;
      this.data = data;
      this.name = "ApiError";
    }
  }
  return {
    ApiError: MockApiError,
    api: {
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

const mockOverviewData = {
  workspaceId: "ws-test-123",
  accountsConnected: 3,
  accountsActive: 2,
  accountsRequiringReauth: 1,
  totalFollowers: 12500,
  totalEngagement: 850,
  accounts: [
    {
      id: "acc-li-1",
      provider: "LINKEDIN",
      name: "Agency LinkedIn",
      status: "ACTIVE",
      latestMetrics: {
        date: "2026-10-27T00:00:00.000Z",
        followers: 7500,
        engagement: 500,
      },
    },
    {
      id: "acc-yt-2",
      provider: "YOUTUBE",
      name: "Agency Channel",
      status: "REAUTH_REQUIRED",
      latestMetrics: {
        date: "2026-10-26T00:00:00.000Z",
        followers: 5000,
        engagement: 350,
      },
    },
    {
      id: "acc-tw-3",
      provider: "TWITTER",
      name: "Agency Twitter",
      status: "ACTIVE",
      latestMetrics: null,
    },
  ],
};

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

const renderDashboard = (client?: QueryClient, role: string = "OWNER") => {
  const queryClient = client || createTestQueryClient();
  if (!queryClient.getQueryData(["auth", "me"])) {
    queryClient.setQueryData(["auth", "me"], {
      user: { id: "usr-1", email: "user@example.com" },
      memberships: [
        {
          id: "mem-1",
          workspaceId: currentWorkspaceId,
          userId: "usr-1",
          role,
          workspace: { id: currentWorkspaceId, name: "Test Workspace" },
        },
      ],
    });
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <AnalyticsDashboard />
    </QueryClientProvider>,
  );
};

describe("AnalyticsDashboard Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentWorkspaceId = "ws-test-123";
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("clients")) return Promise.resolve({ clients: [] });
      return Promise.resolve(mockOverviewData);
    });
  });

  it("renders loading skeleton when fetching overview", () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    renderDashboard();

    expect(
      screen.getByRole("status", { name: /loading analytics/i }),
    ).toBeDefined();
    expect(screen.getByText("Loading analytics...")).toBeDefined();
  });

  it("renders metric cards and account list with real API data", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
    renderDashboard();

    // Metric cards
    expect(await screen.findByText("12,500")).toBeDefined();
    expect(screen.getByText("Total Followers")).toBeDefined();
    expect(screen.getByText("850")).toBeDefined();
    expect(screen.getByText("Total Engagement")).toBeDefined();
    expect(screen.getByText("Connected Accounts")).toBeDefined();
    expect(screen.getByText("Active Accounts")).toBeDefined();

    // Accounts
    expect(screen.getByText("Agency LinkedIn")).toBeDefined();
    expect(screen.getByText("LinkedIn")).toBeDefined();
    expect(screen.getByText("7,500")).toBeDefined();

    expect(screen.getByText("Agency Channel")).toBeDefined();
    expect(screen.getByText("YouTube")).toBeDefined();
    expect(screen.getByText("5,000")).toBeDefined();

    expect(screen.getByText("Agency Twitter")).toBeDefined();
    expect(screen.getByText("Twitter / X")).toBeDefined();

    // Tenancy verification: check API endpoint called with workspaceId
    expect(api.get).toHaveBeenCalledWith(
      "workspaces/ws-test-123/analytics/overview",
    );
  });

  it('handles missing metrics honestly with "No analytics data yet"', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
    renderDashboard();

    expect(await screen.findByText("No analytics data yet")).toBeDefined();
  });

  it("renders reconnection banner when accounts need re-auth", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
    renderDashboard();

    expect(
      await screen.findByText("Action Required: 1 account needs reconnection"),
    ).toBeDefined();
    const accountsLinks = screen.getAllByRole("link", {
      name: /go to accounts/i,
    });
    expect(accountsLinks[0].getAttribute("href")).toBe("/ws-test-123/accounts");
  });

  it("renders plural reconnection banner when multiple accounts need re-auth", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...mockOverviewData,
      accountsRequiringReauth: 3,
    });
    renderDashboard();

    expect(
      await screen.findByText("Action Required: 3 accounts need reconnection"),
    ).toBeDefined();
  });

  it("renders empty state when accountsConnected is 0", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      workspaceId: "ws-test-123",
      accountsConnected: 0,
      accountsActive: 0,
      accountsRequiringReauth: 0,
      totalFollowers: 0,
      totalEngagement: 0,
      accounts: [],
    });
    renderDashboard();

    expect(await screen.findByText("No data available")).toBeDefined();
    expect(
      screen.getByText(
        "Connect your social media accounts to start seeing followers, engagement, and performance metrics here.",
      ),
    ).toBeDefined();

    const link = screen.getByRole("link", { name: /go to accounts/i });
    expect(link.getAttribute("href")).toBe("/ws-test-123/accounts");
  });

  it("renders 403 Access Denied state", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(
      new ApiError(403, { message: "Forbidden" }, "Forbidden"),
    );
    renderDashboard();

    expect(await screen.findByText("Access Denied")).toBeDefined();
    expect(
      screen.getByText(
        "You don't have permission to view analytics in this workspace.",
      ),
    ).toBeDefined();
  });

  it("renders generic error state with working Retry button", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(
      new ApiError(
        500,
        { message: "Internal Server Error" },
        "Internal Server Error",
      ),
    );
    renderDashboard();

    expect(await screen.findByText("Failed to load analytics")).toBeDefined();

    const retryBtn = screen.getByRole("button", {
      name: /retry loading analytics/i,
    });
    expect(retryBtn).toBeDefined();

    // Now mock success for retry
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("clients")) return Promise.resolve({ clients: [] });
      return Promise.resolve(mockOverviewData);
    });
    fireEvent.click(retryBtn);

    expect(await screen.findByText("12,500")).toBeDefined();
    const retryOverviewCalls = vi
      .mocked(api.get)
      .mock.calls.filter(
        ([url]) => url === "workspaces/ws-test-123/analytics/overview",
      );
    expect(retryOverviewCalls).toHaveLength(2);
  });

  it("triggers refetch when header Refresh button is clicked", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("clients")) return Promise.resolve({ clients: [] });
      return Promise.resolve(mockOverviewData);
    });
    renderDashboard();

    await screen.findByText("12,500");

    const refreshBtn = screen.getByRole("button", {
      name: /refresh analytics data/i,
    });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      const overviewCalls = vi
        .mocked(api.get)
        .mock.calls.filter(
          ([url]) => url === "workspaces/ws-test-123/analytics/overview",
        );
      expect(overviewCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("renders accessible link to account drill-down", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
    renderDashboard();

    await screen.findByText("Agency LinkedIn");
    const drilldownLink = screen.getByRole("link", {
      name: /view details for agency linkedin/i,
    });
    expect(drilldownLink.getAttribute("href")).toBe(
      "/ws-test-123/analytics/acc-li-1",
    );
  });

  it("renders appropriate status badges for different account statuses", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...mockOverviewData,
      accounts: [
        {
          id: "acc-1",
          provider: "LINKEDIN",
          name: "Active Account",
          status: "ACTIVE",
          latestMetrics: null,
        },
        {
          id: "acc-2",
          provider: "YOUTUBE",
          name: "Reauth Account",
          status: "REAUTH_REQUIRED",
          latestMetrics: null,
        },
        {
          id: "acc-3",
          provider: "TWITTER",
          name: "Disconnected Account",
          status: "DISCONNECTED",
          latestMetrics: null,
        },
      ],
    });
    renderDashboard();

    expect(await screen.findByText("Active")).toBeDefined();
    expect(screen.getByText("Reauth Required")).toBeDefined();
    expect(screen.getByText("Disconnected")).toBeDefined();
  });

  describe("Client Performance Report Card", () => {
    it("renders client report card with date inputs, accounts dropdown, and download button", async () => {
      vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
      renderDashboard();

      await screen.findByText("Client Performance Report");
      expect(screen.getByLabelText("From Date")).toBeInTheDocument();
      expect(screen.getByLabelText("To Date")).toBeInTheDocument();
      expect(screen.getByLabelText("Account Filter")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /download pdf/i }),
      ).toBeInTheDocument();

      // Check account options in select
      expect(screen.getByText("All accounts")).toBeInTheDocument();
      expect(
        screen.getByText("Agency LinkedIn (LINKEDIN)"),
      ).toBeInTheDocument();
      expect(screen.getByText("Agency Channel (YOUTUBE)")).toBeInTheDocument();
    });

    it("submits download request with selected date range and account filter", async () => {
      vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
      mockDownloadClientReportPdf.mockResolvedValueOnce(undefined);
      renderDashboard();

      await screen.findByText("Client Performance Report");

      const fromInput = screen.getByLabelText("From Date");
      const toInput = screen.getByLabelText("To Date");
      const accountSelect = screen.getByLabelText("Account Filter");
      const downloadBtn = screen.getByRole("button", { name: /download pdf/i });

      fireEvent.change(fromInput, { target: { value: "2026-10-01" } });
      fireEvent.change(toInput, { target: { value: "2026-10-31" } });
      fireEvent.change(accountSelect, { target: { value: "acc-li-1" } });

      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(mockDownloadClientReportPdf).toHaveBeenCalledWith(
          "ws-test-123",
          "2026-10-01",
          "2026-10-31",
          "acc-li-1",
          undefined,
        );
      });
    });

    it("submits download request with selected client and clears/disables account filter", async () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes("clients")) {
          return Promise.resolve({
            clients: [
              {
                id: "client-1",
                workspaceId: "ws-test-123",
                name: "Acme Corp",
                brandDisplayName: "Acme",
                accountCount: 1,
                scopedMemberCount: 1,
              },
            ],
          });
        }
        return Promise.resolve(mockOverviewData);
      });
      mockDownloadClientReportPdf.mockResolvedValueOnce(undefined);
      renderDashboard();

      await screen.findByText("Client Performance Report");

      const clientSelect = await screen.findByLabelText("Client Filter");
      const accountSelect = screen.getByLabelText("Account Filter");
      const downloadBtn = screen.getByRole("button", { name: /download pdf/i });

      // Select client
      fireEvent.change(clientSelect, { target: { value: "client-1" } });

      // Account filter should be disabled
      expect(accountSelect).toBeDisabled();

      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(mockDownloadClientReportPdf).toHaveBeenCalledWith(
          "ws-test-123",
          expect.any(String),
          expect.any(String),
          undefined,
          "client-1",
        );
      });
    });

    it("disables client filter when an account is selected", async () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes("clients")) {
          return Promise.resolve({
            clients: [
              {
                id: "client-1",
                workspaceId: "ws-test-123",
                name: "Acme Corp",
                brandDisplayName: "Acme",
                accountCount: 1,
                scopedMemberCount: 1,
              },
            ],
          });
        }
        return Promise.resolve(mockOverviewData);
      });
      renderDashboard();

      await screen.findByText("Client Performance Report");

      const clientSelect = await screen.findByLabelText("Client Filter");
      const accountSelect = screen.getByLabelText("Account Filter");

      // Select account
      fireEvent.change(accountSelect, { target: { value: "acc-li-1" } });

      // Client filter should be disabled
      expect(clientSelect).toBeDisabled();
    });

    it("displays error alert when report generation fails", async () => {
      vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
      mockDownloadClientReportPdf.mockRejectedValueOnce(
        new Error("Date range cannot exceed 366 days."),
      );
      renderDashboard();

      await screen.findByText("Client Performance Report");

      const downloadBtn = screen.getByRole("button", { name: /download pdf/i });
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Date range cannot exceed 366 days.",
        );
      });
    });

    it("does not render client report card when user is CLIENT_APPROVER, while analytics overview remains visible", async () => {
      vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
      renderDashboard(undefined, "CLIENT_APPROVER");

      // Analytics data renders
      expect(await screen.findByText("12,500")).toBeInTheDocument();
      expect(screen.getByText("Total Followers")).toBeInTheDocument();
      expect(screen.getByText("Agency LinkedIn")).toBeInTheDocument();

      // Report card is NOT rendered
      expect(
        screen.queryByTestId("client-report-card"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Client Performance Report"),
      ).not.toBeInTheDocument();
    });

    it("renders client report card when user is EDITOR", async () => {
      vi.mocked(api.get).mockResolvedValueOnce(mockOverviewData);
      renderDashboard(undefined, "EDITOR");

      expect(await screen.findByText("12,500")).toBeInTheDocument();
      expect(screen.getByTestId("client-report-card")).toBeInTheDocument();
      expect(screen.getByText("Client Performance Report")).toBeInTheDocument();
    });
  });
});
