import type { Database } from "@scalius/database/client";
import { orderItems, refundItems, refunds } from "@scalius/database/schema";
import { and, eq } from "drizzle-orm";
import {
    allocateMinorUnits,
    minorUnits,
    type MinorUnits,
} from "./money";
import {
    buildRefundItemAllocation,
    type MarketplaceRefundItemAllocation,
    type RefundableOrderItemSnapshot,
} from "./refund-allocation";

export type MarketplaceRefundPlanItem = Omit<
    RefundableOrderItemSnapshot,
    "shippingMinor" | "taxMinor"
>;

export interface MarketplaceRefundSelection {
    orderItemId: string;
    quantity: number;
}

export interface MarketplaceRefundPlanInput {
    currentPaidMinor: MinorUnits;
    requestedAmountMinor?: MinorUnits;
    selections?: MarketplaceRefundSelection[];
    items: MarketplaceRefundPlanItem[];
}

export interface MarketplaceRefundPlan {
    isFullRemainingRefund: boolean;
    amountMinor: number;
    allocations: MarketplaceRefundItemAllocation[];
}

function remainingQuantity(item: MarketplaceRefundPlanItem): number {
    return item.purchasedQuantity - item.alreadyRefundedQuantity;
}

function assertPositiveQuantity(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("Refund selection quantity must be a positive safe integer.");
    }
}

export function buildMarketplaceRefundPlan(
    input: MarketplaceRefundPlanInput,
): MarketplaceRefundPlan | null {
    if (input.items.length === 0) return null;
    if (Number(input.currentPaidMinor) <= 0) {
        throw new Error("Marketplace refund requires a positive current paid amount.");
    }

    const itemsById = new Map(input.items.map((item) => [item.orderItemId, item]));
    const remainingItems = input.items.filter((item) => remainingQuantity(item) > 0);
    if (remainingItems.length === 0) {
        throw new Error("This marketplace order has no remaining refundable item quantity.");
    }

    const requestedAmountMinor = input.requestedAmountMinor == null
        ? null
        : Number(input.requestedAmountMinor);
    const isRequestedFullPaidAmount = requestedAmountMinor == null ||
        requestedAmountMinor === Number(input.currentPaidMinor);

    if (!input.selections?.length && !isRequestedFullPaidAmount) {
        throw new Error(
            "Item and quantity selections are required for a partial marketplace refund.",
        );
    }

    const selections = input.selections?.length
        ? input.selections
        : remainingItems.map((item) => ({
            orderItemId: item.orderItemId,
            quantity: remainingQuantity(item),
        }));

    const seen = new Set<string>();
    const selectedQuantityByItem = new Map<string, number>();
    const allocations = selections.map((selection) => {
        assertPositiveQuantity(selection.quantity);
        if (seen.has(selection.orderItemId)) {
            throw new Error(`Duplicate refund selection for order item ${selection.orderItemId}.`);
        }
        seen.add(selection.orderItemId);

        const selectedItem = itemsById.get(selection.orderItemId);
        if (!selectedItem) {
            throw new Error(
                `Order item ${selection.orderItemId} is not part of this marketplace order.`,
            );
        }
        selectedQuantityByItem.set(selection.orderItemId, selection.quantity);
        return buildRefundItemAllocation(
            {
                ...selectedItem,
                shippingMinor: minorUnits(0),
                taxMinor: minorUnits(0),
            },
            selection.quantity,
        );
    });

    const isFullRemainingRefund = remainingItems.every(
        (item) => selectedQuantityByItem.get(item.orderItemId) === remainingQuantity(item),
    ) && selectedQuantityByItem.size === remainingItems.length;

    let itemAllocatedMinor = allocations.reduce(
        (sum, allocation) => sum + allocation.refundAmountMinor,
        0,
    );
    if (!Number.isSafeInteger(itemAllocatedMinor) || itemAllocatedMinor <= 0) {
        throw new Error("Selected marketplace item allocation must be positive.");
    }
    if (itemAllocatedMinor > Number(input.currentPaidMinor)) {
        throw new Error("Selected item allocation exceeds the current paid amount.");
    }

    if (isFullRemainingRefund) {
        const orderLevelRemainder = Number(input.currentPaidMinor) - itemAllocatedMinor;
        if (orderLevelRemainder > 0) {
            const shippingAllocations = allocateMinorUnits(
                minorUnits(orderLevelRemainder),
                allocations.map((allocation) =>
                    allocation.vendorNetReversalMinor + allocation.commissionReversalMinor,
                ),
            );
            for (const [index, allocation] of allocations.entries()) {
                const shipping = Number(shippingAllocations[index] ?? 0);
                allocation.shippingReversalMinor += shipping;
                allocation.refundAmountMinor += shipping;
            }
            itemAllocatedMinor += orderLevelRemainder;
        }
    }

    if (
        requestedAmountMinor != null &&
        requestedAmountMinor !== itemAllocatedMinor
    ) {
        throw new Error(
            `Requested refund amount ${requestedAmountMinor} does not match selected item allocation ${itemAllocatedMinor}.`,
        );
    }

    return {
        isFullRemainingRefund,
        amountMinor: itemAllocatedMinor,
        allocations,
    };
}

