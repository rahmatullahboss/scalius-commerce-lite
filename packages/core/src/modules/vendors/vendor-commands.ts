import { safeBatch, type Database } from "@scalius/database/client";
import {
    productModerationEvents,
    products,
    user,
    vendorAddresses,
    vendorCommissionRules,
    vendorModerationEvents,
    vendorPayoutMethods,
    vendorUsers,
    vendorVerificationDocuments,
    vendors,
} from "@scalius/database/schema";
import { and, eq, ne } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import {
    assertProductModerationTransition,
    assertVendorStatusTransition,
    type ProductModerationStatus,
    type VendorLifecycleStatus,
} from "./vendor-state-machine";

export interface VendorCommandDependencies {
    now: () => Date;
    id: () => string;
}

const defaultDependencies: VendorCommandDependencies = {
    now: () => new Date(),
    id: () => crypto.randomUUID(),
};

export interface CreateVendorCommandInput {
    name: string;
    slug: string;
    legalName?: string | null;
    status: VendorLifecycleStatus;
    ownerUserId?: string | null;
    commissionBps: number;
    contactEmail?: string | null;
    contactPhone?: string | null;
    businessAddress?: string | null;
    district?: string | null;
    upazila?: string | null;
    pickupAddress?: string | null;
}

export interface UpdateVendorCommandInput {
    name?: string;
    slug?: string;
    legalName?: string | null;
    status?: VendorLifecycleStatus;
    ownerUserId?: string | null;
    commissionBps?: number;
    contactEmail?: string | null;
    contactPhone?: string | null;
    businessAddress?: string | null;
    district?: string | null;
    upazila?: string | null;
    pickupAddress?: string | null;
}

export interface ModerationCommandInput<TStatus extends string> {
    status: TStatus;
    reason?: string | null;
    actorUserId?: string | null;
}

export type VendorPayoutMethodStatus = "pending" | "verified" | "rejected" | "disabled";
export type VendorVerificationStatus = "pending" | "approved" | "rejected" | "expired";

export interface ReviewVendorPayoutMethodInput {
    status: VendorPayoutMethodStatus;
    rejectionReason?: string | null;
    actorUserId?: string | null;
}

export interface ReviewVendorVerificationInput {
    status: VendorVerificationStatus;
    rejectionReason?: string | null;
    actorUserId?: string | null;
}

function emptyToNull(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeSlug(value: string): string {
    return value.trim().toLowerCase();
}

function assertCommissionBps(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 10_000) {
        throw new ValidationError("Commission basis points must be an integer between 0 and 10000");
    }
}

async function assertUserExists(db: Database, userId: string | null): Promise<void> {
    if (!userId) return;
    const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
    if (rows.length === 0) throw new ValidationError("Owner user not found");
}

async function readVendorOrThrow(db: Database, vendorId: string) {
    const rows = await db
        .select({ id: vendors.id, status: vendors.status })
        .from(vendors)
        .where(eq(vendors.id, vendorId))
        .limit(1);
    const vendor = rows[0];
    if (!vendor) throw new NotFoundError("Vendor not found");
    return vendor;
}

function addressInsertValues({
    id,
    vendorId,
    type,
    address,
    district,
    upazila,
    now,
}: {
    id: string;
    vendorId: string;
    type: "business" | "pickup";
    address: string | null;
    district: string | null;
    upazila: string | null;
    now: Date;
}) {
    if (!address) return null;
    return {
        id,
        vendorId,
        type,
        addressLine1: address,
        district,
        upazila,
        countryCode: "BD",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
    } satisfies typeof vendorAddresses.$inferInsert;
}

