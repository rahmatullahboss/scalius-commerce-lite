import { describe, expect, it } from "vitest";
import {
  formatCustomerOrderShipmentViews,
  getLatestCustomerOrderShipment,
} from "./customer-order-shipment-view";

describe("customer order shipment views", () => {
  it("merges legacy and seller packages newest-first without exposing seller metadata", () => {
    const shipments = formatCustomerOrderShipmentViews({
      legacyShipments: [{
        id: "legacy_1",
        providerType: "manual",
        providerName: null,
        status: "processing",
        rawStatus: null,
        trackingId: null,
        trackingUrl: null,
        courierName: "Own rider",
        note: "Call before delivery",
        shipmentAmount: 100,
        isFinalShipment: false,
        lastChecked: null,
        updatedAt: 20,
        createdAt: 10,
      }],
      vendorShipments: [{
        id: "vendor_shipment_1",
        vendorOrderId: "vendor_order_1",
        vendorId: "vendor_1",
        vendorName: "Seller One",
        vendorSlug: "seller-one",
        providerType: "pathao",
        providerName: "Pathao",
        status: "in_transit",
        rawStatus: "order.in_transit",
        trackingId: "TRK-1",
        trackingUrl: "https://tracking.example/TRK-1",
        courierName: null,
        shipmentAmountMinor: 12550,
        isFinalShipment: true,
        lastCheckedAt: 40,
        updatedAt: 40,
        createdAt: 30,
      }],
      vendorShipmentItems: [{
        shipmentId: "vendor_shipment_1",
        orderItemId: "item_1",
        quantity: 2,
        productName: "Product A",
        variantLabel: "Large",
      }],
    });

    expect(shipments).toHaveLength(2);
    expect(shipments[0]).toMatchObject({
      id: "vendor_shipment_1",
      scope: "vendor",
      vendorOrderId: "vendor_order_1",
      vendorName: "Seller One",
      vendorSlug: "seller-one",
      shipmentAmount: 125.5,
      note: null,
      items: [{
        orderItemId: "item_1",
        quantity: 2,
        productName: "Product A",
        variantLabel: "Large",
      }],
    });
    expect(shipments[0]).not.toHaveProperty("vendorId");
    expect(shipments[0]).not.toHaveProperty("metadata");
    expect(shipments[1]).toMatchObject({
      id: "legacy_1",
      scope: "order",
      vendorOrderId: null,
      vendorName: null,
      vendorSlug: null,
      items: [],
    });
  });

  it("returns the newest merged package for backward-compatible order summaries", () => {
    const shipments = formatCustomerOrderShipmentViews({
      legacyShipments: [{
        id: "legacy_1",
        providerType: "manual",
        providerName: null,
        status: "processing",
        rawStatus: null,
        trackingId: null,
        trackingUrl: null,
        courierName: "Own rider",
        note: null,
        shipmentAmount: null,
        isFinalShipment: false,
        lastChecked: null,
        updatedAt: 10,
        createdAt: 10,
      }],
      vendorShipments: [{
        id: "vendor_shipment_1",
        vendorOrderId: "vendor_order_1",
        vendorId: "vendor_1",
        vendorName: "Seller One",
        vendorSlug: "seller-one",
        providerType: "steadfast",
        providerName: "Steadfast",
        status: "pending",
        rawStatus: null,
        trackingId: "INV-1",
        trackingUrl: null,
        courierName: null,
        shipmentAmountMinor: 0,
        isFinalShipment: false,
        lastCheckedAt: null,
        updatedAt: 20,
        createdAt: 20,
      }],
      vendorShipmentItems: [],
    });

    expect(getLatestCustomerOrderShipment(shipments)?.id).toBe("vendor_shipment_1");
  });
});