export interface LoadMarketplaceRefundPlanInput {
    orderId: string;
    currentPaidMinor: MinorUnits;
    requestedAmountMinor?: MinorUnits;
    selections?: MarketplaceRefundSelection[];
}

export async function loadMarketplaceRefundPlan(
    db: Database,
    input: LoadMarketplaceRefundPlanInput,
): Promise<MarketplaceRefundPlan | null> {
    const itemRows = await db
        .select({
            orderItemId: orderItems.id,
            vendorOrderId: orderItems.vendorOrderId,
            vendorId: orderItems.vendorIdSnapshot,
            purchasedQuantity: orderItems.quantity,
            grossMinor: orderItems.lineSubtotalMinor,
            discountMinor: orderItems.discountMinor,
            commissionMinor: orderItems.commissionMinor,
            vendorNetMinor: orderItems.vendorNetMinor,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, input.orderId))
        .all();

    if (itemRows.length === 0) return null;
    const marketplaceRows = itemRows.filter(
        (row) => row.vendorId != null || row.vendorOrderId != null,
    );
    if (marketplaceRows.length === 0) return null;
    if (marketplaceRows.length !== itemRows.length) {
        throw new Error(
            `Order ${input.orderId} has mixed seller snapshot authority and cannot be refunded safely.`,
        );
    }
    for (const row of marketplaceRows) {
        if (!row.vendorId || !row.vendorOrderId) {
            throw new Error(
                `Order item ${row.orderItemId} is missing its immutable marketplace seller snapshot.`,
            );
        }
    }

    const completedRefundRows = await db
        .select({
            orderItemId: refundItems.orderItemId,
            quantity: refundItems.quantity,
        })
        .from(refundItems)
        .innerJoin(refunds, eq(refunds.id, refundItems.refundId))
        .innerJoin(orderItems, eq(orderItems.id, refundItems.orderItemId))
        .where(and(
            eq(orderItems.orderId, input.orderId),
            eq(refunds.status, "completed"),
        ))
        .all();

    const refundedQuantityByItem = new Map<string, number>();
    for (const row of completedRefundRows) {
        refundedQuantityByItem.set(
            row.orderItemId,
            (refundedQuantityByItem.get(row.orderItemId) ?? 0) + row.quantity,
        );
    }

    return buildMarketplaceRefundPlan({
        currentPaidMinor: input.currentPaidMinor,
        requestedAmountMinor: input.requestedAmountMinor,
        selections: input.selections,
        items: marketplaceRows.map((row) => ({
            orderItemId: row.orderItemId,
            vendorOrderId: row.vendorOrderId!,
            vendorId: row.vendorId!,
            purchasedQuantity: row.purchasedQuantity,
            alreadyRefundedQuantity: refundedQuantityByItem.get(row.orderItemId) ?? 0,
            grossMinor: minorUnits(row.grossMinor),
            discountMinor: minorUnits(row.discountMinor),
            commissionMinor: minorUnits(row.commissionMinor),
            vendorNetMinor: minorUnits(row.vendorNetMinor),
        })),
    });
}
