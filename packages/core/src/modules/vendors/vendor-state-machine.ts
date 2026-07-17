import { ValidationError } from "../../errors";

export type VendorLifecycleStatus = "pending" | "approved" | "rejected" | "suspended" | "closed";
export type ProductModerationStatus = "draft" | "submitted" | "approved" | "rejected" | "suspended";

const VENDOR_TRANSITIONS: Record<VendorLifecycleStatus, ReadonlySet<VendorLifecycleStatus>> = {
    pending: new Set(["approved", "rejected", "closed"]),
    approved: new Set(["suspended", "closed"]),
    rejected: new Set(["pending", "closed"]),
    suspended: new Set(["approved", "closed"]),
    closed: new Set(),
};

const PRODUCT_TRANSITIONS: Record<ProductModerationStatus, ReadonlySet<ProductModerationStatus>> = {
    draft: new Set(["submitted"]),
    submitted: new Set(["approved", "rejected"]),
    approved: new Set(["suspended"]),
    rejected: new Set(["draft", "submitted"]),
    suspended: new Set(["approved"]),
};

export function assertVendorStatusTransition(
    from: VendorLifecycleStatus,
    to: VendorLifecycleStatus,
): void {
    if (from === to) return;
    if (!VENDOR_TRANSITIONS[from].has(to)) {
        throw new ValidationError(`Invalid vendor status transition: ${from} -> ${to}`);
    }
}

export function assertProductModerationTransition(
    from: ProductModerationStatus,
    to: ProductModerationStatus,
): void {
    if (from === to) return;
    if (!PRODUCT_TRANSITIONS[from].has(to)) {
        throw new ValidationError(`Invalid product moderation transition: ${from} -> ${to}`);
    }
}
