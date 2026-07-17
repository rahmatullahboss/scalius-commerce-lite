// Marketplace seller identity, membership, compliance, payout, and commission policy.

import { sql, type InferSelectModel } from "drizzle-orm";
import {
    check,
    index,
    integer,
    sqliteTable,
    text,
    unique,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { UNIX_NOW } from "./shared";

export const PLATFORM_VENDOR_ID = "vendor_platform" as const;

export const vendors = sqliteTable("vendors", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    legalName: text("legal_name"),
    status: text("status", {
        enum: ["pending", "approved", "rejected", "suspended", "closed"],
    }).notNull().default("pending"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    settlementHoldDays: integer("settlement_hold_days").notNull().default(7),
    minimumPayoutMinor: integer("minimum_payout_minor").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
}, (table) => [
    uniqueIndex("vendors_slug_idx").on(table.slug),
    index("vendors_status_idx").on(table.status),
    index("vendors_deleted_at_idx").on(table.deletedAt),
]);

export const vendorUsers = sqliteTable("vendor_users", {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    role: text("role", {
        enum: ["owner", "admin", "catalog", "fulfillment", "finance", "viewer"],
    }).notNull().default("viewer"),
    status: text("status", {
        enum: ["invited", "active", "suspended", "revoked"],
    }).notNull().default("invited"),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    invitedAt: integer("invited_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    unique("vendor_users_vendor_user_unique").on(table.vendorId, table.userId),
    uniqueIndex("vendor_users_one_active_owner_per_user_idx")
        .on(table.userId)
        .where(sql`${table.role} = 'owner' AND ${table.status} = 'active'`),
    index("vendor_users_vendor_status_idx").on(table.vendorId, table.status),
    index("vendor_users_user_status_idx").on(table.userId, table.status),
    index("vendor_users_invited_by_idx").on(table.invitedBy),
    // Migration 0058 adds a partial unique index for one active owner per vendor.
]);

export const vendorMembershipInvites = sqliteTable("vendor_membership_invites", {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "restrict" }),
    inviteeEmail: text("invitee_email").notNull(),
    role: text("role", {
        enum: ["admin", "catalog", "fulfillment", "finance", "viewer"],
    }).notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status", {
        enum: ["pending", "accepted", "revoked", "expired"],
    }).notNull().default("pending"),
    invitedBy: text("invited_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "set null" }),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    uniqueIndex("vendor_membership_invites_token_hash_uq").on(table.tokenHash),
    uniqueIndex("vendor_membership_invites_pending_email_uq")
        .on(table.vendorId, table.inviteeEmail)
        .where(sql`${table.status} = 'pending'`),
    index("vendor_membership_invites_vendor_status_idx").on(table.vendorId, table.status, table.expiresAt),
    index("vendor_membership_invites_email_status_idx").on(table.inviteeEmail, table.status, table.expiresAt),
    index("vendor_membership_invites_invited_by_idx").on(table.invitedBy),
    check("vendor_membership_invites_email_normalized_ck", sql`${table.inviteeEmail} = lower(trim(${table.inviteeEmail}))`),
]);

export const vendorAddresses = sqliteTable("vendor_addresses", {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "restrict" }),
    type: text("type", { enum: ["business", "pickup", "return"] }).notNull(),
    label: text("label"),
    recipientName: text("recipient_name"),
    phone: text("phone"),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2"),
    district: text("district"),
    upazila: text("upazila"),
    postalCode: text("postal_code"),
    countryCode: text("country_code").notNull().default("BD"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
}, (table) => [
    index("vendor_addresses_vendor_type_idx").on(table.vendorId, table.type, table.deletedAt),
    index("vendor_addresses_default_idx").on(table.vendorId, table.type, table.isDefault, table.deletedAt),
]);

export const vendorPayoutMethods = sqliteTable("vendor_payout_methods", {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "restrict" }),
    method: text("method", { enum: ["bank", "bkash", "nagad", "rocket", "manual"] }).notNull(),
    displayName: text("display_name").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    fingerprint: text("fingerprint").notNull(),
    lastFour: text("last_four"),
    providerName: text("provider_name"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    status: text("status", {
        enum: ["pending", "verified", "rejected", "disabled"],
    }).notNull().default("pending"),
    verifiedBy: text("verified_by").references(() => user.id, { onDelete: "set null" }),
    verifiedAt: integer("verified_at", { mode: "timestamp" }),
    rejectionReason: text("rejection_reason"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
}, (table) => [
    unique("vendor_payout_methods_vendor_fingerprint_unique").on(table.vendorId, table.fingerprint),
    index("vendor_payout_methods_vendor_status_idx").on(table.vendorId, table.status, table.deletedAt),
    index("vendor_payout_methods_default_idx").on(table.vendorId, table.isDefault, table.deletedAt),
    index("vendor_payout_methods_verified_by_idx").on(table.verifiedBy),
]);

export const vendorVerificationDocuments = sqliteTable("vendor_verification_documents", {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "restrict" }),
    type: text("type", {
        enum: ["identity", "trade_license", "tax", "bank_document", "other"],
    }).notNull(),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    checksumSha256: text("checksum_sha256"),
    status: text("status", {
        enum: ["pending", "approved", "rejected", "expired"],
    }).notNull().default("pending"),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    rejectionReason: text("rejection_reason"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
}, (table) => [
    index("vendor_verification_documents_vendor_status_idx").on(table.vendorId, table.status, table.deletedAt),
    index("vendor_verification_documents_reviewed_by_idx").on(table.reviewedBy),
]);

export const vendorModerationEvents = sqliteTable("vendor_moderation_events", {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "restrict" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown> | null>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    index("vendor_moderation_events_vendor_created_idx").on(table.vendorId, table.createdAt),
    index("vendor_moderation_events_actor_idx").on(table.actorUserId),
]);

export const vendorCommissionRules = sqliteTable("vendor_commission_rules", {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["platform", "vendor"] }).notNull(),
    vendorId: text("vendor_id").references(() => vendors.id, { onDelete: "restrict" }),
    rateBps: integer("rate_bps").notNull(),
    status: text("status", { enum: ["draft", "active", "retired"] }).notNull().default("draft"),
    priority: integer("priority").notNull().default(0),
    effectiveFrom: integer("effective_from", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    effectiveTo: integer("effective_to", { mode: "timestamp" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    index("vendor_commission_rules_resolution_idx").on(
        table.vendorId,
        table.status,
        table.effectiveFrom,
        table.effectiveTo,
        table.priority,
    ),
    index("vendor_commission_rules_created_by_idx").on(table.createdBy),
]);

export type Vendor = InferSelectModel<typeof vendors>;
export type VendorUser = InferSelectModel<typeof vendorUsers>;
export type VendorMembershipInvite = InferSelectModel<typeof vendorMembershipInvites>;
export type VendorAddress = InferSelectModel<typeof vendorAddresses>;
export type VendorPayoutMethod = InferSelectModel<typeof vendorPayoutMethods>;
export type VendorVerificationDocument = InferSelectModel<typeof vendorVerificationDocuments>;
export type VendorModerationEvent = InferSelectModel<typeof vendorModerationEvents>;
export type VendorCommissionRule = InferSelectModel<typeof vendorCommissionRules>;
