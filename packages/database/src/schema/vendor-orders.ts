// Marketplace seller fulfillment partitions. Financial authority lives on order_items and the future ledger.

import type { InferSelectModel } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { orders } from "./orders";
import { UNIX_NOW } from "./shared";
import { vendors } from "./vendors";

export const vendorOrders = sqliteTable("vendor_orders", {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    vendorId: text("vendor_id").notNull().references(() => vendors.id, { onDelete: "restrict" }),
    status: text("status", {
        enum: ["pending", "processing", "ready", "shipped", "delivered", "cancelled"],
    }).notNull().default("pending"),
    fulfillmentStatus: text("fulfillment_status", {
        enum: ["pending", "partial", "complete", "cancelled"],
    }).notNull().default("pending"),
    version: integer("version").notNull().default(1),
    notes: text("notes"),
    deliveredAt: integer("delivered_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(UNIX_NOW),
}, (table) => [
    unique("vendor_orders_order_vendor_unique").on(table.orderId, table.vendorId),
    index("vendor_orders_order_id_idx").on(table.orderId),
    index("vendor_orders_vendor_status_idx").on(table.vendorId, table.status),
    index("vendor_orders_fulfillment_status_idx").on(table.fulfillmentStatus),
    index("vendor_orders_created_at_idx").on(table.createdAt),
]);

export type VendorOrder = InferSelectModel<typeof vendorOrders>;
