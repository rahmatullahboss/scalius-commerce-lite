import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../migrations/0068_vendor_profiles.sql", import.meta.url)),
  "utf8",
).replaceAll("--> statement-breakpoint", "");

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE vendors (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE media (id TEXT PRIMARY KEY NOT NULL);
    INSERT INTO vendors (id) VALUES ('vendor_1');
    INSERT INTO media (id) VALUES ('media_logo'), ('media_banner');
  `);
  db.exec(migrationSql);
  return db;
}

describe("vendor profiles SQLite behavior", () => {
  it("enforces one profile per seller and valid publication state", () => {
    const db = createDatabase();
    db.prepare(`
      INSERT INTO vendor_profiles (
        vendor_id, logo_media_id, publication_status, created_at, updated_at
      ) VALUES ('vendor_1', 'media_logo', 'draft', 1, 1)
    `).run();

    expect(() => db.prepare(`
      INSERT INTO vendor_profiles (vendor_id, publication_status, created_at, updated_at)
      VALUES ('vendor_1', 'published', 2, 2)
    `).run()).toThrow(/UNIQUE constraint failed: vendor_profiles\.vendor_id/);

    expect(() => db.prepare(`
      UPDATE vendor_profiles SET publication_status='invalid' WHERE vendor_id='vendor_1'
    `).run()).toThrow(/CHECK constraint failed/);
  });

  it("rejects unknown seller and media references", () => {
    const db = createDatabase();
    expect(() => db.prepare(`
      INSERT INTO vendor_profiles (
        vendor_id, logo_media_id, publication_status, created_at, updated_at
      ) VALUES ('vendor_missing', 'media_logo', 'draft', 1, 1)
    `).run()).toThrow(/FOREIGN KEY constraint failed/);

    expect(() => db.prepare(`
      INSERT INTO vendor_profiles (
        vendor_id, logo_media_id, publication_status, created_at, updated_at
      ) VALUES ('vendor_1', 'media_missing', 'draft', 1, 1)
    `).run()).toThrow(/FOREIGN KEY constraint failed/);
  });
});
