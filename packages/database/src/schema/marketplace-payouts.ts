// Marketplace settlement and payout operational records. Immutable ledger rows remain financial authority.

import { sql, type InferSelectModel } from "drizzle-orm";
import {
    check,
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { marketplaceLedgerJournals } from "./marketplace-finance";
import { UNIX_NOW } from "./shared";
import { vendorPayoutMethods, vendors } from "./vendors";

export type PayoutAttemptMetadata = Record<string, unknown>;

export const payoutBatches = sqliteTable("payout_batches", {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    currency: text("currency").notNull(),
    method: text("method", {
        enum: ["bank", "bkash", "nagad", "rocket", "manual", "mixed"],
    }).notNull().default("mixed"),
    status: text("status", {
        enum: [
            "draft",
            "approved",
            "processing",
            "completed",
            "partially_failed",
            "failed",
            "cancelled",
        ],
    }).notNull().default("draft"),
    windowStartAt: integer("window_start_at", { mode: "timestamp" }),
    windowEndAt: integer("window_end_at", { mode: "timestamp" }),
    itemCount: integer("item_count").notNull().default(0),
    totalMinor: integer("total_minor").notNull().default(0),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    processingStartedAt: integer("processing_started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    uniqueIndex("payout_batches_idempotency_uq").on(table.idempotencyKey),
    index("payout_batches_status_created_idx").on(table.status, table.createdAt),
    index("payout_batches_currency_window_idx").on(table.currency, table.windowEndAt),
    index("payout_batches_created_by_idx").on(table.createdBy),
    index("payout_batches_approved_by_idx").on(table.approvedBy),
    check("payout_batches_item_count_non_negative_ck", sql`${table.itemCount} >= 0`),
    check("payout_batches_total_non_negative_ck", sql`${table.totalMinor} >= 0`),
]);

export const payoutItems = sqliteTable("payout_items", {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().references(() => payoutBatches.id, { onDelete: "restrict" }),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "restrict" }),
    payoutMethodId: text("payout_method_id").notNull().references(
        () => vendorPayoutMethods.id,
        { onDelete: "restrict" },
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    status: text("status", {
        enum: ["draft", "reserved", "processing", "completed", "failed", "released", "cancelled"],
    }).notNull().default("draft"),
    reservationJournalId: text("reservation_journal_id").references(
        () => marketplaceLedgerJournals.id,
        { onDelete: "restrict" },
    ),
    completionJournalId: text("completion_journal_id").references(
        () => marketplaceLedgerJournals.id,
        { onDelete: "restrict" },
    ),
    releaseJournalId: text("release_journal_id").references(
        () => marketplaceLedgerJournals.id,
        { onDelete: "restrict" },
    ),
    providerReference: text("provider_reference"),
    failureReason: text("failure_reason"),
    version: integer("version").notNull().default(1),
    reservedAt: integer("reserved_at", { mode: "timestamp" }),
    processingStartedAt: integer("processing_started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    releasedAt: integer("released_at", { mode: "timestamp" }),
    failedAt: integer("failed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    uniqueIndex("payout_items_idempotency_uq").on(table.idempotencyKey),
    uniqueIndex("payout_items_batch_vendor_currency_uq").on(
        table.batchId,
        table.vendorId,
        table.currency,
    ),
    index("payout_items_vendor_status_idx").on(table.vendorId, table.status, table.createdAt),
    index("payout_items_batch_status_idx").on(table.batchId, table.status),
    index("payout_items_payout_method_idx").on(table.payoutMethodId),
    index("payout_items_reservation_journal_idx").on(table.reservationJournalId),
    check("payout_items_amount_positive_ck", sql`${table.amountMinor} > 0`),
    check("payout_items_version_positive_ck", sql`${table.version} > 0`),
]);

export const payoutAttempts = sqliteTable("payout_attempts", {
    id: text("id").primaryKey(),
    payoutItemId: text("payout_item_id").notNull().references(
        () => payoutItems.id,
        { onDelete: "restrict" },
    ),
    attemptKey: text("attempt_key").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    provider: text("provider").notNull(),
    status: text("status", { enum: ["processing", "succeeded", "failed"] }).notNull(),
    providerReference: text("provider_reference"),
    requestMetadata: text("request_metadata", { mode: "json" }).$type<PayoutAttemptMetadata>(),
    responseMetadata: text("response_metadata", { mode: "json" }).$type<PayoutAttemptMetadata>(),
    errorMessage: text("error_message"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    uniqueIndex("payout_attempts_attempt_key_uq").on(table.attemptKey),
    uniqueIndex("payout_attempts_item_number_uq").on(table.payoutItemId, table.attemptNumber),
    index("payout_attempts_item_status_idx").on(table.payoutItemId, table.status, table.createdAt),
    check("payout_attempts_number_positive_ck", sql`${table.attemptNumber} > 0`),
]);

export type PayoutBatch = InferSelectModel<typeof payoutBatches>;
export type PayoutItem = InferSelectModel<typeof payoutItems>;
export type PayoutAttempt = InferSelectModel<typeof payoutAttempts>;
