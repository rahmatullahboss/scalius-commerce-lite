import { safeBatch, type Database } from "@scalius/database/client";
import {
    marketplaceLedgerJournals,
    payoutAttempts,
    payoutBatches,
    payoutItems,
    vendorPayoutMethods,
    vendors,
} from "@scalius/database/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { rebuildVendorBalanceProjections } from "./balance-projection";
import {
    getVendorFinancialBalance,
    type VendorFinancialBalance,
} from "./financial-balance";
import {
    buildPayoutCompletedJournal,
    buildPayoutReleaseJournal,
    buildPayoutReservationJournal,
} from "./ledger";
import {
    buildMarketplaceJournalStatements,
    type BuildMarketplaceJournalStatementsOptions,
} from "./ledger-store";
import { minorUnits } from "./money";
import {
    createDomainOutboxInsertStatement,
    type BuildDomainOutboxEventInput,
} from "./outbox";

const MAX_PAYOUT_METADATA_BYTES = 8 * 1024;
const SENSITIVE_PAYOUT_KEY = /(?:password|passcode|secret|token|encrypted|account[_-]?number|routing|iban|swift|storage[_-]?key|document|kyc)/i;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function sanitizeJson(value: unknown, path: string, seen: WeakSet<object>): JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new ValidationError(`Payout metadata ${path} is not finite`);
        return value;
    }
    if (typeof value !== "object" || value instanceof Date) {
        throw new ValidationError(`Payout metadata ${path} is not JSON serializable`);
    }
    if (seen.has(value)) throw new ValidationError(`Payout metadata ${path} is circular`);
    seen.add(value);
    if (Array.isArray(value)) {
        const result = value.map((entry, index) => sanitizeJson(entry, `${path}[${index}]`, seen));
        seen.delete(value);
        return result;
    }
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (SENSITIVE_PAYOUT_KEY.test(key)) {
            throw new ValidationError(`Sensitive payout metadata key is not allowed: ${key}`);
        }
        result[key] = sanitizeJson(entry, `${path}.${key}`, seen);
    }
    seen.delete(value);
    return result;
}

export function sanitizePayoutAttemptMetadata(
    metadata: Record<string, unknown> | null | undefined,
): Record<string, JsonValue> | null {
    if (metadata == null) return null;
    const sanitized = sanitizeJson(metadata, "metadata", new WeakSet());
    if (sanitized === null || Array.isArray(sanitized) || typeof sanitized !== "object") {
        throw new ValidationError("Payout metadata must be an object");
    }
    const bytes = new TextEncoder().encode(JSON.stringify(sanitized)).byteLength;
    if (bytes > MAX_PAYOUT_METADATA_BYTES) {
        throw new ValidationError(`Payout metadata exceeds ${MAX_PAYOUT_METADATA_BYTES} byte limit`);
    }
    return sanitized;
}

export interface PayoutPreviewInput {
    vendorId: string;
    currency: string;
    payoutMethodId?: string;
}

export interface PayoutPreview {
    vendorId: string;
    currency: string;
    minimumPayoutMinor: number;
    eligibleMinor: number;
    balance: VendorFinancialBalance;
    payoutMethod: {
        id: string;
        method: "bank" | "bkash" | "nagad" | "rocket" | "manual";
        displayName: string;
        lastFour: string | null;
        providerName: string | null;
    };
}

export interface PayoutPreviewDependencies {
    getBalance?: typeof getVendorFinancialBalance;
}

