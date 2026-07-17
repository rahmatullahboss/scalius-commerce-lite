import type { InferSelectModel } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { media } from "./products";
import { UNIX_NOW } from "./shared";
import { vendors } from "./vendors";

export const vendorProfiles = sqliteTable("vendor_profiles", {
    vendorId: text("vendor_id")
        .primaryKey()
        .references(() => vendors.id, { onDelete: "restrict" }),
    description: text("description"),
    logoMediaId: text("logo_media_id").references(() => media.id, { onDelete: "set null" }),
    bannerMediaId: text("banner_media_id").references(() => media.id, { onDelete: "set null" }),
    showContactEmail: integer("show_contact_email", { mode: "boolean" }).notNull().default(false),
    showContactPhone: integer("show_contact_phone", { mode: "boolean" }).notNull().default(false),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    returnPolicy: text("return_policy"),
    supportHours: text("support_hours"),
    publicationStatus: text("publication_status", { enum: ["draft", "published"] }).notNull().default("draft"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    index("vendor_profiles_publication_idx").on(table.publicationStatus, table.updatedAt),
    index("vendor_profiles_logo_media_idx").on(table.logoMediaId),
    index("vendor_profiles_banner_media_idx").on(table.bannerMediaId),
]);

export type VendorProfile = InferSelectModel<typeof vendorProfiles>;
