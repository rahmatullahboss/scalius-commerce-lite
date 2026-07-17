import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const packageJson = source("../package.json");
const registerLoader = source("./register-cloudflare-spec-loader.mjs");
const runtimeLoader = source("./cloudflare-spec-loader.mjs");
const openApiSpec = source("../openapi.json");
const generatedSdk = source("../src/generated/sdk.gen.ts");

describe("deterministic OpenAPI client generation", () => {
  it("registers the Cloudflare virtual-module loader before importing the TypeScript app", () => {
    expect(packageJson).toContain("--import ./scripts/register-cloudflare-spec-loader.mjs --import tsx");
    expect(registerLoader).toContain('register("./cloudflare-spec-loader.mjs", import.meta.url)');
    expect(runtimeLoader).toContain('specifier.startsWith("cloudflare:")');
    expect(runtimeLoader).toContain("export const env = {}");
    expect(runtimeLoader).toContain("export const exports = {}");
  });

  it("keeps the seller courier status refresh contract in the generated spec and SDK", () => {
    expect(openApiSpec).toContain("/api/v1/admin/vendor-dashboard/shipments/{shipmentId}/check-status");
    expect(generatedSdk).toContain("postApiV1AdminVendorDashboardShipmentsByShipmentIdCheckStatus");
  });
});