export async function previewVendorPayout(
    db: Database,
    input: PayoutPreviewInput,
    dependencies: PayoutPreviewDependencies = {},
): Promise<PayoutPreview> {
    if (!input.vendorId?.trim()) throw new ValidationError("Vendor ID is required");
    if (!input.currency?.trim()) throw new ValidationError("Payout currency is required");

    const vendor = await db
        .select({
            vendorId: vendors.id,
            vendorStatus: vendors.status,
            vendorDeletedAt: vendors.deletedAt,
            minimumPayoutMinor: vendors.minimumPayoutMinor,
        })
        .from(vendors)
        .where(eq(vendors.id, input.vendorId))
        .get();
    if (!vendor) throw new NotFoundError(`Vendor ${input.vendorId} not found`);
    if (vendor.vendorStatus !== "approved" || vendor.vendorDeletedAt != null) {
        throw new ValidationError("Vendor is not eligible for payout");
    }

    const methodConditions = [
        eq(vendorPayoutMethods.vendorId, input.vendorId),
        eq(vendorPayoutMethods.status, "verified"),
        isNull(vendorPayoutMethods.deletedAt),
    ];
    if (input.payoutMethodId) {
        methodConditions.push(eq(vendorPayoutMethods.id, input.payoutMethodId));
    }
    const method = await db
        .select({
            id: vendorPayoutMethods.id,
            vendorId: vendorPayoutMethods.vendorId,
            method: vendorPayoutMethods.method,
            displayName: vendorPayoutMethods.displayName,
            lastFour: vendorPayoutMethods.lastFour,
            providerName: vendorPayoutMethods.providerName,
            status: vendorPayoutMethods.status,
            deletedAt: vendorPayoutMethods.deletedAt,
        })
        .from(vendorPayoutMethods)
        .where(and(...methodConditions))
        .orderBy(desc(vendorPayoutMethods.isDefault), desc(vendorPayoutMethods.verifiedAt))
        .get();
    if (!method) throw new ValidationError("A verified payout destination is required");

    const getBalance = dependencies.getBalance ?? getVendorFinancialBalance;
    const balance = await getBalance(db, input.vendorId, input.currency);
    if (balance.payoutEligibleMinor <= 0) {
        throw new ValidationError("Vendor has no payout-eligible available balance");
    }
    if (balance.payoutEligibleMinor < vendor.minimumPayoutMinor) {
        throw new ValidationError("Available balance is below the vendor minimum payout amount");
    }

    return {
        vendorId: input.vendorId,
        currency: input.currency,
        minimumPayoutMinor: vendor.minimumPayoutMinor,
        eligibleMinor: balance.payoutEligibleMinor,
        balance,
        payoutMethod: {
            id: method.id,
            method: method.method,
            displayName: method.displayName,
            lastFour: method.lastFour,
            providerName: method.providerName,
        },
    };
}

