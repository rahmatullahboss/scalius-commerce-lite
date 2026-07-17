import type { Database } from "@scalius/database/client";
import {
    marketplaceLedgerJournals,
    orderItems,
    orderPayments,
    orders,
    refundItems,
    refunds,
} from "@scalius/database/schema";
import { eq } from "drizzle-orm";
import {
    buildPaymentCapturedJournal,
    buildRefundCompletedJournal,
    type MarketplaceLedgerJournalDraft,
} from "./ledger";
import { postMarketplaceJournal } from "./ledger-store";
import { minorUnits, moneyToMinor } from "./money";

function toDate(value: Date | number | string | null | undefined, label: string): Date {
    if (value instanceof Date) {
        if (!Number.isNaN(value.getTime())) return value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
        const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
        const date = new Date(milliseconds);
        if (!Number.isNaN(date.getTime())) return date;
    } else if (typeof value === "string") {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date;
    }
    throw new Error(`${label} is missing or invalid.`);
}

export async function buildCapturedPaymentJournalFromDatabase(
    db: Database,
    paymentId: string,
): Promise<MarketplaceLedgerJournalDraft> {
    const payment = await db
        .select({
            id: orderPayments.id,
            orderId: orderPayments.orderId,
            amount: orderPayments.amount,
            currency: orderPayments.currency,
            status: orderPayments.status,
            updatedAt: orderPayments.updatedAt,
        })
        .from(orderPayments)
        .where(eq(orderPayments.id, paymentId))
        .get();
    if (!payment) throw new Error(`Payment ${paymentId} was not found.`);
    if (payment.status !== "succeeded") {
        throw new Error(`Payment ${paymentId} is not succeeded yet.`);
    }

    const order = await db
        .select({ id: orders.id, totalAmount: orders.totalAmount })
        .from(orders)
        .where(eq(orders.id, payment.orderId))
        .get();
    if (!order) throw new Error(`Order ${payment.orderId} was not found for payment ${paymentId}.`);

    const itemRows = await db
        .select({
            orderItemId: orderItems.id,
            vendorOrderId: orderItems.vendorOrderId,
            vendorId: orderItems.vendorIdSnapshot,
            vendorNetMinor: orderItems.vendorNetMinor,
            commissionMinor: orderItems.commissionMinor,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, payment.orderId))
        .all();

    const items = itemRows.map((item) => {
        if (!item.vendorOrderId || !item.vendorId) {
            throw new Error(
                `Order item ${item.orderItemId} is missing its immutable seller allocation snapshot.`,
            );
        }
        return {
            orderItemId: item.orderItemId,
            vendorOrderId: item.vendorOrderId,
            vendorId: item.vendorId,
            vendorNetMinor: minorUnits(item.vendorNetMinor),
            commissionMinor: minorUnits(item.commissionMinor),
        };
    });

    return buildPaymentCapturedJournal({
        paymentId: payment.id,
        orderId: payment.orderId,
        currency: payment.currency,
        capturedMinor: moneyToMinor(payment.amount, "Captured payment amount"),
        orderTotalMinor: moneyToMinor(order.totalAmount, "Order total"),
        occurredAt: toDate(payment.updatedAt, "Payment capture time"),
        items,
    });
}

