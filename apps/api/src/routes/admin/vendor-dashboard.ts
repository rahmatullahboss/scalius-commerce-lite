// Seller-scoped operational dashboard APIs.
// Financial reporting is intentionally unavailable until the canonical marketplace ledger exists.

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import {
    categories,
    deliveryProviders,
    orderItems,
    orders,
    products,
    vendorBalanceProjections,
    vendorOrders,
    vendorPayoutMethods,
    vendorShipmentItems,
    vendorShipments,
} from "@scalius/database/schema";
import {
    hasVendorCapability,
    listUserVendorMemberships,
    resolveUserVendorContext,
    type VendorCapability,
} from "@scalius/core/auth";
import {
    createVendorShipment,
    updateVendorShipmentStatus,
} from "@scalius/core/modules/marketplace/shipment";
import { createVendorProviderShipment } from "@scalius/core/modules/marketplace/provider-shipment";
import { checkVendorProviderShipmentStatus } from "@scalius/core/modules/marketplace/provider-shipment-check";
import { updateSellerVendorOrderStatus } from "@scalius/core/modules/marketplace/vendor-order-actions";
import * as ProductsAdmin from "@scalius/core/modules/products/products.admin";
import {
    createVendorProduct,
    listVendorProductVariants,
    submitVendorProduct,
    updateVendorProduct,
    updateVendorProductVariant,
} from "@scalius/core/modules/products/products.vendor";
import {
    createProductSchema,
    updateProductSchema,
} from "@scalius/core/modules/products/products.validation";
import { updateVariantSchema } from "@scalius/core/modules/products/products.types";
import {
    assertMarketplaceFeatureEnabled,
    getMarketplaceFlags,
} from "@scalius/core/modules/settings";
import {
    createVendorPayoutMethod,
    disableVendorPayoutMethod,
    listVendorPayoutMethods,
    setDefaultVendorPayoutMethod,
} from "@scalius/core/modules/vendors/vendor-payout-methods";
import { applyForVendor } from "@scalius/core/modules/vendors/vendor-onboarding";
import { getVendorProfile, upsertVendorProfile } from "@scalius/core/modules/vendors/vendor-profile";
import {
    acceptVendorMembershipInvite,
    createVendorMembershipInvite,
    listVendorTeam,
    revokeVendorMembershipInvite,
    updateVendorMember,
} from "@scalius/core/modules/vendors/vendor-membership-invites";
import { ForbiddenError, NotFoundError } from "../../utils/api-error";
import { created, ok } from "../../utils/api-response";
import { productDetailSchema } from "../../schemas/entities";
import { errorResponses, successEnvelope } from "../../schemas/responses";
import {
    invalidateCatalogCaches,
    invalidateProductAvailabilityCaches,
} from "../../utils/cache-invalidation";
import { requireEncryptionKey } from "../../utils/encryption-key";
import { enqueueOrderStatusChangeNotification } from "../../utils/order-notification-queue";

