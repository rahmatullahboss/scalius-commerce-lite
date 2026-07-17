import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { vendorPayoutMethods, vendors } from "@scalius/database/schema";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { assertMarketplaceFeatureEnabled } from "@scalius/core/modules/settings";
import { moderateVendorPayoutMethod } from "@scalius/core/modules/vendors/vendor-payout-methods";
import { errorResponses, successEnvelope } from "../../schemas/responses";
import { ForbiddenError } from "../../utils/api-error";
import { ok } from "../../utils/api-response";

const app = new OpenAPIHono<{ Bindings: Env }>();
const timestampSchema = z.any();
const reviewStatusSchema = z.enum(["pending", "verified", "rejected", "disabled"]);

const payoutMethodReviewRowSchema = z.object({
    id: z.string(),
    vendorId: z.string(),
    vendorName: z.string(),
    method: z.enum(["bank", "bkash", "nagad", "rocket", "manual"]),
    displayName: z.string(),
    lastFour: z.string().nullable(),
    providerName: z.string().nullable(),
    isDefault: z.boolean(),
    status: reviewStatusSchema,
    verifiedBy: z.string().nullable(),
    verifiedAt: timestampSchema.nullable(),
    rejectionReason: z.string().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
});

const paginationSchema = z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
});

const listRoute = createRoute({
    method: "get",
    path: "/payout-methods",
    tags: ["Marketplace Finance"],
    summary: "List masked seller payout destinations for platform review",
    request: {
        query: z.object({
            vendorId: z.string().min(1).optional(),
            status: reviewStatusSchema.optional(),
            page: z.coerce.number().int().min(1).default(1),
            limit: z.coerce.number().int().min(1).max(100).default(20),
        }),
    },
    responses: {
        200: {
            description: "Masked payout destinations",
            content: {
                "application/json": {
                    schema: successEnvelope(z.object({
                        payoutMethods: z.array(payoutMethodReviewRowSchema),
                        pagination: paginationSchema,
                    })),
                },
            },
        },
        ...errorResponses,
    },
});

app.openapi(listRoute, async (c) => {
    const db = c.get("db");
    const { vendorId, status, page, limit } = c.req.valid("query");
    const where = and(
        isNull(vendorPayoutMethods.deletedAt),
        vendorId ? eq(vendorPayoutMethods.vendorId, vendorId) : undefined,
        status ? eq(vendorPayoutMethods.status, status) : undefined,
    );
    const offset = (page - 1) * limit;
    const [totalRow, rows] = await Promise.all([
        db.select({ value: count() }).from(vendorPayoutMethods).where(where).get(),
        db.select({
            id: vendorPayoutMethods.id,
            vendorId: vendorPayoutMethods.vendorId,
            vendorName: vendors.name,
            method: vendorPayoutMethods.method,
            displayName: vendorPayoutMethods.displayName,
            lastFour: vendorPayoutMethods.lastFour,
            providerName: vendorPayoutMethods.providerName,
            isDefault: vendorPayoutMethods.isDefault,
            status: vendorPayoutMethods.status,
            verifiedBy: vendorPayoutMethods.verifiedBy,
            verifiedAt: vendorPayoutMethods.verifiedAt,
            rejectionReason: vendorPayoutMethods.rejectionReason,
            createdAt: vendorPayoutMethods.createdAt,
            updatedAt: vendorPayoutMethods.updatedAt,
        })
            .from(vendorPayoutMethods)
            .innerJoin(vendors, eq(vendors.id, vendorPayoutMethods.vendorId))
            .where(where)
            .orderBy(desc(vendorPayoutMethods.createdAt))
            .limit(limit)
            .offset(offset),
    ]);
    const total = totalRow?.value ?? 0;
    return ok(c, {
        payoutMethods: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
});

const moderateRoute = createRoute({
    method: "patch",
    path: "/payout-methods/{methodId}/status",
    tags: ["Marketplace Finance"],
    summary: "Verify or reject a pending seller payout destination",
    request: {
        params: z.object({ methodId: z.string().min(1) }),
        body: {
            required: true,
            content: {
                "application/json": {
                    schema: z.object({
                        status: z.enum(["verified", "rejected"]),
                        reason: z.string().trim().max(1000).nullable().optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: "Payout destination review status updated",
            content: {
                "application/json": {
                    schema: successEnvelope(z.object({
                        id: z.string(),
                        status: z.enum(["verified", "rejected"]),
                    })),
                },
            },
        },
        ...errorResponses,
    },
});

app.openapi(moderateRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "payoutWrite", c.env?.CACHE);
    const user = c.get("user") as { id?: string } | undefined;
    if (!user?.id) throw new ForbiddenError("Authenticated platform actor is required");
    const { methodId } = c.req.valid("param");
    return ok(c, await moderateVendorPayoutMethod(db, {
        methodId,
        actorUserId: user.id,
        ...c.req.valid("json"),
    }));
});

export const adminMarketplacePayoutMethodRoutes = app;
