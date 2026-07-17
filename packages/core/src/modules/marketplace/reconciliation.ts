import type { Database } from "@scalius/database/client";
import {
    domainOutboxEvents,
    marketplaceLedgerEntries,
    marketplaceLedgerJournals,
    orderPayments,
    payoutBatches,
    payoutItems,
    refundItems,
    refunds,
    vendorBalanceProjections,
} from "@scalius/database/schema";
import { eq, inArray } from "drizzle-orm";
import {
    buildVendorBalanceProjections,
    type VendorBalanceProjectionDraft,
    type VendorLedgerProjectionEntry,
} from "./balance-projection";

export interface LedgerBalanceInput {
    journalId: string;
    debitMinor: number;
    creditMinor: number;
}

export interface LedgerBalanceMismatch {
    journalId: string;
    debitMinor: number;
    creditMinor: number;
    invalidEntrySides: number;
}

export function findLedgerBalanceMismatches(
    entries: LedgerBalanceInput[],
): LedgerBalanceMismatch[] {
    const journals = new Map<string, LedgerBalanceMismatch>();
    for (const entry of entries) {
        const journal = journals.get(entry.journalId) ?? {
            journalId: entry.journalId,
            debitMinor: 0,
            creditMinor: 0,
            invalidEntrySides: 0,
        };
        const validDebit = Number.isSafeInteger(entry.debitMinor) && entry.debitMinor >= 0;
        const validCredit = Number.isSafeInteger(entry.creditMinor) && entry.creditMinor >= 0;
        const exactlyOneSide =
            validDebit &&
            validCredit &&
            ((entry.debitMinor > 0 && entry.creditMinor === 0) ||
                (entry.creditMinor > 0 && entry.debitMinor === 0));
        if (!exactlyOneSide) journal.invalidEntrySides += 1;
        if (validDebit) journal.debitMinor += entry.debitMinor;
        if (validCredit) journal.creditMinor += entry.creditMinor;
        journals.set(entry.journalId, journal);
    }

    return Array.from(journals.values())
        .filter(
            (journal) =>
                journal.debitMinor !== journal.creditMinor || journal.invalidEntrySides > 0,
        )
        .sort((left, right) => left.journalId.localeCompare(right.journalId));
}

export interface RefundParentInput {
    refundId: string;
    amountMinor: number;
}

export interface RefundItemAmountInput {
    refundId: string;
    refundAmountMinor: number;
}

export interface RefundAllocationMismatch {
    refundId: string;
    amountMinor: number;
    allocatedMinor: number;
}

export function findRefundAllocationMismatches(
    parents: RefundParentInput[],
    items: RefundItemAmountInput[],
): RefundAllocationMismatch[] {
    const totals = new Map<string, number>();
    for (const item of items) {
        if (!Number.isSafeInteger(item.refundAmountMinor) || item.refundAmountMinor < 0) {
            throw new Error(`Refund item amount for ${item.refundId} is invalid.`);
        }
        totals.set(item.refundId, (totals.get(item.refundId) ?? 0) + item.refundAmountMinor);
    }

    return parents
        .map((refund) => ({
            refundId: refund.refundId,
            amountMinor: refund.amountMinor,
            allocatedMinor: totals.get(refund.refundId) ?? 0,
        }))
        .filter((refund) => refund.amountMinor !== refund.allocatedMinor)
        .sort((left, right) => left.refundId.localeCompare(right.refundId));
}

export interface SuccessfulFinancialEventInput {
    sourceKind: "payment" | "refund";
    sourceId: string;
    currency: string;
}

export interface FinancialEventOutboxEvidenceInput {
    outboxId: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    status: string;
}

export interface FinancialEventJournalEvidenceInput {
    journalId: string;
    eventType: string;
    sourceType: string;
    sourceId: string;
    currency: string;
    orderPaymentId: string | null;
    refundId: string | null;
    hasEntries: boolean;
}

export interface FinancialEventEvidenceMismatch {
    sourceKind: "payment" | "refund";
    sourceId: string;
    eventType: "payment.captured" | "refund.completed";
    reason:
        | "missing_outbox"
        | "failed_outbox"
        | "dead_outbox"
        | "missing_journal"
        | "journal_contract_mismatch"
        | "journal_missing_entries";
    evidenceId: string | null;
}

function expectedFinancialEventContract(event: SuccessfulFinancialEventInput) {
    return event.sourceKind === "payment"
        ? {
            eventType: "payment.captured" as const,
            aggregateType: "order_payment",
            sourceType: "order_payment",
            directReference: "orderPaymentId" as const,
        }
        : {
            eventType: "refund.completed" as const,
            aggregateType: "refund",
            sourceType: "refund",
            directReference: "refundId" as const,
        };
}

