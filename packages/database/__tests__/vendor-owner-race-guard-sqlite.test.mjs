import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../migrations/0066_owner_application_race_guard.sql", import.meta.url)),
  "utf8",
);

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE vendor_users (
      id TEXT PRIMARY KEY NOT NULL,
      vendor_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
  db.exec(migrationSql);
  return db;
}

function insertMembership(db, id, vendorId, userId, role, status) {
  db.prepare(`
    INSERT INTO vendor_users (id, vendor_id, user_id, role, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, vendorId, userId, role, status);
}

describe("owner application race guard SQLite behavior", () => {
  it("rejects a second active owner store for the same user", () => {
    const db = createDatabase();
    insertMembership(db, "membership_1", "vendor_1", "user_1", "owner", "active");

    expect(() => insertMembership(
      db,
      "membership_2",
      "vendor_2",
      "user_1",
      "owner",
      "active",
    )).toThrow(/UNIQUE constraint failed: vendor_users\.user_id/);
  });

  it("allows non-owner and inactive historical memberships for the same user", () => {
    const db = createDatabase();
    insertMembership(db, "membership_owner", "vendor_1", "user_1", "owner", "active");

    expect(() => insertMembership(
      db,
      "membership_admin",
      "vendor_2",
      "user_1",
      "admin",
      "active",
    )).not.toThrow();
    expect(() => insertMembership(
      db,
      "membership_revoked_owner",
      "vendor_3",
      "user_1",
      "owner",
      "revoked",
    )).not.toThrow();
  });
});
