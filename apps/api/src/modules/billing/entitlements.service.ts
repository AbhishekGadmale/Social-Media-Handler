import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient, SubscriptionStatus } from '@agency-os/database';
import { getTrialGraceDays } from './billing.config';

export interface WorkspaceEntitlements {
  isReadOnly: boolean;
  readOnlyReason?: string;
  planCode: string;
  seats: number;
  isTrial: boolean;
  trialEndsAt: Date | null;
  subscriptionStatus: SubscriptionStatus | null;
}

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Evaluates the current billing status and entitlements of a workspace.
   */
  async getWorkspaceEntitlements(
    workspaceId: string,
    now: Date = new Date(),
    overrideGraceDays?: number,
  ): Promise<WorkspaceEntitlements> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    }

    const graceDays = overrideGraceDays ?? getTrialGraceDays();
    const graceMs = graceDays * 24 * 60 * 60 * 1000;
    const subscription = workspace.subscription;

    // 1. Paid Subscription Lifecycle
    if (subscription) {
      const plan = subscription.plan;
      const periodEnd = subscription.currentPeriodEnd;

      switch (subscription.status) {
        case SubscriptionStatus.ACTIVE:
          return {
            isReadOnly: false,
            planCode: plan?.code || 'CUSTOM',
            seats: plan?.seats || 1,
            isTrial: false,
            trialEndsAt: workspace.trialEndsAt,
            subscriptionStatus: subscription.status,
          };

        case SubscriptionStatus.HALTED:
          return {
            isReadOnly: true,
            readOnlyReason:
              'Workspace subscription is halted by payment provider. Please renew or update your payment method.',
            planCode: plan?.code || 'CUSTOM',
            seats: plan?.seats || 1,
            isTrial: false,
            trialEndsAt: workspace.trialEndsAt,
            subscriptionStatus: subscription.status,
          };

        case SubscriptionStatus.PAST_DUE: {
          const isPastPeriodEnd = periodEnd
            ? now.getTime() > periodEnd.getTime()
            : true;
          return {
            isReadOnly: isPastPeriodEnd,
            readOnlyReason: isPastPeriodEnd
              ? 'Subscription payment past due and billing period has expired. Workspace is in read-only mode.'
              : undefined,
            planCode: plan?.code || 'CUSTOM',
            seats: plan?.seats || 1,
            isTrial: false,
            trialEndsAt: workspace.trialEndsAt,
            subscriptionStatus: subscription.status,
          };
        }

        case SubscriptionStatus.CANCELLED:
        case SubscriptionStatus.EXPIRED: {
          const isPastPeriodEnd = periodEnd
            ? now.getTime() > periodEnd.getTime()
            : true;
          return {
            isReadOnly: isPastPeriodEnd,
            readOnlyReason: isPastPeriodEnd
              ? 'Subscription is expired or cancelled. Workspace is in read-only mode.'
              : undefined,
            planCode: plan?.code || 'CUSTOM',
            seats: plan?.seats || 1,
            isTrial: false,
            trialEndsAt: workspace.trialEndsAt,
            subscriptionStatus: subscription.status,
          };
        }

        case SubscriptionStatus.TRIAL:
        default:
          // Fall through to trial evaluation
          break;
      }
    }

    // 2. In-App Trial Lifecycle
    const trialEndsAt = workspace.trialEndsAt;
    if (trialEndsAt) {
      const expiryWithGrace = trialEndsAt.getTime() + graceMs;
      const isExpired = now.getTime() > expiryWithGrace;

      if (!isExpired) {
        return {
          isReadOnly: false,
          planCode: 'AGENCY_TRIAL',
          seats: 10, // Full Agency entitlements during trial
          isTrial: true,
          trialEndsAt,
          subscriptionStatus: subscription?.status || null,
        };
      }

      return {
        isReadOnly: true,
        readOnlyReason:
          'Trial expired. Workspace is in read-only mode. Please subscribe to a plan to continue.',
        planCode: 'EXPIRED_TRIAL',
        seats: 10,
        isTrial: true,
        trialEndsAt,
        subscriptionStatus: subscription?.status || null,
      };
    }

    // Default if no trial or subscription found (e.g. unmetered or test workspaces): writable
    return {
      isReadOnly: false,
      planCode: 'AGENCY_TRIAL',
      seats: 10,
      isTrial: true,
      trialEndsAt: null,
      subscriptionStatus: null,
    };
  }

  /**
   * Asserts that a workspace has active write privileges.
   * Throws ForbiddenException if read-only.
   */
  async assertWorkspaceWritable(
    workspaceId: string,
    now: Date = new Date(),
    overrideGraceDays?: number,
  ): Promise<void> {
    const entitlements = await this.getWorkspaceEntitlements(
      workspaceId,
      now,
      overrideGraceDays,
    );

    if (entitlements.isReadOnly) {
      throw new ForbiddenException(
        entitlements.readOnlyReason ||
          'Workspace is in read-only mode due to expired trial or halted subscription.',
      );
    }
  }

  /**
   * Asserts that adding additional members will not exceed the plan seat limit.
   */
  async assertSeatLimit(
    workspaceId: string,
    additionalSeats = 1,
  ): Promise<void> {
    const entitlements = await this.getWorkspaceEntitlements(workspaceId);
    const currentMemberCount = await this.prisma.workspaceMember.count({
      where: { workspaceId },
    });

    if (currentMemberCount + additionalSeats > entitlements.seats) {
      throw new ForbiddenException(
        `Seat limit exceeded for ${entitlements.planCode}. Current seats: ${currentMemberCount}, max allowed: ${entitlements.seats}. Please upgrade your plan.`,
      );
    }
  }
}
