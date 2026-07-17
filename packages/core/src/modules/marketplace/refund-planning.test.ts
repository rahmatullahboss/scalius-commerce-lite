import { describe, expect, it } from "vitest";
import { minorUnits } from "./money";
import {
  buildMarketplaceRefundPlan,
  type MarketplaceRefundPlanItem,
} from "./refund-planning";

function item(
  overrides: Partial<MarketplaceRefundPlanItem> = {},
): MarketplaceRefundPlanItem {
  return {
    orderItemId: "item_1",
    vendorOrderId: "vendor_order_1",
    vendorId: "vendor_1",
    purchasedQuantity: 2,
    alreadyRefundedQuantity: 0,
    grossMinor: minorUnits(10_000),
    discountMinor: minorUnits(1_000),
    commissionMinor: minorUnits(1_800),
    vendorNetMinor: minorUnits(7_200),
    ...overrides,
  };
}

describe("marketplace refund planning", () => {
  it("auto-allocates a full remaining refund and distributes order-level shipping deterministically", () => {
    const plan = buildMarketplaceRefundPlan({
      currentPaidMinor: minorUnits(14_500),
      items: [
        item(),
        item({
          orderItemId: "item_2",
          vendorOrderId: "vendor_order_2",
          vendorId: "vendor_2",
          purchasedQuantity: 1,
          grossMinor: minorUnits(5_000),
          discountMinor: minorUnits(0),
          commissionMinor: minorUnits(500),
          vendorNetMinor: minorUnits(4_500),
        }),
      ],
    });

    expect(plan).not.toBeNull();
    const fullPlan = plan!;
    expect(fullPlan.isFullRemainingRefund).toBe(true);
    expect(fullPlan.amountMinor).toBe(14_500);
    expect(fullPlan.allocations).toHaveLength(2);
    expect(fullPlan.allocations.reduce((sum, allocation) => sum + allocation.shippingReversalMinor, 0)).toBe(500);
    expect(fullPlan.allocations.reduce((sum, allocation) => sum + allocation.refundAmountMinor, 0)).toBe(14_500);
    expect(fullPlan.allocations).toEqual([
      expect.objectContaining({
        orderItemId: "item_1",
        quantity: 2,
        grossMinor: 10_000,
        discountReversalMinor: 1_000,
        commissionReversalMinor: 1_800,
        vendorNetReversalMinor: 7_200,
        shippingReversalMinor: 321,
        refundAmountMinor: 9_321,
      }),
      expect.objectContaining({
        orderItemId: "item_2",
        quantity: 1,
        grossMinor: 5_000,
        discountReversalMinor: 0,
        commissionReversalMinor: 500,
        vendorNetReversalMinor: 4_500,
        shippingReversalMinor: 179,
        refundAmountMinor: 5_179,
      }),
    ]);
  });

  it("allocates a partial item-and-quantity refund without reversing order-level shipping", () => {
    const plan = buildMarketplaceRefundPlan({
      currentPaidMinor: minorUnits(9_500),
      requestedAmountMinor: minorUnits(4_500),
      selections: [{ orderItemId: "item_1", quantity: 1 }],
      items: [item()],
    });

    expect(plan).toEqual({
      isFullRemainingRefund: false,
      amountMinor: 4_500,
      allocations: [
        {
          orderItemId: "item_1",
          vendorOrderId: "vendor_order_1",
          vendorId: "vendor_1",
          quantity: 1,
          refundAmountMinor: 4_500,
          grossMinor: 5_000,
          discountReversalMinor: 500,
          shippingReversalMinor: 0,
          taxReversalMinor: 0,
          commissionReversalMinor: 900,
          vendorNetReversalMinor: 3_600,
        },
      ],
    });
  });

  it("requires item selections for a partial marketplace refund", () => {
    expect(() =>
      buildMarketplaceRefundPlan({
        currentPaidMinor: minorUnits(9_500),
        requestedAmountMinor: minorUnits(4_500),
        items: [item()],
      }),
    ).toThrow(/item and quantity selections are required/i);
  });

  it("rejects a requested amount that does not equal the selected item allocation", () => {
    expect(() =>
      buildMarketplaceRefundPlan({
        currentPaidMinor: minorUnits(9_500),
        requestedAmountMinor: minorUnits(4_000),
        selections: [{ orderItemId: "item_1", quantity: 1 }],
        items: [item()],
      }),
    ).toThrow(/does not match selected item allocation/i);
  });

  it("rejects duplicate, unknown, and over-refunded selections", () => {
    expect(() =>
      buildMarketplaceRefundPlan({
        currentPaidMinor: minorUnits(9_500),
        selections: [
          { orderItemId: "item_1", quantity: 1 },
          { orderItemId: "item_1", quantity: 1 },
        ],
        items: [item()],
      }),
    ).toThrow(/duplicate refund selection/i);

    expect(() =>
      buildMarketplaceRefundPlan({
        currentPaidMinor: minorUnits(9_500),
        selections: [{ orderItemId: "missing", quantity: 1 }],
        items: [item()],
      }),
    ).toThrow(/not part of this marketplace order/i);

    expect(() =>
      buildMarketplaceRefundPlan({
        currentPaidMinor: minorUnits(9_500),
        selections: [{ orderItemId: "item_1", quantity: 2 }],
        items: [item({ alreadyRefundedQuantity: 1 })],
      }),
    ).toThrow(/exceeds remaining quantity/i);
  });

  it("returns null for a legacy order without marketplace seller snapshots", () => {
    expect(
      buildMarketplaceRefundPlan({
        currentPaidMinor: minorUnits(10_000),
        items: [],
      }),
    ).toBeNull();
  });
});
