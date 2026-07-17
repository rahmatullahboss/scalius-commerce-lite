import { safeBatch, type Database } from "@scalius/database/client";
import {
    marketplaceLedgerEntries,
    marketplaceLedgerJournals,
} from "@scalius/database/schema";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { ConflictError } from "../../errors";
import {
    assertBalancedJournal,
    type MarketplaceLedgerJournalDraft,
} from "./ledger";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: unknown): JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("Ledger hash input contains a non-finite number.");
        return value;
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value === "object") {
        const result: Record<string, JsonValue> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            const entry = (value as Record<string, unknown>)[key];
            if (entry !== undefined) result[key] = canonicalize(entry);
        }
        return result;
    }
    throw new Error("Ledger hash input is not JSON serializable.");
}

function bytesToHex(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getJournalContentHash(
    journal: MarketplaceLedgerJournalDraft,
): Promise<string> {
    assertBalancedJournal(journal);
    const hashInput = canonicalize({
        idempotencyKey: journal.idempotencyKey,
        eventType: journal.eventType,
        sourceType: journal.sourceType,
        sourceId: journal.sourceId,
        orderId: journal.orderId ?? null,
        orderPaymentId: journal.orderPaymentId ?? null,
        refundId: journal.refundId ?? null,
        payoutId: journal.payoutId ?? null,
        reversalOfJournalId: journal.reversalOfJournalId ?? null,
        currency: journal.currency,
        occurredAt: journal.occurredAt,
        metadata: journal.metadata ?? null,
        entries: journal.entries,
    });
    const encoded = new TextEncoder().encode(JSON.stringify(hashInput));
    return bytesToHex(await crypto.subtle.digest("SHA-256", encoded));
}

function readContentHash(metadata: unknown): string | null {
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
        const value = (metadata as Record<string, unknown>).contentHash;
        return typeof value === "string" ? value : null;
    }
    if (typeof metadata === "string") {
        try {
            return readContentHash(JSON.parse(metadata));
        } catch {
            return null;
        }
    }
    return null;
}

export interface BuildMarketplaceJournalStatementsOptions {
    conflictMode?: "ignore" | "error";
    createdAt?: Date;
}

export async function buildMarketplaceJournalStatements(
    db: Database,
    journal: MarketplaceLedgerJournalDraft,
    options: BuildMarketplaceJournalStatementsOptions = {},
): Promise<{
    journalId: string;
    contentHash: string;
    statements: BatchItem<"sqlite">[];
}> {
    assertBalancedJournal(journal);
    const contentHash = await getJournalContentHash(journal);
    const journalId = `journal:${journal.idempotencyKey}`;
    const createdAt = options.createdAt ?? new Date();
    const metadata = {
        ...(journal.metadata ?? {}),
        contentHash,
    };

    const journalValues = db
        .insert(marketplaceLedgerJournals)
        .values({
            id: journalId,
            idempotencyKey: journal.idempotencyKey,
            eventType: journal.eventType,
            sourceType: journal.sourceType,
            sourceId: journal.sourceId,
            orderId: journal.orderId ?? null,
            orderPaymentId: journal.orderPaymentId ?? null,
            refundId: journal.refundId ?? null,
            payoutId: journal.payoutId ?? null,
            reversalOfJournalId: journal.reversalOfJournalId ?? null,
            currency: journal.currency,
            occurredAt: journal.occurredAt,
            metadata,
            createdAt,
        });
    const entryValues = db
        .insert(marketplaceLedgerEntries)
        .values(journal.entries.map((entry, index) => ({
            id: `${journalId}:entry:${index}`,
            journalId,
            vendorId: entry.vendorId ?? null,
            accountCode: entry.accountCode,
            debitMinor: entry.debitMinor,
            creditMinor: entry.creditMinor,
            vendorOrderId: entry.vendorOrderId ?? null,
            orderItemId: entry.orderItemId ?? null,
            createdAt,
        })));

    const conflictMode = options.conflictMode ?? "ignore";
    const journalStatement = conflictMode === "error"
        ? journalValues.returning({ id: marketplaceLedgerJournals.id })
        : journalValues
            .onConflictDoNothing({ target: marketplaceLedgerJournals.idempotencyKey })
            .returning({ id: marketplaceLedgerJournals.id });
    const entryStatement = conflictMode === "error"
        ? entryValues
        : entryValues.onConflictDoNothing({ target: marketplaceLedgerEntries.id });

    return {
        journalId,
        contentHash,
        statements: [
            journalStatement as BatchItem<"sqlite">,
            entryStatement as BatchItem<"sqlite">,
        ],
    };
}

export async function postMarketplaceJournal(
    db: Database,
    journal: MarketplaceLedgerJournalDraft,
): Promise<{ journalId: string; replayed: boolean }> {
    assertBalancedJournal(journal);
    const contentHash = await getJournalContentHash(journal);
    const journalId = `journal:${journal.idempotencyKey}`;
    const metadata = {
        ...(journal.metadata ?? {}),
        contentHash,
    };

    const journalStatement = db
        .insert(marketplaceLedgerJournals)
        .values({
            id: journalId,
            idempotencyKey: journal.idempotencyKey,
            eventType: journal.eventType,
            sourceType: journal.sourceType,
            sourceId: journal.sourceId,
            orderId: journal.orderId ?? null,
            orderPaymentId: journal.orderPaymentId ?? null,
            refundId: journal.refundId ?? null,
            payoutId: journal.payoutId ?? null,
            reversalOfJournalId: journal.reversalOfJournalId ?? null,
            currency: journal.currency,
            occurredAt: journal.occurredAt,
            metadata,
            createdAt: new Date(),
        })
        .onConflictDoNothing({ target: marketplaceLedgerJournals.idempotencyKey })
        .returning({ id: marketplaceLedgerJournals.id }) as BatchItem<"sqlite">;

    const entryStatement = db
        .insert(marketplaceLedgerEntries)
        .values(journal.entries.map((entry, index) => ({
            id: `${journalId}:entry:${index}`,
            journalId,
            vendorId: entry.vendorId ?? null,
            accountCode: entry.accountCode,
            debitMinor: entry.debitMinor,
            creditMinor: entry.creditMinor,
            vendorOrderId: entry.vendorOrderId ?? null,
            orderItemId: entry.orderItemId ?? null,
            createdAt: new Date(),
        })))
        .onConflictDoNothing({ target: marketplaceLedgerEntries.id }) as BatchItem<"sqlite">;

    const result = await safeBatch(db, [journalStatement, entryStatement]) as unknown[];
    const journalInsert = result[0] as Array<{ id: string }> | undefined;
    if ((journalInsert?.length ?? 0) > 0) {
        return { journalId, replayed: false };
    }

    const existing = await db
        .select({
            id: marketplaceLedgerJournals.id,
            metadata: marketplaceLedgerJournals.metadata,
        })
        .from(marketplaceLedgerJournals)
        .where(eq(marketplaceLedgerJournals.idempotencyKey, journal.idempotencyKey))
        .get();

    if (!existing) {
        throw new ConflictError(
            `Journal ${journal.idempotencyKey} was not inserted and no existing journal was found.`,
        );
    }
    if (readContentHash(existing.metadata) !== contentHash) {
        throw new ConflictError(
            `Journal idempotency key ${journal.idempotencyKey} was reused with different content.`,
        );
    }

    return { journalId: existing.id, replayed: true };
}
