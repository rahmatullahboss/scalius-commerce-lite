import type { APIContext, APIRoute } from "astro";
import { listPublicVendors, type PublicVendorDiscovery } from "@/lib/api/vendors";
import { getRuntimeStorefrontUrl } from "@/lib/api/runtime-env";
import {
  generateSitemap,
  getSitemapHeaders,
  type SitemapUrl,
} from "@/lib/sitemap-utils";

export const prerender = false;

const VENDORS_PER_SITEMAP = 5_000;
const API_PAGE_SIZE = 100;
const API_PAGES_PER_SITEMAP = VENDORS_PER_SITEMAP / API_PAGE_SIZE;

export const GET: APIRoute = async ({ url }: APIContext) => {
  try {
    const pageParam = url.searchParams.get("page");
    const sitemapPage = pageParam ? Number.parseInt(pageParam, 10) : 1;
    if (!Number.isSafeInteger(sitemapPage) || sitemapPage < 1) {
      return new Response("Invalid page parameter", { status: 400 });
    }

    const startApiPage = (sitemapPage - 1) * API_PAGES_PER_SITEMAP + 1;
    const firstResponse = await listPublicVendors({
      page: startApiPage,
      limit: API_PAGE_SIZE,
    });
    if (firstResponse.vendors.length === 0 && sitemapPage > 1) {
      return new Response('Page not found', { status: 404 });
    }

    const vendors: PublicVendorDiscovery[] = [...firstResponse.vendors];
    const maxApiPage = Math.min(
      startApiPage + API_PAGES_PER_SITEMAP - 1,
      firstResponse.pagination.totalPages,
    );
    const batchSize = 5;
    for (let currentPage = startApiPage + 1; currentPage <= maxApiPage; currentPage += batchSize) {
      const endPage = Math.min(currentPage + batchSize - 1, maxApiPage);
      const pages = Array.from(
        { length: endPage - currentPage + 1 },
        (_, index) => currentPage + index,
      );
      const responses = await Promise.all(
        pages.map((page) => listPublicVendors({ page, limit: API_PAGE_SIZE })),
      );
      for (const response of responses) vendors.push(...response.vendors);
    }

    const baseUrl = getRuntimeStorefrontUrl();
    const sellerUrls: SitemapUrl[] = vendors.map((vendor) => ({
      loc: `${baseUrl}/vendors/${vendor.slug}`,
      lastmod: vendor.updatedAt,
      changefreq: "daily",
      priority: 0.8,
    }));
    return new Response(generateSitemap(sellerUrls, baseUrl), {
      status: 200,
      headers: getSitemapHeaders(),
    });
  } catch (error: unknown) {
    console.error("Error generating seller sitemap:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
