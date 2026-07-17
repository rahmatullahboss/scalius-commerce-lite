import { safeBatch, type Database } from "@scalius/database/client";
import {
    orderItems,
    vendorOrders,
    vendorShipmentItems,
    vendorShipments,
    type VendorShipmentMetadata,
    type VendorShipmentStatus,
} from "@scalius/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { projectParentOrderFulfillment } from "./order-fulfillment-projection";

const MAX_SHIPMENT_METADATA_BYTES = 8 * 1024;
const SENSITIVE_SHIPMENT_KEY = /(?:password|passcode|secret|token|credential|api[_-]?key|private[_-]?key|authorization|cookie)/i;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const VENDOR_SHIPMENT_TRANSITIONS: Record<VendorShipmentStatus, ReadonlySet<VendorShipmentStatus>> = {
    pending: new Set(["processing", "pickup_assigned", "cancelled", "failed"]),
    processing: new Set(["pickup_assigned", "picked_up", "in_transit", "cancelled", "failed"]),
    pickup_assigned: new Set(["picked_up", "pickup_failed", "cancelled"]),
    picked_up: new Set(["in_transit", "returned"]),
    pickup_failed: new Set(["pickup_assigned", "cancelled", "failed"]),
    in_transit: new Set([
        "out_for_delivery",
        "delivered",
        "partial_delivered",
        "delivery_failed",
        "on_hold",
        "returned",
    ]),
    out_for_delivery: new Set([
        "delivered",
        "partial_delivered",
        "delivery_failed",
        "on_hold",
        "returned",
    ]),
    delivered: new Set(),
    partial_delivered: new Set(["delivered", "returned"]),
    delivery_failed: new Set(["out_for_delivery", "returned", "cancelled"]),
    on_hold: new Set(["in_transit", "out_for_delivery", "returned", "cancelled"]),
    failed: new Set(),
    returned: new Set(),
    cancelled: new Set(),
};

export function canTransitionVendorShipment(
    current: VendorShipmentStatus,
    next: VendorShipmentStatus,
): boolean {
    return current === next || VENDOR_SHIPMENT_TRANSITIONS[current].has(next);
}

export function planVendorShipmentTransitionPath(
    current: VendorShipmentStatus,
    target: VendorShipmentStatus,
): VendorShipmentStatus[] | null {
    if (current === target) return [];
    const queue: Array<{ status: VendorShipmentStatus; path: VendorShipmentStatus[] }> = [
        { status: current, path: [] },
    ];
    const visited = new Set<VendorShipmentStatus>([current]);
    while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) break;
        for (const next of VENDOR_SHIPMENT_TRANSITIONS[entry.status]) {
            if (visited.has(next)) continue;
            const path = [...entry.path, next];
            if (next === target) return path;
            visited.add(next);
            queue.push({ status: next, path });
        }
    }
    return null;
}

function sanitizeJson(value: unknown, path: string, seen: WeakSet<object>): JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new ValidationError(`Shipment metadata ${path} is not finite`);
        return value;
    }
    if (typeof value !== "object" || value instanceof Date) {
        throw new ValidationError(`Shipment metadata ${path} is not JSON serializable`);
    }
    if (seen.has(value)) throw new ValidationError(`Shipment metadata ${path} is circular`);
    seen.add(value);
    if (Array.isArray(value)) {
        const result = value.map((entry, index) => sanitizeJson(entry, `${path}[${index}]`, seen));
        seen.delete(value);
        return result;
    }
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (SENSITIVE_SHIPMENT_KEY.test(key)) {
            throw new ValidationError(`Sensitive shipment metadata key is not allowed: ${key}`);
        }
        result[key] = sanitizeJson(entry, `${path}.${key}`, seen);
    }
    seen.delete(value);
    return result;
}

export function sanitizeVendorShipmentMetadata(
    metadata: Record<string, unknown> | null | undefined,
): VendorShipmentMetadata | null {
    if (metadata == null) return null;
    const sanitized = sanitizeJson(metadata, "metadata", new WeakSet());
    if (sanitized === null || Array.isArray(sanitized) || typeof sanitized !== "object") {
        throw new ValidationError("Shipment metadata must be an object");
    }
    const bytes = new TextEncoder().encode(JSON.stringify(sanitized)).byteLength;
    if (bytes > MAX_SHIPMENT_METADATA_BYTES) {
        throw new ValidationError(`Shipment metadata exceeds ${MAX_SHIPMENT_METADATA_BYTES} byte limit`);
    }
    return sanitized;
}

export interface CreateVendorShipmentInput {
    idempotencyKey: string;
    vendorId: string;
    vendorOrderId: string;
    items: Array<{ orderItemId: string; quantity: number }>;
    providerId?: string | null;
    providerType?: string;
    externalId?: string | null;
    trackingId?: string | null;
    trackingUrl?: string | null;
    courierName?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown> | null;
    shipmentAmountMinor?: number;
    isFinalShipment?: boolean;
    actorUserId?: string | null;
    now?: Date;
}

