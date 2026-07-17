import { withEdgeCache, CACHE_TTL } from "@/lib/edge-cache";
import { buildCanonicalQueryString } from "@/lib/cache-key";
import { createApiUrl, fetchWithRetry } from "./client";
import type { PaginatedResponse, Product } from "./types";
import { unwrapData } from "./unwrap";
import type { ProductListOptions } from "./products";

export interface PublicVendor {
  id: string;
  name: string;
  slug: string;
  createdAt: string | number | Date;
}

export interface PublicVendorDiscovery {
  id: string;
  name: string;
  slug: string;
  updatedAt: string;
}

export interface PublicVendorProfile {
  description: string | null;
  logoUrl: string | null;
  logoAlt: string | null;
  bannerUrl: string | null;
  bannerAlt: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  returnPolicy: string | null;
  supportHours: string | null;
}

export interface PublicVendorCatalog {
  vendor: PublicVendor;
  profile: PublicVendorProfile | null;
  products: Product[];
  pagination: PaginatedResponse<Product>["pagination"];
}

export interface PublicVendorList {
  vendors: PublicVendorDiscovery[];
  pagination: PaginatedResponse<PublicVendorDiscovery>["pagination"];
}

function normalizeVendorCatalogOptions(
  options: ProductListOptions = {},
): Pick<ProductListOptions, "page" | "limit" | "sort"> {
  return {
    page: Math.min(Math.max(Number(options.page ?? 1), 1), 10_000),
    limit: Math.min(Math.max(Number(options.limit ?? 20), 1), 100),
    sort: options.sort ?? "newest",
  };
}

export async function listPublicVendors(
  options: { page?: number; limit?: number } = {},
): Promise<PublicVendorList> {
  const normalized = {
    page: Math.min(Math.max(Math.trunc(Number(options.page ?? 1)), 1), 10_000),
    limit: Math.min(Math.max(Math.trunc(Number(options.limit ?? 20)), 1), 100),
  };
  const queryString = buildCanonicalQueryString(normalized, {
    defaultParams: { page: 1, limit: 20 },
  });
  const cacheKey = `public_vendors_${queryString || "default"}`;
  const fallback: PublicVendorList = {
    vendors: [],
    pagination: { page: normalized.page, limit: normalized.limit, total: 0, totalPages: 0 },
  };
  const result = await withEdgeCache(
    cacheKey,
    async () => {
      const baseUrl = createApiUrl("/vendors");
      const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;
      const response = await fetchWithRetry(url, {}, 2, 8_000, false);
      if (response.status === 503) return fallback;
      if (!response.ok) throw new Error(`Seller listing API returned ${response.status}`);
      const json = await response.json();
      return unwrapData<PublicVendorList>(json) ?? fallback;
    },
    { ttlSeconds: CACHE_TTL.MEDIUM },
  );
  return result ?? fallback;
}

export async function getPublicVendorCatalog(
  slug: string,
  options: ProductListOptions = {},
): Promise<PublicVendorCatalog | null> {
  if (!slug) return null;
  const normalizedOptions = normalizeVendorCatalogOptions(options);
  const queryString = buildCanonicalQueryString(normalizedOptions, {
    defaultParams: { page: 1, limit: 20, sort: "newest" },
  });
  const cacheKey = `vendor_catalog_${slug}_${queryString || "default"}`;

  return withEdgeCache(
    cacheKey,
    async () => {
      const baseUrl = createApiUrl(`/vendors/${encodeURIComponent(slug)}`);
      const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;
      const response = await fetchWithRetry(url, {}, 2, 8_000, false);
      if (response.status === 404 || response.status === 503) return null;
      if (!response.ok) {
        throw new Error(`Seller catalog API returned ${response.status}`);
      }
      const json = await response.json();
      return unwrapData<PublicVendorCatalog>(json);
    },
    { ttlSeconds: CACHE_TTL.MEDIUM },
  );
}
