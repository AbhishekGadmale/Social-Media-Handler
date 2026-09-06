import {
  AuthUrlInput,
  OAuthCredentials,
  SocialProfile,
  CapabilityContext,
  ProviderCapabilities,
} from '../core/types/index';
import { ISocialProvider } from '../core/interfaces/ISocialProvider';
import { 
  IPublishingProvider, 
  PublishingCapabilities, 
  ProviderOptionsValidationResult, 
  ProviderExecutionCredentials, 
  ProviderPublicationInput, 
  ProviderPublishResult 
} from '../core/interfaces/IPublishingProvider';
import { IMediaContentSource } from '../core/interfaces/IMediaContentSource';
import { resolveCapabilities } from '../core/capability-resolver';
import { ProviderApiError } from '../core/errors/index';

export class LinkedInProvider implements ISocialProvider, IPublishingProvider {
  private clientId: string;
  private clientSecret: string;
  private authorizeUrl = 'https://www.linkedin.com/oauth/v2/authorization';
  private tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
  private userInfoUrl = 'https://api.linkedin.com/v2/userinfo';

  constructor() {
    this.clientId = process.env.LINKEDIN_CLIENT_ID || 'dummy_client_id';
    this.clientSecret = process.env.LINKEDIN_CLIENT_SECRET || 'dummy_client_secret';
  }

  private readonly ALLOWED_SCOPES = new Set([
    'openid',
    'profile',
    'email',
    'w_member_social',
    'w_organization_social'
  ]);

  private readonly BASE_SCOPES = ['openid', 'profile', 'email'];

  getAuthorizationUrl(input: AuthUrlInput & { codeChallenge?: string }): string {
    const scopesToRequest = new Set(this.BASE_SCOPES);
    
    if (input.requestedScopes) {
      for (const scope of input.requestedScopes) {
        if (!this.ALLOWED_SCOPES.has(scope)) {
          throw new Error(`Invalid or unauthorized scope requested: ${scope}`);
        }
        scopesToRequest.add(scope);
      }
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
      scope: Array.from(scopesToRequest).join(' '),
    });