export interface VendorShipmentCommandResult {
    replayed: boolean;
    shipmentId: string;
    vendorOrderId: string;
    orderId: string;
    vendorId: string;
    status: VendorShipmentStatus;
    version: number;
}

function assertPositiveQuantity(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new ValidationError("Shipment item quantity must be a positive safe integer");
    }
}

export async function createVendorShipment(
    db: Database,
    input: CreateVendorShipmentInput,
): Promise<VendorShipmentCommandResult> {
    if (!input.idempotencyKey?.trim()) throw new ValidationError("Shipment idempotency key is required");
    if (!input.vendorId?.trim()) throw new ValidationError("Vendor ID is required");
    if (!input.vendorOrderId?.trim()) throw new ValidationError("Vendor order ID is required");
    if (!Array.isArray(input.items) || input.items.length === 0) {
        throw new ValidationError("Shipment requires at least one order item");
    }

    const existing = await db
        .select({
            shipmentId: vendorShipments.id,
            vendorOrderId: vendorShipments.vendorOrderId,
            orderId: vendorShipments.orderId,
            vendorId: vendorShipments.vendorId,
            status: vendorShipments.status,
            version: vendorShipments.version,
        })
        .from(vendorShipments)
        .where(eq(vendorShipments.idempotencyKey, input.idempotencyKey))
        .get();
    if (existing) {
        if (existing.vendorId !== input.vendorId || existing.vendorOrderId !== input.vendorOrderId) {
            throw new ConflictError("Shipment idempotency key was reused for another seller order");
        }
        return { replayed: true, ...existing };
    }

    const seenItemIds = new Set<string>();
    for (const item of input.items) {
        if (!item.orderItemId?.trim()) throw new ValidationError("Shipment order item ID is required");
        assertPositiveQuantity(item.quantity);
        if (seenItemIds.has(item.orderItemId)) {
            throw new ValidationError(`Duplicate shipment item ${item.orderItemId}`);
        }
        seenItemIds.add(item.orderItemId);
    }
    const shipmentAmountMinor = input.shipmentAmountMinor ?? 0;
    if (!Number.isSafeInteger(shipmentAmountMinor) || shipmentAmountMinor < 0) {
        throw new ValidationError("Shipment amount must be a non-negative safe integer");
    }

    const vendorOrder = await db
        .select({
            vendorOrderId: vendorOrders.id,
            orderId: vendorOrders.orderId,
            vendorId: vendorOrders.vendorId,
            status: vendorOrders.status,
        })
        .from(vendorOrders)
        .where(eq(vendorOrders.id, input.vendorOrderId))
        .get();
    if (!vendorOrder) throw new NotFoundError(`Vendor order ${input.vendorOrderId} not found`);
    if (vendorOrder.vendorId !== input.vendorId) {
        throw new ValidationError("Vendor order does not belong to the requested seller");
    }
    if (["delivered", "cancelled"].includes(vendorOrder.status)) {
        throw new ValidationError(`Cannot create a shipment for a ${vendorOrder.status} vendor order`);
    }

    const requestedItemIds = input.items.map((item) => item.orderItemId);
    const itemRows = await db
        .select({ orderItemId: orderItems.id, quantity: orderItems.quantity })
        .from(orderItems)
        .where(and(
            eq(orderItems.vendorOrderId, input.vendorOrderId),
            eq(orderItems.vendorIdSnapshot, input.vendorId),
            inArray(orderItems.id, requestedItemIds),
        ))
        .all();
    const itemById = new Map(itemRows.map((row) => [row.orderItemId, row]));
    for (const item of input.items) {
        const orderItem = itemById.get(item.orderItemId);
        if (!orderItem) {
            throw new ValidationError(`Order item ${item.orderItemId} does not belong to this seller order`);
        }
        if (item.quantity > orderItem.quantity) {
            throw new ValidationError(`Shipment quantity exceeds purchased quantity for ${item.orderItemId}`);
        }
    }

    const now = input.now ?? new Date();
    const shipmentId = `vendor_shipment:${input.idempotencyKey}`;
    const metadata = sanitizeVendorShipmentMetadata(input.metadata);
    const shipmentStatement = db.insert(vendorShipments).values({
        id: shipmentId,
        idempotencyKey: input.idempotencyKey,
        vendorOrderId: input.vendorOrderId,
        orderId: vendorOrder.orderId,
        vendorId: input.vendorId,
        providerId: input.providerId ?? null,
        providerType: input.providerType?.trim() || "manual",
        externalId: input.externalId ?? null,
        trackingId: input.trackingId ?? null,
        trackingUrl: input.trackingUrl ?? null,
        courierName: input.courierName ?? null,
        status: "pending",
        note: input.note ?? null,
        metadata,
        shipmentAmountMinor,
        isFinalShipment: input.isFinalShipment ?? false,
        version: 1,
        createdBy: input.actorUserId ?? null,
        createdAt: now,
        updatedAt: now,
    }) as BatchItem<"sqlite">;
    const itemStatement = db.insert(vendorShipmentItems).values(input.items.map((item) => ({
        id: `${shipmentId}:item:${item.orderItemId}`,
        shipmentId,
        orderItemId: item.orderItemId,
        quantity: item.quantity,
        createdAt: now,
    }))) as BatchItem<"sqlite">;

    try {
        await safeBatch(db, [shipmentStatement, itemStatement]);
    } catch (error: unknown) {
        const replay = await db
            .select({
                shipmentId: vendorShipments.id,
                vendorOrderId: vendorShipments.vendorOrderId,
                orderId: vendorShipments.orderId,
                vendorId: vendorShipments.vendorId,
                status: vendorShipments.status,
                version: vendorShipments.version,
            })
            .from(vendorShipments)
            .where(eq(vendorShipments.idempotencyKey, input.idempotencyKey))
            .get();
        if (replay && replay.vendorId === input.vendorId && replay.vendorOrderId === input.vendorOrderId) {
            return { replayed: true, ...replay };
        }
        throw error;
    }

    return {
        replayed: false,
        shipmentId,
        vendorOrderId: input.vendorOrderId,
        orderId: vendorOrder.orderId,
        vendorId: input.vendorId,
        status: "pending",
        version: 1,
    };
}

