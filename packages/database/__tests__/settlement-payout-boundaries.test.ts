import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaDirectory = fileURLToPath(new URL("../src/schema/", import.meta.url));
const migrationPath = fileURLToPath(
  new URL("../migrations/0061_settlement_payouts.sql", import.meta.url),
);

function schemaSource(name: string): string {
  return readFileSync(`${schemaDirectory}/${name}`, "utf8");
}

describe("settlement and payout schema boundaries", () => {
  it("adds explicit seller settlement policy and vendor-order delivery time", () => {
    const vendors = schemaSource("vendors.ts");
    const vendorOrders = schemaSource("vendor-orders.ts");

    expect(vendors).toContain('settlementHoldDays: integer("settlement_hold_days")');
    expect(vendors).toContain('minimumPayoutMinor: integer("minimum_payout_minor")');
    expect(vendorOrders).toContain('deliveredAt: integer("delivered_at"');
  });

  it("defines canonical payout batches, items, and append-only attempts", () => {
    const source = schemaSource("marketplace-payouts.ts");

    expect(source).toContain('sqliteTable("payout_batches"');
    expect(source).toContain('sqliteTable("payout_items"');
    expect(source).toContain('sqliteTable("payout_attempts"');
    expect(source).toContain('idempotencyKey: text("idempotency_key")');
    expect(source).toContain('reservationJournalId: text("reservation_journal_id")');
    expect(source).toContain('completionJournalId: text("completion_journal_id")');
    expect(source).toContain('releaseJournalId: text("release_journal_id")');
    expect(source).toContain('requestMetadata: text("request_metadata", { mode: "json" })');
    expect(source).not.toMatch(/encryptedPayload|accountNumber|storageKey/);
  });

  it("uses integer minor units and explicit checks instead of REAL payout money", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).not.toMatch(/\bREAL\b/i);
    expect(migration).toContain("`amount_minor` integer NOT NULL");
    expect(migration).toContain("`total_minor` integer DEFAULT 0 NOT NULL");
    expect(migration).toContain("CONSTRAINT `payout_items_amount_positive_ck`");
    expect(migration).toContain("CONSTRAINT `payout_attempts_number_positive_ck`");
  });

  it("enforces payout idempotency and one seller obligation per batch and currency", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("CREATE UNIQUE INDEX `payout_batches_idempotency_uq`");
    expect(migration).toContain("CREATE UNIQUE INDEX `payout_items_idempotency_uq`");
    expect(migration).toContain("CREATE UNIQUE INDEX `payout_items_batch_vendor_currency_uq`");
    expect(migration).toContain("CREATE UNIQUE INDEX `payout_attempts_attempt_key_uq`");
    expect(migration).toContain("CREATE UNIQUE INDEX `payout_attempts_item_number_uq`");
  });

  it("exports the payout schema from the canonical barrel", () => {
    expect(schemaSource("index.ts")).toContain('export * from "./marketplace-payouts"');
  });
});
