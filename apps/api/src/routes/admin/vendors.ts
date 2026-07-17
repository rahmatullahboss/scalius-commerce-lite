// Canonical admin routes for marketplace sellers.
// Membership is the sole seller authority; payout destinations are returned masked only.

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, asc, count, desc, eq, isNull, like, or, type SQL } from "drizzle-orm";
import type { Database } from "@scalius/database/client";
import {
    user,
    vendorAddresses,
    vendorCommissionRules,
    vendorPayoutMethods,
    vendorUsers,
    vendorVerificationDocuments,
    vendors,
} from "@scalius/database/schema";
import {
    createVendorCommand,
    moderateVendorCommand,
    reviewVendorPayoutMethodCommand,
    reviewVendorVerificationCommand,
    updateVendorCommand,
} from "@scalius/core/modules/vendors/vendor-commands";
import { NotFoundError } from "../../utils/api-error";
import { created, ok } from "../../utils/api-response";
import { errorResponses, paginatedEnvelope, successEnvelope } from "../../schemas/responses";
import { assertMarketplaceFeatureEnabled } from "@scalius/core/modules/settings";
import { invalidateCatalogCaches } from "../../utils/cache-invalidation";

const app = new OpenAPIHono<{ Bindings: Env }>();

const vendorStatusSchema = z.enum(["pending", "approved", "rejected", "suspended", "closed"]);
const vendorRoleSchema = z.enum(["owner", "admin", "catalog", "fulfillment", "finance", "viewer"]);
const vendorUserStatusSchema = z.enum(["invited", "active", "suspended", "revoked"]);
const payoutMethodSchema = z.enum(["bank", "bkash", "nagad", "rocket", "manual"]);
const payoutStatusSchema = z.enum(["pending", "verified", "rejected", "disabled"]);
const verificationTypeSchema = z.enum(["identity", "trade_license", "tax", "bank_document", "other"]);
const verificationStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);
const timestampSchema = z.any();
const nullableTimestampSchema = z.any().nullable();

const vendorSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    legalName: z.string().nullable(),
    status: vendorStatusSchema,
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: nullableTimestampSchema,
});

const vendorMemberSchema = z.object({
    id: z.string(),
    vendorId: z.string(),
    userId: z.string(),
    role: vendorRoleSchema,
    status: vendorUserStatusSchema,
    userName: z.string().nullable(),
    userEmail: z.string().nullable(),
    invitedAt: timestampSchema,
    acceptedAt: nullableTimestampSchema,
    revokedAt: nullableTimestampSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
});

const vendorAddressSchema = z.object({
    id: z.string(),
    vendorId: z.string(),
    type: z.enum(["business", "pickup", "return"]),
    label: z.string().nullable(),
    recipientName: z.string().nullable(),
    phone: z.string().nullable(),
    addressLine1: z.string(),
    addressLine2: z.string().nullable(),
    district: z.string().nullable(),
    upazila: z.string().nullable(),
    postalCode: z.string().nullable(),
    countryCode: z.string(),
    isDefault: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
});

const maskedPayoutMethodSchema = z.object({
    id: z.string(),
    vendorId: z.string(),
    method: payoutMethodSchema,
    displayName: z.string(),
    lastFour: z.string().nullable(),
    providerName: z.string().nullable(),
    isDefault: z.boolean(),
    status: payoutStatusSchema,
    verifiedBy: z.string().nullable(),
    verifiedAt: nullableTimestampSchema,
    rejectionReason: z.string().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
});

const verificationDocumentSchema = z.object({
    id: z.string(),
    vendorId: z.string(),
    type: verificationTypeSchema,
    originalFilename: z.string().nullable(),
    mimeType: z.string().nullable(),
    status: verificationStatusSchema,
    reviewedBy: z.string().nullable(),
    reviewedAt: nullableTimestampSchema,
    rejectionReason: z.string().nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
});

const commissionRuleSchema = z.object({
    id: z.string(),
    scope: z.enum(["platform", "vendor"]),
    vendorId: z.string().nullable(),
    rateBps: z.number().int(),
    status: z.enum(["draft", "active", "retired"]),
    priority: z.number().int(),
    effectiveFrom: timestampSchema,
    effectiveTo: nullableTimestampSchema,
});

const vendorDetailSchema = vendorSummarySchema.extend({
    members: z.array(vendorMemberSchema),
    addresses: z.array(vendorAddressSchema),
    payoutAccounts: z.array(maskedPayoutMethodSchema),
    kycDocuments: z.array(verificationDocumentSchema),
    commissionRules: z.array(commissionRuleSchema),
});