export async function createVendorCommand(
    db: Database,
    input: CreateVendorCommandInput,
    dependencies: VendorCommandDependencies = defaultDependencies,
): Promise<{ vendorId: string }> {
    assertCommissionBps(input.commissionBps);
    const slug = normalizeSlug(input.slug);
    const duplicate = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.slug, slug)).limit(1);
    if (duplicate.length > 0) throw new ConflictError("A vendor with this slug already exists");

    const ownerUserId = emptyToNull(input.ownerUserId);
    await assertUserExists(db, ownerUserId);

    const vendorId = dependencies.id();
    const now = dependencies.now();
    const writes: unknown[] = [db.insert(vendors).values({
        id: vendorId,
        name: input.name.trim(),
        slug,
        legalName: emptyToNull(input.legalName),
        status: input.status,
        contactEmail: emptyToNull(input.contactEmail),
        contactPhone: emptyToNull(input.contactPhone),
        createdAt: now,
        updatedAt: now,
    })];

    if (ownerUserId) {
        writes.push(db.insert(vendorUsers).values({
            id: dependencies.id(),
            vendorId,
            userId: ownerUserId,
            role: "owner",
            status: "active",
            invitedAt: now,
            acceptedAt: now,
            createdAt: now,
            updatedAt: now,
        }));
    }

    writes.push(db.insert(vendorCommissionRules).values({
        id: dependencies.id(),
        scope: "vendor",
        vendorId,
        rateBps: input.commissionBps,
        status: "active",
        priority: 100,
        effectiveFrom: now,
        createdAt: now,
        updatedAt: now,
    }));

    const businessAddress = addressInsertValues({
        id: dependencies.id(),
        vendorId,
        type: "business",
        address: emptyToNull(input.businessAddress),
        district: emptyToNull(input.district),
        upazila: emptyToNull(input.upazila),
        now,
    });
    const pickupAddress = addressInsertValues({
        id: dependencies.id(),
        vendorId,
        type: "pickup",
        address: emptyToNull(input.pickupAddress),
        district: emptyToNull(input.district),
        upazila: emptyToNull(input.upazila),
        now,
    });
    if (businessAddress) writes.push(db.insert(vendorAddresses).values(businessAddress));
    if (pickupAddress) writes.push(db.insert(vendorAddresses).values(pickupAddress));

    await safeBatch(db, writes as never[]);
    return { vendorId };
}

export async function updateVendorCommand(
    db: Database,
    vendorId: string,
    input: UpdateVendorCommandInput,
    dependencies: VendorCommandDependencies = defaultDependencies,
): Promise<void> {
    const existing = await readVendorOrThrow(db, vendorId);
    const now = dependencies.now();
    const updates: Partial<typeof vendors.$inferInsert> = { updatedAt: now };

    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.slug !== undefined) {
        const slug = normalizeSlug(input.slug);
        const duplicate = await db.select({ id: vendors.id }).from(vendors)
            .where(and(eq(vendors.slug, slug), ne(vendors.id, vendorId))).limit(1);
        if (duplicate.length > 0) throw new ConflictError("A vendor with this slug already exists");
        updates.slug = slug;
    }
    if (input.legalName !== undefined) updates.legalName = emptyToNull(input.legalName);
    if (input.status !== undefined) {
        assertVendorStatusTransition(existing.status as VendorLifecycleStatus, input.status);
        updates.status = input.status;
    }
    if (input.contactEmail !== undefined) updates.contactEmail = emptyToNull(input.contactEmail);
    if (input.contactPhone !== undefined) updates.contactPhone = emptyToNull(input.contactPhone);

    const writes: unknown[] = [db.update(vendors).set(updates).where(eq(vendors.id, vendorId))];

    if (input.ownerUserId !== undefined) {
        const nextOwnerId = emptyToNull(input.ownerUserId);
        if (!nextOwnerId) {
            throw new ValidationError("A vendor must always have one active owner");
        }
        await assertUserExists(db, nextOwnerId);
        const membership = await db.select({ id: vendorUsers.id }).from(vendorUsers)
            .where(and(eq(vendorUsers.vendorId, vendorId), eq(vendorUsers.userId, nextOwnerId))).limit(1);

        writes.push(db.update(vendorUsers).set({
            status: "revoked",
            revokedAt: now,
            updatedAt: now,
        }).where(and(
            eq(vendorUsers.vendorId, vendorId),
            eq(vendorUsers.role, "owner"),
            eq(vendorUsers.status, "active"),
        )));

        if (membership[0]) {
            writes.push(db.update(vendorUsers).set({
                role: "owner",
                status: "active",
                acceptedAt: now,
                revokedAt: null,
                updatedAt: now,
            }).where(eq(vendorUsers.id, membership[0].id)));
        } else {
            writes.push(db.insert(vendorUsers).values({
                id: dependencies.id(),
                vendorId,
                userId: nextOwnerId,
                role: "owner",
                status: "active",
                invitedAt: now,
                acceptedAt: now,
                createdAt: now,
                updatedAt: now,
            }));
        }
    }

    if (input.commissionBps !== undefined) {
        assertCommissionBps(input.commissionBps);
        writes.push(db.update(vendorCommissionRules).set({
            status: "retired",
            effectiveTo: now,
            updatedAt: now,
        }).where(and(
            eq(vendorCommissionRules.vendorId, vendorId),
            eq(vendorCommissionRules.status, "active"),
        )));
        writes.push(db.insert(vendorCommissionRules).values({
            id: dependencies.id(),
            scope: "vendor",
            vendorId,
            rateBps: input.commissionBps,
            status: "active",
            priority: 100,
            effectiveFrom: now,
            createdAt: now,
            updatedAt: now,
        }));
    }

    await safeBatch(db, writes as never[]);
}

