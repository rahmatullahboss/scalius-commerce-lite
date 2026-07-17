import { describe, expect, it, vi } from "vitest";
import {
  buildCapturedPaymentJournalFromDatabase,
  buildCompletedRefundJournalFromDatabase,
  postMarketplaceFinancialEvent,
} from "./financial-events";

function createReadDb(results: unknown[]) {
  const queue = [...results];
  const chain = {
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    get: vi.fn(async () => queue.shift() ?? null),
    all: vi.fn(async () => queue.shift() ?? []),
  };
  return {
    select: vi.fn(() => ({ from: vi.fn(() => chain) })),
  };
}

describe("marketplace financial event projections", () => {
  it("rebuilds a payment capture journal from authoritative payment, order, and item snapshots", async () => {
    const db = createReadDb([
      {
        id: "payment_1",
        orderId: "order_1",
        amount: 100,
        currency: "BDT",
        status: "succeeded",
        updatedAt: new Date("2026-07-14T00:00:00Z"),
      },
      { id: "order_1", totalAmount: 100 },
      [
        {
          orderItemId: "item_1",
          vendorOrderId: "vendor_order_1",
          vendorId: "vendor_1",
          vendorNetMinor: 8_000,
          commissionMinor: 2_000,
        },
      ],
    ]);

    const journal = await buildCapturedPaymentJournalFromDatabase(db as never, "payment_1");

    expect(journal.idempotencyKey).toBe("payment:payment_1:capture");
    expect(journal.entries).toEqual([
      expect.objectContaining({ accountCode: "cash_clearing", debitMinor: 10_000 }),
      expect.objectContaining({
        vendorId: "vendor_1",
        accountCode: "vendor_pending_payable",
        creditMinor: 8_000,
      }),
      expect.objectContaining({
        accountCode: "platform_commission_revenue",
        creditMinor: 2_000,
      }),
    ]);
  });

  it("rejects payment events until the durable payment record is succeeded", async () => {
    const db = createReadDb([
      {
        id: "payment_1",
        orderId: "order_1",
        amount: 100,
        currency: "BDT",
        status: "pending",
        updatedAt: new Date(),
      },
    ]);

    await expect(
      buildCapturedPaymentJournalFromDatabase(db as never, "payment_1"),
    ).rejects.toThrow(/not succeeded/i);
  });

  it("rebuilds a refund reversal from normalized refund item allocations", async () => {
    const db = createReadDb([
      {
        id: "refund_1",
        orderId: "order_1",
        orderPaymentId: "payment_1",
        currency: "BDT",
        amountMinor: 1_200,
        status: "completed",
        completedAt: new Date("2026-07-14T01:00:00Z"),
        updatedAt: new Date("2026-07-14T01:00:00Z"),
      },
      [
        {
          orderItemId: "item_1",
          vendorOrderId: "vendor_order_1",
          vendorId: "vendor_1",
          refundAmountMinor: 1_200,
          vendorNetReversalMinor: 900,
          commissionReversalMinor: 200,
          shippingReversalMinor: 100,
          taxReversalMinor: 0,
        },
      ],
    ]);

    const journal = await buildCompletedRefundJournalFromDatabase(db as never, "refund_1");

    expect(journal.idempotencyKey).toBe("refund:refund_1:completed");
    expect(journal.entries).toEqual([
      expect.objectContaining({ accountCode: "vendor_pending_payable", debitMinor: 900 }),
      expect.objectContaining({ accountCode: "platform_commission_revenue", debitMinor: 200 }),
      expect.objectContaining({ accountCode: "shipping_clearing", debitMinor: 100 }),
      expect.objectContaining({ accountCode: "refund_clearing", creditMinor: 1_200 }),
    ]);
  });

  it.each([
    ["settlement.released", "vendor_order_1:BDT", "settlement:vendor_order_1:BDT:released"],
    ["payout.requested", "payout_item_1", "payout:payout_item_1:reserved"],
    ["payout.completed", "payout_item_1", "payout:payout_item_1:completed"],
    ["payout.released", "payout_item_1", "payout:payout_item_1:released"],
  ])("verifies an already-posted transition journal for %s", async (eventType, aggregateId, idempotencyKey) => {
    const db = createReadDb([
      { id: `journal:${idempotencyKey}`, idempotencyKey },
    ]);
    const postJournal = vi.fn();

    await expect(
      postMarketplaceFinancialEvent(
        db as never,
        { eventType, aggregateId },
        { postJournal },
      ),
    ).resolves.toEqual({
      journalId: `journal:${idempotencyKey}`,
      replayed: true,
    });
    expect(postJournal).not.toHaveBeenCalled();
  });

  it("retries an already-posted transition event when its journal is missing", async () => {
    const db = createReadDb([null]);
    await expect(
      postMarketplaceFinancialEvent(
        db as never,
        { eventType: "payout.completed", aggregateId: "payout_item_1" },
      ),
    ).rejects.toThrow(/journal is not durable yet/i);
  });

  it("dispatches supported events to one idempotent journal poster", async () => {
    const paymentDb = createReadDb([
      {
        id: "payment_1",
        orderId: "order_1",
        amount: 100,
        currency: "BDT",
        status: "succeeded",
        updatedAt: new Date("2026-07-14T00:00:00Z"),
      },
      { id: "order_1", totalAmount: 100 },
      [
        {
          orderItemId: "item_1",
          vendorOrderId: "vendor_order_1",
          vendorId: "vendor_1",
          vendorNetMinor: 8_000,
          commissionMinor: 2_000,
        },
      ],
    ]);
    const postJournal = vi.fn().mockResolvedValue({ journalId: "journal_1", replayed: false });

    await expect(
      postMarketplaceFinancialEvent(
        paymentDb as never,
        { eventType: "payment.captured", aggregateId: "payment_1" },
        { postJournal },
      ),
    ).resolves.toEqual({ journalId: "journal_1", replayed: false });
    expect(postJournal).toHaveBeenCalledWith(
      paymentDb,
      expect.objectContaining({ idempotencyKey: "payment:payment_1:capture" }),
    );

    await expect(
      postMarketplaceFinancialEvent(
        paymentDb as never,
        { eventType: "vendor.updated", aggregateId: "vendor_1" },
        { postJournal },
      ),
    ).rejects.toThrow(/unsupported marketplace financial event/i);
  });
});
