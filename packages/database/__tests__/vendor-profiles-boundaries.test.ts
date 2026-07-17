import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  fileURLToPath(new URL("../src/schema/vendor-profiles.ts", import.meta.url)),
  "utf8",
);
const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0068_vendor_profiles.sql", import.meta.url)),
  "utf8",
);

describe("seller-facing vendor profile schema boundary", () => {
  it("keeps public presentation outside the vendor lifecycle row", () => {
    expect(schema).toContain('sqliteTable("vendor_profiles"');
    expect(schema).toContain('primaryKey()');
    expect(schema).toContain('enum: ["draft", "published"]');
    expect(schema).toContain('logoMediaId');
    expect(schema).toContain('bannerMediaId');
    expect(schema).toContain('showContactEmail');
    expect(schema).toContain('showContactPhone');
  });

  it("ships one profile per seller with canonical media references", () => {
    expect(migration).toContain("CREATE TABLE `vendor_profiles`");
    expect(migration).toContain("`vendor_id` text PRIMARY KEY NOT NULL");
    expect(migration).toContain("REFERENCES `vendors`(`id`)");
    expect(migration.match(/REFERENCES `media`\(`id`\)/g)?.length).toBe(2);
    expect(migration).toContain("CHECK (`publication_status` IN ('draft', 'published'))");
  });
});
