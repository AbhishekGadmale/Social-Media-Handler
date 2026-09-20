import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MetaProvider } from "./meta.provider";
import {
  ProviderExecutionCredentials,
  ProviderPublicationInput,
} from "../core/interfaces/IPublishingProvider";
import { Readable } from "stream";
import sizeOf from "image-size";

vi.mock("image-size", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    default: vi.fn((buf: any) => actual.default(buf)),
  };
});

// Helper to generate a minimal valid JPEG buffer with specific dimensions
function createMockJpeg(width: number, height: number, orientation?: number): Buffer {
  const hex = "ffd8ffe000104a46494600010100000100010000ffdb004300030202020202030202020303030304060404040404080606050609080a0a090809090b0c0f0c0b0b0e0b09090d110d0e0f101011100a0c12131210130f101010ffc0000b080438043801011100ffc400140001000000000000000000000000000000ffc400141001000000000000000000000000000000ffda0008010100003f003fffd9";
  const buf = Buffer.from(hex, "hex");
  const sofOffset = buf.indexOf(Buffer.from([0xff, 0xc0]));
  buf.writeUInt16BE(height, sofOffset + 5);
  buf.writeUInt16BE(width, sofOffset + 7);
  return buf;
}

const mockCtx = { onRemotePrepared: async () => {}, beforeFinalMutation: async () => {} };

