import { describe, expect, it, vi } from "vitest";
import {
  calculateVendorFinancialBalance,
  getVendorFinancialBalance,
} from "./financial-balance";

describe("vendor ledger-derived financial balance", () => {
  it("derives payable buckets, debt, and payout-eligible available balance", () => {
    expect(
      calculateVendorFinancialBalance([
        { accountCode: "vendor_pending_payable", debitMinor: 300, creditMinor: 100 },
        { accountCode: "vendor_available_payable", debitMinor: 1_000, creditMinor: 6_000 },
        { accountCode: "vendor_payout_reserved", debitMinor: 0, creditMinor: 500 },
        { accountCode: "vendor_paid", debitMinor: 0, creditMinor: 2_000 },
      ]),
    ).toEqual({
      pendingMinor: 0,
      availableMinor: 5_000,
      reservedMinor: 500,
      paidMinor: 2_000,
      debtMinor: 200,
      payoutEligibleMinor: 4_800,
    });
  });

  it("offsets positive and negative entries within the same bucket", () => {
    expect(
      calculateVendorFinancialBalance([
        { accountCode: "vendor_pending_payable", debitMinor: 200, creditMinor: 0 },
        { accountCode: "vendor_pending_payable", debitMinor: 0, creditMinor: 250 },
        { accountCode: "vendor_available_payable", debitMinor: 0, creditMinor: 100 },
      ]),
    ).toMatchObject({
      pendingMinor: 50,
      availableMinor: 100,
      debtMinor: 0,
      payoutEligibleMinor: 100,
    });
  });

  it("queries only seller payable accounts in one currency", async () => {
    const rows = [
      { accountCode: "vendor_available_payable", debitMinor: 0, creditMinor: 1_000 },
    ];
    const all = vi.fn(async () => rows);
    const where = vi.fn(() => ({ all }));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));

    await expect(
      getVendorFinancialBalance({ select } as never, "vendor_1", "BDT"),
    ).resolves.toEqual({
      pendingMinor: 0,
      availableMinor: 1_000,
      reservedMinor: 0,
      paidMinor: 0,
      debtMinor: 0,
      payoutEligibleMinor: 1_000,
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(innerJoin).toHaveBeenCalledTimes(1);
  });
});