interface JournalDependencies {
    buildJournalStatements?: (
        db: Database,
        journal: ReturnType<
            | typeof buildPayoutReservationJournal
            | typeof buildPayoutCompletedJournal
            | typeof buildPayoutReleaseJournal
        >,
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

export interface ReserveVendorPayoutInput {
    idempotencyKey: string;
    vendorId: string;
    currency: string;
    amountMinor?: number;
    payoutMethodId?: string;
    actorUserId?: string;
    notes?: string;
    now?: Date;
}

export interface ReserveVendorPayoutDependencies extends JournalDependencies {
    preview?: typeof previewVendorPayout;
}

export async function reserveVendorPayout(
    db: Database,
    input: ReserveVendorPayoutInput,
    dependencies: ReserveVendorPayoutDependencies = {},
): Promise<{
    replayed: boolean;
    batchId: string;
    payoutItemId: string;
    journalId: string;
    vendorId: string;
    currency: string;
    amountMinor: number;
    status: "reserved";
}> {
    if (!input.idempotencyKey?.trim()) throw new ValidationError("Payout idempotency key is required");
    const existing = await db
        .select({
            payoutItemId: payoutItems.id,
            batchId: payoutItems.batchId,
            journalId: payoutItems.reservationJournalId,
            vendorId: payoutItems.vendorId,
            currency: payoutItems.currency,
            amountMinor: payoutItems.amountMinor,
            status: payoutItems.status,
        })
        .from(payoutItems)
        .where(eq(payoutItems.idempotencyKey, input.idempotencyKey))
        .get();
    if (existing) {
        if (existing.status !== "reserved" && existing.status !== "processing" && existing.status !== "completed") {
            throw new ConflictError("Existing payout reservation is not reusable");
        }
        return {
            replayed: true,
            batchId: existing.batchId,
            payoutItemId: existing.payoutItemId,
            journalId: existing.journalId ?? "",
            vendorId: existing.vendorId,
            currency: existing.currency,
            amountMinor: existing.amountMinor,
            status: "reserved",
        };
    }

    const preview = dependencies.preview ?? previewVendorPayout;
    const payoutPreview = await preview(db, {
        vendorId: input.vendorId,
        currency: input.currency,
        payoutMethodId: input.payoutMethodId,
    });
    const amountMinor = input.amountMinor ?? payoutPreview.eligibleMinor;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new ValidationError("Payout amount must be a positive safe integer");
    }
    if (amountMinor > payoutPreview.eligibleMinor) {
        throw new ValidationError("Payout amount exceeds ledger-derived eligible balance");
    }
    if (amountMinor < payoutPreview.minimumPayoutMinor) {
        throw new ValidationError("Payout amount is below the vendor minimum payout amount");
    }

    const now = input.now ?? new Date();
    const batchId = `payout_batch:${input.idempotencyKey}`;
    const payoutItemId = `payout_item:${input.idempotencyKey}`;
    const journal = buildPayoutReservationJournal({
        payoutItemId,
        vendorId: input.vendorId,
        currency: input.currency,
        amountMinor: minorUnits(amountMinor),
        occurredAt: now,
    });
    const buildJournalStatements =
        dependencies.buildJournalStatements ?? buildMarketplaceJournalStatements;
    const journalBundle = await buildJournalStatements(db, journal, {
        conflictMode: "error",
        createdAt: now,
    });
    const batchStatement = db.insert(payoutBatches).values({
        id: batchId,
        idempotencyKey: `batch:${input.idempotencyKey}`,
        currency: input.currency,
        method: payoutPreview.payoutMethod.method,
        status: "approved",
        itemCount: 1,
        totalMinor: amountMinor,
        notes: input.notes ?? null,
        createdBy: input.actorUserId ?? null,
        approvedBy: input.actorUserId ?? null,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
    }) as BatchItem<"sqlite">;
    const itemStatement = db.insert(payoutItems).values({
        id: payoutItemId,
        batchId,
        vendorId: input.vendorId,
        payoutMethodId: payoutPreview.payoutMethod.id,
        idempotencyKey: input.idempotencyKey,
        currency: input.currency,
        amountMinor,
        status: "reserved",
        reservationJournalId: journalBundle.journalId,
        version: 1,
        reservedAt: now,
        createdAt: now,
        updatedAt: now,
    }) as BatchItem<"sqlite">;
    const createOutboxStatement =
        dependencies.createOutboxStatement ?? createDomainOutboxInsertStatement;
    const outboxStatement = createOutboxStatement(db, {
        eventKey: journal.idempotencyKey,
        aggregateType: "payout_item",
        aggregateId: payoutItemId,
        eventType: "payout.requested",
        payload: {
            payoutItemId,
            batchId,
            vendorId: input.vendorId,
            currency: input.currency,
            amountMinor,
            journalId: journalBundle.journalId,
        },
        createdAt: now,
    });

    try {
        await safeBatch(db, [
            ...journalBundle.statements,
            batchStatement,
            itemStatement,
            outboxStatement,
        ]);
    } catch (error: unknown) {
        const replay = await db
            .select({ id: payoutItems.id })
            .from(payoutItems)
            .where(eq(payoutItems.idempotencyKey, input.idempotencyKey))
            .get();
        if (!replay) throw error;
        return reserveVendorPayout(db, input, dependencies);
    }

    const rebuild = dependencies.rebuildProjections ?? rebuildVendorBalanceProjections;
    await rebuild(db, now);
    return {
        replayed: false,
        batchId,
        payoutItemId,
        journalId: journalBundle.journalId,
        vendorId: input.vendorId,
        currency: input.currency,
        amountMinor,
        status: "reserved",
    };
}

export interface ClaimPayoutDispatchInput {
    payoutItemId: string;
    provider: string;
    requestMetadata?: Record<string, unknown>;
    now?: Date;
}

export async function claimPayoutItemForDispatch(
    db: Database,
    input: ClaimPayoutDispatchInput,
): Promise<{
    payoutItemId: string;
    attemptId: string;
    attemptNumber: number;
    status: "processing";
}> {
    const item = await db
        .select({
            payoutItemId: payoutItems.id,
            batchId: payoutItems.batchId,
            status: payoutItems.status,
            version: payoutItems.version,
            vendorId: payoutItems.vendorId,
            payoutMethodId: payoutItems.payoutMethodId,
            methodStatus: vendorPayoutMethods.status,
            methodDeletedAt: vendorPayoutMethods.deletedAt,
        })
        .from(payoutItems)
        .innerJoin(vendorPayoutMethods, eq(vendorPayoutMethods.id, payoutItems.payoutMethodId))
        .where(eq(payoutItems.id, input.payoutItemId))
        .get();
    if (!item) throw new NotFoundError(`Payout item ${input.payoutItemId} not found`);
    if (item.status !== "reserved") throw new ConflictError("Only a reserved payout can be claimed");
    if (item.methodStatus !== "verified" || item.methodDeletedAt != null) {
        throw new ValidationError("Payout destination is no longer verified");
    }

    const lastAttempt = await db
        .select({ attemptNumber: payoutAttempts.attemptNumber })
        .from(payoutAttempts)
        .where(eq(payoutAttempts.payoutItemId, input.payoutItemId))
        .orderBy(desc(payoutAttempts.attemptNumber))
        .get();
    const attemptNumber = (lastAttempt?.attemptNumber ?? 0) + 1;
    const attemptId = `payout_attempt:${input.payoutItemId}:${attemptNumber}`;
    const now = input.now ?? new Date();
    const requestMetadata = sanitizePayoutAttemptMetadata(input.requestMetadata);
    const itemUpdate = db
        .update(payoutItems)
        .set({
            status: "processing",
            version: item.version + 1,
            processingStartedAt: now,
            updatedAt: now,
        })
        .where(and(
            eq(payoutItems.id, input.payoutItemId),
            eq(payoutItems.status, "reserved"),
            eq(payoutItems.version, item.version),
        ))
        .returning({ id: payoutItems.id }) as BatchItem<"sqlite">;
    const attemptInsert = db.insert(payoutAttempts).values({
        id: attemptId,
        payoutItemId: input.payoutItemId,
        attemptKey: `payout:${input.payoutItemId}:attempt:${attemptNumber}`,
        attemptNumber,
        provider: input.provider,
        status: "processing",
        requestMetadata,
        startedAt: now,
        createdAt: now,
    }) as BatchItem<"sqlite">;
    const result = await safeBatch(db, [itemUpdate, attemptInsert]) as unknown[];
    const claimed = result[0] as Array<{ id: string }> | undefined;
    if ((claimed?.length ?? 0) === 0) {
        throw new ConflictError("Payout item was claimed concurrently");
    }
    return { payoutItemId: input.payoutItemId, attemptId, attemptNumber, status: "processing" };
}

export interface CompletePayoutInput {
    payoutItemId: string;
    providerReference: string;
    responseMetadata?: Record<string, unknown>;
    now?: Date;
}

async function getProcessingPayout(db: Database, payoutItemId: string) {
    return db
        .select({
            payoutItemId: payoutItems.id,
            batchId: payoutItems.batchId,
            vendorId: payoutItems.vendorId,
            currency: payoutItems.currency,
            amountMinor: payoutItems.amountMinor,
            status: payoutItems.status,
            version: payoutItems.version,
            attemptId: payoutAttempts.id,
            attemptKey: payoutAttempts.attemptKey,
            attemptStatus: payoutAttempts.status,
        })
        .from(payoutItems)
        .leftJoin(
            payoutAttempts,
            and(
                eq(payoutAttempts.payoutItemId, payoutItems.id),
                eq(payoutAttempts.status, "processing"),
            ),
        )
        .where(eq(payoutItems.id, payoutItemId))
        .orderBy(desc(payoutAttempts.attemptNumber))
        .get();
}

export async function completePayoutItem(
    db: Database,
    input: CompletePayoutInput,
    dependencies: JournalDependencies = {},
): Promise<{ payoutItemId: string; status: "completed"; amountMinor: number; journalId: string }> {
    const item = await getProcessingPayout(db, input.payoutItemId);
    if (!item) throw new NotFoundError(`Payout item ${input.payoutItemId} not found`);
    if (item.status !== "processing" || !item.attemptId || item.attemptStatus !== "processing") {
        throw new ConflictError("Payout item is not processing");
    }
    if (!input.providerReference?.trim()) throw new ValidationError("Provider reference is required");
    const now = input.now ?? new Date();
    const responseMetadata = sanitizePayoutAttemptMetadata(input.responseMetadata);
    const journal = buildPayoutCompletedJournal({
        payoutItemId: item.payoutItemId,
        vendorId: item.vendorId,
        currency: item.currency,
        amountMinor: minorUnits(item.amountMinor),
        occurredAt: now,
    });
    const buildJournalStatements =
        dependencies.buildJournalStatements ?? buildMarketplaceJournalStatements;
    const journalBundle = await buildJournalStatements(db, journal, {
        conflictMode: "error",
        createdAt: now,
    });
    const itemUpdate = db
        .update(payoutItems)
        .set({
            status: "completed",
            completionJournalId: journalBundle.journalId,
            providerReference: input.providerReference,
            version: item.version + 1,
            completedAt: now,
            updatedAt: now,
        })
        .where(and(
            eq(payoutItems.id, item.payoutItemId),
            eq(payoutItems.status, "processing"),
            eq(payoutItems.version, item.version),
        ))
        .returning({ id: payoutItems.id }) as BatchItem<"sqlite">;
    const attemptUpdate = db
        .update(payoutAttempts)
        .set({
            status: "succeeded",
            providerReference: input.providerReference,
            responseMetadata,
            completedAt: now,
        })
        .where(and(
            eq(payoutAttempts.id, item.attemptId),
            eq(payoutAttempts.status, "processing"),
        )) as BatchItem<"sqlite">;
    const createOutboxStatement =
        dependencies.createOutboxStatement ?? createDomainOutboxInsertStatement;
    const outboxStatement = createOutboxStatement(db, {
        eventKey: journal.idempotencyKey,
        aggregateType: "payout_item",
        aggregateId: item.payoutItemId,
        eventType: "payout.completed",
        payload: {
            payoutItemId: item.payoutItemId,
            batchId: item.batchId,
            vendorId: item.vendorId,
            currency: item.currency,
            amountMinor: item.amountMinor,
            journalId: journalBundle.journalId,
        },
        createdAt: now,
    });
    const result = await safeBatch(db, [
        ...journalBundle.statements,
        itemUpdate,
        attemptUpdate,
        outboxStatement,
    ]) as unknown[];
    const updated = result[2] as Array<{ id: string }> | undefined;
    if ((updated?.length ?? 0) === 0) {
        throw new ConflictError("Payout item completion changed concurrently");
    }
    const rebuild = dependencies.rebuildProjections ?? rebuildVendorBalanceProjections;
    await rebuild(db, now);
    return {
        payoutItemId: item.payoutItemId,
        status: "completed",
        amountMinor: item.amountMinor,
        journalId: journalBundle.journalId,
    };
}

export interface ReleasePayoutInput {
    payoutItemId: string;
    reason: string;
    errorMessage?: string;
    responseMetadata?: Record<string, unknown>;
    now?: Date;
}

export async function releasePayoutItem(
    db: Database,
    input: ReleasePayoutInput,
    dependencies: JournalDependencies = {},
): Promise<{ payoutItemId: string; status: "released"; amountMinor: number; journalId: string }> {
    const item = await getProcessingPayout(db, input.payoutItemId);
    if (!item) throw new NotFoundError(`Payout item ${input.payoutItemId} not found`);
    if (item.status !== "processing" && item.status !== "reserved") {
        throw new ConflictError("Only a reserved or processing payout can be released");
    }
    if (!input.reason?.trim()) throw new ValidationError("Payout release reason is required");
    const now = input.now ?? new Date();
    const responseMetadata = sanitizePayoutAttemptMetadata(input.responseMetadata);
    const journal = buildPayoutReleaseJournal({
        payoutItemId: item.payoutItemId,
        vendorId: item.vendorId,
        currency: item.currency,
        amountMinor: minorUnits(item.amountMinor),
        reason: input.reason,
        occurredAt: now,
    });
    const buildJournalStatements =
        dependencies.buildJournalStatements ?? buildMarketplaceJournalStatements;
    const journalBundle = await buildJournalStatements(db, journal, {
        conflictMode: "error",
        createdAt: now,
    });
    const itemUpdate = db
        .update(payoutItems)
        .set({
            status: "released",
            releaseJournalId: journalBundle.journalId,
            failureReason: input.errorMessage?.slice(0, 2000) ?? input.reason,
            version: item.version + 1,
            releasedAt: now,
            failedAt: item.status === "processing" ? now : null,
            updatedAt: now,
        })
        .where(and(
            eq(payoutItems.id, item.payoutItemId),
            eq(payoutItems.status, item.status),
            eq(payoutItems.version, item.version),
        ))
        .returning({ id: payoutItems.id }) as BatchItem<"sqlite">;
    const attemptUpdate = item.attemptId
        ? db
            .update(payoutAttempts)
            .set({
                status: "failed",
                responseMetadata,
                errorMessage: input.errorMessage?.slice(0, 2000) ?? input.reason,
                completedAt: now,
            })
            .where(and(
                eq(payoutAttempts.id, item.attemptId),
                eq(payoutAttempts.status, "processing"),
            )) as BatchItem<"sqlite">
        : db
            .update(payoutBatches)
            .set({ updatedAt: now })
            .where(eq(payoutBatches.id, item.batchId)) as BatchItem<"sqlite">;
    const createOutboxStatement =
        dependencies.createOutboxStatement ?? createDomainOutboxInsertStatement;
    const outboxStatement = createOutboxStatement(db, {
        eventKey: journal.idempotencyKey,
        aggregateType: "payout_item",
        aggregateId: item.payoutItemId,
        eventType: "payout.released",
        payload: {
            payoutItemId: item.payoutItemId,
            batchId: item.batchId,
            vendorId: item.vendorId,
            currency: item.currency,
            amountMinor: item.amountMinor,
            reason: input.reason,
            journalId: journalBundle.journalId,
        },
        createdAt: now,
    });
    const result = await safeBatch(db, [
        ...journalBundle.statements,
        itemUpdate,
        attemptUpdate,
        outboxStatement,
    ]) as unknown[];
    const updated = result[2] as Array<{ id: string }> | undefined;
    if ((updated?.length ?? 0) === 0) {
        throw new ConflictError("Payout item release changed concurrently");
    }
    const rebuild = dependencies.rebuildProjections ?? rebuildVendorBalanceProjections;
    await rebuild(db, now);
    return {
        payoutItemId: item.payoutItemId,
        status: "released",
        amountMinor: item.amountMinor,
        journalId: journalBundle.journalId,
    };
}
