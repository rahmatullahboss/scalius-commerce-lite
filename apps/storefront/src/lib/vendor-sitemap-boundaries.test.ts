import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiPath = fileURLToPath(new URL("./api/vendors.ts", import.meta.url));
const sitemapPath = fileURLToPath(new URL("../pages/sitemap-vendors.xml.ts", import.meta.url));
const indexPath = fileURLToPath(new URL("../pages/sitemap.xml.ts", import.meta.url));

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("seller sitemap boundaries", () => {
  it("provides a bounded public seller listing helper", () => {
    const source = read(apiPath);
    expect(source).toContain("listPublicVendors");
    expect(source).toContain("page: Math.min(Math.max");
    expect(source).toContain("limit: Math.min(Math.max");
    expect(source).toContain('createApiUrl("/vendors")');
    expect(source).toContain("response.status === 503");
  });

  it("generates sitemap URLs only from public seller identities", () => {
    const source = read(sitemapPath);
    expect(source).toContain("listPublicVendors");
    expect(source).toContain("/vendors/${vendor.slug}");
    expect(source).toContain("generateSitemap");
    expect(source).not.toContain("contactEmail");
    expect(source).not.toContain("contactPhone");
  });

  it("supports bounded sitemap pagination and returns 404 for missing chunks", () => {
    const source = read(sitemapPath);
    expect(source).toContain("VENDORS_PER_SITEMAP");
    expect(source).toContain("sitemapPage < 1");
    expect(source).toContain("return new Response('Page not found', { status: 404 })");
  });

  it("links the seller sitemap from the master index", () => {
    const source = read(indexPath);
    expect(source).toContain("sitemap-vendors.xml");
  });
});
