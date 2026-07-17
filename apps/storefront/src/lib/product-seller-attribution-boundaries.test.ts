import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const corePath = fileURLToPath(
  new URL("../../../../packages/core/src/modules/products/products.storefront.ts", import.meta.url),
);
const apiRoutePath = fileURLToPath(
  new URL("../../../api/src/routes/products.ts", import.meta.url),
);
const apiClientPath = fileURLToPath(new URL("./api/products.ts", import.meta.url));
const pagePath = fileURLToPath(new URL("../pages/products/[slug].astro", import.meta.url));
const summaryPath = fileURLToPath(
  new URL("../components/product/ProductSummary.astro", import.meta.url),
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("product seller attribution boundaries", () => {
  it("loads seller identity from the approved product snapshot owner", () => {
    const source = read(corePath);
    expect(source).toContain("vendors");
    expect(source).toContain("vendorId: products.vendorId");
    expect(source).toContain('type: "seller"');
    expect(source).toContain("seller,");
  });

  it("publishes seller identity in the product API contract and storefront client", () => {
    expect(read(apiRoutePath)).toContain("seller: productSellerSchema");
    expect(read(apiClientPath)).toContain("seller: ProductSeller");
  });

  it("links product detail pages to the seller storefront", () => {
    const page = read(pagePath);
    const summary = read(summaryPath);
    expect(page).toContain("seller={seller}");
    expect(page).toContain("seller?.name || storeName");
    expect(summary).toContain("seller?: ProductSeller | null");
    expect(summary).toContain('href={`/vendors/${seller.slug}`}');
    expect(summary).toContain("Sold by");
  });
});