export interface UpdateVendorShipmentStatusInput {
    shipmentId: string;
    vendorId: string;
    expectedVersion: number;
    status: VendorShipmentStatus;
    rawStatus?: string | null;
    externalId?: string | null;
    trackingId?: string | null;
    trackingUrl?: string | null;
    courierName?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown> | null;
    now?: Date;
}

export interface VendorShipmentStatusCommandResult {
    shipmentId: string;
    status: VendorShipmentStatus;
    version: number;
    parentOrderStatusUpdate?: Awaited<ReturnType<typeof projectParentOrderFulfillment>>;
}

export async function updateVendorShipmentStatus(
    db: Database,
    input: UpdateVendorShipmentStatusInput,
): Promise<VendorShipmentStatusCommandResult> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0) {
        throw new ValidationError("Expected shipment version must be a positive safe integer");
    }
    const current = await db
        .select({
            shipmentId: vendorShipments.id,
            orderId: vendorShipments.orderId,
            vendorId: vendorShipments.vendorId,
            externalId: vendorShipments.externalId,
            status: vendorShipments.status,
            version: vendorShipments.version,
        })
        .from(vendorShipments)
        .where(and(
            eq(vendorShipments.id, input.shipmentId),
            eq(vendorShipments.vendorId, input.vendorId),
        ))
        .get();
    if (!current) throw new NotFoundError(`Seller shipment ${input.shipmentId} not found`);
    if (current.version !== input.expectedVersion) {
        throw new ConflictError("Seller shipment was modified concurrently");
    }
    if (
        current.externalId
        && input.externalId !== undefined
        && input.externalId !== null
        && input.externalId !== current.externalId
    ) {
        throw new ConflictError("Seller shipment provider external ID cannot be replaced");
    }
    const hasProjectionUpdate = [
        input.rawStatus,
        input.externalId,
        input.trackingId,
        input.trackingUrl,
        input.courierName,
        input.note,
        input.metadata,
    ].some((value) => value !== undefined);
    if (current.status === input.status && !hasProjectionUpdate) {
        return { shipmentId: current.shipmentId, status: current.status, version: current.version };
    }
    if (current.status !== input.status && !canTransitionVendorShipment(current.status, input.status)) {
        throw new ValidationError(
            `Cannot transition seller shipment from ${current.status} to ${input.status}`,
        );
    }

    const now = input.now ?? new Date();
    const nextVersion = current.version + 1;
    const metadata = input.metadata === undefined
        ? undefined
        : sanitizeVendorShipmentMetadata(input.metadata);
    const updateStatement = db
        .update(vendorShipments)
        .set({
            status: input.status,
            version: nextVersion,
            rawStatus: input.rawStatus,
            externalId: input.externalId,
            trackingId: input.trackingId,
            trackingUrl: input.trackingUrl,
            courierName: input.courierName,
            note: input.note,
            metadata,
            lastCheckedAt: now,
            pickedUpAt: input.status === "picked_up" ? now : undefined,
            deliveredAt: input.status === "delivered" ? now : undefined,
            cancelledAt: input.status === "cancelled" ? now : undefined,
            updatedAt: now,
        })
        .where(and(
            eq(vendorShipments.id, input.shipmentId),
            eq(vendorShipments.vendorId, input.vendorId),
            eq(vendorShipments.status, current.status),
            eq(vendorShipments.version, input.expectedVersion),
        ))
        .returning({ id: vendorShipments.id, version: vendorShipments.version }) as BatchItem<"sqlite">;
    const result = await safeBatch(db, [updateStatement]) as unknown[];
    const updated = result[0] as Array<{ id: string; version: number }> | undefined;
    if ((updated?.length ?? 0) === 0) {
        throw new ConflictError("Seller shipment was modified concurrently");
    }
    const parentOrderStatusUpdate = current.orderId
        ? await projectParentOrderFulfillment(db, current.orderId)
        : null;
    return {
        shipmentId: input.shipmentId,
        status: input.status,
        version: nextVersion,
        ...(parentOrderStatusUpdate ? { parentOrderStatusUpdate } : {}),
    };
}
