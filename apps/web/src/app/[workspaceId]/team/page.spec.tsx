import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TeamPage from "./page";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "ws-team-123" }),
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
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("TeamPage", () => {
  const mockOwnerUser = {
    user: { id: "usr-1", email: "owner@example.com", name: "Alice Owner" },
    memberships: [
      {
        id: "mem-1",
        workspaceId: "ws-team-123",
        userId: "usr-1",
        role: "OWNER",
        workspace: { id: "ws-team-123", name: "Acme Agency" },
      },
    ],
  };

  const mockManagerUser = {
    user: { id: "usr-2", email: "manager@example.com", name: "Bob Manager" },
    memberships: [
      {
        id: "mem-2",
        workspaceId: "ws-team-123",
        userId: "usr-2",
        role: "MANAGER",
        workspace: { id: "ws-team-123", name: "Acme Agency" },
      },
    ],
  };

  const mockEditorUser = {
    user: { id: "usr-3", email: "editor@example.com", name: "Charlie Editor" },
    memberships: [
      {
        id: "mem-3",
        workspaceId: "ws-team-123",
        userId: "usr-3",
        role: "EDITOR",
        workspace: { id: "ws-team-123", name: "Acme Agency" },
      },
    ],
  };

  const mockMembersListResponse = {
    members: [
      {
        id: "mem-1",
        userId: "usr-1",
        name: "Alice Owner",
        email: "owner@example.com",
        role: "OWNER",
        joinedAt: "2026-01-15T00:00:00.000Z",
      },
      {
        id: "mem-2",
        userId: "usr-2",
        name: "Bob Manager",
        email: "manager@example.com",
        role: "MANAGER",
        joinedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "mem-3",
        userId: "usr-3",
        name: "Charlie Editor",
        email: "editor@example.com",
        role: "EDITOR",
        joinedAt: "2026-03-01T00:00:00.000Z",
      },
    ],
    invitations: [
      {
        id: "inv-1",
        email: "client@example.com",
        role: "CLIENT_APPROVER",
        expiresAt: "2026-11-27T00:00:00.000Z",
        createdAt: "2026-11-20T00:00:00.000Z",
        invitedBy: {
          id: "usr-1",
          name: "Alice Owner",
          email: "owner@example.com",
        },
      },
    ],
  };

  const mockClientsResponse = {
    clients: [
      {
        id: "client-1",
        workspaceId: "ws-team-123",
        name: "Acme Corp",
        brandDisplayName: "Acme",
        brandLogoUrl: null,
        brandAccentColor: null,
        accountCount: 2,
        scopedMemberCount: 1,
        createdAt: "2026-11-20T00:00:00Z",
        updatedAt: "2026-11-20T00:00:00Z",
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders members list, invite form, and pending invitations for a Manager", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "auth/me") return Promise.resolve(mockManagerUser);
      if (url === "workspaces/ws-team-123/members") {
        return Promise.resolve(mockMembersListResponse);
      }
      if (url.includes("clients")) {
        return Promise.resolve(mockClientsResponse);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    renderWithClient(<TeamPage />);

    // Check members rendered
    expect(await screen.findAllByText("Alice Owner")).toHaveLength(2);
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("Bob Manager")).toBeInTheDocument();
    expect(screen.getByText("Charlie Editor")).toBeInTheDocument();

    // Check invite form rendered
    expect(
      screen.getByRole("heading", { name: /invite new member/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("teammate@example.com"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send invite/i }),
    ).toBeInTheDocument();

    // Check pending invitations table rendered
    expect(
      screen.getByRole("heading", { name: /pending invitations/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("client@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resend/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument();
  });

  it("hides management controls and pending invitations from an Editor", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "auth/me") return Promise.resolve(mockEditorUser);
      if (url === "workspaces/ws-team-123/members") {
        // API returns only members when non-manager
        return Promise.resolve({ members: mockMembersListResponse.members });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    renderWithClient(<TeamPage />);

    // Members list should render
    expect(await screen.findByText("Alice Owner")).toBeInTheDocument();
    expect(screen.getByText("Bob Manager")).toBeInTheDocument();
    expect(screen.getByText("Charlie Editor")).toBeInTheDocument();

    // Management controls must NOT render
    expect(
      screen.queryByRole("heading", { name: /invite new member/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("teammate@example.com"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /pending invitations/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /send invite/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resend/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /revoke/i }),
    ).not.toBeInTheDocument();

    // Action column should not exist for non-manager
    expect(
      screen.queryByRole("columnheader", { name: /actions/i }),
    ).not.toBeInTheDocument();
  });

  it("renders CLIENT_APPROVER helper text when selected in invite form", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "auth/me") return Promise.resolve(mockOwnerUser);
      if (url === "workspaces/ws-team-123/members") {
        return Promise.resolve(mockMembersListResponse);
      }
      if (url.includes("clients")) {
        return Promise.resolve(mockClientsResponse);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    renderWithClient(<TeamPage />);

    expect(await screen.findAllByText("Alice Owner")).not.toHaveLength(0);
    expect(
      screen.getByRole("heading", { name: /invite new member/i }),
    ).toBeInTheDocument();

    // Select role CLIENT_APPROVER in the invite form
    const roleSelect = screen.getByRole("combobox", { name: /^role$/i });
    fireEvent.change(roleSelect, { target: { value: "CLIENT_APPROVER" } });

    // Helper text must be defined in the select options
    expect(
      await screen.findByText(/can approve posts, cannot publish/i),
    ).toBeInTheDocument();

    // Client scope select should now be visible
    expect(
      screen.getByRole("combobox", { name: "Client Scope" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No client selected: this approver will see all clients in this workspace.",
      ),
    ).toBeInTheDocument();
  });

  it("submits invitation with clientId when selected", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "auth/me") return Promise.resolve(mockOwnerUser);
      if (url === "workspaces/ws-team-123/members") {
        return Promise.resolve(mockMembersListResponse);
      }
      if (url.includes("clients")) {
        return Promise.resolve(mockClientsResponse);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    mockApiPost.mockResolvedValueOnce({
      id: "inv-new",
      email: "newclient@example.com",
      role: "CLIENT_APPROVER",
      clientId: "client-1",
    });

    renderWithClient(<TeamPage />);

    expect(
      await screen.findByRole("heading", { name: /invite new member/i }),
    ).toBeInTheDocument();

    // Fill in email
    const emailInput = screen.getByPlaceholderText("teammate@example.com");
    fireEvent.change(emailInput, {
      target: { value: "newclient@example.com" },
    });

    // Change role to CLIENT_APPROVER
    const roleSelect = screen.getByRole("combobox", { name: /^role$/i });
    fireEvent.change(roleSelect, { target: { value: "CLIENT_APPROVER" } });

    // Select client-1
    const clientSelect = await screen.findByRole("combobox", {
      name: "Client Scope",
    });
    fireEvent.change(clientSelect, { target: { value: "client-1" } });

    // Submit form
    const form = emailInput.closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "workspaces/ws-team-123/members/invitations",
        {
          email: "newclient@example.com",
          role: "CLIENT_APPROVER",
          clientId: "client-1",
        },
      );
    });
  });

  it("renders client name for scoped approver member and allows reassigning client", async () => {
    const membersWithScopedApprover = {
      ...mockMembersListResponse,
      members: [
        ...mockMembersListResponse.members,
        {
          id: "mem-4",
          userId: "usr-4",
          name: "Dana Approver",
          email: "dana@example.com",
          role: "CLIENT_APPROVER",
          clientId: "client-1",
          clientName: "Acme Corp",
          joinedAt: "2026-11-20T00:00:00.000Z",
        },
      ],
    };

    mockApiGet.mockImplementation((url: string) => {
      if (url === "auth/me") return Promise.resolve(mockOwnerUser);
      if (url === "workspaces/ws-team-123/members") {
        return Promise.resolve(membersWithScopedApprover);
      }
      if (url.includes("clients")) {
        return Promise.resolve(mockClientsResponse);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
    mockApiPatch.mockResolvedValueOnce({
      ...membersWithScopedApprover.members[3],
      clientId: null,
      clientName: null,
    });

    renderWithClient(<TeamPage />);

    expect(await screen.findByText("Dana Approver")).toBeInTheDocument();
    expect(screen.getByText("Client: Acme Corp")).toBeInTheDocument();

    // Reassign client
    const assignSelect = await screen.findByRole("combobox", {
      name: "Assign client for Dana Approver",
    });
    fireEvent.change(assignSelect, { target: { value: "" } });

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith(
        "workspaces/ws-team-123/members/mem-4",
        {
          role: "CLIENT_APPROVER",
          clientId: null,
        },
      );
    });
  });
});
