import { describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "../../errors";
import type { VendorMembershipContext } from "../../auth/vendor-context";
import {
  acceptVendorMembershipInvite,
  createVendorMembershipInvite,
  revokeVendorMembershipInvite,
  updateVendorMember,
} from "./vendor-membership-invites";

type Statement = {
  kind: "insert" | "update";
  table: unknown;
  values: Record<string, unknown>;
};

function createDb(selectResults: unknown[][]) {
  const queued = [...selectResults];
  const statements: Statement[] = [];
  const batches: Statement[][] = [];

  function selectChain(result: unknown[]) {
    const chain = {
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      all: async () => result,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => selectChain(queued.shift() ?? [])),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        const statement: Statement = { kind: "insert", table, values };
        statements.push(statement);
        return statement;
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => {
          const statement: Statement = { kind: "update", table, values };
          statements.push(statement);
          return statement;
        }),
      })),
    })),
    batch: vi.fn(async (batch: Statement[]) => {
      batches.push(batch);
      return batch.map(() => []);
    }),
  };

  return { db, statements, batches };
}

const ownerContext: VendorMembershipContext = {
  membershipId: "membership_owner",
  vendorId: "vendor_1",
  userId: "owner_1",
  role: "owner",
  membershipStatus: "active",
  vendorStatus: "approved",
  vendorName: "Seller One",
  vendorSlug: "seller-one",
};

const viewerContext: VendorMembershipContext = {
  ...ownerContext,
  membershipId: "membership_viewer",
  userId: "viewer_1",
  role: "viewer",
};

function dependencies() {
  let id = 0;
  return {
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    id: () => `membership_${++id}`,
    token: () => "[REDACTED_SECRET]",
    hashToken: async (value: string) => `digest:${value}`,
  };
}

