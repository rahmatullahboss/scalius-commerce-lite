import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routePath = fileURLToPath(new URL("./vendors.ts", import.meta.url));
const appPath = fileURLToPath(new URL("../app.ts", import.meta.url));

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("public seller catalog API boundaries", () => {
  it("mounts a dedicated public seller route group", () => {
    const app = read(appPath);
    expect(app).toContain('import { vendorRoutes } from "./routes/vendors"');
    expect(app).toContain('app.route("/vendors", vendorRoutes)');
  });

  it("fails closed behind the independent public catalog flag", () => {
    const source = read(routePath);
    expect(source).toContain('assertMarketplaceFeatureEnabled(db, "publicVendorCatalog"');
  });

  it("delegates seller eligibility and products to the canonical core query", () => {
    const source = read(routePath);
    expect(source).toContain("getPublicVendorCatalog");
    expect(source).not.toContain(".from(products)");
    expect(source).not.toContain(".from(vendors)");
  });

  it("exposes bounded seller discovery and seller-by-slug endpoints with cache normalization", () => {
    const source = read(routePath);
    expect(source).toContain('path: "/"');
    expect(source).toContain('path: "/{slug}"');
    expect(source).toContain("listPublicVendors");
    expect(source).toContain("page: z.coerce.number().int().min(1)");
    expect(source).toContain("limit: z.coerce.number().int().min(1).max(100)");
    expect(source).toContain('keyPrefix: "api:vendors:"');
    expect(source).toContain("varyByQuery: true");
  });

  it("keeps discovery responses limited to public seller identity fields", () => {
    const source = read(routePath);
    expect(source).toContain("updatedAt: z.any()");
    expect(source).not.toContain("contactEmail");
    expect(source).not.toContain("contactPhone");
    expect(source).not.toContain("encryptedPayload");
    expect(source).not.toContain("kycDocuments");
  });

  it("returns only published presentation fields and filtered public contact names", () => {
    const source = read(routePath);
    expect(source).toContain("publicVendorProfileSchema");
    expect(source).toContain("profile: publicVendorProfileSchema.nullable()");
    expect(source).toContain("publicEmail");
    expect(source).toContain("publicPhone");
    expect(source).not.toContain("logoMediaId");
    expect(source).not.toContain("bannerMediaId");
  });

  it("returns 404 for non-public sellers without exposing status details", () => {
    const source = read(routePath);
    expect(source).toContain('throw new NotFoundError("Seller not found")');
    expect(source).not.toContain("pending seller");
    expect(source).not.toContain("suspended seller");
  });
});
