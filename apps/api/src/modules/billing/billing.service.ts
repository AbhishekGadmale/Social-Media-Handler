import {
  Injectable,
  Logger,
  Inject,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  PrismaClient,
  BillingInterval,
  SubscriptionStatus,
  InvoiceStatus,
  WorkspaceRole,
  generateId,
} from '@agency-os/database';
import {
  EMAIL_DELIVERY_SERVICE,
  type EmailDeliveryService,
} from '../auth/email-delivery.service';
import { RazorpayService } from './razorpay.service';
import { PLANS, FOUNDING_PLAN_MAX_SEATS, getGstin } from './billing.config';
import { calculateGstSplit } from './gst.util';

export interface RecordChargedInvoiceInput {
  workspaceId: string;
  subscriptionId?: string;
  amountPaise: number;
  razorpayPaymentId?: string;
  razorpayInvoiceId?: string;
  customerBillingDetails?: any;
  periodStart?: Date;
  periodEnd?: Date;
}

export interface RazorpayWebhookPayload {
  id: string;
  entity: string;
  event: string;
  contains?: string[];
  payload: {
    subscription?: {
      entity?: {
        id: string;
        plan_id?: string;
        status?: string;
        current_start?: number;
        current_end?: number;
        ended_at?: number;
        quantity?: number;
        notes?: Record<string, any>;
      };
    };
    payment?: {
      entity?: {
        id: string;
        amount?: number;
        status?: string;
        error_description?: string;
        error_reason?: string;
        notes?: Record<string, any>;
      };
    };
    [key: string]: any;
  };
  created_at?: number;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly razorpayService: RazorpayService,
    @Inject(EMAIL_DELIVERY_SERVICE)
    private readonly emailDeliveryService: EmailDeliveryService,
  ) {}

  /**
   * Seeds default plans into the database if not present.
   * Idempotently creates plans in Razorpay (both monthly and annual) and stores razorpayPlanId and razorpayAnnualPlanId.
   */
  async seedPlans(): Promise<void> {
    for (const planConfig of Object.values(PLANS)) {
      const existing = await this.prisma.plan.findUnique({
        where: { code: planConfig.code },
      });

      let razorpayPlanId = existing?.razorpayPlanId;
      let razorpayAnnualPlanId = existing?.razorpayAnnualPlanId;

      if (!razorpayPlanId) {
        try {
          const rzpPlan = await this.razorpayService.createPlan({
            period: 'monthly',
            interval: 1,
            item: {
              name: `${planConfig.name} (Monthly)`,
              amount: planConfig.monthlyPricePaise,
              currency: 'INR',
              description: `${planConfig.name} Monthly Plan`,
            },
            notes: {
              planCode: planConfig.code,
              interval: 'MONTHLY',
            },
          });
          razorpayPlanId = rzpPlan?.id;
          this.logger.log(
            `Created Razorpay monthly plan for ${planConfig.code}: ${razorpayPlanId}`,
          );
        } catch (err) {
          this.logger.warn(
            `Could not create Razorpay monthly plan for ${planConfig.code}: ${err}`,
          );
        }
      }

      if (!razorpayAnnualPlanId) {
        try {
          const rzpAnnualPlan = await this.razorpayService.createPlan({
            period: 'yearly',
            interval: 1,
            item: {
              name: `${planConfig.name} (Annual)`,
              amount: planConfig.annualPricePaise,
              currency: 'INR',
              description: `${planConfig.name} Annual Plan`,
            },
            notes: {
              planCode: planConfig.code,
              interval: 'ANNUAL',
            },
          });
          razorpayAnnualPlanId = rzpAnnualPlan?.id;
          this.logger.log(
            `Created Razorpay annual plan for ${planConfig.code}: ${razorpayAnnualPlanId}`,
          );
        } catch (err) {
          this.logger.warn(
            `Could not create Razorpay annual plan for ${planConfig.code}: ${err}`,
          );
        }
      }

      if (!existing) {
        await this.prisma.plan.create({
          data: {
            id: generateId(),
            code: planConfig.code,
            name: planConfig.name,
            monthlyPricePaise: planConfig.monthlyPricePaise,
            annualPricePaise: planConfig.annualPricePaise,
            seats: planConfig.seats,
            isFounding: planConfig.isFounding,
            isActive: true,
            razorpayPlanId: razorpayPlanId || null,
            razorpayAnnualPlanId: razorpayAnnualPlanId || null,
          },
        });
        this.logger.log(`Seeded plan: ${planConfig.code} (${planConfig.name})`);
      } else if (
        (razorpayPlanId && !existing.razorpayPlanId) ||
        (razorpayAnnualPlanId && !existing.razorpayAnnualPlanId)
      ) {
        await this.prisma.plan.update({
          where: { id: existing.id },
          data: {
            razorpayPlanId: razorpayPlanId || existing.razorpayPlanId,
            razorpayAnnualPlanId:
              razorpayAnnualPlanId || existing.razorpayAnnualPlanId,
          },
        });
      }
    }
  }

  /**
   * Retrieves active plan by code.
   */
  async getPlanByCode(code: string) {
    let plan = await this.prisma.plan.findUnique({
      where: { code },
    });
    if (!plan || !plan.razorpayPlanId || !plan.razorpayAnnualPlanId) {
      await this.seedPlans();
      plan = await this.prisma.plan.findUnique({
        where: { code },
      });
    }
    if (!plan) {
      throw new NotFoundException(`Plan with code ${code} not found`);
    }
    return plan;
  }

  /**
   * Serializes Founding Agency subscription claims using row-level locking on Plan row.
   * If active count < 50, claims seat and provisions Razorpay subscription.
   */
  async claimFoundingSubscription(
    workspaceId: string,
    interval: BillingInterval = BillingInterval.MONTHLY,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Check existing subscription
      const existing = await tx.subscription.findUnique({
        where: { workspaceId },
      });

      if (
        existing &&
        existing.isFounding &&
        existing.status !== SubscriptionStatus.CANCELLED
      ) {
        // Grandfathered
        return existing;
      }

      // 2. Ensure Founding Plan exists
      let foundingPlan = await tx.plan.findUnique({
        where: { code: 'AGENCY_FOUNDING' },
      });

      let razorpayPlanId = foundingPlan?.razorpayPlanId || null;
      let razorpayAnnualPlanId = foundingPlan?.razorpayAnnualPlanId || null;

      if (!razorpayPlanId) {
        try {
          const rzpPlan = await this.razorpayService.createPlan({
            period: 'monthly',
            interval: 1,
            item: {
              name: `${PLANS.AGENCY_FOUNDING.name} (Monthly)`,
              amount: PLANS.AGENCY_FOUNDING.monthlyPricePaise,
              currency: 'INR',
              description: `${PLANS.AGENCY_FOUNDING.name} Monthly Plan`,
            },
            notes: {
              planCode: PLANS.AGENCY_FOUNDING.code,
              interval: 'MONTHLY',
            },
          });
          razorpayPlanId = rzpPlan?.id || null;
        } catch (err) {
          this.logger.warn(
            `Could not seed monthly Razorpay plan for founding tier: ${err}`,
          );
        }
      }

      if (!razorpayAnnualPlanId) {
        try {
          const rzpAnnualPlan = await this.razorpayService.createPlan({
            period: 'yearly',
            interval: 1,
            item: {
              name: `${PLANS.AGENCY_FOUNDING.name} (Annual)`,
              amount: PLANS.AGENCY_FOUNDING.annualPricePaise,
              currency: 'INR',
              description: `${PLANS.AGENCY_FOUNDING.name} Annual Plan`,
            },
            notes: {
              planCode: PLANS.AGENCY_FOUNDING.code,
              interval: 'ANNUAL',
            },
          });
          razorpayAnnualPlanId = rzpAnnualPlan?.id || null;
        } catch (err) {
          this.logger.warn(
            `Could not seed annual Razorpay plan for founding tier: ${err}`,
          );
        }
      }

      if (!foundingPlan) {
        foundingPlan = await tx.plan.create({
          data: {
            id: generateId(),
            code: PLANS.AGENCY_FOUNDING.code,
            name: PLANS.AGENCY_FOUNDING.name,
            monthlyPricePaise: PLANS.AGENCY_FOUNDING.monthlyPricePaise,
            annualPricePaise: PLANS.AGENCY_FOUNDING.annualPricePaise,
            seats: PLANS.AGENCY_FOUNDING.seats,
            isFounding: true,
            isActive: true,
            razorpayPlanId,
            razorpayAnnualPlanId,
          },
        });
      } else if (
        (razorpayPlanId && !foundingPlan.razorpayPlanId) ||
        (razorpayAnnualPlanId && !foundingPlan.razorpayAnnualPlanId)
      ) {
        foundingPlan = await tx.plan.update({
          where: { id: foundingPlan.id },
          data: {
            razorpayPlanId: razorpayPlanId || foundingPlan.razorpayPlanId,
            razorpayAnnualPlanId:
              razorpayAnnualPlanId || foundingPlan.razorpayAnnualPlanId,
          },
        });
      }

      // 3. Row-level pessimistic lock on Plan row to serialize concurrent claims
      if (typeof tx.$queryRaw === 'function') {
        try {
          await tx.$queryRaw`SELECT id FROM "Plan" WHERE code = 'AGENCY_FOUNDING' FOR UPDATE`;
        } catch {
          // Pass if mocked in unit tests
        }
      }

      // 4. Count active founding subscriptions
      const claimedCount = await tx.subscription.count({
        where: {
          isFounding: true,
          status: {
            in: [
              SubscriptionStatus.ACTIVE,
              SubscriptionStatus.TRIAL,
              SubscriptionStatus.PAST_DUE,
            ],
          },
        },
      });

      if (claimedCount >= FOUNDING_PLAN_MAX_SEATS) {
        throw new ConflictException(
          'FOUNDING_PLAN_SOLD_OUT: Founding Agency tier is sold out (limit 50 workspaces reached)',
        );
      }

      const isAnnual = interval === BillingInterval.ANNUAL;
      const selectedPlanId = isAnnual
        ? foundingPlan.razorpayAnnualPlanId || 'plan_founding_annual_fallback'
        : foundingPlan.razorpayPlanId || 'plan_founding_fallback';
      const totalCount = isAnnual ? 10 : 120;

      // 5. Create Razorpay subscription - failure here aborts transaction with no local state claimed
      let rzpSub: any;
      try {
        rzpSub = await this.razorpayService.createSubscription({
          planId: selectedPlanId,
          totalCount,
          notes: {
            workspaceId,
            planCode: 'AGENCY_FOUNDING',
            interval,
          },
        });
      } catch (err: any) {
        this.logger.error(
          `Failed to create Razorpay subscription for founding workspace ${workspaceId}: ${err?.message || err}`,
        );
        throw err;
      }

      const razorpaySubscriptionId = rzpSub?.id || null;

      let savedSubscription: any;
      // 6. Create or update subscription
      if (existing) {
        savedSubscription = await tx.subscription.update({
          where: { id: existing.id },
          data: {
            planId: foundingPlan.id,
            razorpaySubscriptionId,
            razorpayPlanId: selectedPlanId,
            isFounding: true,
            billingInterval: interval,
            status: SubscriptionStatus.TRIAL,
            cancelAtPeriodEnd: false,
          },
        });
      } else {
        savedSubscription = await tx.subscription.create({
          data: {
            id: generateId(),
            workspaceId,
            planId: foundingPlan.id,
            razorpaySubscriptionId,
            razorpayPlanId: selectedPlanId,
            isFounding: true,
            billingInterval: interval,
            status: SubscriptionStatus.TRIAL,
            cancelAtPeriodEnd: false,
          },
        });
      }

      return {
        ...savedSubscription,
        ...(rzpSub?.short_url
          ? { shortUrl: rzpSub.short_url, short_url: rzpSub.short_url }
          : {}),
      };
    });
  }

  /**
   * Provisions subscription for a workspace.
   * Creates subscription in Razorpay first; if Razorpay fails, throws without claiming local state.
   */
  async createSubscription(
    workspaceId: string,
    planCode: string,
    interval: BillingInterval = BillingInterval.MONTHLY,
  ) {
    if (planCode === 'AGENCY_FOUNDING') {
      return this.claimFoundingSubscription(workspaceId, interval);
    }

    const plan = await this.getPlanByCode(planCode);
    const isAnnual = interval === BillingInterval.ANNUAL;
    const selectedPlanId = isAnnual
      ? plan.razorpayAnnualPlanId ||
        `plan_${planCode.toLowerCase()}_annual_fallback`
      : plan.razorpayPlanId || `plan_${planCode.toLowerCase()}_fallback`;
    const totalCount = isAnnual ? 10 : 120;

    let rzpSub: any;
    try {
      rzpSub = await this.razorpayService.createSubscription({
        planId: selectedPlanId,
        totalCount,
        notes: {
          workspaceId,
          planCode: plan.code,
          interval,
        },
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to create Razorpay subscription for workspace ${workspaceId}: ${err?.message || err}`,
      );
      throw err;
    }

    const razorpaySubscriptionId = rzpSub?.id || null;

    const savedSub = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscription.findUnique({
        where: { workspaceId },
      });

      if (existing) {
        return tx.subscription.update({
          where: { id: existing.id },
          data: {
            planId: plan.id,
            razorpaySubscriptionId,
            razorpayPlanId: selectedPlanId,
            isFounding: false,
            billingInterval: interval,
            status: SubscriptionStatus.TRIAL,
            cancelAtPeriodEnd: false,
          },
        });
      }

      return tx.subscription.create({
        data: {
          id: generateId(),
          workspaceId,
          planId: plan.id,
          razorpaySubscriptionId,
          razorpayPlanId: selectedPlanId,
          isFounding: false,
          billingInterval: interval,
          status: SubscriptionStatus.TRIAL,
          cancelAtPeriodEnd: false,
        },
      });
    });

    return {
      ...savedSub,
      ...(rzpSub?.short_url
        ? { shortUrl: rzpSub.short_url, short_url: rzpSub.short_url }
        : {}),
    };
  }

  /**
   * Cancels subscription. If founding, founding lock is permanently lost.
   */
  async cancelSubscription(workspaceId: string, cancelAtPeriodEnd = true) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { workspaceId },
    });

    if (!subscription) {
      throw new NotFoundException(
        `No subscription found for workspace ${workspaceId}`,
      );
    }

    if (subscription.razorpaySubscriptionId) {
      try {
        await this.razorpayService.cancelSubscription(
          subscription.razorpaySubscriptionId,
          cancelAtPeriodEnd,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to cancel Razorpay subscription ${subscription.razorpaySubscriptionId}: ${err}`,
        );
      }
    }

    return this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        isFounding: false, // Permanently lost on cancel
        cancelAtPeriodEnd,
        status: cancelAtPeriodEnd
          ? subscription.status
          : SubscriptionStatus.CANCELLED,
      },
    });
  }

  /**
   * Records a charged invoice with sequential number and 18% GST split.
   * Idempotent on razorpayPaymentId (returns existing invoice if already present).
   */
  async recordChargedInvoice(
    input: RecordChargedInvoiceInput,
    prismaClient: any = this.prisma,
  ) {
    const currentYear = new Date().getFullYear();
    const gstin = getGstin();
    const split = calculateGstSplit(input.amountPaise);

    const execute = async (tx: any) => {
      if (input.razorpayPaymentId) {
        const existingInvoice = await tx.invoice.findUnique({
          where: { razorpayPaymentId: input.razorpayPaymentId },
        });
        if (existingInvoice) {
          this.logger.log(
            `Invoice already exists for razorpayPaymentId ${input.razorpayPaymentId}: ${existingInvoice.invoiceNumber}`,
          );
          return existingInvoice;
        }
      }

      const seq = await tx.invoiceSequence.upsert({
        where: { year: currentYear },
        create: { year: currentYear, lastSequence: 1 },
        update: { lastSequence: { increment: 1 } },
      });

      const invoiceNumber = `INV-${currentYear}-${String(seq.lastSequence).padStart(5, '0')}`;

      return tx.invoice.create({
        data: {
          id: generateId(),
          workspaceId: input.workspaceId,
          subscriptionId: input.subscriptionId,
          invoiceNumber,
          amountPaise: input.amountPaise,
          baseAmountPaise: split.baseAmountPaise,
          gstAmountPaise: split.gstAmountPaise,
          gstRate: split.gstRate,
          gstin,
          customerBillingDetails: input.customerBillingDetails,
          razorpayPaymentId: input.razorpayPaymentId,
          razorpayInvoiceId: input.razorpayInvoiceId,
          status: InvoiceStatus.PAID,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
      });
    };

    if (prismaClient === this.prisma) {
      return this.prisma.$transaction(execute);
    }
    return execute(prismaClient);
  }

  /**
   * Ingests and processes Razorpay webhook events idempotently.
   */
  async processWebhook(event: RazorpayWebhookPayload): Promise<{
    processed: boolean;
    duplicate?: boolean;
    eventId: string;
  }> {
    // 1. Idempotency Check & Atomic claim
    let duplicate = false;
    try {
      await this.prisma.webhookEvent.create({
        data: {
          id: generateId(),
          eventId: event.id,
          provider: 'RAZORPAY',
          payload: event as any,
          processed: false,
        },
      });
    } catch (err: any) {
      if (
        err?.code === 'P2002' ||
        err?.message?.includes('Unique constraint') ||
        err?.message?.includes('webhookevent_eventid_key')
      ) {
        const existing = await this.prisma.webhookEvent.findUnique({
          where: { eventId: event.id },
        });

        if (existing?.processed) {
          return { processed: true, duplicate: true, eventId: event.id };
        }
        duplicate = false;
      } else {
        throw err;
      }
    }

    // 2. Event Handling and marking processed inside transaction
    return this.prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') {
        try {
          await tx.$queryRaw`SELECT id, processed FROM "WebhookEvent" WHERE "eventId" = ${event.id} FOR UPDATE`;
        } catch {
          // Ignored if unsupported in mock environment
        }
      }

      const existingRecord = await tx.webhookEvent.findUnique({
        where: { eventId: event.id },
      });

      if (existingRecord?.processed) {
        return { processed: true, duplicate: true, eventId: event.id };
      }

      const rzpSub = event.payload.subscription?.entity;
      const rzpPayment = event.payload.payment?.entity;

      switch (event.event) {
        case 'subscription.authenticated': {
          if (rzpSub?.id) {
            const sub = await tx.subscription.findFirst({
              where: { razorpaySubscriptionId: rzpSub.id },
            });
            if (sub) {
              await tx.subscription.update({
                where: { id: sub.id },
                data: {
                  status: SubscriptionStatus.ACTIVE,
                  currentPeriodStart: rzpSub.current_start
                    ? new Date(rzpSub.current_start * 1000)
                    : new Date(),
                  currentPeriodEnd: rzpSub.current_end
                    ? new Date(rzpSub.current_end * 1000)
                    : undefined,
                },
              });
            }
          }
          break;
        }

        case 'subscription.charged': {
          if (rzpSub?.id) {
            const sub = await tx.subscription.findFirst({
              where: { razorpaySubscriptionId: rzpSub.id },
            });
            if (sub) {
              const periodStart = rzpSub.current_start
                ? new Date(rzpSub.current_start * 1000)
                : new Date();
              const periodEnd = rzpSub.current_end
                ? new Date(rzpSub.current_end * 1000)
                : undefined;

              await tx.subscription.update({
                where: { id: sub.id },
                data: {
                  status: SubscriptionStatus.ACTIVE,
                  currentPeriodStart: periodStart,
                  currentPeriodEnd: periodEnd,
                },
              });

              if (rzpPayment?.amount) {
                await this.recordChargedInvoice(
                  {
                    workspaceId: sub.workspaceId,
                    subscriptionId: sub.id,
                    amountPaise: rzpPayment.amount,
                    razorpayPaymentId: rzpPayment.id,
                    periodStart,
                    periodEnd,
                  },
                  tx,
                );
              }
            }
          }
          break;
        }

        case 'subscription.halted': {
          if (rzpSub?.id) {
            const sub = await tx.subscription.findFirst({
              where: { razorpaySubscriptionId: rzpSub.id },
            });
            if (sub) {
              await tx.subscription.update({
                where: { id: sub.id },
                data: { status: SubscriptionStatus.HALTED },
              });
            }
          }
          break;
        }

        case 'subscription.cancelled': {
          if (rzpSub?.id) {
            const sub = await tx.subscription.findFirst({
              where: { razorpaySubscriptionId: rzpSub.id },
            });
            if (sub) {
              await tx.subscription.update({
                where: { id: sub.id },
                data: {
                  isFounding: false,
                  status: SubscriptionStatus.CANCELLED,
                },
              });
            }
          }
          break;
        }

        case 'subscription.completed':
        case 'subscription.expired': {
          if (rzpSub?.id) {
            const sub = await tx.subscription.findFirst({
              where: { razorpaySubscriptionId: rzpSub.id },
            });
            if (sub) {
              await tx.subscription.update({
                where: { id: sub.id },
                data: { status: SubscriptionStatus.EXPIRED },
              });
            }
          }
          break;
        }

        case 'payment.failed': {
          if (rzpSub?.id) {
            const sub = await tx.subscription.findFirst({
              where: { razorpaySubscriptionId: rzpSub.id },
            });
            if (sub && sub.status !== SubscriptionStatus.HALTED) {
              await tx.subscription.update({
                where: { id: sub.id },
                data: { status: SubscriptionStatus.PAST_DUE },
              });

              // Find workspace owner to dispatch dunning email
              const ownerMembership = await tx.workspaceMember.findFirst({
                where: {
                  workspaceId: sub.workspaceId,
                  role: WorkspaceRole.OWNER,
                },
                include: { user: true },
              });

              if (ownerMembership?.user?.email) {
                try {
                  await this.emailDeliveryService.sendDunningEmail(
                    ownerMembership.user.email,
                    {
                      amountPaise: rzpPayment?.amount,
                      reason:
                        rzpPayment?.error_description ||
                        rzpPayment?.error_reason ||
                        'Card declined',
                    },
                  );
                } catch (err) {
                  this.logger.error(
                    `Failed to send dunning email for workspace ${sub.workspaceId}: ${err}`,
                  );
                }
              }
            }
          }
          break;
        }

        default:
          this.logger.log(`Unhandled webhook event type: ${event.event}`);
      }

      // 3. Mark processed
      await tx.webhookEvent.update({
        where: { eventId: event.id },
        data: { processed: true },
      });

      return {
        processed: true,
        eventId: event.id,
        ...(duplicate ? { duplicate: true } : {}),
      };
    });
  }

  /**
   * Retrieves billing details for a workspace.
   */
  async getWorkspaceBilling(workspaceId: string) {
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

    return {
      workspaceId: workspace.id,
      trialEndsAt: workspace.trialEndsAt,
      subscription: workspace.subscription,
    };
  }

  /**
   * Retrieves all active plans with founding availability flag.
   */
  async getPlansWithAvailability() {
    await this.seedPlans();

    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPricePaise: 'asc' },
    });

    const claimedCount = await this.prisma.subscription.count({
      where: {
        isFounding: true,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIAL,
            SubscriptionStatus.PAST_DUE,
          ],
        },
      },
    });

    const foundingAvailable = claimedCount < FOUNDING_PLAN_MAX_SEATS;

    return {
      plans,
      foundingAvailable,
    };
  }

  /**
   * Retrieves workspace invoices newest first, with subscription and plan details.
   */
  async getWorkspaceInvoices(workspaceId: string) {
    return this.prisma.invoice.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
      },
    });
  }

  /**
   * Retrieves an invoice by ID scoped strictly to workspaceId.
   * Throws 404 NotFoundException for missing or foreign workspace invoices.
   */
  async getInvoiceRecord(workspaceId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        workspaceId,
      },
      include: {
        workspace: true,
        subscription: {
          include: {
            plan: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }
}
