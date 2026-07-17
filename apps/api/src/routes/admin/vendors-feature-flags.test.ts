import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routesDirectory = fileURLToPath(new URL(".", import.meta.url));

function countOccurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}

describe("vendor route marketplace feature gates", () => {
  it("keeps reads available while guarding onboarding and payout mutations", () => {
    const source = readFileSync(`${routesDirectory}/vendors.ts`, "utf8");

    expect(source).toContain('from "@scalius/core/modules/settings"');
    expect(
      countOccurrences(
        source,
        'assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite", c.env?.CACHE)',
      ),
    ).toBeGreaterThanOrEqual(4);
    expect(source).toContain(
      'assertMarketplaceFeatureEnabled(db, "payoutWrite", c.env?.CACHE)',
    );

    const listHandler = source.slice(
      source.indexOf("app.openapi(listVendorsRoute"),
      source.indexOf("const getVendorRoute"),
    );
    const detailHandler = source.slice(
      source.indexOf("app.openapi(getVendorRoute"),
      source.indexOf("const updateVendorRoute"),
    );
    expect(listHandler).not.toContain("assertMarketplaceFeatureEnabled");
    expect(detailHandler).not.toContain("assertMarketplaceFeatureEnabled");
  });

  it("invalidates public seller catalog caches after seller updates and moderation", () => {
    const source = readFileSync(`${routesDirectory}/vendors.ts`, "utf8");

    expect(source).toContain('invalidateCatalogCaches("products", c');
    expect(countOccurrences(source, 'invalidateCatalogCaches("products", c')).toBeGreaterThanOrEqual(2);
    expect(source).toContain("htmlPaths: [`/vendors/${vendor.slug}`]");
  });
});
