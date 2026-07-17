import { safeBatch, type Database } from "@scalius/database/client";
import { refundItems, refunds } from "@scalius/database/schema";
import type { BatchItem } from "drizzle-orm/batch";
import {
    createDomainOutboxInsertStatement,
    type BuildDomainOutboxEventInput,
} from "./outbox";
import {
    allocateMinorUnits,
    minorUnits,
    type MinorUnits,
} from "./money";

export interface RefundableOrderItemSnapshot {
    orderItemId: string;
    vendorOrderId: string;
    vendorId: string;
    purchasedQuantity: number;
    alreadyRefundedQuantity: number;
    grossMinor: MinorUnits;
    discountMinor: MinorUnits;
    commissionMinor: MinorUnits;
    vendorNetMinor: MinorUnits;
    shippingMinor: MinorUnits;
    taxMinor: MinorUnits;
}

export interface MarketplaceRefundItemAllocation {
    orderItemId: string;
    vendorOrderId: string;
    vendorId: string;
    quantity: number;
    refundAmountMinor: number;
    grossMinor: number;
    discountReversalMinor: number;
    shippingReversalMinor: number;
    taxReversalMinor: number;
    commissionReversalMinor: number;
    vendorNetReversalMinor: number;
}

function assertPositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive quantity.`);
    }
}

function assertNonNegativeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer.`);
    }
}

function sumAllocatedUnitRange(
    total: MinorUnits,
    purchasedQuantity: number,
    startIndex: number,
    quantity: number,
): number {
    if (Number(total) === 0) return 0;
    const unitAllocations = allocateMinorUnits(
        total,
        Array.from({ length: purchasedQuantity }, () => 1),
    );
    return unitAllocations
        .slice(startIndex, startIndex + quantity)
        .reduce((sum, value) => sum + Number(value), 0);
}

export function buildRefundItemAllocation(
    snapshot: RefundableOrderItemSnapshot,
    requestedQuantity: number,
): MarketplaceRefundItemAllocation {
    assertPositiveInteger(snapshot.purchasedQuantity, "Purchased quantity");
    assertNonNegativeInteger(snapshot.alreadyRefundedQuantity, "Already refunded quantity");
    assertPositiveInteger(requestedQuantity, "Requested refund quantity");
    if (snapshot.alreadyRefundedQuantity > snapshot.purchasedQuantity) {
        throw new Error("Already refunded quantity cannot exceed purchased quantity.");
    }
    const remainingQuantity = snapshot.purchasedQuantity - snapshot.alreadyRefundedQuantity;
    if (requestedQuantity > remainingQuantity) {
        throw new Error(
            `Requested refund quantity ${requestedQuantity} exceeds remaining quantity ${remainingQuantity}.`,
        );
    }

    const sellerComponentTotal = Number(snapshot.commissionMinor) + Number(snapshot.vendorNetMinor);
    const discountedGrossTotal = Number(snapshot.grossMinor) - Number(snapshot.discountMinor);
    if (discountedGrossTotal < 0 || sellerComponentTotal !== discountedGrossTotal) {
        throw new Error(
            `Order item ${snapshot.orderItemId} seller components do not reconcile to gross minus discount.`,
        );
    }

    const startIndex = snapshot.alreadyRefundedQuantity;
    const grossMinor = sumAllocatedUnitRange(
        snapshot.grossMinor,
        snapshot.purchasedQuantity,
        startIndex,
        requestedQuantity,
    );
    const discountReversalMinor = sumAllocatedUnitRange(
        snapshot.discountMinor,
        snapshot.purchasedQuantity,
        startIndex,
        requestedQuantity,
    );
    const commissionReversalMinor = sumAllocatedUnitRange(
        snapshot.commissionMinor,
        snapshot.purchasedQuantity,
        startIndex,
        requestedQuantity,
    );
    const shippingReversalMinor = sumAllocatedUnitRange(
        snapshot.shippingMinor,
        snapshot.purchasedQuantity,
        startIndex,
        requestedQuantity,
    );
    const taxReversalMinor = sumAllocatedUnitRange(
        snapshot.taxMinor,
        snapshot.purchasedQuantity,
        startIndex,
        requestedQuantity,
    );
    const netSellerAmountMinor = grossMinor - discountReversalMinor;
    const vendorNetReversalMinor = netSellerAmountMinor - commissionReversalMinor;
    if (vendorNetReversalMinor < 0) {
        throw new Error(
            `Order item ${snapshot.orderItemId} commission exceeds the refundable seller amount.`,
        );
    }
    const refundAmountMinor =
        netSellerAmountMinor + shippingReversalMinor + taxReversalMinor;

    return {
        orderItemId: snapshot.orderItemId,
        vendorOrderId: snapshot.vendorOrderId,
        vendorId: snapshot.vendorId,
        quantity: requestedQuantity,
        refundAmountMinor,
        grossMinor,
        discountReversalMinor,
        shippingReversalMinor,
        taxReversalMinor,
        commissionReversalMinor,
        vendorNetReversalMinor,
    };
}

export interface CompletedMarketplaceRefundCommandInput {
    refundId: string;
    orderId: string;
    orderPaymentId?: string | null;
    gateway?: string | null;
    providerRefundId?: string | null;
    currency: string;
    reason?: string | null;
    actorUserId?: string | null;
    claimKey: string;
    allocations: MarketplaceRefundItemAllocation[];
    completedAt: Date;
}

