import type { Database } from "@scalius/database/client";
import { orders, vendorOrders } from "@scalius/database/schema";
import { and, eq, sql } from "drizzle-orm";
import { ConflictError } from "../../errors";
import { applyInventoryForStatusChange } from "../inventory/inventory-transitions";
import { getAvailableTransitions } from "../orders/order-state-machine";

const TERMINAL_PARENT_STATUSES = new Set([
    "completed",
    "cancelled",
    "refunded",
    "returned",
    "partially_refunded",
]);

function canReachParentOrderStatus(currentStatus: string, targetStatus: string): boolean {
    if (currentStatus === targetStatus) return true;
    const queue = [currentStatus];
    const visited = new Set(queue);
    while (queue.length > 0) {
        const status = queue.shift();
        if (!status) break;
        for (const next of getAvailableTransitions("order", status)) {
            if (next === targetStatus) return true;
            if (!visited.has(next)) {
                visited.add(next);
                queue.push(next);
            }
        }
    }
    return false;
}

export interface VendorOrderFulfillmentState {
    status: string;
    fulfillmentStatus: string;
}

export interface ParentOrderFulfillmentPlanInput {
    currentStatus: string;
    currentFulfillmentStatus: string;
    vendorOrders: VendorOrderFulfillmentState[];
}

export interface ParentOrderFulfillmentPlan {
    status: string;
    fulfillmentStatus: "pending" | "partial" | "complete";
}

export function planParentOrderFulfillment(
    input: ParentOrderFulfillmentPlanInput,
): ParentOrderFulfillmentPlan {
    const activeVendorOrders = input.vendorOrders.filter((row) => row.status !== "cancelled");
    if (activeVendorOrders.length === 0) {
        return {
            status: input.currentStatus,
            fulfillmentStatus: input.currentFulfillmentStatus as ParentOrderFulfillmentPlan["fulfillmentStatus"],
        };
    }

    const allDelivered = activeVendorOrders.every(
        (row) => row.status === "delivered" || row.fulfillmentStatus === "complete",
    );
    const anyProgress = activeVendorOrders.some(
        (row) => ["shipped", "delivered"].includes(row.status)
            || ["partial", "complete"].includes(row.fulfillmentStatus),
    );

    const fulfillmentStatus: ParentOrderFulfillmentPlan["fulfillmentStatus"] = allDelivered
        ? "complete"
        : anyProgress
            ? "partial"
            : "pending";

    let status = input.currentStatus;
    if (!TERMINAL_PARENT_STATUSES.has(input.currentStatus)) {
        const desiredStatus = allDelivered ? "delivered" : anyProgress ? "shipped" : input.currentStatus;
        if (
            desiredStatus !== input.currentStatus &&
            canReachParentOrderStatus(input.currentStatus, desiredStatus)
        ) {
            status = desiredStatus;
        }
    }

    return { status, fulfillmentStatus };
}

export interface ParentOrderFulfillmentProjectionDependencies {
    applyInventoryForStatusChange: typeof applyInventoryForStatusChange;
}

const DEFAULT_DEPENDENCIES: ParentOrderFulfillmentProjectionDependencies = {
    applyInventoryForStatusChange,
};

export async function projectParentOrderFulfillment(
    db: Database,
    orderId: string,
    dependencies: ParentOrderFulfillmentProjectionDependencies = DEFAULT_DEPENDENCIES,
) {
    const order = await db.select({
        id: orders.id,
        status: orders.status,
        fulfillmentStatus: orders.fulfillmentStatus,
        version: orders.version,
    })
        .from(orders)
        .where(eq(orders.id, orderId))
        .get();
    if (!order) return null;

    const childOrders = await db.select({
        status: vendorOrders.status,
        fulfillmentStatus: vendorOrders.fulfillmentStatus,
    })
        .from(vendorOrders)
        .where(eq(vendorOrders.orderId, orderId))
        .all();
    if (childOrders.length === 0) return null;

    const plan = planParentOrderFulfillment({
        currentStatus: order.status,
        currentFulfillmentStatus: order.fulfillmentStatus,
        vendorOrders: childOrders,
    });
    if (plan.status === order.status && plan.fulfillmentStatus === order.fulfillmentStatus) {
        return {
            orderId,
            previousStatus: order.status,
            newStatus: order.status,
            fulfillmentStatus: order.fulfillmentStatus,
            version: order.version,
            changed: false,
        };
    }

    const nextVersion = order.version + 1;
    const updated = await db.update(orders)
        .set({
            status: plan.status,
            fulfillmentStatus: plan.fulfillmentStatus,
            version: nextVersion,
            updatedAt: sql`unixepoch()`,
        })
        .where(and(eq(orders.id, orderId), eq(orders.version, order.version)))
        .returning({ id: orders.id });
    if (updated.length === 0) {
        throw new ConflictError("Parent order fulfillment was modified concurrently");
    }

    if (plan.status !== order.status) {
        const inventoryAction = await dependencies.applyInventoryForStatusChange(db, orderId, plan.status);
        await db.update(orders)
            .set({ inventoryAction })
            .where(eq(orders.id, orderId));
    }

    return {
        orderId,
        previousStatus: order.status,
        newStatus: plan.status,
        fulfillmentStatus: plan.fulfillmentStatus,
        version: nextVersion,
        changed: true,
    };
}
