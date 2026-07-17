// packages/core/src/auth/vendor-context.ts
// Marketplace vendor context helpers for vendor-scoped admin/API access.

import { and, eq } from "drizzle-orm";
import type { Database } from "@scalius/database/client";
import { vendors, vendorUsers } from "@scalius/database/schema";

export type VendorMembershipRole = "owner" | "admin" | "catalog" | "fulfillment" | "finance" | "viewer";
export type VendorMembershipStatus = "invited" | "active" | "suspended" | "revoked";
export type VendorStatus = "pending" | "approved" | "rejected" | "suspended" | "closed";
export type VendorCapability =
    | "dashboard.read"
    | "catalog.read"
    | "catalog.write"
    | "orders.read"
    | "orders.write"
    | "finance.read"
    | "payout.manage"
    | "members.manage"
    | "profile.manage";

const VENDOR_ROLE_CAPABILITIES: Record<VendorMembershipRole, ReadonlySet<VendorCapability>> = {
    owner: new Set([
        "dashboard.read",
        "catalog.read",
        "catalog.write",
        "orders.read",
        "orders.write",
        "finance.read",
        "payout.manage",
        "members.manage",
        "profile.manage",
    ]),
    admin: new Set([
        "dashboard.read",
        "catalog.read",
        "catalog.write",
        "orders.read",
        "orders.write",
        "finance.read",
        "payout.manage",
        "members.manage",
        "profile.manage",
    ]),
    catalog: new Set(["dashboard.read", "catalog.read", "catalog.write"]),
    fulfillment: new Set(["dashboard.read", "orders.read", "orders.write"]),
    finance: new Set(["dashboard.read", "finance.read", "payout.manage"]),
    viewer: new Set(["dashboard.read", "catalog.read", "orders.read", "finance.read"]),
};

export interface VendorMembershipContext {
    membershipId: string;
    vendorId: string;
    userId: string;
    role: VendorMembershipRole;
    membershipStatus: VendorMembershipStatus;
    vendorStatus: VendorStatus;
    vendorName: string;
    vendorSlug: string;
}

export interface VendorContextOptions {
    includeSuspendedMemberships?: boolean;
    includeUnapprovedVendors?: boolean;
}

export function hasVendorCapability(
    context: Pick<VendorMembershipContext, "role" | "membershipStatus" | "vendorStatus">,
    capability: VendorCapability,
): boolean {
    return context.membershipStatus === "active" &&
        context.vendorStatus === "approved" &&
        VENDOR_ROLE_CAPABILITIES[context.role].has(capability);
}

function includeMembershipStatus(options?: VendorContextOptions): VendorMembershipStatus[] {
    return options?.includeSuspendedMemberships
        ? ["active", "suspended"]
        : ["active"];
}

function includeVendorStatus(options?: VendorContextOptions): VendorStatus[] {
    return options?.includeUnapprovedVendors
        ? ["pending", "approved", "rejected", "suspended"]
        : ["approved"];
}

function isAllowedMembershipStatus(
    status: VendorMembershipStatus,
    options?: VendorContextOptions,
): boolean {
    return includeMembershipStatus(options).includes(status);
}

function isAllowedVendorStatus(status: VendorStatus, options?: VendorContextOptions): boolean {
    return includeVendorStatus(options).includes(status);
}

export async function listUserVendorMemberships(
    db: Database,
    userId: string,
    options?: VendorContextOptions,
): Promise<VendorMembershipContext[]> {
    const rows = await db
        .select({
            membershipId: vendorUsers.id,
            vendorId: vendorUsers.vendorId,
            userId: vendorUsers.userId,
            role: vendorUsers.role,
            membershipStatus: vendorUsers.status,
            vendorStatus: vendors.status,
            vendorName: vendors.name,
            vendorSlug: vendors.slug,
        })
        .from(vendorUsers)
        .innerJoin(vendors, eq(vendorUsers.vendorId, vendors.id))
        .where(eq(vendorUsers.userId, userId));

    return rows.filter((row) =>
        isAllowedMembershipStatus(row.membershipStatus, options) &&
        isAllowedVendorStatus(row.vendorStatus, options)
    );
}

export async function resolveUserVendorContext(
    db: Database,
    userId: string,
    requestedVendorId?: string | null,
    options?: VendorContextOptions,
): Promise<VendorMembershipContext | null> {
    const memberships = await listUserVendorMemberships(db, userId, options);

    if (requestedVendorId) {
        return memberships.find((membership) => membership.vendorId === requestedVendorId) ?? null;
    }

    return memberships[0] ?? null;
}

export async function hasVendorAccess(
    db: Database,
    userId: string,
    vendorId: string,
    options?: VendorContextOptions,
): Promise<boolean> {
    const rows = await db
        .select({
            membershipStatus: vendorUsers.status,
            vendorStatus: vendors.status,
        })
        .from(vendorUsers)
        .innerJoin(vendors, eq(vendorUsers.vendorId, vendors.id))
        .where(and(
            eq(vendorUsers.userId, userId),
            eq(vendorUsers.vendorId, vendorId),
        ))
        .limit(1);

    const membership = rows[0];
    if (!membership) return false;

    return isAllowedMembershipStatus(membership.membershipStatus, options) &&
        isAllowedVendorStatus(membership.vendorStatus, options);
}
