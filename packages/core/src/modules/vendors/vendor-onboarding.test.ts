import { describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "../../errors";
import { applyForVendor } from "./vendor-onboarding";

type Statement = {
  kind: "insert" | "update";
  table: unknown;
  values: unknown;
};

function createOnboardingDb(
  selectResults: unknown[][],
  options: { batchError?: Error } = {},
) {
  const queued = [...selectResults];
  const statements: Statement[] = [];
  const batches: Statement[][] = [];

  function selectChain(result: unknown[]) {
    const chain = {
      where: () => chain,
      limit: () => chain,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => selectChain(queued.shift() ?? [])),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        const statement: Statement = { kind: "insert", table, values };
        statements.push(statement);
        return statement;
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: unknown) => ({
        where: vi.fn(() => {
          const statement: Statement = { kind: "update", table, values };
          statements.push(statement);
          return statement;
        }),
      })),
    })),
    batch: vi.fn(async (batch: Statement[]) => {
      batches.push(batch);
      if (options.batchError) throw options.batchError;
      return batch.map(() => []);
    }),
  };

  return { db, statements, batches };
}

function dependencies() {
  let index = 0;
  return {
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    id: () => `onboarding_${++index}`,
  };
}

const input = {
  applicantUserId: "user_1",
  name: "Seller One",
  slug: "seller-one",
  legalName: "Seller One Limited",
  contactEmail: "owner@example.com",
  contactPhone: "+8801700000000",
  businessAddress: "Business address",
  district: "Dhaka",
  upazila: "Dhanmondi",
  pickupAddress: "Pickup address",
};

