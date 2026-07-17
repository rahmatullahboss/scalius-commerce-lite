import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("canonical marketplace order allocation boundaries", () => {
  it("keeps vendor_orders fulfillment-only", () => {
    const schema = read("packages/database/src/schema/vendor-orders.ts");

    expect(schema).toContain("export const vendorOrders");
    expect(schema).toContain('integer("version")');
    expect(schema).not.toContain("vendorOrderItems");
    expect(schema).not.toContain('real("subtotal_amount")');
    expect(schema).not.toContain("commissionAmount");
    expect(schema).not.toContain("vendorNetAmount");
    expect(schema).not.toContain("payoutStatus");
  });

  it("stores immutable seller and minor-unit snapshots on order_items", () => {
    const schema = read("packages/database/src/schema/orders.ts");

    for (const column of [
      'text("vendor_order_id")',
      'text("vendor_id_snapshot")',
      'text("vendor_name_snapshot")',
      'text("currency")',
      'integer("unit_price_minor")',
      'integer("line_subtotal_minor")',
      'integer("discount_minor")',
      'text("commission_rule_id")',
      'integer("commission_bps")',
      'integer("commission_minor")',
      'integer("vendor_net_minor")',
    ]) {
      expect(schema).toContain(column);
    }
  });

  it("does not create a duplicate vendor_order_items table", () => {
    const migration = read("packages/database/migrations/0059_vendor_order_split_foundation.sql");

    expect(migration).toContain("CREATE TABLE `vendor_orders`");
    expect(migration).toContain("vendor_id_snapshot");
    expect(migration).toContain("unit_price_minor");
    expect(migration).toContain("order_items_validate_vendor_order_before_insert");
    expect(migration).not.toContain("CREATE TABLE `vendor_order_items`");
    expect(migration).not.toContain("vendor_net_amount");
    expect(migration).not.toContain("payout_status");
  });
});