const nullableTextInput = z.string().trim().max(500).optional().nullable();
const vendorCreateSchema = z.object({
    name: z.string().trim().min(1).max(160),
    slug: z.string().trim().min(1).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    legalName: nullableTextInput,
    status: vendorStatusSchema.optional().default("pending"),
    ownerUserId: z.string().trim().min(1).optional().nullable(),
    commissionBps: z.coerce.number().int().min(0).max(10_000).optional().default(0),
    contactEmail: z.string().trim().email().optional().nullable(),
    contactPhone: z.string().trim().max(50).optional().nullable(),
    businessAddress: nullableTextInput,
    district: z.string().trim().max(120).optional().nullable(),
    upazila: z.string().trim().max(120).optional().nullable(),
    pickupAddress: nullableTextInput,
});
const vendorUpdateSchema = vendorCreateSchema.omit({ status: true }).partial().refine(
    (data) => Object.keys(data).length > 0,
    { message: "At least one field is required" },
);

async function readVendorOrThrow(db: Database, vendorId: string) {
    const rows = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
    const vendor = rows[0];
    if (!vendor) throw new NotFoundError("Vendor not found");
    return vendor;
}

const createVendorRoute = createRoute({
    method: "post",
    path: "/",
    tags: ["Admin - Vendors"],
    summary: "Create marketplace vendor",
    request: { body: { content: { "application/json": { schema: vendorCreateSchema } } } },
    responses: {
        201: {
            description: "Vendor created",
            content: { "application/json": { schema: successEnvelope(z.object({ vendor: vendorSummarySchema })) } },
        },
        ...errorResponses,
    },
});

app.openapi(createVendorRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite", c.env?.CACHE);
    const data = c.req.valid("json");
    const { vendorId } = await createVendorCommand(db, data);
    return created(c, { vendor: await readVendorOrThrow(db, vendorId) });
});

const listVendorsRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["Admin - Vendors"],
    summary: "List marketplace vendors",
    request: {
        query: z.object({
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(100).default(20),
            search: z.string().optional().default(""),
            status: z.union([vendorStatusSchema, z.literal("all")]).optional().default("all"),
            sort: z.enum(["createdAt", "updatedAt", "name", "status"]).optional().default("createdAt"),
            order: z.enum(["asc", "desc"]).optional().default("desc"),
        }),
    },
    responses: {
        200: {
            description: "Vendor list with pagination",
            content: { "application/json": { schema: paginatedEnvelope("vendors", vendorSummarySchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(listVendorsRoute, async (c) => {
    const db = c.get("db");
    const query = c.req.valid("query");
    const offset = (query.page - 1) * query.limit;
    const filters: SQL[] = [];
    const search = query.search.trim();
    if (query.status !== "all") filters.push(eq(vendors.status, query.status));
    if (search) {
        const pattern = `%${search}%`;
        const searchFilter = or(
            like(vendors.name, pattern),
            like(vendors.slug, pattern),
            like(vendors.legalName, pattern),
            like(vendors.contactEmail, pattern),
            like(vendors.contactPhone, pattern),
        );
        if (searchFilter) filters.push(searchFilter);
    }

    const where = filters.length ? and(...filters) : undefined;
    const sortColumn = query.sort === "name"
        ? vendors.name
        : query.sort === "status"
            ? vendors.status
            : query.sort === "updatedAt"
                ? vendors.updatedAt
                : vendors.createdAt;
    const rows = await db.select().from(vendors)
        .where(where)
        .orderBy(query.order === "asc" ? asc(sortColumn) : desc(sortColumn))
        .limit(query.limit)
        .offset(offset);
    const total = (await db.select({ total: count() }).from(vendors).where(where))[0]?.total ?? 0;

    return ok(c, {
        vendors: rows,
        pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    });
});

const getVendorRoute = createRoute({
    method: "get",
    path: "/{id}",
    tags: ["Admin - Vendors"],
    summary: "Get marketplace vendor detail",
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
        200: {
            description: "Vendor detail",
            content: { "application/json": { schema: successEnvelope(z.object({ vendor: vendorDetailSchema })) } },
        },
        ...errorResponses,
    },
});

app.openapi(getVendorRoute, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    const vendor = await readVendorOrThrow(db, id);
    const members = await db.select({
        id: vendorUsers.id,
        vendorId: vendorUsers.vendorId,
        userId: vendorUsers.userId,
        role: vendorUsers.role,
        status: vendorUsers.status,
        userName: user.name,
        userEmail: user.email,
        invitedAt: vendorUsers.invitedAt,
        acceptedAt: vendorUsers.acceptedAt,
        revokedAt: vendorUsers.revokedAt,
        createdAt: vendorUsers.createdAt,
        updatedAt: vendorUsers.updatedAt,
    }).from(vendorUsers).leftJoin(user, eq(vendorUsers.userId, user.id)).where(eq(vendorUsers.vendorId, id));
    const addresses = await db.select({
        id: vendorAddresses.id,
        vendorId: vendorAddresses.vendorId,
        type: vendorAddresses.type,
        label: vendorAddresses.label,
        recipientName: vendorAddresses.recipientName,
        phone: vendorAddresses.phone,
        addressLine1: vendorAddresses.addressLine1,
        addressLine2: vendorAddresses.addressLine2,
        district: vendorAddresses.district,
        upazila: vendorAddresses.upazila,
        postalCode: vendorAddresses.postalCode,
        countryCode: vendorAddresses.countryCode,
        isDefault: vendorAddresses.isDefault,
        createdAt: vendorAddresses.createdAt,
        updatedAt: vendorAddresses.updatedAt,
    }).from(vendorAddresses).where(and(eq(vendorAddresses.vendorId, id), isNull(vendorAddresses.deletedAt)));
    const payoutAccounts = await db.select({
        id: vendorPayoutMethods.id,
        vendorId: vendorPayoutMethods.vendorId,
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
    }).from(vendorPayoutMethods).where(and(eq(vendorPayoutMethods.vendorId, id), isNull(vendorPayoutMethods.deletedAt)));
    const kycDocuments = await db.select({
        id: vendorVerificationDocuments.id,
        vendorId: vendorVerificationDocuments.vendorId,
        type: vendorVerificationDocuments.type,
        originalFilename: vendorVerificationDocuments.originalFilename,
        mimeType: vendorVerificationDocuments.mimeType,
        status: vendorVerificationDocuments.status,
        reviewedBy: vendorVerificationDocuments.reviewedBy,
        reviewedAt: vendorVerificationDocuments.reviewedAt,
        rejectionReason: vendorVerificationDocuments.rejectionReason,
        createdAt: vendorVerificationDocuments.createdAt,
        updatedAt: vendorVerificationDocuments.updatedAt,
    }).from(vendorVerificationDocuments).where(and(
        eq(vendorVerificationDocuments.vendorId, id),
        isNull(vendorVerificationDocuments.deletedAt),
    ));
    const commissionRules = await db.select({
        id: vendorCommissionRules.id,
        scope: vendorCommissionRules.scope,
        vendorId: vendorCommissionRules.vendorId,
        rateBps: vendorCommissionRules.rateBps,
        status: vendorCommissionRules.status,
        priority: vendorCommissionRules.priority,
        effectiveFrom: vendorCommissionRules.effectiveFrom,
        effectiveTo: vendorCommissionRules.effectiveTo,
    }).from(vendorCommissionRules).where(eq(vendorCommissionRules.vendorId, id));

    return ok(c, { vendor: { ...vendor, members, addresses, payoutAccounts, kycDocuments, commissionRules } });
});

const updateVendorRoute = createRoute({
    method: "patch",
    path: "/{id}",
    tags: ["Admin - Vendors"],
    summary: "Update marketplace vendor",
    request: {
        params: z.object({ id: z.string().min(1) }),
        body: { content: { "application/json": { schema: vendorUpdateSchema } } },
    },
    responses: {
        200: {
            description: "Vendor updated",
            content: { "application/json": { schema: successEnvelope(z.object({ vendor: vendorSummarySchema })) } },
        },
        ...errorResponses,
    },
});

app.openapi(updateVendorRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite", c.env?.CACHE);
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
    await updateVendorCommand(db, id, data);
    const vendor = await readVendorOrThrow(db, id);
    await invalidateCatalogCaches("products", c, {
        htmlPaths: [`/vendors/${vendor.slug}`],
    });
    return ok(c, { vendor });
});

const updateVendorStatusRoute = createRoute({
    method: "patch",
    path: "/{id}/status",
    tags: ["Admin - Vendors"],
    summary: "Update marketplace vendor status",
    request: {
        params: z.object({ id: z.string().min(1) }),
        body: { content: { "application/json": { schema: z.object({ status: vendorStatusSchema, reason: z.string().max(500).optional().nullable() }) } } },
    },
    responses: {
        200: {
            description: "Vendor status updated",
            content: { "application/json": { schema: successEnvelope(z.object({ vendor: vendorSummarySchema })) } },
        },
        ...errorResponses,
    },
});

app.openapi(updateVendorStatusRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite", c.env?.CACHE);
    const actor = c.get("user");
    const { id } = c.req.valid("param");
    const { status, reason } = c.req.valid("json");
    await moderateVendorCommand(db, id, {
        status,
        reason,
        actorUserId: actor?.id ?? null,
    });
    const vendor = await readVendorOrThrow(db, id);
    await invalidateCatalogCaches("products", c, {
        htmlPaths: [`/vendors/${vendor.slug}`],
    });
    return ok(c, { vendor });
});

const updatePayoutStatusRoute = createRoute({
    method: "patch",
    path: "/{id}/payout-accounts/{accountId}/status",
    tags: ["Admin - Vendors"],
    summary: "Review a masked vendor payout method",
    request: {
        params: z.object({ id: z.string().min(1), accountId: z.string().min(1) }),
        body: { content: { "application/json": { schema: z.object({ status: payoutStatusSchema, rejectionReason: z.string().max(500).optional().nullable() }) } } },
    },
    responses: {
        200: {
            description: "Payout method review updated",
            content: { "application/json": { schema: successEnvelope(z.object({ payoutAccount: maskedPayoutMethodSchema })) } },
        },
        ...errorResponses,
    },
});

app.openapi(updatePayoutStatusRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "payoutWrite", c.env?.CACHE);
    const actor = c.get("user");
    const { id, accountId } = c.req.valid("param");
    const { status, rejectionReason } = c.req.valid("json");
    await reviewVendorPayoutMethodCommand(db, id, accountId, {
        status,
        rejectionReason,
        actorUserId: actor?.id ?? null,
    });
    const rows = await db.select({
        id: vendorPayoutMethods.id,
        vendorId: vendorPayoutMethods.vendorId,
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
    }).from(vendorPayoutMethods).where(eq(vendorPayoutMethods.id, accountId)).limit(1);
    if (!rows[0]) throw new NotFoundError("Vendor payout method not found");
    return ok(c, { payoutAccount: rows[0] });
});