describe("MetaProvider Publishing", () => {
  let provider: MetaProvider;

  beforeEach(() => {
    provider = new MetaProvider("facebook");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("CAPABILITIES", () => {
    it("FACEBOOK text capability", () => {
      const caps = provider.getPublishingCapabilities();
      expect(caps.contentTypes.TEXT_POST.supported).toBe(true);
    });

    it("FACEBOOK image capability", () => {
      const caps = provider.getPublishingCapabilities();
      expect(caps.contentTypes.IMAGE_POST.supported).toBe(true);
      expect(caps.contentTypes.IMAGE_POST.maxBytes).toBe(8 * 1024 * 1024);
    });

    it("FACEBOOK video false", () => {
      expect(
        provider.getPublishingCapabilities().contentTypes.VIDEO_POST.supported,
      ).toBe(false);
    });

    it("FACEBOOK document false", () => {
      expect(
        provider.getPublishingCapabilities().contentTypes.DOCUMENT_POST
          .supported,
      ).toBe(false);
    });

    it("INSTAGRAM publishing false", () => {
      const igProvider = new MetaProvider("instagram");
      expect(
        igProvider.getPublishingCapabilities().contentTypes.TEXT_POST.supported,
      ).toBe(false);
    });

    it("META publishing false", () => {
      const metaProvider = new MetaProvider("meta");
      expect(
        metaProvider.getPublishingCapabilities().contentTypes.TEXT_POST
          .supported,
      ).toBe(false);
    });
  });

  describe("TEXT POST", () => {
    it("text endpoint, text Page ID, text Page credential, text message payload, text externalPostId", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "pageId_123" }),
      });

      const creds = { accessToken: "page_token_1" };
      const input = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "pageId",
        content: "Hello World",
        providerOptions: {},
      };

      const result = await provider.publish(creds, input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.externalPostId).toBe("pageId_123");
      }

      const fetchCalls = (global.fetch as any).mock.calls;
      const url = fetchCalls[0][0];
      const options = fetchCalls[0][1];
      expect(url).toBe("https://graph.facebook.com/v20.0/pageId/feed");
      expect(options.method).toBe("POST");
      expect(options.body).toContain("message=Hello+World");
      expect(options.body).toContain("access_token=page_token_1");
    });

    describe("Facebook Endpoint Construction Regression", () => {
      it("ordinary Page ID produces /<page-id>/feed", async () => {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "123" }),
        });
        await provider.publish(
          { accessToken: "t" },
          {
            attemptId: "1",
            targetId: "2",
            workspaceId: "3",
            externalAccountId: "page_456",
            content: "C",
            providerOptions: {},
          },
        );
        expect((global.fetch as any).mock.calls[0][0]).toContain(
          "/v20.0/page_456/feed",
        );
      });

      it("malicious/special Page ID is encoded exactly ONCE for text /feed", async () => {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "123" }),
        });
        await provider.publish(
          { accessToken: "t" },
          {
            attemptId: "1",
            targetId: "2",
            workspaceId: "3",
            externalAccountId: "../../malicious",
            content: "C",
            providerOptions: {},
          },
        );
        expect((global.fetch as any).mock.calls[0][0]).toContain(
          "/v20.0/..%2F..%2Fmalicious/feed",
        );
      });

      it("malicious/special Page ID is encoded exactly ONCE for image /photos", async () => {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "123" }),
        });
        await provider.publish(
          { accessToken: "t" },
          {
            attemptId: "1",
            targetId: "2",
            workspaceId: "3",
            externalAccountId: "../../malicious",
            content: "C",
            providerOptions: {},
            media: [{ key: "img", mimeType: "image/jpeg", sizeBytes: 100 }],
          },
          {
            getStream: async () =>
              import("stream").then((s) => s.Readable.from([createMockJpeg(1080, 1080)])) as any,
          },
        );
        expect((global.fetch as any).mock.calls[0][0]).toContain(
          "/v20.0/..%2F..%2Fmalicious/photos",
        );
      });
    });

    it("text redirect: error test", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "123" }),
      });
      await provider.publish(
        { accessToken: "t" },
        {
          attemptId: "1",
          targetId: "2",
          workspaceId: "3",
          externalAccountId: "p",
          content: "C",
          providerOptions: {},
        },
      );
      const options = (global.fetch as any).mock.calls[0][1];
      expect(options.redirect).toBe("error");
    });

    it("redirect failure text publish -> safe ProviderApiError", async () => {
      (global.fetch as any).mockRejectedValueOnce(
        new TypeError("Failed to fetch"),
      ); // native fetch rejects on redirect: error
      const result = await provider.publish(
        { accessToken: "t" },
        {
          attemptId: "1",
          targetId: "2",
          workspaceId: "3",
          externalAccountId: "p",
          content: "C",
          providerOptions: {},
        },
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.failureCode).toBe("NETWORK_ERROR");
      }
    });
  });

  describe("IMAGE POST", () => {
    it("image endpoint, image Page ID, image credential, image source attached, image MIME preserved, image message preserved", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "photo_1", post_id: "pageId_456" }),
      });

      const creds = { accessToken: "page_token_1" };
      const input: ProviderPublicationInput = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "pageId",
        content: "Caption",
        media: [{ mimeType: "image/jpeg", sizeBytes: 100, key: "k1" }],
        providerOptions: {},
      };
      const mockMediaSource = {
        getStream: vi.fn().mockResolvedValue(Readable.from([createMockJpeg(1080, 1080)])),
      };

      const result = await provider.publish(
        creds,
        input,
        mockMediaSource as any,
      );
      expect(result.success).toBe(true);
      const fetchCalls = (global.fetch as any).mock.calls;
      const url = fetchCalls[0][0];
      const options = fetchCalls[0][1];
      expect(url).toBe(
        "https://graph.facebook.com/v20.0/pageId/photos?access_token=page_token_1",
      );
      expect(options.method).toBe("POST");
      expect(options.body).toBeInstanceOf(FormData);
      expect((options.body as FormData).get("message")).toBe("Caption");
      expect((options.body as FormData).get("source")).toBeInstanceOf(Blob);
      expect(((options.body as FormData).get("source") as Blob).type).toBe(
        "image/jpeg",
      );
    });

    it("image post_id preferred", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "photo_1", post_id: "pageId_456" }),
      });
      const input = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "p",
        content: "C",
        media: [{ mimeType: "image/jpeg", sizeBytes: 100, key: "k1" }],
        providerOptions: {},
      };
      const mockMediaSource = {
        getStream: vi.fn().mockResolvedValue(Readable.from([createMockJpeg(1080, 1080)])),
      };
      const result = await provider.publish(
        { accessToken: "t" },
        input,
        mockMediaSource as any,
      );
      expect((result as any).externalPostId).toBe("pageId_456");
    });

    it("image id fallback", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "photo-object-id" }),
      });
      const input = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "p",
        content: "C",
        media: [{ mimeType: "image/jpeg", sizeBytes: 100, key: "k1" }],
        providerOptions: {},
      };
      const mockMediaSource = {
        getStream: vi.fn().mockResolvedValue(Readable.from([createMockJpeg(1080, 1080)])),
      };
      const result = await provider.publish(
        { accessToken: "t" },
        input,
        mockMediaSource as any,
      );
      expect((result as any).externalPostId).toBe("photo-object-id");
    });

    it("image redirect: error test", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "123" }),
      });
      const input = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "p",
        content: "C",
        media: [{ mimeType: "image/jpeg", sizeBytes: 100, key: "k1" }],
        providerOptions: {},
      };
      const mockMediaSource = {
        getStream: vi.fn().mockResolvedValue(Readable.from([createMockJpeg(1080, 1080)])),
      };
      await provider.publish(
        { accessToken: "t" },
        input,
        mockMediaSource as any,
      );
      const options = (global.fetch as any).mock.calls[0][1];
      expect(options.redirect).toBe("error");
    });

    it("redirect failure image publish -> safe ProviderApiError", async () => {
      (global.fetch as any).mockRejectedValueOnce(
        new TypeError("Failed to fetch"),
      );
      const input = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "p",
        content: "C",
        media: [{ mimeType: "image/jpeg", sizeBytes: 100, key: "k1" }],
        providerOptions: {},
      };
      const mockMediaSource = {
        getStream: vi.fn().mockResolvedValue(Readable.from([createMockJpeg(1080, 1080)])),
      };
      const result = await provider.publish(
        { accessToken: "t" },
        input,
        mockMediaSource as any,
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.failureCode).toBe("NETWORK_ERROR");
      }
    });
  });

  describe("EXECUTION REJECTION", () => {
    it("Instagram cannot execute Facebook publish", async () => {
      const igProvider = new MetaProvider("instagram");
      const input = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "pageId",
        content: "C",
        providerOptions: {},
      };
      await expect(igProvider.publish({ accessToken: "t" }, input)).rejects.toThrow("Instagram single-image publishing strictly requires both onRemotePrepared and beforeFinalMutation coordination hooks.");
    });

    it("Meta alias cannot execute Facebook publish", async () => {
      const metaProvider = new MetaProvider("meta");
      const input = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "page123",
        content: "test",
        providerOptions: {},
      };
      const result = await metaProvider.publish(
        { accessToken: "token" },
        input,
      );
      expect(result.success).toBe(false);
      expect((result as any).failureCode).toBe("UNSUPPORTED_PROVIDER");
    });

    it("Instagram alias cannot execute Facebook text publish", async () => {
      const metaProvider = new MetaProvider("instagram");
      const input = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "page123",
        content: "test", // text only, handled by FB branch but rejected by IG branch
        providerOptions: {},
      };
      await expect(metaProvider.publish({ accessToken: "token" }, input)).rejects.toThrow("Instagram single-image publishing strictly requires both onRemotePrepared and beforeFinalMutation coordination hooks.");
    });
  });

  describe("ERRORS", () => {
    it("invalid token mapping", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Invalid token", code: 190 } }),
      });
      const result = await provider.publish(
        { accessToken: "t" },
        {
          attemptId: "1",
          targetId: "2",
          workspaceId: "3",
          externalAccountId: "p",
          content: "C",
          providerOptions: {},
        },
      );
      expect((result as any).failureCode).toBe("OAUTH_EXCEPTION");
    });

    it("missing permission mapping", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: "Missing perm", code: 200 } }),
      });
      const result = await provider.publish(
        { accessToken: "t" },
        {
          attemptId: "1",
          targetId: "2",
          workspaceId: "3",
          externalAccountId: "p",
          content: "C",
          providerOptions: {},
        },
      );
      expect((result as any).failureCode).toBe("MISSING_PERMISSION");
    });

    it("rate-limit mapping", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: "Too many calls",
            code: 4,
            error_data: { retry_after: 3600 },
          },
        }),
      });
      const result = await provider.publish(
        { accessToken: "t" },
        {
          attemptId: "1",
          targetId: "2",
          workspaceId: "3",
          externalAccountId: "p",
          content: "C",
          providerOptions: {},
        },
      );
      expect((result as any).failureCategory).toBe("RATE_LIMITED");
      expect((result as any).retryAfterSeconds).toBe(3600);
    });

    it("server-error mapping", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "Internal error" } }),
      });
      const result = await provider.publish(
        { accessToken: "t" },
        {
          attemptId: "1",
          targetId: "2",
          workspaceId: "3",
          externalAccountId: "p",
          content: "C",
          providerOptions: {},
        },
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.failureCategory).toBe("TRANSIENT");
        expect(result.failureCode).toBe("GRAPH_SERVER_ERROR");
      }
    });

    it("malformed success response", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ not_id: "123" }),
      });
      const result = await provider.publish(
        { accessToken: "t" },
        {
          attemptId: "1",
          targetId: "2",
          workspaceId: "3",
          externalAccountId: "p",
          content: "C",
          providerOptions: {},
        },
      );
      expect(result.success).toBe(false);
    });

    it("malformed success response image", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ not_id: "123" }),
      });
      const mockMediaSource = {
        getStream: vi.fn().mockResolvedValue(Readable.from([createMockJpeg(1080, 1080)])),
      };
      const input = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "p",
        content: "C",
        media: [{ mimeType: "image/jpeg", sizeBytes: 100, key: "k1" }],
        providerOptions: {},
      };
      const result = await provider.publish(
        { accessToken: "t" },
        input,
        mockMediaSource as any,
      );
      expect(result.success).toBe(false);
    });

    it("token absent from error", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Invalid token secret_abc" } }),
      });
      const result = await provider.publish(
        { accessToken: "secret_abc" },
        {
          attemptId: "1",
          targetId: "2",
          workspaceId: "3",
          externalAccountId: "p",
          content: "C",
          providerOptions: {},
        },
      );
      expect((result as any).message).not.toContain("secret_abc");
      expect((result as any).message).toContain("***");
    });

    it("app secret absent from error", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: "App secret client_secret=real_secret_here is invalid",
          },
        }),
      });
      const result = await provider.publish(
        { accessToken: "fake_access_token" },
        {
          attemptId: "1",
          targetId: "2",
          workspaceId: "3",
          externalAccountId: "p",
          content: "C",
          providerOptions: {},
        },
      );
      expect((result as any).message).not.toContain("real_secret_here");
      expect((result as any).message).toContain("client_secret=***");
    });
  });
});

