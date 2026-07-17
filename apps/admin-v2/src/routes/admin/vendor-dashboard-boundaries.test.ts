import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const functionsPath = fileURLToPath(
  new URL("../../lib/api-functions/vendor-dashboard.ts", import.meta.url),
);
const queriesPath = fileURLToPath(
  new URL("../../lib/api-query-options/vendor-dashboard.ts", import.meta.url),
);
const keysPath = fileURLToPath(new URL("../../lib/query-keys.ts", import.meta.url));
const routePath = fileURLToPath(new URL("./vendor-dashboard.tsx", import.meta.url));
const teamPanelsPath = fileURLToPath(
  new URL("../../components/admin/vendor-dashboard/VendorTeamPanels.tsx", import.meta.url),
);
const profilePanelPath = fileURLToPath(
  new URL("../../components/admin/vendor-dashboard/VendorProfilePanel.tsx", import.meta.url),
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("seller dashboard functional UI boundaries", () => {
  it("provides typed seller catalog, order, and shipment server functions", () => {
    const source = read(functionsPath);
    for (const name of [
      "applyForVendorDashboard",
      "getVendorDashboardTeam",
      "getVendorDashboardProfile",
      "updateVendorDashboardProfile",
      "createVendorDashboardTeamInvite",
      "acceptVendorDashboardTeamInvite",
      "revokeVendorDashboardTeamInvite",
      "updateVendorDashboardTeamMember",
      "getVendorDashboardProduct",
      "createVendorDashboardProduct",
      "updateVendorDashboardProduct",
      "submitVendorDashboardProduct",
      "getVendorDashboardProductVariants",
      "updateVendorDashboardProductVariant",
      "getVendorDashboardPayoutMethods",
      "createVendorDashboardPayoutMethod",
      "setDefaultVendorDashboardPayoutMethod",
      "disableVendorDashboardPayoutMethod",
      "updateVendorDashboardOrderStatus",
      "getVendorDashboardDeliveryProviders",
      "getVendorDashboardShipments",
      "createVendorDashboardShipment",
      "checkVendorDashboardShipmentStatus",
      "updateVendorDashboardShipmentStatus",
    ]) expect(source).toContain(name);
    expect(source).toContain("apiPost");
    expect(source).toContain("apiPut");
    expect(source).toContain("apiPatch");
  });

  it("defines cache keys and query options for seller product details and shipments", () => {
    const queries = read(queriesPath);
    const keys = read(keysPath);
    expect(queries).toContain("vendorDashboardTeamQueryOptions");
    expect(queries).toContain("vendorDashboardProfileQueryOptions");
    expect(queries).toContain("vendorDashboardProductQueryOptions");
    expect(queries).toContain("vendorDashboardProductVariantsQueryOptions");
    expect(queries).toContain("vendorDashboardPayoutMethodsQueryOptions");
    expect(queries).toContain("vendorDashboardDeliveryProvidersQueryOptions");
    expect(queries).toContain("vendorDashboardShipmentsQueryOptions");
    expect(keys).toContain("team: (params?: Record<string, unknown>)");
    expect(keys).toContain("profile: (params?: Record<string, unknown>)");
    expect(keys).toContain("product: (productId: string");
    expect(keys).toContain("variants: (productId: string");
    expect(keys).toContain("shipments: (params?: Record<string, unknown>)");
  });

  it("renders seller onboarding and only unlocks operations for approved vendors", () => {
    const source = read(routePath);
    expect(source).toContain("SellerApplicationPanel");
    expect(source).toContain('vendorStatus === "approved"');
    expect(source).toContain("applyForVendorDashboard");
    expect(source).toContain('membership.vendorStatus === "rejected"');
    expect(source).toContain("Correct and resubmit seller application");
    expect(source).toContain("usePermissions");
    expect(source).toContain("ADMIN_PERMISSIONS.VENDORS_VIEW");
  });

  it("renders overview, products, orders, shipments, and finance tabs", () => {
    const source = read(routePath);
    for (const tab of ["overview", "products", "orders", "shipments", "finance", "profile", "team"]) {
      expect(source).toContain(`value=\"${tab}\"`);
    }
    expect(source).toContain("TabsList");
    expect(source).toContain("VendorProductsPanel");
    expect(source).toContain("VendorOrdersPanel");
    expect(source).toContain("VendorShipmentsPanel");
    expect(source).toContain("VendorFinancePanel");
    expect(source).toContain("VendorProfilePanel");
    expect(source).toContain("VendorTeamPanel");
    expect(source).toContain('selectedMembership.role === "owner"');
    expect(source).toContain('selectedMembership.role === "admin"');
  });

  it("supports creating/editing/submitting products and operational order/shipment actions", () => {
    const source = read(routePath);
    expect(source).toContain("ProductEditor");
    expect(source).toContain("submitVendorDashboardProduct");
    expect(source).toContain("updateVendorDashboardOrderStatus");
    expect(source).toContain("createVendorDashboardShipment");
    expect(source).toContain("checkVendorDashboardShipmentStatus");
    expect(source).toContain("Refresh courier");
    expect(source).toContain("vendorDashboardDeliveryProvidersQueryOptions");
    expect(source).toContain("providerId");
    expect(source).toContain("reconciliationRequired");
    expect(source).toContain("updateVendorDashboardShipmentStatus");
  });

  it("keeps seller profile publication explicit and contact visibility opt-in", () => {
    const profile = read(profilePanelPath);
    expect(profile).toContain("updateVendorDashboardProfile");
    expect(profile).toContain("publicationStatus");
    expect(profile).toContain("Draft — private");
    expect(profile).toContain("Published — public");
    expect(profile).toContain("showContactEmail");
    expect(profile).toContain("showContactPhone");
    expect(profile).toContain("logoMediaId");
    expect(profile).toContain("bannerMediaId");
  });

  it("keeps seller invitations one-time and owner-protected", () => {
    const panels = read(teamPanelsPath);
    expect(panels).toContain("acceptVendorDashboardTeamInvite");
    expect(panels).toContain("createVendorDashboardTeamInvite");
    expect(panels).toContain("revokeVendorDashboardTeamInvite");
    expect(panels).toContain("updateVendorDashboardTeamMember");
    expect(panels).toContain("oneTimeCredential");
    expect(panels).toContain("cannot be retrieved from the server");
    expect(panels).toContain('member.role === "owner"');
    expect(panels).not.toContain("tokenHash");
  });

  it("invalidates seller dashboard caches after every mutation", () => {
    const source = read(routePath);
    expect(source).toContain("queryKeys.vendorDashboard.all");
    expect(source.match(/invalidateQueries/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
