import { createServerFn } from "@tanstack/react-start";
import { apiGet, apiPatch, apiPost } from "../api.server";
import type { ApiTimestamp } from "./vendors";

export interface MarketplaceReconciliation {
  healthy: boolean;
  checkedAt: ApiTimestamp;
  ledgerEntries: number;
  payments: number;
  refunds: number;
  payouts: number;
  payoutBatches: number;
  projections: number;
  ledgerMismatches: Array<{ journalId: string; debitMinor: number; creditMinor: number; invalidEntrySides: number }>;
  financialEventMismatches: Array<{
    sourceKind: "payment" | "refund";
    sourceId: string;
    eventType: "payment.captured" | "refund.completed";
    reason: "missing_outbox" | "failed_outbox" | "dead_outbox" | "missing_journal" | "journal_contract_mismatch" | "journal_missing_entries";
    evidenceId: string | null;
  }>;
  refundMismatches: Array<{ refundId: string; amountMinor: number; allocatedMinor: number }>;
  payoutItemMismatches: Array<{ payoutItemId: string; reason: string; expectedAmountMinor: number; actualAmountMinor: number | null; journalId: string | null }>;
  payoutBatchMismatches: Array<{ batchId: string; expectedItemCount: number; actualItemCount: number; expectedTotalMinor: number; actualTotalMinor: number }>;
  projectionMismatches: Array<{
    vendorId: string;
    currency: string;
    reason: string;
    expected: {
      vendorId: string;
      currency: string;
      pendingMinor: number;
      availableMinor: number;
      reservedMinor: number;
      paidMinor: number;
      debtMinor: number;
      lastJournalId: string;
      version: number;
    } | null;
    actual: {
      vendorId: string;
      currency: string;
      pendingMinor: number;
      availableMinor: number;
      reservedMinor: number;
      paidMinor: number;
      debtMinor: number;
      lastJournalId: string;
      version: number;
    } | null;
  }>;
}

export interface MarketplacePayoutWorkflowResult {
  payoutItemId: string;
  status: string;
  amountMinor?: number;
  journalId?: string;
  attemptId?: string;
  attemptNumber?: number;
}

export type MarketplacePayoutStatus =
  | "draft"
  | "reserved"
  | "processing"
  | "completed"
  | "failed"
  | "released"
  | "cancelled";

