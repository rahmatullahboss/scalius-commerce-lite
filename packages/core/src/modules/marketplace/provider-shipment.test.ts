import { describe, expect, it, vi } from "vitest";
import type { Order } from "@scalius/database/schema";
import { ValidationError } from "../../errors";
import {
  createVendorProviderShipment,
  type VendorProviderShipmentDependencies,
} from "./provider-shipment";

function createDb(results: unknown[]) {
  const queue = [...results];
  const chain = {
    where: vi.fn(() => chain),
    get: vi.fn(async () => queue.shift() ?? null),
    all: vi.fn(async () => queue.shift() ?? []),
  };
  return {
    select: vi.fn(() => ({ from: vi.fn(() => chain) })),
  };
}

function dependencies(overrides: Partial<VendorProviderShipmentDependencies> = {}) {
  const createShipment = vi.fn(async () => ({
    success: true,
    message: "created",
    data: {
      externalId: "consignment_1",
      trackingId: "tracking_1",
      status: "pending",
      metadata: { order_status: "Pending" },
    },
  }));
  const deps: VendorProviderShipmentDependencies = {
    getDeliveryProvider: vi.fn(async () => ({
      id: "provider_1",
      name: "Pathao",
      type: "pathao",
      isActive: true,
    }) as never),
    createProvider: vi.fn(async () => ({ createShipment }) as never),
    createVendorShipment: vi.fn(async () => ({
      replayed: false,
      shipmentId: "vendor_shipment:shipment-key-1",
      vendorOrderId: "vendor_order_1",
      orderId: "order_1",
      vendorId: "vendor_1",
      status: "pending" as const,
      version: 1,
    })),
    updateVendorShipmentStatus: vi.fn(async (_db, update) => ({
      shipmentId: update.shipmentId,
      status: update.status,
      version: update.expectedVersion + 1,
    })),
    getTrackingUrl: vi.fn(() => "https://tracking.example/tracking_1"),
    ...overrides,
  };
  return { deps, createShipment };
}

const parentOrder = {
  id: "order_1",
  customerName: "Customer",
  customerPhone: "01700000000",
  shippingAddress: "Dhaka",
  city: "Dhaka",
  zone: "Dhanmondi",
  area: "Road 1",
  totalAmount: 1000,
  paidAmount: 0,
  balanceDue: 1000,
  notes: null,
} as unknown as Order;

const input = {
  idempotencyKey: "shipment-key-1",
  vendorId: "vendor_1",
  vendorOrderId: "vendor_order_1",
  providerId: "provider_1",
  items: [
    { orderItemId: "item_1", quantity: 1 },
    { orderItemId: "item_2", quantity: 2 },
  ],
  shipmentAmountMinor: 55000,
  note: "Handle carefully",
  actorUserId: "user_1",
};

describe("seller courier provider dispatch", () => {
  it("reuses the existing courier provider with seller-scoped items and reference", async () => {
    const db = createDb([
      parentOrder,
      [
        { orderItemId: "item_1", productName: "Item A", variantLabel: null },
        { orderItemId: "item_2", productName: "Item B", variantLabel: "Large" },
      ],
    ]);
    const { deps, createShipment } = dependencies();

    await expect(createVendorProviderShipment(
      db as never,
      input,
      "[REDACTED_SECRET]",
      deps,
    )).resolves.toMatchObject({
      success: true,
      replayed: false,
      shipmentId: "vendor_shipment:shipment-key-1",
      status: "processing",
      version: 3,
      externalId: "consignment_1",
      trackingId: "tracking_1",
    });

    expect(createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "vendor_shipment:shipment-key-1",
        totalAmount: 550,
        balanceDue: 550,
      }),
      expect.objectContaining({
        itemCount: 3,
        itemDescription: "Item A x1, Item B (Large) x2",
        codAmount: 550,
        note: "Handle carefully",
      }),
    );
    expect(deps.updateVendorShipmentStatus).toHaveBeenNthCalledWith(1, db, expect.objectContaining({
      expectedVersion: 1,
      status: "processing",
    }));
    expect(deps.updateVendorShipmentStatus).toHaveBeenNthCalledWith(2, db, expect.objectContaining({
      expectedVersion: 2,
      status: "processing",
      externalId: "consignment_1",
      trackingId: "tracking_1",
    }));
  });

  it("does not duplicate provider booking for an uncertain processing replay", async () => {
    const db = createDb([{
      externalId: null,
      trackingId: null,
      trackingUrl: null,
      providerType: "pathao",
      status: "processing",
      version: 2,
    }]);
    const { deps, createShipment } = dependencies({
      createVendorShipment: vi.fn(async () => ({
        replayed: true,
        shipmentId: "vendor_shipment:shipment-key-1",
        vendorOrderId: "vendor_order_1",
        orderId: "order_1",
        vendorId: "vendor_1",
        status: "processing" as const,
        version: 2,
      })),
    });

    await expect(createVendorProviderShipment(
      db as never,
      input,
      "[REDACTED_SECRET]",
      deps,
    )).resolves.toMatchObject({
      success: false,
      replayed: true,
      reconciliationRequired: true,
      status: "processing",
      version: 2,
    });
    expect(createShipment).not.toHaveBeenCalled();
    expect(deps.updateVendorShipmentStatus).not.toHaveBeenCalled();
  });

  it("marks the canonical seller shipment failed when the provider rejects it", async () => {
    const db = createDb([
      parentOrder,
      [{ orderItemId: "item_1", productName: "Item A", variantLabel: null }],
    ]);
    const { deps } = dependencies({
      createProvider: vi.fn(async () => ({
        createShipment: vi.fn(async () => ({ success: false, message: "provider rejected" })),
      }) as never),
    });

    await expect(createVendorProviderShipment(
      db as never,
      { ...input, items: [{ orderItemId: "item_1", quantity: 1 }] },
      "[REDACTED_SECRET]",
      deps,
    )).resolves.toMatchObject({
      success: false,
      status: "failed",
      version: 3,
    });
    expect(deps.updateVendorShipmentStatus).toHaveBeenNthCalledWith(2, db, expect.objectContaining({
      expectedVersion: 2,
      status: "failed",
      rawStatus: "provider_rejected",
    }));
  });

  it("rejects missing or inactive delivery providers before creating a shipment", async () => {
    const db = createDb([]);
    const { deps } = dependencies({
      getDeliveryProvider: vi.fn(async () => ({
        id: "provider_1",
        name: "Pathao",
        type: "pathao",
        isActive: false,
      }) as never),
    });

    await expect(createVendorProviderShipment(
      db as never,
      input,
      "[REDACTED_SECRET]",
      deps,
    )).rejects.toBeInstanceOf(ValidationError);
    expect(deps.createVendorShipment).not.toHaveBeenCalled();
  });
});
