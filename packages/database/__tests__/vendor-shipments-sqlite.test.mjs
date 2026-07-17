import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../migrations/0065_vendor_shipments.sql", import.meta.url),
);
const migrationSql = readFileSync(migrationPath, "utf8").replaceAll(
  "--> statement-breakpoint",
  "",
);

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE "user" (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE vendors (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE orders (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE delivery_providers (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE vendor_orders (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT NOT NULL,
      vendor_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      fulfillment_status TEXT NOT NULL DEFAULT 'pending',
      version INTEGER NOT NULL DEFAULT 1,
      delivered_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE order_items (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT NOT NULL,
      vendor_order_id TEXT,
      vendor_id_snapshot TEXT,
      quantity INTEGER NOT NULL
    );
  `);
  db.exec(migrationSql);
  db.exec(`
    INSERT INTO "user" (id) VALUES ('user_1');
    INSERT INTO vendors (id) VALUES ('vendor_1'), ('vendor_2');
    INSERT INTO orders (id) VALUES ('order_1'), ('order_2');
    INSERT INTO vendor_orders (
      id, order_id, vendor_id, status, fulfillment_status, version, updated_at
    ) VALUES
      ('vendor_order_1', 'order_1', 'vendor_1', 'pending', 'pending', 1, 1),
      ('vendor_order_2', 'order_2', 'vendor_2', 'pending', 'pending', 1, 1);
    INSERT INTO order_items (
      id, order_id, vendor_order_id, vendor_id_snapshot, quantity
    ) VALUES
      ('item_1', 'order_1', 'vendor_order_1', 'vendor_1', 2),
      ('item_2', 'order_1', 'vendor_order_1', 'vendor_1', 1),
      ('item_other_vendor', 'order_2', 'vendor_order_2', 'vendor_2', 1);
  `);
  return db;
}

function insertShipment(db, {
  id,
  key,
  vendorOrderId = "vendor_order_1",
  orderId = "order_1",
  vendorId = "vendor_1",
} = {}) {
  db.prepare(`
    INSERT INTO vendor_shipments (
      id, idempotency_key, vendor_order_id, order_id, vendor_id,
      provider_type, status, shipment_amount_minor, version
    ) VALUES (?, ?, ?, ?, ?, 'manual', 'pending', 0, 1)
  `).run(id, key, vendorOrderId, orderId, vendorId);
}

function moveToDelivered(db, shipmentId) {
  db.prepare("UPDATE vendor_shipments SET status='processing', version=version+1 WHERE id=?").run(shipmentId);
  db.prepare("UPDATE vendor_shipments SET status='in_transit', version=version+1 WHERE id=?").run(shipmentId);
  db.prepare("UPDATE vendor_shipments SET status='delivered', delivered_at=unixepoch(), version=version+1 WHERE id=?").run(shipmentId);
}

describe("seller shipment migration behavior", () => {
  it("enforces shipment identity and idempotency", () => {
    const db = createDatabase();
    insertShipment(db, { id: "shipment_1", key: "shipment-key-1" });

    expect(() =>
      insertShipment(db, { id: "shipment_dup", key: "shipment-key-1" }),
    ).toThrow(/unique constraint failed/i);
    expect(() =>
      insertShipment(db, {
        id: "shipment_wrong",
        key: "shipment-key-wrong",
        vendorOrderId: "vendor_order_1",
        orderId: "order_2",
        vendorId: "vendor_1",
      }),
    ).toThrow(/shipment vendor\/order identity mismatch/i);

    db.close();
  });

  it("rejects cross-seller lines and cumulative over-shipment", () => {
    const db = createDatabase();
    insertShipment(db, { id: "shipment_1", key: "shipment-key-1" });
    db.exec(`
      INSERT INTO vendor_shipment_items (
        id, shipment_id, order_item_id, quantity
      ) VALUES ('shipment_item_1', 'shipment_1', 'item_1', 1);
    `);

    expect(() =>
      db.exec(`
        INSERT INTO vendor_shipment_items (
          id, shipment_id, order_item_id, quantity
        ) VALUES ('wrong_vendor_line', 'shipment_1', 'item_other_vendor', 1);
      `),
    ).toThrow(/shipment item does not belong to vendor order/i);

    insertShipment(db, { id: "shipment_2", key: "shipment-key-2" });
    expect(() =>
      db.exec(`
        INSERT INTO vendor_shipment_items (
          id, shipment_id, order_item_id, quantity
        ) VALUES ('over_line', 'shipment_2', 'item_1', 2);
      `),
    ).toThrow(/shipment quantity exceeds purchased quantity/i);

    db.close();
  });

  it("rejects invalid status transitions and stamps delivery only after all seller lines are delivered", () => {
    const db = createDatabase();
    insertShipment(db, { id: "shipment_1", key: "shipment-key-1" });
    db.exec(`
      INSERT INTO vendor_shipment_items (
        id, shipment_id, order_item_id, quantity
      ) VALUES
        ('shipment_1_item_1', 'shipment_1', 'item_1', 1),
        ('shipment_1_item_2', 'shipment_1', 'item_2', 1);
    `);

    expect(() =>
      db.exec("UPDATE vendor_shipments SET status='delivered' WHERE id='shipment_1'"),
    ).toThrow(/invalid vendor shipment status transition/i);

    moveToDelivered(db, "shipment_1");
    const partial = db.prepare(`
      SELECT status, fulfillment_status AS fulfillmentStatus, delivered_at AS deliveredAt
      FROM vendor_orders WHERE id='vendor_order_1'
    `).get();
    expect(partial).toMatchObject({
      status: "shipped",
      fulfillmentStatus: "partial",
      deliveredAt: null,
    });

    insertShipment(db, { id: "shipment_2", key: "shipment-key-2" });
    db.exec(`
      INSERT INTO vendor_shipment_items (
        id, shipment_id, order_item_id, quantity
      ) VALUES ('shipment_2_item_1', 'shipment_2', 'item_1', 1);
    `);
    moveToDelivered(db, "shipment_2");

    const complete = db.prepare(`
      SELECT status, fulfillment_status AS fulfillmentStatus, delivered_at AS deliveredAt
      FROM vendor_orders WHERE id='vendor_order_1'
    `).get();
    expect(complete.status).toBe("delivered");
    expect(complete.fulfillmentStatus).toBe("complete");
    expect(complete.deliveredAt).toEqual(expect.any(Number));

    db.close();
  });
});
