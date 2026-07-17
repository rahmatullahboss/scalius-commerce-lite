import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MARKETPLACE_FLAGS,
  MARKETPLACE_FLAG_KEYS,
  assertMarketplaceFeatureEnabled,
  getMarketplaceFlags,
  resolveMarketplaceFlags,
} from "./marketplace-flags";

describe("marketplace feature flags", () => {
  it("fails closed when no settings exist", () => {
    expect(resolveMarketplaceFlags([])).toEqual(DEFAULT_MARKETPLACE_FLAGS);
    expect(Object.values(DEFAULT_MARKETPLACE_FLAGS).every((value) => value === false)).toBe(true);
  });

  it("parses each independent capability without enabling siblings", () => {
    const flags = resolveMarketplaceFlags([
      { key: MARKETPLACE_FLAG_KEYS.vendorOnboardingWrite, value: "true" },
      { key: MARKETPLACE_FLAG_KEYS.sellerOrderActions, value: "1" },
      { key: MARKETPLACE_FLAG_KEYS.payoutWrite, value: "yes" },
    ]);

    expect(flags.vendorOnboardingWrite).toBe(true);
    expect(flags.sellerOrderActions).toBe(true);
    expect(flags.payoutWrite).toBe(true);
    expect(flags.vendorCatalogWrite).toBe(false);
    expect(flags.publicVendorCatalog).toBe(false);
    expect(flags.ledgerPosting).toBe(false);
    expect(flags.settlementRelease).toBe(false);
    expect(flags.vendorShipments).toBe(false);
  });

  it("blocks disabled capabilities and allows only the explicitly enabled capability", async () => {
    const rows = [
      { key: MARKETPLACE_FLAG_KEYS.vendorOnboardingWrite, value: "true" },
    ];
    const all = vi.fn().mockResolvedValue(rows);
    const where = vi.fn(() => ({ all }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as never;

    await expect(
      assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite"),
    ).resolves.toBeUndefined();
    await expect(
      assertMarketplaceFeatureEnabled(db, "payoutWrite"),
    ).rejects.toThrow(/marketplace\.payout_write is disabled/i);
  });

  it("reads only the marketplace flag category and returns defaults on DB failure", async () => {
    const all = vi.fn().mockRejectedValue(new Error("D1 unavailable"));
    const where = vi.fn(() => ({ all }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    await expect(getMarketplaceFlags({ select } as never)).resolves.toEqual(
      DEFAULT_MARKETPLACE_FLAGS,
    );
    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
