import { safeBatch, type Database } from "@scalius/database/client";
import {
    marketplaceLedgerEntries,
    marketplaceLedgerJournals,
    orderPayments,
    refunds,
    vendorOrders,
    vendors,
} from "@scalius/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { rebuildVendorBalanceProjections } from "./balance-projection";
import { buildSettlementReleasedJournal } from "./ledger";
import {
    buildMarketplaceJournalStatements,
    type BuildMarketplaceJournalStatementsOptions,
} from "./ledger-store";
import { minorUnits } from "./money";
import {
    createDomainOutboxInsertStatement,
    type BuildDomainOutboxEventInput,
} from "./outbox";

export function isSettlementEligibleAt(
    deliveredAt: Date,
    holdDays: number,
    now = new Date(),
): boolean {
    if (!(deliveredAt instanceof Date) || Number.isNaN(deliveredAt.getTime())) return false;
    if (!Number.isInteger(holdDays) || holdDays < 0 || holdDays > 3650) return false;
    return deliveredAt.getTime() + holdDays * 86_400_000 <= now.getTime();
}

export interface ReleaseVendorOrderSettlementInput {
    vendorOrderId: string;
    now?: Date;
}

export interface ReleaseVendorOrderSettlementResult {
    released: true;
    replayed: boolean;
    journalId: string;
    vendorOrderId: string;
    vendorId: string;
    currency: string;
    amountMinor: number;
}

export interface SettlementDependencies {
    buildJournalStatements?: (
        db: Database,
        journal: ReturnType<typeof buildSettlementReleasedJournal>,
        options?: BuildMarketplaceJournalStatementsOptions,
    ) => Promise<{
        journalId: string;
        contentHash: string;
        statements: BatchItem<"sqlite">[];
    }>;
    createOutboxStatement?: (
        db: Database,
        input: BuildDomainOutboxEventInput,
    ) => BatchItem<"sqlite">;
    rebuildProjections?: typeof rebuildVendorBalanceProjections;
}

