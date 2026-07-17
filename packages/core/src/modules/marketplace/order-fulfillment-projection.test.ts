import { describe, expect, it } from "vitest";
import { planParentOrderFulfillment } from "./order-fulfillment-projection";

describe("marketplace parent order fulfillment projection", () => {
  it("collapses valid intermediate parent states when seller fulfillment has already advanced", () => {
    expect(planParentOrderFulfillment({
      currentStatus: "pending",
      currentFulfillmentStatus: "pending",
      vendorOrders: [{ status: "shipped", fulfillmentStatus: "partial" }],
    })).toEqual({ status: "shipped", fulfillmentStatus: "partial" });

    expect(planParentOrderFulfillment({
      currentStatus: "pending",
      currentFulfillmentStatus: "pending",
      vendorOrders: [{ status: "delivered", fulfillmentStatus: "complete" }],
    })).toEqual({ status: "delivered", fulfillmentStatus: "complete" });
  });

  it("marks the parent partial and shipped when any seller group is in transit", () => {
    expect(planParentOrderFulfillment({
      currentStatus: "confirmed",
      currentFulfillmentStatus: "pending",
      vendorOrders: [
        { status: "shipped", fulfillmentStatus: "partial" },
        { status: "processing", fulfillmentStatus: "pending" },
      ],
    })).toEqual({ status: "shipped", fulfillmentStatus: "partial" });
  });

  it("marks the parent complete only when every non-cancelled seller group is delivered", () => {
    expect(planParentOrderFulfillment({
      currentStatus: "shipped",
      currentFulfillmentStatus: "partial",
      vendorOrders: [
        { status: "delivered", fulfillmentStatus: "complete" },
        { status: "delivered", fulfillmentStatus: "complete" },
      ],
    })).toEqual({ status: "delivered", fulfillmentStatus: "complete" });

    expect(planParentOrderFulfillment({
      currentStatus: "shipped",
      currentFulfillmentStatus: "partial",
      vendorOrders: [
        { status: "delivered", fulfillmentStatus: "complete" },
        { status: "cancelled", fulfillmentStatus: "cancelled" },
      ],
    })).toEqual({ status: "delivered", fulfillmentStatus: "complete" });
  });

  it("does not deliver the parent while another active seller group is incomplete", () => {
    expect(planParentOrderFulfillment({
      currentStatus: "shipped",
      currentFulfillmentStatus: "partial",
      vendorOrders: [
        { status: "delivered", fulfillmentStatus: "complete" },
        { status: "ready", fulfillmentStatus: "pending" },
      ],
    })).toEqual({ status: "shipped", fulfillmentStatus: "partial" });
  });

  it("preserves terminal parent status and ignores an all-cancelled aggregate", () => {
    expect(planParentOrderFulfillment({
      currentStatus: "returned",
      currentFulfillmentStatus: "complete",
      vendorOrders: [{ status: "delivered", fulfillmentStatus: "complete" }],
    })).toEqual({ status: "returned", fulfillmentStatus: "complete" });

    expect(planParentOrderFulfillment({
      currentStatus: "confirmed",
      currentFulfillmentStatus: "pending",
      vendorOrders: [{ status: "cancelled", fulfillmentStatus: "cancelled" }],
    })).toEqual({ status: "confirmed", fulfillmentStatus: "pending" });
  });
});
