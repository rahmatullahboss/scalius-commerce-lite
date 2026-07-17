import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routePath = fileURLToPath(new URL("./marketplace-finance.ts", import.meta.url));
const reviewRoutePath = fileURLToPath(new URL("./marketplace-payout-methods.ts", import.meta.url));
const rbacPath = fileURLToPath(
  new URL("../../../../../packages/core/src/auth/rbac/route-permissions.ts", import.meta.url),
);

describe("marketplace settlement and payout API boundaries", () => {
  it("delegates all settlement and payout mutations to core domain commands", () => {
    const source = `${readFileSync(routePath, "utf8")}\n${readFileSync(reviewRoutePath, "utf8")}`;

    expect(source).toContain("releaseVendorOrderSettlement");
    expect(source).toContain("processSettlementReleaseBatch");
    expect(source).toContain("previewVendorPayout");
    expect(source).toContain("reserveVendorPayout");
    expect(source).toContain("claimPayoutItemForDispatch");
    expect(source).toContain("completePayoutItem");
    expect(source).toContain("releasePayoutItem");
    expect(source).toContain("moderateVendorPayoutMethod");
    expect(source).not.toMatch(/\.insert\(payout(?:Batches|Items|Attempts)\)/);
    expect(source).not.toMatch(/\.update\(payout(?:Batches|Items|Attempts)\)/);
  });

  it("requires independent flags for ledger, settlement, and payout writes", () => {
    const source = `${readFileSync(routePath, "utf8")}\n${readFileSync(reviewRoutePath, "utf8")}`;

    expect(source).toContain('assertMarketplaceFeatureEnabled(db, "ledgerPosting"');
    expect(source).toContain('assertMarketplaceFeatureEnabled(db, "settlementRelease"');
    expect(source).toContain('assertMarketplaceFeatureEnabled(db, "payoutWrite"');
    expect(source).toContain("rebuildVendorBalanceProjections(db)");
  });

  it("exposes bounded settlement and payout workflow routes", () => {
    const source = `${readFileSync(routePath, "utf8")}\n${readFileSync(reviewRoutePath, "utf8")}`;

    expect(source).toContain('path: "/settlements/{vendorOrderId}/release"');
    expect(source).toContain('path: "/settlements/sweep"');
    expect(source).toContain('path: "/payouts/preview"');
    expect(source).toContain('path: "/payouts/reserve"');
    expect(source).toContain('path: "/payouts/{payoutItemId}/claim"');
    expect(source).toContain('path: "/payouts/{payoutItemId}/complete"');
    expect(source).toContain('path: "/payouts/{payoutItemId}/release"');
    expect(source).toContain('path: "/payouts"');
    expect(source).toContain('path: "/payouts/{payoutItemId}"');
    expect(source).toContain('path: "/payout-methods"');
    expect(source).toContain('path: "/payout-methods/{methodId}/status"');
    expect(source).toContain("limit: z.coerce.number().int().min(1).max(100)");
  });

  it("never selects encrypted payout destination payloads for API responses", () => {
    const source = `${readFileSync(routePath, "utf8")}\n${readFileSync(reviewRoutePath, "utf8")}`;

    expect(source).toContain("vendorPayoutMethods.lastFour");
    expect(source).not.toContain("encryptedPayload: vendorPayoutMethods.encryptedPayload");
  });

  it("separates platform read and mutation permissions", () => {
    const source = readFileSync(rbacPath, "utf8");

    expect(source).toContain('"/api/v1/admin/marketplace-finance/payouts"');
    expect(source).toContain('"/api/v1/admin/marketplace-finance/payouts/preview"');
    expect(source).toContain('"/api/v1/admin/marketplace-finance/payouts/reserve"');
    expect(source).toContain('"/api/v1/admin/marketplace-finance/payouts/*/claim"');
    expect(source).toContain('"/api/v1/admin/marketplace-finance/settlements/*/release"');
    expect(source).toContain("PERMISSIONS.VENDORS_VIEW");
    expect(source).toContain("PERMISSIONS.VENDORS_MANAGE_PAYOUTS");
  });
});