function toDate(value: Date | number | null): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "number" && Number.isFinite(value)) {
        const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

export async function releaseVendorOrderSettlement(
    db: Database,
    input: ReleaseVendorOrderSettlementInput,
    dependencies: SettlementDependencies = {},
): Promise<ReleaseVendorOrderSettlementResult> {
    if (!input.vendorOrderId?.trim()) throw new ValidationError("Vendor order ID is required");
    const now = input.now ?? new Date();

    const existing = await db
        .select({
            id: marketplaceLedgerJournals.id,
            currency: marketplaceLedgerJournals.currency,
            vendorId: marketplaceLedgerEntries.vendorId,
            amountMinor: marketplaceLedgerEntries.creditMinor,
        })
        .from(marketplaceLedgerJournals)
        .innerJoin(
            marketplaceLedgerEntries,
            eq(marketplaceLedgerEntries.journalId, marketplaceLedgerJournals.id),
        )
        .where(and(
            eq(marketplaceLedgerJournals.eventType, "settlement.released"),
            eq(marketplaceLedgerJournals.sourceType, "vendor_order"),
            eq(marketplaceLedgerJournals.sourceId, input.vendorOrderId),
            eq(marketplaceLedgerEntries.accountCode, "vendor_available_payable"),
        ))
        .get();
    if (existing) {
        return {
            released: true,
            replayed: true,
            journalId: existing.id,
            vendorOrderId: input.vendorOrderId,
            vendorId: existing.vendorId ?? "",
            currency: existing.currency,
            amountMinor: existing.amountMinor ?? 0,
        };
    }

    const candidate = await db
        .select({
            vendorOrderId: vendorOrders.id,
            orderId: vendorOrders.orderId,
            vendorId: vendorOrders.vendorId,
            status: vendorOrders.status,
            deliveredAt: vendorOrders.deliveredAt,
            settlementHoldDays: vendors.settlementHoldDays,
            vendorStatus: vendors.status,
            vendorDeletedAt: vendors.deletedAt,
        })
        .from(vendorOrders)
        .innerJoin(vendors, eq(vendors.id, vendorOrders.vendorId))
        .where(eq(vendorOrders.id, input.vendorOrderId))
        .get();
    if (!candidate) throw new NotFoundError(`Vendor order ${input.vendorOrderId} not found`);
    const deliveredAt = toDate(candidate.deliveredAt);
    if (
        candidate.status !== "delivered" ||
        !deliveredAt ||
        candidate.vendorStatus !== "approved" ||
        candidate.vendorDeletedAt != null ||
        !isSettlementEligibleAt(deliveredAt, candidate.settlementHoldDays, now)
    ) {
        throw new ValidationError("Vendor order is not eligible for settlement release");
    }

    const pendingRefundPayment = await db
        .select({ id: orderPayments.id })
        .from(orderPayments)
        .where(and(
            eq(orderPayments.orderId, candidate.orderId),
            eq(orderPayments.paymentType, "refund"),
            eq(orderPayments.status, "pending"),
        ))
        .get();
    if (pendingRefundPayment) {
        throw new ConflictError("Settlement is blocked while a refund is pending");
    }
    const pendingNormalizedRefund = await db
        .select({ id: refunds.id })
        .from(refunds)
        .where(and(
            eq(refunds.orderId, candidate.orderId),
            inArray(refunds.status, ["pending", "processing"]),
        ))
        .get();
    if (pendingNormalizedRefund) {
        throw new ConflictError("Settlement is blocked while a refund is pending");
    }

    const ledgerRows = await db
        .select({
            currency: marketplaceLedgerJournals.currency,
            debitMinor: marketplaceLedgerEntries.debitMinor,
            creditMinor: marketplaceLedgerEntries.creditMinor,
        })
        .from(marketplaceLedgerEntries)
        .innerJoin(
            marketplaceLedgerJournals,
            eq(marketplaceLedgerJournals.id, marketplaceLedgerEntries.journalId),
        )
        .where(and(
            eq(marketplaceLedgerEntries.vendorId, candidate.vendorId),
            eq(marketplaceLedgerEntries.vendorOrderId, candidate.vendorOrderId),
            eq(marketplaceLedgerEntries.accountCode, "vendor_pending_payable"),
        ))
        .all();

    const byCurrency = new Map<string, number>();
    for (const row of ledgerRows) {
        byCurrency.set(
            row.currency,
            (byCurrency.get(row.currency) ?? 0) + row.creditMinor - row.debitMinor,
        );
    }
    const positiveBalances = [...byCurrency.entries()].filter(([, amount]) => amount > 0);
    if (positiveBalances.length !== 1) {
        throw new ValidationError("Vendor order must have exactly one positive pending settlement balance");
    }
    const [currency, amountMinor] = positiveBalances[0]!;
    if (!Number.isSafeInteger(amountMinor)) {
        throw new ValidationError("Settlement amount exceeds safe integer range");
    }

    const releaseId = `${candidate.vendorOrderId}:${currency}`;
    const journal = buildSettlementReleasedJournal({
        releaseId,
        vendorId: candidate.vendorId,
        vendorOrderId: candidate.vendorOrderId,
        currency,
        amountMinor: minorUnits(amountMinor),
        occurredAt: now,
    });
    const buildJournalStatements =
        dependencies.buildJournalStatements ?? buildMarketplaceJournalStatements;
    const journalBundle = await buildJournalStatements(db, journal, {
        conflictMode: "error",
        createdAt: now,
    });
    const createOutboxStatement =
        dependencies.createOutboxStatement ?? createDomainOutboxInsertStatement;
    const outboxStatement = createOutboxStatement(db, {
        eventKey: journal.idempotencyKey,
        aggregateType: "settlement",
        aggregateId: releaseId,
        eventType: "settlement.released",
        payload: {
            releaseId,
            vendorOrderId: candidate.vendorOrderId,
            vendorId: candidate.vendorId,
            currency,
            amountMinor,
            journalId: journalBundle.journalId,
        },
        createdAt: now,
    });

    try {
        await safeBatch(db, [...journalBundle.statements, outboxStatement]);
    } catch (error: unknown) {
        const replay = await db
            .select({ id: marketplaceLedgerJournals.id })
            .from(marketplaceLedgerJournals)
            .where(eq(marketplaceLedgerJournals.idempotencyKey, journal.idempotencyKey))
            .get();
        if (replay) {
            return {
                released: true,
                replayed: true,
                journalId: replay.id,
                vendorOrderId: candidate.vendorOrderId,
                vendorId: candidate.vendorId,
                currency,
                amountMinor,
            };
        }
        throw error;
    }

    const rebuildProjections = dependencies.rebuildProjections ?? rebuildVendorBalanceProjections;
    await rebuildProjections(db, now);
    return {
        released: true,
        replayed: false,
        journalId: journalBundle.journalId,
        vendorOrderId: candidate.vendorOrderId,
        vendorId: candidate.vendorId,
        currency,
        amountMinor,
    };
}
