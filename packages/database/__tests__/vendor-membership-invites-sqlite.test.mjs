import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../migrations/0067_vendor_membership_invites.sql", import.meta.url)),
  "utf8",
).replaceAll("--> statement-breakpoint", "");

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE "user" (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE vendors (id TEXT PRIMARY KEY NOT NULL);
    INSERT INTO "user" (id) VALUES ('inviter_1'), ('accepted_1');
    INSERT INTO vendors (id) VALUES ('vendor_1');
  `);
  db.exec(migrationSql);
  return db;
}

function insertInvite(db, {
  id,
  email = "member@example.com",
  tokenHash,
  status = "pending",
} = {}) {
  db.prepare(`
    INSERT INTO vendor_membership_invites (
      id, vendor_id, invitee_email, role, token_hash, status,
      invited_by, expires_at, created_at, updated_at
    ) VALUES (?, 'vendor_1', ?, 'catalog', ?, ?, 'inviter_1', 2000000000, 1, 1)
  `).run(id, email, tokenHash, status);
}

describe("vendor membership invitations SQLite behavior", () => {
  it("rejects duplicate token hashes and a second pending invite for the same seller/email", () => {
    const db = createDatabase();
    insertInvite(db, { id: "invite_1", tokenHash: "hash_1" });

    expect(() => insertInvite(db, {
      id: "invite_duplicate_email",
      tokenHash: "hash_2",
    })).toThrow(/UNIQUE constraint failed: vendor_membership_invites\.vendor_id, vendor_membership_invites\.invitee_email/);

    expect(() => insertInvite(db, {
      id: "invite_duplicate_token",
      email: "other@example.com",
      tokenHash: "hash_1",
    })).toThrow(/UNIQUE constraint failed: vendor_membership_invites\.token_hash/);
  });

  it("preserves accepted history while allowing a future pending invite", () => {
    const db = createDatabase();
    insertInvite(db, { id: "invite_1", tokenHash: "hash_1" });
    db.prepare(`
      UPDATE vendor_membership_invites
      SET status='accepted', accepted_by_user_id='accepted_1', accepted_at=10, updated_at=10
      WHERE id='invite_1'
    `).run();

    expect(() => insertInvite(db, {
      id: "invite_2",
      tokenHash: "hash_2",
    })).not.toThrow();
  });
});
