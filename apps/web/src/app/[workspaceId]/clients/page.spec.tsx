import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ClientsPage from "./page";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "ws-client-123" }),
}));

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPatch = vi.fn();
const mockApiDelete = vi.fn();

vi.mock("../../../lib/api/client", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public data: unknown,
      message?: string,
    ) {
      super(message || "API Error");
      this.name = "ApiError";
    }
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("ClientsPage", () => {
  const mockOwnerUser = {
    user: { id: "usr-1", email: "owner@example.com" },
    memberships: [
      {
        id: "mem-1",
        workspaceId: "ws-client-123",
        role: "OWNER",
      },
    ],
  };

  const mockEditorUser = {
    user: { id: "usr-2", email: "editor@example.com" },
    memberships: [
      {
        id: "mem-2",
        workspaceId: "ws-client-123",
        role: "EDITOR",
      },
    ],
  };

  const mockApproverUser = {
    user: { id: "usr-3", email: "approver@example.com" },
    memberships: [
      {
        id: "mem-3",
        workspaceId: "ws-client-123",
        role: "CLIENT_APPROVER",
      },
    ],
  };

  const mockClients = [
    {
      id: "client-1",
      workspaceId: "ws-client-123",
      name: "Acme Corp",
      brandDisplayName: "Acme Global",
      brandLogoUrl: "https://example.com/acme.png",
      brandAccentColor: "#ff0000",
      accountCount: 3,
      scopedMemberCount: 1,
      createdAt: "2026-11-20T00:00:00Z",
      updatedAt: "2026-11-20T00:00:00Z",
    },
    {
      id: "client-2",
      workspaceId: "ws-client-123",
      name: "Beta Brand",
      brandDisplayName: null,
      brandLogoUrl: null,
      brandAccentColor: null,
      accountCount: 0,
      scopedMemberCount: 0,
      createdAt: "2026-11-21T00:00:00Z",
      updatedAt: "2026-11-21T00:00:00Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders clients list with counts for OWNER", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "auth/me") return Promise.resolve(mockOwnerUser);
      if (url === "workspaces/ws-client-123/clients")
        return Promise.resolve({ clients: mockClients });
      return Promise.reject(new Error("Unknown url"));
    });

    renderWithClient(<ClientsPage />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Brand: Acme Global")).toBeInTheDocument();
    expect(screen.getByText("3 accounts")).toBeInTheDocument();
    expect(screen.getByText("1 approver")).toBeInTheDocument();
    expect(screen.getByText("Beta Brand")).toBeInTheDocument();
    expect(screen.getByText("0 accounts")).toBeInTheDocument();
    expect(screen.getByText("0 approvers")).toBeInTheDocument();

    // Owner should see "New Client", "Edit", and "Delete"
    expect(
      screen.getByRole("button", { name: /new client/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /edit/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /delete/i })).toHaveLength(2);
  });

  it("allows creating a new client", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "auth/me") return Promise.resolve(mockOwnerUser);
      if (url === "workspaces/ws-client-123/clients")
        return Promise.resolve({ clients: mockClients });
      return Promise.reject(new Error("Unknown url"));
    });

    mockApiPost.mockResolvedValueOnce({
      id: "client-3",
      name: "Charlie Co",
      workspaceId: "ws-client-123",
      brandDisplayName: "Charlie",
      accountCount: 0,
      scopedMemberCount: 0,
    });

    renderWithClient(<ClientsPage />);
    const user = userEvent.setup();

    const newBtn = await screen.findByRole("button", { name: /new client/i });
    await user.click(newBtn);

    expect(
      screen.getByText("New Client", { selector: "h3" }),
    ).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText("e.g. Acme Corporation");
    await user.type(nameInput, "Charlie Co");

    const brandInput = screen.getByPlaceholderText("e.g. Acme Brand");
    await user.type(brandInput, "Charlie");

    const submitBtn = screen.getByRole("button", { name: "Create Client" });
    await user.click(submitBtn);

    expect(mockApiPost).toHaveBeenCalledWith(
      "workspaces/ws-client-123/clients",
      expect.objectContaining({
        name: "Charlie Co",
        brandDisplayName: "Charlie",
      }),
    );
  });

  it("allows editing an existing client", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "auth/me") return Promise.resolve(mockOwnerUser);
      if (url === "workspaces/ws-client-123/clients")
        return Promise.resolve({ clients: mockClients });
      return Promise.reject(new Error("Unknown url"));
    });

    mockApiPatch.mockResolvedValueOnce({
      ...mockClients[0],
      name: "Acme Corporation Updated",
    });

    renderWithClient(<ClientsPage />);
    const user = userEvent.setup();

    const editBtns = await screen.findAllByRole("button", { name: /edit/i });
    await user.click(editBtns[0]);

    expect(
      screen.getByText("Edit Client", { selector: "h3" }),
    ).toBeInTheDocument();
    const nameInput = screen.getByDisplayValue("Acme Corp");
    await user.clear(nameInput);
    await user.type(nameInput, "Acme Corporation Updated");

    const saveBtn = screen.getByRole("button", { name: "Save Changes" });
    await user.click(saveBtn);

    expect(mockApiPatch).toHaveBeenCalledWith(
      "workspaces/ws-client-123/clients/client-1",
      expect.objectContaining({
        name: "Acme Corporation Updated",
      }),
    );
  });

  it("handles delete client with 409 conflict error when approver is attached", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "auth/me") return Promise.resolve(mockOwnerUser);
      if (url === "workspaces/ws-client-123/clients")
        return Promise.resolve({ clients: mockClients });
      return Promise.reject(new Error("Unknown url"));
    });

    const { ApiError } = await import("../../../lib/api/client");
    mockApiDelete.mockRejectedValueOnce(
      new ApiError(409, {}, "Remove or reassign this client's approver first."),
    );

    renderWithClient(<ClientsPage />);
    const user = userEvent.setup();

    const deleteBtns = await screen.findAllByRole("button", {
      name: /delete/i,
    });
    await user.click(deleteBtns[0]);

    // Should prompt for confirm
    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    await user.click(confirmBtn);

    expect(mockApiDelete).toHaveBeenCalledWith(
      "workspaces/ws-client-123/clients/client-1",
    );

    expect(
      await screen.findByText(
        "Remove or reassign this client's approver first.",
      ),
    ).toBeInTheDocument();
  });

  it("renders read-only view for EDITOR without create/edit/delete buttons", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "auth/me") return Promise.resolve(mockEditorUser);
      if (url === "workspaces/ws-client-123/clients")
        return Promise.resolve({ clients: mockClients });
      return Promise.reject(new Error("Unknown url"));
    });

    renderWithClient(<ClientsPage />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /new client/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete/i }),
    ).not.toBeInTheDocument();
  });

  it("renders Access Denied for CLIENT_APPROVER", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "auth/me") return Promise.resolve(mockApproverUser);
      if (url === "workspaces/ws-client-123/clients")
        return Promise.resolve({ clients: mockClients });
      return Promise.reject(new Error("Unknown url"));
    });

    renderWithClient(<ClientsPage />);

    expect(await screen.findByText("Access Denied")).toBeInTheDocument();
    expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
  });
});
