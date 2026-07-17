import { describe, expect, it } from "vitest";
import {
    allocateVendorOrderSplit,
    type ProductVendorAllocationContext,
    type VendorOrderSplitItemInput,
} from "./vendor-order-split";

const context = (overrides: Partial<ProductVendorAllocationContext> = {}): ProductVendorAllocationContext => ({
    productId: "product_1",
    vendorId: "vendor_1",
    vendorName: "Seller One",
    commissionRuleId: "rule_1",
    commissionBps: 750,
    ...overrides,
});

const item = (overrides: Partial<VendorOrderSplitItemInput> = {}): VendorOrderSplitItemInput => ({
    id: "item_1",
    productId: "product_1",
    quantity: 2,
    price: 12.34,
    fulfillmentStatus: "pending",
    ...overrides,
});

describe("canonical vendor order allocation", () => {
    it("creates integer snapshots and deterministic commission", () => {
        const plan = allocateVendorOrderSplit({
            orderId: "order_1",
            items: [item()],
            productContexts: new Map([["product_1", context()]]),
        });

        expect(plan.vendorOrders).toEqual([expect.objectContaining({
            id: "vendor_order_order_1_vendor_1",
            vendorId: "vendor_1",
        })]);
        expect(plan.itemAllocations.get("item_1")).toEqual({
            vendorOrderId: "vendor_order_order_1_vendor_1",
            vendorIdSnapshot: "vendor_1",
            vendorNameSnapshot: "Seller One",
            currency: "BDT",
            unitPriceMinor: 1234,
            lineSubtotalMinor: 2468,
            discountMinor: 0,
            commissionRuleId: "rule_1",
            commissionBps: 750,
            commissionMinor: 185,
            vendorNetMinor: 2283,
        });
    });

    it("groups multiple sellers into separate fulfillment partitions", () => {
        const plan = allocateVendorOrderSplit({
            orderId: "order_2",
            items: [
                item({ id: "item_a", productId: "product_a", quantity: 1, price: 10 }),
                item({ id: "item_b", productId: "product_b", quantity: 1, price: 20 }),
                item({ id: "item_c", productId: "product_a", quantity: 1, price: 5 }),
            ],
            productContexts: new Map([
                ["product_a", context({ productId: "product_a", vendorId: "vendor_a", vendorName: "A" })],
                ["product_b", context({ productId: "product_b", vendorId: "vendor_b", vendorName: "B" })],
            ]),
        });

        expect(plan.vendorOrders.map((row) => row.vendorId).sort()).toEqual(["vendor_a", "vendor_b"]);
        expect(plan.itemAllocations.get("item_a")?.vendorOrderId).toBe(plan.itemAllocations.get("item_c")?.vendorOrderId);
        expect(plan.itemAllocations.get("item_b")?.vendorOrderId).not.toBe(plan.itemAllocations.get("item_a")?.vendorOrderId);
    });

    it("falls back to the platform seller when product ownership context is unavailable", () => {
        const plan = allocateVendorOrderSplit({
            orderId: "order_3",
            items: [item()],
            productContexts: new Map(),
        });

        expect(plan.vendorOrders[0]).toEqual(expect.objectContaining({ vendorId: "vendor_platform" }));
        expect(plan.itemAllocations.get("item_1")).toEqual(expect.objectContaining({
            vendorIdSnapshot: "vendor_platform",
            vendorNameSnapshot: "Platform",
            commissionBps: 0,
            commissionMinor: 0,
        }));
    });

    it("rejects unsafe or invalid monetary inputs", () => {
        expect(() => allocateVendorOrderSplit({
            orderId: "order_4",
            items: [item({ price: Number.NaN })],
            productContexts: new Map([["product_1", context()]]),
        })).toThrow(/price/i);

        expect(() => allocateVendorOrderSplit({
            orderId: "order_4",
            items: [item({ quantity: 0 })],
            productContexts: new Map([["product_1", context()]]),
        })).toThrow(/quantity/i);
    });
});
