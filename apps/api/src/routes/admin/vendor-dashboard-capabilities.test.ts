import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routesDirectory = fileURLToPath(new URL(".", import.meta.url));

describe("seller dashboard capability wiring", () => {
  it("derives seller authorization from membership capabilities, not platform RBAC", () => {
    const source = readFileSync(`${routesDirectory}/vendor-dashboard.ts`, "utf8");

    expect(source).toContain("hasVendorCapability");
    expect(source).toContain('"dashboard.read"');
    expect(source).toContain('"orders.read"');
    expect(source).toContain('"catalog.read"');
    expect(source).not.toContain("vendors.view");
  });
});
