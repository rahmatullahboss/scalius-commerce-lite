import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routePath = fileURLToPath(new URL("./vendor-dashboard.ts", import.meta.url));
const source = readFileSync(routePath, "utf8");

describe("seller profile API boundaries", () => {
  it("exposes seller-scoped profile read and update routes", () => {
    expect(source.match(/path: "\/profile"/g)?.length).toBe(2);
    expect(source).toContain("getVendorProfile");
    expect(source).toContain("upsertVendorProfile");
  });

  it("requires profile.manage and gates public profile writes", () => {
    expect(source.match(/\"profile\.manage\"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('assertMarketplaceFeatureEnabled(db, "vendorCatalogWrite"');
  });

  it("invalidates the exact public seller path without accepting lifecycle or financial authority", () => {
    expect(source).toContain("htmlPaths: [`/vendors/${vendorContext.vendorSlug}`]");
    const schemaBlock = source.slice(
      source.indexOf("const vendorProfileInputSchema"),
      source.indexOf("const summaryPayloadSchema"),
    );
    expect(schemaBlock).toContain("publicationStatus");
    expect(schemaBlock).not.toContain("commission");
    expect(schemaBlock).not.toContain("payout");
    expect(schemaBlock).not.toContain("vendorStatus");
  });
});
