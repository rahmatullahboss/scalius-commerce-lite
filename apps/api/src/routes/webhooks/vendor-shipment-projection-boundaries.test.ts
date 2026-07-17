import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const files = [
  fileURLToPath(new URL("./pathao.ts", import.meta.url)),
  fileURLToPath(new URL("./steadfast.ts", import.meta.url)),
];

describe("seller package courier event wiring", () => {
  it("keeps legacy delivery handling while adding canonical seller package projection", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("resolveVendorShipmentProviderStatusTarget");
      expect(source).toContain("projectVendorShipmentProviderStatus");
      expect(source).toContain("vendorProjection");
      expect(source).toContain("parentOrderStatusUpdate");
      expect(source).toContain("enqueueOrderStatusChangeNotification");
      expect(source).toContain("invalidateProductAvailabilityCaches");
      expect(source).toContain("deliveryShipments");
      expect(source).toContain("updateOrderStatusFromShipment");
    }
  });
});
