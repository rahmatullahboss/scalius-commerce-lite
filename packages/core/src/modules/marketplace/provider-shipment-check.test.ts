import { describe, expect, it, vi } from "vitest";
import { NotFoundError, ServiceUnavailableError, ValidationError } from "../../errors";
import {
  checkVendorProviderShipmentStatus,
  type VendorProviderShipmentCheckDependencies,
} from "./provider-shipment-check";

function createDb(result: unknown) {
  const chain = {
    where: vi.fn(() => chain),
    get: vi.fn(async () => result),
  };
  return { select: vi.fn(() => ({ from: vi.fn(() => chain) })) };
}

function dependencies(overrides: Partial<VendorProviderShipmentCheckDependencies> = {}) {
  const checkShipmentStatus = vi.fn(async () => ({
    status: "in_transit",
    rawStatus: "in_delivery",
    updatedAt: new Date("2026-07-14T05:00:00Z"),
    metadata: { delivery_status: "in_delivery" },
  }));
  const projectVendorShipmentProviderStatus = vi.fn(async () => ({
    shipmentId: "shipment_1",
    orderId: "order_1",
    vendorId: "vendor_1",
    previousStatus: "processing" as const,
    status: "in_transit" as const,
    version: 3,
    applied: true,
    path: ["in_transit" as const],
  }));
  const deps: VendorProviderShipmentCheckDependencies = {
    getDeliveryProvider: vi.fn(async () => ({
      id: "provider_1",
      type: "steadfast",
      name: "Steadfast",
      isActive: true,
    }) as never),
    createProvider: vi.fn(async () => ({ checkShipmentStatus }) as never),
    projectVendorShipmentProviderStatus,
    ...overrides,
  };
  return { deps, checkShipmentStatus, projectVendorShipmentProviderStatus };
}

const shipment = {
  shipmentId: "shipment_1",
  orderId: "order_1",
  vendorId: "vendor_1",
  providerId: "provider_1",
  providerType: "steadfast",
  externalId: "12345",
  trackingId: "TRK-1",
  status: "processing",
  version: 2,
};

describe("seller courier status polling", () => {
  it("reuses the configured provider checker and canonical status projection", async () => {
    const db = createDb(shipment);
    const { deps, checkShipmentStatus, projectVendorShipmentProviderStatus } = dependencies();

    await expect(checkVendorProviderShipmentStatus(
      db as never,
      { shipmentId: "shipment_1", vendorId: "vendor_1" },
      "encryption-key",
      deps,
    )).resolves.toMatchObject({
      shipmentId: "shipment_1",
      status: "in_transit",
      rawStatus: "in_delivery",
      applied: true,
      version: 3,
    });

    expect(checkShipmentStatus).toHaveBeenCalledWith("12345");
    expect(projectVendorShipmentProviderStatus).toHaveBeenCalledWith(db, {
      providerType: "steadfast",
      providerId: "provider_1",
      externalId: "12345",
      trackingId: "TRK-1",
      rawStatus: "in_delivery",
      status: "in_transit",
    });
  });

  it("rejects cross-seller, manual, missing-reference, and inactive provider checks", async () => {
    const { deps } = dependencies();
    await expect(checkVendorProviderShipmentStatus(
      createDb(null) as never,
      { shipmentId: "missing", vendorId: "vendor_1" },
      "encryption-key",
      deps,
    )).rejects.toBeInstanceOf(NotFoundError);

    await expect(checkVendorProviderShipmentStatus(
      createDb({ ...shipment, providerId: null, providerType: "manual" }) as never,
      { shipmentId: "shipment_1", vendorId: "vendor_1" },
      "encryption-key",
      deps,
    )).rejects.toBeInstanceOf(ValidationError);

    await expect(checkVendorProviderShipmentStatus(
      createDb({ ...shipment, externalId: null }) as never,
      { shipmentId: "shipment_1", vendorId: "vendor_1" },
      "encryption-key",
      deps,
    )).rejects.toBeInstanceOf(ValidationError);

    const inactive = dependencies({
      getDeliveryProvider: vi.fn(async () => ({ ...shipment, id: "provider_1", isActive: false }) as never),
    });
    await expect(checkVendorProviderShipmentStatus(
      createDb(shipment) as never,
      { shipmentId: "shipment_1", vendorId: "vendor_1" },
      "encryption-key",
      inactive.deps,
    )).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not persist an unknown provider status", async () => {
    const checkShipmentStatus = vi.fn(async () => ({
      status: "unknown",
      rawStatus: "error",
      updatedAt: new Date(),
      metadata: { error: "provider unavailable" },
    }));
    const { deps, projectVendorShipmentProviderStatus } = dependencies({
      createProvider: vi.fn(async () => ({ checkShipmentStatus }) as never),
    });

    await expect(checkVendorProviderShipmentStatus(
      createDb(shipment) as never,
      { shipmentId: "shipment_1", vendorId: "vendor_1" },
      "encryption-key",
      deps,
    )).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(projectVendorShipmentProviderStatus).not.toHaveBeenCalled();
  });

  it("reports an ignored backward provider regression without changing the shipment", async () => {
    const { deps } = dependencies({
      projectVendorShipmentProviderStatus: vi.fn(async () => ({
        shipmentId: "shipment_1",
        orderId: "order_1",
        vendorId: "vendor_1",
        previousStatus: "delivered" as const,
        status: "delivered" as const,
        version: 8,
        applied: false,
        path: null,
      })),
    });

    await expect(checkVendorProviderShipmentStatus(
      createDb({ ...shipment, status: "delivered", version: 8 }) as never,
      { shipmentId: "shipment_1", vendorId: "vendor_1" },
      "encryption-key",
      deps,
    )).resolves.toMatchObject({
      status: "delivered",
      applied: false,
      version: 8,
    });
  });
});
