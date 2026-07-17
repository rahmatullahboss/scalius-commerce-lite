import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../migrations/0060_marketplace_ledger_refunds.sql", import.meta.url),
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
    CREATE TABLE orders (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE order_payments (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE order_items (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE vendors (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE vendor_orders (id TEXT PRIMARY KEY NOT NULL);
  `);
  db.exec(migrationSql);
  return db;
}

function seedReferences(db) {
  db.exec(`
    INSERT INTO "user" (id) VALUES ('admin_1');
    INSERT INTO orders (id) VALUES ('order_1');
    INSERT INTO order_payments (id) VALUES ('payment_1');
    INSERT INTO order_items (id) VALUES ('item_1');
    INSERT INTO vendors (id) VALUES ('vendor_1');
    INSERT INTO vendor_orders (id) VALUES ('vendor_order_1');
  `);
}

describe("marketplace finance migration behavior", () => {
  it("accepts a balanced one-sided journal and rejects invalid entry sides", () => {
    const db = createDatabase();
    db.exec(`
      INSERT INTO marketplace_ledger_journals (
        id, idempotency_key, event_type, source_type, source_id, currency, occurred_at
      ) VALUES (
        'journal_1', 'payment:payment_1:capture', 'payment.captured', 'order_payment', 'payment_1', 'BDT', 1
      );
      INSERT INTO marketplace_ledger_entries (
        id, journal_id, account_code, debit_minor, credit_minor
      ) VALUES ('entry_1', 'journal_1', 'cash_clearing', 100, 0);
      INSERT INTO marketplace_ledger_entries (
        id, journal_id, account_code, debit_minor, credit_minor
      ) VALUES ('entry_2', 'journal_1', 'vendor_pending_payable', 0, 100);
    `);

    const totals = db
      .prepare(
        "SELECT SUM(debit_minor) AS debitTotal, SUM(credit_minor) AS creditTotal FROM marketplace_ledger_entries WHERE journal_id = ?",
      )
      .get("journal_1");
    expect(totals).toEqual({ debitTotal: 100, creditTotal: 100 });

    expect(() =>
      db.exec(`
        INSERT INTO marketplace_ledger_entries (
          id, journal_id, account_code, debit_minor, credit_minor
        ) VALUES ('entry_invalid_both', 'journal_1', 'cash_clearing', 10, 10);
      `),
    ).toThrow(/marketplace_ledger_entries_one_side_ck/i);

    expect(() =>
      db.exec(`
        INSERT INTO marketplace_ledger_entries (
          id, journal_id, account_code, debit_minor, credit_minor
        ) VALUES ('entry_invalid_zero', 'journal_1', 'cash_clearing', 0, 0);
      `),
    ).toThrow(/marketplace_ledger_entries_one_side_ck/i);

    db.close();
  });

  it("rejects updates and deletes for journals and entries", () => {
    const db = createDatabase();
    db.exec(`
      INSERT INTO marketplace_ledger_journals (
        id, idempotency_key, event_type, source_type, source_id, currency, occurred_at
      ) VALUES ('journal_1', 'probe:1', 'probe', 'test', '1', 'BDT', 1);
      INSERT INTO marketplace_ledger_entries (
        id, journal_id, account_code, debit_minor, credit_minor
      ) VALUES ('entry_1', 'journal_1', 'cash_clearing', 1, 0);
    `);

    expect(() =>
      db.exec("UPDATE marketplace_ledger_journals SET event_type='changed' WHERE id='journal_1'"),
    ).toThrow(/marketplace ledger is immutable/i);
    expect(() =>
      db.exec("DELETE FROM marketplace_ledger_journals WHERE id='journal_1'"),
    ).toThrow(/marketplace ledger is immutable/i);
    expect(() =>
      db.exec("UPDATE marketplace_ledger_entries SET debit_minor=2 WHERE id='entry_1'"),
    ).toThrow(/marketplace ledger is immutable/i);
    expect(() =>
      db.exec("DELETE FROM marketplace_ledger_entries WHERE id='entry_1'"),
    ).toThrow(/marketplace ledger is immutable/i);

    db.close();
  });

  it("enforces refund allocation uniqueness and seller-component reconciliation", () => {
    const db = createDatabase();
    seedReferences(db);
    db.exec(`
      INSERT INTO refunds (
        id, order_id, order_payment_id, status, currency, amount_minor, actor_user_id, claim_key
      ) VALUES (
        'refund_1', 'order_1', 'payment_1', 'completed', 'BDT', 100, 'admin_1', 'refund:claim:1'
      );
      INSERT INTO refund_items (
        id, refund_id, order_item_id, vendor_id, quantity,
        refund_amount_minor, gross_minor, discount_reversal_minor,
        commission_reversal_minor, vendor_net_reversal_minor
      ) VALUES (
        'refund_item_1', 'refund_1', 'item_1', 'vendor_1', 1,
        100, 100, 0, 20, 80
      );
    `);

    expect(() =>
      db.exec(`
        INSERT INTO refund_items (
          id, refund_id, order_item_id, vendor_id, quantity,
          refund_amount_minor, gross_minor, discount_reversal_minor,
          commission_reversal_minor, vendor_net_reversal_minor
        ) VALUES (
          'refund_item_duplicate', 'refund_1', 'item_1', 'vendor_1', 1,
          100, 100, 0, 20, 80
        );
      `),
    ).toThrow(/unique constraint failed/i);

    db.exec("INSERT INTO order_items (id) VALUES ('item_2')");
    expect(() =>
      db.exec(`
        INSERT INTO refund_items (
          id, refund_id, order_item_id, vendor_id, quantity,
          refund_amount_minor, gross_minor, discount_reversal_minor,
          commission_reversal_minor, vendor_net_reversal_minor
        ) VALUES (
          'refund_item_invalid', 'refund_1', 'item_2', 'vendor_1', 1,
          100, 100, 0, 10, 80
        );
      `),
    ).toThrow(/refund_items_seller_components_ck/i);

    db.close();
  });

  it("enforces producer idempotency for the shared outbox", () => {
    const db = createDatabase();
    db.exec(`
      INSERT INTO domain_outbox_events (
        id, event_key, aggregate_type, aggregate_id, event_type, payload
      ) VALUES ('event_1', 'payment:1:capture', 'order_payment', 'payment_1', 'payment.captured', '{}');
    `);

    expect(() =>
      db.exec(`
        INSERT INTO domain_outbox_events (
          id, event_key, aggregate_type, aggregate_id, event_type, payload
        ) VALUES ('event_2', 'payment:1:capture', 'order_payment', 'payment_1', 'payment.captured', '{}');
      `),
    ).toThrow(/unique constraint failed/i);

    db.close();
  });
});