export function findFinancialEventEvidenceMismatches(
    events: SuccessfulFinancialEventInput[],
    outboxRows: FinancialEventOutboxEvidenceInput[],
    journals: FinancialEventJournalEvidenceInput[],
): FinancialEventEvidenceMismatch[] {
    const mismatches: FinancialEventEvidenceMismatch[] = [];

    for (const event of events) {
        const contract = expectedFinancialEventContract(event);
        const outbox = outboxRows.find((row) =>
            row.aggregateType === contract.aggregateType &&
            row.aggregateId === event.sourceId &&
            row.eventType === contract.eventType
        ) ?? null;
        if (!outbox) {
            mismatches.push({
                sourceKind: event.sourceKind,
                sourceId: event.sourceId,
                eventType: contract.eventType,
                reason: "missing_outbox",
                evidenceId: null,
            });
        } else if (outbox.status === "failed" || outbox.status === "dead") {
            mismatches.push({
                sourceKind: event.sourceKind,
                sourceId: event.sourceId,
                eventType: contract.eventType,
                reason: outbox.status === "dead" ? "dead_outbox" : "failed_outbox",
                evidenceId: outbox.outboxId,
            });
        }

        const candidates = journals.filter((journal) =>
            (journal.sourceType === contract.sourceType && journal.sourceId === event.sourceId) ||
            journal[contract.directReference] === event.sourceId
        );
        const validJournal = candidates.find((journal) =>
            journal.eventType === contract.eventType &&
            journal.currency === event.currency &&
            journal[contract.directReference] === event.sourceId &&
            journal.hasEntries
        );
        if (validJournal) continue;

        const candidate = candidates[0] ?? null;
        if (candidate) {
            const contractFieldsMatch =
                candidate.eventType === contract.eventType &&
                candidate.currency === event.currency &&
                candidate[contract.directReference] === event.sourceId;
            mismatches.push({
                sourceKind: event.sourceKind,
                sourceId: event.sourceId,
                eventType: contract.eventType,
                reason: contractFieldsMatch && !candidate.hasEntries
                    ? "journal_missing_entries"
                    : "journal_contract_mismatch",
                evidenceId: candidate.journalId,
            });
            continue;
        }

        const journalShouldExist = !outbox || outbox.status === "processed" || outbox.status === "dead";
        if (journalShouldExist) {
            mismatches.push({
                sourceKind: event.sourceKind,
                sourceId: event.sourceId,
                eventType: contract.eventType,
                reason: "missing_journal",
                evidenceId: null,
            });
        }
    }

    return mismatches.sort((left, right) =>
        left.sourceKind.localeCompare(right.sourceKind) ||
        left.sourceId.localeCompare(right.sourceId) ||
        left.reason.localeCompare(right.reason)
    );
}

export interface ProjectionMismatch {
    vendorId: string;
    currency: string;
    reason: "missing_projection" | "unexpected_projection" | "values_differ";
    expected: VendorBalanceProjectionDraft | null;
    actual: VendorBalanceProjectionDraft | null;
}

function projectionKey(value: Pick<VendorBalanceProjectionDraft, "vendorId" | "currency">): string {
    return `${value.vendorId}\u0000${value.currency}`;
}

function sameProjection(
    expected: VendorBalanceProjectionDraft,
    actual: VendorBalanceProjectionDraft,
): boolean {
    return expected.pendingMinor === actual.pendingMinor &&
        expected.availableMinor === actual.availableMinor &&
        expected.reservedMinor === actual.reservedMinor &&
        expected.paidMinor === actual.paidMinor &&
        expected.debtMinor === actual.debtMinor &&
        expected.lastJournalId === actual.lastJournalId &&
        expected.version === actual.version;
}

