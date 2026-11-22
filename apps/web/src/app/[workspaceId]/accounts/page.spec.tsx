import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AccountsPage from "./page";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { ConnectedAccount } from "../../../lib/query/accounts";

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "ws-test-123" }),
}));

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPatch = vi.fn();

vi.mock("../../../lib/api/client", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
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
      if (!resolvedMessage && data && typeof data === "object") {
        const dataObj = data as Record<string, unknown>;
        const nested = dataObj.error;
        let extracted: unknown;
        if (nested && typeof nested === "object") {
          extracted = (nested as Record<string, unknown>).message;
        }
        if (extracted === undefined) {
          extracted = dataObj.message;
        }
        if (Array.isArray(extracted)) {
          resolvedMessage = extracted.join(", ");
        } else if (typeof extracted === "string") {
          resolvedMessage = extracted;
        }
      }
      super(resolvedMessage || "API Error");
      this.name = "ApiError";
      this.headers = {};
      if (headers) {
        if (typeof (headers as Headers).forEach === "function") {
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

const createWrapper = (role = "OWNER") => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  queryClient.setQueryData(["auth", "me"], {
    user: { id: "usr-1", email: "user@example.com" },
    memberships: [
      {
        id: "mem-1",
        workspaceId: "ws-test-123",
        userId: "usr-1",
        role,
        workspace: { id: "ws-test-123", name: "Test Agency" },
      },
    ],
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "QueryClientWrapper";
  return Wrapper;
};

const createMockAccount = (
  overrides: Partial<ConnectedAccount> = {},
): ConnectedAccount => ({
  id: "acc-1",
  workspaceId: "ws-test-123",
  provider: "FACEBOOK",
  externalId: "ext-1",
  name: "Test Account",
  capabilities: ["POST_PUBLISH", "ACCOUNT_READ"],
  status: "ACTIVE",
  createdAt: "2026-11-13T12:00:00Z",
  updatedAt: "2026-11-13T12:00:00Z",
  ...overrides,
});

describe("AccountsPage - Meta (Facebook & Instagram) Connect Buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.href = "http://localhost:3000/ws-test-123/accounts";
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes("clients")) return Promise.resolve({ clients: [] });
      return Promise.resolve({ accounts: [] });
    });
  });

  it("(a) empty state renders all four buttons: Connect YouTube, Connect LinkedIn, Connect Facebook, Connect Instagram", async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });

    render(<AccountsPage />, { wrapper: createWrapper() });

    expect(
      await screen.findByRole("button", { name: "Connect YouTube" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect LinkedIn" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect Facebook" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect Instagram" }),
    ).toBeInTheDocument();
  });

  it("(b) clicking Connect Facebook calls api.post with exactly workspaces/<workspaceId>/oauth/facebook/connect (no query string) and assigns window.location.href", async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockResolvedValueOnce({
      url: "https://www.facebook.com/v20.0/dialog/oauth?test=fb",
    });
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const fbBtn = await screen.findByRole("button", {
      name: "Connect Facebook",
    });
    await user.click(fbBtn);

    expect(mockApiPost).toHaveBeenCalledWith(
      "workspaces/ws-test-123/oauth/facebook/connect",
    );
    expect(window.location.href).toBe(
      "https://www.facebook.com/v20.0/dialog/oauth?test=fb",
    );
  });

  it("(c) clicking Connect Instagram calls api.post with exactly workspaces/<workspaceId>/oauth/instagram/connect and assigns window.location.href", async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockResolvedValueOnce({
      url: "https://www.facebook.com/v20.0/dialog/oauth?test=ig",
    });
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const igBtn = await screen.findByRole("button", {
      name: "Connect Instagram",
    });
    await user.click(igBtn);

    expect(mockApiPost).toHaveBeenCalledWith(
      "workspaces/ws-test-123/oauth/instagram/connect",
    );
    expect(window.location.href).toBe(
      "https://www.facebook.com/v20.0/dialog/oauth?test=ig",
    );
  });

  it("(d) api.post rejecting on the Facebook click shows Failed to initiate Facebook connection. Please try again.", async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockRejectedValueOnce(new Error("Network error"));
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const fbBtn = await screen.findByRole("button", {
      name: "Connect Facebook",
    });
    await user.click(fbBtn);

    expect(
      await screen.findByText(
        "Failed to initiate Facebook connection. Please try again.",
      ),
    ).toBeInTheDocument();
  });

  it("(d) api.post rejecting on the Instagram click shows Failed to initiate Instagram connection. Please try again.", async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockRejectedValueOnce(new Error("Network error"));
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const igBtn = await screen.findByRole("button", {
      name: "Connect Instagram",
    });
    await user.click(igBtn);

    expect(
      await screen.findByText(
        "Failed to initiate Instagram connection. Please try again.",
      ),
    ).toBeInTheDocument();
  });

  it("(e) with an ACTIVE FACEBOOK account in the list, Connect Facebook is NOT rendered and Connect Instagram IS rendered (header row)", async () => {
    mockApiGet.mockResolvedValueOnce({
      accounts: [createMockAccount({ provider: "FACEBOOK", status: "ACTIVE" })],
    });

    render(<AccountsPage />, { wrapper: createWrapper() });

    expect(await screen.findByText("Connected Accounts")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Connect Instagram" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect Facebook" }),
    ).not.toBeInTheDocument();
  });

  it("(e) with an ACTIVE INSTAGRAM account in the list, Connect Facebook IS rendered and Connect Instagram is NOT rendered (header row)", async () => {
    mockApiGet.mockResolvedValueOnce({
      accounts: [
        createMockAccount({ provider: "INSTAGRAM", status: "ACTIVE" }),
      ],
    });

    render(<AccountsPage />, { wrapper: createWrapper() });

    expect(await screen.findByText("Connected Accounts")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Connect Facebook" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect Instagram" }),
    ).not.toBeInTheDocument();
  });

  it("(f) a DISCONNECTED FACEBOOK account does NOT hide Connect Facebook (header row)", async () => {
    mockApiGet.mockResolvedValueOnce({
      accounts: [
        createMockAccount({ provider: "FACEBOOK", status: "DISCONNECTED" }),
      ],
    });

    render(<AccountsPage />, { wrapper: createWrapper() });

    expect(await screen.findByText("Connected Accounts")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Connect Facebook" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect Instagram" }),
    ).toBeInTheDocument();
  });

  it("(g) Connect YouTube posts to workspaces/<workspaceId>/oauth/youtube/connect with youtube.upload scope", async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockResolvedValueOnce({
      url: "https://accounts.google.com/o/oauth2/v2/auth",
    });
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const ytBtn = await screen.findByRole("button", {
      name: "Connect YouTube",
    });
    await user.click(ytBtn);

    const expectedUrl = `workspaces/ws-test-123/oauth/youtube/connect?scopes=${encodeURIComponent("https://www.googleapis.com/auth/youtube.upload")}`;
    expect(mockApiPost).toHaveBeenCalledWith(expectedUrl);
    const calledUrl = mockApiPost.mock.calls[0][0] as string;
    const urlObj = new URL(calledUrl, "http://localhost");
    expect(decodeURIComponent(urlObj.searchParams.get("scopes")!)).toBe(
      "https://www.googleapis.com/auth/youtube.upload",
    );
    expect(window.location.href).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });

  it("(g) regression: Connect LinkedIn still posts to workspaces/<workspaceId>/oauth/linkedin/connect?scopes=w_member_social", async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    mockApiPost.mockResolvedValueOnce({
      url: "https://www.linkedin.com/oauth/v2/authorization",
    });
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const liBtn = await screen.findByRole("button", {
      name: "Connect LinkedIn",
    });
    await user.click(liBtn);

    expect(mockApiPost).toHaveBeenCalledWith(
      "workspaces/ws-test-123/oauth/linkedin/connect?scopes=w_member_social",
    );
    expect(window.location.href).toBe(
      "https://www.linkedin.com/oauth/v2/authorization",
    );
  });

  it("(h) disables all connect buttons while any connect is in flight", async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });
    let resolvePost: (value: { url: string }) => void;
    mockApiPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    const user = userEvent.setup();

    render(<AccountsPage />, { wrapper: createWrapper() });

    const fbBtn = await screen.findByRole("button", {
      name: "Connect Facebook",
    });
    const igBtn = screen.getByRole("button", { name: "Connect Instagram" });
    const ytBtn = screen.getByRole("button", { name: "Connect YouTube" });
    const liBtn = screen.getByRole("button", { name: "Connect LinkedIn" });

    await user.click(fbBtn);

    expect(fbBtn).toBeDisabled();
    expect(igBtn).toBeDisabled();
    expect(ytBtn).toBeDisabled();
    expect(liBtn).toBeDisabled();

    resolvePost!({
      url: "https://www.facebook.com/v20.0/dialog/oauth?test=done",
    });
  });

  it("renders read-only view for CLIENT_APPROVER with helper text and no connect/disconnect buttons", async () => {
    mockApiGet.mockResolvedValueOnce({
      accounts: [createMockAccount({ provider: "FACEBOOK", status: "ACTIVE" })],
    });

    render(<AccountsPage />, { wrapper: createWrapper("CLIENT_APPROVER") });

    expect(
      await screen.findByText("Accounts are managed by your agency."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /connect/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /disconnect/i }),
    ).not.toBeInTheDocument();
  });

  it("renders read-only empty state for VIEWER with helper text and no connect buttons", async () => {
    mockApiGet.mockResolvedValueOnce({ accounts: [] });

    render(<AccountsPage />, { wrapper: createWrapper("VIEWER") });

    expect(
      await screen.findByText("No connected accounts"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Accounts are managed by your agency."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /connect/i }),
    ).not.toBeInTheDocument();
  });

  describe("Client Grouping & Assignment", () => {
    const mockClientsList = [
      {
        id: "client-1",
        workspaceId: "ws-test-123",
        name: "Acme Corp",
        brandDisplayName: "Acme",
        brandLogoUrl: null,
        brandAccentColor: null,
        accountCount: 1,
        scopedMemberCount: 1,
        createdAt: "2026-11-20T00:00:00Z",
        updatedAt: "2026-11-20T00:00:00Z",
      },
    ];

    const mockAccountsList = [
      createMockAccount({
        id: "acc-1",
        name: "Acme Facebook",
        clientId: "client-1",
        client: { id: "client-1", name: "Acme Corp" },
      }),
      createMockAccount({
        id: "acc-2",
        name: "Unassigned Account",
        clientId: null,
        client: null,
      }),
    ];

    it("displays client badge for assigned and unassigned accounts", async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes("clients"))
          return Promise.resolve({ clients: mockClientsList });
        return Promise.resolve({ accounts: mockAccountsList });
      });

      render(<AccountsPage />, { wrapper: createWrapper("OWNER") });

      expect(await screen.findByText("Client: Acme Corp")).toBeInTheDocument();
      const badges = screen.getAllByTestId("client-badge");
      expect(badges[0]).toHaveTextContent("Client: Acme Corp");
      expect(badges[1]).toHaveTextContent("Unassigned");
    });

    it("filters accounts by client pill", async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes("clients"))
          return Promise.resolve({ clients: mockClientsList });
        return Promise.resolve({ accounts: mockAccountsList });
      });
      const user = userEvent.setup();

      render(<AccountsPage />, { wrapper: createWrapper("OWNER") });

      expect(await screen.findByText("Acme Facebook")).toBeInTheDocument();
      expect(screen.getByText("Unassigned Account")).toBeInTheDocument();

      // Click "Acme Corp (1)" filter pill
      const clientPill = screen.getByRole("button", {
        name: /Acme Corp \(1\)/i,
      });
      await user.click(clientPill);

      expect(screen.getByText("Acme Facebook")).toBeInTheDocument();
      expect(screen.queryByText("Unassigned Account")).not.toBeInTheDocument();

      // Click "Unassigned (1)" filter pill
      const unassignedPill = screen.getByRole("button", {
        name: /Unassigned \(1\)/i,
      });
      await user.click(unassignedPill);

      expect(screen.queryByText("Acme Facebook")).not.toBeInTheDocument();
      expect(screen.getByText("Unassigned Account")).toBeInTheDocument();
    });

    it("assigns client when manager changes dropdown", async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes("clients"))
          return Promise.resolve({ clients: mockClientsList });
        return Promise.resolve({ accounts: mockAccountsList });
      });
      mockApiPatch.mockResolvedValueOnce({
        ...mockAccountsList[1],
        clientId: "client-1",
      });
      const user = userEvent.setup();

      render(<AccountsPage />, { wrapper: createWrapper("OWNER") });

      await screen.findByText("Acme Facebook");
      const selects = screen.getAllByRole("combobox", {
        name: "Assign Client",
      });
      expect(selects).toHaveLength(2);

      // Change the second account's client to client-1
      await user.selectOptions(selects[1], "client-1");

      expect(mockApiPatch).toHaveBeenCalledWith(
        "workspaces/ws-test-123/accounts/acc-2/client",
        { clientId: "client-1" },
      );
    });
  });
});
