import { describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "../../errors";
import {
  canSellerTransitionVendorOrder,
  updateSellerVendorOrderStatus,
} from "./vendor-order-actions";

function createDb(current: unknown, batchResult: unknown[]) {
  const get = vi.fn(async () => current);
  const where = vi.fn(() => ({ get }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const updates: unknown[] = [];
  const update = vi.fn(() => ({
    set: vi.fn((values: unknown) => {
      updates.push(values);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => ({ kind: "order-update" })),
        })),
      };
    }),
  }));
  const batch = vi.fn(async (_statements: unknown[]) => batchResult);
  return { db: { select, update, batch }, updates, batch };
}

describe("seller vendor-order actions", () => {
  it("allows only pending/processing/ready operational transitions", () => {
    expect(canSellerTransitionVendorOrder("pending", "processing")).toBe(true);
    expect(canSellerTransitionVendorOrder("processing", "ready")).toBe(true);
    expect(canSellerTransitionVendorOrder("ready", "processing")).toBe(true);
    expect(canSellerTransitionVendorOrder("pending", "delivered")).toBe(false);
    expect(canSellerTransitionVendorOrder("ready", "shipped")).toBe(false);
    expect(canSellerTransitionVendorOrder("shipped", "delivered")).toBe(false);
  });

  it("updates a seller-owned fulfillment group with optimistic version", async () => {
    const { db, updates, batch } = createDb(
      {
        vendorOrderId: "vendor_order_1",
        vendorId: "vendor_1",
        status: "processing",
        version: 3,
      },
      [[{ id: "vendor_order_1", version: 4 }]],
    );

    await expect(
      updateSellerVendorOrderStatus(db as never, {
        vendorOrderId: "vendor_order_1",
        vendorId: "vendor_1",
        expectedVersion: 3,
        status: "ready",
        now: new Date("2026-07-14T12:00:00Z"),
      }),
    ).resolves.toEqual({
      vendorOrderId: "vendor_order_1",
      status: "ready",
      version: 4,
    });
    expect(updates[0]).toMatchObject({ status: "ready", version: 4 });
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("rejects shipment-owned states and stale versions", async () => {
    const invalid = createDb(
      {
        vendorOrderId: "vendor_order_1",
        vendorId: "vendor_1",
        status: "ready",
        version: 2,
      },
      [],
    );
    await expect(
      updateSellerVendorOrderStatus(invalid.db as never, {
        vendorOrderId: "vendor_order_1",
        vendorId: "vendor_1",
        expectedVersion: 2,
        status: "shipped",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const stale = createDb(
      {
        vendorOrderId: "vendor_order_1",
        vendorId: "vendor_1",
        status: "processing",
        version: 3,
      },
      [[]],
    );
    await expect(
      updateSellerVendorOrderStatus(stale.db as never, {
        vendorOrderId: "vendor_order_1",
        vendorId: "vendor_1",
        expectedVersion: 3,
        status: "ready",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
