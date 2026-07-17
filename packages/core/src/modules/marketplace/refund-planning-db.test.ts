import { describe, expect, it, vi } from "vitest";
import { minorUnits } from "./money";
import { loadMarketplaceRefundPlan } from "./refund-planning";

function createDb(results: unknown[]) {
  const queue = [...results];
  const chain = {
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    all: vi.fn(async () => queue.shift() ?? []),
  };
  return {
    select: vi.fn(() => ({ from: vi.fn(() => chain) })),
  };
}

describe("marketplace refund plan database loader", () => {
  it("loads immutable seller snapshots and prior completed refund quantities", async () => {
    const db = createDb([
      [
        {
          orderItemId: "item_1",
          vendorOrderId: "vendor_order_1",
          vendorId: "vendor_1",
          purchasedQuantity: 3,
          grossMinor: 1_500,
          discountMinor: 0,
          commissionMinor: 300,
          vendorNetMinor: 1_200,
        },
      ],
      [
        { orderItemId: "item_1", quantity: 1 },
        { orderItemId: "item_1", quantity: 1 },
      ],
    ]);

    const plan = await loadMarketplaceRefundPlan(db as never, {
      orderId: "order_1",
      currentPaidMinor: minorUnits(500),
      requestedAmountMinor: minorUnits(500),
      selections: [{ orderItemId: "item_1", quantity: 1 }],
    });

    expect(plan).toEqual({
      isFullRemainingRefund: true,
      amountMinor: 500,
      allocations: [
        expect.objectContaining({
          orderItemId: "item_1",
          quantity: 1,
          grossMinor: 500,
          commissionReversalMinor: 100,
          vendorNetReversalMinor: 400,
          refundAmountMinor: 500,
        }),
      ],
    });
  });

  it("returns null for legacy rows and rejects mixed marketplace snapshot authority", async () => {
    const legacyDb = createDb([
      [
        {
          orderItemId: "legacy_item",
          vendorOrderId: null,
          vendorId: null,
          purchasedQuantity: 1,
          grossMinor: 1_000,
          discountMinor: 0,
          commissionMinor: 0,
          vendorNetMinor: 0,
        },
      ],
    ]);

    await expect(
      loadMarketplaceRefundPlan(legacyDb as never, {
        orderId: "legacy_order",
        currentPaidMinor: minorUnits(1_000),
      }),
    ).resolves.toBeNull();

    const mixedDb = createDb([
      [
        {
          orderItemId: "market_item",
          vendorOrderId: "vendor_order_1",
          vendorId: "vendor_1",
          purchasedQuantity: 1,
          grossMinor: 1_000,
          discountMinor: 0,
          commissionMinor: 100,
          vendorNetMinor: 900,
        },
        {
          orderItemId: "legacy_item",
          vendorOrderId: null,
          vendorId: null,
          purchasedQuantity: 1,
          grossMinor: 500,
          discountMinor: 0,
          commissionMinor: 0,
          vendorNetMinor: 0,
        },
      ],
    ]);

    await expect(
      loadMarketplaceRefundPlan(mixedDb as never, {
        orderId: "mixed_order",
        currentPaidMinor: minorUnits(1_500),
      }),
    ).rejects.toThrow(/mixed seller snapshot authority/i);
  });
});
