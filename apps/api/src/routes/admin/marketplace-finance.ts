import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
    payoutAttempts,
    payoutBatches,
    payoutItems,
    vendorBalanceProjections,
    vendorPayoutMethods,
    vendors,
} from "@scalius/database/schema";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { rebuildVendorBalanceProjections } from "@scalius/core/modules/marketplace/balance-projection";
import { processMarketplaceOutboxBatch } from "@scalius/core/modules/marketplace/outbox-processor";
import { getMarketplaceFinanceReconciliation } from "@scalius/core/modules/marketplace/reconciliation";
import {
    claimPayoutItemForDispatch,
    completePayoutItem,
    previewVendorPayout,
    releasePayoutItem,
    reserveVendorPayout,
} from "@scalius/core/modules/marketplace/payout";
import { releaseVendorOrderSettlement } from "@scalius/core/modules/marketplace/settlement";
import { processSettlementReleaseBatch } from "@scalius/core/modules/marketplace/settlement-sweep";
import { assertMarketplaceFeatureEnabled } from "@scalius/core/modules/settings";
import { moderateVendorPayoutMethod } from "@scalius/core/modules/vendors/vendor-payout-methods";
import { errorResponses, successEnvelope } from "../../schemas/responses";
import { ok } from "../../utils/api-response";

const app = new OpenAPIHono<{ Bindings: Env }>();
const timestampSchema = z.any();

const ledgerMismatchSchema = z.object({
    journalId: z.string(),
    debitMinor: z.number().int().nonnegative(),
    creditMinor: z.number().int().nonnegative(),
    invalidEntrySides: z.number().int().nonnegative(),
});

const refundMismatchSchema = z.object({
    refundId: z.string(),
    amountMinor: z.number().int().nonnegative(),
    allocatedMinor: z.number().int().nonnegative(),
});

const financialEventMismatchSchema = z.object({
    sourceKind: z.enum(["payment", "refund"]),
    sourceId: z.string(),
    eventType: z.enum(["payment.captured", "refund.completed"]),
    reason: z.enum([
        "missing_outbox",
        "failed_outbox",
        "dead_outbox",
        "missing_journal",
        "journal_contract_mismatch",
        "journal_missing_entries",
    ]),
    evidenceId: z.string().nullable(),
});

const projectionSchema = z.object({
    vendorId: z.string(),
    currency: z.string(),
    pendingMinor: z.number().int().nonnegative(),
    availableMinor: z.number().int().nonnegative(),
    reservedMinor: z.number().int().nonnegative(),
    paidMinor: z.number().int().nonnegative(),
    debtMinor: z.number().int().nonnegative(),
    lastJournalId: z.string(),
    version: z.number().int().positive(),
});

const projectionMismatchSchema = z.object({
    vendorId: z.string(),
    currency: z.string(),
    reason: z.enum(["missing_projection", "unexpected_projection", "values_differ"]),
    expected: projectionSchema.nullable(),
    actual: projectionSchema.nullable(),
});

const payoutItemMismatchSchema = z.object({
    payoutItemId: z.string(),
    reason: z.enum([
        "missing_reservation_journal",
        "reservation_journal_mismatch",
        "missing_completion_journal",
        "completion_journal_mismatch",
        "missing_release_journal",
        "release_journal_mismatch",
    ]),
    expectedAmountMinor: z.number().int().positive(),
    actualAmountMinor: z.number().int().nullable(),
    journalId: z.string().nullable(),
});

const payoutBatchMismatchSchema = z.object({
    batchId: z.string(),
    expectedItemCount: z.number().int().nonnegative(),
    actualItemCount: z.number().int().nonnegative(),
    expectedTotalMinor: z.number().int().nonnegative(),
    actualTotalMinor: z.number().int().nonnegative(),
});

const reconciliationSchema = z.object({
    healthy: z.boolean(),
    checkedAt: timestampSchema,
    ledgerEntries: z.number().int().nonnegative(),
    payments: z.number().int().nonnegative(),
    refunds: z.number().int().nonnegative(),
    payouts: z.number().int().nonnegative(),
    payoutBatches: z.number().int().nonnegative(),
    projections: z.number().int().nonnegative(),
    ledgerMismatches: z.array(ledgerMismatchSchema),
    financialEventMismatches: z.array(financialEventMismatchSchema),
    refundMismatches: z.array(refundMismatchSchema),
    payoutItemMismatches: z.array(payoutItemMismatchSchema),
    payoutBatchMismatches: z.array(payoutBatchMismatchSchema),
    projectionMismatches: z.array(projectionMismatchSchema),
});