export function findProjectionMismatches(
    expected: VendorBalanceProjectionDraft[],
    actual: VendorBalanceProjectionDraft[],
): ProjectionMismatch[] {
    const expectedByKey = new Map(expected.map((projection) => [projectionKey(projection), projection]));
    const actualByKey = new Map(actual.map((projection) => [projectionKey(projection), projection]));
    const keys = Array.from(new Set([...expectedByKey.keys(), ...actualByKey.keys()])).sort();

    return keys.flatMap((key): ProjectionMismatch[] => {
        const expectedProjection = expectedByKey.get(key) ?? null;
        const actualProjection = actualByKey.get(key) ?? null;
        const source = expectedProjection ?? actualProjection;
        if (!source) return [];
        if (!actualProjection) {
            return [{
                vendorId: source.vendorId,
                currency: source.currency,
                reason: "missing_projection",
                expected: expectedProjection,
                actual: null,
            }];
        }
        if (!expectedProjection) {
            return [{
                vendorId: source.vendorId,
                currency: source.currency,
                reason: "unexpected_projection",
                expected: null,
                actual: actualProjection,
            }];
        }
        if (!sameProjection(expectedProjection, actualProjection)) {
            return [{
                vendorId: source.vendorId,
                currency: source.currency,
                reason: "values_differ",
                expected: expectedProjection,
                actual: actualProjection,
            }];
        }
        return [];
    });
}

export interface PayoutItemReconciliationInput {
    payoutItemId: string;
    status: string;
    amountMinor: number;
    reservationJournalId: string | null;
    completionJournalId: string | null;
    releaseJournalId: string | null;
}

export interface PayoutJournalReconciliationInput {
    journalId: string;
    eventType: string;
    payoutId: string | null;
    amountMinor: number;
}

export interface PayoutItemMismatch {
    payoutItemId: string;
    reason:
        | "missing_reservation_journal"
        | "reservation_journal_mismatch"
        | "missing_completion_journal"
        | "completion_journal_mismatch"
        | "missing_release_journal"
        | "release_journal_mismatch";
    expectedAmountMinor: number;
    actualAmountMinor: number | null;
    journalId: string | null;
}

function payoutJournalMismatch(
    item: PayoutItemReconciliationInput,
    journalsById: Map<string, PayoutJournalReconciliationInput>,
    params: {
        referenceId: string | null;
        eventType: string;
        missingReason: PayoutItemMismatch["reason"];
        mismatchReason: PayoutItemMismatch["reason"];
    },
): PayoutItemMismatch | null {
    if (!params.referenceId) {
        return {
            payoutItemId: item.payoutItemId,
            reason: params.missingReason,
            expectedAmountMinor: item.amountMinor,
            actualAmountMinor: null,
            journalId: null,
        };
    }
    const journal = journalsById.get(params.referenceId);
    if (
        !journal ||
        journal.eventType !== params.eventType ||
        journal.payoutId !== item.payoutItemId ||
        journal.amountMinor !== item.amountMinor
    ) {
        return {
            payoutItemId: item.payoutItemId,
            reason: params.mismatchReason,
            expectedAmountMinor: item.amountMinor,
            actualAmountMinor: journal?.amountMinor ?? null,
            journalId: params.referenceId,
        };
    }
    return null;
}

export function findPayoutItemMismatches(
    items: PayoutItemReconciliationInput[],
    journals: PayoutJournalReconciliationInput[],
): PayoutItemMismatch[] {
    const journalsById = new Map(journals.map((journal) => [journal.journalId, journal]));
    const mismatches: PayoutItemMismatch[] = [];
    for (const item of items) {
        if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0) {
            throw new Error(`Payout item amount for ${item.payoutItemId} is invalid.`);
        }
        if (["reserved", "processing", "completed", "released"].includes(item.status)) {
            const mismatch = payoutJournalMismatch(item, journalsById, {
                referenceId: item.reservationJournalId,
                eventType: "payout.requested",
                missingReason: "missing_reservation_journal",
                mismatchReason: "reservation_journal_mismatch",
            });
            if (mismatch) mismatches.push(mismatch);
        }
        if (item.status === "completed") {
            const mismatch = payoutJournalMismatch(item, journalsById, {
                referenceId: item.completionJournalId,
                eventType: "payout.completed",
                missingReason: "missing_completion_journal",
                mismatchReason: "completion_journal_mismatch",
            });
            if (mismatch) mismatches.push(mismatch);
        }
        if (item.status === "released") {
            const mismatch = payoutJournalMismatch(item, journalsById, {
                referenceId: item.releaseJournalId,
                eventType: "payout.released",
                missingReason: "missing_release_journal",
                mismatchReason: "release_journal_mismatch",
            });
            if (mismatch) mismatches.push(mismatch);
        }
    }
    return mismatches.sort(
        (left, right) =>
            left.payoutItemId.localeCompare(right.payoutItemId) ||
            left.reason.localeCompare(right.reason),
    );
}

export interface PayoutBatchReconciliationInput {
    batchId: string;
    itemCount: number;
    totalMinor: number;
}

export interface PayoutBatchItemAmountInput {
    batchId: string;
    amountMinor: number;
}

