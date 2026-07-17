import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = fileURLToPath(new URL("./scheduled-maintenance.ts", import.meta.url));

describe("scheduled marketplace finance boundaries", () => {
  it("processes the financial outbox before rebuilding projections and releasing settlements", () => {
    const source = readFileSync(sourcePath, "utf8");
    const outboxIndex = source.indexOf("await processMarketplaceOutboxBatch");
    const rebuildIndex = source.indexOf("await rebuildVendorBalanceProjections(db)");
    const settlementIndex = source.indexOf("await processSettlementReleaseBatch");

    expect(outboxIndex).toBeGreaterThan(-1);
    expect(rebuildIndex).toBeGreaterThan(outboxIndex);
    expect(settlementIndex).toBeGreaterThan(rebuildIndex);
    expect(source).toContain("if (marketplaceOutbox.processed > 0)");
  });

  it("uses separate central flags and bounded sweep limits", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("enabled: marketplaceFlags.ledgerPosting");
    expect(source).toContain("enabled: marketplaceFlags.settlementRelease");
    expect(source).toContain("MARKETPLACE_OUTBOX_SWEEP_LIMIT");
    expect(source).toContain("SETTLEMENT_RELEASE_SWEEP_LIMIT");
    expect(source).toContain("if (env.CACHE)");
  });
});
