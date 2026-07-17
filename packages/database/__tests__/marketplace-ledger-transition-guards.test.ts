import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../migrations/0062_marketplace_ledger_transition_guards.sql", import.meta.url),
);

describe("marketplace ledger transition guards", () => {
  it("guards settlement, reservation, completion, and release debit accounts", () => {
    const source = readFileSync(migrationPath, "utf8");

    expect(source).toContain("marketplace_ledger_guard_settlement_pending");
    expect(source).toContain("marketplace_ledger_guard_payout_available");
    expect(source).toContain("marketplace_ledger_guard_payout_completion_reserved");
    expect(source).toContain("marketplace_ledger_guard_payout_release_reserved");
    expect(source).toContain("insufficient vendor pending balance");
    expect(source).toContain("insufficient vendor available balance");
    expect(source).toContain("insufficient payout reservation balance");
  });

  it("scopes settlement to vendor order and payout completion/release to payout item", () => {
    const source = readFileSync(migrationPath, "utf8");

    expect(source).toMatch(/e\.`vendor_order_id`\s*=\s*NEW\.`vendor_order_id`/);
    expect(source).toContain("balance_journal.payout_id = current_journal.payout_id");
    expect(source).toContain("current_journal.event_type = 'payout.completed'");
    expect(source).toContain("current_journal.event_type = 'payout.released'");
  });

  it("subtracts negative seller payable buckets before allowing payout reservation", () => {
    const source = readFileSync(migrationPath, "utf8");

    expect(source).toContain("vendor_pending_payable");
    expect(source).toContain("vendor_available_payable");
    expect(source).toContain("vendor_payout_reserved");
    expect(source).toContain("CASE WHEN account_balance < 0 THEN account_balance ELSE 0 END");
  });
});
