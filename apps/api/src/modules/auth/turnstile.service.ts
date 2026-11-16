import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  async verify(token: string | undefined, remoteIp?: string): Promise<boolean> {
    const secretKey = process.env.TURNSTILE_SECRET_KEY;

    // Disabled mode: if secret key is unset or empty, return true immediately (no fetch).
    if (!secretKey || secretKey.trim() === '') {
      return true;
    }

    // Enabled mode: if token is missing or empty, return false without any network call.
    if (!token || token.trim() === '') {
      return false;
    }

    const siteverifyUrl =
      process.env.TURNSTILE_SITEVERIFY_URL ||
      'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    const params = new URLSearchParams();
    params.append('secret', secretKey);
    params.append('response', token);
    if (remoteIp) {
      params.append('remoteip', remoteIp);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(siteverifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn(
          `Turnstile siteverify returned non-200 status: ${res.status}`,
        );
        return true; // Fail-open
      }

      let data: { success?: boolean } | null = null;
      try {
        data = (await res.json()) as { success?: boolean };
      } catch (parseErr: unknown) {
        this.logger.warn(
          `Failed to parse Turnstile verification response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        );
        return true; // Fail-open
      }

      return data?.success === true;
    } catch (err: unknown) {
      this.logger.warn(
        `Turnstile verification request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return true; // Fail-open
    } finally {
      clearTimeout(timeout);
    }
  }
}
