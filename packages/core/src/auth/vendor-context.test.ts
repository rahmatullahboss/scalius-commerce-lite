import { describe, expect, it } from "vitest";
import {
  hasVendorCapability,
  listUserVendorMemberships,
  resolveUserVendorContext,
  type VendorMembershipContext,
} from "./vendor-context";

function createMembershipDb(rows: VendorMembershipContext[]) {
  const chain = {
    innerJoin: () => chain,
    where: () => chain,
    limit: () => chain,
    then: (resolve: (value: VendorMembershipContext[]) => unknown) =>
      Promise.resolve(rows).then(resolve),
  };
  return {
    select: () => ({ from: () => chain }),
  };
}

const ownerMembership: VendorMembershipContext = {
  membershipId: "membership_owner",
  vendorId: "vendor_a",
  userId: "user_1",
  role: "owner",
  membershipStatus: "active",
  vendorStatus: "approved",
  vendorName: "Vendor A",
  vendorSlug: "vendor-a",
};

const catalogMembership: VendorMembershipContext = {
  ...ownerMembership,
  membershipId: "membership_catalog",
  role: "catalog",
};

describe("seller membership context and capabilities", () => {
  it("never resolves a requested seller outside the authenticated user's memberships", async () => {
    const db = createMembershipDb([ownerMembership]);

    await expect(
      resolveUserVendorContext(db as never, "user_1", "vendor_b"),
    ).resolves.toBeNull();
    await expect(
      resolveUserVendorContext(db as never, "user_1", "vendor_a"),
    ).resolves.toEqual(ownerMembership);
  });

  it("fails closed for suspended memberships and sellers unless explicitly requested for platform review", async () => {
    const suspendedMembership = {
      ...ownerMembership,
      membershipStatus: "suspended" as const,
    };
    const suspendedVendor = {
      ...ownerMembership,
      membershipId: "membership_vendor_suspended",
      vendorId: "vendor_suspended",
      vendorStatus: "suspended" as const,
    };
    const db = createMembershipDb([suspendedMembership, suspendedVendor]);

    await expect(listUserVendorMemberships(db as never, "user_1")).resolves.toEqual([]);
    await expect(
      listUserVendorMemberships(db as never, "user_1", {
        includeSuspendedMemberships: true,
        includeUnapprovedVendors: true,
      }),
    ).resolves.toHaveLength(2);
  });

  it("maps seller roles to explicit capabilities without platform RBAC", () => {
    expect(hasVendorCapability(ownerMembership, "dashboard.read")).toBe(true);
    expect(hasVendorCapability(ownerMembership, "payout.manage")).toBe(true);
    expect(hasVendorCapability(ownerMembership, "profile.manage")).toBe(true);
    expect(hasVendorCapability(catalogMembership, "catalog.write")).toBe(true);
    expect(hasVendorCapability(catalogMembership, "profile.manage")).toBe(false);
    expect(hasVendorCapability(catalogMembership, "orders.write")).toBe(false);
    expect(hasVendorCapability(catalogMembership, "finance.read")).toBe(false);
  });
});
