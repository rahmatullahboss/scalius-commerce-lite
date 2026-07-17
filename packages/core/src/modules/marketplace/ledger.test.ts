import { describe, expect, it } from "vitest";
import { minorUnits } from "./money";
import {
  assertBalancedJournal,
  buildPaymentCapturedJournal,
  buildRefundCompletedJournal,
} from "./ledger";

describe("marketplace ledger journal builders", () => {
  it("posts a full captured payment to seller pending, commission, shipping, and cash clearing", () => {
    const journal = buildPaymentCapturedJournal({
      paymentId: "payment_1",
      orderId: "order_1",
      currency: "BDT",
      capturedMinor: minorUnits(12_000),
      orderTotalMinor: minorUnits(12_000),
      occurredAt: new Date("2026-07-14T00:00:00Z"),
      items: [
        {
          orderItemId: "item_1",
          vendorOrderId: "vendor_order_1",
          vendorId: "vendor_1",
          vendorNetMinor: minorUnits(8_000),
          commissionMinor: minorUnits(1_000),
        },
        {
          orderItemId: "item_2",
          vendorOrderId: "vendor_order_2",
          vendorId: "vendor_2",
          vendorNetMinor: minorUnits(2_000),
          commissionMinor: minorUnits(500),
        },
      ],
    });

    expect(journal.idempotencyKey).toBe("payment:payment_1:capture");
    expect(journal.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "cash_clearing", debitMinor: 12_000, creditMinor: 0 }),
        expect.objectContaining({ vendorId: "vendor_1", accountCode: "vendor_pending_payable", creditMinor: 8_000 }),
        expect.objectContaining({ vendorId: "vendor_2", accountCode: "vendor_pending_payable", creditMinor: 2_000 }),
        expect.objectContaining({ accountCode: "platform_commission_revenue", creditMinor: 1_000 }),
        expect.objectContaining({ accountCode: "platform_commission_revenue", creditMinor: 500 }),
        expect.objectContaining({ accountCode: "shipping_clearing", creditMinor: 500 }),
      ]),
    );
    expect(assertBalancedJournal(journal)).toEqual({ debitMinor: 12_000, creditMinor: 12_000 });
  });

  it("allocates partial captures deterministically without exceeding the captured amount", () => {
    const journal = buildPaymentCapturedJournal({
      paymentId: "payment_deposit",
      orderId: "order_1",
      currency: "BDT",
      capturedMinor: minorUnits(3_001),
      orderTotalMinor: minorUnits(10_000),
      occurredAt: new Date("2026-07-14T00:00:00Z"),
      items: [
        {
          orderItemId: "item_1",
          vendorOrderId: "vendor_order_1",
          vendorId: "vendor_1",
          vendorNetMinor: minorUnits(8_000),
          commissionMinor: minorUnits(2_000),
        },
      ],
    });

    expect(journal.entries).toEqual([
      expect.objectContaining({ accountCode: "cash_clearing", debitMinor: 3_001 }),
      expect.objectContaining({ accountCode: "vendor_pending_payable", creditMinor: 2_401 }),
      expect.objectContaining({ accountCode: "platform_commission_revenue", creditMinor: 600 }),
    ]);
    expect(assertBalancedJournal(journal)).toEqual({ debitMinor: 3_001, creditMinor: 3_001 });
  });

  it("proportionally absorbs order-level discounts before splitting seller net and commission", () => {
    const journal = buildPaymentCapturedJournal({
      paymentId: "payment_discounted",
      orderId: "order_discounted",
      currency: "BDT",
      capturedMinor: minorUnits(9_000),
      orderTotalMinor: minorUnits(9_000),
      occurredAt: new Date("2026-07-14T00:00:00Z"),
      items: [
        {
          orderItemId: "item_1",
          vendorOrderId: "vendor_order_1",
          vendorId: "vendor_1",
          vendorNetMinor: minorUnits(8_000),
          commissionMinor: minorUnits(2_000),
        },
      ],
    });

    expect(journal.entries).toEqual([
      expect.objectContaining({ accountCode: "cash_clearing", debitMinor: 9_000 }),
      expect.objectContaining({ accountCode: "vendor_pending_payable", creditMinor: 7_200 }),
      expect.objectContaining({ accountCode: "platform_commission_revenue", creditMinor: 1_800 }),
    ]);
    expect(assertBalancedJournal(journal)).toEqual({ debitMinor: 9_000, creditMinor: 9_000 });
  });

  it("builds a balanced refund reversal from explicit item allocations", () => {
    const journal = buildRefundCompletedJournal({
      refundId: "refund_1",
      orderId: "order_1",
      orderPaymentId: "payment_1",
      currency: "BDT",
      amountMinor: minorUnits(1_200),
      occurredAt: new Date("2026-07-14T01:00:00Z"),
      items: [
        {
          orderItemId: "item_1",
          vendorOrderId: "vendor_order_1",
          vendorId: "vendor_1",
          refundAmountMinor: minorUnits(1_200),
          vendorNetReversalMinor: minorUnits(900),
          commissionReversalMinor: minorUnits(200),
          shippingReversalMinor: minorUnits(100),
          taxReversalMinor: minorUnits(0),
        },
      ],
    });

    expect(journal.entries).toEqual([
      expect.objectContaining({ vendorId: "vendor_1", accountCode: "vendor_pending_payable", debitMinor: 900 }),
      expect.objectContaining({ accountCode: "platform_commission_revenue", debitMinor: 200 }),
      expect.objectContaining({ accountCode: "shipping_clearing", debitMinor: 100 }),
      expect.objectContaining({ accountCode: "refund_clearing", creditMinor: 1_200 }),
    ]);
    expect(assertBalancedJournal(journal)).toEqual({ debitMinor: 1_200, creditMinor: 1_200 });
  });

  it("rejects unbalanced, negative, zero-sided, and over-capture journals", () => {
    expect(() =>
      assertBalancedJournal({
        idempotencyKey: "bad",
        eventType: "bad",
        sourceType: "bad",
        sourceId: "bad",
        currency: "BDT",
        occurredAt: new Date(),
        entries: [
          { accountCode: "cash_clearing", debitMinor: 10, creditMinor: 0 },
          { accountCode: "marketplace_adjustment", debitMinor: 0, creditMinor: 9 },
        ],
      }),
    ).toThrow(/not balanced/i);

    expect(() =>
      buildPaymentCapturedJournal({
        paymentId: "payment_bad",
        orderId: "order_1",
        currency: "BDT",
        capturedMinor: minorUnits(101),
        orderTotalMinor: minorUnits(100),
        occurredAt: new Date(),
        items: [],
      }),
    ).toThrow(/cannot exceed order total/i);
  });
});