export interface PayoutBatchMismatch {
    batchId: string;
    expectedItemCount: number;
    actualItemCount: number;
    expectedTotalMinor: number;
    actualTotalMinor: number;
}

export function findPayoutBatchMismatches(
    batches: PayoutBatchReconciliationInput[],
    items: PayoutBatchItemAmountInput[],
): PayoutBatchMismatch[] {
    const totals = new Map<string, { itemCount: number; totalMinor: number }>();
    for (const item of items) {
        const current = totals.get(item.batchId) ?? { itemCount: 0, totalMinor: 0 };
        current.itemCount += 1;
        current.totalMinor += item.amountMinor;
        totals.set(item.batchId, current);
    }
    return batches
        .map((batch) => {
            const actual = totals.get(batch.batchId) ?? { itemCount: 0, totalMinor: 0 };
            return {
                batchId: batch.batchId,
                expectedItemCount: batch.itemCount,
                actualItemCount: actual.itemCount,
                expectedTotalMinor: batch.totalMinor,
                actualTotalMinor: actual.totalMinor,
            };
        })
        .filter(
            (batch) =>
                batch.expectedItemCount !== batch.actualItemCount ||
                batch.expectedTotalMinor !== batch.actualTotalMinor,
        )
        .sort((left, right) => left.batchId.localeCompare(right.batchId));
}

export interface MarketplaceFinanceReconciliationReport {
    healthy: boolean;
    checkedAt: Date;
    ledgerEntries: number;
    payments: number;
    refunds: number;
    payouts: number;
    payoutBatches: number;
    projections: number;
    ledgerMismatches: LedgerBalanceMismatch[];
    financialEventMismatches: FinancialEventEvidenceMismatch[];
    refundMismatches: RefundAllocationMismatch[];
    payoutItemMismatches: PayoutItemMismatch[];
    payoutBatchMismatches: PayoutBatchMismatch[];
    projectionMismatches: ProjectionMismatch[];
}

