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
        VIDEO_POST: { supported: false },
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
      if (!media.mimeType.startsWith('image/')) {
        return {
          success: false,
          failureCategory: 'VALIDATION',
          failureCode: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'LinkedIn single image post requires a valid image type',
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

      // 1. Initialize upload
      let initResponse: Response;
      try {
        initResponse = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
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
        });
      } catch (err) {
        return {
          success: false,
          failureCategory: 'UNKNOWN_RESULT',
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
      let stream;
      try {
        stream = await mediaSource.getStream(media.key);
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
        uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': media.mimeType,
          },
          body: stream,
          duplex: 'half'
        } as unknown as RequestInit);
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
          pollRes = await fetch(`https://api.linkedin.com/rest/images/${encodedUrn}`, {
            headers: {
              'Authorization': `Bearer ${credentials.accessToken}`,
              'Linkedin-Version': '202608',
              'X-Restli-Protocol-Version': '2.0.0',
            }
          });
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

    if (imageUrn) {
      payload.content = {
        media: {
          id: imageUrn
          // Note on altText: The existing schema (ProviderPublicationInput media array) 
          // does not support altText. We intentionally omit it for MVP rather than 
          // introducing a broad schema redesign.
        }
      };
    }

    let response: Response;
    try {
      response = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Linkedin-Version': '202608',
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
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
