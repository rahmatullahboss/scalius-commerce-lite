import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  fileURLToPath(new URL("../src/schema/vendors.ts", import.meta.url)),
  "utf8",
);
const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0066_owner_application_race_guard.sql", import.meta.url)),
  "utf8",
);

describe("seller owner application race guard", () => {
  it("models one active owner store per user as a partial unique index", () => {
    expect(schema).toContain("vendor_users_one_active_owner_per_user_idx");
    expect(schema).toContain(".on(table.userId)");
    expect(schema).toContain("table.role");
    expect(schema).toContain("table.status");
  });

  it("ships the same invariant in forward migration 0066", () => {
    expect(migration).toContain("CREATE UNIQUE INDEX `vendor_users_one_active_owner_per_user_idx`");
    expect(migration).toContain("ON `vendor_users` (`user_id`)");
    expect(migration).toContain("WHERE `role` = 'owner' AND `status` = 'active'");
  });
});