export async function moderateVendorCommand(
    db: Database,
    vendorId: string,
    input: ModerationCommandInput<VendorLifecycleStatus>,
    dependencies: VendorCommandDependencies = defaultDependencies,
): Promise<void> {
    const existing = await readVendorOrThrow(db, vendorId);
    const fromStatus = existing.status as VendorLifecycleStatus;
    assertVendorStatusTransition(fromStatus, input.status);
    if (fromStatus === input.status) return;

    const now = dependencies.now();
    await safeBatch(db, [
        db.update(vendors).set({ status: input.status, updatedAt: now }).where(eq(vendors.id, vendorId)),
        db.insert(vendorModerationEvents).values({
            id: dependencies.id(),
            vendorId,
            fromStatus,
            toStatus: input.status,
            reason: emptyToNull(input.reason),
            actorUserId: input.actorUserId ?? null,
            createdAt: now,
        }),
    ]);
}

export async function moderateProductCommand(
    db: Database,
    productId: string,
    input: ModerationCommandInput<ProductModerationStatus>,
    dependencies: VendorCommandDependencies = defaultDependencies,
): Promise<{ moderationVersion: number }> {
    const rows = await db.select({
        id: products.id,
        vendorId: products.vendorId,
        approvalStatus: products.approvalStatus,
        moderationVersion: products.moderationVersion,
    }).from(products).where(eq(products.id, productId)).limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError("Product not found");
    if (!existing.vendorId) throw new ValidationError("Product seller ownership is required before moderation");

    const fromStatus = existing.approvalStatus as ProductModerationStatus;
    assertProductModerationTransition(fromStatus, input.status);
    if (fromStatus === input.status) return { moderationVersion: existing.moderationVersion };

    const moderationVersion = existing.moderationVersion + 1;
    const now = dependencies.now();
    await safeBatch(db, [
        db.update(products).set({
            approvalStatus: input.status,
            moderationVersion,
            updatedAt: now,
        }).where(eq(products.id, productId)),
        db.insert(productModerationEvents).values({
            id: dependencies.id(),
            productId,
            vendorId: existing.vendorId,
            fromStatus,
            toStatus: input.status,
            reason: emptyToNull(input.reason),
            actorUserId: input.actorUserId ?? null,
            moderationVersion,
            metadata: null,
            createdAt: now,
        }),
    ]);

    return { moderationVersion };
}

export async function reviewVendorPayoutMethodCommand(
    db: Database,
    vendorId: string,
    payoutMethodId: string,
    input: ReviewVendorPayoutMethodInput,
    dependencies: VendorCommandDependencies = defaultDependencies,
): Promise<void> {
    const rows = await db.select({ id: vendorPayoutMethods.id }).from(vendorPayoutMethods)
        .where(and(
            eq(vendorPayoutMethods.id, payoutMethodId),
            eq(vendorPayoutMethods.vendorId, vendorId),
        )).limit(1);
    if (!rows[0]) throw new NotFoundError("Vendor payout method not found");

    const now = dependencies.now();
    await db.update(vendorPayoutMethods).set({
        status: input.status,
        verifiedBy: input.status === "verified" ? input.actorUserId ?? null : null,
        verifiedAt: input.status === "verified" ? now : null,
        rejectionReason: input.status === "rejected" ? emptyToNull(input.rejectionReason) : null,
        updatedAt: now,
    }).where(eq(vendorPayoutMethods.id, payoutMethodId));
}

export async function reviewVendorVerificationCommand(
    db: Database,
    vendorId: string,
    documentId: string,
    input: ReviewVendorVerificationInput,
    dependencies: VendorCommandDependencies = defaultDependencies,
): Promise<void> {
    const rows = await db.select({ id: vendorVerificationDocuments.id }).from(vendorVerificationDocuments)
        .where(and(
            eq(vendorVerificationDocuments.id, documentId),
            eq(vendorVerificationDocuments.vendorId, vendorId),
        )).limit(1);
    if (!rows[0]) throw new NotFoundError("Vendor verification document not found");

    const now = dependencies.now();
    await db.update(vendorVerificationDocuments).set({
        status: input.status,
        reviewedBy: input.actorUserId ?? null,
        reviewedAt: now,
        rejectionReason: input.status === "rejected" ? emptyToNull(input.rejectionReason) : null,
        updatedAt: now,
    }).where(eq(vendorVerificationDocuments.id, documentId));
}