export async function buildCompletedRefundJournalFromDatabase(
    db: Database,
    refundId: string,
): Promise<MarketplaceLedgerJournalDraft> {
    const refund = await db
        .select({
            id: refunds.id,
            orderId: refunds.orderId,
            orderPaymentId: refunds.orderPaymentId,
            currency: refunds.currency,
            amountMinor: refunds.amountMinor,
            status: refunds.status,
            completedAt: refunds.completedAt,
            updatedAt: refunds.updatedAt,
        })
        .from(refunds)
        .where(eq(refunds.id, refundId))
        .get();
    if (!refund) throw new Error(`Refund ${refundId} was not found.`);
    if (refund.status !== "completed") {
        throw new Error(`Refund ${refundId} is not completed yet.`);
    }

    const itemRows = await db
        .select({
            orderItemId: refundItems.orderItemId,
            vendorOrderId: orderItems.vendorOrderId,
            vendorId: refundItems.vendorId,
            refundAmountMinor: refundItems.refundAmountMinor,
            vendorNetReversalMinor: refundItems.vendorNetReversalMinor,
            commissionReversalMinor: refundItems.commissionReversalMinor,
            shippingReversalMinor: refundItems.shippingReversalMinor,
            taxReversalMinor: refundItems.taxReversalMinor,
        })
        .from(refundItems)
        .innerJoin(orderItems, eq(orderItems.id, refundItems.orderItemId))
        .where(eq(refundItems.refundId, refundId))
        .all();

    const items = itemRows.map((item) => {
        if (!item.vendorOrderId) {
            throw new Error(
                `Refund item ${item.orderItemId} is missing its immutable seller fulfillment snapshot.`,
            );
        }
        return {
            orderItemId: item.orderItemId,
            vendorOrderId: item.vendorOrderId,
            vendorId: item.vendorId,
            refundAmountMinor: minorUnits(item.refundAmountMinor),
            vendorNetReversalMinor: minorUnits(item.vendorNetReversalMinor),
            commissionReversalMinor: minorUnits(item.commissionReversalMinor),
            shippingReversalMinor: minorUnits(item.shippingReversalMinor),
            taxReversalMinor: minorUnits(item.taxReversalMinor),
        };
    });

    return buildRefundCompletedJournal({
        refundId: refund.id,
        orderId: refund.orderId,
        orderPaymentId: refund.orderPaymentId,
        currency: refund.currency,
        amountMinor: minorUnits(refund.amountMinor),
        occurredAt: toDate(refund.completedAt ?? refund.updatedAt, "Refund completion time"),
        items,
    });
}

export interface MarketplaceFinancialEventReference {
    eventType: string;
    aggregateId: string;
}

export interface MarketplaceFinancialEventDependencies {
    postJournal?: typeof postMarketplaceJournal;
}

function postedTransitionIdempotencyKey(event: MarketplaceFinancialEventReference): string | null {
    switch (event.eventType) {
        case "settlement.released":
            return `settlement:${event.aggregateId}:released`;
        case "payout.requested":
            return `payout:${event.aggregateId}:reserved`;
        case "payout.completed":
            return `payout:${event.aggregateId}:completed`;
        case "payout.released":
            return `payout:${event.aggregateId}:released`;
        default:
            return null;
    }
}

async function verifyPostedTransitionJournal(
    db: Database,
    event: MarketplaceFinancialEventReference,
): Promise<{ journalId: string; replayed: true } | null> {
    const idempotencyKey = postedTransitionIdempotencyKey(event);
    if (!idempotencyKey) return null;
    const journal = await db
        .select({
            id: marketplaceLedgerJournals.id,
            idempotencyKey: marketplaceLedgerJournals.idempotencyKey,
        })
        .from(marketplaceLedgerJournals)
        .where(eq(marketplaceLedgerJournals.idempotencyKey, idempotencyKey))
        .get();
    if (!journal) {
        throw new Error(
            `Marketplace transition journal is not durable yet for ${event.eventType}:${event.aggregateId}.`,
        );
    }
    return { journalId: journal.id, replayed: true };
}

export async function postMarketplaceFinancialEvent(
    db: Database,
    event: MarketplaceFinancialEventReference,
    dependencies: MarketplaceFinancialEventDependencies = {},
): Promise<{ journalId: string; replayed: boolean }> {
    const postedTransition = await verifyPostedTransitionJournal(db, event);
    if (postedTransition) return postedTransition;

    const postJournal = dependencies.postJournal ?? postMarketplaceJournal;
    let journal: MarketplaceLedgerJournalDraft;

    if (event.eventType === "payment.captured") {
        journal = await buildCapturedPaymentJournalFromDatabase(db, event.aggregateId);
    } else if (event.eventType === "refund.completed") {
        journal = await buildCompletedRefundJournalFromDatabase(db, event.aggregateId);
    } else {
        throw new Error(`Unsupported marketplace financial event: ${event.eventType}`);
    }

    return postJournal(db, journal);
}
