export interface CustomerShipmentItemView {
    orderItemId: string;
    quantity: number;
    productName: string | null;
    variantLabel: string | null;
}

export interface CustomerOrderShipmentView {
    id: string;
    scope: "order" | "vendor";
    vendorOrderId: string | null;
    vendorName: string | null;
    vendorSlug: string | null;
    providerType: string;
    providerName: string | null;
    status: string;
    rawStatus: string | null;
    trackingId: string | null;
    trackingUrl: string | null;
    courierName: string | null;
    note: string | null;
    shipmentAmount: number | null;
    isFinalShipment: boolean;
    lastChecked: string | null;
    updatedAt: string | null;
    createdAt: string | null;
    items: CustomerShipmentItemView[];
}

export interface LegacyCustomerShipmentRow {
    id: string;
    providerType: string;
    providerName: string | null;
    status: string;
    rawStatus: string | null;
    trackingId: string | null;
    trackingUrl: string | null;
    courierName: string | null;
    note: string | null;
    shipmentAmount: number | null;
    isFinalShipment: boolean;
    lastChecked: number | null;
    updatedAt: number | null;
    createdAt: number | null;
}

export interface VendorCustomerShipmentRow {
    id: string;
    vendorOrderId: string;
    vendorId: string;
    vendorName: string;
    vendorSlug: string;
    providerType: string;
    providerName: string | null;
    status: string;
    rawStatus: string | null;
    trackingId: string | null;
    trackingUrl: string | null;
    courierName: string | null;
    shipmentAmountMinor: number;
    isFinalShipment: boolean;
    lastCheckedAt: number | null;
    updatedAt: number | null;
    createdAt: number | null;
}

export interface VendorCustomerShipmentItemRow extends CustomerShipmentItemView {
    shipmentId: string;
}

function timestampToIso(timestamp: number | null): string | null {
    if (!timestamp) return null;
    return new Date(timestamp * 1000).toISOString();
}

function sortTimestamp(shipment: CustomerOrderShipmentView): number {
    const value = shipment.lastChecked ?? shipment.updatedAt ?? shipment.createdAt;
    return value ? new Date(value).getTime() : 0;
}

export function formatCustomerOrderShipmentViews(input: {
    legacyShipments: LegacyCustomerShipmentRow[];
    vendorShipments: VendorCustomerShipmentRow[];
    vendorShipmentItems: VendorCustomerShipmentItemRow[];
}): CustomerOrderShipmentView[] {
    const itemsByShipment = new Map<string, CustomerShipmentItemView[]>();
    for (const item of input.vendorShipmentItems) {
        const items = itemsByShipment.get(item.shipmentId) ?? [];
        items.push({
            orderItemId: item.orderItemId,
            quantity: item.quantity,
            productName: item.productName,
            variantLabel: item.variantLabel,
        });
        itemsByShipment.set(item.shipmentId, items);
    }

    const legacyViews: CustomerOrderShipmentView[] = input.legacyShipments.map((shipment) => ({
        id: shipment.id,
        scope: "order",
        vendorOrderId: null,
        vendorName: null,
        vendorSlug: null,
        providerType: shipment.providerType,
        providerName: shipment.providerName,
        status: shipment.status,
        rawStatus: shipment.rawStatus,
        trackingId: shipment.trackingId,
        trackingUrl: shipment.trackingUrl,
        courierName: shipment.courierName,
        note: shipment.note,
        shipmentAmount: shipment.shipmentAmount,
        isFinalShipment: shipment.isFinalShipment,
        lastChecked: timestampToIso(shipment.lastChecked),
        updatedAt: timestampToIso(shipment.updatedAt),
        createdAt: timestampToIso(shipment.createdAt),
        items: [],
    }));

    const vendorViews: CustomerOrderShipmentView[] = input.vendorShipments.map((shipment) => ({
        id: shipment.id,
        scope: "vendor",
        vendorOrderId: shipment.vendorOrderId,
        vendorName: shipment.vendorName,
        vendorSlug: shipment.vendorSlug,
        providerType: shipment.providerType,
        providerName: shipment.providerName,
        status: shipment.status,
        rawStatus: shipment.rawStatus,
        trackingId: shipment.trackingId,
        trackingUrl: shipment.trackingUrl,
        courierName: shipment.courierName,
        note: null,
        shipmentAmount: shipment.shipmentAmountMinor / 100,
        isFinalShipment: shipment.isFinalShipment,
        lastChecked: timestampToIso(shipment.lastCheckedAt),
        updatedAt: timestampToIso(shipment.updatedAt),
        createdAt: timestampToIso(shipment.createdAt),
        items: itemsByShipment.get(shipment.id) ?? [],
    }));

    return [...legacyViews, ...vendorViews].sort((a, b) => sortTimestamp(b) - sortTimestamp(a));
}

export function getLatestCustomerOrderShipment(shipments: CustomerOrderShipmentView[]): CustomerOrderShipmentView | null {
    return shipments[0] ?? null;
}
