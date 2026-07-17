import { safeBatch, type Database } from "@scalius/database/client";
import { vendorOrders } from "@scalius/database/schema";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";

export type SellerVendorOrderStatus = "pending" | "processing" | "ready" | "shipped" | "delivered" | "cancelled";

const SELLER_ORDER_TRANSITIONS: Record<SellerVendorOrderStatus, ReadonlySet<SellerVendorOrderStatus>> = {
    pending: new Set(["processing"]),
    processing: new Set(["ready"]),
    ready: new Set(["processing"]),
    shipped: new Set(),
    delivered: new Set(),
    cancelled: new Set(),
};

export function canSellerTransitionVendorOrder(
    current: SellerVendorOrderStatus,
    next: SellerVendorOrderStatus,
): boolean {
    return current === next || SELLER_ORDER_TRANSITIONS[current].has(next);
}

export interface UpdateSellerVendorOrderStatusInput {
    vendorOrderId: string;
    vendorId: string;
    expectedVersion: number;
    status: SellerVendorOrderStatus;
    now?: Date;
}

export async function updateSellerVendorOrderStatus(
    db: Database,
    input: UpdateSellerVendorOrderStatusInput,
): Promise<{ vendorOrderId: string; status: SellerVendorOrderStatus; version: number }> {
    if (!input.vendorOrderId?.trim()) throw new ValidationError("Vendor order ID is required");
    if (!input.vendorId?.trim()) throw new ValidationError("Vendor ID is required");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0) {
        throw new ValidationError("Expected vendor-order version must be a positive safe integer");
    }

    const current = await db
        .select({
            vendorOrderId: vendorOrders.id,
            vendorId: vendorOrders.vendorId,
            status: vendorOrders.status,
            version: vendorOrders.version,
        })
        .from(vendorOrders)
        .where(and(
            eq(vendorOrders.id, input.vendorOrderId),
            eq(vendorOrders.vendorId, input.vendorId),
        ))
        .get();
    if (!current) throw new NotFoundError(`Seller fulfillment group ${input.vendorOrderId} not found`);
    if (current.version !== input.expectedVersion) {
        throw new ConflictError("Seller fulfillment group was modified concurrently");
    }
    if (current.status === input.status) {
        return {
            vendorOrderId: current.vendorOrderId,
            status: current.status,
            version: current.version,
        };
    }
    if (!canSellerTransitionVendorOrder(current.status, input.status)) {
        throw new ValidationError(
            `Seller cannot transition fulfillment group from ${current.status} to ${input.status}; shipment state owns shipped and delivered transitions`,
        );
    }

    const nextVersion = current.version + 1;
    const updateStatement = db
        .update(vendorOrders)
        .set({
            status: input.status,
            version: nextVersion,
            updatedAt: input.now ?? new Date(),
        })
        .where(and(
            eq(vendorOrders.id, input.vendorOrderId),
            eq(vendorOrders.vendorId, input.vendorId),
            eq(vendorOrders.status, current.status),
            eq(vendorOrders.version, input.expectedVersion),
        ))
        .returning({ id: vendorOrders.id, version: vendorOrders.version }) as BatchItem<"sqlite">;
    const result = await safeBatch(db, [updateStatement]) as unknown[];
    const updated = result[0] as Array<{ id: string; version: number }> | undefined;
    if ((updated?.length ?? 0) === 0) {
        throw new ConflictError("Seller fulfillment group was modified concurrently");
    }
    return {
        vendorOrderId: input.vendorOrderId,
        status: input.status,
        version: nextVersion,
    };
}
