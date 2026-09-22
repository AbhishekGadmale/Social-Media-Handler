import {
  AuthUrlInput,
  OAuthCredentials,
  CapabilityContext,
  ProviderCapabilities,
  ProviderProfileResult,
} from "../core/types/index";
import { ISocialProvider } from "../core/interfaces/ISocialProvider";
import { ProviderApiError, ProviderCoordinationError } from "../core/errors/index";
import {
  IPublishingProvider,
  ProviderStatusCheckResult,
  ProviderPublishContext,
  PublishingCapabilities,
  ProviderOptionsValidationResult,
  ProviderExecutionCredentials,
  ProviderPublicationInput,
  ProviderPublishResult,
  ProviderPublishFailure,
} from "../core/interfaces/IPublishingProvider";
import { IMediaContentSource } from "../core/interfaces/IMediaContentSource";
import sizeOf from "image-size";

export class MetaProvider implements ISocialProvider, IPublishingProvider {
  private readonly version = "v20.0";
  private readonly baseUrl = "https://graph.facebook.com";
  private readonly INSTAGRAM_SIGNED_URL_TTL_SECONDS = 300;

  constructor(private readonly providerAlias: string = "meta") {}

  private sanitizeErrorMessage(msg: string, literalToken?: string): string {
    let safe = (msg || "")
      .replace(/access_token=[^&\s'"]+/g, "access_token=***")
      .replace(/client_secret=[^&\s'"]+/g, "client_secret=***")
      .replace(/appsecret_proof=[^&\s'"]+/g, "appsecret_proof=***")
      .replace(/code=[^&\s'"]+/g, "code=***")
      .replace(/sig=[^&\s'"]+/g, "sig=***")
      .replace(/X-Amz-Signature=[^&\s'"]+/g, "X-Amz-Signature=***")
      .replace(/X-Amz-Credential=[^&\s'"]+/g, "X-Amz-Credential=***");
    if (literalToken) {
      // safely replace literal token
      safe = safe.split(literalToken).join("***");
    }
    return safe;
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number = 10000,
  ): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal as any,
      });
      clearTimeout(id);
      return response;
    } catch (err: any) {
      clearTimeout(id);
      throw new ProviderApiError(
        "Network error during Meta API request: " +
          this.sanitizeErrorMessage(err.message),
        0,
      );
    }
  }

  getAuthorizationUrl(input: AuthUrlInput): string {
    const scopes = [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "instagram_basic",
      "instagram_content_publish",
    ].join(",");

    const clientId = process.env.META_CLIENT_ID;
    if (!clientId) throw new Error("META_CLIENT_ID is not configured");

    const url = new URL(
      `https://www.facebook.com/${this.version}/dialog/oauth`,
    );
    url.searchParams.append("client_id", clientId);
    url.searchParams.append("redirect_uri", input.redirectUri);
    url.searchParams.append("state", input.state);
    url.searchParams.append("scope", scopes);
    url.searchParams.append("response_type", "code");

    return url.toString();
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OAuthCredentials> {
    const clientId = process.env.META_CLIENT_ID;
    const clientSecret = process.env.META_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      throw new Error("Meta credentials are not configured");

    const tokenUrl = new URL(
      `${this.baseUrl}/${this.version}/oauth/access_token`,
    );
    tokenUrl.searchParams.append("client_id", clientId);
    tokenUrl.searchParams.append("client_secret", clientSecret);
    tokenUrl.searchParams.append("redirect_uri", input.redirectUri);
    tokenUrl.searchParams.append("code", input.code);

    const tokenRes = await this.fetchWithTimeout(tokenUrl.toString(), {
      method: "GET",
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      throw new ProviderApiError(
        "Failed to exchange authorization code: " +
          (tokenData.error?.message || "Unknown error"),
        tokenRes.status,
      );
    }

    const shortLivedToken = tokenData.access_token;
    if (!shortLivedToken)
      throw new ProviderApiError("No access token returned", 500);

    const exchangeUrl = new URL(
      `${this.baseUrl}/${this.version}/oauth/access_token`,
    );
    exchangeUrl.searchParams.append("grant_type", "fb_exchange_token");
    exchangeUrl.searchParams.append("client_id", clientId);
    exchangeUrl.searchParams.append("client_secret", clientSecret);
    exchangeUrl.searchParams.append("fb_exchange_token", shortLivedToken);

    const exchangeRes = await this.fetchWithTimeout(exchangeUrl.toString(), {
      method: "GET",
    });
    const exchangeData = await exchangeRes.json();

    if (!exchangeRes.ok) {
      throw new ProviderApiError(
        "Failed to exchange for long-lived token: " +
          (exchangeData.error?.message || "Unknown error"),
        exchangeRes.status,
      );
    }

    const longLivedToken = exchangeData.access_token;
    if (!longLivedToken)
      throw new ProviderApiError("No long-lived access token returned", 500);

    return {
      accessToken: longLivedToken,
      expiresAt: exchangeData.expires_in
        ? new Date(Date.now() + exchangeData.expires_in * 1000)
        : undefined,
      scopes: [
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "instagram_basic",
        "instagram_content_publish",
      ],
    };
  }

  async getProfiles(
    credentials: OAuthCredentials,
  ): Promise<ProviderProfileResult[]> {
    if (!credentials.accessToken) {
      throw new Error("Access token required to fetch profiles");
    }

    const fields =
      "id,name,access_token,picture.type(large),instagram_business_account{id,name,username,profile_picture_url}";
    let nextUrl: string | undefined =
      `${this.baseUrl}/${this.version}/me/accounts?fields=${fields}&access_token=${credentials.accessToken}`;

    const profiles: ProviderProfileResult[] = [];
    const seenFacebookIds = new Set<string>();
    const seenInstagramIds = new Set<string>();
    const visitedUrls = new Set<string>();

    let pageCount = 0;
    const MAX_PAGES = 10;

    while (nextUrl) {
      if (pageCount >= MAX_PAGES) {
        throw new ProviderApiError("Maximum pagination limit reached", 400);
      }

      // Domain validation to prevent SSRF
      let urlObj: URL;
      try {
        urlObj = new URL(nextUrl);
      } catch (err) {
        throw new ProviderApiError("Invalid pagination URL format", 400);
      }

      if (urlObj.origin !== this.baseUrl) {
        throw new ProviderApiError("Invalid pagination URL", 400);
      }

      // Detect loops safely without token leakage
      const urlWithoutToken = new URL(nextUrl);
      urlWithoutToken.searchParams.delete("access_token");
      const safeUrlStr = urlWithoutToken.toString();

      if (visitedUrls.has(safeUrlStr)) {
        throw new ProviderApiError("Pagination loop detected", 400);
      }
      visitedUrls.add(safeUrlStr);
      pageCount++;

      const res = await this.fetchWithTimeout(nextUrl, {
        method: "GET",
        redirect: "error",
      });
      const data = await res.json();

      if (!res.ok) {
        let rawMsg = data.error?.message || "Unknown error";
        throw new ProviderApiError(
          "Failed to fetch user accounts: " +
            this.sanitizeErrorMessage(rawMsg, credentials.accessToken),
          res.status,
        );
      }

      if (!data || typeof data !== "object") {
        throw new ProviderApiError(
          "Malformed Meta response: not an object",
          500,
        );
      }
      if (!data.data || !Array.isArray(data.data)) {
        throw new ProviderApiError(
          "Malformed Meta response: data is missing or not an array",
          500,
        );
      }
      if (data.paging && typeof data.paging !== "object") {
        throw new ProviderApiError(
          "Malformed Meta response: paging is not an object",
          500,
        );
      }
      if (
        data.paging?.next !== undefined &&
        typeof data.paging.next !== "string"
      ) {
        throw new ProviderApiError(
          "Malformed Meta response: paging.next is not a string",
          500,
        );
      }

      for (const page of data.data) {
        if (page.id && page.name && page.access_token) {
          if (!seenFacebookIds.has(page.id)) {
            seenFacebookIds.add(page.id);
            profiles.push({
              profile: {
                id: page.id,
                name: page.name,
                avatarUrl: page.picture?.data?.url,
                provider: "FACEBOOK",
              },
              credentials: {
                accessToken: page.access_token,
                scopes: credentials.scopes,
              },
            });
          }

          if (
            page.instagram_business_account &&
            page.instagram_business_account.id
          ) {
            const ig = page.instagram_business_account;
            if (!seenInstagramIds.has(ig.id)) {
              seenInstagramIds.add(ig.id);
              profiles.push({
                profile: {
                  id: ig.id,
                  name: ig.name || ig.username || "Instagram Account",
                  username: ig.username,
                  avatarUrl: ig.profile_picture_url,
                  provider: "INSTAGRAM",
                },
                credentials: {
                  accessToken: page.access_token,
                  scopes: credentials.scopes,
                },
              });
            }
          }
        }
      }

      nextUrl = data.paging?.next;
    }

    return profiles;
  }

  async getCapabilities(
    context: CapabilityContext,
  ): Promise<ProviderCapabilities> {
    const capabilities: ProviderCapabilities = ["ACCOUNT_READ"];
    const scopes = context.grantedScopes || [];

    if (
      context.provider === "FACEBOOK" &&
      scopes.includes("pages_manage_posts")
    ) {
      capabilities.push("POST_PUBLISH");
    }

    if (
      context.provider === "INSTAGRAM" &&
      scopes.includes("instagram_content_publish")
    ) {
      capabilities.push("POST_PUBLISH");
    }

    return capabilities;
  }

  getPublishingCapabilities(): PublishingCapabilities {
    if (this.providerAlias === "facebook") {
      return {
        contentTypes: {
          TEXT_POST: { supported: true },
          IMAGE_POST: {
            supported: true,
            maxCount: 1,
            maxBytes: 8 * 1024 * 1024,
          },
          MULTI_IMAGE_POST: { supported: false },
          VIDEO_POST: { supported: false }, // Deferred due to chunking requirements
          LINK_POST: { supported: false },
          DOCUMENT_POST: { supported: false },
        },
        features: ["MESSAGE"],
      };
    }

    if (this.providerAlias === "instagram") {
      return {
        contentTypes: {
          TEXT_POST: { supported: false },
          IMAGE_POST: {
            supported: true,
            maxCount: 1,
            maxBytes: 8 * 1024 * 1024,
            mimeTypes: ["image/jpeg"],
          },
          MULTI_IMAGE_POST: { supported: false },
          VIDEO_POST: {
              supported: true,
              maxCount: 1,
              maxBytes: 100 * 1024 * 1024,
              mimeTypes: ["video/mp4", "video/quicktime"],
            },
          LINK_POST: { supported: false },
          DOCUMENT_POST: { supported: false },
        },
        features: ["MESSAGE"],
      };
    }

    // Default for META, unknown alias
    return {
      contentTypes: {
        TEXT_POST: { supported: false },
        IMAGE_POST: { supported: false },
        MULTI_IMAGE_POST: { supported: false },
        VIDEO_POST: {
              supported: true,
              maxCount: 1,
              maxBytes: 100 * 1024 * 1024,
              mimeTypes: ["video/mp4", "video/quicktime"],
            },
        LINK_POST: { supported: false },
        DOCUMENT_POST: { supported: false },
      },
      features: [],
    };
  }

  validateProviderOptions(options: unknown): ProviderOptionsValidationResult {
    return { valid: true, issues: [] };
  }

  async publish(
    credentials: ProviderExecutionCredentials,
    input: ProviderPublicationInput,
    mediaSource?: IMediaContentSource,
    context?: ProviderPublishContext,
  ): Promise<ProviderPublishResult> {
    if (
      this.providerAlias !== "facebook" &&
      this.providerAlias !== "instagram"
    ) {
      return {
        success: false,
        failureCategory: "VALIDATION",
        failureCode: "UNSUPPORTED_PROVIDER",
        message: `Publishing is not supported for alias ${this.providerAlias}`,
      };
    }

    if (!credentials.accessToken) {
      return {
        success: false,
        failureCategory: "AUTH_REQUIRED",
        failureCode: "NO_ACCESS_TOKEN",
        message: "No access token available",
      };
    }

    if (this.providerAlias === "instagram") {
      return this.publishInstagram(credentials, input, mediaSource, context);
    }

    // --- Facebook Page Publishing ---
    if (!context?.beforeFinalMutation) {
      throw new ProviderCoordinationError("Facebook publishing strictly requires beforeFinalMutation coordination hook.");
    }

    const pageId = input.externalAccountId;
    if (!pageId) {
      return {
        success: false,
        failureCategory: "VALIDATION",
        failureCode: "NO_PAGE_ID",
        message: "No Facebook Page ID provided",
      };
    }

    const hasMedia = input.media && input.media.length > 0;

    try {
      if (hasMedia) {
        if (input.media!.length > 1) {
          return {
            success: false,
            failureCategory: "VALIDATION",
            failureCode: "MULTI_IMAGE_UNSUPPORTED",
            message: "Multiple images are not supported in MVP",
          };
        }

        const asset = input.media![0];
        if (asset.mimeType.startsWith("video/")) {
          return {
            success: false,
            failureCategory: "VALIDATION",
            failureCode: "VIDEO_UNSUPPORTED",
            message: "Video publishing is deferred",
          };
        }

        if (!mediaSource) {
          return {
            success: false,
            failureCategory: "PERMANENT",
            failureCode: "NO_MEDIA_SOURCE",
            message: "Media source required for image upload",
          };
        }

        const stream = await mediaSource.getStream(asset.key!);
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const buffer = Buffer.concat(chunks);

        const formData = new FormData();
        if (input.content) {
          formData.append("message", input.content);
        }
        formData.append(
          "source",
          new Blob([buffer], { type: asset.mimeType }),
          "image.jpg",
        );

        await context.beforeFinalMutation();

        const postUrl = `${this.baseUrl}/${this.version}/${encodeURIComponent(pageId)}/photos?access_token=${credentials.accessToken}`;
        const res = await this.fetchWithTimeout(postUrl, {
          method: "POST",
          body: formData as any,
          redirect: "error",
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          return this.handleGraphError(
            res.status,
            data,
            credentials.accessToken,
          );
        }

        if (!data || (!data.id && !data.post_id)) {
          return {
            success: false,
            failureCategory: "VALIDATION",
            failureCode: "GRAPH_ERROR",
            message:
              "Malformed response from Facebook Graph API: missing post identifiers",
          };
        }

        return {
          success: true,
          externalPostId: data.post_id || data.id,
          safeMetadata: { photoId: data.id },
          processingState: "PUBLISHED",
        };
      } else {
        if (!input.content) {
          return {
            success: false,
            failureCategory: "VALIDATION",
            failureCode: "NO_CONTENT",
            message: "Content is required for text posts",
          };
        }

        const postUrl = `${this.baseUrl}/${this.version}/${encodeURIComponent(pageId)}/feed`;
        const params = new URLSearchParams();
        params.append("message", input.content);
        params.append("access_token", credentials.accessToken);

        await context.beforeFinalMutation();

        const res = await this.fetchWithTimeout(postUrl, {
          method: "POST",
          body: params.toString(),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          redirect: "error",
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          return this.handleGraphError(
            res.status,
            data,
            credentials.accessToken,
          );
        }

        if (!data || !data.id) {
          return {
            success: false,
            failureCategory: "VALIDATION",
            failureCode: "GRAPH_ERROR",
            message:
              "Malformed response from Facebook Graph API: missing post identifiers",
          };
        }

        return {
          success: true,
          externalPostId: data.id,
          processingState: "PUBLISHED",
        };
      }
    } catch (err: any) {
      if (err.name === "ProviderCoordinationError") {
        throw err;
      }
      return {
        success: false,
        failureCategory: "UNKNOWN_RESULT",
        failureCode: "NETWORK_ERROR",
        message: this.sanitizeErrorMessage(
          err.message,
          credentials.accessToken,
        ),
      };
    }
  }

    private async publishInstagram(
    credentials: ProviderExecutionCredentials,
    input: ProviderPublicationInput,
    mediaSource?: IMediaContentSource,
    context?: ProviderPublishContext,
  ): Promise<ProviderPublishResult> {
    if (!context?.onRemotePrepared || !context?.beforeFinalMutation) {
      throw new ProviderCoordinationError("Instagram publishing strictly requires both onRemotePrepared and beforeFinalMutation coordination hooks.");
    }
    
    const media = input.media?.[0];
    if (media && media.mimeType && media.mimeType.startsWith('video/')) {
      return this.publishInstagramVideo(credentials, input, mediaSource, context);
    }
    
    return this.publishInstagramImage(credentials, input, mediaSource, context);
  }

  private async publishInstagramVideo(
    credentials: ProviderExecutionCredentials,
    input: ProviderPublicationInput,
    mediaSource?: IMediaContentSource,
    context?: ProviderPublishContext,
  ): Promise<ProviderPublishResult> {
    const igId = encodeURIComponent(input.externalAccountId);
    if (!igId) {
      return { success: false, failureCategory: "VALIDATION", failureCode: "NO_IG_ID", message: "No Instagram ID provided" };
    }

    if (!input.media || input.media.length === 0 || !input.media[0]) {
      return { success: false, failureCategory: "VALIDATION", failureCode: "MEDIA_REQUIRED", message: "Instagram video requires exactly one video" };
    }
    if (input.media.length > 1) {
      return { success: false, failureCategory: "VALIDATION", failureCode: "TOO_MANY_MEDIA", message: "Instagram single-video only" };
    }
    if (!mediaSource || !mediaSource.getSignedReadUrl) {
      return { success: false, failureCategory: "TRANSIENT", failureCode: "NO_SIGNED_URL_SUPPORT", message: "Storage does not support getSignedReadUrl" };
    }

    const media = input.media[0];
    let videoUrl: string;
    try {
      videoUrl = await mediaSource.getSignedReadUrl(media.key!, this.INSTAGRAM_SIGNED_URL_TTL_SECONDS);
    } catch (e: any) {
      return { success: false, failureCategory: "TRANSIENT", failureCode: "SIGNED_URL_FAILED", message: `Failed to generate signed URL: ${e.message}` };
    }

    let creationId: string;
    try {
      const createParams = new URLSearchParams();
      createParams.append("access_token", credentials.accessToken);
      createParams.append("video_url", videoUrl);
      createParams.append("media_type", "REELS");
      if (input.content) {
        createParams.append("caption", input.content);
      }
      const createUrl = `${this.baseUrl}/${this.version}/${igId}/media?${createParams.toString()}`;

      const res = await this.fetchWithTimeout(createUrl, { method: "POST", redirect: "error" });
      const data = await res.json();
      if (!res.ok || !data.id) {
        return this.handleGraphError(res.status, data, credentials.accessToken);
      }
      creationId = data.id;

      if (context?.onRemotePrepared) {
        await context.onRemotePrepared({ containerId: creationId });
      }
    } catch (err: any) {
      if (err.name === "ProviderCoordinationError") throw err;
      return { success: false, failureCategory: "TRANSIENT", failureCode: "NETWORK_ERROR", message: this.sanitizeErrorMessage(err.message, credentials.accessToken) };
    }

    return {
      success: true,
      externalPostId: creationId,
      processingState: "PROCESSING",
    };
  }

  private async publishInstagramImage(
    credentials: ProviderExecutionCredentials,
    input: ProviderPublicationInput,
    mediaSource?: IMediaContentSource,
    context?: ProviderPublishContext,
  ): Promise<ProviderPublishResult> {
    if (!context?.onRemotePrepared || !context?.beforeFinalMutation) {
      throw new ProviderCoordinationError("Instagram single-image publishing strictly requires both onRemotePrepared and beforeFinalMutation coordination hooks.");
    }
    const igId = encodeURIComponent(input.externalAccountId);
    if (!igId) {
      return {
        success: false,
        failureCategory: "VALIDATION",
        failureCode: "NO_IG_ID",
        message: "No Instagram ID provided",
      };
    }
    const hasMedia = input.media && input.media.length > 0;
    if (!hasMedia || !input.media![0]) {
      return {
        success: false,
        failureCategory: "VALIDATION",
        failureCode: "MEDIA_REQUIRED",
        message: "Instagram requires exactly one image",
      };
    }
    if (input.media!.length > 1) {
      return {
        success: false,
        failureCategory: "VALIDATION",
        failureCode: "TOO_MANY_MEDIA",
        message: "Instagram single-image only",
      };
    }
    if (!mediaSource || !mediaSource.getSignedReadUrl) {
      return {
        success: false,
        failureCategory: "TRANSIENT",
        failureCode: "NO_SIGNED_URL_SUPPORT",
        message: "Storage does not support getSignedReadUrl",
      };
    }

    const media = input.media![0];

    // Image Geometry Validation
    let dims: ReturnType<typeof sizeOf> | null = null;
    try {
      const stream = await mediaSource.getStream(media.key!);
      const chunks: Buffer[] = [];
      try {
        for await (const chunk of stream) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          const buffer = Buffer.concat(chunks);
          try {
            dims = sizeOf(buffer);
            if (dims && dims.width && dims.height) {
              break; // Found dimensions, exit stream early
            }
          } catch (e) {
            // sizeOf throws until enough bytes are buffered
          }
        }
      } finally {
        if (typeof stream.destroy === "function") {
          stream.destroy();
        }
      }
      if (!dims || !dims.width || !dims.height) {
        return {
          success: false,
          failureCategory: "VALIDATION",
          failureCode: "IMAGE_FORMAT_UNRECOGNIZED",
          message: "Failed to determine image dimensions",
        };
      }

      let width = dims.width;
      let height = dims.height;

      // EXIF orientation (5-8 means 90/270 degree rotation)
      if (dims.orientation && dims.orientation >= 5 && dims.orientation <= 8) {
        width = dims.height;
        height = dims.width;
      }

      // Ensure we don't have floating point inaccuracies
      // ratio = width / height
      // 0.8 <= ratio <= 1.91 => 80 * height <= 100 * width && 100 * width <= 191 * height
      if (width * 100 < height * 80 || width * 100 > height * 191) {
        const ratio = width / height;
        return {
          success: false,
          failureCategory: "VALIDATION",
          failureCode: "IMAGE_ASPECT_RATIO_UNSUPPORTED",
          message: `Instagram requires aspect ratio between 4:5 (0.8) and 1.91:1. Got ${ratio.toFixed(2)} (${width}x${height}).`,
        };
      }
    } catch (e: any) {
      return {
        success: false,
        failureCategory: "VALIDATION",
        failureCode: "IMAGE_FORMAT_UNRECOGNIZED",
        message: "Failed to read image metadata",
      };
    }

    let imageUrl: string;
    try {
      imageUrl = await mediaSource.getSignedReadUrl(
        media.key!,
        this.INSTAGRAM_SIGNED_URL_TTL_SECONDS,
      );
    } catch (e: any) {
      return {
        success: false,
        failureCategory: "TRANSIENT",
        failureCode: "SIGNED_URL_FAILED",
        message: `Failed to generate signed URL: ${e.message}`,
      };
    }

    // Step 1: Create Container
    let creationId: string;
    try {
      const createParams = new URLSearchParams();
      createParams.append("access_token", credentials.accessToken);
      createParams.append("image_url", imageUrl);
      if (input.content) {
        createParams.append("caption", input.content);
      }
      const createUrl = `${this.baseUrl}/${this.version}/${igId}/media?${createParams.toString()}`;

      const res = await this.fetchWithTimeout(createUrl, {
        method: "POST",
        redirect: "error",
      });
      const data = await res.json();
      if (!res.ok || !data.id) {
        return this.handleGraphError(res.status, data, credentials.accessToken);
      }
      creationId = data.id;

      if (context?.onRemotePrepared) {
        await context.onRemotePrepared({ containerId: creationId });
      }
    } catch (err: any) {
      if (err.name === "ProviderCoordinationError") {
        throw err;
      }
      if (err.message === "redirect") {
        return {
          success: false,
          failureCategory: "VALIDATION",
          failureCode: "UNEXPECTED_REDIRECT",
          message: "Meta returned unexpected redirect",
        };
      }
      return {
        success: false,
        failureCategory: "TRANSIENT",
        failureCode: "NETWORK_ERROR",
        message: this.sanitizeErrorMessage(
          err.message,
          credentials.accessToken,
        ),
      };
    }

    // Step 2: Publish Container
    try {
      const publishParams = new URLSearchParams();
      publishParams.append("access_token", credentials.accessToken);
      publishParams.append("creation_id", creationId);
      const publishUrl = `${this.baseUrl}/${this.version}/${igId}/media_publish?${publishParams.toString()}`;

      // PRE-MUTATION CHECKPOINT: durably transition to PUBLISH_REQUESTED locally before final POST
      if (context?.beforeFinalMutation) {
        await context.beforeFinalMutation();
      }

      const res = await this.fetchWithTimeout(publishUrl, {
        method: "POST",
        redirect: "error",
      });
      const data = await res.json();
      if (!res.ok || !data.id) {
        return this.handleGraphError(res.status, data, credentials.accessToken);
      }

      return {
        success: true,
        externalPostId: data.id,
        processingState: "PUBLISHED",
      };
    } catch (err: any) {
      if (err.name === "ProviderCoordinationError") {
        throw err;
      }
      if (err.message === "redirect") {
        return {
          success: false,
          failureCategory: "VALIDATION",
          failureCode: "UNEXPECTED_REDIRECT",
          message: "Meta returned unexpected redirect",
        };
      }
      return {
        success: false,
        failureCategory: "TRANSIENT",
        failureCode: "NETWORK_ERROR",
        message: this.sanitizeErrorMessage(
          err.message,
          credentials.accessToken,
        ),
      };
    }
  }

    async checkStatus(credentials: ProviderExecutionCredentials, remoteResourceId: string): Promise<ProviderStatusCheckResult> {
    if (this.providerAlias !== 'instagram') {
      return { status: 'UNKNOWN', failureCategory: 'UNKNOWN_RESULT', message: 'Status checks not supported for this provider' };
    }
    try {
      const params = new URLSearchParams();
      params.append('access_token', credentials.accessToken);
      params.append('fields', 'status_code');
      const url = `${this.baseUrl}/${this.version}/${remoteResourceId}?${params.toString()}`;

      const res = await this.fetchWithTimeout(url, { method: 'GET', redirect: 'error' });
      const data = await res.json();
      if (!res.ok) {
        const errCode = data?.error?.code;
        if (errCode === 100) {
           return { status: 'FAILED', failureCategory: 'PERMANENT', failureCode: 'NOT_FOUND', message: 'Container not found' };
        }
        return { status: 'UNKNOWN', failureCategory: 'UNKNOWN_RESULT', failureCode: 'GRAPH_ERROR', message: data?.error?.message || 'Error checking status' };
      }

      const statusCode = data.status_code;
      if (statusCode === 'IN_PROGRESS') return { status: 'PROCESSING' };
      if (statusCode === 'FINISHED') return { status: 'READY' };
      if (statusCode === 'ERROR') return { status: 'FAILED', failureCategory: 'PERMANENT', failureCode: 'PROCESSING_FAILED' };
      if (statusCode === 'EXPIRED') return { status: 'FAILED', failureCategory: 'PERMANENT', failureCode: 'EXPIRED' };
      if (statusCode === 'PUBLISHED') return { status: 'PUBLISHED' };

      return { status: 'UNKNOWN', failureCategory: 'UNKNOWN_RESULT', failureCode: 'UNRECOGNIZED_STATUS', message: 'Unrecognized status: ' + statusCode };
    } catch (err: any) {
      return { status: 'UNKNOWN', failureCategory: 'UNKNOWN_RESULT', failureCode: 'NETWORK_ERROR', message: this.sanitizeErrorMessage(err.message, credentials.accessToken) };
    }
  }

  async finalizePublish(credentials: ProviderExecutionCredentials, input: ProviderPublicationInput, remoteResourceId: string, context?: ProviderPublishContext): Promise<ProviderPublishResult> {
    if (!context?.beforeFinalMutation) {
      throw new ProviderCoordinationError("Instagram finalization strictly requires beforeFinalMutation coordination hook.");
    }
    
    try {
      const igId = encodeURIComponent(input.externalAccountId);
      if (!igId) {
        return { success: false, failureCategory: "VALIDATION", failureCode: "NO_IG_ID", message: "No Instagram ID provided" };
      }

      const publishParams = new URLSearchParams();
      publishParams.append("access_token", credentials.accessToken);
      publishParams.append("creation_id", remoteResourceId);
      const publishUrl = `${this.baseUrl}/${this.version}/${igId}/media_publish?${publishParams.toString()}`;

      if (context?.beforeFinalMutation) {
        await context.beforeFinalMutation();
      }

      const res = await this.fetchWithTimeout(publishUrl, { method: "POST", redirect: "error" });
      const data = await res.json();
      if (!res.ok || !data.id) {
        return this.handleGraphError(res.status, data, credentials.accessToken);
      }

      return {
        success: true,
        externalPostId: data.id,
        processingState: "PUBLISHED",
      };
    } catch (err: any) {
      if (err.name === "ProviderCoordinationError") throw err;
      if (err.message === "redirect") {
        return { success: false, failureCategory: "VALIDATION", failureCode: "UNEXPECTED_REDIRECT", message: "Meta returned unexpected redirect" };
      }
      return { success: false, failureCategory: "TRANSIENT", failureCode: "NETWORK_ERROR", message: this.sanitizeErrorMessage(err.message, credentials.accessToken) };
    }
  }

  private handleGraphError(

    status: number,
    data: any,
    token: string,
  ): ProviderPublishFailure {
    const errorMsg = data?.error?.message || "Unknown Graph API Error";
    const safeErrorMsg = this.sanitizeErrorMessage(errorMsg, token);
    const errorCode = data?.error?.code;

    if (errorCode === 190) {
      return {
        success: false,
        failureCategory: "AUTH_REQUIRED",
        failureCode: "OAUTH_EXCEPTION",
        message: "Invalid or expired token: " + safeErrorMsg,
      };
    }

    if (errorCode === 200) {
      return {
        success: false,
        failureCategory: "AUTH_REQUIRED",
        failureCode: "MISSING_PERMISSION",
        message: "Missing permission to publish: " + safeErrorMsg,
      };
    }

    if (
      errorCode === 4 ||
      errorCode === 17 ||
      errorCode === 32 ||
      errorCode === 613
    ) {
      return {
        success: false,
        failureCategory: "RATE_LIMITED",
        failureCode: "RATE_LIMIT_EXCEEDED",
        message: "Rate limit exceeded: " + safeErrorMsg,
        retryAfterSeconds: data?.error?.error_data?.retry_after,
      };
    }

    if (status >= 500) {
      return {
        success: false,
        failureCategory: "TRANSIENT",
        failureCode: "GRAPH_SERVER_ERROR",
        message: "Facebook server error: " + safeErrorMsg,
      };
    }

    return {
      success: false,
      failureCategory: "VALIDATION",
      failureCode: "GRAPH_ERROR",
      message: safeErrorMsg,
    };
  }
}
