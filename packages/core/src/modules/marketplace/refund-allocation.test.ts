import { describe, expect, it, vi } from "vitest";
import { minorUnits } from "./money";
import {
  buildCompletedMarketplaceRefundStatements,
  buildRefundItemAllocation,
  createCompletedMarketplaceRefundCommand,
} from "./refund-allocation";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    orderItemId: "item_1",
    vendorOrderId: "vendor_order_1",
    vendorId: "vendor_1",
    purchasedQuantity: 3,
    alreadyRefundedQuantity: 0,
    grossMinor: minorUnits(1_001),
    discountMinor: minorUnits(101),
    commissionMinor: minorUnits(200),
    vendorNetMinor: minorUnits(700),
    shippingMinor: minorUnits(99),
    taxMinor: minorUnits(0),
    ...overrides,
  };
}

describe("marketplace refund item allocation", () => {
  it("allocates partial quantities deterministically across every financial component", () => {
    const first = buildRefundItemAllocation(snapshot(), 1);
    expect(first).toEqual({
      orderItemId: "item_1",
      vendorOrderId: "vendor_order_1",
      vendorId: "vendor_1",
      quantity: 1,
      refundAmountMinor: 333,
      grossMinor: 334,
      discountReversalMinor: 34,
      shippingReversalMinor: 33,
      taxReversalMinor: 0,
      commissionReversalMinor: 67,
      vendorNetReversalMinor: 233,
    });

    const second = buildRefundItemAllocation(
      snapshot({ alreadyRefundedQuantity: 1 }),
      1,
    );
    expect(second).toMatchObject({
      quantity: 1,
      grossMinor: 334,
      discountReversalMinor: 34,
      commissionReversalMinor: 67,
      vendorNetReversalMinor: 233,
      shippingReversalMinor: 33,
      refundAmountMinor: 333,
    });

    const third = buildRefundItemAllocation(
      snapshot({ alreadyRefundedQuantity: 2 }),
      1,
    );
    expect(third).toMatchObject({
      quantity: 1,
      grossMinor: 333,
      discountReversalMinor: 33,
      commissionReversalMinor: 66,
      vendorNetReversalMinor: 234,
      shippingReversalMinor: 33,
      refundAmountMinor: 333,
    });

    expect(
      first.refundAmountMinor + second.refundAmountMinor + third.refundAmountMinor,
    ).toBe(999);
    expect(first.grossMinor + second.grossMinor + third.grossMinor).toBe(1_001);
  });

  it("rejects invalid or over-refunded quantities and inconsistent snapshots", () => {
    expect(() => buildRefundItemAllocation(snapshot(), 0)).toThrow(/positive quantity/i);
    expect(() =>
      buildRefundItemAllocation(snapshot({ alreadyRefundedQuantity: 2 }), 2),
    ).toThrow(/exceeds remaining quantity/i);
    expect(() =>
      buildRefundItemAllocation(snapshot({ vendorNetMinor: minorUnits(699) }), 1),
    ).toThrow(/seller components/i);
  });

  it("builds reusable refund, item-allocation, and outbox statements without executing them", () => {
    const inserted: Array<{ table: unknown; values: unknown }> = [];
    const insert = vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        inserted.push({ table, values });
        return { kind: `statement_${inserted.length}` };
      }),
    }));
    const createOutboxStatement = vi.fn(() => ({ kind: "outbox-statement" }));

    const result = buildCompletedMarketplaceRefundStatements(
      { insert } as never,
      {
        refundId: "refund_1",
        orderId: "order_1",
        orderPaymentId: "payment_1",
        gateway: "stripe",
        providerRefundId: "re_1",
        currency: "BDT",
        reason: "Customer request",
        actorUserId: "admin_1",
        claimKey: "refund:order_1:v2",
        allocations: [buildRefundItemAllocation(snapshot(), 3)],
        completedAt: new Date("2026-07-14T02:00:00Z"),
      },
      { createOutboxStatement: createOutboxStatement as never },
    );

    expect(result.amountMinor).toBe(999);
    expect(result.statements).toHaveLength(3);
    expect(inserted).toHaveLength(2);
    expect(createOutboxStatement).toHaveBeenCalledTimes(1);
  });

  it("writes refund, item allocations, and completion event in one atomic batch", async () => {
    const inserted: Array<{ table: unknown; values: unknown }> = [];
    const batch = vi.fn(async (_statements: unknown[]) => [[], [], []]);
    const insert = vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        inserted.push({ table, values });
        return { kind: "insert-statement" };
      }),
    }));
    const createOutboxStatement = vi.fn(() => ({ kind: "outbox-statement" }));

    const result = await createCompletedMarketplaceRefundCommand(
      { insert, batch } as never,
      {
        refundId: "refund_1",
        orderId: "order_1",
        orderPaymentId: "payment_1",
        gateway: "stripe",
        providerRefundId: "re_1",
        currency: "BDT",
        reason: "Customer request",
        actorUserId: "admin_1",
        claimKey: "refund:order_1:v2",
        allocations: [buildRefundItemAllocation(snapshot(), 3)],
        completedAt: new Date("2026-07-14T02:00:00Z"),
      },
      { createOutboxStatement: createOutboxStatement as never },
    );

    expect(result).toEqual({ refundId: "refund_1", amountMinor: 999 });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(3);
    expect(inserted[0]?.values).toMatchObject({
      id: "refund_1",
      status: "completed",
      amountMinor: 999,
      claimKey: "refund:order_1:v2",
    });
    expect(inserted[1]?.values).toEqual([
      expect.objectContaining({
        refundId: "refund_1",
        orderItemId: "item_1",
        refundAmountMinor: 999,
      }),
    ]);
    expect(createOutboxStatement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventKey: "refund:refund_1:completed",
        eventType: "refund.completed",
        aggregateId: "refund_1",
      }),
    );
  });

  it("rejects duplicate item allocations and empty refunds", async () => {
    const commandDb = {
      insert: vi.fn(() => ({ values: vi.fn(() => ({ kind: "statement" })) })),
      batch: vi.fn(),
    };
    const allocation = buildRefundItemAllocation(snapshot(), 1);

    await expect(
      createCompletedMarketplaceRefundCommand(
        commandDb as never,
        {
          refundId: "refund_empty",
          orderId: "order_1",
          currency: "BDT",
          reason: "No items",
          claimKey: "refund:empty",
          allocations: [],
          completedAt: new Date(),
        },
      ),
    ).rejects.toThrow(/at least one item allocation/i);

    await expect(
      createCompletedMarketplaceRefundCommand(
        commandDb as never,
        {
          refundId: "refund_duplicate",
          orderId: "order_1",
          currency: "BDT",
          reason: "Duplicate",
          claimKey: "refund:duplicate",
          allocations: [allocation, allocation],
          completedAt: new Date(),
        },
      ),
    ).rejects.toThrow(/duplicate refund allocation/i);
  });
});
