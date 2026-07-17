import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routesDirectory = fileURLToPath(new URL(".", import.meta.url));
const apiDirectory = fileURLToPath(new URL("../../", import.meta.url));
const coreRbacDirectory = fileURLToPath(
  new URL("../../../../../packages/core/src/auth/rbac/", import.meta.url),
);

describe("marketplace finance API boundaries", () => {
  it("mounts one platform-admin finance route group", () => {
    const appSource = readFileSync(`${apiDirectory}/app.ts`, "utf8");
    expect(appSource).toContain("adminMarketplaceFinanceRoutes");
    expect(appSource).toContain(
      'app.route("/admin/marketplace-finance", adminMarketplaceFinanceRoutes)',
    );
  });

  it("exposes only ledger-derived reads and feature-gated mutation controls", () => {
    const source = readFileSync(`${routesDirectory}/marketplace-finance.ts`, "utf8");

    expect(source).toContain("getMarketplaceFinanceReconciliation");
    expect(source).toContain("financialEventMismatches");
    expect(source).toContain("payment.captured");
    expect(source).toContain("refund.completed");
    expect(source).toContain("rebuildVendorBalanceProjections");
    expect(source).toContain("processMarketplaceOutboxBatch");
    expect(source).toContain('assertMarketplaceFeatureEnabled(db, "ledgerPosting"');
    expect(source).toContain("vendorBalanceProjections");
    expect(source).not.toContain("vendorOrders");
  });

  it("protects read and mutation routes with separate platform permissions", () => {
    const source = readFileSync(`${coreRbacDirectory}/route-permissions.ts`, "utf8");

    expect(source).toContain('"/api/v1/admin/marketplace-finance/reconciliation"');
    expect(source).toContain('GET: { permission: PERMISSIONS.VENDORS_VIEW }');
    expect(source).toContain('"/api/v1/admin/marketplace-finance/projections/rebuild"');
    expect(source).toContain('"/api/v1/admin/marketplace-finance/outbox/process"');
    expect(
      source.match(/POST: \{ permission: PERMISSIONS\.VENDORS_MANAGE_PAYOUTS \}/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
  });

  it("keeps seller finance unavailable unless ledger flag and finance capability both pass", () => {
    const source = readFileSync(`${routesDirectory}/vendor-dashboard.ts`, "utf8");

    expect(source).toContain("marketplaceFlags.ledgerPosting");
    expect(source).toContain('hasVendorCapability(vendorContext, "finance.read")');
    expect(source).toContain("vendorBalanceProjections");
    expect(source).not.toContain("vendor_orders.vendor_net");
  });
});
