import { safeBatch, type Database } from "@scalius/database/client";
import { media, vendorProfiles, vendors } from "@scalius/database/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
    hasVendorCapability,
    type VendorMembershipContext,
} from "../../auth/vendor-context";
import { NotFoundError, ValidationError } from "../../errors";

export interface VendorProfileDependencies {
    now: () => Date;
}

const defaultDependencies: VendorProfileDependencies = {
    now: () => new Date(),
};

export interface VendorProfileInput {
    description: string | null;
    logoMediaId: string | null;
    bannerMediaId: string | null;
    showContactEmail: boolean;
    showContactPhone: boolean;
    seoTitle: string | null;
    seoDescription: string | null;
    returnPolicy: string | null;
    supportHours: string | null;
    publicationStatus: "draft" | "published";
}

export interface VendorProfilePayload extends VendorProfileInput {
    vendorId: string;
    contactEmail: string | null;
    contactPhone: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}

function assertCanManageProfile(context: VendorMembershipContext): void {
    if (!hasVendorCapability(context, "profile.manage")) {
        throw new ValidationError("Active approved seller profile-management access is required");
    }
}

function normalizeNullable(value: string | null, maxLength: number, label: string): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > maxLength) {
        throw new ValidationError(`${label} must be ${maxLength} characters or fewer`);
    }
    return normalized;
}

function normalizeMediaId(value: string | null, label: string): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > 160) throw new ValidationError(`${label} media ID is invalid`);
    return normalized;
}

function normalizeInput(input: VendorProfileInput): VendorProfileInput {
    if (input.publicationStatus !== "draft" && input.publicationStatus !== "published") {
        throw new ValidationError("Unsupported seller profile publication status");
    }
    return {
        description: normalizeNullable(input.description, 5000, "Seller description"),
        logoMediaId: normalizeMediaId(input.logoMediaId, "Logo"),
        bannerMediaId: normalizeMediaId(input.bannerMediaId, "Banner"),
        showContactEmail: Boolean(input.showContactEmail),
        showContactPhone: Boolean(input.showContactPhone),
        seoTitle: normalizeNullable(input.seoTitle, 160, "SEO title"),
        seoDescription: normalizeNullable(input.seoDescription, 320, "SEO description"),
        returnPolicy: normalizeNullable(input.returnPolicy, 5000, "Return policy"),
        supportHours: normalizeNullable(input.supportHours, 500, "Support hours"),
        publicationStatus: input.publicationStatus,
    };
}

export async function getVendorProfile(
    db: Database,
    context: VendorMembershipContext,
): Promise<VendorProfilePayload> {
    assertCanManageProfile(context);
    const rows = await db
        .select({
            vendorId: vendors.id,
            contactEmail: vendors.contactEmail,
            contactPhone: vendors.contactPhone,
            description: vendorProfiles.description,
            logoMediaId: vendorProfiles.logoMediaId,
            bannerMediaId: vendorProfiles.bannerMediaId,
            showContactEmail: vendorProfiles.showContactEmail,
            showContactPhone: vendorProfiles.showContactPhone,
            seoTitle: vendorProfiles.seoTitle,
            seoDescription: vendorProfiles.seoDescription,
            returnPolicy: vendorProfiles.returnPolicy,
            supportHours: vendorProfiles.supportHours,
            publicationStatus: vendorProfiles.publicationStatus,
            createdAt: vendorProfiles.createdAt,
            updatedAt: vendorProfiles.updatedAt,
        })
        .from(vendors)
        .leftJoin(vendorProfiles, eq(vendors.id, vendorProfiles.vendorId))
        .where(and(eq(vendors.id, context.vendorId), isNull(vendors.deletedAt)))
        .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError("Seller profile vendor not found");

    return {
        vendorId: row.vendorId,
        contactEmail: row.contactEmail,
        contactPhone: row.contactPhone,
        description: row.description ?? null,
        logoMediaId: row.logoMediaId ?? null,
        bannerMediaId: row.bannerMediaId ?? null,
        showContactEmail: row.showContactEmail ?? false,
        showContactPhone: row.showContactPhone ?? false,
        seoTitle: row.seoTitle ?? null,
        seoDescription: row.seoDescription ?? null,
        returnPolicy: row.returnPolicy ?? null,
        supportHours: row.supportHours ?? null,
        publicationStatus: row.publicationStatus ?? "draft",
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null,
    };
}

export async function upsertVendorProfile(
    db: Database,
    context: VendorMembershipContext,
    rawInput: VendorProfileInput,
    dependencies: VendorProfileDependencies = defaultDependencies,
): Promise<VendorProfilePayload> {
    assertCanManageProfile(context);
    const input = normalizeInput(rawInput);
    const vendorRows = await db
        .select({ contactEmail: vendors.contactEmail, contactPhone: vendors.contactPhone })
        .from(vendors)
        .where(and(eq(vendors.id, context.vendorId), isNull(vendors.deletedAt)))
        .limit(1);
    const vendor = vendorRows[0];
    if (!vendor) throw new NotFoundError("Seller profile vendor not found");

    const mediaIds = [...new Set([input.logoMediaId, input.bannerMediaId].filter((value): value is string => Boolean(value)))];
    if (mediaIds.length > 0) {
        const activeMedia = await db
            .select({ id: media.id })
            .from(media)
            .where(and(inArray(media.id, mediaIds), isNull(media.deletedAt)))
            .all();
        if (activeMedia.length !== mediaIds.length) {
            throw new ValidationError("Seller profile logo or banner media is unavailable");
        }
    }

    const existingRows = await db
        .select({
            vendorId: vendorProfiles.vendorId,
            createdAt: vendorProfiles.createdAt,
        })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.vendorId, context.vendorId))
        .limit(1);
    const now = dependencies.now();
    const values = { ...input, updatedAt: now };
    const statement = existingRows[0]
        ? db.update(vendorProfiles)
            .set(values)
            .where(eq(vendorProfiles.vendorId, context.vendorId))
        : db.insert(vendorProfiles).values({
            vendorId: context.vendorId,
            ...values,
            createdAt: now,
        });
    await safeBatch(db, [statement] as never[]);

    return {
        vendorId: context.vendorId,
        contactEmail: vendor.contactEmail,
        contactPhone: vendor.contactPhone,
        ...input,
        createdAt: existingRows[0]?.createdAt ?? now,
        updatedAt: now,
    };
}
