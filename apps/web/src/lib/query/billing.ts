import { queryOptions } from '@tanstack/react-query';
import { api } from '../api/client';

export interface BillingPlan {
  id: string;
  code: 'SOLO' | 'STUDIO' | 'AGENCY' | 'AGENCY_FOUNDING' | string;
  name: string;
  monthlyPricePaise: number;
  annualPricePaise: number;
  seats: number;
  isFounding: boolean;
  isActive: boolean;
  features?: Record<string, unknown> | null;
}

export interface PlansResponse {
  plans: BillingPlan[];
  foundingAvailable: boolean;
}

export interface WorkspaceSubscription {
  id: string;
  workspaceId: string;
  planId: string;
  razorpaySubscriptionId?: string | null;
  status:
    | 'TRIAL'
    | 'ACTIVE'
    | 'PAST_DUE'
    | 'HALTED'
    | 'CANCELLED'
    | 'COMPLETED'
    | 'EXPIRED';
  billingInterval: 'MONTHLY' | 'ANNUAL';
  isFounding: boolean;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  plan?: BillingPlan | null;
}

export interface WorkspaceBillingResponse {
  workspaceId: string;
  trialEndsAt?: string | null;
  subscription?: WorkspaceSubscription | null;
  entitlements?: {
    isReadOnly: boolean;
    status: string;
    seats: number;
    planCode: string;
    features?: Record<string, unknown> | null;
  };
}

export interface InvoiceItem {
  id: string;
  workspaceId: string;
  subscriptionId?: string | null;
  invoiceNumber: string;
  amountPaise: number;
  baseAmountPaise: number;
  gstAmountPaise: number;
  gstRate: number;
  gstin: string;
  status: 'PAID' | 'FAILED';
  periodStart?: string | null;
  periodEnd?: string | null;
  createdAt: string;
  updatedAt: string;
  subscription?: {
    id: string;
    isFounding?: boolean;
    plan?: {
      code: string;
      name: string;
    } | null;
  } | null;
}

export const billingQueries = {
  status: (workspaceId: string) =>
    queryOptions({
      queryKey: ['workspaces', workspaceId, 'billing'],
      queryFn: () =>
        api.get<WorkspaceBillingResponse>(`workspaces/${workspaceId}/billing`),
      enabled: !!workspaceId,
    }),

  plans: (workspaceId: string) =>
    queryOptions({
      queryKey: ['workspaces', workspaceId, 'billing', 'plans'],
      queryFn: () =>
        api.get<PlansResponse>(`workspaces/${workspaceId}/billing/plans`),
      enabled: !!workspaceId,
    }),

  invoices: (workspaceId: string) =>
    queryOptions({
      queryKey: ['workspaces', workspaceId, 'billing', 'invoices'],
      queryFn: () =>
        api.get<InvoiceItem[]>(`workspaces/${workspaceId}/billing/invoices`),
      enabled: !!workspaceId,
    }),
};