export interface MarketplacePayoutRow {
  id: string;
  batchId: string;
  vendorId: string;
  vendorName: string;
  payoutMethodId: string;
  payoutMethod: "bank" | "bkash" | "nagad" | "rocket" | "manual";
  payoutMethodDisplayName: string;
  payoutMethodLastFour: string | null;
  currency: string;
  amountMinor: number;
  status: MarketplacePayoutStatus;
  providerReference: string | null;
  failureReason: string | null;
  version: number;
  reservedAt: ApiTimestamp;
  processingStartedAt: ApiTimestamp;
  completedAt: ApiTimestamp;
  releasedAt: ApiTimestamp;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

export interface MarketplacePayoutListPayload {
  payouts: MarketplacePayoutRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface MarketplacePayoutMethodReviewRow {
  id: string;
  vendorId: string;
  vendorName: string;
  method: "bank" | "bkash" | "nagad" | "rocket" | "manual";
  displayName: string;
  lastFour: string | null;
  providerName: string | null;
  isDefault: boolean;
  status: "pending" | "verified" | "rejected" | "disabled";
  verifiedBy: string | null;
  verifiedAt: ApiTimestamp | null;
  rejectionReason: string | null;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

export interface MarketplacePayoutMethodListPayload {
  payoutMethods: MarketplacePayoutMethodReviewRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface MarketplacePayoutPreview {
  vendorId: string;
  currency: string;
  minimumPayoutMinor: number;
  eligibleMinor: number;
  balance: {
    pendingMinor: number;
    availableMinor: number;
    reservedMinor: number;
    paidMinor: number;
    debtMinor: number;
    payoutEligibleMinor: number;
  };
  payoutMethod: {
    id: string;
    method: "bank" | "bkash" | "nagad" | "rocket" | "manual";
    displayName: string;
    lastFour: string | null;
    providerName: string | null;
  };
}

export const getMarketplaceReconciliation = createServerFn({ method: "GET" })
  .handler(async (): Promise<MarketplaceReconciliation> =>
    apiGet<MarketplaceReconciliation>("/marketplace-finance/reconciliation"));

export const rebuildMarketplaceProjections = createServerFn({ method: "POST" })
  .handler(async (): Promise<{ rebuild: { vendors: number; entries: number }; reconciliation: MarketplaceReconciliation }> =>
    apiPost("/marketplace-finance/projections/rebuild"));

export const processMarketplaceOutbox = createServerFn({ method: "POST" })
  .validator((data: { limit?: number }) => data)
  .handler(async ({ data }): Promise<{ processed: number; failed: number; dead: number; skipped: number }> =>
    apiPost("/marketplace-finance/outbox/process", { limit: data.limit ?? 20 }));

export const sweepMarketplaceSettlements = createServerFn({ method: "POST" })
  .validator((data: { limit?: number }) => data)
  .handler(async ({ data }): Promise<{ scanned: number; released: number; replayed: number; skipped: number; failed: number }> =>
    apiPost("/marketplace-finance/settlements/sweep", { limit: data.limit ?? 20 }));

export const releaseMarketplaceSettlement = createServerFn({ method: "POST" })
  .validator((data: { vendorOrderId: string }) => data)
  .handler(async ({ data }): Promise<{
    released: true;
    replayed: boolean;
    journalId: string;
    vendorOrderId: string;
    vendorId: string;
    currency: string;
    amountMinor: number;
  }> => apiPost(`/marketplace-finance/settlements/${encodeURIComponent(data.vendorOrderId)}/release`));

export const previewMarketplacePayout = createServerFn({ method: "POST" })
  .validator((data: { vendorId: string; currency: string; payoutMethodId?: string }) => data)
  .handler(async ({ data }): Promise<MarketplacePayoutPreview> =>
    apiPost("/marketplace-finance/payouts/preview", data));

export const reserveMarketplacePayout = createServerFn({ method: "POST" })
  .validator((data: { idempotencyKey: string; vendorId: string; currency: string; amountMinor?: number; payoutMethodId?: string; notes?: string }) => data)
  .handler(async ({ data }): Promise<{
    replayed: boolean;
    batchId: string;
    payoutItemId: string;
    journalId: string;
    vendorId: string;
    currency: string;
    amountMinor: number;
    status: "reserved";
  }> => apiPost("/marketplace-finance/payouts/reserve", data));

export const getMarketplacePayoutMethods = createServerFn({ method: "GET" })
  .validator((data: {
    vendorId?: string;
    status?: MarketplacePayoutMethodReviewRow["status"];
    page?: number;
    limit?: number;
  }) => data)
  .handler(async ({ data }): Promise<MarketplacePayoutMethodListPayload> => {
    const params: Record<string, string> = {};
    if (data.vendorId) params.vendorId = data.vendorId;
    if (data.status) params.status = data.status;
    if (data.page != null) params.page = String(data.page);
    if (data.limit != null) params.limit = String(data.limit);
    return apiGet<MarketplacePayoutMethodListPayload>(
      "/marketplace-finance/payout-methods",
      params,
    );
  });

export const moderateMarketplacePayoutMethod = createServerFn({ method: "POST" })
  .validator((data: {
    methodId: string;
    status: "verified" | "rejected";
    reason?: string | null;
  }) => data)
  .handler(async ({ data }): Promise<{ id: string; status: "verified" | "rejected" }> =>
    apiPatch(
      `/marketplace-finance/payout-methods/${encodeURIComponent(data.methodId)}/status`,
      { status: data.status, reason: data.reason },
    ));

export const getMarketplacePayouts = createServerFn({ method: "GET" })
  .validator((data: { vendorId?: string; status?: MarketplacePayoutStatus; page?: number; limit?: number }) => data)
  .handler(async ({ data }): Promise<MarketplacePayoutListPayload> => {
    const params: Record<string, string> = {};
    if (data.vendorId) params.vendorId = data.vendorId;
    if (data.status) params.status = data.status;
    if (data.page != null) params.page = String(data.page);
    if (data.limit != null) params.limit = String(data.limit);
    return apiGet<MarketplacePayoutListPayload>("/marketplace-finance/payouts", params);
  });

export const claimMarketplacePayout = createServerFn({ method: "POST" })
  .validator((data: { payoutItemId: string; provider: string }) => data)
  .handler(async ({ data }): Promise<MarketplacePayoutWorkflowResult> => apiPost(
    `/marketplace-finance/payouts/${encodeURIComponent(data.payoutItemId)}/claim`,
    { provider: data.provider },
  ));

export const completeMarketplacePayout = createServerFn({ method: "POST" })
  .validator((data: { payoutItemId: string; providerReference: string }) => data)
  .handler(async ({ data }): Promise<MarketplacePayoutWorkflowResult> => apiPost(
    `/marketplace-finance/payouts/${encodeURIComponent(data.payoutItemId)}/complete`,
    { providerReference: data.providerReference },
  ));

export const releaseMarketplacePayout = createServerFn({ method: "POST" })
  .validator((data: { payoutItemId: string; reason: string; errorMessage?: string }) => data)
  .handler(async ({ data }): Promise<MarketplacePayoutWorkflowResult> => apiPost(
    `/marketplace-finance/payouts/${encodeURIComponent(data.payoutItemId)}/release`,
    { reason: data.reason, errorMessage: data.errorMessage },
  ));