const app = new OpenAPIHono<{ Bindings: Env }>();
const timestampSchema = z.any();
const vendorContextQuerySchema = z.object({ vendorId: z.string().optional() });
const paginationQuerySchema = vendorContextQuerySchema.extend({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

const vendorContextSchema = z.object({
    membershipId: z.string(),
    vendorId: z.string(),
    userId: z.string(),
    role: z.enum(["owner", "admin", "catalog", "fulfillment", "finance", "viewer"]),
    membershipStatus: z.enum(["invited", "active", "suspended", "revoked"]),
    vendorStatus: z.enum(["pending", "approved", "rejected", "suspended", "closed"]),
    vendorName: z.string(),
    vendorSlug: z.string(),
});

const contextPayloadSchema = z.object({
    currentVendor: vendorContextSchema.nullable(),
    memberships: z.array(vendorContextSchema),
});

const vendorTeamRoleSchema = z.enum(["admin", "catalog", "fulfillment", "finance", "viewer"]);
const vendorTeamMemberStatusSchema = z.enum(["active", "suspended", "revoked"]);
const vendorTeamMemberSchema = z.object({
    membershipId: z.string(),
    userId: z.string(),
    name: z.string(),
    email: z.string().email(),
    role: z.enum(["owner", "admin", "catalog", "fulfillment", "finance", "viewer"]),
    status: z.enum(["invited", "active", "suspended", "revoked"]),
    acceptedAt: timestampSchema.nullable(),
    updatedAt: timestampSchema,
});
const vendorTeamInviteSchema = z.object({
    inviteId: z.string(),
    inviteeEmail: z.string().email(),
    role: vendorTeamRoleSchema,
    status: z.enum(["pending", "accepted", "revoked", "expired"]),
    invitedBy: z.string(),
    expiresAt: timestampSchema,
    acceptedByUserId: z.string().nullable(),
    acceptedAt: timestampSchema.nullable(),
    revokedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
});
const vendorTeamPayloadSchema = z.object({
    members: z.array(vendorTeamMemberSchema),
    invites: z.array(vendorTeamInviteSchema),
});

const vendorProfileInputSchema = z.object({
    description: z.string().trim().max(5000).nullable(),
    logoMediaId: z.string().trim().max(160).nullable(),
    bannerMediaId: z.string().trim().max(160).nullable(),
    showContactEmail: z.boolean(),
    showContactPhone: z.boolean(),
    seoTitle: z.string().trim().max(160).nullable(),
    seoDescription: z.string().trim().max(320).nullable(),
    returnPolicy: z.string().trim().max(5000).nullable(),
    supportHours: z.string().trim().max(500).nullable(),
    publicationStatus: z.enum(["draft", "published"]),
});
const vendorProfilePayloadSchema = vendorProfileInputSchema.extend({
    vendorId: z.string(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    createdAt: timestampSchema.nullable(),
    updatedAt: timestampSchema.nullable(),
});

const summaryPayloadSchema = z.object({
    vendor: vendorContextSchema,
    products: z.object({
        total: z.number(),
        active: z.number(),
        pendingApproval: z.number(),
    }),
    fulfillment: z.object({
        total: z.number(),
        pending: z.number(),
        processing: z.number(),
        ready: z.number(),
        shipped: z.number(),
        delivered: z.number(),
    }),
    payoutMethods: z.object({
        total: z.number(),
        verified: z.number(),
    }),
    financialReporting: z.discriminatedUnion("available", [
        z.object({
            available: z.literal(false),
            reason: z.string(),
        }),
        z.object({
            available: z.literal(true),
            balances: z.array(z.object({
                currency: z.string(),
                pendingMinor: z.number().int().nonnegative(),
                availableMinor: z.number().int().nonnegative(),
                reservedMinor: z.number().int().nonnegative(),
                paidMinor: z.number().int().nonnegative(),
                debtMinor: z.number().int().nonnegative(),
                lastJournalId: z.string().nullable(),
                version: z.number().int().positive(),
                updatedAt: timestampSchema,
            })),
        }),
    ]),
});

const maskedVendorPayoutMethodSchema = z.object({
    id: z.string(),
    vendorId: z.string(),
    method: z.enum(["bank", "bkash", "nagad", "rocket", "manual"]),
    displayName: z.string(),
    lastFour: z.string().nullable(),
    providerName: z.string().nullable(),
    isDefault: z.boolean(),
    status: z.enum(["pending", "verified", "rejected", "disabled"]),
    verifiedBy: z.string().nullable(),
    verifiedAt: timestampSchema.nullable(),
    rejectionReason: z.string().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
});

const vendorOrderRowSchema = z.object({
    id: z.string(),
    orderId: z.string(),
    status: z.enum(["pending", "processing", "ready", "shipped", "delivered", "cancelled"]),
    fulfillmentStatus: z.enum(["pending", "partial", "complete", "cancelled"]),
    version: z.number().int(),
    customerName: z.string().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
});

const ordersPayloadSchema = z.object({
    orders: z.array(vendorOrderRowSchema),
    pagination: z.object({
        page: z.number(),
        limit: z.number(),
        total: z.number(),
        totalPages: z.number(),
    }),
});

const vendorProductRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    price: z.number(),
    approvalStatus: z.enum(["draft", "submitted", "approved", "rejected", "suspended"]),
    isActive: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
});

const productsPayloadSchema = z.object({
    products: z.array(vendorProductRowSchema),
    pagination: z.object({
        page: z.number(),
        limit: z.number(),
        total: z.number(),
        totalPages: z.number(),
    }),
});

const vendorProductDetailSchema = productDetailSchema.extend({
    approvalStatus: z.enum(["draft", "submitted", "approved", "rejected", "suspended"]),
    moderationVersion: z.number().int().positive(),
});

const vendorProductMutationResultSchema = z.object({
    approvalStatus: z.enum(["draft", "submitted"]),
    moderationVersion: z.number().int().positive().optional(),
    productId: z.string().optional(),
});

const vendorProductVariantSchema = z.object({
    id: z.string(),
    productId: z.string(),
    isDefault: z.boolean(),
    size: z.string().nullable(),
    color: z.string().nullable(),
    weight: z.number().nullable(),
    sku: z.string(),
    price: z.number(),
    stock: z.number().int().nonnegative(),
    reservedStock: z.number().int().nonnegative(),
    stockVersion: z.number().int().positive(),
    version: z.number().int().positive(),
    trackInventory: z.boolean(),
    barcode: z.string().nullable(),
    barcodeType: z.string().nullable(),
    discountType: z.string().nullable(),
    discountPercentage: z.number().nullable(),
    discountAmount: z.number().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
});

const vendorShipmentStatusSchema = z.enum([
    "pending",
    "processing",
    "pickup_assigned",
    "picked_up",
    "pickup_failed",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "partial_delivered",
    "delivery_failed",
    "on_hold",
    "failed",
    "returned",
    "cancelled",
]);

const vendorShipmentRowSchema = z.object({
    id: z.string(),
    vendorOrderId: z.string(),
    orderId: z.string(),
    providerType: z.string(),
    trackingId: z.string().nullable(),
    trackingUrl: z.string().nullable(),
    courierName: z.string().nullable(),
    status: vendorShipmentStatusSchema,
    shipmentAmountMinor: z.number().int().nonnegative(),
    isFinalShipment: z.boolean(),
    version: z.number().int().positive(),
    pickedUpAt: timestampSchema.nullable(),
    deliveredAt: timestampSchema.nullable(),
    cancelledAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
});

const vendorShipmentItemSchema = z.object({
    id: z.string(),
    orderItemId: z.string(),
    productName: z.string().nullable(),
    variantLabel: z.string().nullable(),
    quantity: z.number().int().positive(),
});

const shipmentListQuerySchema = paginationQuerySchema.extend({
    vendorOrderId: z.string().min(1).optional(),
    status: vendorShipmentStatusSchema.optional(),
});

interface CurrentUser { id: string }

function getCurrentUserId(c: { get: (key: string) => unknown }): string {
    const user = c.get("user") as CurrentUser | undefined;
    if (!user?.id) throw new ForbiddenError("Vendor dashboard requires an authenticated user");
    return user.id;
}

async function requireVendorContext(
    c: { get: (key: string) => unknown },
    requestedVendorId: string | undefined,
    capability: VendorCapability,
) {
    const db = c.get("db") as Parameters<typeof resolveUserVendorContext>[0];
    const userId = getCurrentUserId(c);
    const vendorContext = await resolveUserVendorContext(db, userId, requestedVendorId);
    if (!vendorContext) throw new NotFoundError("Vendor access not found");
    if (!hasVendorCapability(vendorContext, capability)) {
        throw new ForbiddenError("Your seller role does not allow this action");
    }
    return { db, vendorContext };
}

function totalPages(total: number, limit: number): number {
    return Math.ceil(total / limit);
}

async function invalidateSellerProductCaches(
    c: { env?: Env; executionCtx?: ExecutionContext },
    vendorSlug: string,
    slug: string,
): Promise<void> {
    await invalidateCatalogCaches("products", c, {
        htmlPaths: [`/products/${slug}`, `/vendors/${vendorSlug}`],
    });
}

const contextRoute = createRoute({
    method: "get",
    path: "/context",
    tags: ["Vendor Dashboard"],
    summary: "Get current user's seller memberships",
    request: { query: vendorContextQuerySchema },
    responses: {
        200: {
            description: "Seller context",
            content: { "application/json": { schema: successEnvelope(contextPayloadSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(contextRoute, async (c) => {
    const db = c.get("db");
    const userId = getCurrentUserId(c);
    const { vendorId } = c.req.valid("query");
    const memberships = await listUserVendorMemberships(db, userId, {
        includeUnapprovedVendors: true,
    });
    const currentVendor = vendorId
        ? memberships.find((membership) => membership.vendorId === vendorId) ?? null
        : memberships[0] ?? null;
    return ok(c, { currentVendor, memberships });
});

const applicationRoute = createRoute({
    method: "post",
    path: "/application",
    tags: ["Vendor Dashboard"],
    summary: "Submit or correct and resubmit an authenticated seller application",
    request: {
        body: {
            required: true,
            content: {
                "application/json": {
                    schema: z.object({
                        name: z.string().trim().min(1).max(160),
                        slug: z.string().trim().min(3).max(120),
                        legalName: z.string().trim().max(200).nullable().optional(),
                        contactEmail: z.string().email().max(320).nullable().optional(),
                        contactPhone: z.string().trim().max(50).nullable().optional(),
                        businessAddress: z.string().trim().min(1).max(500),
                        district: z.string().trim().min(1).max(120),
                        upazila: z.string().trim().max(120).nullable().optional(),
                        pickupAddress: z.string().trim().max(500).nullable().optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: "Seller application accepted or replayed",
            content: {
                "application/json": {
                    schema: successEnvelope(z.object({
                        vendorId: z.string(),
                        status: z.enum(["pending", "rejected"]),
                        replayed: z.boolean(),
                    })),
                },
            },
        },
        ...errorResponses,
    },
});

app.openapi(applicationRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite", c.env?.CACHE);
    return ok(c, await applyForVendor(db, {
        ...c.req.valid("json"),
        applicantUserId: getCurrentUserId(c),
    }));
});

const teamRoute = createRoute({
    method: "get",
    path: "/team",
    tags: ["Vendor Dashboard"],
    summary: "List seller members and invitation history",
    request: { query: vendorContextQuerySchema },
    responses: {
        200: {
            description: "Seller team",
            content: { "application/json": { schema: successEnvelope(vendorTeamPayloadSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(teamRoute, async (c) => {
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "members.manage");
    return ok(c, await listVendorTeam(db, vendorContext));
});

const createTeamInviteRoute = createRoute({
    method: "post",
    path: "/team/invites",
    tags: ["Vendor Dashboard"],
    summary: "Create a secure seller team invitation",
    request: {
        body: {
            required: true,
            content: {
                "application/json": {
                    schema: z.object({
                        vendorId: z.string(),
                        inviteeEmail: z.string().email().max(320),
                        role: vendorTeamRoleSchema,
                        expiresInHours: z.number().int().min(1).max(720).optional(),
                    }),
                },
            },
        },
    },
    responses: {
        201: {
            description: "Seller invitation created; credential is returned once",
            content: {
                "application/json": {
                    schema: successEnvelope(z.object({
                        inviteId: z.string(),
                        vendorId: z.string(),
                        inviteeEmail: z.string().email(),
                        role: vendorTeamRoleSchema,
                        expiresAt: timestampSchema,
                        token: z.string(),
                    })),
                },
            },
        },
        ...errorResponses,
    },
});

app.openapi(createTeamInviteRoute, async (c) => {
    const input = c.req.valid("json");
    const { db, vendorContext } = await requireVendorContext(c, input.vendorId, "members.manage");
    await assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite", c.env?.CACHE);
    return created(c, await createVendorMembershipInvite(db, vendorContext, input));
});

const acceptTeamInviteRoute = createRoute({
    method: "post",
    path: "/team/invites/accept",
    tags: ["Vendor Dashboard"],
    summary: "Accept a seller team invitation for the authenticated matching account",
    request: {
        body: {
            required: true,
            content: {
                "application/json": {
                    schema: z.object({ token: z.string().trim().min(1).max(1024) }),
                },
            },
        },
    },
    responses: {
        200: {
            description: "Seller invitation accepted",
            content: {
                "application/json": {
                    schema: successEnvelope(z.object({
                        inviteId: z.string(),
                        vendorId: z.string(),
                        membershipId: z.string(),
                        role: vendorTeamRoleSchema,
                    })),
                },
            },
        },
        ...errorResponses,
    },
});

app.openapi(acceptTeamInviteRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite", c.env?.CACHE);
    return ok(c, await acceptVendorMembershipInvite(db, {
        token: c.req.valid("json").token,
        userId: getCurrentUserId(c),
    }));
});

const revokeTeamInviteRoute = createRoute({
    method: "post",
    path: "/team/invites/{inviteId}/revoke",
    tags: ["Vendor Dashboard"],
    summary: "Revoke a pending seller team invitation",
    request: {
        params: z.object({ inviteId: z.string() }),
        body: {
            required: true,
            content: { "application/json": { schema: z.object({ vendorId: z.string() }) } },
        },
    },
    responses: {
        200: {
            description: "Seller invitation revoked",
            content: {
                "application/json": {
                    schema: successEnvelope(z.object({
                        inviteId: z.string(),
                        status: z.literal("revoked"),
                    })),
                },
            },
        },
        ...errorResponses,
    },
});

app.openapi(revokeTeamInviteRoute, async (c) => {
    const { vendorId } = c.req.valid("json");
    const { inviteId } = c.req.valid("param");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "members.manage");
    await assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite", c.env?.CACHE);
    return ok(c, await revokeVendorMembershipInvite(db, vendorContext, inviteId));
});

const updateTeamMemberRoute = createRoute({
    method: "patch",
    path: "/team/members/{membershipId}",
    tags: ["Vendor Dashboard"],
    summary: "Update a non-owner seller team member",
    request: {
        params: z.object({ membershipId: z.string() }),
        body: {
            required: true,
            content: {
                "application/json": {
                    schema: z.object({
                        vendorId: z.string(),
                        role: vendorTeamRoleSchema.optional(),
                        status: vendorTeamMemberStatusSchema.optional(),
                    }).refine((value) => value.role !== undefined || value.status !== undefined, {
                        message: "Role or status is required",
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: "Seller team member updated",
            content: {
                "application/json": {
                    schema: successEnvelope(z.object({
                        membershipId: z.string(),
                        role: vendorTeamRoleSchema,
                        status: vendorTeamMemberStatusSchema,
                    })),
                },
            },
        },
        ...errorResponses,
    },
});

app.openapi(updateTeamMemberRoute, async (c) => {
    const input = c.req.valid("json");
    const { membershipId } = c.req.valid("param");
    const { db, vendorContext } = await requireVendorContext(c, input.vendorId, "members.manage");
    await assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite", c.env?.CACHE);
    return ok(c, await updateVendorMember(db, vendorContext, {
        membershipId,
        role: input.role,
        status: input.status,
    }));
});

const profileRoute = createRoute({
    method: "get",
    path: "/profile",
    tags: ["Vendor Dashboard"],
    summary: "Get the seller-managed public store profile",
    request: { query: vendorContextQuerySchema },
    responses: {
        200: {
            description: "Seller store profile",
            content: { "application/json": { schema: successEnvelope(vendorProfilePayloadSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(profileRoute, async (c) => {
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "profile.manage");
    return ok(c, await getVendorProfile(db, vendorContext));
});

const updateProfileRoute = createRoute({
    method: "put",
    path: "/profile",
    tags: ["Vendor Dashboard"],
    summary: "Create or update the seller-managed public store profile",
    request: {
        body: {
            required: true,
            content: {
                "application/json": {
                    schema: vendorProfileInputSchema.extend({ vendorId: z.string() }),
                },
            },
        },
    },
    responses: {
        200: {
            description: "Seller store profile updated",
            content: { "application/json": { schema: successEnvelope(vendorProfilePayloadSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(updateProfileRoute, async (c) => {
    const input = c.req.valid("json");
    const { db, vendorContext } = await requireVendorContext(c, input.vendorId, "profile.manage");
    await assertMarketplaceFeatureEnabled(db, "vendorCatalogWrite", c.env?.CACHE);
    const profile = await upsertVendorProfile(db, vendorContext, input);
    await invalidateCatalogCaches("products", c, {
        htmlPaths: [`/vendors/${vendorContext.vendorSlug}`],
    });
    return ok(c, profile);
});

const summaryRoute = createRoute({
    method: "get",
    path: "/summary",
    tags: ["Vendor Dashboard"],
    summary: "Get seller operational dashboard summary",
    request: { query: vendorContextQuerySchema },
    responses: {
        200: {
            description: "Seller operational summary",
            content: { "application/json": { schema: successEnvelope(summaryPayloadSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(summaryRoute, async (c) => {
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "dashboard.read");

    const [
        productTotal,
        activeProducts,
        submittedProducts,
        orderTotal,
        pendingOrders,
        processingOrders,
        readyOrders,
        shippedOrders,
        deliveredOrders,
        payoutMethodTotal,
        verifiedPayoutMethods,
    ] = await Promise.all([
        db.select({ value: count() }).from(products).where(eq(products.vendorId, vendorContext.vendorId)).get(),
        db.select({ value: count() }).from(products).where(and(eq(products.vendorId, vendorContext.vendorId), eq(products.isActive, true))).get(),
        db.select({ value: count() }).from(products).where(and(eq(products.vendorId, vendorContext.vendorId), eq(products.approvalStatus, "submitted"))).get(),
        db.select({ value: count() }).from(vendorOrders).where(eq(vendorOrders.vendorId, vendorContext.vendorId)).get(),
        db.select({ value: count() }).from(vendorOrders).where(and(eq(vendorOrders.vendorId, vendorContext.vendorId), eq(vendorOrders.status, "pending"))).get(),
        db.select({ value: count() }).from(vendorOrders).where(and(eq(vendorOrders.vendorId, vendorContext.vendorId), eq(vendorOrders.status, "processing"))).get(),
        db.select({ value: count() }).from(vendorOrders).where(and(eq(vendorOrders.vendorId, vendorContext.vendorId), eq(vendorOrders.status, "ready"))).get(),
        db.select({ value: count() }).from(vendorOrders).where(and(eq(vendorOrders.vendorId, vendorContext.vendorId), eq(vendorOrders.status, "shipped"))).get(),
        db.select({ value: count() }).from(vendorOrders).where(and(eq(vendorOrders.vendorId, vendorContext.vendorId), eq(vendorOrders.status, "delivered"))).get(),
        db.select({ value: count() }).from(vendorPayoutMethods).where(eq(vendorPayoutMethods.vendorId, vendorContext.vendorId)).get(),
        db.select({ value: count() }).from(vendorPayoutMethods).where(and(
            eq(vendorPayoutMethods.vendorId, vendorContext.vendorId),
            eq(vendorPayoutMethods.status, "verified"),
        )).get(),
    ]);

    const marketplaceFlags = await getMarketplaceFlags(db, c.env?.CACHE);
    const canReadFinance = hasVendorCapability(vendorContext, "finance.read");
    const financialReporting = !marketplaceFlags.ledgerPosting
        ? {
            available: false as const,
            reason: "Financial reporting is disabled until ledger posting is explicitly enabled and reconciled.",
        }
        : !canReadFinance
            ? {
                available: false as const,
                reason: "Your seller role does not include financial reporting access.",
            }
            : {
                available: true as const,
                balances: await db
                    .select({
                        currency: vendorBalanceProjections.currency,
                        pendingMinor: vendorBalanceProjections.pendingMinor,
                        availableMinor: vendorBalanceProjections.availableMinor,
                        reservedMinor: vendorBalanceProjections.reservedMinor,
                        paidMinor: vendorBalanceProjections.paidMinor,
                        debtMinor: vendorBalanceProjections.debtMinor,
                        lastJournalId: vendorBalanceProjections.lastJournalId,
                        version: vendorBalanceProjections.version,
                        updatedAt: vendorBalanceProjections.updatedAt,
                    })
                    .from(vendorBalanceProjections)
                    .where(eq(vendorBalanceProjections.vendorId, vendorContext.vendorId))
                    .orderBy(vendorBalanceProjections.currency)
                    .all(),
            };

    return ok(c, {
        vendor: vendorContext,
        products: {
            total: productTotal?.value ?? 0,
            active: activeProducts?.value ?? 0,
            pendingApproval: submittedProducts?.value ?? 0,
        },
        fulfillment: {
            total: orderTotal?.value ?? 0,
            pending: pendingOrders?.value ?? 0,
            processing: processingOrders?.value ?? 0,
            ready: readyOrders?.value ?? 0,
            shipped: shippedOrders?.value ?? 0,
            delivered: deliveredOrders?.value ?? 0,
        },
        payoutMethods: {
            total: payoutMethodTotal?.value ?? 0,
            verified: verifiedPayoutMethods?.value ?? 0,
        },
        financialReporting,
    });
});

const payoutMethodsRoute = createRoute({
    method: "get",
    path: "/payout-methods",
    tags: ["Vendor Dashboard"],
    summary: "List masked seller payout destinations",
    request: { query: vendorContextQuerySchema },
    responses: {
        200: {
            description: "Masked seller payout destinations",
            content: { "application/json": { schema: successEnvelope(z.object({
                payoutMethods: z.array(maskedVendorPayoutMethodSchema),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(payoutMethodsRoute, async (c) => {
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "finance.read");
    return ok(c, {
        payoutMethods: await listVendorPayoutMethods(db, vendorContext.vendorId),
    });
});

const createPayoutMethodRoute = createRoute({
    method: "post",
    path: "/payout-methods",
    tags: ["Vendor Dashboard"],
    summary: "Register an encrypted seller payout destination",
    request: {
        query: vendorContextQuerySchema,
        body: {
            required: true,
            content: { "application/json": { schema: z.object({
                method: z.enum(["bank", "bkash", "nagad", "rocket", "manual"]),
                displayName: z.string().trim().min(1).max(160),
                providerName: z.string().trim().max(160).nullable().optional(),
                isDefault: z.boolean().optional(),
                destination: z.record(z.string(), z.unknown()),
            }) } },
        },
    },
    responses: {
        201: {
            description: "Encrypted payout destination registered for review",
            content: { "application/json": { schema: successEnvelope(maskedVendorPayoutMethodSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(createPayoutMethodRoute, async (c) => {
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "payout.manage");
    await assertMarketplaceFeatureEnabled(db, "payoutWrite", c.env?.CACHE);
    return created(c, await createVendorPayoutMethod(db, {
        ...c.req.valid("json"),
        vendorId: vendorContext.vendorId,
        encryptionKey: requireEncryptionKey(c.env),
    }));
});

const setDefaultPayoutMethodRoute = createRoute({
    method: "post",
    path: "/payout-methods/{methodId}/default",
    tags: ["Vendor Dashboard"],
    summary: "Set a pending or verified seller payout destination as default",
    request: {
        params: z.object({ methodId: z.string().min(1) }),
        query: vendorContextQuerySchema,
    },
    responses: {
        200: {
            description: "Default payout destination updated",
            content: { "application/json": { schema: successEnvelope(z.object({
                id: z.string(),
                isDefault: z.literal(true),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(setDefaultPayoutMethodRoute, async (c) => {
    const { methodId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "payout.manage");
    await assertMarketplaceFeatureEnabled(db, "payoutWrite", c.env?.CACHE);
    return ok(c, await setDefaultVendorPayoutMethod(db, vendorContext.vendorId, methodId));
});

const disablePayoutMethodRoute = createRoute({
    method: "post",
    path: "/payout-methods/{methodId}/disable",
    tags: ["Vendor Dashboard"],
    summary: "Disable a seller payout destination without deleting history",
    request: {
        params: z.object({ methodId: z.string().min(1) }),
        query: vendorContextQuerySchema,
    },
    responses: {
        200: {
            description: "Payout destination disabled",
            content: { "application/json": { schema: successEnvelope(z.object({
                id: z.string(),
                status: z.literal("disabled"),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(disablePayoutMethodRoute, async (c) => {
    const { methodId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "payout.manage");
    await assertMarketplaceFeatureEnabled(db, "payoutWrite", c.env?.CACHE);
    return ok(c, await disableVendorPayoutMethod(db, vendorContext.vendorId, methodId));
});

const ordersRoute = createRoute({
    method: "get",
    path: "/orders",
    tags: ["Vendor Dashboard"],
    summary: "List seller fulfillment groups",
    request: { query: paginationQuerySchema },
    responses: {
        200: {
            description: "Seller fulfillment groups",
            content: { "application/json": { schema: successEnvelope(ordersPayloadSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(ordersRoute, async (c) => {
    const { vendorId, page, limit } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "orders.read");
    const offset = (page - 1) * limit;
    const [totalRow, rows] = await Promise.all([
        db.select({ value: count() }).from(vendorOrders).where(eq(vendorOrders.vendorId, vendorContext.vendorId)).get(),
        db.select({
            id: vendorOrders.id,
            orderId: vendorOrders.orderId,
            status: vendorOrders.status,
            fulfillmentStatus: vendorOrders.fulfillmentStatus,
            version: vendorOrders.version,
            customerName: orders.customerName,
            createdAt: vendorOrders.createdAt,
            updatedAt: vendorOrders.updatedAt,
        })
            .from(vendorOrders)
            .leftJoin(orders, eq(vendorOrders.orderId, orders.id))
            .where(eq(vendorOrders.vendorId, vendorContext.vendorId))
            .orderBy(desc(vendorOrders.createdAt))
            .limit(limit)
            .offset(offset),
    ]);
    const total = totalRow?.value ?? 0;
    return ok(c, { orders: rows, pagination: { page, limit, total, totalPages: totalPages(total, limit) } });
});

const vendorOrderDetailRoute = createRoute({
    method: "get",
    path: "/orders/{vendorOrderId}",
    tags: ["Vendor Dashboard"],
    summary: "Read one seller fulfillment group and its seller-owned lines",
    request: {
        params: z.object({ vendorOrderId: z.string().min(1) }),
        query: vendorContextQuerySchema,
    },
    responses: {
        200: {
            description: "Seller fulfillment group detail",
            content: { "application/json": { schema: successEnvelope(z.object({
                order: vendorOrderRowSchema,
                items: z.array(z.object({
                    id: z.string(),
                    productName: z.string().nullable(),
                    variantLabel: z.string().nullable(),
                    quantity: z.number().int().positive(),
                    fulfillmentStatus: z.string(),
                })),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(vendorOrderDetailRoute, async (c) => {
    const { vendorOrderId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "orders.read");
    const order = await db.select({
        id: vendorOrders.id,
        orderId: vendorOrders.orderId,
        status: vendorOrders.status,
        fulfillmentStatus: vendorOrders.fulfillmentStatus,
        version: vendorOrders.version,
        customerName: orders.customerName,
        createdAt: vendorOrders.createdAt,
        updatedAt: vendorOrders.updatedAt,
    })
        .from(vendorOrders)
        .leftJoin(orders, eq(vendorOrders.orderId, orders.id))
        .where(and(
            eq(vendorOrders.id, vendorOrderId),
            eq(vendorOrders.vendorId, vendorContext.vendorId),
        ))
        .get();
    if (!order) throw new NotFoundError("Seller fulfillment group not found");
    const items = await db.select({
        id: orderItems.id,
        productName: orderItems.productName,
        variantLabel: orderItems.variantLabel,
        quantity: orderItems.quantity,
        fulfillmentStatus: orderItems.fulfillmentStatus,
    })
        .from(orderItems)
        .where(and(
            eq(orderItems.vendorOrderId, vendorOrderId),
            eq(orderItems.vendorIdSnapshot, vendorContext.vendorId),
        ))
        .orderBy(asc(orderItems.createdAt))
        .all();
    return ok(c, { order, items });
});

const categoryOptionsRoute = createRoute({
    method: "get",
    path: "/categories",
    tags: ["Vendor Dashboard"],
    summary: "List seller-safe product category options",
    request: { query: vendorContextQuerySchema },
    responses: {
        200: {
            description: "Seller product category options",
            content: { "application/json": { schema: successEnvelope(z.object({
                categories: z.array(z.object({
                    id: z.string(),
                    name: z.string(),
                    slug: z.string(),
                })),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(categoryOptionsRoute, async (c) => {
    const { vendorId } = c.req.valid("query");
    const { db } = await requireVendorContext(c, vendorId, "catalog.read");
    const rows = await db.select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
    })
        .from(categories)
        .where(isNull(categories.deletedAt))
        .orderBy(asc(categories.name))
        .all();
    return ok(c, { categories: rows });
});

const productsRoute = createRoute({
    method: "get",
    path: "/products",
    tags: ["Vendor Dashboard"],
    summary: "List seller products",
    request: { query: paginationQuerySchema },
    responses: {
        200: {
            description: "Seller products",
            content: { "application/json": { schema: successEnvelope(productsPayloadSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(productsRoute, async (c) => {
    const { vendorId, page, limit } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "catalog.read");
    const offset = (page - 1) * limit;
    const [totalRow, rows] = await Promise.all([
        db.select({ value: count() }).from(products).where(eq(products.vendorId, vendorContext.vendorId)).get(),
        db.select({
            id: products.id,
            name: products.name,
            slug: products.slug,
            price: products.price,
            approvalStatus: products.approvalStatus,
            isActive: products.isActive,
            createdAt: products.createdAt,
            updatedAt: products.updatedAt,
        })
            .from(products)
            .where(eq(products.vendorId, vendorContext.vendorId))
            .orderBy(desc(products.updatedAt))
            .limit(limit)
            .offset(offset),
    ]);
    const total = totalRow?.value ?? 0;
    return ok(c, { products: rows, pagination: { page, limit, total, totalPages: totalPages(total, limit) } });
});

const vendorProductDetailRoute = createRoute({
    method: "get",
    path: "/products/{productId}",
    tags: ["Vendor Dashboard"],
    summary: "Read one seller-owned product",
    request: {
        params: z.object({ productId: z.string().min(1) }),
        query: vendorContextQuerySchema,
    },
    responses: {
        200: {
            description: "Seller product detail",
            content: { "application/json": { schema: successEnvelope(vendorProductDetailSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(vendorProductDetailRoute, async (c) => {
    const { productId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "catalog.read");
    const ownership = await db.select({
        approvalStatus: products.approvalStatus,
        moderationVersion: products.moderationVersion,
    })
        .from(products)
        .where(and(
            eq(products.id, productId),
            eq(products.vendorId, vendorContext.vendorId),
        ))
        .get();
    if (!ownership) throw new NotFoundError("Seller product not found");
    const detail = await ProductsAdmin.getProductDetails(db, productId);
    if (!detail) throw new NotFoundError("Seller product not found");
    return ok(c, {
        ...detail,
        approvalStatus: ownership.approvalStatus,
        moderationVersion: ownership.moderationVersion,
    });
});

const createVendorProductRoute = createRoute({
    method: "post",
    path: "/products",
    tags: ["Vendor Dashboard"],
    summary: "Create a seller-owned product draft",
    request: {
        query: vendorContextQuerySchema,
        body: { required: true, content: { "application/json": { schema: createProductSchema } } },
    },
    responses: {
        201: {
            description: "Seller product draft created",
            content: { "application/json": { schema: successEnvelope(vendorProductMutationResultSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(createVendorProductRoute, async (c) => {
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "catalog.write");
    await assertMarketplaceFeatureEnabled(db, "vendorCatalogWrite", c.env?.CACHE);
    const data = c.req.valid("json");
    const result = await createVendorProduct(db, {
        vendorId: vendorContext.vendorId,
        actorUserId: getCurrentUserId(c),
        data,
    });
    await invalidateSellerProductCaches(c, vendorContext.vendorSlug, data.slug);
    return created(c, result);
});

const updateVendorProductRoute = createRoute({
    method: "put",
    path: "/products/{productId}",
    tags: ["Vendor Dashboard"],
    summary: "Update a seller-owned product draft or revision",
    request: {
        params: z.object({ productId: z.string().min(1) }),
        query: vendorContextQuerySchema,
        body: { required: true, content: { "application/json": { schema: updateProductSchema } } },
    },
    responses: {
        200: {
            description: "Seller product updated",
            content: { "application/json": { schema: successEnvelope(vendorProductMutationResultSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(updateVendorProductRoute, async (c) => {
    const { productId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "catalog.write");
    await assertMarketplaceFeatureEnabled(db, "vendorCatalogWrite", c.env?.CACHE);
    const data = c.req.valid("json");
    const result = await updateVendorProduct(db, {
        vendorId: vendorContext.vendorId,
        productId,
        actorUserId: getCurrentUserId(c),
        data: { ...data, id: productId },
    });
    await invalidateSellerProductCaches(c, vendorContext.vendorSlug, data.slug);
    return ok(c, result);
});

const submitVendorProductRoute = createRoute({
    method: "post",
    path: "/products/{productId}/submit",
    tags: ["Vendor Dashboard"],
    summary: "Submit a seller-owned product for moderation",
    request: {
        params: z.object({ productId: z.string().min(1) }),
        query: vendorContextQuerySchema,
    },
    responses: {
        200: {
            description: "Seller product submitted",
            content: { "application/json": { schema: successEnvelope(vendorProductMutationResultSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(submitVendorProductRoute, async (c) => {
    const { productId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "catalog.write");
    await assertMarketplaceFeatureEnabled(db, "vendorCatalogWrite", c.env?.CACHE);
    const product = await db.select({ slug: products.slug })
        .from(products)
        .where(and(
            eq(products.id, productId),
            eq(products.vendorId, vendorContext.vendorId),
        ))
        .get();
    if (!product) throw new NotFoundError("Seller product not found");
    const result = await submitVendorProduct(db, {
        vendorId: vendorContext.vendorId,
        productId,
        actorUserId: getCurrentUserId(c),
    });
    await invalidateSellerProductCaches(c, vendorContext.vendorSlug, product.slug);
    return ok(c, result);
});

const vendorProductVariantsRoute = createRoute({
    method: "get",
    path: "/products/{productId}/variants",
    tags: ["Vendor Dashboard"],
    summary: "List seller-owned product SKUs and inventory",
    request: {
        params: z.object({ productId: z.string().min(1) }),
        query: vendorContextQuerySchema,
    },
    responses: {
        200: {
            description: "Seller product variants",
            content: { "application/json": { schema: successEnvelope(z.object({
                variants: z.array(vendorProductVariantSchema),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(vendorProductVariantsRoute, async (c) => {
    const { productId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "catalog.read");
    return ok(c, {
        variants: await listVendorProductVariants(db, vendorContext.vendorId, productId),
    });
});

const updateVendorProductVariantRoute = createRoute({
    method: "put",
    path: "/products/{productId}/variants/{variantId}",
    tags: ["Vendor Dashboard"],
    summary: "Update a seller-owned SKU or inventory balance",
    request: {
        params: z.object({
            productId: z.string().min(1),
            variantId: z.string().min(1),
        }),
        query: vendorContextQuerySchema,
        body: { required: true, content: { "application/json": { schema: updateVariantSchema } } },
    },
    responses: {
        200: {
            description: "Seller product variant updated",
            content: { "application/json": { schema: successEnvelope(z.object({
                variantId: z.string(),
                stockVersion: z.number().int().positive(),
                version: z.number().int().positive(),
                approvalStatus: z.enum(["draft", "submitted", "approved", "rejected", "suspended"]),
                moderationVersion: z.number().int().positive(),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(updateVendorProductVariantRoute, async (c) => {
    const { productId, variantId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "catalog.write");
    await assertMarketplaceFeatureEnabled(db, "vendorCatalogWrite", c.env?.CACHE);
    const product = await db.select({ slug: products.slug })
        .from(products)
        .where(and(
            eq(products.id, productId),
            eq(products.vendorId, vendorContext.vendorId),
        ))
        .get();
    if (!product) throw new NotFoundError("Seller product not found");
    const result = await updateVendorProductVariant(db, {
        vendorId: vendorContext.vendorId,
        productId,
        variantId,
        actorUserId: getCurrentUserId(c),
        data: c.req.valid("json"),
    });
    await invalidateSellerProductCaches(c, vendorContext.vendorSlug, product.slug);
    return ok(c, result);
});

const updateVendorOrderStatusRoute = createRoute({
    method: "patch",
    path: "/orders/{vendorOrderId}/status",
    tags: ["Vendor Dashboard"],
    summary: "Move a seller fulfillment group between processing and ready",
    request: {
        params: z.object({ vendorOrderId: z.string().min(1) }),
        query: vendorContextQuerySchema,
        body: {
            required: true,
            content: { "application/json": { schema: z.object({
                expectedVersion: z.number().int().positive(),
                status: z.enum(["processing", "ready"]),
            }) } },
        },
    },
    responses: {
        200: {
            description: "Updated seller fulfillment group",
            content: { "application/json": { schema: successEnvelope(z.object({
                vendorOrderId: z.string(),
                status: z.enum(["processing", "ready"]),
                version: z.number().int().positive(),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(updateVendorOrderStatusRoute, async (c) => {
    const { vendorOrderId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "orders.write");
    await assertMarketplaceFeatureEnabled(db, "sellerOrderActions", c.env?.CACHE);
    const result = await updateSellerVendorOrderStatus(db, {
        vendorOrderId,
        vendorId: vendorContext.vendorId,
        ...c.req.valid("json"),
    });
    return ok(c, {
        ...result,
        status: result.status as "processing" | "ready",
    });
});

const createShipmentRoute = createRoute({
    method: "post",
    path: "/orders/{vendorOrderId}/shipments",
    tags: ["Vendor Dashboard"],
    summary: "Create a seller-scoped shipment",
    request: {
        params: z.object({ vendorOrderId: z.string().min(1) }),
        query: vendorContextQuerySchema,
        body: {
            required: true,
            content: { "application/json": { schema: z.object({
                idempotencyKey: z.string().min(1).max(200),
                items: z.array(z.object({
                    orderItemId: z.string().min(1),
                    quantity: z.number().int().positive(),
                })).min(1).max(100),
                providerId: z.string().min(1).nullable().optional(),
                providerType: z.string().min(1).max(100).optional(),
                externalId: z.string().max(500).nullable().optional(),
                trackingId: z.string().max(500).nullable().optional(),
                trackingUrl: z.string().url().max(2000).nullable().optional(),
                courierName: z.string().max(200).nullable().optional(),
                note: z.string().max(2000).nullable().optional(),
                metadata: z.record(z.string(), z.any()).nullable().optional(),
                shipmentAmountMinor: z.number().int().nonnegative().optional(),
                isFinalShipment: z.boolean().optional(),
            }) } },
        },
    },
    responses: {
        200: {
            description: "Created seller shipment",
            content: { "application/json": { schema: successEnvelope(z.object({
                replayed: z.boolean(),
                shipmentId: z.string(),
                vendorOrderId: z.string(),
                orderId: z.string(),
                vendorId: z.string(),
                status: vendorShipmentStatusSchema,
                version: z.number().int().positive(),
                success: z.boolean().optional(),
                message: z.string().optional(),
                externalId: z.string().nullable().optional(),
                trackingId: z.string().nullable().optional(),
                trackingUrl: z.string().nullable().optional(),
                reconciliationRequired: z.boolean().optional(),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(createShipmentRoute, async (c) => {
    const { vendorOrderId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "orders.write");
    await assertMarketplaceFeatureEnabled(db, "vendorShipments", c.env?.CACHE);
    const body = c.req.valid("json");
    const actorUserId = getCurrentUserId(c);
    if (body.providerId) {
        const encryptionKey = requireEncryptionKey(c.env);
        return ok(c, await createVendorProviderShipment(db, {
            idempotencyKey: body.idempotencyKey,
            vendorOrderId,
            vendorId: vendorContext.vendorId,
            providerId: body.providerId,
            items: body.items,
            note: body.note,
            metadata: body.metadata,
            shipmentAmountMinor: body.shipmentAmountMinor,
            isFinalShipment: body.isFinalShipment,
            actorUserId,
        }, encryptionKey));
    }
    return ok(c, await createVendorShipment(db, {
        ...body,
        vendorOrderId,
        vendorId: vendorContext.vendorId,
        actorUserId,
    }));
});

const deliveryProvidersRoute = createRoute({
    method: "get",
    path: "/delivery-providers",
    tags: ["Vendor Dashboard"],
    summary: "List active courier providers available to sellers",
    request: { query: vendorContextQuerySchema },
    responses: {
        200: {
            description: "Active courier providers",
            content: { "application/json": { schema: successEnvelope(z.object({
                providers: z.array(z.object({
                    id: z.string(),
                    name: z.string(),
                    type: z.string(),
                })),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(deliveryProvidersRoute, async (c) => {
    const { vendorId } = c.req.valid("query");
    const { db } = await requireVendorContext(c, vendorId, "orders.read");
    const providers = await db.select({
        id: deliveryProviders.id,
        name: deliveryProviders.name,
        type: deliveryProviders.type,
    })
        .from(deliveryProviders)
        .where(eq(deliveryProviders.isActive, true))
        .orderBy(asc(deliveryProviders.name))
        .all();
    return ok(c, { providers });
});

const shipmentListRoute = createRoute({
    method: "get",
    path: "/shipments",
    tags: ["Vendor Dashboard"],
    summary: "List seller-scoped shipments",
    request: { query: shipmentListQuerySchema },
    responses: {
        200: {
            description: "Seller shipments",
            content: { "application/json": { schema: successEnvelope(z.object({
                shipments: z.array(vendorShipmentRowSchema),
                pagination: z.object({
                    page: z.number().int().positive(),
                    limit: z.number().int().positive(),
                    total: z.number().int().nonnegative(),
                    totalPages: z.number().int().nonnegative(),
                }),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(shipmentListRoute, async (c) => {
    const { vendorId, vendorOrderId, status, page, limit } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "orders.read");
    const where = and(
        eq(vendorShipments.vendorId, vendorContext.vendorId),
        vendorOrderId ? eq(vendorShipments.vendorOrderId, vendorOrderId) : undefined,
        status ? eq(vendorShipments.status, status) : undefined,
    );
    const offset = (page - 1) * limit;
    const [totalRow, rows] = await Promise.all([
        db.select({ value: count() }).from(vendorShipments).where(where).get(),
        db.select({
            id: vendorShipments.id,
            vendorOrderId: vendorShipments.vendorOrderId,
            orderId: vendorShipments.orderId,
            providerType: vendorShipments.providerType,
            trackingId: vendorShipments.trackingId,
            trackingUrl: vendorShipments.trackingUrl,
            courierName: vendorShipments.courierName,
            status: vendorShipments.status,
            shipmentAmountMinor: vendorShipments.shipmentAmountMinor,
            isFinalShipment: vendorShipments.isFinalShipment,
            version: vendorShipments.version,
            pickedUpAt: vendorShipments.pickedUpAt,
            deliveredAt: vendorShipments.deliveredAt,
            cancelledAt: vendorShipments.cancelledAt,
            createdAt: vendorShipments.createdAt,
            updatedAt: vendorShipments.updatedAt,
        })
            .from(vendorShipments)
            .where(where)
            .orderBy(desc(vendorShipments.createdAt))
            .limit(limit)
            .offset(offset),
    ]);
    const total = totalRow?.value ?? 0;
    return ok(c, {
        shipments: rows,
        pagination: { page, limit, total, totalPages: totalPages(total, limit) },
    });
});

const shipmentDetailRoute = createRoute({
    method: "get",
    path: "/shipments/{shipmentId}",
    tags: ["Vendor Dashboard"],
    summary: "Read one seller-scoped shipment",
    request: {
        params: z.object({ shipmentId: z.string().min(1) }),
        query: vendorContextQuerySchema,
    },
    responses: {
        200: {
            description: "Seller shipment detail",
            content: { "application/json": { schema: successEnvelope(z.object({
                shipment: vendorShipmentRowSchema,
                items: z.array(vendorShipmentItemSchema),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(shipmentDetailRoute, async (c) => {
    const { shipmentId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "orders.read");
    const shipment = await db.select({
        id: vendorShipments.id,
        vendorOrderId: vendorShipments.vendorOrderId,
        orderId: vendorShipments.orderId,
        providerType: vendorShipments.providerType,
        trackingId: vendorShipments.trackingId,
        trackingUrl: vendorShipments.trackingUrl,
        courierName: vendorShipments.courierName,
        status: vendorShipments.status,
        shipmentAmountMinor: vendorShipments.shipmentAmountMinor,
        isFinalShipment: vendorShipments.isFinalShipment,
        version: vendorShipments.version,
        pickedUpAt: vendorShipments.pickedUpAt,
        deliveredAt: vendorShipments.deliveredAt,
        cancelledAt: vendorShipments.cancelledAt,
        createdAt: vendorShipments.createdAt,
        updatedAt: vendorShipments.updatedAt,
    })
        .from(vendorShipments)
        .where(and(
            eq(vendorShipments.id, shipmentId),
            eq(vendorShipments.vendorId, vendorContext.vendorId),
        ))
        .get();
    if (!shipment) throw new NotFoundError("Seller shipment not found");
    const items = await db.select({
        id: vendorShipmentItems.id,
        orderItemId: vendorShipmentItems.orderItemId,
        productName: orderItems.productName,
        variantLabel: orderItems.variantLabel,
        quantity: vendorShipmentItems.quantity,
    })
        .from(vendorShipmentItems)
        .innerJoin(orderItems, eq(orderItems.id, vendorShipmentItems.orderItemId))
        .where(eq(vendorShipmentItems.shipmentId, shipmentId))
        .orderBy(vendorShipmentItems.createdAt)
        .all();
    return ok(c, { shipment, items });
});

const checkShipmentStatusRoute = createRoute({
    method: "post",
    path: "/shipments/{shipmentId}/check-status",
    tags: ["Vendor Dashboard"],
    summary: "Refresh one seller shipment from its configured courier",
    request: {
        params: z.object({ shipmentId: z.string().min(1) }),
        query: vendorContextQuerySchema,
    },
    responses: {
        200: {
            description: "Courier status checked and safely projected",
            content: { "application/json": { schema: successEnvelope(z.object({
                shipmentId: z.string(),
                orderId: z.string(),
                vendorId: z.string(),
                externalId: z.string(),
                trackingId: z.string().nullable(),
                status: vendorShipmentStatusSchema,
                rawStatus: z.string(),
                version: z.number().int().positive(),
                applied: z.boolean(),
                path: z.array(vendorShipmentStatusSchema).nullable(),
                checkedAt: z.string(),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(checkShipmentStatusRoute, async (c) => {
    const { shipmentId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "orders.write");
    await assertMarketplaceFeatureEnabled(db, "vendorShipments", c.env?.CACHE);
    const result = await checkVendorProviderShipmentStatus(
        db,
        { shipmentId, vendorId: vendorContext.vendorId },
        requireEncryptionKey(c.env),
    );
    const { parentOrderStatusUpdate, ...response } = result;
    await invalidateProductAvailabilityCaches(db, { orderIds: [result.orderId] }, c);
    await enqueueOrderStatusChangeNotification({
        db,
        queue: c.env.ORDER_NOTIFICATIONS_QUEUE,
        statusChange: parentOrderStatusUpdate?.changed
            && parentOrderStatusUpdate.previousStatus !== parentOrderStatusUpdate.newStatus
            ? parentOrderStatusUpdate
            : null,
        trackingId: result.trackingId,
        source: "vendor-dashboard-courier-status",
    });
    return ok(c, response);
});

const updateShipmentStatusRoute = createRoute({
    method: "patch",
    path: "/shipments/{shipmentId}/status",
    tags: ["Vendor Dashboard"],
    summary: "Update one seller-scoped shipment status",
    request: {
        params: z.object({ shipmentId: z.string().min(1) }),
        query: vendorContextQuerySchema,
        body: {
            required: true,
            content: { "application/json": { schema: z.object({
                expectedVersion: z.number().int().positive(),
                status: vendorShipmentStatusSchema,
                rawStatus: z.string().max(500).nullable().optional(),
                trackingId: z.string().max(500).nullable().optional(),
                trackingUrl: z.string().url().max(2000).nullable().optional(),
                courierName: z.string().max(200).nullable().optional(),
                note: z.string().max(2000).nullable().optional(),
                metadata: z.record(z.string(), z.any()).nullable().optional(),
            }) } },
        },
    },
    responses: {
        200: {
            description: "Updated seller shipment",
            content: { "application/json": { schema: successEnvelope(z.object({
                shipmentId: z.string(),
                status: vendorShipmentStatusSchema,
                version: z.number().int().positive(),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(updateShipmentStatusRoute, async (c) => {
    const { shipmentId } = c.req.valid("param");
    const { vendorId } = c.req.valid("query");
    const { db, vendorContext } = await requireVendorContext(c, vendorId, "orders.write");
    await assertMarketplaceFeatureEnabled(db, "vendorShipments", c.env?.CACHE);
    const body = c.req.valid("json");
    const result = await updateVendorShipmentStatus(db, {
        ...body,
        shipmentId,
        vendorId: vendorContext.vendorId,
    });
    const { parentOrderStatusUpdate, ...response } = result;
    if (parentOrderStatusUpdate) {
        await invalidateProductAvailabilityCaches(db, { orderIds: [parentOrderStatusUpdate.orderId] }, c);
        await enqueueOrderStatusChangeNotification({
            db,
            queue: c.env.ORDER_NOTIFICATIONS_QUEUE,
            statusChange: parentOrderStatusUpdate.changed
                && parentOrderStatusUpdate.previousStatus !== parentOrderStatusUpdate.newStatus
                ? parentOrderStatusUpdate
                : null,
            trackingId: body.trackingId,
            source: "vendor-dashboard-shipment-status",
        });
    }
    return ok(c, response);
});

export const adminVendorDashboardRoutes = app;
