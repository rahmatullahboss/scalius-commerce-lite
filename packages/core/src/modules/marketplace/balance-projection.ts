import { safeBatch, type Database } from "@scalius/database/client";
import {
    marketplaceLedgerEntries,
    marketplaceLedgerJournals,
    vendorBalanceProjections,
} from "@scalius/database/schema";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { MarketplaceLedgerAccountCode } from "./ledger";

export interface VendorLedgerProjectionEntry {
    journalId: string;
    vendorId: string | null;
    currency: string;
    accountCode: MarketplaceLedgerAccountCode;
    debitMinor: number;
    creditMinor: number;
    postedAt: Date;
}

export interface VendorBalanceProjectionDraft {
    vendorId: string;
    currency: string;
    pendingMinor: number;
    availableMinor: number;
    reservedMinor: number;
    paidMinor: number;
    debtMinor: number;
    lastJournalId: string;
    version: number;
}

interface MutableProjection {
    vendorId: string;
    currency: string;
    pending: number;
    available: number;
    reserved: number;
    paid: number;
    lastJournalId: string;
    lastPostedAt: number;
}

function assertEntryAmount(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer.`);
    }
}

function projectionKey(vendorId: string, currency: string): string {
    return `${vendorId}\u0000${currency}`;
}

function normalizeBucket(value: number): { value: number; debt: number } {
    if (value >= 0) return { value, debt: 0 };
    return { value: 0, debt: Math.abs(value) };
}

export function buildVendorBalanceProjections(
    entries: VendorLedgerProjectionEntry[],
): VendorBalanceProjectionDraft[] {
    const projections = new Map<string, MutableProjection>();

    for (const entry of entries) {
        if (!entry.vendorId) continue;
        assertEntryAmount(entry.debitMinor, "Ledger debit");
        assertEntryAmount(entry.creditMinor, "Ledger credit");
        if (!(entry.postedAt instanceof Date) || Number.isNaN(entry.postedAt.getTime())) {
            throw new Error(`Ledger journal ${entry.journalId} has an invalid posting time.`);
        }

        const key = projectionKey(entry.vendorId, entry.currency);
        const existing = projections.get(key) ?? {
            vendorId: entry.vendorId,
            currency: entry.currency,
            pending: 0,
            available: 0,
            reserved: 0,
            paid: 0,
            lastJournalId: entry.journalId,
            lastPostedAt: entry.postedAt.getTime(),
        };
        const normalCreditBalance = entry.creditMinor - entry.debitMinor;

        switch (entry.accountCode) {
            case "vendor_pending_payable":
                existing.pending += normalCreditBalance;
                break;
            case "vendor_available_payable":
                existing.available += normalCreditBalance;
                break;
            case "vendor_payout_reserved":
                existing.reserved += normalCreditBalance;
                break;
            case "vendor_paid":
                existing.paid += normalCreditBalance;
                break;
            case "marketplace_adjustment":
                existing.available += normalCreditBalance;
                break;
            default:
                continue;
        }

        if (entry.postedAt.getTime() >= existing.lastPostedAt) {
            existing.lastPostedAt = entry.postedAt.getTime();
            existing.lastJournalId = entry.journalId;
        }
        projections.set(key, existing);
    }

    return Array.from(projections.values())
        .sort((left, right) =>
            left.vendorId.localeCompare(right.vendorId) || left.currency.localeCompare(right.currency),
        )
        .map((projection) => {
            const pending = normalizeBucket(projection.pending);
            const available = normalizeBucket(projection.available);
            const reserved = normalizeBucket(projection.reserved);
            const paid = normalizeBucket(projection.paid);
            return {
                vendorId: projection.vendorId,
                currency: projection.currency,
                pendingMinor: pending.value,
                availableMinor: available.value,
                reservedMinor: reserved.value,
                paidMinor: paid.value,
                debtMinor: pending.debt + available.debt + reserved.debt + paid.debt,
                lastJournalId: projection.lastJournalId,
                version: 1,
            };
        });
}

const PROJECTED_ACCOUNT_CODES: MarketplaceLedgerAccountCode[] = [
    "vendor_pending_payable",
    "vendor_available_payable",
    "vendor_payout_reserved",
    "vendor_paid",
    "marketplace_adjustment",
];

export async function rebuildVendorBalanceProjections(
    db: Database,
    updatedAt = new Date(),
): Promise<{ vendors: number; entries: number }> {
    const entries = await db
        .select({
            journalId: marketplaceLedgerEntries.journalId,
            vendorId: marketplaceLedgerEntries.vendorId,
            currency: marketplaceLedgerJournals.currency,
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
        .where(andProjectionConditions())
        .orderBy(asc(marketplaceLedgerJournals.postedAt), asc(marketplaceLedgerEntries.id))
        .all();

    const projections = buildVendorBalanceProjections(entries);
    const statements: BatchItem<"sqlite">[] = [
        db.delete(vendorBalanceProjections) as BatchItem<"sqlite">,
    ];
    if (projections.length > 0) {
        statements.push(db.insert(vendorBalanceProjections).values(projections.map((projection) => ({
            ...projection,
            updatedAt,
        }))) as BatchItem<"sqlite">);
    }
    await safeBatch(db, statements);
    return { vendors: projections.length, entries: entries.length };
}

function andProjectionConditions() {
    return and(
        inArray(marketplaceLedgerEntries.accountCode, PROJECTED_ACCOUNT_CODES),
        isNotNull(marketplaceLedgerEntries.vendorId),
    );
}
