import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const functionsPath = fileURLToPath(
  new URL("../../lib/api-functions/marketplace-finance.ts", import.meta.url),
);
const routePath = fileURLToPath(new URL("./marketplace-finance.tsx", import.meta.url));
const accessPath = fileURLToPath(new URL("../../lib/admin-access.ts", import.meta.url));
const navPath = fileURLToPath(
  new URL("../../components/admin/layout/AdminNav.ts", import.meta.url),
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("platform marketplace finance UI boundaries", () => {
  it("provides typed server functions for reconciliation, settlements, and payout lifecycle", () => {
    const source = read(functionsPath);
    for (const name of [
      "getMarketplaceReconciliation",
      "rebuildMarketplaceProjections",
      "processMarketplaceOutbox",
      "sweepMarketplaceSettlements",
      "releaseMarketplaceSettlement",
      "previewMarketplacePayout",
      "reserveMarketplacePayout",
      "getMarketplacePayoutMethods",
      "moderateMarketplacePayoutMethod",
      "getMarketplacePayouts",
      "claimMarketplacePayout",
      "completeMarketplacePayout",
      "releaseMarketplacePayout",
    ]) expect(source).toContain(name);
    expect(source).toContain("apiGet");
    expect(source).toContain("apiPost");
  });

  it("renders reconciliation, maintenance, payout creation, and payout operations", () => {
    const source = read(routePath);
    expect(source).toContain("ReconciliationPanel");
    expect(source).toContain("MaintenancePanel");
    expect(source).toContain("PayoutMethodReviewPanel");
    expect(source).toContain("PayoutCreationPanel");
    expect(source).toContain("PayoutOperationsPanel");
    expect(source).toContain("previewMarketplacePayout");
    expect(source).toContain("reserveMarketplacePayout");
    expect(source).toContain("claimMarketplacePayout");
    expect(source).toContain("completeMarketplacePayout");
    expect(source).toContain("releaseMarketplacePayout");
  });

  it("shows reconciliation mismatches and disables no safety controls client-side", () => {
    const source = read(routePath);
    expect(source).toContain("ledgerMismatches");
    expect(source).toContain("financialEventMismatches");
    expect(source).toContain("refundMismatches");
    expect(source).toContain("payoutItemMismatches");
    expect(source).toContain("payoutBatchMismatches");
    expect(source).toContain("projectionMismatches");
    expect(source).not.toContain("bypassFeatureFlag");
    expect(source).not.toContain("skipReconciliation");
  });

  it("registers platform access and navigation with payout-management permission", () => {
    expect(read(accessPath)).toContain('"/admin/marketplace-finance"');
    const nav = read(navPath);
    expect(nav).toContain('href: "/admin/marketplace-finance"');
    expect(nav).toContain("VENDORS_MANAGE_PAYOUTS");
  });

  it("invalidates finance and vendor dashboard caches after mutations", () => {
    const source = read(routePath);
    expect(source).toContain("invalidateFinanceQueries");
    expect(source).toContain("queryKeys.vendorDashboard.all");
    expect(source.match(/invalidateFinanceQueries/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});
