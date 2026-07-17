import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routePath = fileURLToPath(new URL("./vendor-dashboard.ts", import.meta.url));

const source = readFileSync(routePath, "utf8");

describe("seller dashboard catalog boundaries", () => {
  it("delegates seller product writes to tenant-scoped core commands", () => {
    expect(source).toContain("createVendorProduct");
    expect(source).toContain("updateVendorProduct");
    expect(source).toContain("submitVendorProduct");
    expect(source).toContain("listVendorProductVariants");
    expect(source).toContain("updateVendorProductVariant");
    expect(source).not.toMatch(/\.insert\(products\)/);
    expect(source).not.toMatch(/\.update\(products\)/);
  });

  it("derives seller ownership from membership and independently gates catalog writes", () => {
    expect(source).toContain('requireVendorContext(c, vendorId, "catalog.write")');
    expect(source).toContain('requireVendorContext(c, vendorId, "catalog.read")');
    expect(source).toContain('assertMarketplaceFeatureEnabled(db, "vendorCatalogWrite"');
    expect(source).toContain("vendorId: vendorContext.vendorId");
  });

  it("exposes seller catalog options, detail, create, update, and submit routes", () => {
    expect(source).toContain('path: "/categories"');
    expect(source).toContain('path: "/products/{productId}"');
    expect(source).toContain('path: "/products"');
    expect(source).toContain('path: "/products/{productId}/submit"');
    expect(source).toContain('path: "/products/{productId}/variants"');
    expect(source).toContain('path: "/products/{productId}/variants/{variantId}"');
    expect(source).toContain("createProductSchema");
    expect(source).toContain("updateProductSchema");
  });

  it("verifies ownership before loading full product details", () => {
    expect(source).toContain("ProductsAdmin.getProductDetails");
    expect(source).toContain("eq(products.vendorId, vendorContext.vendorId)");
    expect(source).toContain("Seller product not found");
  });

  it("invalidates product and seller storefront caches after catalog mutations", () => {
    expect(source).toContain("invalidateCatalogCaches");
    expect(source).toContain("invalidateSellerProductCaches");
    expect(source).toContain("`/products/${slug}`");
    expect(source).toContain("`/vendors/${vendorSlug}`");
    expect(source.match(/await invalidateSellerProductCaches\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("never accepts authoritative seller ownership in the product body schema", () => {
    expect(source).not.toContain("createProductSchema.extend({ vendorId");
    expect(source).not.toContain("updateProductSchema.extend({ vendorId");
  });
});
