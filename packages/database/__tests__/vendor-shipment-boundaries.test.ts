import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(
  new URL("../src/schema/marketplace-shipments.ts", import.meta.url),
);
const migrationPath = fileURLToPath(
  new URL("../migrations/0065_vendor_shipments.sql", import.meta.url),
);
const indexPath = fileURLToPath(new URL("../src/schema/index.ts", import.meta.url));

describe("seller-scoped shipment schema boundaries", () => {
  it("defines canonical shipment and normalized item tables", () => {
    const source = readFileSync(schemaPath, "utf8");
    expect(source).toContain('sqliteTable("vendor_shipments"');
    expect(source).toContain('sqliteTable("vendor_shipment_items"');
    expect(source).toContain('idempotencyKey: text("idempotency_key")');
    expect(source).toContain('vendorOrderId: text("vendor_order_id")');
    expect(source).toContain('orderItemId: text("order_item_id")');
    expect(source).toContain('shipmentAmountMinor: integer("shipment_amount_minor")');
    expect(source).not.toMatch(/\breal\(/i);
    expect(source).not.toContain("shipmentItems: text");
  });

  it("guards seller/order identity, line ownership, and cumulative quantity", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain("vendor_shipments_idempotency_uq");
    expect(migration).toContain("vendor_shipments_validate_identity");
    expect(migration).toContain("vendor_shipment_items_validate_insert");
    expect(migration).toContain("shipment vendor/order identity mismatch");
    expect(migration).toContain("shipment item does not belong to vendor order");
    expect(migration).toContain("shipment quantity exceeds purchased quantity");
    expect(migration).toContain("SUM(existing_item.quantity)");
  });

  it("enforces explicit status transitions and derives vendor-order delivery time", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain("vendor_shipments_validate_status_update");
    expect(migration).toContain("invalid vendor shipment status transition");
    expect(migration).toContain("vendor_shipments_mark_vendor_order_delivered");
    expect(migration).toContain("SET status = 'delivered'");
    expect(migration).toContain("delivered_at = COALESCE(delivered_at, unixepoch())");
    expect(migration).toContain("SUM(delivered_item.quantity)");
  });

  it("exports the canonical shipment schema", () => {
    expect(readFileSync(indexPath, "utf8")).toContain(
      'export * from "./marketplace-shipments"',
    );
  });
});