const reconciliationRoute = createRoute({
    method: "get",
    path: "/reconciliation",
    tags: ["Marketplace Finance"],
    summary: "Reconcile immutable marketplace finance records",
    responses: {
        200: {
            description: "Marketplace finance reconciliation report",
            content: { "application/json": { schema: successEnvelope(reconciliationSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(reconciliationRoute, async (c) => {
    const report = await getMarketplaceFinanceReconciliation(c.get("db"));
    return ok(c, report);
});

const rebuildProjectionRoute = createRoute({
    method: "post",
    path: "/projections/rebuild",
    tags: ["Marketplace Finance"],
    summary: "Rebuild seller balance projections from the immutable ledger",
    responses: {
        200: {
            description: "Projection rebuild result and reconciliation",
            content: {
                "application/json": {
                    schema: successEnvelope(z.object({
                        rebuild: z.object({
                            vendors: z.number().int().nonnegative(),
                            entries: z.number().int().nonnegative(),
                        }),
                        reconciliation: reconciliationSchema,
                    })),
                },
            },
        },
        ...errorResponses,
    },
});

app.openapi(rebuildProjectionRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "ledgerPosting", c.env?.CACHE);
    const rebuild = await rebuildVendorBalanceProjections(db);
    const reconciliation = await getMarketplaceFinanceReconciliation(db);
    return ok(c, { rebuild, reconciliation });
});

const processOutboxRoute = createRoute({
    method: "post",
    path: "/outbox/process",
    tags: ["Marketplace Finance"],
    summary: "Process a bounded batch of marketplace financial outbox events",
    request: {
        body: {
            required: false,
            content: {
                "application/json": {
                    schema: z.object({
                        limit: z.number().int().min(1).max(100).default(20),
                    }).default({ limit: 20 }),
                },
            },
        },
    },
    responses: {
        200: {
            description: "Marketplace outbox processing result",
            content: { "application/json": { schema: successEnvelope(z.object({
                enabled: z.boolean(),
                scanned: z.number().int().nonnegative(),
                claimed: z.number().int().nonnegative(),
                processed: z.number().int().nonnegative(),
                failed: z.number().int().nonnegative(),
                dead: z.number().int().nonnegative(),
                skipped: z.number().int().nonnegative(),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(processOutboxRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "ledgerPosting", c.env?.CACHE);
    const body = c.req.valid("json") ?? { limit: 20 };
    const result = await processMarketplaceOutboxBatch(db, {
        enabled: true,
        limit: body.limit,
    });
    if (result.processed > 0) {
        await rebuildVendorBalanceProjections(db);
    }
    return ok(c, result);
});

const vendorBalanceSchema = z.object({
    currency: z.string(),
    pendingMinor: z.number().int().nonnegative(),
    availableMinor: z.number().int().nonnegative(),
    reservedMinor: z.number().int().nonnegative(),
    paidMinor: z.number().int().nonnegative(),
    debtMinor: z.number().int().nonnegative(),
    lastJournalId: z.string().nullable(),
    version: z.number().int().positive(),
    updatedAt: timestampSchema,
});

const vendorBalancesRoute = createRoute({
    method: "get",
    path: "/vendors/{vendorId}/balances",
    tags: ["Marketplace Finance"],
    summary: "Read ledger-derived balance projections for one seller",
    request: { params: z.object({ vendorId: z.string().min(1) }) },
    responses: {
        200: {
            description: "Seller balance projections",
            content: { "application/json": { schema: successEnvelope(z.object({
                vendorId: z.string(),
                balances: z.array(vendorBalanceSchema),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(vendorBalancesRoute, async (c) => {
    const db = c.get("db");
    const { vendorId } = c.req.valid("param");
    const balances = await db
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
        .where(eq(vendorBalanceProjections.vendorId, vendorId))
        .orderBy(vendorBalanceProjections.currency)
        .all();
    return ok(c, { vendorId, balances });
});

const marketplaceMoneyBalanceSchema = z.object({
    pendingMinor: z.number().int().nonnegative(),
    availableMinor: z.number().int().nonnegative(),
    reservedMinor: z.number().int().nonnegative(),
    paidMinor: z.number().int().nonnegative(),
    debtMinor: z.number().int().nonnegative(),
    payoutEligibleMinor: z.number().int().nonnegative(),
});

const maskedPayoutMethodSchema = z.object({
    id: z.string(),
    method: z.enum(["bank", "bkash", "nagad", "rocket", "manual"]),
    displayName: z.string(),
    lastFour: z.string().nullable(),
    providerName: z.string().nullable(),
});

const payoutPreviewSchema = z.object({
    vendorId: z.string(),
    currency: z.string(),
    minimumPayoutMinor: z.number().int().nonnegative(),
    eligibleMinor: z.number().int().positive(),
    balance: marketplaceMoneyBalanceSchema,
    payoutMethod: maskedPayoutMethodSchema,
});

const payoutWorkflowResultSchema = z.object({
    payoutItemId: z.string(),
    status: z.string(),
    amountMinor: z.number().int().positive().optional(),
    journalId: z.string().optional(),
    attemptId: z.string().optional(),
    attemptNumber: z.number().int().positive().optional(),
});

const payoutItemStatusSchema = z.enum([
    "draft",
    "reserved",
    "processing",
    "completed",
    "failed",
    "released",
    "cancelled",
]);

const payoutItemRowSchema = z.object({
    id: z.string(),
    batchId: z.string(),
    vendorId: z.string(),
    vendorName: z.string(),
    payoutMethodId: z.string(),
    payoutMethod: z.enum(["bank", "bkash", "nagad", "rocket", "manual"]),
    payoutMethodDisplayName: z.string(),
    payoutMethodLastFour: z.string().nullable(),
    currency: z.string(),
    amountMinor: z.number().int().positive(),
    status: payoutItemStatusSchema,
    providerReference: z.string().nullable(),
    failureReason: z.string().nullable(),
    version: z.number().int().positive(),
    reservedAt: timestampSchema.nullable(),
    processingStartedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
    releasedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
});

const paginationSchema = z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
});

const jsonMetadataSchema = z.record(z.string(), z.any()).optional();

function currentActorUserId(c: { get: (key: string) => unknown }): string | undefined {
    const user = c.get("user") as { id?: string } | undefined;
    return user?.id;
}

async function assertMarketplaceFinanceWriteEnabled(
    c: { get: (key: string) => unknown; env?: Env },
    feature: "settlementRelease" | "payoutWrite",
) {
    const db = c.get("db") as Parameters<typeof assertMarketplaceFeatureEnabled>[0];
    await assertMarketplaceFeatureEnabled(db, "ledgerPosting", c.env?.CACHE);
    if (feature === "settlementRelease") {
        await assertMarketplaceFeatureEnabled(db, "settlementRelease", c.env?.CACHE);
    } else {
        await assertMarketplaceFeatureEnabled(db, "payoutWrite", c.env?.CACHE);
    }
    return db;
}

const releaseSettlementRoute = createRoute({
    method: "post",
    path: "/settlements/{vendorOrderId}/release",
    tags: ["Marketplace Finance"],
    summary: "Release one eligible seller fulfillment from pending to available",
    request: { params: z.object({ vendorOrderId: z.string().min(1) }) },
    responses: {
        200: {
            description: "Settlement release result",
            content: { "application/json": { schema: successEnvelope(z.object({
                released: z.literal(true),
                replayed: z.boolean(),
                journalId: z.string(),
                vendorOrderId: z.string(),
                vendorId: z.string(),
                currency: z.string(),
                amountMinor: z.number().int().positive(),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(releaseSettlementRoute, async (c) => {
    const db = await assertMarketplaceFinanceWriteEnabled(c, "settlementRelease");
    const { vendorOrderId } = c.req.valid("param");
    return ok(c, await releaseVendorOrderSettlement(db, { vendorOrderId }));
});

const settlementSweepRoute = createRoute({
    method: "post",
    path: "/settlements/sweep",
    tags: ["Marketplace Finance"],
    summary: "Process a bounded batch of eligible settlement releases",
    request: {
        body: {
            required: false,
            content: {
                "application/json": {
                    schema: z.object({
                        limit: z.number().int().min(1).max(100).default(20),
                    }).default({ limit: 20 }),
                },
            },
        },
    },
    responses: {
        200: {
            description: "Settlement sweep result",
            content: { "application/json": { schema: successEnvelope(z.object({
                enabled: z.boolean(),
                scanned: z.number().int().nonnegative(),
                released: z.number().int().nonnegative(),
                replayed: z.number().int().nonnegative(),
                skipped: z.number().int().nonnegative(),
                failed: z.number().int().nonnegative(),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(settlementSweepRoute, async (c) => {
    const db = await assertMarketplaceFinanceWriteEnabled(c, "settlementRelease");
    const body = c.req.valid("json") ?? { limit: 20 };
    return ok(c, await processSettlementReleaseBatch(db, {
        enabled: true,
        limit: body.limit,
    }));
});

const previewPayoutRoute = createRoute({
    method: "post",
    path: "/payouts/preview",
    tags: ["Marketplace Finance"],
    summary: "Preview ledger-derived seller payout eligibility",
    request: {
        body: {
            required: true,
            content: { "application/json": { schema: z.object({
                vendorId: z.string().min(1),
                currency: z.string().min(1).max(8),
                payoutMethodId: z.string().min(1).optional(),
            }) } },
        },
    },
    responses: {
        200: {
            description: "Payout preview",
            content: { "application/json": { schema: successEnvelope(payoutPreviewSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(previewPayoutRoute, async (c) => {
    const db = c.get("db");
    await assertMarketplaceFeatureEnabled(db, "ledgerPosting", c.env?.CACHE);
    return ok(c, await previewVendorPayout(db, c.req.valid("json")));
});

const reservePayoutRoute = createRoute({
    method: "post",
    path: "/payouts/reserve",
    tags: ["Marketplace Finance"],
    summary: "Reserve seller available balance for payout",
    request: {
        body: {
            required: true,
            content: { "application/json": { schema: z.object({
                idempotencyKey: z.string().min(1).max(200),
                vendorId: z.string().min(1),
                currency: z.string().min(1).max(8),
                amountMinor: z.number().int().positive().optional(),
                payoutMethodId: z.string().min(1).optional(),
                notes: z.string().max(1000).optional(),
            }) } },
        },
    },
    responses: {
        200: {
            description: "Payout reservation",
            content: { "application/json": { schema: successEnvelope(z.object({
                replayed: z.boolean(),
                batchId: z.string(),
                payoutItemId: z.string(),
                journalId: z.string(),
                vendorId: z.string(),
                currency: z.string(),
                amountMinor: z.number().int().positive(),
                status: z.literal("reserved"),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(reservePayoutRoute, async (c) => {
    const db = await assertMarketplaceFinanceWriteEnabled(c, "payoutWrite");
    const body = c.req.valid("json");
    return ok(c, await reserveVendorPayout(db, {
        ...body,
        actorUserId: currentActorUserId(c),
    }));
});

const claimPayoutRoute = createRoute({
    method: "post",
    path: "/payouts/{payoutItemId}/claim",
    tags: ["Marketplace Finance"],
    summary: "Claim one reserved payout for provider or manual dispatch",
    request: {
        params: z.object({ payoutItemId: z.string().min(1) }),
        body: {
            required: true,
            content: { "application/json": { schema: z.object({
                provider: z.string().min(1).max(100),
                requestMetadata: jsonMetadataSchema,
            }) } },
        },
    },
    responses: {
        200: {
            description: "Payout dispatch claim",
            content: { "application/json": { schema: successEnvelope(payoutWorkflowResultSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(claimPayoutRoute, async (c) => {
    const db = await assertMarketplaceFinanceWriteEnabled(c, "payoutWrite");
    const { payoutItemId } = c.req.valid("param");
    return ok(c, await claimPayoutItemForDispatch(db, {
        payoutItemId,
        ...c.req.valid("json"),
    }));
});

const completePayoutRoute = createRoute({
    method: "post",
    path: "/payouts/{payoutItemId}/complete",
    tags: ["Marketplace Finance"],
    summary: "Complete a processing payout and move reservation to paid",
    request: {
        params: z.object({ payoutItemId: z.string().min(1) }),
        body: {
            required: true,
            content: { "application/json": { schema: z.object({
                providerReference: z.string().min(1).max(500),
                responseMetadata: jsonMetadataSchema,
            }) } },
        },
    },
    responses: {
        200: {
            description: "Completed payout",
            content: { "application/json": { schema: successEnvelope(payoutWorkflowResultSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(completePayoutRoute, async (c) => {
    const db = await assertMarketplaceFinanceWriteEnabled(c, "payoutWrite");
    const { payoutItemId } = c.req.valid("param");
    return ok(c, await completePayoutItem(db, {
        payoutItemId,
        ...c.req.valid("json"),
    }));
});

const releasePayoutRoute = createRoute({
    method: "post",
    path: "/payouts/{payoutItemId}/release",
    tags: ["Marketplace Finance"],
    summary: "Release a reserved or failed payout back to available balance",
    request: {
        params: z.object({ payoutItemId: z.string().min(1) }),
        body: {
            required: true,
            content: { "application/json": { schema: z.object({
                reason: z.string().min(1).max(200),
                errorMessage: z.string().max(2000).optional(),
                responseMetadata: jsonMetadataSchema,
            }) } },
        },
    },
    responses: {
        200: {
            description: "Released payout reservation",
            content: { "application/json": { schema: successEnvelope(payoutWorkflowResultSchema) } },
        },
        ...errorResponses,
    },
});

app.openapi(releasePayoutRoute, async (c) => {
    const db = await assertMarketplaceFinanceWriteEnabled(c, "payoutWrite");
    const { payoutItemId } = c.req.valid("param");
    return ok(c, await releasePayoutItem(db, {
        payoutItemId,
        ...c.req.valid("json"),
    }));
});

const payoutListQuerySchema = z.object({
    vendorId: z.string().min(1).optional(),
    status: payoutItemStatusSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

const payoutListRoute = createRoute({
    method: "get",
    path: "/payouts",
    tags: ["Marketplace Finance"],
    summary: "List payout obligations with masked destinations",
    request: { query: payoutListQuerySchema },
    responses: {
        200: {
            description: "Payout list",
            content: { "application/json": { schema: successEnvelope(z.object({
                payouts: z.array(payoutItemRowSchema),
                pagination: paginationSchema,
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(payoutListRoute, async (c) => {
    const db = c.get("db");
    const { vendorId, status, page, limit } = c.req.valid("query");
    const where = and(
        vendorId ? eq(payoutItems.vendorId, vendorId) : undefined,
        status ? eq(payoutItems.status, status) : undefined,
    );
    const offset = (page - 1) * limit;
    const [totalRow, rows] = await Promise.all([
        db.select({ value: count() }).from(payoutItems).where(where).get(),
        db.select({
            id: payoutItems.id,
            batchId: payoutItems.batchId,
            vendorId: payoutItems.vendorId,
            vendorName: vendors.name,
            payoutMethodId: payoutItems.payoutMethodId,
            payoutMethod: vendorPayoutMethods.method,
            payoutMethodDisplayName: vendorPayoutMethods.displayName,
            payoutMethodLastFour: vendorPayoutMethods.lastFour,
            currency: payoutItems.currency,
            amountMinor: payoutItems.amountMinor,
            status: payoutItems.status,
            providerReference: payoutItems.providerReference,
            failureReason: payoutItems.failureReason,
            version: payoutItems.version,
            reservedAt: payoutItems.reservedAt,
            processingStartedAt: payoutItems.processingStartedAt,
            completedAt: payoutItems.completedAt,
            releasedAt: payoutItems.releasedAt,
            createdAt: payoutItems.createdAt,
            updatedAt: payoutItems.updatedAt,
        })
            .from(payoutItems)
            .innerJoin(vendors, eq(vendors.id, payoutItems.vendorId))
            .innerJoin(vendorPayoutMethods, eq(vendorPayoutMethods.id, payoutItems.payoutMethodId))
            .where(where)
            .orderBy(desc(payoutItems.createdAt))
            .limit(limit)
            .offset(offset),
    ]);
    const total = totalRow?.value ?? 0;
    return ok(c, {
        payouts: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    });
});

const payoutDetailRoute = createRoute({
    method: "get",
    path: "/payouts/{payoutItemId}",
    tags: ["Marketplace Finance"],
    summary: "Read one payout obligation and its append-only attempts",
    request: { params: z.object({ payoutItemId: z.string().min(1) }) },
    responses: {
        200: {
            description: "Payout detail",
            content: { "application/json": { schema: successEnvelope(z.object({
                payout: payoutItemRowSchema,
                batch: z.object({
                    id: z.string(),
                    status: z.string(),
                    itemCount: z.number().int().nonnegative(),
                    totalMinor: z.number().int().nonnegative(),
                    createdAt: timestampSchema,
                    completedAt: timestampSchema.nullable(),
                }),
                attempts: z.array(z.object({
                    id: z.string(),
                    attemptNumber: z.number().int().positive(),
                    provider: z.string(),
                    status: z.enum(["processing", "succeeded", "failed"]),
                    providerReference: z.string().nullable(),
                    errorMessage: z.string().nullable(),
                    startedAt: timestampSchema,
                    completedAt: timestampSchema.nullable(),
                })),
            })) } },
        },
        ...errorResponses,
    },
});

app.openapi(payoutDetailRoute, async (c) => {
    const db = c.get("db");
    const { payoutItemId } = c.req.valid("param");
    const payout = await db.select({
        id: payoutItems.id,
        batchId: payoutItems.batchId,
        vendorId: payoutItems.vendorId,
        vendorName: vendors.name,
        payoutMethodId: payoutItems.payoutMethodId,
        payoutMethod: vendorPayoutMethods.method,
        payoutMethodDisplayName: vendorPayoutMethods.displayName,
        payoutMethodLastFour: vendorPayoutMethods.lastFour,
        currency: payoutItems.currency,
        amountMinor: payoutItems.amountMinor,
        status: payoutItems.status,
        providerReference: payoutItems.providerReference,
        failureReason: payoutItems.failureReason,
        version: payoutItems.version,
        reservedAt: payoutItems.reservedAt,
        processingStartedAt: payoutItems.processingStartedAt,
        completedAt: payoutItems.completedAt,
        releasedAt: payoutItems.releasedAt,
        createdAt: payoutItems.createdAt,
        updatedAt: payoutItems.updatedAt,
    })
        .from(payoutItems)
        .innerJoin(vendors, eq(vendors.id, payoutItems.vendorId))
        .innerJoin(vendorPayoutMethods, eq(vendorPayoutMethods.id, payoutItems.payoutMethodId))
        .where(eq(payoutItems.id, payoutItemId))
        .get();
    if (!payout) {
        throw new Error(`Payout item ${payoutItemId} not found`);
    }
    const [batch, attempts] = await Promise.all([
        db.select({
            id: payoutBatches.id,
            status: payoutBatches.status,
            itemCount: payoutBatches.itemCount,
            totalMinor: payoutBatches.totalMinor,
            createdAt: payoutBatches.createdAt,
            completedAt: payoutBatches.completedAt,
        })
            .from(payoutBatches)
            .where(eq(payoutBatches.id, payout.batchId))
            .get(),
        db.select({
            id: payoutAttempts.id,
            attemptNumber: payoutAttempts.attemptNumber,
            provider: payoutAttempts.provider,
            status: payoutAttempts.status,
            providerReference: payoutAttempts.providerReference,
            errorMessage: payoutAttempts.errorMessage,
            startedAt: payoutAttempts.startedAt,
            completedAt: payoutAttempts.completedAt,
        })
            .from(payoutAttempts)
            .where(eq(payoutAttempts.payoutItemId, payoutItemId))
            .orderBy(desc(payoutAttempts.attemptNumber))
            .all(),
    ]);
    if (!batch) {
        throw new Error(`Payout batch ${payout.batchId} not found`);
    }
    return ok(c, { payout, batch, attempts });
});

export const adminMarketplaceFinanceRoutes = app;
