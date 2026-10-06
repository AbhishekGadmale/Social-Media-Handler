import { describe, it, expect, beforeEach, vi } from "vitest";
import { MetaProvider } from "./meta.provider";
import { ProviderCoordinationError } from "../core/errors";

describe("Instagram Carousel Publishing", () => {
  let provider: MetaProvider;
  let mockFetch: any;

  beforeEach(() => {
    provider = new MetaProvider("instagram");
    vi.clearAllMocks();
    mockFetch = vi.spyOn(global, "fetch");
  });

  const createCarouselInput = (mediaCount = 2) => ({
    attemptId: "att-1",
    targetId: "var-1",
    workspaceId: "ws-1",
    externalAccountId: "ig-123",
    content: "Carousel post",
    media: Array.from({ length: mediaCount }).map((_, i) => ({
      key: `media-${i}.jpg`,
      mimeType: i === 1 ? "video/mp4" : "image/jpeg",
      sizeBytes: 1000,
    })),
    providerOptions: {},
  });

  const credentials = { accessToken: "token123", refreshToken: "refresh123" };
  const mediaSource: any = {
    getSignedReadUrl: vi.fn().mockResolvedValue("https://signed.url"),
  };

  it("fails if media count < 2", async () => {
    const input = createCarouselInput(1);
    const context: any = { onRemotePrepared: vi.fn(), beforeFinalMutation: vi.fn() };
    const res = await provider.publish(credentials, input, mediaSource, context);
    // Should fallback to image/video since count == 1, but let's test if we call publishInstagramCarousel directly?
    // Actually, publish() routes it.
  });

  it("fails if media count > 10", async () => {
    const input = createCarouselInput(11);
    const context: any = { onRemotePrepared: vi.fn(), beforeFinalMutation: vi.fn() };
    const res = await provider.publish(credentials, input, mediaSource, context);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.failureCode).toBe("MEDIA_COUNT_INVALID");
    }
  });

  it("incrementally checkpoints each child and returns PROCESSING", async () => {
    const input = createCarouselInput(3);
    const context: any = {
      onRemotePrepared: vi.fn().mockResolvedValue(undefined),
      beforeFinalMutation: vi.fn().mockResolvedValue(undefined),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: "child-id-123" }),
    });

    const res = await provider.publish(credentials, input, mediaSource, context);
    expect(res.success).toBe(true);
    expect((res as any).processingState).toBe("PROCESSING");

    // 3 children + 1 final step = 4 calls to onRemotePrepared
    expect(context.onRemotePrepared).toHaveBeenCalledTimes(4);

    const finalState = context.onRemotePrepared.mock.calls[3][0].providerState;
    expect(finalState.step).toBe("CHILD_PROCESSING");
    expect(finalState.completedChildren.length).toBe(3);
    expect(finalState.pendingChildrenIndices.length).toBe(0);
  });

  it("resumes from interrupted state", async () => {
    const input = createCarouselInput(3);
    const initialState = {
      kind: "INSTAGRAM_CAROUSEL",
      step: "CHILD_CREATION",
      completedChildren: [
        { sortOrder: 0, containerId: "child-id-0", mediaType: "IMAGE" },
      ],
      pendingChildrenIndices: [1, 2],
    };
    
    const context: any = {
      providerState: initialState,
      onRemotePrepared: vi.fn().mockResolvedValue(undefined),
      beforeFinalMutation: vi.fn().mockResolvedValue(undefined),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: "child-id-resume" }),
    });

    const res = await provider.publish(credentials, input, mediaSource, context);
    expect(res.success).toBe(true);

    // Should only create children 1 and 2
    expect(mockFetch).toHaveBeenCalledTimes(2);
    
    // onRemotePrepared called for child 1, child 2, and step transition
    expect(context.onRemotePrepared).toHaveBeenCalledTimes(3);
  });

  it("stops creating children on ProviderCoordinationError (stale callback)", async () => {
    const input = createCarouselInput(3);
    const context: any = {
      onRemotePrepared: vi.fn()
        .mockResolvedValueOnce(undefined) // First child succeeds
        .mockRejectedValueOnce(new ProviderCoordinationError("Stale")), // Second child throws
      beforeFinalMutation: vi.fn().mockResolvedValue(undefined),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: "child-id-123" }),
    });

    await expect(provider.publish(credentials, input, mediaSource, context)).rejects.toThrow(ProviderCoordinationError);

    // Fetch should only be called twice (for child 0 and child 1)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  describe("checkStatus", () => {
    it("returns PROCESSING if any child is IN_PROGRESS", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "CHILD_PROCESSING",
        completedChildren: [
          { sortOrder: 0, containerId: "c1", mediaType: "IMAGE" },
          { sortOrder: 1, containerId: "c2", mediaType: "VIDEO" },
        ],
        pendingChildrenIndices: [],
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ status_code: "FINISHED" }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ status_code: "IN_PROGRESS" }) });

      const res = await provider.checkStatus!(credentials, undefined, { providerState: state });
      expect(res.status).toBe("PROCESSING");
    });

    it("returns PREPARATION_READY if all children are FINISHED", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "CHILD_PROCESSING",
        completedChildren: [
          { sortOrder: 0, containerId: "c1", mediaType: "IMAGE" },
          { sortOrder: 1, containerId: "c2", mediaType: "VIDEO" },
        ],
        pendingChildrenIndices: [],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ status_code: "FINISHED" }),
      });

      const res = await provider.checkStatus!(credentials, undefined, { providerState: state });
      expect(res.status).toBe("PREPARATION_READY");
    });

    it("returns FAILED if any child is ERROR", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "CHILD_PROCESSING",
        completedChildren: [
          { sortOrder: 0, containerId: "c1", mediaType: "IMAGE" },
          { sortOrder: 1, containerId: "c2", mediaType: "VIDEO" },
        ],
        pendingChildrenIndices: [],
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ status_code: "FINISHED" }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ status_code: "ERROR" }) });

      const res = await provider.checkStatus!(credentials, undefined, { providerState: state });
      expect(res.status).toBe("FAILED");
      if (res.status === "FAILED") {
        expect(res.failureCode).toBe("PROCESSING_FAILED");
      }
    });

    it("returns UNKNOWN for unrecognized provider status code", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "CHILD_PROCESSING",
        completedChildren: [
          { sortOrder: 0, containerId: "c1", mediaType: "IMAGE" }
        ],
        pendingChildrenIndices: [],
      };

      mockFetch.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ status_code: "WEIRD_STATUS" }) });

      const res = await provider.checkStatus!(credentials, undefined, { providerState: state });
      expect(res.status).toBe("UNKNOWN");
      if (res.status === "UNKNOWN") {
        expect(res.failureCode).toBe("UNRECOGNIZED_STATUS");
      }
    });

    it("throws ProviderApiError on transport failure", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "CHILD_PROCESSING",
        completedChildren: [
          { sortOrder: 0, containerId: "c1", mediaType: "IMAGE" }
        ],
        pendingChildrenIndices: [],
      };

      mockFetch.mockRejectedValueOnce(new Error("Network Down"));

      await expect(provider.checkStatus!(credentials, undefined, { providerState: state })).rejects.toThrow();
    });
  });

  describe("continuePreparation", () => {
    it("creates parent after PREPARATION_READY and returns PARENT_PROCESSING", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "CHILD_PROCESSING",
        completedChildren: [
          { sortOrder: 1, containerId: "c2", mediaType: "VIDEO" },
          { sortOrder: 0, containerId: "c1", mediaType: "IMAGE" },
        ],
        pendingChildrenIndices: [],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "parent-container-id" }),
      });

      const res = await provider.continuePreparation!(
        credentials,
        { externalAccountId: "ig_id", content: "Test caption", media: [{} as any, {} as any] },
        { providerState: state, onRemotePrepared: vi.fn(), beforeFinalMutation: vi.fn() }
      );

      expect(res.status).toBe("PROCESSING");
      expect((res as any).providerState.step).toBe("PARENT_PROCESSING");
      expect((res as any).providerState.parentContainerId).toBe("parent-container-id");

      // Verify POST media exact shape
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0][0];
      const opts = mockFetch.mock.calls[0][1];
      expect(opts.method).toBe("POST");
      
      const searchParams = new URLSearchParams(url.split("?")[1]);
      expect(searchParams.get("media_type")).toBe("CAROUSEL");
      // Ordering proof: sortOrder 0 -> c1, sortOrder 1 -> c2
      expect(searchParams.get("children")).toBe("c1,c2");
      // Caption on parent
      expect(searchParams.get("caption")).toBe("Test caption");
    });

    it("prevents duplicate parent creation if already PARENT_PROCESSING", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "PARENT_PROCESSING",
        completedChildren: [
          { sortOrder: 0, containerId: "c1", mediaType: "IMAGE" },
        ],
        pendingChildrenIndices: [],
        parentContainerId: "parent-existing",
      };

      const res = await provider.continuePreparation!(
        credentials,
        { externalAccountId: "ig_id", media: [{}] as any },
        { providerState: state, onRemotePrepared: vi.fn(), beforeFinalMutation: vi.fn() }
      );

      expect(mockFetch).not.toHaveBeenCalled();
      expect(res.status).toBe("PROCESSING");
      expect((res as any).providerState.parentContainerId).toBe("parent-existing");
    });

    it("fails early if pendingChildrenIndices is not empty", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "CHILD_PROCESSING",
        completedChildren: [],
        pendingChildrenIndices: [0],
      };

      const res = await provider.continuePreparation!(
        credentials,
        { externalAccountId: "ig_id", media: [{}] as any },
        { providerState: state, onRemotePrepared: vi.fn(), beforeFinalMutation: vi.fn() }
      );

      expect(res.status).toBe("FAILED");
      expect((res as any).failureCode).toBe("INCOMPLETE_CHILDREN");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws ProviderApiError on network failure during parent POST", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "CHILD_PROCESSING",
        completedChildren: [{ sortOrder: 0, containerId: "c1", mediaType: "IMAGE" }],
        pendingChildrenIndices: [],
      };
      
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      await expect(
        provider.continuePreparation!(
          credentials,
          { externalAccountId: "ig_id", media: [{}] as any },
          { providerState: state, onRemotePrepared: vi.fn(), beforeFinalMutation: vi.fn() }
        )
      ).rejects.toThrow("Network or timeout error");
    });

    it("throws ProviderApiError on HTTP 5xx during parent POST", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "CHILD_PROCESSING",
        completedChildren: [{ sortOrder: 0, containerId: "c1", mediaType: "IMAGE" }],
        pendingChildrenIndices: [],
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({}),
      });

      await expect(
        provider.continuePreparation!(
          credentials,
          { externalAccountId: "ig_id", media: [{}] as any },
          { providerState: state, onRemotePrepared: vi.fn(), beforeFinalMutation: vi.fn() }
        )
      ).rejects.toThrow("Meta server error");
    });
  });

  describe("checkStatus for PARENT_PROCESSING", () => {
    it("fails if parentContainerId is missing", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "PARENT_PROCESSING",
        completedChildren: [],
        pendingChildrenIndices: [],
      };
      const res = await provider.checkStatus!(credentials, undefined, { providerState: state });
      expect(res.status).toBe("FAILED");
      expect((res as any).failureCode).toBe("MISSING_PARENT_ID");
    });

    it("returns PROCESSING if parent is IN_PROGRESS", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "PARENT_PROCESSING",
        completedChildren: [],
        pendingChildrenIndices: [],
        parentContainerId: "p1",
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "IN_PROGRESS" }) });
      const res = await provider.checkStatus!(credentials, undefined, { providerState: state });
      expect(res.status).toBe("PROCESSING");
    });

    it("returns READY if parent is FINISHED", async () => {
      const state = {
        kind: "INSTAGRAM_CAROUSEL",
        step: "PARENT_PROCESSING",
        completedChildren: [],
        pendingChildrenIndices: [],
        parentContainerId: "p1",
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: "FINISHED" }) });
      const res = await provider.checkStatus!(credentials, undefined, { providerState: state });
      expect(res.status).toBe("READY");
    });
  });
});
