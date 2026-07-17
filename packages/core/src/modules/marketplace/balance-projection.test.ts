import { describe, expect, it, vi } from "vitest";
import {
  buildVendorBalanceProjections,
  rebuildVendorBalanceProjections,
} from "./balance-projection";

describe("vendor balance projection", () => {
  it("derives pending, available, reserved, paid, and debt from immutable ledger entries", () => {
    const projections = buildVendorBalanceProjections([
      {
        journalId: "journal_1",
        vendorId: "vendor_1",
        currency: "BDT",
        accountCode: "vendor_pending_payable",
        debitMinor: 0,
        creditMinor: 10_000,
        postedAt: new Date("2026-07-14T00:00:00Z"),
      },
      {
        journalId: "journal_2",
        vendorId: "vendor_1",
        currency: "BDT",
        accountCode: "vendor_pending_payable",
        debitMinor: 2_000,
        creditMinor: 0,
        postedAt: new Date("2026-07-14T01:00:00Z"),
      },
      {
        journalId: "journal_3",
        vendorId: "vendor_1",
        currency: "BDT",
        accountCode: "vendor_available_payable",
        debitMinor: 0,
        creditMinor: 5_000,
        postedAt: new Date("2026-07-14T02:00:00Z"),
      },
      {
        journalId: "journal_4",
        vendorId: "vendor_1",
        currency: "BDT",
        accountCode: "vendor_payout_reserved",
        debitMinor: 0,
        creditMinor: 1_500,
        postedAt: new Date("2026-07-14T03:00:00Z"),
      },
      {
        journalId: "journal_5",
        vendorId: "vendor_1",
        currency: "BDT",
        accountCode: "vendor_paid",
        debitMinor: 0,
        creditMinor: 3_000,
        postedAt: new Date("2026-07-14T04:00:00Z"),
      },
      {
        journalId: "journal_6",
        vendorId: "vendor_2",
        currency: "BDT",
        accountCode: "vendor_pending_payable",
        debitMinor: 500,
        creditMinor: 0,
        postedAt: new Date("2026-07-14T05:00:00Z"),
      },
      {
        journalId: "platform_only",
        vendorId: null,
        currency: "BDT",
        accountCode: "platform_commission_revenue",
        debitMinor: 0,
        creditMinor: 999,
        postedAt: new Date("2026-07-14T06:00:00Z"),
      },
    ]);

    expect(projections).toEqual([
      {
        vendorId: "vendor_1",
        currency: "BDT",
        pendingMinor: 8_000,
        availableMinor: 5_000,
        reservedMinor: 1_500,
        paidMinor: 3_000,
        debtMinor: 0,
        lastJournalId: "journal_5",
        version: 1,
      },
      {
        vendorId: "vendor_2",
        currency: "BDT",
        pendingMinor: 0,
        availableMinor: 0,
        reservedMinor: 0,
        paidMinor: 0,
        debtMinor: 500,
        lastJournalId: "journal_6",
        version: 1,
      },
    ]);
  });

  it("treats vendor adjustments as available balance changes", () => {
    const projections = buildVendorBalanceProjections([
      {
        journalId: "adjustment_credit",
        vendorId: "vendor_1",
        currency: "BDT",
        accountCode: "marketplace_adjustment",
        debitMinor: 0,
        creditMinor: 200,
        postedAt: new Date("2026-07-14T00:00:00Z"),
      },
      {
        journalId: "adjustment_debit",
        vendorId: "vendor_1",
        currency: "BDT",
        accountCode: "marketplace_adjustment",
        debitMinor: 50,
        creditMinor: 0,
        postedAt: new Date("2026-07-14T01:00:00Z"),
      },
    ]);

    expect(projections[0]).toMatchObject({
      availableMinor: 150,
      debtMinor: 0,
      lastJournalId: "adjustment_debit",
    });
  });

  it("replaces the disposable projection in one batch", async () => {
    const rows = [
      {
        journalId: "journal_1",
        vendorId: "vendor_1",
        currency: "BDT",
        accountCode: "vendor_pending_payable",
        debitMinor: 0,
        creditMinor: 100,
        postedAt: new Date("2026-07-14T00:00:00Z"),
      },
    ];
    const all = vi.fn(async () => rows);
    const orderBy = vi.fn(() => ({ all }));
    const where = vi.fn(() => ({ orderBy }));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    const inserted: unknown[] = [];
    const insert = vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        inserted.push(values);
        return { kind: "insert-projections" };
      }),
    }));
    const deleteFn = vi.fn(() => ({ kind: "delete-projections" }));
    const batch = vi.fn(async (_statements: unknown[]) => [[], []]);

    const result = await rebuildVendorBalanceProjections(
      { select, insert, delete: deleteFn, batch } as never,
      new Date("2026-07-14T06:00:00Z"),
    );

    expect(result).toEqual({ vendors: 1, entries: 1 });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);
    expect(inserted[0]).toEqual([
      expect.objectContaining({
        vendorId: "vendor_1",
        currency: "BDT",
        pendingMinor: 100,
        updatedAt: new Date("2026-07-14T06:00:00Z"),
      }),
    ]);
  });
});
