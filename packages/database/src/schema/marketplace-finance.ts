// Marketplace domain outbox, immutable subledger, normalized refunds, and rebuildable balances.

import { sql, type InferSelectModel } from "drizzle-orm";
import {
    check,
    index,
    integer,
    primaryKey,
    sqliteTable,
    text,
    uniqueIndex,
    type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { orderItems, orderPayments, orders } from "./orders";
import { UNIX_NOW } from "./shared";
import { vendorOrders } from "./vendor-orders";
import { vendors } from "./vendors";

export type DomainOutboxPayload = Record<string, unknown>;
export type MarketplaceMetadata = Record<string, unknown>;

export const domainOutboxEvents = sqliteTable("domain_outbox_events", {
    id: text("id").primaryKey(),
    eventKey: text("event_key").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    payload: text("payload", { mode: "json" }).$type<DomainOutboxPayload>().notNull(),
    status: text("status", {
        enum: ["pending", "processing", "processed", "failed", "dead"],
    }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
    claimId: text("claim_id"),
    claimExpiresAt: integer("claim_expires_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    processedAt: integer("processed_at", { mode: "timestamp" }),
    failedAt: integer("failed_at", { mode: "timestamp" }),
}, (table) => [
    uniqueIndex("domain_outbox_events_event_key_uq").on(table.eventKey),
    index("domain_outbox_events_status_attempt_idx").on(table.status, table.nextAttemptAt, table.createdAt),
    index("domain_outbox_events_aggregate_idx").on(table.aggregateType, table.aggregateId, table.createdAt),
    index("domain_outbox_events_claim_idx").on(table.claimId, table.claimExpiresAt),
    check("domain_outbox_events_schema_version_ck", sql`${table.schemaVersion} > 0`),
    check("domain_outbox_events_attempts_ck", sql`${table.attempts} >= 0`),
]);

export const refunds = sqliteTable("refunds", {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
    orderPaymentId: text("order_payment_id").references(() => orderPayments.id, { onDelete: "restrict" }),
    gateway: text("gateway"),
    providerRefundId: text("provider_refund_id"),
    status: text("status", {
        enum: ["pending", "processing", "completed", "failed", "cancelled"],
    }).notNull().default("pending"),
    currency: text("currency").notNull().default("BDT"),
    amountMinor: integer("amount_minor").notNull(),
    reason: text("reason"),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    claimKey: text("claim_key").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<MarketplaceMetadata>(),
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    failedAt: integer("failed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    uniqueIndex("refunds_claim_key_uq").on(table.claimKey),
    uniqueIndex("refunds_gateway_provider_ref_uq").on(table.gateway, table.providerRefundId),
    index("refunds_order_idx").on(table.orderId, table.createdAt),
    index("refunds_payment_idx").on(table.orderPaymentId),
    index("refunds_status_idx").on(table.status, table.createdAt),
    index("refunds_actor_idx").on(table.actorUserId),
    check("refunds_amount_non_negative_ck", sql`${table.amountMinor} >= 0`),
]);

export const marketplaceLedgerJournals = sqliteTable("marketplace_ledger_journals", {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    eventType: text("event_type").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    orderId: text("order_id").references(() => orders.id, { onDelete: "restrict" }),
    orderPaymentId: text("order_payment_id").references(() => orderPayments.id, { onDelete: "restrict" }),
    refundId: text("refund_id").references(() => refunds.id, { onDelete: "restrict" }),
    payoutId: text("payout_id"),
    reversalOfJournalId: text("reversal_of_journal_id").references(
        (): AnySQLiteColumn => marketplaceLedgerJournals.id,
        { onDelete: "restrict" },
    ),
    currency: text("currency").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
    postedAt: integer("posted_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    metadata: text("metadata", { mode: "json" }).$type<MarketplaceMetadata>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    uniqueIndex("marketplace_ledger_journals_idempotency_uq").on(table.idempotencyKey),
    index("marketplace_ledger_journals_source_idx").on(table.sourceType, table.sourceId),
    index("marketplace_ledger_journals_order_idx").on(table.orderId, table.postedAt),
    index("marketplace_ledger_journals_payment_idx").on(table.orderPaymentId),
    index("marketplace_ledger_journals_refund_idx").on(table.refundId),
    index("marketplace_ledger_journals_payout_idx").on(table.payoutId),
    index("marketplace_ledger_journals_reversal_idx").on(table.reversalOfJournalId),
]);

export const marketplaceLedgerEntries = sqliteTable("marketplace_ledger_entries", {
    id: text("id").primaryKey(),
    journalId: text("journal_id").notNull().references(() => marketplaceLedgerJournals.id, { onDelete: "restrict" }),
    vendorId: text("vendor_id").references(() => vendors.id, { onDelete: "restrict" }),
    accountCode: text("account_code", {
        enum: [
            "cash_clearing",
            "vendor_pending_payable",
            "vendor_available_payable",
            "vendor_payout_reserved",
            "vendor_paid",
            "platform_commission_revenue",
            "shipping_clearing",
            "refund_clearing",
            "marketplace_adjustment",
        ],
    }).notNull(),
    debitMinor: integer("debit_minor").notNull().default(0),
    creditMinor: integer("credit_minor").notNull().default(0),
    vendorOrderId: text("vendor_order_id").references(() => vendorOrders.id, { onDelete: "restrict" }),
    orderItemId: text("order_item_id").references(() => orderItems.id, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    index("marketplace_ledger_entries_journal_idx").on(table.journalId),
    index("marketplace_ledger_entries_vendor_account_idx").on(table.vendorId, table.accountCode, table.createdAt),
    index("marketplace_ledger_entries_vendor_order_idx").on(table.vendorOrderId),
    index("marketplace_ledger_entries_order_item_idx").on(table.orderItemId),
    check(
        "marketplace_ledger_entries_one_side_ck",
        sql`((${table.debitMinor} > 0 AND ${table.creditMinor} = 0) OR (${table.creditMinor} > 0 AND ${table.debitMinor} = 0))`,
    ),
]);

export const refundItems = sqliteTable("refund_items", {
    id: text("id").primaryKey(),
    refundId: text("refund_id").notNull().references(() => refunds.id, { onDelete: "restrict" }),
    orderItemId: text("order_item_id").notNull().references(() => orderItems.id, { onDelete: "restrict" }),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    refundAmountMinor: integer("refund_amount_minor").notNull(),
    grossMinor: integer("gross_minor").notNull(),
    discountReversalMinor: integer("discount_reversal_minor").notNull().default(0),
    shippingReversalMinor: integer("shipping_reversal_minor").notNull().default(0),
    taxReversalMinor: integer("tax_reversal_minor").notNull().default(0),
    commissionReversalMinor: integer("commission_reversal_minor").notNull().default(0),
    vendorNetReversalMinor: integer("vendor_net_reversal_minor").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    uniqueIndex("refund_items_refund_order_item_uq").on(table.refundId, table.orderItemId),
    index("refund_items_order_item_idx").on(table.orderItemId),
    index("refund_items_vendor_idx").on(table.vendorId, table.createdAt),
    check("refund_items_quantity_positive_ck", sql`${table.quantity} > 0`),
    check(
        "refund_items_amounts_non_negative_ck",
        sql`${table.refundAmountMinor} >= 0
            AND ${table.grossMinor} >= 0
            AND ${table.discountReversalMinor} >= 0
            AND ${table.shippingReversalMinor} >= 0
            AND ${table.taxReversalMinor} >= 0
            AND ${table.commissionReversalMinor} >= 0
            AND ${table.vendorNetReversalMinor} >= 0`,
    ),
    check(
        "refund_items_seller_components_ck",
        sql`${table.commissionReversalMinor} + ${table.vendorNetReversalMinor}
            = ${table.grossMinor} - ${table.discountReversalMinor}`,
    ),
]);

export const vendorBalanceProjections = sqliteTable("vendor_balance_projections", {
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "restrict" }),
    currency: text("currency").notNull(),
    pendingMinor: integer("pending_minor").notNull().default(0),
    availableMinor: integer("available_minor").notNull().default(0),
    reservedMinor: integer("reserved_minor").notNull().default(0),
    paidMinor: integer("paid_minor").notNull().default(0),
    debtMinor: integer("debt_minor").notNull().default(0),
    lastJournalId: text("last_journal_id").references(() => marketplaceLedgerJournals.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    primaryKey({ columns: [table.vendorId, table.currency], name: "vendor_balance_projections_pk" }),
    index("vendor_balance_projections_last_journal_idx").on(table.lastJournalId),
    check(
        "vendor_balance_projections_non_negative_ck",
        sql`${table.pendingMinor} >= 0
            AND ${table.availableMinor} >= 0
            AND ${table.reservedMinor} >= 0
            AND ${table.paidMinor} >= 0
            AND ${table.debtMinor} >= 0`,
    ),
    check("vendor_balance_projections_version_ck", sql`${table.version} > 0`),
]);

export type DomainOutboxEvent = InferSelectModel<typeof domainOutboxEvents>;
export type Refund = InferSelectModel<typeof refunds>;
export type RefundItem = InferSelectModel<typeof refundItems>;
export type MarketplaceLedgerJournal = InferSelectModel<typeof marketplaceLedgerJournals>;
export type MarketplaceLedgerEntry = InferSelectModel<typeof marketplaceLedgerEntries>;
export type VendorBalanceProjection = InferSelectModel<typeof vendorBalanceProjections>;
