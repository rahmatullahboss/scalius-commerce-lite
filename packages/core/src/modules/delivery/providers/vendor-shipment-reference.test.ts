import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@scalius/database/schema";

vi.mock("../locations", () => ({
  getExternalLocationIds: vi.fn(async () => ({ city: 10, zone: 20, area: 30 })),
}));

import { buildVendorShipmentProviderOrder } from "../../marketplace/provider-shipment";
import { PathaoProvider } from "./pathao";
import { SteadfastProvider } from "./steadfast";

const REDACTED = "[REDACTED_SECRET]";
const order = {
  id: "order_parent_1",
  customerName: "Customer",
  customerPhone: "01700000000",
  shippingAddress: "Dhaka",
  city: "Dhaka",
  zone: "Dhanmondi",
  area: "Road 1",
  totalAmount: 1000,
  paidAmount: 0,
  balanceDue: 1000,
  notes: null,
} as unknown as Order;

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    statusText: ok ? "OK" : "Bad Request",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("delivery provider seller-shipment reference", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the canonical vendor shipment ID as Pathao merchant_order_id", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        expires_in: 7200,
        access_token: REDACTED,
        refresh_token: REDACTED,
      }))
      .mockResolvedValueOnce(jsonResponse({
        message: "created",
        type: "success",
        code: 200,
        data: {
          consignment_id: "pathao-1",
          order_status: "Pending",
          delivery_fee: 80,
        },
      }));

    const provider = new PathaoProvider({
      baseUrl: "https://pathao.example",
      clientId: "client",
      clientSecret: REDACTED,
      username: "user",
      password: REDACTED,
    }, {
      storeId: "1",
      defaultDeliveryType: 48,
      defaultItemType: 2,
      defaultItemWeight: 0.5,
    }, {} as never);

    const providerOrder = buildVendorShipmentProviderOrder(
      order,
      "vendor_shipment:vendor-a:1",
      50000,
    );
    await provider.createShipment(providerOrder, {
      itemCount: 1,
      itemDescription: "Item A x1",
      codAmount: 500,
    });

    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(payload.merchant_order_id).toBe("vendor_shipment:vendor-a:1");
    expect(order.id).toBe("order_parent_1");
  });

  it("uses the canonical vendor shipment ID as Steadfast invoice", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 200,
      message: "created",
      consignment: {
        consignment_id: 12,
        invoice: "vendor_shipment:vendor-b:1",
        tracking_code: "tracking-12",
        recipient_name: "Customer",
        recipient_phone: "01700000000",
        recipient_address: "Dhaka",
        cod_amount: 500,
        status: "pending",
        note: null,
        created_at: "2026-07-14T00:00:00Z",
        updated_at: "2026-07-14T00:00:00Z",
      },
    }));

    const provider = new SteadfastProvider({
      baseUrl: "https://steadfast.example",
      apiKey: REDACTED,
      secretKey: REDACTED,
    }, {
      defaultCodAmount: 0,
    });

    const providerOrder = buildVendorShipmentProviderOrder(
      order,
      "vendor_shipment:vendor-b:1",
      50000,
    );
    await provider.createShipment(providerOrder, { codAmount: 500 });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(payload.invoice).toBe("vendor_shipment:vendor-b:1");
    expect(order.id).toBe("order_parent_1");
  });
});
