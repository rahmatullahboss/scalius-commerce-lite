// Seller-scoped marketplace shipment records. Legacy parent-order shipments remain in delivery.ts.

import { sql, type InferSelectModel } from "drizzle-orm";
import {
    check,
    index,
    integer,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { deliveryProviders } from "./delivery";
import { orderItems, orders } from "./orders";
import { UNIX_NOW } from "./shared";
import { vendorOrders } from "./vendor-orders";
import { vendors } from "./vendors";

export const vendorShipmentStatuses = [
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
] as const;

export type VendorShipmentStatus = (typeof vendorShipmentStatuses)[number];
export type VendorShipmentMetadata = Record<string, unknown>;

export const vendorShipments = sqliteTable("vendor_shipments", {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    vendorOrderId: text("vendor_order_id").notNull().references(
        () => vendorOrders.id,
        { onDelete: "restrict" },
    ),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "restrict" }),
    providerId: text("provider_id").references(() => deliveryProviders.id, { onDelete: "set null" }),
    providerType: text("provider_type").notNull().default("manual"),
    externalId: text("external_id"),
    trackingId: text("tracking_id"),
    trackingUrl: text("tracking_url"),
    courierName: text("courier_name"),
    status: text("status", { enum: vendorShipmentStatuses }).notNull().default("pending"),
    rawStatus: text("raw_status"),
    note: text("note"),
    metadata: text("metadata", { mode: "json" }).$type<VendorShipmentMetadata>(),
    shipmentAmountMinor: integer("shipment_amount_minor").notNull().default(0),
    isFinalShipment: integer("is_final_shipment", { mode: "boolean" }).notNull().default(false),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
    pickedUpAt: integer("picked_up_at", { mode: "timestamp" }),
    deliveredAt: integer("delivered_at", { mode: "timestamp" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    uniqueIndex("vendor_shipments_idempotency_uq").on(table.idempotencyKey),
    index("vendor_shipments_vendor_order_idx").on(table.vendorOrderId, table.createdAt),
    index("vendor_shipments_vendor_status_idx").on(table.vendorId, table.status, table.createdAt),
    index("vendor_shipments_order_idx").on(table.orderId, table.createdAt),
    index("vendor_shipments_provider_status_idx").on(table.providerId, table.status),
    uniqueIndex("vendor_shipments_provider_external_uq").on(table.providerId, table.externalId),
    check("vendor_shipments_amount_non_negative_ck", sql`${table.shipmentAmountMinor} >= 0`),
    check("vendor_shipments_version_positive_ck", sql`${table.version} > 0`),
]);

export const vendorShipmentItems = sqliteTable("vendor_shipment_items", {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id").notNull().references(
        () => vendorShipments.id,
        { onDelete: "restrict" },
    ),
    orderItemId: text("order_item_id").notNull().references(
        () => orderItems.id,
        { onDelete: "restrict" },
    ),
    quantity: integer("quantity").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    uniqueIndex("vendor_shipment_items_shipment_order_item_uq").on(
        table.shipmentId,
        table.orderItemId,
    ),
    index("vendor_shipment_items_order_item_idx").on(table.orderItemId),
    check("vendor_shipment_items_quantity_positive_ck", sql`${table.quantity} > 0`),
]);

export type VendorShipment = InferSelectModel<typeof vendorShipments>;
export type VendorShipmentItem = InferSelectModel<typeof vendorShipmentItems>;
