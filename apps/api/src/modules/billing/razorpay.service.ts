import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import type { BillingCredentials } from './billing.config';

export interface CreateRazorpaySubscriptionInput {
  planId: string;
  totalCount?: number;
  quantity?: number;
  customerNotify?: 0 | 1;
  notes?: Record<string, string>;
}

export interface CreateRazorpayPlanInput {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  item: {
    name: string;
    amount: number;
    currency: string;
    description?: string;
  };
  notes?: Record<string, string>;
}

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly client: Razorpay;
  private readonly webhookSecret: string;
  private readonly keyId: string;

  constructor(credentials: BillingCredentials) {
    this.keyId = credentials.keyId;
    this.webhookSecret = credentials.webhookSecret;

    this.client = new Razorpay({
      key_id: credentials.keyId,
      key_secret: credentials.keySecret,
    });
  }

  /**
   * Cryptographically verifies the Razorpay webhook HMAC-SHA256 signature.
   * Uses timingSafeEqual to prevent side-channel timing attacks.
   */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!signature || typeof signature !== 'string') {
      return false;
    }

    try {
      const hmac = crypto.createHmac('sha256', this.webhookSecret);
      if (Buffer.isBuffer(rawBody)) {
        hmac.update(rawBody);
      } else {
        hmac.update(rawBody, 'utf8');
      }

      const expectedSignature = hmac.digest('hex');

      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
      const signatureBuffer = Buffer.from(signature, 'utf8');

      if (expectedBuffer.length !== signatureBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch (error) {
      this.logger.error('Error during webhook signature verification', error);
      return false;
    }
  }

  /**
   * Creates a recurring plan in Razorpay.
   */
  async createPlan(input: CreateRazorpayPlanInput): Promise<any> {
    return this.client.plans.create({
      period: input.period,
      interval: input.interval,
      item: input.item,
      notes: input.notes,
    });
  }

  /**
   * Creates a subscription in Razorpay.
   */
  async createSubscription(
    input: CreateRazorpaySubscriptionInput,
  ): Promise<any> {
    return this.client.subscriptions.create({
      plan_id: input.planId,
      total_count: input.totalCount ?? 120, // default 10 years monthly
      quantity: input.quantity ?? 1,
      customer_notify: input.customerNotify ?? 1,
      notes: input.notes ?? {},
    });
  }

  /**
   * Cancels a subscription in Razorpay.
   */
  async cancelSubscription(
    subscriptionId: string,
    cancelAtCycleEnd = true,
  ): Promise<any> {
    return this.client.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);
  }

  /**
   * Fetches a subscription from Razorpay.
   */
  async getSubscription(subscriptionId: string): Promise<any> {
    return this.client.subscriptions.fetch(subscriptionId);
  }

  toString(): string {
    return `[RazorpayService keyId=${this.keyId.substring(0, 8)}...]`;
  }
}
