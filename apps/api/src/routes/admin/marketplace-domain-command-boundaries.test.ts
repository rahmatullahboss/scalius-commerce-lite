import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routesDirectory = fileURLToPath(new URL(".", import.meta.url));

describe("marketplace domain command boundaries", () => {
  it("delegates seller writes to core commands", () => {
    const source = readFileSync(`${routesDirectory}/vendors.ts`, "utf8");

    expect(source).toContain("createVendorCommand");
    expect(source).toContain("updateVendorCommand");
    expect(source).toContain("moderateVendorCommand");
    expect(source).toContain("reviewVendorPayoutMethodCommand");
    expect(source).toContain("reviewVendorVerificationCommand");
    expect(source).not.toContain("safeBatch");
    expect(source).not.toContain("db.insert(vendorModerationEvents)");
  });

  it("delegates product moderation to the versioned core command", () => {
    const source = readFileSync(`${routesDirectory}/products.ts`, "utf8");

    expect(source).toContain("moderateProductCommand");
    expect(source).not.toContain(".set({ approvalStatus, updatedAt: new Date() })");
  });
});
