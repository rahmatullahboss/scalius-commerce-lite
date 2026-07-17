import { describe, expect, it, vi } from "vitest";
import {
  projectVendorShipmentProviderStatus,
  type VendorShipmentProviderStatusDependencies,
} from "./provider-shipment-status";

function createDb(results: unknown[]) {
  const queue = [...results];
  const chain = {
    where: vi.fn(() => chain),
    get: vi.fn(async () => queue.shift() ?? null),
  };
  return {
    select: vi.fn(() => ({ from: vi.fn(() => chain) })),
  };
}

function dependencies() {
  const updates: Array<Record<string, unknown>> = [];
  const updateVendorShipmentStatus = vi.fn(async (_db, input) => {
    updates.push(input as unknown as Record<string, unknown>);
    return {
      shipmentId: input.shipmentId,
      status: input.status,
      version: input.expectedVersion + 1,
      ...(input.status === "delivered" ? {
        parentOrderStatusUpdate: {
          orderId: "order_1",
          previousStatus: "shipped",
          newStatus: "delivered",
          fulfillmentStatus: "complete" as const,
          version: 5,
          changed: true,
        },
      } : {}),
    };
  });
  const deps: VendorShipmentProviderStatusDependencies = { updateVendorShipmentStatus };
  return { deps, updates, updateVendorShipmentStatus };
}

const shipment = {
  shipmentId: "vendor_shipment_1",
  orderId: "order_1",
  vendorId: "vendor_1",
  providerType: "pathao",
  externalId: "consignment_1",
  trackingId: "tracking_1",
  status: "processing",
  version: 2,
};

describe("seller shipment provider webhook projection", () => {
  it("bridges skipped provider states through valid canonical transitions", async () => {
    const db = createDb([shipment]);
    const { deps, updates } = dependencies();

    await expect(projectVendorShipmentProviderStatus(db as never, {
      providerType: "pathao",
      externalId: "consignment_1",
      rawStatus: "order.delivered",
      status: "delivered",
    }, deps)).resolves.toEqual({
      shipmentId: "vendor_shipment_1",
      orderId: "order_1",
      vendorId: "vendor_1",
      previousStatus: "processing",
      status: "delivered",
      version: 4,
      applied: true,
      path: ["in_transit", "delivered"],
      parentOrderStatusUpdate: {
        orderId: "order_1",
        previousStatus: "shipped",
        newStatus: "delivered",
        fulfillmentStatus: "complete",
        version: 5,
        changed: true,
      },
    });
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ expectedVersion: 2, status: "in_transit" });
    expect(updates[1]).toMatchObject({
      expectedVersion: 3,
      status: "delivered",
      rawStatus: "order.delivered",
      externalId: "consignment_1",
    });
  });

  it("falls back to the provider merchant reference when no external ID match exists", async () => {
    const db = createDb([null, { ...shipment, externalId: null, providerType: "steadfast" }]);
    const { deps, updates } = dependencies();

    const result = await projectVendorShipmentProviderStatus(db as never, {
      providerType: "steadfast",
      externalId: "12",
      merchantReference: "vendor_shipment_1",
      rawStatus: "in_delivery",
      status: "in_transit",
      trackingId: "tracking_12",
      trackingUrl: "https://tracking.example/tracking_12",
    }, deps);

    expect(result?.shipmentId).toBe("vendor_shipment_1");
    expect(updates.at(-1)).toMatchObject({
      externalId: "12",
      trackingId: "tracking_12",
      trackingUrl: "https://tracking.example/tracking_12",
    });
  });

  it("ignores backward or terminal provider regressions", async () => {
    const db = createDb([{ ...shipment, status: "delivered", version: 8 }]);
    const { deps, updateVendorShipmentStatus } = dependencies();

    await expect(projectVendorShipmentProviderStatus(db as never, {
      providerType: "pathao",
      externalId: "consignment_1",
      rawStatus: "order.in_transit",
      status: "in_transit",
    }, deps)).resolves.toMatchObject({
      applied: false,
      previousStatus: "delivered",
      status: "delivered",
      path: null,
    });
    expect(updateVendorShipmentStatus).not.toHaveBeenCalled();
  });

  it("persists a same-status raw provider update", async () => {
    const db = createDb([shipment]);
    const { deps, updates } = dependencies();

    await projectVendorShipmentProviderStatus(db as never, {
      providerType: "pathao",
      externalId: "consignment_1",
      rawStatus: "order.processing",
      status: "processing",
    }, deps);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      expectedVersion: 2,
      status: "processing",
      rawStatus: "order.processing",
    });
  });

  it("returns null when the webhook does not belong to a canonical seller shipment", async () => {
    const db = createDb([null, null, null]);
    const { deps, updateVendorShipmentStatus } = dependencies();

    await expect(projectVendorShipmentProviderStatus(db as never, {
      providerType: "steadfast",
      externalId: "missing",
      merchantReference: "missing-invoice",
      trackingId: "missing-tracking",
      rawStatus: "delivered",
      status: "delivered",
    }, deps)).resolves.toBeNull();
    expect(updateVendorShipmentStatus).not.toHaveBeenCalled();
  });
});
