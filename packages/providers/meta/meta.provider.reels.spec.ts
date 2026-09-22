import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MetaProvider } from "./meta.provider";
import { ProviderCoordinationError } from "../core/errors/index";

describe("Instagram Reels Publishing", () => {
  let provider: MetaProvider;
  let mockContext: any;
  let mockMediaSource: any;

  beforeEach(() => {
    provider = new MetaProvider("instagram", "123", "secret");
    mockContext = {
      onRemotePrepared: vi.fn().mockResolvedValue(undefined),
      beforeFinalMutation: vi.fn().mockResolvedValue(undefined),
    };
    mockMediaSource = {
      getSignedReadUrl: vi.fn().mockResolvedValue("https://signed-url.com/vid.mp4"),
      getStream: vi.fn(), // Not used for video since no geometry validation yet
    };
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createVideoInput = () => ({
    attemptId: "att-1",
    targetId: "var-1",
    workspaceId: "ws-1",
    externalAccountId: "ig-123",
    content: "Hello Reels",
    media: [{ mimeType: "video/mp4", sizeBytes: 100, key: "s3/vid.mp4" }],
    providerOptions: {},
  });

  it("A. video/reel request uses correct Meta endpoint/fields", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "container_id_1" }),
    });

    const res = await provider.publish(
      { accessToken: "token1" },
      createVideoInput(),
      mockMediaSource,
      mockContext
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.processingState).toBe("PROCESSING");
      expect(res.externalPostId).toBe("container_id_1");
    }

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toContain("/ig-123/media?");
    expect(url).toContain("video_url=https%3A%2F%2Fsigned-url.com%2Fvid.mp4");
    expect(url).toContain("media_type=REELS");
    expect(url).toContain("caption=Hello+Reels");
  });

  it("B. missing required context fails closed before remote mutation", async () => {
    const res = provider.publish(
      { accessToken: "token1" },
      createVideoInput(),
      mockMediaSource,
      // No context
    );
    await expect(res).rejects.toThrow("Instagram publishing strictly requires both onRemotePrepared and beforeFinalMutation coordination hooks.");
  });

  it("C. container creation success returns correct stable container/status ID", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "stable_cont_id" }),
    });

    const res = await provider.publish(
      { accessToken: "token1" },
      createVideoInput(),
      mockMediaSource,
      mockContext
    );

    expect(res.success).toBe(true);
    expect((res as any).externalPostId).toBe("stable_cont_id");
  });

  it("D. onRemotePrepared called exactly once with correct ID", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cont_42" }),
    });

    await provider.publish(
      { accessToken: "token1" },
      createVideoInput(),
      mockMediaSource,
      mockContext
    );

    expect(mockContext.onRemotePrepared).toHaveBeenCalledTimes(1);
    expect(mockContext.onRemotePrepared).toHaveBeenCalledWith({ containerId: "cont_42" });
  });

  it("E. onRemotePrepared failure prevents later final mutation", async () => {
    mockContext.onRemotePrepared.mockRejectedValue(new ProviderCoordinationError("DB Down"));
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cont_42" }),
    });

    const res = provider.publish(
      { accessToken: "token1" },
      createVideoInput(),
      mockMediaSource,
      mockContext
    );

    await expect(res).rejects.toThrow("DB Down");
    // fetch called once for container creation
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("F. status check PROCESSING mapping", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status_code: "IN_PROGRESS" }),
    });
    const res = await provider.checkStatus!({ accessToken: "t" }, "cont_1");
    expect(res.status).toBe("PROCESSING");
  });

  it("G. status check READY mapping", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status_code: "FINISHED" }),
    });
    const res = await provider.checkStatus!({ accessToken: "t" }, "cont_1");
    expect(res.status).toBe("READY");
  });

  it("H. status check definitive processing ERROR mapping", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status_code: "ERROR" }),
    });
    const res = await provider.checkStatus!({ accessToken: "t" }, "cont_1");
    expect(res.status).toBe("FAILED");
    expect(res.failureCode).toBe("PROCESSING_FAILED");
  });

  it("I. status request temporary network failure mapping", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network Down"));
    const res = await provider.checkStatus!({ accessToken: "t" }, "cont_1");
    expect(res.status).toBe("UNKNOWN");
    expect(res.failureCategory).toBe("UNKNOWN_RESULT");
  });

  it("J. finalization requires beforeFinalMutation", async () => {
    await expect(provider.finalizePublish!({ accessToken: "t" }, createVideoInput(), "cont_1")).rejects.toThrow("Instagram finalization strictly requires beforeFinalMutation coordination hook.");
  });

  it("K. finalization calls /media_publish exactly once", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "final_media_id" }),
    });

    const res = await provider.finalizePublish!({ accessToken: "t" }, createVideoInput(), "cont_1", mockContext);
    expect(res.success).toBe(true);
    expect((res as any).externalPostId).toBe("final_media_id");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toContain("/ig-123/media_publish?");
    expect(url).toContain("creation_id=cont_1");
  });

  it("L. beforeFinalMutation failure: /media_publish = 0", async () => {
    mockContext.beforeFinalMutation.mockRejectedValue(new ProviderCoordinationError("CAS Stale"));
    global.fetch = vi.fn();

    await expect(
      provider.finalizePublish!({ accessToken: "t" }, createVideoInput(), "cont_1", mockContext)
    ).rejects.toThrow("CAS Stale");

    expect(global.fetch).toHaveBeenCalledTimes(0);
  });

  it("M. final success returns authoritative published Reel ID", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "final_auth_id" }),
    });
    const res = await provider.finalizePublish!({ accessToken: "t" }, createVideoInput(), "cont_1", mockContext);
    expect(res.success).toBe(true);
    expect((res as any).externalPostId).toBe("final_auth_id");
  });

  it("N. signed video URL is never returned/persisted in result metadata", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "container_id_1" }),
    });

    const res = await provider.publish(
      { accessToken: "token1" },
      createVideoInput(),
      mockMediaSource,
      mockContext
    );

    expect(res.success).toBe(true);
    expect(JSON.stringify(res)).not.toContain("signed-url.com");
  });
});
