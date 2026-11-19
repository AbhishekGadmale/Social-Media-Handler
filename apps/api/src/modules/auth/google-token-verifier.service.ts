import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

export interface GoogleVerifiedUser {
  email: string;
  name: string | null;
}

@Injectable()
export class GoogleTokenVerifierService {
  private readonly logger = new Logger(GoogleTokenVerifierService.name);

  async verify(credential: string): Promise<GoogleVerifiedUser> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId || clientId.trim() === '') {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured.',
      );
    }

    if (
      !credential ||
      typeof credential !== 'string' ||
      credential.trim() === ''
    ) {
      throw new UnauthorizedException(
        'Google sign-in failed. Please try again.',
      );
    }

    const tokeninfoUrl =
      process.env.GOOGLE_TOKENINFO_URL ||
      'https://oauth2.googleapis.com/tokeninfo';

    const params = new URLSearchParams();
    params.append('id_token', credential.trim());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(tokeninfoUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn(
          `Google tokeninfo returned non-200 status: ${res.status}`,
        );
        throw new UnauthorizedException(
          'Google sign-in failed. Please try again.',
        );
      }

      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new UnauthorizedException(
          'Google sign-in failed. Please try again.',
        );
      }

      if (!data || typeof data !== 'object') {
        throw new UnauthorizedException(
          'Google sign-in failed. Please try again.',
        );
      }

      // Check aud: must strictly match configured GOOGLE_CLIENT_ID
      if (data.aud !== clientId) {
        this.logger.warn(
          `Google token aud mismatch: expected ${clientId}, received ${data.aud}`,
        );
        throw new UnauthorizedException(
          'Google sign-in failed. Please try again.',
        );
      }

      // Check iss: must be accounts.google.com or https://accounts.google.com
      if (
        data.iss !== 'accounts.google.com' &&
        data.iss !== 'https://accounts.google.com'
      ) {
        this.logger.warn(`Google token iss mismatch: ${data.iss}`);
        throw new UnauthorizedException(
          'Google sign-in failed. Please try again.',
        );
      }

      // Check exp: token expiry in seconds must be greater than current time
      const expSeconds = Number(data.exp);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (isNaN(expSeconds) || expSeconds <= nowSeconds) {
        this.logger.warn(
          `Google token expired: exp=${expSeconds}, now=${nowSeconds}`,
        );
        throw new UnauthorizedException(
          'Google sign-in failed. Please try again.',
        );
      }

      // Check email_verified: string 'true' or boolean true
      if (data.email_verified !== 'true' && data.email_verified !== true) {
        this.logger.warn(
          `Google token email not verified: ${data.email_verified}`,
        );
        throw new UnauthorizedException(
          'Google sign-in failed. Please try again.',
        );
      }

      // Check email: non-empty string
      if (typeof data.email !== 'string' || data.email.trim() === '') {
        this.logger.warn('Google token email missing or empty');
        throw new UnauthorizedException(
          'Google sign-in failed. Please try again.',
        );
      }

      const email = data.email.trim().toLowerCase();
      const name =
        typeof data.name === 'string' && data.name.trim() !== ''
          ? data.name.trim()
          : null;

      return { email, name };
    } catch (err: unknown) {
      if (
        err instanceof ServiceUnavailableException ||
        err instanceof UnauthorizedException
      ) {
        throw err;
      }
      this.logger.warn(
        `Google token verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException(
        'Google sign-in failed. Please try again.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