export async function getMarketplaceFinanceReconciliation(
    db: Database,
    checkedAt = new Date(),
): Promise<MarketplaceFinanceReconciliationReport> {
    const ledgerRows = await db
        .select({
            journalId: marketplaceLedgerEntries.journalId,
            vendorId: marketplaceLedgerEntries.vendorId,
            currency: marketplaceLedgerJournals.currency,
            eventType: marketplaceLedgerJournals.eventType,
            payoutId: marketplaceLedgerJournals.payoutId,
            accountCode: marketplaceLedgerEntries.accountCode,
            debitMinor: marketplaceLedgerEntries.debitMinor,
            creditMinor: marketplaceLedgerEntries.creditMinor,
            postedAt: marketplaceLedgerJournals.postedAt,
        })
        .from(marketplaceLedgerEntries)
        .innerJoin(
            marketplaceLedgerJournals,
            eq(marketplaceLedgerJournals.id, marketplaceLedgerEntries.journalId),
        )
        .all();

    const successfulPaymentRows = await db
        .select({
            paymentId: orderPayments.id,
            currency: orderPayments.currency,
        })
        .from(orderPayments)
        .where(eq(orderPayments.status, "confirmed"))
        .all();
    const refundParents = await db
        .select({
            refundId: refunds.id,
            amountMinor: refunds.amountMinor,
            status: refunds.status,
            currency: refunds.currency,
        })
        .from(refunds)
        .all();
    const refundItemRows = await db
        .select({
            refundId: refundItems.refundId,
            refundAmountMinor: refundItems.refundAmountMinor,
        })
        .from(refundItems)
        .all();
    const financialOutboxRows = await db
        .select({
            outboxId: domainOutboxEvents.id,
            aggregateType: domainOutboxEvents.aggregateType,
            aggregateId: domainOutboxEvents.aggregateId,
            eventType: domainOutboxEvents.eventType,
            status: domainOutboxEvents.status,
        })
        .from(domainOutboxEvents)
        .where(inArray(domainOutboxEvents.eventType, ["payment.captured", "refund.completed"]))
        .all();
    const financialJournalRows = await db
        .select({
            journalId: marketplaceLedgerJournals.id,
            eventType: marketplaceLedgerJournals.eventType,
            sourceType: marketplaceLedgerJournals.sourceType,
            sourceId: marketplaceLedgerJournals.sourceId,
            currency: marketplaceLedgerJournals.currency,
            orderPaymentId: marketplaceLedgerJournals.orderPaymentId,
            refundId: marketplaceLedgerJournals.refundId,
        })
        .from(marketplaceLedgerJournals)
        .where(inArray(marketplaceLedgerJournals.eventType, ["payment.captured", "refund.completed"]))
        .all();
    const payoutItemRows = await db
        .select({
            payoutItemId: payoutItems.id,
            batchId: payoutItems.batchId,
            status: payoutItems.status,
            amountMinor: payoutItems.amountMinor,
            reservationJournalId: payoutItems.reservationJournalId,
            completionJournalId: payoutItems.completionJournalId,
            releaseJournalId: payoutItems.releaseJournalId,
        })
        .from(payoutItems)
        .all();
    const payoutBatchRows = await db
        .select({
            batchId: payoutBatches.id,
            itemCount: payoutBatches.itemCount,
            totalMinor: payoutBatches.totalMinor,
        })
        .from(payoutBatches)
        .all();
    const actualProjections = await db
        .select({
            vendorId: vendorBalanceProjections.vendorId,
            currency: vendorBalanceProjections.currency,
            pendingMinor: vendorBalanceProjections.pendingMinor,
            availableMinor: vendorBalanceProjections.availableMinor,
            reservedMinor: vendorBalanceProjections.reservedMinor,
            paidMinor: vendorBalanceProjections.paidMinor,
            debtMinor: vendorBalanceProjections.debtMinor,
            lastJournalId: vendorBalanceProjections.lastJournalId,
            version: vendorBalanceProjections.version,
        })
        .from(vendorBalanceProjections)
        .all();

    const ledgerMismatches = findLedgerBalanceMismatches(ledgerRows);
    const successfulFinancialEvents: SuccessfulFinancialEventInput[] = [
        ...successfulPaymentRows.map((payment) => ({
            sourceKind: "payment" as const,
            sourceId: payment.paymentId,
            currency: payment.currency,
        })),
        ...refundParents
            .filter((refund) => refund.status === "completed")
            .map((refund) => ({
                sourceKind: "refund" as const,
                sourceId: refund.refundId,
                currency: refund.currency,
            })),
    ];
    const journalIdsWithEntries = new Set(ledgerRows.map((entry) => entry.journalId));
    const financialEventMismatches = findFinancialEventEvidenceMismatches(
        successfulFinancialEvents,
        financialOutboxRows,
        financialJournalRows.map((journal) => ({
            ...journal,
            hasEntries: journalIdsWithEntries.has(journal.journalId),
        })),
    );
    const refundMismatches = findRefundAllocationMismatches(refundParents, refundItemRows);
    const payoutJournalMap = new Map<string, PayoutJournalReconciliationInput>();
    for (const row of ledgerRows) {
        if (!row.payoutId) continue;
        const targetAccount = row.eventType === "payout.requested"
            ? "vendor_payout_reserved"
            : row.eventType === "payout.completed"
                ? "vendor_paid"
                : row.eventType === "payout.released"
                    ? "vendor_available_payable"
                    : null;
        if (!targetAccount || row.accountCode !== targetAccount) continue;
        const existing = payoutJournalMap.get(row.journalId) ?? {
            journalId: row.journalId,
            eventType: row.eventType,
            payoutId: row.payoutId,
            amountMinor: 0,
        };
        existing.amountMinor += row.creditMinor - row.debitMinor;
        payoutJournalMap.set(row.journalId, existing);
    }
    const payoutItemMismatches = findPayoutItemMismatches(
        payoutItemRows,
        [...payoutJournalMap.values()],
    );
    const payoutBatchMismatches = findPayoutBatchMismatches(
        payoutBatchRows,
        payoutItemRows,
    );
    const expectedProjections = buildVendorBalanceProjections(
        ledgerRows as VendorLedgerProjectionEntry[],
    );
    const normalizedActualProjections = actualProjections.map((projection) => ({
        ...projection,
        lastJournalId: projection.lastJournalId ?? "",
    }));
    const projectionMismatches = findProjectionMismatches(
        expectedProjections,
        normalizedActualProjections,
    );

    return {
        healthy:
            ledgerMismatches.length === 0 &&
            financialEventMismatches.length === 0 &&
            refundMismatches.length === 0 &&
            payoutItemMismatches.length === 0 &&
            payoutBatchMismatches.length === 0 &&
            projectionMismatches.length === 0,
        checkedAt,
        ledgerEntries: ledgerRows.length,
        payments: successfulPaymentRows.length,
        refunds: refundParents.length,
        payouts: payoutItemRows.length,
        payoutBatches: payoutBatchRows.length,
        projections: actualProjections.length,
        ledgerMismatches,
        financialEventMismatches,
        refundMismatches,
        payoutItemMismatches,
        payoutBatchMismatches,
        projectionMismatches,
    };
}
