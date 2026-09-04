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
        IMAGE_POST: { supported: false },
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

    if (input.media && input.media.length > 0) {
      return {
        success: false,
        failureCategory: 'VALIDATION',
        failureCode: 'MEDIA_NOT_SUPPORTED',
        message: 'LinkedIn provider currently only supports text posts',
      };
    }

    const payload = {
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
