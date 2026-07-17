import { products, vendors } from "@scalius/database/schema";
import { eq, isNull, sql, type SQL } from "drizzle-orm";

export interface PublicSellableProductState {
  productIsActive: boolean;
  productDeletedAt: Date | number | string | null;
  productApprovalStatus: string;
  vendorId: string | null;
  vendorStatus: string | null;
  vendorDeletedAt: Date | number | string | null;
}

export function isPublicSellableProductState(
  state: PublicSellableProductState,
): boolean {
  return (
    state.productIsActive === true &&
    state.productDeletedAt == null &&
    state.productApprovalStatus === "approved" &&
    Boolean(state.vendorId) &&
    state.vendorStatus === "approved" &&
    state.vendorDeletedAt == null
  );
}

/**
 * Canonical public catalog and checkout eligibility predicate.
 *
 * Use only in queries whose product table source is the canonical `products`
 * table. Seller approval is checked with an EXISTS subquery so callers do not
 * need to add a join that could alter row counts or aggregation.
 */
export function getPublicSellableProductConditions(): SQL[] {
  return [
    eq(products.isActive, true),
    isNull(products.deletedAt),
    eq(products.approvalStatus, "approved"),
    sql`${products.vendorId} IS NOT NULL`,
    sql`EXISTS (
      SELECT 1
      FROM ${vendors}
      WHERE ${vendors.id} = ${products.vendorId}
        AND ${vendors.status} = 'approved'
        AND ${vendors.deletedAt} IS NULL
    )`,
  ];
}
