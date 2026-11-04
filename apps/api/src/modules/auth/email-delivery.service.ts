import { Injectable, Logger } from '@nestjs/common';

export const EMAIL_DELIVERY_SERVICE = 'EMAIL_DELIVERY_SERVICE';

export interface EmailDeliveryService {
  sendVerificationEmail(toEmail: string, rawToken: string): Promise<void>;
}

@Injectable()
export class MockEmailDeliveryService implements EmailDeliveryService {
  private readonly logger = new Logger(MockEmailDeliveryService.name);
  public sentEmails: Array<{ toEmail: string; rawToken: string }> = [];

  async sendVerificationEmail(
    toEmail: string,
    rawToken: string,
  ): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'MockEmailDeliveryService must NEVER be used in production.',
      );
    }

    this.sentEmails.push({ toEmail, rawToken });
    this.logger.debug(
      `[MockEmailDeliveryService] Verification email simulated for ${toEmail} (raw token redacted)`,
    );
  }
}

@Injectable()
export class NoopEmailDeliveryService implements EmailDeliveryService {
  async sendVerificationEmail(
    _toEmail: string,
    _rawToken: string,
  ): Promise<void> {
    // PR #50 will integrate live email delivery provider
  }
}
