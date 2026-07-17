import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
    getPublicVendorCatalog,
    listPublicVendors,
} from "@scalius/core/modules/vendors/vendors.public";
import { assertMarketplaceFeatureEnabled } from "@scalius/core/modules/settings";
import { cacheMiddleware } from "../middleware/cache";
import { errorResponses, paginationSchema, successEnvelope } from "../schemas/responses";
import { NotFoundError } from "../utils/api-error";
import { ok } from "../utils/api-response";
import { CACHE_TTLS } from "../utils/cache-ttls";

const app = new OpenAPIHono<{ Bindings: Env }>();

app.use(
    "*",
    cacheMiddleware({
        ttl: CACHE_TTLS.STANDARD,
        keyPrefix: "api:vendors:",
        varyByQuery: true,
        queryDefaults: () => ({ page: 1, limit: 20, sort: "newest" }),
        methods: ["GET"],
    }),
);

const vendorCatalogQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum([
        "newest",
        "price-asc",
        "price-desc",
        "name-asc",
        "name-desc",
        "discount",
    ]).default("newest"),
});

const publicVendorSchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    createdAt: z.any(),
});

const publicVendorProfileSchema = z.object({
    description: z.string().nullable(),
    logoUrl: z.string().nullable(),
    logoAlt: z.string().nullable(),
    bannerUrl: z.string().nullable(),
    bannerAlt: z.string().nullable(),
    publicEmail: z.string().nullable(),
    publicPhone: z.string().nullable(),
    seoTitle: z.string().nullable(),
    seoDescription: z.string().nullable(),
    returnPolicy: z.string().nullable(),
    supportHours: z.string().nullable(),
});

const publicVendorDiscoverySchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    updatedAt: z.any(),
});

const publicVendorProductSchema = z.object({
    id: z.string(),
    name: z.string(),
    price: z.number(),
    slug: z.string(),
    discountType: z.string().nullable(),
    discountPercentage: z.number().nullable(),
    discountAmount: z.number().nullable(),
    freeDelivery: z.boolean(),
    categoryId: z.string().nullable(),
    hasVariants: z.boolean(),
    imageUrl: z.string().nullable(),
    imageAlt: z.string().nullable().optional(),
    category: z.object({ id: z.string(), name: z.string(), slug: z.string() }).nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    discountedPrice: z.number(),
}).passthrough();

const listVendorsRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["Vendors"],
    summary: "List approved public sellers",
    request: {
        query: z.object({
            page: z.coerce.number().int().min(1).default(1),
            limit: z.coerce.number().int().min(1).max(100).default(20),
        }),
    },
    responses: {
        200: {
            description: "Approved public sellers",
            content: {
                "application/json": {
                    schema: successEnvelope(z.object({
                        vendors: z.array(publicVendorDiscoverySchema),
                        pagination: paginationSchema,
                    })),
                },
            },
        },
        500: errorResponses[500],
    },
});

app.openapi(listVendorsRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "publicVendorCatalog", c.env?.CACHE);
    return ok(c, await listPublicVendors(db, c.req.valid("query")));
});

const getVendorRoute = createRoute({
    method: "get",
    path: "/{slug}",
    tags: ["Vendors"],
    summary: "Get one public seller and its approved product catalog",
    request: {
        params: z.object({ slug: z.string().min(1).max(100) }),
        query: vendorCatalogQuerySchema,
    },
    responses: {
        200: {
            description: "Public seller catalog",
            content: {
                "application/json": {
                    schema: successEnvelope(z.object({
                        vendor: publicVendorSchema,
                        profile: publicVendorProfileSchema.nullable(),
                        products: z.array(publicVendorProductSchema),
                        pagination: paginationSchema,
                    })),
                },
            },
        },
        404: errorResponses[404],
        500: errorResponses[500],
    },
});

app.openapi(getVendorRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "publicVendorCatalog", c.env?.CACHE);
    const { slug } = c.req.valid("param");
    const result = await getPublicVendorCatalog(db, slug, c.req.valid("query"));
    if (!result) throw new NotFoundError("Seller not found");
    return ok(c, result);
});

export { app as vendorRoutes };