    return `${this.authorizeUrl}?${params.toString()}`;
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal as any });
      clearTimeout(id);
      return response;
    } catch (err: any) {
      clearTimeout(id);
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }

  async exchangeAuthorizationCode(input: { code: string; redirectUri: string; codeVerifier?: string }): Promise<OAuthCredentials> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: input.redirectUri,
    });

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Safe parsing to avoid leaking secrets
      let safeMessage = 'Unknown error';
      try {
        const parsed = JSON.parse(errorText);
        safeMessage = parsed.error_description || parsed.error || parsed.message || errorText;
      } catch (e) {
        safeMessage = errorText;
      }
      // sanitize safeMessage to remove secrets just in case
      safeMessage = safeMessage.replace(this.clientSecret, '***').replace(input.code, '***');
      throw new ProviderApiError(`Failed to exchange authorization code: ${safeMessage}`, response.status);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      scopes: data.scope ? data.scope.split(' ') : ['openid', 'profile', 'email'],
    };
  }

  async getProfiles(credentials: OAuthCredentials): Promise<SocialProfile[]> {
    const response = await fetch(this.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let safeMessage = 'Unknown error';
      try {
        const parsed = JSON.parse(errorText);
        safeMessage = parsed.message || errorText;
      } catch (e) {
        safeMessage = errorText;
      }
      safeMessage = safeMessage.replace(credentials.accessToken, '***');
      throw new ProviderApiError(`Failed to fetch user profile: ${safeMessage}`, response.status);
    }

    const data = await response.json();

    return [
      {
        id: data.sub,
        name: data.name,
        username: data.email, // LinkedIn OpenID userinfo returns email
        avatarUrl: data.picture,
      },
    ];
  }

  async getCapabilities(context: CapabilityContext): Promise<ProviderCapabilities> {
    const baseCapabilities = resolveCapabilities({
      ...context,
      grantedScopes: context.grantedScopes || ['openid', 'profile', 'email'],
    });

    const hasMemberPublishScope = context.grantedScopes?.includes('w_member_social');
    
    // In Phase 8.3, we enable organic text publishing if scopes and identity exist
    if (hasMemberPublishScope && context.externalId) {
      baseCapabilities.push('POST_PUBLISH');
    }

    return baseCapabilities;
  }

  getPublishingCapabilities(): PublishingCapabilities {
    return {
      contentTypes: {
        TEXT_POST: { supported: true, maxLength: 3000 },
        IMAGE_POST: { supported: true, maxCount: 1 },
        MULTI_IMAGE_POST: { supported: false },
        VIDEO_POST: { supported: true, maxCount: 1, maxBytes: 500 * 1024 * 1024, mimeTypes: ['video/mp4'] },
        LINK_POST: { supported: false },
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
    mediaSource?: IMediaContentSource
  ): Promise<ProviderPublishResult> {
    if (!input.externalAccountId) {
      return {
        success: false,
        failureCategory: 'VALIDATION',
        failureCode: 'MISSING_AUTHOR',
        message: 'No external account ID provided for LinkedIn member',
      };
    }

    if (!input.content || input.content.trim().length === 0) {
      return {
        success: false,
        failureCategory: 'VALIDATION',
        failureCode: 'MISSING_CONTENT',
        message: 'LinkedIn text post requires content',
      };
    }

    let imageUrn: string | undefined;
    let videoUrn: string | undefined;

    if (input.media && input.media.length > 0) {
      if (input.media.length > 1) {
        return {
          success: false,
          failureCategory: 'VALIDATION',
          failureCode: 'MEDIA_COUNT_EXCEEDED',
          message: 'LinkedIn provider currently only supports exactly one image',
        };
      }
      
      const media = input.media[0];
      const isImage = media.mimeType.startsWith('image/');
      const isVideo = media.mimeType.startsWith('video/');
      if (!isImage && !isVideo) {
        return {
          success: false,
          failureCategory: 'VALIDATION',
          failureCode: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'LinkedIn post requires a valid image or video type',
        };
      }
      
      if (!media.key || !mediaSource) {
        return {
          success: false,
          failureCategory: 'PERMANENT',
          failureCode: 'MISSING_MEDIA_SOURCE',
          message: 'Media content source or storage key is missing',
        };
      }

      if (isVideo) {
        // VIDEO FLOW
        let initResponse: Response;
        try {
          initResponse = await this.fetchWithTimeout('https://api.linkedin.com/rest/videos?action=initializeUpload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${credentials.accessToken}`,
              'Linkedin-Version': '202608',
              'X-Restli-Protocol-Version': '2.0.0',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              initializeUploadRequest: {
                owner: `urn:li:person:${input.externalAccountId}`,
                fileSizeBytes: media.sizeBytes,
                uploadCaptions: false,
                uploadThumbnail: false
              }
            })
          }, 15000);
        } catch (err) {
          return {
            success: false,
            failureCategory: 'TRANSIENT',
            failureCode: 'NETWORK_ERROR',
            message: `Network error during video initializeUpload: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        if (!initResponse.ok) {
          if (initResponse.status === 401) return { success: false, failureCategory: 'AUTH_REQUIRED', failureCode: 'UNAUTHORIZED', message: 'Unauthorized at initializeUpload' };
          if (initResponse.status === 403) return { success: false, failureCategory: 'AUTH_REQUIRED', failureCode: 'FORBIDDEN', message: 'Forbidden at initializeUpload' };
          if (initResponse.status === 429) return { success: false, failureCategory: 'RATE_LIMITED', failureCode: 'TOO_MANY_REQUESTS', message: 'Rate limit at initializeUpload' };
          if (initResponse.status >= 500) return { success: false, failureCategory: 'TRANSIENT', failureCode: 'SERVER_ERROR', message: 'Server error at initializeUpload' };
          return { success: false, failureCategory: 'PERMANENT', failureCode: `HTTP_${initResponse.status}`, message: 'Failed to initialize video upload' };
        }

        const initData = await initResponse.json();
        videoUrn = initData.value?.video;
        const uploadInstructions = initData.value?.uploadInstructions;
        const uploadToken = initData.value?.uploadToken;

        if (!videoUrn || !uploadInstructions || typeof uploadToken !== 'string') {
          return {
            success: false,
            failureCategory: 'PERMANENT',
            failureCode: 'INVALID_INITIALIZE_RESPONSE',
            message: 'Missing video URN, uploadInstructions, or uploadToken in response',
          };
        }

        const uploadedPartIds: string[] = [];

        for (const instruction of uploadInstructions) {
          const { firstByte, lastByte, uploadUrl } = instruction;
          let buffer: Buffer;
          try {
            console.log(`[LINKEDIN] Requesting stream from Minio for ${media.key} (${firstByte}-${lastByte})`);
            const stream = await mediaSource.getStream(media.key, { start: firstByte, end: lastByte });
            console.log(`[LINKEDIN] Stream obtained. Buffering...`);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            buffer = Buffer.concat(chunks);
            console.log(`[LINKEDIN] Buffered ${buffer.length} bytes for upload.`);
          } catch (err) {
            console.error(`[LINKEDIN] Stream error:`, err);
            return {
              success: false,
              failureCategory: 'TRANSIENT',
              failureCode: 'STORAGE_UNAVAILABLE',
              message: 'Failed to read video part from media content source',
            };
          }

          let uploadRes: Response;
          try {
            console.log(`[LINKEDIN] PUT to ${uploadUrl.substring(0, 50)}...`);
            uploadRes = await this.fetchWithTimeout(uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': media.mimeType },
              body: buffer,
            } as any, 60000);
            console.log(`[LINKEDIN] PUT response: ${uploadRes.status}`);
          } catch (err) {
            console.error(`[LINKEDIN] Fetch error:`, err);
            return { success: false, failureCategory: 'TRANSIENT', failureCode: 'NETWORK_ERROR', message: 'Network error during video part upload' };
          }

          if (!uploadRes.ok) {
            return { success: false, failureCategory: 'TRANSIENT', failureCode: `HTTP_${uploadRes.status}`, message: 'Failed to upload video part bytes' };
          }

          let etag = uploadRes.headers.get('etag');
          if (!etag) {
            return { success: false, failureCategory: 'PERMANENT', failureCode: 'MISSING_ETAG', message: 'Provider returned no ETag for video part' };
          }
          etag = etag.replace(/(^"|"$)/g, '');
          uploadedPartIds.push(etag);
        }

        let finalizeRes: Response;
        try {
          finalizeRes = await this.fetchWithTimeout('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${credentials.accessToken}`,
              'Linkedin-Version': '202608',
              'X-Restli-Protocol-Version': '2.0.0',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              finalizeUploadRequest: {
                video: videoUrn,
                uploadToken: uploadToken,
                uploadedPartIds
              }
            })
          }, 15000);
        } catch (err) {
          return { success: false, failureCategory: 'TRANSIENT', failureCode: 'NETWORK_ERROR', message: 'Network error during finalizeUpload' };
        }

        if (!finalizeRes.ok) {
          return { success: false, failureCategory: 'PERMANENT', failureCode: `HTTP_${finalizeRes.status}`, message: 'Failed to finalize video upload' };
        }

        let isAvailable = false;
        let attempts = 0;
        const maxAttempts = 60; // 60 * 10s = 10 mins
        const encodedUrn = encodeURIComponent(videoUrn);

        while (attempts < maxAttempts && !isAvailable) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 10000));

          let pollRes: Response;
          try {
            pollRes = await this.fetchWithTimeout(`https://api.linkedin.com/rest/videos/${encodedUrn}`, {
              headers: {
                'Authorization': `Bearer ${credentials.accessToken}`,
                'Linkedin-Version': '202608',
                'X-Restli-Protocol-Version': '2.0.0',
              }
            }, 10000);
          } catch (err) {
            continue;
          }

          if (pollRes.ok) {
            const pollData = await pollRes.json();
            if (pollData.status === 'AVAILABLE') {
              isAvailable = true;
            } else if (pollData.status && pollData.status !== 'WAITING_UPLOAD' && pollData.status !== 'PROCESSING') {
               if (pollData.status === 'PROCESSING_FAILED' || pollData.status === 'FAILED') {
                 return {
                   success: false,
                   failureCategory: 'PERMANENT',
                   failureCode: 'VIDEO_PROCESSING_FAILED',
                   message: `LinkedIn video processing failed permanently (${pollData.status})`,
                 };
               }
            }
          } else if (pollRes.status === 401 || pollRes.status === 403 || pollRes.status === 404) {
             return { success: false, failureCategory: 'PERMANENT', failureCode: 'VIDEO_NOT_FOUND', message: 'Video check returned fatal error' };
          }
        }

        if (!isAvailable) {
          return { success: false, failureCategory: 'TRANSIENT', failureCode: 'VIDEO_PROCESSING_TIMEOUT', message: 'Timeout waiting for LinkedIn video to become AVAILABLE' };
        }

      } else {
        // IMAGE FLOW
        // 1. Initialize upload
        let initResponse: Response;
      try {
        initResponse = await this.fetchWithTimeout('https://api.linkedin.com/rest/images?action=initializeUpload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Linkedin-Version': '202608',
            'X-Restli-Protocol-Version': '2.0.0',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            initializeUploadRequest: {
              owner: `urn:li:person:${input.externalAccountId}`
            }
          })
        }, 15000);
      } catch (err) {
        return {
          success: false,
          failureCategory: 'TRANSIENT',
          failureCode: 'NETWORK_ERROR',
          message: `Network error during initializeUpload: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (!initResponse.ok) {
        if (initResponse.status === 401) return { success: false, failureCategory: 'AUTH_REQUIRED', failureCode: 'UNAUTHORIZED', message: 'Unauthorized at initializeUpload' };
        if (initResponse.status === 403) return { success: false, failureCategory: 'AUTH_REQUIRED', failureCode: 'FORBIDDEN', message: 'Forbidden at initializeUpload' };
        if (initResponse.status === 429) return { success: false, failureCategory: 'RATE_LIMITED', failureCode: 'TOO_MANY_REQUESTS', message: 'Rate limit at initializeUpload' };
        if (initResponse.status >= 500) return { success: false, failureCategory: 'TRANSIENT', failureCode: 'SERVER_ERROR', message: 'Server error at initializeUpload' };
        return { success: false, failureCategory: 'PERMANENT', failureCode: `HTTP_${initResponse.status}`, message: 'Failed to initialize upload' };
      }

      const initData = await initResponse.json();
      const uploadUrl = initData.value?.uploadUrl;
      imageUrn = initData.value?.image;

      if (!uploadUrl || !imageUrn) {
        return {
          success: false,
          failureCategory: 'PERMANENT',
          failureCode: 'INVALID_INITIALIZE_RESPONSE',
          message: 'Missing uploadUrl or image URN in initializeUpload response',
        };
      }

      // 2. Upload image bytes
      let buffer: Buffer;
      try {
        const stream = await mediaSource.getStream(media.key);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        buffer = Buffer.concat(chunks);
      } catch (err) {
        return {
          success: false,
          failureCategory: 'TRANSIENT',
          failureCode: 'STORAGE_UNAVAILABLE',
          message: 'Failed to read from media content source',
        };
      }

      let uploadRes: Response;
      try {
        uploadRes = await this.fetchWithTimeout(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': media.mimeType,
          },
          body: buffer,
        } as unknown as RequestInit, 30000);
      } catch (err) {
        return {
          success: false,
          failureCategory: 'TRANSIENT', // Safe to retry, post mutation hasn't happened
          failureCode: 'NETWORK_ERROR',
          message: 'Network error during image upload',
        };
      }

      if (!uploadRes.ok) {
        if (uploadRes.status >= 500) return { success: false, failureCategory: 'TRANSIENT', failureCode: 'SERVER_ERROR', message: 'Server error during image upload' };
        return { success: false, failureCategory: 'TRANSIENT', failureCode: `HTTP_${uploadRes.status}`, message: 'Failed to upload image bytes' }; // uploadUrl might be expired, transient is safe
      }

      // 3. Poll readiness
      let isAvailable = false;
      let attempts = 0;
      const maxAttempts = 10;
      const encodedUrn = encodeURIComponent(imageUrn);

      while (attempts < maxAttempts && !isAvailable) {
        attempts++;
        // Backoff: 2s
        await new Promise(resolve => setTimeout(resolve, 2000));

        let pollRes: Response;
        try {
          pollRes = await this.fetchWithTimeout(`https://api.linkedin.com/rest/images/${encodedUrn}`, {
            headers: {
              'Authorization': `Bearer ${credentials.accessToken}`,
              'Linkedin-Version': '202608',
              'X-Restli-Protocol-Version': '2.0.0',
            }
          }, 10000);
        } catch (err) {
          continue; // retry network error on polling
        }

        if (pollRes.ok) {
          const pollData = await pollRes.json();
          if (pollData.status === 'AVAILABLE') {
            isAvailable = true;
          } else if (pollData.status && pollData.status !== 'WAITING_UPLOAD' && pollData.status !== 'PROCESSING') {
             // Permanent failure state in image processing? (e.g. FAILED)
             if (pollData.status === 'FAILED') {
               return {
                 success: false,
                 failureCategory: 'PERMANENT',
                 failureCode: 'IMAGE_PROCESSING_FAILED',
                 message: 'LinkedIn image processing failed permanently',
               };
             }
          }
        } else if (pollRes.status === 401 || pollRes.status === 403 || pollRes.status === 404) {
           // Permanent errors during poll
           return {
             success: false,
             failureCategory: 'PERMANENT',
             failureCode: 'IMAGE_NOT_FOUND',
             message: 'Image check returned fatal error',
           };
        }
      }

      if (!isAvailable) {
        return {
          success: false,
          failureCategory: 'TRANSIENT',
          failureCode: 'IMAGE_PROCESSING_TIMEOUT',
          message: 'Timeout waiting for LinkedIn image to become AVAILABLE',
        };
      }
      } // end isImage block
    }

    const payload: any = {
      author: `urn:li:person:${input.externalAccountId}`,
      commentary: input.content,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false
    };

    if (imageUrn || videoUrn) {
      payload.content = {
        media: {
          id: imageUrn || videoUrn
        }
      };
    }

    let response: Response;
    try {
      response = await this.fetchWithTimeout('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Linkedin-Version': '202608',
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }, 30000);
    } catch (err) {
      // Network/fetch error could mean it reached the server but connection dropped
      return {
        success: false,
        failureCategory: 'UNKNOWN_RESULT',
        failureCode: 'NETWORK_ERROR',
        message: `Network error during publish: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const requestId = response.headers.get('x-li-uuid') || undefined;

    if (response.status === 201) {
      const restliId = response.headers.get('x-restli-id');
      if (!restliId) {
        return {
          success: false,
          failureCategory: 'UNKNOWN_RESULT',
          failureCode: 'MISSING_RESTLI_ID',
          message: 'Received 201 Created but x-restli-id header was missing',
          providerRequestId: requestId,
        };
      }

      return {
        success: true,
        externalPostId: restliId,
        canonicalUrl: undefined, // Don't manufacture a URL
        providerRequestId: requestId,
        publishedAt: new Date(),
      };
    }

    // Handle error taxonomy
    const status = response.status;
    
    // We don't log the raw body to avoid leaking PII or credentials if any are reflected
    if (status === 401) {
      return {
        success: false,
        failureCategory: 'AUTH_REQUIRED',
        failureCode: 'UNAUTHORIZED',
        message: 'LinkedIn API returned 401 Unauthorized',
        providerRequestId: requestId,
      };
    }

    if (status === 403) {
      return {
        success: false,
        failureCategory: 'AUTH_REQUIRED', // Or should it be VALIDATION? Prompt: "403 caused by missing/insufficient publishing authorization -> appropriate scope/access failure -> do NOT blindly retry" -> AUTH_REQUIRED is standard for this.
        failureCode: 'FORBIDDEN',
        message: 'LinkedIn API returned 403 Forbidden. Verify w_member_social scope.',
        providerRequestId: requestId,
      };
    }

    if (status === 429) {
      return {
        success: false,
        failureCategory: 'RATE_LIMITED',
        failureCode: 'TOO_MANY_REQUESTS',
        message: 'LinkedIn API rate limit exceeded',
        providerRequestId: requestId,
      };
    }

    if (status >= 500) {
      return {
        success: false,
        failureCategory: 'UNKNOWN_RESULT',
        failureCode: 'SERVER_ERROR',
        message: `LinkedIn API returned ${status} Server Error`,
        providerRequestId: requestId,
      };
    }

    return {
      success: false,
      failureCategory: 'PERMANENT',
      failureCode: `HTTP_${status}`,
      message: `LinkedIn API returned unexpected status ${status}`,
      providerRequestId: requestId,
    };
  }
}
