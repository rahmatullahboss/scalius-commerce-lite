import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../migrations/0063_payout_state_guards.sql", import.meta.url),
);

describe("payout operational state guards", () => {
  it("requires reservation, completion, and release journals to match payout item and amount", () => {
    const source = readFileSync(migrationPath, "utf8");
    expect(source).toContain("payout_items_validate_insert");
    expect(source).toContain("payout_items_validate_update");
    expect(source).toContain("payout reservation journal mismatch");
    expect(source).toContain("payout completion journal mismatch");
    expect(source).toContain("payout release journal mismatch");
    expect(source).toContain("journal.payout_id = NEW.id");
    expect(source).toContain("SUM(entry.credit_minor - entry.debit_minor)");
  });

  it("enforces explicit payout item status transitions", () => {
    const source = readFileSync(migrationPath, "utf8");
    expect(source).toContain("invalid payout item status transition");
    expect(source).toContain("OLD.status = 'reserved' AND NEW.status IN ('processing','released','cancelled')");
    expect(source).toContain("OLD.status = 'processing' AND NEW.status IN ('completed','released','failed')");
  });

  it("allows attempts only for processing items and only one terminal transition", () => {
    const source = readFileSync(migrationPath, "utf8");
    expect(source).toContain("payout_attempts_validate_insert");
    expect(source).toContain("payout_attempts_validate_update");
    expect(source).toContain("payout item must be processing before an attempt is created");
    expect(source).toContain("invalid payout attempt status transition");
  });
});
