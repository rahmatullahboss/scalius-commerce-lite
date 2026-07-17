import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  fileURLToPath(new URL("../src/schema/vendors.ts", import.meta.url)),
  "utf8",
);
const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0067_vendor_membership_invites.sql", import.meta.url)),
  "utf8",
);

describe("vendor membership invitation schema boundary", () => {
  it("stores only hashed invitation credentials and explicit lifecycle evidence", () => {
    expect(schema).toContain("export const vendorMembershipInvites");
    expect(schema).toContain('text("token_hash")');
    expect(schema).toContain('text("invitee_email")');
    expect(schema).toContain('enum: ["pending", "accepted", "revoked", "expired"]');
    expect(schema).not.toContain('text("raw_token")');
    expect(schema).not.toContain('text("invite_token")');
  });

  it("creates a forward migration with one pending invite per seller/email", () => {
    expect(migration).toContain("CREATE TABLE `vendor_membership_invites`");
    expect(migration).toContain("`token_hash` text NOT NULL");
    expect(migration).toContain("vendor_membership_invites_token_hash_uq");
    expect(migration).toContain("vendor_membership_invites_pending_email_uq");
    expect(migration).toContain("WHERE `status` = 'pending'");
    expect(migration).not.toContain("raw_token");
  });
});
