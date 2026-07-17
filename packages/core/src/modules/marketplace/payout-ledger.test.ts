import { describe, expect, it } from "vitest";
import { minorUnits } from "./money";
import {
  assertBalancedJournal,
  buildPayoutCompletedJournal,
  buildPayoutReleaseJournal,
  buildPayoutReservationJournal,
  buildSettlementReleasedJournal,
} from "./ledger";

describe("settlement and payout journals", () => {
  it("moves seller liability from pending to available after settlement eligibility", () => {
    const journal = buildSettlementReleasedJournal({
      releaseId: "release_vendor_order_1",
      vendorId: "vendor_1",
      vendorOrderId: "vendor_order_1",
      currency: "BDT",
      amountMinor: minorUnits(8_000),
      occurredAt: new Date("2026-07-14T00:00:00Z"),
    });

    expect(journal).toMatchObject({
      idempotencyKey: "settlement:release_vendor_order_1:released",
      eventType: "settlement.released",
      sourceType: "vendor_order",
      sourceId: "vendor_order_1",
    });
    expect(journal.entries).toEqual([
      expect.objectContaining({
        vendorId: "vendor_1",
        vendorOrderId: "vendor_order_1",
        accountCode: "vendor_pending_payable",
        debitMinor: 8_000,
        creditMinor: 0,
      }),
      expect.objectContaining({
        vendorId: "vendor_1",
        vendorOrderId: "vendor_order_1",
        accountCode: "vendor_available_payable",
        debitMinor: 0,
        creditMinor: 8_000,
      }),
    ]);
    expect(assertBalancedJournal(journal)).toEqual({ debitMinor: 8_000, creditMinor: 8_000 });
  });

  it("moves available balance into payout reservation", () => {
    const journal = buildPayoutReservationJournal({
      payoutItemId: "payout_item_1",
      vendorId: "vendor_1",
      currency: "BDT",
      amountMinor: minorUnits(5_000),
      occurredAt: new Date("2026-07-14T01:00:00Z"),
    });

    expect(journal.payoutId).toBe("payout_item_1");
    expect(journal.entries).toEqual([
      expect.objectContaining({ accountCode: "vendor_available_payable", debitMinor: 5_000 }),
      expect.objectContaining({ accountCode: "vendor_payout_reserved", creditMinor: 5_000 }),
    ]);
    expect(assertBalancedJournal(journal)).toEqual({ debitMinor: 5_000, creditMinor: 5_000 });
  });

  it("moves reserved balance to paid on successful dispatch", () => {
    const journal = buildPayoutCompletedJournal({
      payoutItemId: "payout_item_1",
      vendorId: "vendor_1",
      currency: "BDT",
      amountMinor: minorUnits(5_000),
      occurredAt: new Date("2026-07-14T02:00:00Z"),
    });

    expect(journal.idempotencyKey).toBe("payout:payout_item_1:completed");
    expect(journal.entries).toEqual([
      expect.objectContaining({ accountCode: "vendor_payout_reserved", debitMinor: 5_000 }),
      expect.objectContaining({ accountCode: "vendor_paid", creditMinor: 5_000 }),
    ]);
  });

  it("returns an exact failed reservation to available balance", () => {
    const journal = buildPayoutReleaseJournal({
      payoutItemId: "payout_item_1",
      vendorId: "vendor_1",
      currency: "BDT",
      amountMinor: minorUnits(5_000),
      reason: "provider_failed",
      occurredAt: new Date("2026-07-14T03:00:00Z"),
    });

    expect(journal.idempotencyKey).toBe("payout:payout_item_1:released");
    expect(journal.metadata).toEqual({ reason: "provider_failed" });
    expect(journal.entries).toEqual([
      expect.objectContaining({ accountCode: "vendor_payout_reserved", debitMinor: 5_000 }),
      expect.objectContaining({ accountCode: "vendor_available_payable", creditMinor: 5_000 }),
    ]);
  });

  it("rejects zero-value settlement or payout transitions", () => {
    expect(() =>
      buildPayoutReservationJournal({
        payoutItemId: "payout_item_1",
        vendorId: "vendor_1",
        currency: "BDT",
        amountMinor: minorUnits(0),
        occurredAt: new Date(),
      }),
    ).toThrow(/greater than zero/i);
  });
});