export interface CompletedMarketplaceRefundCommandDependencies {
    createOutboxStatement?: (
        db: Database,
        input: BuildDomainOutboxEventInput,
    ) => BatchItem<"sqlite">;
}

export function buildCompletedMarketplaceRefundStatements(
    db: Database,
    input: CompletedMarketplaceRefundCommandInput,
    dependencies: CompletedMarketplaceRefundCommandDependencies = {},
): { statements: BatchItem<"sqlite">[]; amountMinor: number } {
    if (input.refundId.trim().length === 0) throw new Error("Refund ID is required.");
    if (input.orderId.trim().length === 0) throw new Error("Order ID is required.");
    if (input.currency.trim().length === 0) throw new Error("Refund currency is required.");
    if (input.claimKey.trim().length === 0) throw new Error("Refund claim key is required.");
    if (!(input.completedAt instanceof Date) || Number.isNaN(input.completedAt.getTime())) {
        throw new Error("Refund completion time must be valid.");
    }
    if (input.allocations.length === 0) {
        throw new Error("A marketplace refund requires at least one item allocation.");
    }

    const seenOrderItems = new Set<string>();
    let amountMinor = 0;
    for (const allocation of input.allocations) {
        if (seenOrderItems.has(allocation.orderItemId)) {
            throw new Error(`Duplicate refund allocation for order item ${allocation.orderItemId}.`);
        }
        seenOrderItems.add(allocation.orderItemId);
        assertPositiveInteger(allocation.quantity, "Refund allocation quantity");
        for (const [label, value] of Object.entries({
            refundAmountMinor: allocation.refundAmountMinor,
            grossMinor: allocation.grossMinor,
            discountReversalMinor: allocation.discountReversalMinor,
            shippingReversalMinor: allocation.shippingReversalMinor,
            taxReversalMinor: allocation.taxReversalMinor,
            commissionReversalMinor: allocation.commissionReversalMinor,
            vendorNetReversalMinor: allocation.vendorNetReversalMinor,
        })) {
            assertNonNegativeInteger(value, label);
        }
        const sellerComponents =
            allocation.commissionReversalMinor + allocation.vendorNetReversalMinor;
        if (sellerComponents !== allocation.grossMinor - allocation.discountReversalMinor) {
            throw new Error(
                `Refund allocation ${allocation.orderItemId} seller components do not reconcile.`,
            );
        }
        const expectedRefundAmount =
            sellerComponents + allocation.shippingReversalMinor + allocation.taxReversalMinor;
        if (expectedRefundAmount !== allocation.refundAmountMinor) {
            throw new Error(
                `Refund allocation ${allocation.orderItemId} does not reconcile to its refund amount.`,
            );
        }
        amountMinor += allocation.refundAmountMinor;
        assertNonNegativeInteger(amountMinor, "Refund total");
    }
    if (amountMinor <= 0) throw new Error("Refund amount must be greater than zero.");

    const createOutboxStatement =
        dependencies.createOutboxStatement ?? createDomainOutboxInsertStatement;
    const refundStatement = db.insert(refunds).values({
        id: input.refundId,
        orderId: input.orderId,
        orderPaymentId: input.orderPaymentId ?? null,
        gateway: input.gateway ?? null,
        providerRefundId: input.providerRefundId ?? null,
        status: "completed",
        currency: input.currency,
        amountMinor,
        reason: input.reason ?? null,
        actorUserId: input.actorUserId ?? null,
        claimKey: input.claimKey,
        requestedAt: input.completedAt,
        completedAt: input.completedAt,
        createdAt: input.completedAt,
        updatedAt: input.completedAt,
    }) as BatchItem<"sqlite">;
    const itemStatement = db.insert(refundItems).values(input.allocations.map((allocation) => ({
        id: `${input.refundId}:item:${allocation.orderItemId}`,
        refundId: input.refundId,
        orderItemId: allocation.orderItemId,
        vendorId: allocation.vendorId,
        quantity: allocation.quantity,
        refundAmountMinor: allocation.refundAmountMinor,
        grossMinor: allocation.grossMinor,
        discountReversalMinor: allocation.discountReversalMinor,
        shippingReversalMinor: allocation.shippingReversalMinor,
        taxReversalMinor: allocation.taxReversalMinor,
        commissionReversalMinor: allocation.commissionReversalMinor,
        vendorNetReversalMinor: allocation.vendorNetReversalMinor,
        createdAt: input.completedAt,
    }))) as BatchItem<"sqlite">;
    const outboxStatement = createOutboxStatement(db, {
        eventKey: `refund:${input.refundId}:completed`,
        aggregateType: "refund",
        aggregateId: input.refundId,
        eventType: "refund.completed",
        payload: {
            refundId: input.refundId,
            orderId: input.orderId,
            amountMinor,
            currency: input.currency,
        },
        createdAt: input.completedAt,
    });

    return {
        statements: [refundStatement, itemStatement, outboxStatement],
        amountMinor,
    };
}

export async function createCompletedMarketplaceRefundCommand(
    db: Database,
    input: CompletedMarketplaceRefundCommandInput,
    dependencies: CompletedMarketplaceRefundCommandDependencies = {},
): Promise<{ refundId: string; amountMinor: number }> {
    const { statements, amountMinor } = buildCompletedMarketplaceRefundStatements(
        db,
        input,
        dependencies,
    );
    await safeBatch(db, statements);
    return { refundId: input.refundId, amountMinor };
}
