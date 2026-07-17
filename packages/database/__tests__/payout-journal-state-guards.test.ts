import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../migrations/0064_payout_journal_state_guards.sql", import.meta.url),
);

describe("payout journal current-state guards", () => {
  it("requires a processing item with matching vendor and amount before completion", () => {
    const source = readFileSync(migrationPath, "utf8");
    expect(source).toContain("marketplace_ledger_guard_payout_completion_state");
    expect(source).toContain("payout_items.status = 'processing'");
    expect(source).toContain("payout_items.amount_minor = NEW.debit_minor");
    expect(source).toContain("payout_items.vendor_id = NEW.vendor_id");
    expect(source).toContain("payout item is not processing or amount does not match");
  });

  it("requires a reserved or processing item with matching amount before release", () => {
    const source = readFileSync(migrationPath, "utf8");
    expect(source).toContain("marketplace_ledger_guard_payout_release_state");
    expect(source).toContain("payout_items.status IN ('reserved','processing')");
    expect(source).toContain("payout item is not releasable or amount does not match");
  });
});
