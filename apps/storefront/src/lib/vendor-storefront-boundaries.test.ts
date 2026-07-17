import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiPath = fileURLToPath(new URL("./api/vendors.ts", import.meta.url));
const apiIndexPath = fileURLToPath(new URL("./api/index.ts", import.meta.url));
const pagePath = fileURLToPath(new URL("../pages/vendors/[slug].astro", import.meta.url));

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("public seller storefront boundaries", () => {
  it("fetches seller catalogs through the centralized API client and edge cache", () => {
    const source = read(apiPath);
    expect(source).toContain("createApiUrl");
    expect(source).toContain("fetchWithRetry");
    expect(source).toContain("withEdgeCache");
    expect(source).toContain("`/vendors/${encodeURIComponent(slug)}`");
    expect(source).toContain("`vendor_catalog_${slug}_");
  });

  it("exports the seller API helper from the storefront barrel", () => {
    expect(read(apiIndexPath)).toContain('export * from "./vendors"');
  });

  it("renders a dedicated seller page using shared layout and product cards", () => {
    const source = read(pagePath);
    expect(source).toContain("getPublicVendorCatalog");
    expect(source).toContain("Layout");
    expect(source).toContain("ProductCard");
    expect(source).toContain("return new Response(null, { status: 404 })");
    expect(source).toContain("/vendors/${slug}");
  });

  it("renders published seller profile media, SEO, filtered contact, and policies", () => {
    const api = read(apiPath);
    const page = read(pagePath);
    expect(api).toContain("PublicVendorProfile");
    expect(api).toContain("profile: PublicVendorProfile | null");
    expect(page).toContain("profile?.seoTitle");
    expect(page).toContain("profile?.bannerUrl");
    expect(page).toContain("profile?.logoUrl");
    expect(page).toContain("profile?.publicEmail");
    expect(page).toContain("profile?.publicPhone");
    expect(page).toContain("Seller return policy");
  });

  it("uses bounded pagination and a canonical page-one seller URL", () => {
    const source = read(pagePath);
    expect(source).toContain("Math.min(Math.max");
    expect(source).toContain("pagination.totalPages");
    expect(source).toContain("canonicalUrl");
    expect(source).toContain("pageNum.toString()");
  });
});
