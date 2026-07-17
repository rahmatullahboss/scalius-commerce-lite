import type { Database } from "@scalius/database/client";
import {
    orderItems,
    orders,
    vendorShipments,
    type Order,
    type VendorShipmentStatus,
} from "@scalius/database/schema";
import { eq, inArray } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../../errors";
import { createProvider } from "../delivery/factory";
import { getDeliveryProvider } from "../delivery/delivery.service";
import { getTrackingUrl } from "../delivery/tracking";
import type { ShipmentResult } from "../delivery/types";
import {
    createVendorShipment,
    updateVendorShipmentStatus,
    type CreateVendorShipmentInput,
    type VendorShipmentCommandResult,
} from "./shipment";

/**
 * Build the provider-facing order view for one canonical seller shipment.
 * Providers already use order.id as their merchant order/invoice reference,
 * so replacing only the view ID prevents collisions between seller packages
 * while preserving the immutable parent order row.
 */
export function buildVendorShipmentProviderOrder(
    order: Order,
    vendorShipmentId: string,
    shipmentAmountMinor: number,
): Order {
    if (!vendorShipmentId?.trim()) {
        throw new ValidationError("Vendor shipment ID is required for courier dispatch");
    }
    if (!Number.isSafeInteger(shipmentAmountMinor) || shipmentAmountMinor < 0) {
        throw new ValidationError("Shipment amount must be a non-negative safe integer");
    }

    const shipmentAmount = shipmentAmountMinor / 100;
    return {
        ...order,
        id: vendorShipmentId,
        totalAmount: shipmentAmount,
        paidAmount: 0,
        balanceDue: shipmentAmount,
    };
}

export interface VendorProviderShipmentDependencies {
    getDeliveryProvider: typeof getDeliveryProvider;
    createProvider: typeof createProvider;
    createVendorShipment: typeof createVendorShipment;
    updateVendorShipmentStatus: typeof updateVendorShipmentStatus;
    getTrackingUrl: typeof getTrackingUrl;
}

const DEFAULT_DEPENDENCIES: VendorProviderShipmentDependencies = {
    getDeliveryProvider,
    createProvider,
    createVendorShipment,
    updateVendorShipmentStatus,
    getTrackingUrl,
};

export type CreateVendorProviderShipmentInput = Omit<
    CreateVendorShipmentInput,
    "providerId" | "providerType" | "externalId" | "trackingId" | "trackingUrl" | "courierName"
> & {
    providerId: string;
};

export interface VendorProviderShipmentResult extends VendorShipmentCommandResult {
    success: boolean;
    message: string;
    externalId?: string | null;
    trackingId?: string | null;
    trackingUrl?: string | null;
    reconciliationRequired?: boolean;
}

const DIRECT_DISPATCH_STATUSES = new Set<VendorShipmentStatus>([
    "pickup_assigned",
    "picked_up",
    "in_transit",
    "cancelled",
    "failed",
]);

export function normalizeVendorProviderDispatchStatus(status: string | null | undefined): VendorShipmentStatus {
    if (status && DIRECT_DISPATCH_STATUSES.has(status as VendorShipmentStatus)) {
        return status as VendorShipmentStatus;
    }
    return "processing";
}

function providerRawStatus(result: ShipmentResult): string {
    const metadata = result.data?.metadata;
    const value = metadata?.order_status
        ?? metadata?.delivery_status
        ?? metadata?.status
        ?? result.data?.status;
    return typeof value === "string" && value.trim() ? value.slice(0, 500) : "provider_accepted";
}

function buildItemDescription(
    inputItems: Array<{ orderItemId: string; quantity: number }>,
    rows: Array<{ orderItemId: string; productName: string | null; variantLabel: string | null }>,
): string {
    const rowById = new Map(rows.map((row) => [row.orderItemId, row]));
    return inputItems.map((item) => {
        const row = rowById.get(item.orderItemId);
        if (!row) throw new NotFoundError(`Shipment order item ${item.orderItemId} not found`);
        const variant = row.variantLabel ? ` (${row.variantLabel})` : "";
        return `${row.productName || "Product"}${variant} x${item.quantity}`;
    }).join(", ");
}

async function readReplayProjection(db: Database, shipmentId: string) {
    return db.select({
        externalId: vendorShipments.externalId,
        trackingId: vendorShipments.trackingId,
        trackingUrl: vendorShipments.trackingUrl,
        providerType: vendorShipments.providerType,
        status: vendorShipments.status,
        version: vendorShipments.version,
    })
        .from(vendorShipments)
        .where(eq(vendorShipments.id, shipmentId))
        .get();
}