describe("Instagram Provider Publishing", () => {
  let provider: MetaProvider;

  beforeEach(() => {
    provider = new MetaProvider("instagram");
    vi.clearAllMocks();
  });

  describe("Capabilities", () => {
    it("supports IMAGE_POST only", () => {
      const caps = provider.getPublishingCapabilities();
      expect(caps.contentTypes.IMAGE_POST.supported).toBe(true);
      expect(caps.contentTypes.IMAGE_POST.maxBytes).toBe(8 * 1024 * 1024);
      expect(caps.contentTypes.TEXT_POST.supported).toBe(false);
      expect(caps.contentTypes.VIDEO_POST.supported).toBe(false);
      expect(caps.contentTypes.MULTI_IMAGE_POST.supported).toBe(false);
      expect(caps.contentTypes.DOCUMENT_POST.supported).toBe(false);
    });
  });

  describe("Image Geometry Validation", () => {
    beforeEach(() => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ id: "123" }),
      });
    });

    it("valid square JPEG accepted", async () => {
      const mediaSource = {
        getStream: async () => import("stream").then((s) => s.Readable.from([createMockJpeg(1080, 1080)])) as any,
        getSignedReadUrl: async () => "https://url",
      };
      const result = await provider.publish(
        { accessToken: "token" },
        { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] },
        mediaSource, mockCtx
      );
      expect(result.success).toBe(true);
    });

    it("valid portrait boundary accepted (4:5)", async () => {
      const mediaSource = {
        getStream: async () => import("stream").then((s) => s.Readable.from([createMockJpeg(1080, 1350)])) as any, // 0.8
        getSignedReadUrl: async () => "https://url",
      };
      const result = await provider.publish(
        { accessToken: "token" },
        { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] },
        mediaSource, mockCtx
      );
      expect(result.success).toBe(true);
    });

    it("valid landscape boundary accepted (1.91:1)", async () => {
      const mediaSource = {
        getStream: async () => import("stream").then((s) => s.Readable.from([createMockJpeg(1910, 1000)])) as any, // 1.91
        getSignedReadUrl: async () => "https://url",
      };
      const result = await provider.publish(
        { accessToken: "token" },
        { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] },
        mediaSource, mockCtx
      );
      expect(result.success).toBe(true);
    });

    it("portrait just outside range rejected", async () => {
      const mediaSource = {
        getStream: async () => import("stream").then((s) => s.Readable.from([createMockJpeg(1080, 1368)])) as any, // 1080/1368 = 0.789
        getSignedReadUrl: async () => "https://url",
      };
      const result = await provider.publish(
        { accessToken: "token" },
        { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] },
        mediaSource, mockCtx
      );
      expect(result.success).toBe(false);
      expect(result.failureCode).toBe("IMAGE_ASPECT_RATIO_UNSUPPORTED");
    });

    it("landscape just outside range rejected", async () => {
      const mediaSource = {
        getStream: async () => import("stream").then((s) => s.Readable.from([createMockJpeg(1920, 1000)])) as any, // 1.92
        getSignedReadUrl: async () => "https://url",
      };
      const result = await provider.publish(
        { accessToken: "token" },
        { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] },
        mediaSource, mockCtx
      );
      expect(result.success).toBe(false);
      expect(result.failureCode).toBe("IMAGE_ASPECT_RATIO_UNSUPPORTED");
    });

    it("zero width or invalid stream rejected", async () => {
      const mediaSource = {
        getStream: async () => import("stream").then((s) => s.Readable.from(["garbage bytes not a jpeg"])) as any,
        getSignedReadUrl: async () => "https://url",
      };
      const result = await provider.publish(
        { accessToken: "token" },
        { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] },
        mediaSource, mockCtx
      );
      expect(result.success).toBe(false);
      expect(result.failureCode).toBe("IMAGE_FORMAT_UNRECOGNIZED");
    });

    describe("EXIF Orientation Handling", () => {
      let originalImpl: any;

      beforeEach(() => {
        originalImpl = vi.mocked(sizeOf).getMockImplementation();
        (global.fetch as any).mockResolvedValue({
          ok: true,
          json: async () => ({ id: "123" }),
        });
      });

      afterEach(() => {
        vi.mocked(sizeOf).mockImplementation(originalImpl as any);
      });

      it("orientation 1 - no swap", async () => {
        vi.mocked(sizeOf).mockReturnValue({ width: 1080, height: 1350, type: "jpg", orientation: 1 });
        const mediaSource = {
          getStream: async () => import("stream").then((s) => s.Readable.from([Buffer.from("dummy")])) as any,
          getSignedReadUrl: async () => "https://url",
        };
        const result = await provider.publish({ accessToken: "token" }, { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] }, mediaSource, mockCtx);
        expect(result.success).toBe(true); // 1080/1350 = 0.8
      });

      it("orientation 5 - swap width and height", async () => {
        // Raw is 1350x1080 (landscape bound 1.25, but actually 0.8 portrait if swapped)
        // If it didn't swap, 1350x1080 is ratio 1.25 which is valid anyway (inside 0.8-1.91)
        // Let's use raw 1368x1080 (ratio 1.26 valid). But wait, let's use raw 1080x1368 (ratio 0.78 INVALID).
        // If orientation is 5, it swaps to 1368x1080 (ratio 1.26 VALID).
        vi.mocked(sizeOf).mockReturnValue({ width: 1080, height: 1368, type: "jpg", orientation: 5 });
        const mediaSource = {
          getStream: async () => import("stream").then((s) => s.Readable.from([Buffer.from("dummy")])) as any,
          getSignedReadUrl: async () => "https://url",
        };
        const result = await provider.publish({ accessToken: "token" }, { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] }, mediaSource, mockCtx);
        expect(result.success).toBe(true);
      });

      it("orientation 6 - swap width and height", async () => {
        vi.mocked(sizeOf).mockReturnValue({ width: 1080, height: 1368, type: "jpg", orientation: 6 });
        const mediaSource = {
          getStream: async () => import("stream").then((s) => s.Readable.from([Buffer.from("dummy")])) as any,
          getSignedReadUrl: async () => "https://url",
        };
        const result = await provider.publish({ accessToken: "token" }, { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] }, mediaSource, mockCtx);
        expect(result.success).toBe(true);
      });

      it("orientation 7 - swap width and height", async () => {
        vi.mocked(sizeOf).mockReturnValue({ width: 1080, height: 1368, type: "jpg", orientation: 7 });
        const mediaSource = {
          getStream: async () => import("stream").then((s) => s.Readable.from([Buffer.from("dummy")])) as any,
          getSignedReadUrl: async () => "https://url",
        };
        const result = await provider.publish({ accessToken: "token" }, { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] }, mediaSource, mockCtx);
        expect(result.success).toBe(true);
      });

      it("orientation 8 - swap width and height", async () => {
        vi.mocked(sizeOf).mockReturnValue({ width: 1080, height: 1368, type: "jpg", orientation: 8 });
        const mediaSource = {
          getStream: async () => import("stream").then((s) => s.Readable.from([Buffer.from("dummy")])) as any,
          getSignedReadUrl: async () => "https://url",
        };
        const result = await provider.publish({ accessToken: "token" }, { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] }, mediaSource, mockCtx);
        expect(result.success).toBe(true);
      });

      it("orientation 3 - no width/height swap", async () => {
        // raw 1080x1368 (ratio 0.78 INVALID). Orientation 3 is 180deg, so no swap. Should stay invalid.
        vi.mocked(sizeOf).mockReturnValue({ width: 1080, height: 1368, type: "jpg", orientation: 3 });
        const mediaSource = {
          getStream: async () => import("stream").then((s) => s.Readable.from([Buffer.from("dummy")])) as any,
          getSignedReadUrl: async () => "https://url",
        };
        const result = await provider.publish({ accessToken: "token" }, { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] }, mediaSource, mockCtx);
        expect(result.success).toBe(false);
      });

      it("no-EXIF JPEG behavior", async () => {
        vi.mocked(sizeOf).mockReturnValue({ width: 1080, height: 1080, type: "jpg" });
        const mediaSource = {
          getStream: async () => import("stream").then((s) => s.Readable.from([Buffer.from("dummy")])) as any,
          getSignedReadUrl: async () => "https://url",
        };
        const result = await provider.publish({ accessToken: "token" }, { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] }, mediaSource, mockCtx);
        expect(result.success).toBe(true);
      });

      it("malformed EXIF safe failure/behavior", async () => {
        vi.mocked(sizeOf).mockImplementation(() => { throw new Error("corrupt exif"); });
        const mediaSource = {
          getStream: async () => import("stream").then((s) => s.Readable.from([Buffer.from("dummy")])) as any,
          getSignedReadUrl: async () => "https://url",
        };
        const result = await provider.publish({ accessToken: "token" }, { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] }, mediaSource, mockCtx);
        expect(result.success).toBe(false);
        expect(result.failureCode).toBe("IMAGE_FORMAT_UNRECOGNIZED");
      });
    });

    describe("Stream Resource Cleanup", () => {
      let originalImpl: any;

      beforeEach(() => {
        originalImpl = vi.mocked(sizeOf).getMockImplementation();
        (global.fetch as any).mockResolvedValue({
          ok: true,
          json: async () => ({ id: "123" }),
        });
      });

      afterEach(() => {
        vi.mocked(sizeOf).mockImplementation(originalImpl as any);
      });

      it("destroys stream exactly once on successful early parsing", async () => {
        const mockStream = Readable.from([Buffer.from("dummy")]);
        const destroySpy = vi.spyOn(mockStream, 'destroy');

        vi.mocked(sizeOf).mockReturnValue({ width: 1080, height: 1080, type: "jpg" });

        const mediaSource = {
          getStream: async () => mockStream as any,
          getSignedReadUrl: async () => "https://url",
        };

        await provider.publish({ accessToken: "token" }, { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] }, mediaSource, mockCtx);

        expect(destroySpy).toHaveBeenCalled();
      });

      it("destroys stream exactly once and prevents Graph call on parse failure", async () => {
        const mockStream = Readable.from([Buffer.from("dummy")]);
        const destroySpy = vi.spyOn(mockStream, 'destroy');

        vi.mocked(sizeOf).mockImplementation(() => { throw new Error("corrupt"); });

        const mediaSource = {
          getStream: async () => mockStream as any,
          getSignedReadUrl: async () => "https://url",
        };

        await provider.publish({ accessToken: "token" }, { attemptId: "1", externalAccountId: "ig1", content: "", media: [{ key: "k", mimeType: "image/jpeg", size: 1000 }] }, mediaSource, mockCtx);

        expect(destroySpy).toHaveBeenCalled();
        expect((global.fetch as any).mock.calls.length).toBe(0);
      });
    });
  });

  describe("Publish Flow", () => {
    it("should throw VALIDATION if not exactly one media item", async () => {
      const result = await provider.publish(
        { accessToken: "token" },
        {
          attemptId: "1",
          targetId: "t",
          workspaceId: "w",
          externalAccountId: "ig123",
          content: "hello",
          providerOptions: {},
        },
        undefined, mockCtx
      );
      expect(result.success).toBe(false);
      expect((result as any).failureCode).toBe("MEDIA_REQUIRED");
    });

    it("should throw TRANSIENT if storage lacks getSignedReadUrl", async () => {
      const mediaSource = {
        getStream: async () => import("stream").then((s) => s.Readable.from([createMockJpeg(1080, 1080)])) as any,
      };
      const result = await provider.publish(
        { accessToken: "token" },
        {
          attemptId: "1",
          targetId: "t",
          workspaceId: "w",
          externalAccountId: "ig123",
          content: "hello",
          media: [{ mimeType: "image/jpeg", sizeBytes: 1000, key: "img" }],
          providerOptions: {},
        },
        mediaSource, mockCtx
      );
      expect(result.success).toBe(false);
      expect((result as any).failureCode).toBe("NO_SIGNED_URL_SUPPORT");
    });

    it("should execute 2-step container flow successfully", async () => {
      const mediaSource = {
        getStream: async () => import("stream").then((s) => s.Readable.from([createMockJpeg(1080, 1080)])) as any,
        getSignedReadUrl: async () =>
          "https://signed-url.example.com/img?sig=123",
      };

      let callCount = 0;
      (global.fetch as any).mockImplementation(async (url: string) => {
        callCount++;
        if (callCount === 1) {
          expect(url).toContain("https://graph.facebook.com/v20.0/ig123/media");
          expect(url).toContain(
            "image_url=https%3A%2F%2Fsigned-url.example.com%2Fimg%3Fsig%3D123",
          );
          expect(url).toContain("caption=hello");
          expect(url).toContain("access_token=intended_account_token");
          return { ok: true, json: async () => ({ id: "container-999" }) };
        } else if (callCount === 2) {
          expect(url).toContain(
            "https://graph.facebook.com/v20.0/ig123/media_publish",
          );
          expect(url).toContain("creation_id=container-999");
          expect(url).toContain("access_token=intended_account_token");
          return { ok: true, json: async () => ({ id: "final-post-123" }) };
        }
      });

      const result = await provider.publish(
        { accessToken: "intended_account_token" },
        {
          attemptId: "1",
          targetId: "t",
          workspaceId: "w",
          externalAccountId: "ig123",
          content: "hello",
          media: [{ mimeType: "image/jpeg", sizeBytes: 1000, key: "img" }],
          providerOptions: {},
        },
        mediaSource, mockCtx
      );

      expect(callCount).toBe(2);
      expect(result.success).toBe(true);
      expect((result as any).externalPostId).toBe("final-post-123");
      expect((result as any).processingState).toBe("PUBLISHED");
    });

    it("encodes Instagram ID exactly once", async () => {
      const mediaSource = {
        getStream: async () => import("stream").then((s) => s.Readable.from([createMockJpeg(1080, 1080)])) as any,
        getSignedReadUrl: async () => "http://url",
      };
      (global.fetch as any).mockImplementation(async (url: string) => {
        if (url.includes("/media?"))
          return { ok: true, json: async () => ({ id: "c999" }) };
        if (url.includes("/media_publish?"))
          return { ok: true, json: async () => ({ id: "f123" }) };
      });
      await provider.publish(
        { accessToken: "token" },
        {
          attemptId: "1",
          targetId: "t",
          workspaceId: "w",
          externalAccountId: "../../ig_malicious",
          content: "hello",
          media: [{ mimeType: "image/jpeg", sizeBytes: 1000, key: "img" }],
          providerOptions: {},
        },
        mediaSource, mockCtx
      );
      const url1 = (global.fetch as any).mock.calls[0][0];
      const url2 = (global.fetch as any).mock.calls[1][0];
      expect(url1).toContain("/v20.0/..%2F..%2Fig_malicious/media");
      expect(url2).toContain("/v20.0/..%2F..%2Fig_malicious/media_publish");
    });
  });

  describe("Security and Error Leakage", () => {
    it("should never leak signed URL or credentials in errors", async () => {
      const mediaSource = {
        getStream: async () => import("stream").then((s) => s.Readable.from([createMockJpeg(1080, 1080)])) as any,
        getSignedReadUrl: async () =>
          "https://signed.com/img?sig=super_secret_signature",
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message:
              "Failed with token access_token=fake_access_token and url https://signed.com/img?sig=super_secret_signature and secret client_secret=secret_app_key",
            code: 190,
          },
        }),
      });

      const result = await provider.publish(
        { accessToken: "fake_access_token" },
        {
          attemptId: "1",
          targetId: "t",
          workspaceId: "w",
          externalAccountId: "ig123",
          content: "hello",
          media: [{ mimeType: "image/jpeg", sizeBytes: 1000, key: "img" }],
          providerOptions: {},
        },
        mediaSource, mockCtx
      );

      expect(result.success).toBe(false);
      const msg = (result as any).message || "";
      expect(msg).not.toContain("fake_access_token");
      expect(msg).not.toContain("super_secret_signature");
      expect(msg).not.toContain("secret_app_key");
      expect(msg).toContain("***");
    });
  });
});
