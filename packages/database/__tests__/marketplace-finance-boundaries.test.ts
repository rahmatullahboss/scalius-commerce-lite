import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const databaseRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaSource = () => readFileSync(`${databaseRoot}/src/schema/marketplace-finance.ts`, "utf8");
const migrationSource = () => readFileSync(`${databaseRoot}/migrations/0060_marketplace_ledger_refunds.sql`, "utf8");

describe("marketplace finance schema boundaries", () => {
  it("defines one shared outbox, immutable ledger, normalized refunds, and rebuildable balance projection", () => {
    const source = schemaSource();

    expect(source).toContain('sqliteTable("domain_outbox_events"');
    expect(source).toContain('sqliteTable("marketplace_ledger_journals"');
    expect(source).toContain('sqliteTable("marketplace_ledger_entries"');
    expect(source).toContain('sqliteTable("refunds"');
    expect(source).toContain('sqliteTable("refund_items"');
    expect(source).toContain('sqliteTable("vendor_balance_projections"');
    expect(source).toContain('uniqueIndex("domain_outbox_events_event_key_uq"');
    expect(source).toContain('uniqueIndex("marketplace_ledger_journals_idempotency_uq"');
    expect(source).toContain('uniqueIndex("refunds_claim_key_uq"');
    expect(source).toContain('uniqueIndex("refund_items_refund_order_item_uq"');
  });

  it("uses integer money and enforces one-sided ledger entries", () => {
    const source = schemaSource();
    const migration = migrationSource();

    expect(source).toMatch(/check\(\s*"marketplace_ledger_entries_one_side_ck"/);
    expect(source).toMatch(/check\(\s*"refund_items_amounts_non_negative_ck"/);
    expect(migration).not.toMatch(/\bREAL\b/i);
    expect(migration).toContain("CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))");
  });

  it("makes posted journals and entries immutable at the database boundary", () => {
    const migration = migrationSource();

    expect(migration).toContain("marketplace_ledger_journals_reject_update");
    expect(migration).toContain("marketplace_ledger_journals_reject_delete");
    expect(migration).toContain("marketplace_ledger_entries_reject_update");
    expect(migration).toContain("marketplace_ledger_entries_reject_delete");
    expect(migration.match(/RAISE\(ABORT, 'marketplace ledger is immutable'\)/g)).toHaveLength(4);
  });

  it("exports the canonical finance schema from the shared schema barrel", () => {
    const source = readFileSync(`${databaseRoot}/src/schema/index.ts`, "utf8");
    expect(source).toContain('export * from "./marketplace-finance"');
  });
});
