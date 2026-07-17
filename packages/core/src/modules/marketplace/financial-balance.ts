import type { Database } from "@scalius/database/client";
import {
    marketplaceLedgerEntries,
    marketplaceLedgerJournals,
} from "@scalius/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { MarketplaceLedgerAccountCode } from "./ledger";

const VENDOR_PAYABLE_ACCOUNTS = [
    "vendor_pending_payable",
    "vendor_available_payable",
    "vendor_payout_reserved",
    "vendor_paid",
    "marketplace_adjustment",
] as const satisfies readonly MarketplaceLedgerAccountCode[];

export interface VendorFinancialBalanceEntry {
    accountCode: MarketplaceLedgerAccountCode;
    debitMinor: number;
    creditMinor: number;
}

export interface VendorFinancialBalance {
    pendingMinor: number;
    availableMinor: number;
    reservedMinor: number;
    paidMinor: number;
    debtMinor: number;
    payoutEligibleMinor: number;
}

function assertLedgerAmount(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer.`);
    }
}

export function calculateVendorFinancialBalance(
    entries: VendorFinancialBalanceEntry[],
): VendorFinancialBalance {
    const raw = {
        pending: 0,
        available: 0,
        reserved: 0,
        paid: 0,
    };

    for (const entry of entries) {
        assertLedgerAmount(entry.debitMinor, "Ledger debit");
        assertLedgerAmount(entry.creditMinor, "Ledger credit");
        const net = entry.creditMinor - entry.debitMinor;
        switch (entry.accountCode) {
            case "vendor_pending_payable":
                raw.pending += net;
                break;
            case "vendor_available_payable":
            case "marketplace_adjustment":
                raw.available += net;
                break;
            case "vendor_payout_reserved":
                raw.reserved += net;
                break;
            case "vendor_paid":
                raw.paid += net;
                break;
            default:
                break;
        }
    }

    for (const [label, value] of Object.entries(raw)) {
        if (!Number.isSafeInteger(value)) {
            throw new Error(`Vendor ${label} balance exceeds safe integer range.`);
        }
    }

    const debtMinor =
        Math.max(0, -raw.pending) +
        Math.max(0, -raw.available) +
        Math.max(0, -raw.reserved) +
        Math.max(0, -raw.paid);
    const availableMinor = Math.max(0, raw.available);

    return {
        pendingMinor: Math.max(0, raw.pending),
        availableMinor,
        reservedMinor: Math.max(0, raw.reserved),
        paidMinor: Math.max(0, raw.paid),
        debtMinor,
        payoutEligibleMinor: Math.max(0, availableMinor - debtMinor),
    };
}

export async function getVendorFinancialBalance(
    db: Database,
    vendorId: string,
    currency: string,
): Promise<VendorFinancialBalance> {
    const rows = await db
        .select({
            accountCode: marketplaceLedgerEntries.accountCode,
            debitMinor: marketplaceLedgerEntries.debitMinor,
            creditMinor: marketplaceLedgerEntries.creditMinor,
        })
        .from(marketplaceLedgerEntries)
        .innerJoin(
            marketplaceLedgerJournals,
            eq(marketplaceLedgerJournals.id, marketplaceLedgerEntries.journalId),
        )
        .where(and(
            eq(marketplaceLedgerEntries.vendorId, vendorId),
            eq(marketplaceLedgerJournals.currency, currency),
            inArray(marketplaceLedgerEntries.accountCode, [...VENDOR_PAYABLE_ACCOUNTS]),
        ))
        .all();

    return calculateVendorFinancialBalance(rows);
}
