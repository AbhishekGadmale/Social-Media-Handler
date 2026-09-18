import {
  AuthUrlInput,
  OAuthCredentials,
  CapabilityContext,
  ProviderCapabilities,
  ProviderProfileResult,
} from "../core/types/index";
import { ISocialProvider } from "../core/interfaces/ISocialProvider";
import { ProviderApiError } from "../core/errors/index";
import {
  IPublishingProvider,
  PublishingCapabilities,
  ProviderOptionsValidationResult,
  ProviderExecutionCredentials,
  ProviderPublicationInput,
  ProviderPublishResult,
  ProviderPublishFailure,
} from "../core/interfaces/IPublishingProvider";
import { IMediaContentSource } from "../core/interfaces/IMediaContentSource";

export class MetaProvider implements ISocialProvider, IPublishingProvider {
  private readonly version = "v20.0";
  private readonly baseUrl = "https://graph.facebook.com";

  constructor(private readonly providerAlias: string = "meta") {}

  private sanitizeErrorMessage(msg: string, literalToken?: string): string {
    let safe = (msg || "")
      .replace(/access_token=[^&\s'"]+/g, "access_token=***")
      .replace(/client_secret=[^&\s'"]+/g, "client_secret=***")
      .replace(/appsecret_proof=[^&\s'"]+/g, "appsecret_proof=***")
      .replace(/code=[^&\s'"]+/g, "code=***");
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

    // Default for INSTAGRAM, META, unknown alias
    return {
      contentTypes: {
        TEXT_POST: { supported: false },
        IMAGE_POST: { supported: false },
        MULTI_IMAGE_POST: { supported: false },
        VIDEO_POST: { supported: false },
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
  ): Promise<ProviderPublishResult> {
    if (this.providerAlias !== "facebook") {
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
        message: "No access token available for Facebook Page",
      };
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
