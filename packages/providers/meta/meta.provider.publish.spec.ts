import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MetaProvider } from "./meta.provider";
import {
  ProviderExecutionCredentials,
  ProviderPublicationInput,
} from "../core/interfaces/IPublishingProvider";
import { Readable } from "stream";

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

    it("encoded Page ID", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "123" }),
      });
      const input = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "../../malicious",
        content: "C",
        providerOptions: {},
      };
      await provider.publish({ accessToken: "t" }, input);
      const url = (global.fetch as any).mock.calls[0][0];
      expect(url).toContain("..%2F..%2Fmalicious/feed");
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
        getStream: vi.fn().mockResolvedValue(Readable.from(["hello"])),
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
        getStream: vi.fn().mockResolvedValue(Readable.from([""])),
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
        getStream: vi.fn().mockResolvedValue(Readable.from([""])),
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
        getStream: vi.fn().mockResolvedValue(Readable.from([""])),
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
        getStream: vi.fn().mockResolvedValue(Readable.from([""])),
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
      const result = await igProvider.publish({ accessToken: "t" }, input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.failureCode).toBe("UNSUPPORTED_PROVIDER");
      }
    });

    it("Meta alias cannot execute Facebook publish", async () => {
      const metaProvider = new MetaProvider("meta");
      const input = {
        attemptId: "1",
        targetId: "2",
        workspaceId: "3",
        externalAccountId: "pageId",
        content: "C",
        providerOptions: {},
      };
      const result = await metaProvider.publish({ accessToken: "t" }, input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.failureCode).toBe("UNSUPPORTED_PROVIDER");
      }
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
        getStream: vi.fn().mockResolvedValue(Readable.from([""])),
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
