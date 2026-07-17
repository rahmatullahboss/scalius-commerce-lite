import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiDirectory = fileURLToPath(new URL(".", import.meta.url));

describe("scheduled marketplace outbox boundary", () => {
  it("requires both the shared cache binding and central ledger flag", () => {
    const source = readFileSync(`${apiDirectory}/scheduled-maintenance.ts`, "utf8");

    expect(source).toContain('getMarketplaceFlags(db, env.CACHE)');
    expect(source).toContain('if (env.CACHE)');
    expect(source).toContain('enabled: marketplaceFlags.ledgerPosting');
    expect(source).toContain('processMarketplaceOutboxBatch');
    expect(source).toContain('MARKETPLACE_OUTBOX_SWEEP_LIMIT');
  });
});
