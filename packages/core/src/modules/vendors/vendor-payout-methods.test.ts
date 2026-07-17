import { describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import {
  createVendorPayoutMethod,
  disableVendorPayoutMethod,
  listVendorPayoutMethods,
  moderateVendorPayoutMethod,
  normalizeVendorPayoutDestination,
  setDefaultVendorPayoutMethod,
} from "./vendor-payout-methods";

interface Statement {
  kind: string;
  values?: unknown;
  set?: unknown;
}

function createDb(selectResults: unknown[], batchResults: unknown[][] = []) {
  const queue = [...selectResults];
  const batches = [...batchResults];
  const statements: Statement[] = [];

  function selectChain() {
    const result = queue.shift();
    const chain = {
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      get: vi.fn(async () => result ?? null),
      all: vi.fn(async () => result ?? []),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result ?? []).then(resolve),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => selectChain()) })),
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        const statement = { kind: "insert", values };
        statements.push(statement);
        return statement;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((set: unknown) => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => {
            const statement = { kind: "update", set };
            statements.push(statement);
            return statement;
          }),
        })),
      })),
    })),
    batch: vi.fn(async () => batches.shift() ?? []),
  };
  return { db, statements };
}

const dependencies = {
  now: () => new Date("2026-07-14T10:00:00Z"),
  id: () => "payout_method_1",
  encrypt: vi.fn(async (value: string, key: string) => `encrypted:${key}:${value}`),
  fingerprint: vi.fn(async (value: string) => `fingerprint:${value}`),
};

