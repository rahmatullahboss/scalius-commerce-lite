import type { Database } from "@scalius/database/client";
import { vendorShipments, type VendorShipmentStatus } from "@scalius/database/schema";
import { and, eq } from "drizzle-orm";
import {
    planVendorShipmentTransitionPath,
    updateVendorShipmentStatus,
} from "./shipment";

export interface VendorShipmentProviderStatusInput {
    providerType: string;
    providerId?: string | null;
    externalId?: string | null;
    merchantReference?: string | null;
    trackingId?: string | null;
    trackingUrl?: string | null;
    rawStatus: string;
    status: VendorShipmentStatus;
}

export interface VendorShipmentProviderStatusDependencies {
    updateVendorShipmentStatus: typeof updateVendorShipmentStatus;
}

const DEFAULT_DEPENDENCIES: VendorShipmentProviderStatusDependencies = {
    updateVendorShipmentStatus,
};

export interface VendorShipmentProjectionRow {
    shipmentId: string;
    orderId: string;
    vendorId: string;
    providerId: string | null;
    providerType: string;
    externalId: string | null;
    trackingId: string | null;
    status: VendorShipmentStatus;
    version: number;
}

export interface VendorShipmentProviderStatusResult {
    shipmentId: string;
    orderId: string;
    vendorId: string;
    previousStatus: VendorShipmentStatus;
    status: VendorShipmentStatus;
    version: number;
    applied: boolean;
    path: VendorShipmentStatus[] | null;
    parentOrderStatusUpdate?: NonNullable<
        Awaited<ReturnType<typeof updateVendorShipmentStatus>>["parentOrderStatusUpdate"]
    >;
}

function isCanonicalShipmentRow(
    value: unknown,
    expectedProviderType: string,
    expectedProviderId?: string | null,
): value is VendorShipmentProjectionRow {
    if (!value || typeof value !== "object") return false;
    const row = value as Partial<VendorShipmentProjectionRow>;
    return typeof row.shipmentId === "string"
        && typeof row.orderId === "string"
        && typeof row.vendorId === "string"
        && row.providerType === expectedProviderType
        && (!expectedProviderId || row.providerId === expectedProviderId)
        && typeof row.status === "string"
        && Number.isInteger(row.version)
        && Number(row.version) > 0;
}

function selectProjection(db: Database) {
    return db.select({
        shipmentId: vendorShipments.id,
        orderId: vendorShipments.orderId,
        vendorId: vendorShipments.vendorId,
        providerId: vendorShipments.providerId,
        providerType: vendorShipments.providerType,
        externalId: vendorShipments.externalId,
        trackingId: vendorShipments.trackingId,
        status: vendorShipments.status,
        version: vendorShipments.version,
    }).from(vendorShipments);
}

export async function resolveVendorShipmentProviderStatusTarget(
    db: Database,
    input: VendorShipmentProviderStatusInput,
): Promise<VendorShipmentProjectionRow | null> {
    if (input.externalId) {
        const byExternalId = await selectProjection(db)
            .where(and(
                eq(vendorShipments.providerType, input.providerType),
                input.providerId ? eq(vendorShipments.providerId, input.providerId) : undefined,
                eq(vendorShipments.externalId, input.externalId),
            ))
            .get();
        if (isCanonicalShipmentRow(byExternalId, input.providerType, input.providerId)) return byExternalId;
    }
    if (input.merchantReference) {
        const byMerchantReference = await selectProjection(db)
            .where(and(
                eq(vendorShipments.providerType, input.providerType),
                input.providerId ? eq(vendorShipments.providerId, input.providerId) : undefined,
                eq(vendorShipments.id, input.merchantReference),
            ))
            .get();
        if (isCanonicalShipmentRow(byMerchantReference, input.providerType, input.providerId)) return byMerchantReference;
    }
    if (input.trackingId) {
        const byTrackingId = await selectProjection(db)
            .where(and(
                eq(vendorShipments.providerType, input.providerType),
                input.providerId ? eq(vendorShipments.providerId, input.providerId) : undefined,
                eq(vendorShipments.trackingId, input.trackingId),
            ))
            .get();
        if (isCanonicalShipmentRow(byTrackingId, input.providerType, input.providerId)) return byTrackingId;
    }
    return null;
}

export async function projectVendorShipmentProviderStatus(
    db: Database,
    input: VendorShipmentProviderStatusInput,
    dependencies: VendorShipmentProviderStatusDependencies = DEFAULT_DEPENDENCIES,
): Promise<VendorShipmentProviderStatusResult | null> {
    const shipment = await resolveVendorShipmentProviderStatusTarget(db, input);
    if (!shipment) return null;

    const path = planVendorShipmentTransitionPath(shipment.status, input.status);
    if (path === null) {
        return {
            shipmentId: shipment.shipmentId,
            orderId: shipment.orderId,
            vendorId: shipment.vendorId,
            previousStatus: shipment.status,
            status: shipment.status,
            version: shipment.version,
            applied: false,
            path: null,
        };
    }

    const steps = path.length === 0 ? [shipment.status] : path;
    let version = shipment.version;
    let status = shipment.status;
    let parentOrderStatusUpdate: VendorShipmentProviderStatusResult["parentOrderStatusUpdate"];
    for (const [index, nextStatus] of steps.entries()) {
        const isFinal = index === steps.length - 1;
        const result = await dependencies.updateVendorShipmentStatus(db, {
            shipmentId: shipment.shipmentId,
            vendorId: shipment.vendorId,
            expectedVersion: version,
            status: nextStatus,
            rawStatus: isFinal ? input.rawStatus : undefined,
            externalId: isFinal ? input.externalId : undefined,
            trackingId: isFinal ? input.trackingId : undefined,
            trackingUrl: isFinal ? input.trackingUrl : undefined,
        });
        version = result.version;
        status = result.status;
        if (result.parentOrderStatusUpdate) {
            parentOrderStatusUpdate = result.parentOrderStatusUpdate;
        }
    }

    return {
        shipmentId: shipment.shipmentId,
        orderId: shipment.orderId,
        vendorId: shipment.vendorId,
        previousStatus: shipment.status,
        status,
        version,
        applied: true,
        path,
        ...(parentOrderStatusUpdate ? { parentOrderStatusUpdate } : {}),
    };
}