describe("seller onboarding", () => {
  it("creates a pending vendor application, owner membership, zero commission rule, addresses, and audit event atomically", async () => {
    const { db, batches } = createOnboardingDb([
      [], // no existing owner membership
      [], // slug is available
    ]);

    const result = await applyForVendor(db as never, input, dependencies());

    expect(result).toEqual({
      vendorId: "onboarding_1",
      status: "pending",
      replayed: false,
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(6);
    expect(batches[0]?.[0]?.values).toMatchObject({
      id: "onboarding_1",
      name: "Seller One",
      slug: "seller-one",
      status: "pending",
    });
    expect(batches[0]?.[1]?.values).toMatchObject({
      vendorId: "onboarding_1",
      userId: "user_1",
      role: "owner",
      status: "active",
    });
    expect(batches[0]?.[2]?.values).toMatchObject({
      scope: "vendor",
      vendorId: "onboarding_1",
      rateBps: 0,
      status: "active",
      createdBy: "user_1",
    });
    expect(batches[0]?.[5]?.values).toMatchObject({
      vendorId: "onboarding_1",
      fromStatus: null,
      toStatus: "pending",
      actorUserId: "user_1",
      metadata: { source: "seller_application" },
    });
  });

  it("replays an existing pending owner application instead of creating a duplicate", async () => {
    const { db, batches } = createOnboardingDb([
      [{ vendorId: "vendor_existing" }],
      [{ id: "vendor_existing", status: "pending" }],
    ]);

    await expect(applyForVendor(db as never, input, dependencies())).resolves.toEqual({
      vendorId: "vendor_existing",
      status: "pending",
      replayed: true,
    });
    expect(batches).toHaveLength(0);
  });

  it("corrects and resubmits an existing rejected owner application atomically", async () => {
    const { db, batches } = createOnboardingDb([
      [{ vendorId: "vendor_existing" }],
      [{ id: "vendor_existing", status: "rejected", slug: "seller-one" }],
      [{ id: "vendor_existing" }], // same slug remains reserved by this seller
      [
        { id: "address_business", type: "business" },
        { id: "address_pickup", type: "pickup" },
      ],
    ]);

    await expect(applyForVendor(db as never, {
      ...input,
      name: "Seller One Corrected",
      businessAddress: "Corrected business address",
      pickupAddress: "Corrected pickup address",
    }, dependencies())).resolves.toEqual({
      vendorId: "vendor_existing",
      status: "pending",
      replayed: false,
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(4);
    expect(batches[0]?.[0]).toMatchObject({
      kind: "update",
      values: {
        name: "Seller One Corrected",
        slug: "seller-one",
        status: "pending",
      },
    });
    expect(batches[0]?.[1]).toMatchObject({
      kind: "update",
      values: { addressLine1: "Corrected business address" },
    });
    expect(batches[0]?.[2]).toMatchObject({
      kind: "update",
      values: { addressLine1: "Corrected pickup address" },
    });
    expect(batches[0]?.[3]).toMatchObject({
      kind: "insert",
      values: {
        vendorId: "vendor_existing",
        fromStatus: "rejected",
        toStatus: "pending",
        actorUserId: "user_1",
        metadata: { source: "seller_application_resubmission" },
      },
    });
  });

  it("rejects a corrected slug that is reserved by another seller", async () => {
    const { db, batches } = createOnboardingDb([
      [{ vendorId: "vendor_existing" }],
      [{ id: "vendor_existing", status: "rejected", slug: "seller-one" }],
      [{ id: "vendor_other" }],
    ]);

    await expect(applyForVendor(db as never, {
      ...input,
      slug: "seller-one-corrected",
    }, dependencies())).rejects.toBeInstanceOf(ConflictError);
    expect(batches).toHaveLength(0);
  });

  it("recreates missing canonical addresses while resubmitting a rejected application", async () => {
    const { db, batches } = createOnboardingDb([
      [{ vendorId: "vendor_existing" }],
      [{ id: "vendor_existing", status: "rejected", slug: "seller-one" }],
      [{ id: "vendor_existing" }],
      [],
    ]);

    await expect(applyForVendor(db as never, input, dependencies())).resolves.toMatchObject({
      vendorId: "vendor_existing",
      status: "pending",
      replayed: false,
    });
    expect(batches[0]?.[1]?.kind).toBe("insert");
    expect(batches[0]?.[1]?.values).toMatchObject({
      vendorId: "vendor_existing",
      type: "business",
    });
    expect(batches[0]?.[2]?.kind).toBe("insert");
    expect(batches[0]?.[2]?.values).toMatchObject({
      vendorId: "vendor_existing",
      type: "pickup",
    });
  });

  it("blocks another application when the account already owns a non-pending vendor", async () => {
    const { db } = createOnboardingDb([
      [{ vendorId: "vendor_existing" }],
      [{ id: "vendor_existing", status: "approved", slug: "seller-one" }],
    ]);

    await expect(applyForVendor(db as never, input, dependencies())).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an already reserved slug before writing", async () => {
    const { db, batches } = createOnboardingDb([
      [],
      [{ id: "vendor_other" }],
    ]);

    await expect(applyForVendor(db as never, input, dependencies())).rejects.toBeInstanceOf(ConflictError);
    expect(batches).toHaveLength(0);
  });

  it("maps a concurrent slug uniqueness race to ConflictError", async () => {
    const { db } = createOnboardingDb([
      [],
      [],
    ], {
      batchError: new Error("D1_ERROR: UNIQUE constraint failed: vendors.slug"),
    });

    await expect(applyForVendor(db as never, input, dependencies())).rejects.toBeInstanceOf(ConflictError);
  });

  it("maps a concurrent second owner-store race to ConflictError", async () => {
    const { db } = createOnboardingDb([
      [],
      [],
    ], {
      batchError: new Error("D1_ERROR: UNIQUE constraint failed: vendor_users.user_id"),
    });

    await expect(applyForVendor(db as never, {
      ...input,
      slug: "another-seller-url",
    }, dependencies())).rejects.toBeInstanceOf(ConflictError);
  });

  it("normalizes and validates seller application fields", async () => {
    const { db } = createOnboardingDb([[], []]);

    await expect(applyForVendor(db as never, {
      ...input,
      name: " ",
    }, dependencies())).rejects.toBeInstanceOf(ValidationError);

    await expect(applyForVendor(db as never, {
      ...input,
      slug: "Not A Valid Slug!",
    }, dependencies())).rejects.toBeInstanceOf(ValidationError);
  });
});
