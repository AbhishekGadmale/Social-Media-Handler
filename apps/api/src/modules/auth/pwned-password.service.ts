import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

@Injectable()
export class PwnedPasswordService {
  private readonly logger = new Logger(PwnedPasswordService.name);

  async isBreached(password: string): Promise<boolean> {
    if (process.env.PASSWORD_BREACH_CHECK_ENABLED === 'false') {
      return false;
    }

    const sha1 = createHash('sha1')
      .update(password)
      .digest('hex')
      .toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const baseUrl =
      process.env.HIBP_API_BASE_URL || 'https://api.pwnedpasswords.com';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      const res = await fetch(`${baseUrl}/range/${prefix}`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'AgencyOS-PasswordCheck',
        },
      });

      if (!res.ok) {
        this.logger.warn(
          `HIBP range API returned non-200 status: ${res.status}`,
        );
        return false;
      }

      const body = await res.text();
      const lines = body.split(/\r?\n/);
      for (const line of lines) {
        const [lineSuffix] = line.split(':');
        if (lineSuffix && lineSuffix.trim().toUpperCase() === suffix) {
          return true;
        }
      }

      return false;
    } catch (err: any) {
      this.logger.warn(
        `HIBP range API request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
