import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStorefrontProducts: vi.fn(),
}));

vi.mock("../products/products.storefront", () => ({
  getStorefrontProducts: mocks.getStorefrontProducts,
}));

import {
  getPublicVendorCatalog,
  isPublicVendorState,
  listPublicVendors,
} from "./vendors.public";

function createDb(...results: unknown[]) {
  const queue = [...results];
  return {
    select: vi.fn(() => {
      const result = queue.shift();
      const chain = {
        where: vi.fn(() => chain),
        get: vi.fn(async () => result ?? null),
        all: vi.fn(async () => result ?? []),
      };
      return { from: vi.fn(() => chain) };
    }),
  };
}

describe("public seller catalog", () => {
  beforeEach(() => {
    mocks.getStorefrontProducts.mockReset();
    mocks.getStorefrontProducts.mockResolvedValue({
      products: [{ id: "product_1", slug: "product-one" }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it("exposes only approved non-deleted sellers", () => {
    expect(isPublicVendorState({ status: "approved", deletedAt: null })).toBe(true);
    expect(isPublicVendorState({ status: "pending", deletedAt: null })).toBe(false);
    expect(isPublicVendorState({ status: "suspended", deletedAt: null })).toBe(false);
    expect(isPublicVendorState({ status: "approved", deletedAt: new Date() })).toBe(false);
  });

  it("returns null when no approved seller matches the slug", async () => {
    const db = createDb(null);
    await expect(getPublicVendorCatalog(db as never, "missing", {})).resolves.toBeNull();
    expect(mocks.getStorefrontProducts).not.toHaveBeenCalled();
  });

  it("lists only bounded public seller identities for discovery and sitemaps", async () => {
    const queue: unknown[] = [
      { count: 2 },
      [
        { id: "vendor_1", name: "Seller One", slug: "seller-one", updatedAt: new Date("2026-07-14") },
        { id: "vendor_2", name: "Seller Two", slug: "seller-two", updatedAt: new Date("2026-07-13") },
      ],
    ];
    const select = vi.fn(() => {
      const result = queue.shift();
      const chain = {
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        offset: vi.fn(() => chain),
        get: vi.fn(async () => result ?? null),
        all: vi.fn(async () => result ?? []),
      };
      return { from: vi.fn(() => chain) };
    });

    await expect(listPublicVendors({ select } as never, { page: 1, limit: 100 })).resolves.toEqual({
      vendors: [
        { id: "vendor_1", name: "Seller One", slug: "seller-one", updatedAt: new Date("2026-07-14") },
        { id: "vendor_2", name: "Seller Two", slug: "seller-two", updatedAt: new Date("2026-07-13") },
      ],
      pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });
  });

  it("uses the canonical storefront product query with server-resolved seller ownership", async () => {
    const vendor = {
      id: "vendor_1",
      name: "Seller One",
      slug: "seller-one",
      contactEmail: "seller@example.com",
      contactPhone: "+8801700000000",
      createdAt: new Date("2026-07-14T00:00:00Z"),
    };
    const db = createDb(vendor, null);

    await expect(getPublicVendorCatalog(db as never, "seller-one", {
      page: 2,
      limit: 12,
      sort: "price-asc",
    })).resolves.toEqual({
      vendor: {
        id: "vendor_1",
        name: "Seller One",
        slug: "seller-one",
        createdAt: new Date("2026-07-14T00:00:00Z"),
      },
      profile: null,
      products: [{ id: "product_1", slug: "product-one" }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(mocks.getStorefrontProducts).toHaveBeenCalledWith(db, {
      page: 2,
      limit: 12,
      sort: "price-asc",
      vendorId: "vendor_1",
    });
  });

  it("publishes only profile-approved presentation and visibility-filtered contact fields", async () => {
    const vendor = {
      id: "vendor_1",
      name: "Seller One",
      slug: "seller-one",
      contactEmail: "seller@example.com",
      contactPhone: "+8801700000000",
      createdAt: new Date("2026-07-14T00:00:00Z"),
    };
    const profile = {
      description: "Public seller description",
      logoMediaId: "media_logo",
      bannerMediaId: "media_banner",
      showContactEmail: true,
      showContactPhone: false,
      seoTitle: "Seller SEO",
      seoDescription: "Seller SEO description",
      returnPolicy: "Seven-day returns",
      supportHours: "Sat–Thu, 9am–6pm",
    };
    const mediaRows = [
      { id: "media_logo", url: "https://cdn.example/logo.png", altText: "Seller logo" },
      { id: "media_banner", url: "https://cdn.example/banner.png", altText: "Seller banner" },
    ];
    const db = createDb(vendor, profile, mediaRows);

    const result = await getPublicVendorCatalog(db as never, "seller-one", {});
    expect(result?.profile).toEqual({
      description: "Public seller description",
      logoUrl: "https://cdn.example/logo.png",
      logoAlt: "Seller logo",
      bannerUrl: "https://cdn.example/banner.png",
      bannerAlt: "Seller banner",
      publicEmail: "seller@example.com",
      publicPhone: null,
      seoTitle: "Seller SEO",
      seoDescription: "Seller SEO description",
      returnPolicy: "Seven-day returns",
      supportHours: "Sat–Thu, 9am–6pm",
    });
    expect(result?.vendor).not.toHaveProperty("contactEmail");
    expect(result?.vendor).not.toHaveProperty("contactPhone");
  });
});
