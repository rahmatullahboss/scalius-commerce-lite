import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routePath = fileURLToPath(new URL("./vendor-dashboard.ts", import.meta.url));
const authPath = fileURLToPath(new URL("../../middleware/admin-auth.ts", import.meta.url));

describe("seller dashboard shipment boundaries", () => {
  it("delegates shipment and fulfillment mutations to core commands", () => {
    const source = readFileSync(routePath, "utf8");
    expect(source).toContain("createVendorShipment");
    expect(source).toContain("createVendorProviderShipment");
    expect(source).toContain("checkVendorProviderShipmentStatus");
    expect(source).toContain("updateVendorShipmentStatus");
    expect(source).toContain("updateSellerVendorOrderStatus");
    expect(source).not.toMatch(/\.insert\(vendorShipments\)/);
    expect(source).not.toMatch(/\.update\(vendorShipments\)/);
    expect(source).not.toMatch(/\.update\(vendorOrders\)/);
  });

  it("requires seller capabilities, flags, and encrypted provider credentials", () => {
    const source = readFileSync(routePath, "utf8");
    expect(source).toContain('requireVendorContext(c, vendorId, "orders.write")');
    expect(source).toContain('requireVendorContext(c, vendorId, "orders.read")');
    expect(source).toContain('assertMarketplaceFeatureEnabled(db, "vendorShipments"');
    expect(source).toContain('assertMarketplaceFeatureEnabled(db, "sellerOrderActions"');
    expect(source).toContain("requireEncryptionKey(c.env)");
    expect(source).toContain("createVendorProviderShipment");
    expect(source).toContain("parentOrderStatusUpdate");
    expect(source).toContain("enqueueOrderStatusChangeNotification");
  });

  it("exposes seller-scoped order and shipment routes", () => {
    const source = readFileSync(routePath, "utf8");
    expect(source).toContain('path: "/orders/{vendorOrderId}"');
    expect(source).toContain('path: "/orders/{vendorOrderId}/status"');
    expect(source).toContain('path: "/orders/{vendorOrderId}/shipments"');
    expect(source).toContain('path: "/delivery-providers"');
    expect(source).toContain('path: "/shipments"');
    expect(source).toContain('path: "/shipments/{shipmentId}"');
    expect(source).toContain('path: "/shipments/{shipmentId}/check-status"');
    expect(source).toContain('path: "/shipments/{shipmentId}/status"');
    expect(source).toContain("vendorContext.vendorId");
  });

  it("does not permit seller order APIs to write shipped or delivered directly", () => {
    const source = readFileSync(routePath, "utf8");
    expect(source).toContain('z.enum(["processing", "ready"])');
    expect(source).not.toContain('z.enum(["processing", "ready", "shipped", "delivered"])');
  });

  it("keeps seller dashboard requests outside platform-admin RBAC", () => {
    const source = readFileSync(authPath, "utf8");
    expect(source).toContain("isSellerDashboardRequest(pathname)");
    expect(source).toContain("They intentionally do not inherit platform-admin RBAC");
  });
});