describe("seller payout methods", () => {
  it("normalizes supported destinations without leaking formatting differences", () => {
    expect(normalizeVendorPayoutDestination("bank", {
      accountName: "  Rahmatullah Zisan ",
      accountNumber: " 0012-3456 7890 ",
      bankName: " Example Bank ",
      branchName: " Dhaka ",
      routingNumber: " 123-456 ",
    })).toEqual({
      accountName: "Rahmatullah Zisan",
      accountNumber: "001234567890",
      bankName: "Example Bank",
      branchName: "Dhaka",
      routingNumber: "123456",
    });
    expect(normalizeVendorPayoutDestination("bkash", {
      accountName: " Seller One ",
      phoneNumber: "+880 1712-345678",
    })).toEqual({ accountName: "Seller One", phoneNumber: "8801712345678" });
  });

  it("rejects incomplete or unsupported sensitive destination payloads", () => {
    expect(() => normalizeVendorPayoutDestination("bank", { accountName: "Only name" })).toThrow(ValidationError);
    expect(() => normalizeVendorPayoutDestination("bkash", { phoneNumber: "123" })).toThrow(ValidationError);
    expect(() => normalizeVendorPayoutDestination("manual", { instructions: "x".repeat(2001) })).toThrow(ValidationError);
  });

  it("creates an encrypted pending destination and atomically switches the default", async () => {
    const { db, statements } = createDb([null], [[[], []]]);
    const result = await createVendorPayoutMethod(
      db as never,
      {
        vendorId: "vendor_1",
        method: "bank",
        displayName: "Primary bank",
        providerName: "Example Bank",
        isDefault: true,
        destination: {
          accountName: "Rahmatullah Zisan",
          accountNumber: "001234567890",
          bankName: "Example Bank",
        },
        encryptionKey: "key",
      },
      dependencies,
    );

    expect(result).toEqual({
      id: "payout_method_1",
      vendorId: "vendor_1",
      method: "bank",
      displayName: "Primary bank",
      lastFour: "7890",
      providerName: "Example Bank",
      isDefault: true,
      status: "pending",
      verifiedBy: null,
      verifiedAt: null,
      rejectionReason: null,
      createdAt: new Date("2026-07-14T10:00:00Z"),
      updatedAt: new Date("2026-07-14T10:00:00Z"),
    });
    expect(dependencies.encrypt).toHaveBeenCalledWith(
      JSON.stringify({
        accountName: "Rahmatullah Zisan",
        accountNumber: "001234567890",
        bankName: "Example Bank",
        branchName: null,
        routingNumber: null,
      }),
      "key",
    );
    expect(statements[0]?.set).toMatchObject({ isDefault: false });
    expect(statements[1]?.values).toMatchObject({
      id: "payout_method_1",
      vendorId: "vendor_1",
      encryptedPayload: expect.stringContaining("encrypted:key:"),
      fingerprint: expect.stringContaining("fingerprint:"),
      lastFour: "7890",
      isDefault: true,
      status: "pending",
    });
  });

  it("fails closed without encryption and rejects duplicate seller destinations", async () => {
    const noKey = createDb([]);
    await expect(createVendorPayoutMethod(noKey.db as never, {
      vendorId: "vendor_1",
      method: "nagad",
      displayName: "Nagad",
      destination: { accountName: "Seller", phoneNumber: "8801712345678" },
      encryptionKey: "",
    }, dependencies)).rejects.toBeInstanceOf(ValidationError);

    const duplicate = createDb([{ id: "existing" }]);
    await expect(createVendorPayoutMethod(duplicate.db as never, {
      vendorId: "vendor_1",
      method: "nagad",
      displayName: "Nagad",
      destination: { accountName: "Seller", phoneNumber: "8801712345678" },
      encryptionKey: "key",
    }, dependencies)).rejects.toBeInstanceOf(ConflictError);
  });

  it("returns masked methods without selecting encrypted payload or fingerprint", async () => {
    const masked = [{
      id: "method_1",
      vendorId: "vendor_1",
      method: "bkash",
      displayName: "Business bKash",
      lastFour: "5678",
      providerName: "bKash",
      isDefault: true,
      status: "verified",
      verifiedBy: "admin_1",
      verifiedAt: new Date(),
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }];
    const { db } = createDb([masked]);
    await expect(listVendorPayoutMethods(db as never, "vendor_1")).resolves.toEqual(masked);
    const selectMock = db.select as unknown as { mock: { calls: unknown[][] } };
    const projection = selectMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(projection).not.toHaveProperty("encryptedPayload");
    expect(projection).not.toHaveProperty("fingerprint");
  });

  it("sets a verified or pending seller-owned method as default atomically", async () => {
    const { db, statements } = createDb([
      { id: "method_1", vendorId: "vendor_1", status: "verified", deletedAt: null },
    ], [[[], [{ id: "method_1" }]]]);
    await expect(setDefaultVendorPayoutMethod(db as never, "vendor_1", "method_1", dependencies)).resolves.toEqual({ id: "method_1", isDefault: true });
    expect(statements[0]?.set).toMatchObject({ isDefault: false });
    expect(statements[1]?.set).toMatchObject({ isDefault: true });
  });

  it("disables a seller-owned method without deleting history and clears default", async () => {
    const { db, statements } = createDb([
      { id: "method_1", vendorId: "vendor_1", status: "pending", deletedAt: null },
    ], [[[{ id: "method_1" }]]]);
    await expect(disableVendorPayoutMethod(db as never, "vendor_1", "method_1", dependencies)).resolves.toEqual({ id: "method_1", status: "disabled" });
    expect(statements[0]?.set).toMatchObject({ status: "disabled", isDefault: false });
  });

  it("rejects cross-seller, rejected, disabled, and missing methods", async () => {
    const missing = createDb([null]);
    await expect(setDefaultVendorPayoutMethod(missing.db as never, "vendor_1", "other", dependencies)).rejects.toBeInstanceOf(NotFoundError);

    for (const status of ["rejected", "disabled"] as const) {
      const blocked = createDb([{ id: "method_1", vendorId: "vendor_1", status, deletedAt: null }]);
      await expect(setDefaultVendorPayoutMethod(blocked.db as never, "vendor_1", "method_1", dependencies)).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("verifies a pending payout method with platform actor audit fields", async () => {
    const { db, statements } = createDb([
      { id: "method_1", status: "pending", deletedAt: null },
    ], [[[{ id: "method_1", status: "verified" }]]]);

    await expect(moderateVendorPayoutMethod(db as never, {
      methodId: "method_1",
      actorUserId: "admin_1",
      status: "verified",
    }, dependencies)).resolves.toEqual({ id: "method_1", status: "verified" });
    expect(statements[0]?.set).toMatchObject({
      status: "verified",
      verifiedBy: "admin_1",
      verifiedAt: new Date("2026-07-14T10:00:00Z"),
      rejectionReason: null,
    });
  });

  it("requires a reason when rejecting a pending payout method", async () => {
    const missingReason = createDb([
      { id: "method_1", status: "pending", deletedAt: null },
    ]);
    await expect(moderateVendorPayoutMethod(missingReason.db as never, {
      methodId: "method_1",
      actorUserId: "admin_1",
      status: "rejected",
    }, dependencies)).rejects.toBeInstanceOf(ValidationError);

    const rejected = createDb([
      { id: "method_1", status: "pending", deletedAt: null },
    ], [[[{ id: "method_1", status: "rejected" }]]]);
    await expect(moderateVendorPayoutMethod(rejected.db as never, {
      methodId: "method_1",
      actorUserId: "admin_1",
      status: "rejected",
      reason: "Account ownership could not be verified",
    }, dependencies)).resolves.toEqual({ id: "method_1", status: "rejected" });
    expect(rejected.statements[0]?.set).toMatchObject({
      status: "rejected",
      verifiedBy: "admin_1",
      verifiedAt: null,
      rejectionReason: "Account ownership could not be verified",
    });
  });

  it("does not moderate verified, rejected, disabled, or concurrently changed methods", async () => {
    for (const status of ["verified", "rejected", "disabled"] as const) {
      const blocked = createDb([{ id: "method_1", status, deletedAt: null }]);
      await expect(moderateVendorPayoutMethod(blocked.db as never, {
        methodId: "method_1",
        actorUserId: "admin_1",
        status: "verified",
      }, dependencies)).rejects.toBeInstanceOf(ValidationError);
    }

    const stale = createDb([
      { id: "method_1", status: "pending", deletedAt: null },
    ], [[[]]]);
    await expect(moderateVendorPayoutMethod(stale.db as never, {
      methodId: "method_1",
      actorUserId: "admin_1",
      status: "verified",
    }, dependencies)).rejects.toBeInstanceOf(ConflictError);
  });
});
