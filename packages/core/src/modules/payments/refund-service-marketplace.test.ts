import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStripeSettings: vi.fn(),
  createPaymentProvider: vi.fn(),
  providerCreateRefund: vi.fn(),
  getCurrencyConfig: vi.fn(),
  canTransitionTo: vi.fn(),
  applyInventoryForStatusChange: vi.fn(),
  loadMarketplaceRefundPlan: vi.fn(),
  buildCompletedMarketplaceRefundStatements: vi.fn(),
}));

vi.mock("./gateway-settings", () => ({
  FRESH_GATEWAY_SETTINGS_READ_OPTIONS: { bypassMemoryCache: true },
  getStripeSettings: mocks.getStripeSettings,
  getSSLCommerzSettings: vi.fn(),
  getPolarSettings: vi.fn(),
}));

vi.mock("./factory", () => ({
  createPaymentProvider: mocks.createPaymentProvider,
}));

vi.mock("../settings/settings.service", () => ({
  getCurrencyConfig: mocks.getCurrencyConfig,
}));

vi.mock("../orders/order-state-machine", () => ({
  canTransitionTo: mocks.canTransitionTo,
}));

vi.mock("../inventory/inventory-transitions", () => ({
  applyInventoryForStatusChange: mocks.applyInventoryForStatusChange,
}));

vi.mock("../marketplace/refund-planning", () => ({
  loadMarketplaceRefundPlan: mocks.loadMarketplaceRefundPlan,
}));

vi.mock("../marketplace/refund-allocation", () => ({
  buildCompletedMarketplaceRefundStatements:
    mocks.buildCompletedMarketplaceRefundStatements,
}));

import { OrderStatus, PaymentStatus } from "@scalius/database/schema";
import { processRefund } from "./refund-service";

function createDbMock() {
  const selectValues = [
    {
      id: "order_1",
      totalAmount: 100,
      paidAmount: 100,
      paymentStatus: PaymentStatus.PAID,
      paymentMethod: "stripe",
      status: OrderStatus.PROCESSING,
      inventoryAction: "reserved",
      version: 3,
      shipmentClaimId: null,
      shipmentClaimExpiresAt: null,
    },
    null,
    {
      id: "payment_1",
      orderId: "order_1",
      paymentMethod: "stripe",
      status: "succeeded",
      stripeChargeId: "ch_1",
      sslcommerzBankTranId: null,
      polarCheckoutId: null,
      metadata: null,
    },
  ];
  const updateStatements: unknown[] = [];
  const update = vi.fn(() => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn(() => {
        const statement = {
          kind: "update",
          values,
          returning: vi.fn(() => ({ kind: "returning-update" })),
        };
        updateStatements.push(statement);
        return statement;
      }),
    })),
  }));
  const batch = vi
    .fn()
    .mockResolvedValueOnce([undefined, [{ id: "order_1", version: 4 }]])
    .mockResolvedValueOnce([[], [], [], []]);

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              get: vi.fn(async () => selectValues.shift() ?? null),
            })),
            get: vi.fn(async () => selectValues.shift() ?? null),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ kind: "refund-claim-insert" })),
      })),
      update,
      delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      batch,
    },
    batch,
    updateStatements,
  };
}

describe("marketplace refund finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrencyConfig.mockResolvedValue({ code: "BDT" });
    mocks.canTransitionTo.mockReturnValue(false);
    mocks.providerCreateRefund.mockResolvedValue({ refundId: "re_provider_1" });
    mocks.createPaymentProvider.mockReturnValue({
      createRefund: mocks.providerCreateRefund,
    });
    mocks.getStripeSettings.mockResolvedValue({
      enabled: true,
      secretKey: "sk_test",
    });
    mocks.loadMarketplaceRefundPlan.mockResolvedValue({
      isFullRemainingRefund: false,
      amountMinor: 1_000,
      allocations: [
        {
          orderItemId: "item_1",
          vendorOrderId: "vendor_order_1",
          vendorId: "vendor_1",
          quantity: 1,
          refundAmountMinor: 1_000,
          grossMinor: 1_000,
          discountReversalMinor: 0,
          shippingReversalMinor: 0,
          taxReversalMinor: 0,
          commissionReversalMinor: 100,
          vendorNetReversalMinor: 900,
        },
      ],
    });
    mocks.buildCompletedMarketplaceRefundStatements.mockReturnValue({
      amountMinor: 1_000,
      statements: [
        { kind: "refund-insert" },
        { kind: "refund-items-insert" },
        { kind: "refund-outbox-insert" },
      ],
    });
  });

  it("plans item allocations before provider dispatch and finalizes normalized refund records in one local batch", async () => {
    const { db, batch } = createDbMock();

    const result = await processRefund(
      db as never,
      { id: "kv" } as unknown as KVNamespace,
      {
        orderId: "order_1",
        amount: 10,
        reason: "customer_request",
        gateway: "stripe",
        actorUserId: "admin_1",
        items: [{ orderItemId: "item_1", quantity: 1 }],
      },
      "enc-key",
    );

    expect(result).toMatchObject({
      success: true,
      gateway: "stripe",
      refundId: "re_provider_1",
      amount: 10,
      isFullRefund: false,
    });
    expect(mocks.loadMarketplaceRefundPlan).toHaveBeenCalledWith(
      db,
      {
        orderId: "order_1",
        currentPaidMinor: 10_000,
        requestedAmountMinor: 1_000,
        selections: [{ orderItemId: "item_1", quantity: 1 }],
      },
    );
    expect(mocks.providerCreateRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1_000 }),
    );
    expect(mocks.buildCompletedMarketplaceRefundStatements).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        refundId: "refund_order_1_3",
        orderId: "order_1",
        orderPaymentId: "payment_1",
        gateway: "stripe",
        providerRefundId: "re_provider_1",
        currency: "BDT",
        actorUserId: "admin_1",
        claimKey: "refund:order_1:v3",
        allocations: expect.any(Array),
      }),
    );
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({ kind: "update" }),
      { kind: "refund-insert" },
      { kind: "refund-items-insert" },
      { kind: "refund-outbox-insert" },
    ]);
  });
});