export async function createVendorProviderShipment(
    db: Database,
    input: CreateVendorProviderShipmentInput,
    encryptionKey: string,
    dependencies: VendorProviderShipmentDependencies = DEFAULT_DEPENDENCIES,
): Promise<VendorProviderShipmentResult> {
    if (!input.providerId?.trim()) throw new ValidationError("Delivery provider ID is required");
    if (!encryptionKey) throw new ValidationError("Credential encryption key is required for courier dispatch");

    const providerRecord = await dependencies.getDeliveryProvider(db, input.providerId);
    if (!providerRecord || !providerRecord.isActive) {
        throw new ValidationError("Delivery provider is missing or inactive");
    }

    const base = await dependencies.createVendorShipment(db, {
        ...input,
        providerId: providerRecord.id,
        providerType: providerRecord.type,
        courierName: providerRecord.name,
    });

    let dispatchVersion = base.version;
    if (base.replayed) {
        const projection = await readReplayProjection(db, base.shipmentId);
        if (!projection) throw new NotFoundError(`Seller shipment ${base.shipmentId} not found`);
        if (projection.externalId || projection.trackingId) {
            return {
                ...base,
                success: projection.status !== "failed" && projection.status !== "cancelled",
                message: "Courier shipment already exists",
                status: projection.status,
                version: projection.version,
                externalId: projection.externalId,
                trackingId: projection.trackingId,
                trackingUrl: projection.trackingUrl,
            };
        }
        if (projection.status === "processing") {
            return {
                ...base,
                success: false,
                message: "Courier dispatch may have succeeded but has no persisted provider reference",
                status: projection.status,
                version: projection.version,
                reconciliationRequired: true,
            };
        }
        if (projection.status !== "pending") {
            return {
                ...base,
                success: false,
                message: `Courier shipment is ${projection.status}`,
                status: projection.status,
                version: projection.version,
            };
        }
        dispatchVersion = projection.version;
    }

    const parentOrder = await db.select()
        .from(orders)
        .where(eq(orders.id, base.orderId))
        .get();
    if (!parentOrder) throw new NotFoundError(`Order ${base.orderId} not found`);

    const itemRows = await db.select({
        orderItemId: orderItems.id,
        productName: orderItems.productName,
        variantLabel: orderItems.variantLabel,
    })
        .from(orderItems)
        .where(inArray(orderItems.id, input.items.map((item) => item.orderItemId)))
        .all();
    const itemCount = input.items.reduce((sum, item) => sum + item.quantity, 0);
    const itemDescription = buildItemDescription(input.items, itemRows);
    const provider = await dependencies.createProvider(providerRecord, encryptionKey, db);
    const providerOrder = buildVendorShipmentProviderOrder(
        parentOrder,
        base.shipmentId,
        input.shipmentAmountMinor ?? 0,
    );

    const claimed = await dependencies.updateVendorShipmentStatus(db, {
        shipmentId: base.shipmentId,
        vendorId: base.vendorId,
        expectedVersion: dispatchVersion,
        status: "processing",
        rawStatus: "provider_dispatch_started",
    });

    let providerResult: ShipmentResult;
    try {
        providerResult = await provider.createShipment(providerOrder, {
            itemCount,
            itemDescription,
            codAmount: (input.shipmentAmountMinor ?? 0) / 100,
            note: input.note ?? undefined,
        });
    } catch (error: unknown) {
        providerResult = {
            success: false,
            message: error instanceof Error ? error.message : String(error),
        };
    }

    if (!providerResult.success || !providerResult.data) {
        try {
            const failed = await dependencies.updateVendorShipmentStatus(db, {
                shipmentId: base.shipmentId,
                vendorId: base.vendorId,
                expectedVersion: claimed.version,
                status: "failed",
                rawStatus: "provider_rejected",
            });
            return {
                ...base,
                success: false,
                message: providerResult.message,
                status: failed.status,
                version: failed.version,
            };
        } catch {
            return {
                ...base,
                success: false,
                message: providerResult.message,
                status: "processing",
                version: claimed.version,
                reconciliationRequired: true,
            };
        }
    }

    const normalizedStatus = normalizeVendorProviderDispatchStatus(providerResult.data.status);
    const trackingUrl = providerResult.data.trackingId
        ? dependencies.getTrackingUrl(providerRecord.type, providerResult.data.trackingId)
        : null;
    try {
        const updated = await dependencies.updateVendorShipmentStatus(db, {
            shipmentId: base.shipmentId,
            vendorId: base.vendorId,
            expectedVersion: claimed.version,
            status: normalizedStatus,
            rawStatus: providerRawStatus(providerResult),
            externalId: providerResult.data.externalId ?? null,
            trackingId: providerResult.data.trackingId ?? null,
            trackingUrl,
            courierName: providerRecord.name,
        });
        return {
            ...base,
            success: true,
            message: providerResult.message,
            status: updated.status,
            version: updated.version,
            externalId: providerResult.data.externalId ?? null,
            trackingId: providerResult.data.trackingId ?? null,
            trackingUrl,
        };
    } catch {
        return {
            ...base,
            success: true,
            message: `${providerResult.message} Local reconciliation is required.`,
            status: "processing",
            version: claimed.version,
            externalId: providerResult.data.externalId ?? null,
            trackingId: providerResult.data.trackingId ?? null,
            trackingUrl,
            reconciliationRequired: true,
        };
    }
}
