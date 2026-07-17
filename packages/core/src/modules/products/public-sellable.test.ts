import { describe, expect, it } from "vitest";
import { isPublicSellableProductState } from "./public-sellable";

const approved = {
  productIsActive: true,
  productDeletedAt: null,
  productApprovalStatus: "approved",
  vendorId: "vendor_1",
  vendorStatus: "approved",
  vendorDeletedAt: null,
} as const;

describe("public sellable product policy", () => {
  it("allows only active approved products owned by approved non-deleted sellers", () => {
    expect(isPublicSellableProductState(approved)).toBe(true);
  });

  it.each(["draft", "submitted", "rejected", "suspended"])(
    "rejects product approval status %s",
    (productApprovalStatus) => {
      expect(isPublicSellableProductState({ ...approved, productApprovalStatus })).toBe(false);
    },
  );

  it.each(["pending", "rejected", "suspended", "closed"])(
    "rejects seller status %s",
    (vendorStatus) => {
      expect(isPublicSellableProductState({ ...approved, vendorStatus })).toBe(false);
    },
  );

  it("rejects inactive, deleted, unowned, or seller-deleted products", () => {
    expect(isPublicSellableProductState({ ...approved, productIsActive: false })).toBe(false);
    expect(isPublicSellableProductState({ ...approved, productDeletedAt: new Date() })).toBe(false);
    expect(isPublicSellableProductState({ ...approved, vendorId: null })).toBe(false);
    expect(isPublicSellableProductState({ ...approved, vendorDeletedAt: new Date() })).toBe(false);
  });
});
