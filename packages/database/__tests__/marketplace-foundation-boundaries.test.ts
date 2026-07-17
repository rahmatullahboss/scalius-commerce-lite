import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("canonical marketplace vendor foundation boundaries", () => {
  it("uses membership as owner authority and basis points for commission", () => {
    const schema = read("packages/database/src/schema/vendors.ts");

    expect(schema).toContain("export const vendorUsers");
    expect(schema).not.toContain("ownerUserId");
    expect(schema).not.toContain('real("commission_rate")');
    expect(schema).toContain('integer("rate_bps")');
  });

  it("stores payout destination details as encrypted payloads instead of plaintext account numbers", () => {
    const schema = read("packages/database/src/schema/vendors.ts");

    expect(schema).toContain("vendorPayoutMethods");
    expect(schema).toContain('text("encrypted_payload")');
    expect(schema).toContain('text("fingerprint")');
    expect(schema).toContain('text("last_four")');
    expect(schema).not.toContain('text("account_number")');
  });

  it("creates normalized seller support tables and a platform product owner", () => {
    const migration = read("packages/database/migrations/0058_create_vendors.sql");

    for (const table of [
      "vendors",
      "vendor_users",
      "vendor_addresses",
      "vendor_payout_methods",
      "vendor_verification_documents",
      "vendor_moderation_events",
      "vendor_commission_rules",
      "product_moderation_events",
    ]) {
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    }

    expect(migration).toContain("vendor_platform");
    expect(migration).toContain("vendor_id");
    expect(migration).toContain("moderation_version");
    expect(migration).not.toContain("owner_user_id");
    expect(migration).not.toContain("account_number");
  });
});