const updateVerificationStatusRoute = createRoute({
    method: "patch",
    path: "/{id}/kyc-documents/{documentId}/status",
    tags: ["Admin - Vendors"],
    summary: "Review a vendor verification document",
    request: {
        params: z.object({ id: z.string().min(1), documentId: z.string().min(1) }),
        body: { content: { "application/json": { schema: z.object({
            status: verificationStatusSchema,
            rejectionReason: z.string().max(500).optional().nullable(),
        }) } } },
    },
    responses: {
        200: {
            description: "Verification document review updated",
            content: { "application/json": { schema: successEnvelope(z.object({ kycDocument: verificationDocumentSchema })) } },
        },
        ...errorResponses,
    },
});

app.openapi(updateVerificationStatusRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite", c.env?.CACHE);
    const actor = c.get("user");
    const { id, documentId } = c.req.valid("param");
    const { status, rejectionReason } = c.req.valid("json");
    await reviewVendorVerificationCommand(db, id, documentId, {
        status,
        rejectionReason,
        actorUserId: actor?.id ?? null,
    });
    const rows = await db.select({
        id: vendorVerificationDocuments.id,
        vendorId: vendorVerificationDocuments.vendorId,
        type: vendorVerificationDocuments.type,
        originalFilename: vendorVerificationDocuments.originalFilename,
        mimeType: vendorVerificationDocuments.mimeType,
        status: vendorVerificationDocuments.status,
        reviewedBy: vendorVerificationDocuments.reviewedBy,
        reviewedAt: vendorVerificationDocuments.reviewedAt,
        rejectionReason: vendorVerificationDocuments.rejectionReason,
        createdAt: vendorVerificationDocuments.createdAt,
        updatedAt: vendorVerificationDocuments.updatedAt,
    }).from(vendorVerificationDocuments).where(eq(vendorVerificationDocuments.id, documentId)).limit(1);
    if (!rows[0]) throw new NotFoundError("Vendor verification document not found");
    return ok(c, { kycDocument: rows[0] });
});

export { app as adminVendorRoutes };
