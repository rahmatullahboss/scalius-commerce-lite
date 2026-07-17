import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routePath = fileURLToPath(new URL("./vendor-dashboard.ts", import.meta.url));
const source = readFileSync(routePath, "utf8");

describe("seller payout method API boundaries", () => {
  it("delegates all sensitive destination operations to core commands", () => {
    expect(source).toContain("listVendorPayoutMethods");
    expect(source).toContain("createVendorPayoutMethod");
    expect(source).toContain("setDefaultVendorPayoutMethod");
    expect(source).toContain("disableVendorPayoutMethod");
    expect(source).not.toMatch(/\.insert\(vendorPayoutMethods\)/);
    expect(source).not.toMatch(/\.update\(vendorPayoutMethods\)/);
  });

  it("requires seller finance capability and payout feature flag for writes", () => {
    expect(source).toContain('requireVendorContext(c, vendorId, "finance.read")');
    expect(source).toContain('requireVendorContext(c, vendorId, "payout.manage")');
    expect(source).toContain('assertMarketplaceFeatureEnabled(db, "payoutWrite"');
    expect(source).toContain("requireEncryptionKey(c.env)");
  });

  it("exposes masked list, encrypted create, default, and disable routes", () => {
    expect(source).toContain('path: "/payout-methods"');
    expect(source).toContain('path: "/payout-methods/{methodId}/default"');
    expect(source).toContain('path: "/payout-methods/{methodId}/disable"');
    expect(source).toContain("destination: z.record(z.string(), z.unknown())");
  });

  it("never selects or returns encrypted destination fields", () => {
    expect(source).not.toContain("encryptedPayload: vendorPayoutMethods.encryptedPayload");
    expect(source).not.toContain("fingerprint: vendorPayoutMethods.fingerprint");
    expect(source).not.toContain("accountNumber:");
    expect(source).not.toContain("phoneNumber:");
  });

  it("returns only masked method metadata", () => {
    expect(source).toContain("maskedVendorPayoutMethodSchema");
    expect(source).toContain("lastFour: z.string().nullable()");
    expect(source).toContain("status: z.enum([\"pending\", \"verified\", \"rejected\", \"disabled\"])");
  });
});
