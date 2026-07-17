import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routePath = fileURLToPath(new URL("./vendor-dashboard.ts", import.meta.url));
const source = readFileSync(routePath, "utf8");

describe("seller team API boundaries", () => {
  it("exposes team list, secure invite, authenticated acceptance, revoke, and member update routes", () => {
    for (const path of [
      'path: "/team"',
      'path: "/team/invites"',
      'path: "/team/invites/accept"',
      'path: "/team/invites/{inviteId}/revoke"',
      'path: "/team/members/{membershipId}"',
    ]) expect(source).toContain(path);
    for (const command of [
      "listVendorTeam",
      "createVendorMembershipInvite",
      "acceptVendorMembershipInvite",
      "revokeVendorMembershipInvite",
      "updateVendorMember",
    ]) expect(source).toContain(command);
  });

  it("derives acceptance identity from the authenticated session and protects team management by capability", () => {
    expect(source).toContain("userId: getCurrentUserId(c)");
    expect(source.match(/\"members\.manage\"/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(source).not.toContain("userId: c.req.valid(\"json\")");
  });

  it("gates team writes and never exposes persisted token hashes", () => {
    const teamBlock = source.slice(source.indexOf("const teamRoute"), source.indexOf("const summaryRoute"));
    expect(teamBlock.match(/vendorOnboardingWrite/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(teamBlock).toContain("token: z.string()");
    expect(teamBlock).not.toContain("tokenHash:");
    expect(teamBlock).not.toContain("vendorMembershipInvites");
  });
});
