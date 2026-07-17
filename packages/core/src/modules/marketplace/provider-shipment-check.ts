import type { Database } from "@scalius/database/client";
import {
    vendorShipments,
    vendorShipmentStatuses,
    type VendorShipmentStatus,
} from "@scalius/database/schema";
import { and, eq } from "drizzle-orm";
import {
    NotFoundError,
    ServiceUnavailableError,
    ValidationError,
} from "../../errors";
import { createProvider } from "../delivery/factory";
import { getDeliveryProvider } from "../delivery/delivery.service";
import {
    projectVendorShipmentProviderStatus,
    type VendorShipmentProviderStatusResult,
} from "./provider-shipment-status";

export interface VendorProviderShipmentCheckDependencies {
    getDeliveryProvider: typeof getDeliveryProvider;
    createProvider: typeof createProvider;
    projectVendorShipmentProviderStatus: typeof projectVendorShipmentProviderStatus;
}

const DEFAULT_DEPENDENCIES: VendorProviderShipmentCheckDependencies = {
    getDeliveryProvider,
    createProvider,
    projectVendorShipmentProviderStatus,
};

export interface CheckVendorProviderShipmentStatusInput {
    shipmentId: string;
    vendorId: string;
}

export interface VendorProviderShipmentCheckResult {
    shipmentId: string;
    orderId: string;
    vendorId: string;
    externalId: string;
    trackingId: string | null;
    status: VendorShipmentStatus;
    rawStatus: string;
    version: number;
    applied: boolean;
    path: VendorShipmentProviderStatusResult["path"];
    checkedAt: string;
    parentOrderStatusUpdate?: VendorShipmentProviderStatusResult["parentOrderStatusUpdate"];
}

function normalizeCheckedStatus(status: string): VendorShipmentStatus | null {
    return vendorShipmentStatuses.includes(status as VendorShipmentStatus)
        ? status as VendorShipmentStatus
        : null;
}

export async function checkVendorProviderShipmentStatus(
    db: Database,
    input: CheckVendorProviderShipmentStatusInput,
    encryptionKey: string,
    dependencies: VendorProviderShipmentCheckDependencies = DEFAULT_DEPENDENCIES,
): Promise<VendorProviderShipmentCheckResult> {
    if (!input.shipmentId?.trim()) throw new ValidationError("Seller shipment ID is required");
    if (!input.vendorId?.trim()) throw new ValidationError("Vendor ID is required");
    if (!encryptionKey) {
        throw new ValidationError("Credential encryption key is required for courier status checks");
    }

    const shipment = await db.select({
        shipmentId: vendorShipments.id,
        orderId: vendorShipments.orderId,
        vendorId: vendorShipments.vendorId,
        providerId: vendorShipments.providerId,
        providerType: vendorShipments.providerType,
        externalId: vendorShipments.externalId,
        trackingId: vendorShipments.trackingId,
        status: vendorShipments.status,
        version: vendorShipments.version,
    })
        .from(vendorShipments)
        .where(and(
            eq(vendorShipments.id, input.shipmentId),
            eq(vendorShipments.vendorId, input.vendorId),
        ))
        .get();
    if (!shipment) throw new NotFoundError(`Seller shipment ${input.shipmentId} not found`);
    if (!shipment.providerId || shipment.providerType === "manual") {
        throw new ValidationError("Manual seller shipments do not support courier status checks");
    }
    if (!shipment.externalId) {
        throw new ValidationError("Seller shipment has no provider reference to check");
    }

    const providerRecord = await dependencies.getDeliveryProvider(db, shipment.providerId);
    if (!providerRecord || !providerRecord.isActive) {
        throw new ValidationError("Delivery provider is missing or inactive");
    }
    if (providerRecord.type !== shipment.providerType) {
        throw new ValidationError("Seller shipment provider identity does not match its configured provider");
    }

    let statusResult;
    try {
        const provider = await dependencies.createProvider(providerRecord, encryptionKey, db);
        statusResult = await provider.checkShipmentStatus(shipment.externalId);
    } catch (error: unknown) {
        throw new ServiceUnavailableError(
            `Courier status check failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    const status = normalizeCheckedStatus(statusResult.status);
    if (!status) {
        throw new ServiceUnavailableError("Courier status is currently unavailable; shipment was not changed");
    }
    const rawStatus = typeof statusResult.rawStatus === "string" && statusResult.rawStatus.trim()
        ? statusResult.rawStatus.slice(0, 500)
        : status;
    const projection = await dependencies.projectVendorShipmentProviderStatus(db, {
        providerType: shipment.providerType,
        providerId: shipment.providerId,
        externalId: shipment.externalId,
        trackingId: shipment.trackingId,
        rawStatus,
        status,
    });
    if (!projection) {
        throw new NotFoundError(`Seller shipment ${input.shipmentId} could not be projected`);
    }

    return {
        shipmentId: projection.shipmentId,
        orderId: projection.orderId,
        vendorId: projection.vendorId,
        externalId: shipment.externalId,
        trackingId: shipment.trackingId,
        status: projection.status,
        rawStatus,
        version: projection.version,
        applied: projection.applied,
        path: projection.path,
        checkedAt: statusResult.updatedAt.toISOString(),
        ...(projection.parentOrderStatusUpdate
            ? { parentOrderStatusUpdate: projection.parentOrderStatusUpdate }
            : {}),
    };
}
