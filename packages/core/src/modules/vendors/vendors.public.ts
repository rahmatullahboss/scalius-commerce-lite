import type { Database } from "@scalius/database/client";
import { media, vendorProfiles, vendors } from "@scalius/database/schema";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
    getStorefrontProducts,
} from "../products/products.storefront";
import type { StorefrontProductFilterInput } from "../products/products.types";

export interface PublicVendorState {
    status: string;
    deletedAt: Date | number | string | null;
}

export function isPublicVendorState(state: PublicVendorState): boolean {
    return state.status === "approved" && state.deletedAt == null;
}

async function getPublishedVendorProfile(
    db: Database,
    vendor: { id: string; contactEmail: string | null; contactPhone: string | null },
) {
    const profile = await db
        .select({
            description: vendorProfiles.description,
            logoMediaId: vendorProfiles.logoMediaId,
            bannerMediaId: vendorProfiles.bannerMediaId,
            showContactEmail: vendorProfiles.showContactEmail,
            showContactPhone: vendorProfiles.showContactPhone,
            seoTitle: vendorProfiles.seoTitle,
            seoDescription: vendorProfiles.seoDescription,
            returnPolicy: vendorProfiles.returnPolicy,
            supportHours: vendorProfiles.supportHours,
        })
        .from(vendorProfiles)
        .where(and(
            eq(vendorProfiles.vendorId, vendor.id),
            eq(vendorProfiles.publicationStatus, "published"),
        ))
        .get();
    if (!profile) return null;

    const mediaIds = [...new Set([
        profile.logoMediaId,
        profile.bannerMediaId,
    ].filter((value): value is string => Boolean(value)))];
    const mediaRows = mediaIds.length > 0
        ? await db
            .select({ id: media.id, url: media.url, altText: media.altText })
            .from(media)
            .where(and(inArray(media.id, mediaIds), isNull(media.deletedAt)))
            .all()
        : [];
    const mediaById = new Map(mediaRows.map((item) => [item.id, item]));

    return {
        description: profile.description,
        logoUrl: profile.logoMediaId ? mediaById.get(profile.logoMediaId)?.url ?? null : null,
        logoAlt: profile.logoMediaId ? mediaById.get(profile.logoMediaId)?.altText ?? null : null,
        bannerUrl: profile.bannerMediaId ? mediaById.get(profile.bannerMediaId)?.url ?? null : null,
        bannerAlt: profile.bannerMediaId ? mediaById.get(profile.bannerMediaId)?.altText ?? null : null,
        publicEmail: profile.showContactEmail ? vendor.contactEmail : null,
        publicPhone: profile.showContactPhone ? vendor.contactPhone : null,
        seoTitle: profile.seoTitle,
        seoDescription: profile.seoDescription,
        returnPolicy: profile.returnPolicy,
        supportHours: profile.supportHours,
    };
}

export async function listPublicVendors(
    db: Database,
    input: { page?: number; limit?: number } = {},
) {
    const page = Math.max(1, Math.trunc(input.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 20)));
    const offset = (page - 1) * limit;
    const publicCondition = and(
        eq(vendors.status, "approved"),
        isNull(vendors.deletedAt),
    );
    const [totalRow, rows] = await Promise.all([
        db.select({ count: count() })
            .from(vendors)
            .where(publicCondition)
            .get(),
        db.select({
            id: vendors.id,
            name: vendors.name,
            slug: vendors.slug,
            updatedAt: vendors.updatedAt,
        })
            .from(vendors)
            .where(publicCondition)
            .orderBy(desc(vendors.updatedAt), vendors.name)
            .limit(limit)
            .offset(offset)
            .all(),
    ]);
    const total = totalRow?.count ?? 0;
    return {
        vendors: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

export async function getPublicVendorCatalog(
    db: Database,
    slug: string,
    filters: Omit<StorefrontProductFilterInput, "vendorId">,
) {
    const vendor = await db
        .select({
            id: vendors.id,
            name: vendors.name,
            slug: vendors.slug,
            contactEmail: vendors.contactEmail,
            contactPhone: vendors.contactPhone,
            createdAt: vendors.createdAt,
        })
        .from(vendors)
        .where(and(
            eq(vendors.slug, slug),
            eq(vendors.status, "approved"),
            isNull(vendors.deletedAt),
        ))
        .get();
    if (!vendor) return null;

    const [profile, catalog] = await Promise.all([
        getPublishedVendorProfile(db, vendor),
        getStorefrontProducts(db, {
            ...filters,
            vendorId: vendor.id,
        }),
    ]);
    return {
        vendor: {
            id: vendor.id,
            name: vendor.name,
            slug: vendor.slug,
            createdAt: vendor.createdAt,
        },
        profile,
        ...catalog,
    };
}