describe("vendor membership invitations", () => {
  it("creates a hashed non-owner invitation and returns the raw credential once", async () => {
    const { db, batches } = createDb([
      [{ id: "user_invitee" }],
      [],
      [],
    ]);

    await expect(createVendorMembershipInvite(db as never, ownerContext, {
      inviteeEmail: " Member@Example.com ",
      role: "catalog",
      expiresInHours: 48,
    }, dependencies())).resolves.toEqual({
      inviteId: "membership_1",
      vendorId: "vendor_1",
      inviteeEmail: "member@example.com",
      role: "catalog",
      expiresAt: new Date("2026-07-16T12:00:00.000Z"),
      token: "[REDACTED_SECRET]",
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0]?.[0]?.values).toMatchObject({
      vendorId: "vendor_1",
      inviteeEmail: "member@example.com",
      role: "catalog",
      tokenHash: "digest:[REDACTED_SECRET]",
      status: "pending",
      invitedBy: "owner_1",
    });
    expect(batches[0]?.[0]?.values).not.toHaveProperty("token");
  });

  it("requires members.manage and rejects owner invitations", async () => {
    const { db } = createDb([]);

    await expect(createVendorMembershipInvite(db as never, viewerContext, {
      inviteeEmail: "member@example.com",
      role: "catalog",
    }, dependencies())).rejects.toBeInstanceOf(ValidationError);

    await expect(createVendorMembershipInvite(db as never, ownerContext, {
      inviteeEmail: "member@example.com",
      role: "owner" as never,
    }, dependencies())).rejects.toBeInstanceOf(ValidationError);
  });

  it("blocks inviting an already active member or duplicate pending email", async () => {
    const activeMemberDb = createDb([
      [{ id: "user_invitee" }],
      [{ id: "existing_membership", status: "active" }],
    ]);
    await expect(createVendorMembershipInvite(activeMemberDb.db as never, ownerContext, {
      inviteeEmail: "member@example.com",
      role: "catalog",
    }, dependencies())).rejects.toBeInstanceOf(ConflictError);

    const duplicateInviteDb = createDb([
      [],
      [{ id: "invite_existing" }],
    ]);
    await expect(createVendorMembershipInvite(duplicateInviteDb.db as never, ownerContext, {
      inviteeEmail: "member@example.com",
      role: "catalog",
    }, dependencies())).rejects.toBeInstanceOf(ConflictError);
  });

  it("accepts an invitation only for the authenticated matching email and activates membership atomically", async () => {
    const { db, batches } = createDb([
      [{
        id: "invite_1",
        vendorId: "vendor_1",
        inviteeEmail: "member@example.com",
        role: "finance",
        status: "pending",
        expiresAt: new Date("2026-07-20T12:00:00.000Z"),
        invitedBy: "owner_1",
        vendorStatus: "approved",
      }],
      [{ id: "user_member", email: "member@example.com" }],
      [],
    ]);

    await expect(acceptVendorMembershipInvite(db as never, {
      token: "[REDACTED_SECRET]",
      userId: "user_member",
    }, dependencies())).resolves.toEqual({
      inviteId: "invite_1",
      vendorId: "vendor_1",
      membershipId: "membership_1",
      role: "finance",
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0]?.[0]).toMatchObject({
      kind: "update",
      values: {
        status: "accepted",
        acceptedByUserId: "user_member",
      },
    });
    expect(batches[0]?.[1]).toMatchObject({
      kind: "insert",
      values: {
        vendorId: "vendor_1",
        userId: "user_member",
        role: "finance",
        status: "active",
      },
    });
  });

  it("rejects acceptance for a different email without writing", async () => {
    const { db, batches } = createDb([
      [{
        id: "invite_1",
        vendorId: "vendor_1",
        inviteeEmail: "member@example.com",
        role: "viewer",
        status: "pending",
        expiresAt: new Date("2026-07-20T12:00:00.000Z"),
        invitedBy: "owner_1",
        vendorStatus: "approved",
      }],
      [{ id: "user_other", email: "other@example.com" }],
    ]);

    await expect(acceptVendorMembershipInvite(db as never, {
      token: "[REDACTED_SECRET]",
      userId: "user_other",
    }, dependencies())).rejects.toBeInstanceOf(ValidationError);
    expect(batches).toHaveLength(0);
  });

  it("revokes a pending invite and manages only non-owner memberships", async () => {
    const revokeDb = createDb([[{ id: "invite_1", status: "pending" }]]);
    await expect(revokeVendorMembershipInvite(
      revokeDb.db as never,
      ownerContext,
      "invite_1",
      dependencies(),
    )).resolves.toEqual({ inviteId: "invite_1", status: "revoked" });
    expect(revokeDb.batches[0]?.[0]?.values).toMatchObject({ status: "revoked" });

    const memberDb = createDb([[{
      id: "membership_catalog",
      userId: "catalog_1",
      role: "catalog",
      status: "active",
    }]]);
    await expect(updateVendorMember(memberDb.db as never, ownerContext, {
      membershipId: "membership_catalog",
      role: "fulfillment",
      status: "suspended",
    }, dependencies())).resolves.toEqual({
      membershipId: "membership_catalog",
      role: "fulfillment",
      status: "suspended",
    });

    const ownerDb = createDb([[{
      id: "membership_other_owner",
      userId: "owner_2",
      role: "owner",
      status: "active",
    }]]);
    await expect(updateVendorMember(ownerDb.db as never, ownerContext, {
      membershipId: "membership_other_owner",
      status: "revoked",
    }, dependencies())).rejects.toBeInstanceOf(ValidationError);

    const invitedDb = createDb([[{
      id: "membership_invited",
      userId: "invited_1",
      role: "viewer",
      status: "invited",
    }]]);
    await expect(updateVendorMember(invitedDb.db as never, ownerContext, {
      membershipId: "membership_invited",
      status: "active",
    }, dependencies())).rejects.toBeInstanceOf(ValidationError);
  });
});
