import { describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "../../errors";
import {
  canTransitionVendorShipment,
  createVendorShipment,
  planVendorShipmentTransitionPath,
  sanitizeVendorShipmentMetadata,
  updateVendorShipmentStatus,
} from "./shipment";

function createDb(results: unknown[], batchResults: unknown[][] = []) {
  const queue = [...results];
  const chain = {
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    get: vi.fn(async () => queue.shift() ?? null),
    all: vi.fn(async () => queue.shift() ?? []),
  };
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; values: unknown }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: unknown) => {
      inserts.push({ table, values });
      return { kind: `insert_${inserts.length}` };
    }),
  }));
  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: unknown) => {
      updates.push({ table, values });
      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => ({ kind: `update_${updates.length}` })),
        })),
      };
    }),
  }));
  const batchQueue = [...batchResults];
  const batch = vi.fn(async (_statements: unknown[]) => batchQueue.shift() ?? []);
  return {
    db: { select: vi.fn(() => ({ from: vi.fn(() => chain) })), insert, update, batch },
    inserts,
    updates,
    batch,
  };
}

describe("seller shipment domain", () => {
  it("defines explicit shipment status transitions", () => {
    expect(canTransitionVendorShipment("pending", "processing")).toBe(true);
    expect(canTransitionVendorShipment("pending", "delivered")).toBe(false);
    expect(canTransitionVendorShipment("processing", "in_transit")).toBe(true);
    expect(canTransitionVendorShipment("in_transit", "out_for_delivery")).toBe(true);
    expect(canTransitionVendorShipment("out_for_delivery", "delivered")).toBe(true);
    expect(canTransitionVendorShipment("delivered", "returned")).toBe(false);
  });

  it("plans the shortest valid forward path for skipped provider events", () => {
    expect(planVendorShipmentTransitionPath("processing", "delivered")).toEqual([
      "in_transit",
      "delivered",
    ]);
    expect(planVendorShipmentTransitionPath("processing", "out_for_delivery")).toEqual([
      "in_transit",
      "out_for_delivery",
    ]);
    expect(planVendorShipmentTransitionPath("delivered", "in_transit")).toBeNull();
    expect(planVendorShipmentTransitionPath("processing", "processing")).toEqual([]);
  });

  it("rejects sensitive and oversized shipment metadata", () => {
    expect(() => sanitizeVendorShipmentMetadata({ accessToken: "secret" })).toThrow(/sensitive/i);
    expect(() => sanitizeVendorShipmentMetadata({ credentials: { key: "secret" } })).toThrow(/sensitive/i);
    expect(() => sanitizeVendorShipmentMetadata({ payload: "x".repeat(9_000) })).toThrow(/exceeds/i);
    expect(sanitizeVendorShipmentMetadata({ packageType: "box", fragile: true })).toEqual({
      packageType: "box",
      fragile: true,
    });
  });

  it("creates an idempotent seller shipment and immutable line allocation in one batch", async () => {
    const { db, inserts, batch } = createDb([
      null,
      {
        vendorOrderId: "vendor_order_1",
        orderId: "order_1",
        vendorId: "vendor_1",
        status: "ready",
      },
      [
        { orderItemId: "item_1", quantity: 2 },
        { orderItemId: "item_2", quantity: 1 },
      ],
    ], [[[], []]]);

    await expect(
      createVendorShipment(db as never, {
        idempotencyKey: "shipment-key-1",
        vendorId: "vendor_1",
        vendorOrderId: "vendor_order_1",
        items: [
          { orderItemId: "item_1", quantity: 1 },
          { orderItemId: "item_2", quantity: 1 },
        ],
        providerType: "manual",
        courierName: "Own rider",
        shipmentAmountMinor: 120,
        metadata: { packageType: "box" },
        actorUserId: "user_1",
        now: new Date("2026-07-14T10:00:00Z"),
      }),
    ).resolves.toEqual({
      replayed: false,
      shipmentId: "vendor_shipment:shipment-key-1",
      vendorOrderId: "vendor_order_1",
      orderId: "order_1",
      vendorId: "vendor_1",
      status: "pending",
      version: 1,
    });

    expect(inserts[0]?.values).toMatchObject({
      id: "vendor_shipment:shipment-key-1",
      idempotencyKey: "shipment-key-1",
      vendorOrderId: "vendor_order_1",
      orderId: "order_1",
      vendorId: "vendor_1",
      shipmentAmountMinor: 120,
      metadata: { packageType: "box" },
    });
    expect(inserts[1]?.values).toEqual([
      expect.objectContaining({
        id: "vendor_shipment:shipment-key-1:item:item_1",
        orderItemId: "item_1",
        quantity: 1,
      }),
      expect.objectContaining({
        id: "vendor_shipment:shipment-key-1:item:item_2",
        orderItemId: "item_2",
        quantity: 1,
      }),
    ]);
    expect(batch.mock.calls[0]?.[0]).toEqual([
      { kind: "insert_1" },
      { kind: "insert_2" },
    ]);
  });

  it("returns an existing idempotency key as a replay without writing", async () => {
    const { db, batch } = createDb([
      {
        shipmentId: "vendor_shipment:shipment-key-1",
        vendorOrderId: "vendor_order_1",
        orderId: "order_1",
        vendorId: "vendor_1",
        status: "processing",
        version: 2,
      },
    ]);

    await expect(
      createVendorShipment(db as never, {
        idempotencyKey: "shipment-key-1",
        vendorId: "vendor_1",
        vendorOrderId: "vendor_order_1",
        items: [{ orderItemId: "item_1", quantity: 1 }],
      }),
    ).resolves.toEqual({
      replayed: true,
      shipmentId: "vendor_shipment:shipment-key-1",
      vendorOrderId: "vendor_order_1",
      orderId: "order_1",
      vendorId: "vendor_1",
      status: "processing",
      version: 2,
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("rejects cross-seller orders, duplicate lines, invalid quantities, and terminal vendor orders", async () => {
    const crossVendor = createDb([
      null,
      {
        vendorOrderId: "vendor_order_1",
        orderId: "order_1",
        vendorId: "vendor_2",
        status: "ready",
      },
    ]);
    await expect(
      createVendorShipment(crossVendor.db as never, {
        idempotencyKey: "cross",
        vendorId: "vendor_1",
        vendorOrderId: "vendor_order_1",
        items: [{ orderItemId: "item_1", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const duplicate = createDb([null]);
    await expect(
      createVendorShipment(duplicate.db as never, {
        idempotencyKey: "dup",
        vendorId: "vendor_1",
        vendorOrderId: "vendor_order_1",
        items: [
          { orderItemId: "item_1", quantity: 1 },
          { orderItemId: "item_1", quantity: 1 },
        ],
      }),
    ).rejects.toThrow(/duplicate shipment item/i);

    const terminal = createDb([
      null,
      {
        vendorOrderId: "vendor_order_1",
        orderId: "order_1",
        vendorId: "vendor_1",
        status: "delivered",
      },
    ]);
    await expect(
      createVendorShipment(terminal.db as never, {
        idempotencyKey: "terminal",
        vendorId: "vendor_1",
        vendorOrderId: "vendor_order_1",
        items: [{ orderItemId: "item_1", quantity: 1 }],
      }),
    ).rejects.toThrow(/cannot create a shipment/i);
  });

  it("updates status with seller scope and optimistic version", async () => {
    const { db, updates, batch } = createDb([
      {
        shipmentId: "shipment_1",
        vendorId: "vendor_1",
        status: "processing",
        version: 2,
      },
    ], [[[ { id: "shipment_1", version: 3 } ]]]);

    await expect(
      updateVendorShipmentStatus(db as never, {
        shipmentId: "shipment_1",
        vendorId: "vendor_1",
        expectedVersion: 2,
        status: "in_transit",
        trackingId: "track_1",
        trackingUrl: "https://tracking.example/track_1",
        now: new Date("2026-07-14T11:00:00Z"),
      }),
    ).resolves.toEqual({
      shipmentId: "shipment_1",
      status: "in_transit",
      version: 3,
    });
    expect(updates[0]?.values).toMatchObject({
      status: "in_transit",
      version: 3,
      trackingId: "track_1",
      trackingUrl: "https://tracking.example/track_1",
    });
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("persists provider identifiers even when the normalized status is unchanged", async () => {
    const { db, updates } = createDb([
      {
        shipmentId: "shipment_1",
        vendorId: "vendor_1",
        externalId: null,
        status: "processing",
        version: 2,
      },
    ], [[[ { id: "shipment_1", version: 3 } ]]]);

    await expect(
      updateVendorShipmentStatus(db as never, {
        shipmentId: "shipment_1",
        vendorId: "vendor_1",
        expectedVersion: 2,
        status: "processing",
        externalId: "provider_consignment_1",
        trackingId: "tracking_1",
        trackingUrl: "https://tracking.example/tracking_1",
      }),
    ).resolves.toEqual({
      shipmentId: "shipment_1",
      status: "processing",
      version: 3,
    });
    expect(updates[0]?.values).toMatchObject({
      externalId: "provider_consignment_1",
      trackingId: "tracking_1",
      version: 3,
    });
  });

  it("rejects replacing an established provider external ID", async () => {
    const { db } = createDb([
      {
        shipmentId: "shipment_1",
        vendorId: "vendor_1",
        externalId: "provider_consignment_1",
        status: "processing",
        version: 2,
      },
    ]);

    await expect(
      updateVendorShipmentStatus(db as never, {
        shipmentId: "shipment_1",
        vendorId: "vendor_1",
        expectedVersion: 2,
        status: "processing",
        externalId: "provider_consignment_2",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects invalid or concurrently changed status updates", async () => {
    const invalid = createDb([
      {
        shipmentId: "shipment_1",
        vendorId: "vendor_1",
        status: "pending",
        version: 1,
      },
    ]);
    await expect(
      updateVendorShipmentStatus(invalid.db as never, {
        shipmentId: "shipment_1",
        vendorId: "vendor_1",
        expectedVersion: 1,
        status: "delivered",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const concurrent = createDb([
      {
        shipmentId: "shipment_1",
        vendorId: "vendor_1",
        status: "processing",
        version: 2,
      },
    ], [[[]]]);
    await expect(
      updateVendorShipmentStatus(concurrent.db as never, {
        shipmentId: "shipment_1",
        vendorId: "vendor_1",
        expectedVersion: 2,
        status: "in_transit",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
