import { Injectable, Logger } from '@nestjs/common';

export const EMAIL_DELIVERY_SERVICE = 'EMAIL_DELIVERY_SERVICE';

export interface EmailDeliveryService {
  sendVerificationEmail(toEmail: string, rawToken: string): Promise<void>;
  sendDunningEmail(
    toEmail: string,
    details: { amountPaise?: number; reason?: string },
  ): Promise<void>;
}

@Injectable()
export class MockEmailDeliveryService implements EmailDeliveryService {
  private readonly logger = new Logger(MockEmailDeliveryService.name);
  public sentEmails: Array<{ toEmail: string; rawToken: string }> = [];
  public sentDunningEmails: Array<{
    toEmail: string;
    details: { amountPaise?: number; reason?: string };
  }> = [];

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

  async sendDunningEmail(
    toEmail: string,
    details: { amountPaise?: number; reason?: string },
  ): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'MockEmailDeliveryService must NEVER be used in production.',
      );
    }

    this.sentDunningEmails.push({ toEmail, details });
    this.logger.debug(
      `[MockEmailDeliveryService] Dunning email simulated for ${toEmail}`,
    );
  }
}

@Injectable()
export class NoopEmailDeliveryService implements EmailDeliveryService {
  private readonly logger = new Logger(NoopEmailDeliveryService.name);

  async sendVerificationEmail(
    toEmail: string,
    _rawToken: string,
  ): Promise<void> {
    this.logger.warn(
      `[NoopEmailDeliveryService] Verification email delivery skipped for ${toEmail}: no email provider configured.`,
    );
  }

  async sendDunningEmail(
    toEmail: string,
    _details: { amountPaise?: number; reason?: string },
  ): Promise<void> {
    this.logger.warn(
      `[NoopEmailDeliveryService] Dunning email skipped for ${toEmail}: no email provider configured.`,
    );
  }
}

@Injectable()
export class ResendEmailDeliveryService implements EmailDeliveryService {
  private readonly logger = new Logger(ResendEmailDeliveryService.name);
  private readonly apiKey: string;
  private readonly fromEmail: string;

  constructor(apiKey?: string, fromEmail?: string) {
    this.apiKey = apiKey || process.env.RESEND_API_KEY || '';
    this.fromEmail =
      fromEmail ||
      process.env.EMAIL_FROM ||
      'Agency OS <onboarding@resend.dev>';
  }

  async sendVerificationEmail(
    toEmail: string,
    rawToken: string,
  ): Promise<void> {
    if (!this.apiKey) {
      throw new Error(
        'Resend API key is not configured (RESEND_API_KEY environment variable missing)',
      );
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verifyUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromEmail,
        to: [toEmail],
        subject: 'Verify your Agency OS account',
        html: `<p>Welcome to Agency OS!</p><p>Please verify your email address by clicking <a href="${verifyUrl}">here</a>.</p><p>Or paste this link into your browser: ${verifyUrl}</p>`,
        text: `Welcome to Agency OS!\n\nPlease verify your email address using this link:\n${verifyUrl}\n`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.logger.error(
        `[ResendEmailDeliveryService] Failed to send verification email to ${toEmail}: ${response.status} ${response.statusText} - ${errorText}`,
      );
      throw new Error(
        `Failed to send verification email via Resend (${response.status})`,
      );
    }

    this.logger.log(
      `[ResendEmailDeliveryService] Verification email successfully sent to ${toEmail} (raw token redacted)`,
    );
  }

  async sendDunningEmail(
    toEmail: string,
    details: { amountPaise?: number; reason?: string },
  ): Promise<void> {
    if (!this.apiKey) {
      throw new Error(
        'Resend API key is not configured (RESEND_API_KEY environment variable missing)',
      );
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromEmail,
        to: [toEmail],
        subject: 'Payment Failed — Agency OS Subscription',
        html: `<p>We were unable to process your subscription payment.</p><p>Reason: ${details.reason || 'Payment failed'}</p><p>Please update your payment method to ensure uninterrupted access.</p>`,
        text: `We were unable to process your subscription payment.\n\nReason: ${details.reason || 'Payment failed'}\n\nPlease update your payment method to ensure uninterrupted access.\n`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.logger.error(
        `[ResendEmailDeliveryService] Failed to send dunning email to ${toEmail}: ${response.status} ${response.statusText} - ${errorText}`,
      );
      throw new Error(
        `Failed to send dunning email via Resend (${response.status})`,
      );
    }

    this.logger.log(
      `[ResendEmailDeliveryService] Dunning email successfully sent to ${toEmail}`,
    );
  }
}
