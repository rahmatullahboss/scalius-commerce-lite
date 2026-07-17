import { describe, expect, it, vi } from "vitest";
import {
  createVendorCommand,
  moderateProductCommand,
  moderateVendorCommand,
  updateVendorCommand,
} from "./vendor-commands";

type Statement = {
  kind: "insert" | "update";
  table: unknown;
  values?: unknown;
  set?: unknown;
  where?: unknown;
};

function createCommandDb(selectResults: unknown[][]) {
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
      set: vi.fn((set: unknown) => ({
        where: vi.fn((where: unknown) => {
          const statement: Statement = { kind: "update", table, set, where };
          statements.push(statement);
          return statement;
        }),
      })),
    })),
    batch: vi.fn(async (batch: Statement[]) => {
      batches.push(batch);
      return batch.map(() => []);
    }),
  };

  return { db, statements, batches };
}

const dependencies = {
  now: () => new Date("2026-07-14T00:00:00.000Z"),
  id: (() => {
    let index = 0;
    return () => `id_${++index}`;
  })(),
};

describe("vendor domain commands", () => {
  it("creates vendor, owner, commission, and addresses in one batch", async () => {
    const { db, batches } = createCommandDb([
      [],
      [{ id: "user_owner" }],
    ]);

    const result = await createVendorCommand(db as never, {
      name: "Seller One",
      slug: "seller-one",
      legalName: null,
      status: "pending",
      ownerUserId: "user_owner",
      commissionBps: 1250,
      contactEmail: null,
      contactPhone: null,
      businessAddress: "Business address",
      district: "Dhaka",
      upazila: null,
      pickupAddress: "Pickup address",
    }, dependencies);

    expect(result.vendorId).toBe("id_1");
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(5);
    expect(batches[0]!.map((statement) => statement.kind)).toEqual([
      "insert",
      "insert",
      "insert",
      "insert",
      "insert",
    ]);
  });

  it("transfers owner and rotates commission in the same update batch", async () => {
    const { db, batches } = createCommandDb([
      [{ id: "vendor_1", status: "approved" }],
      [{ id: "user_next" }],
      [{ id: "membership_next" }],
    ]);

    await updateVendorCommand(db as never, "vendor_1", {
      ownerUserId: "user_next",
      commissionBps: 900,
    }, dependencies);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(5);
    expect(batches[0]!.map((statement) => statement.kind)).toEqual([
      "update",
      "update",
      "update",
      "update",
      "insert",
    ]);
  });

  it("records vendor and product moderation transitions atomically with actor and version", async () => {
    const vendorDb = createCommandDb([[{ id: "vendor_1", status: "pending" }]]);
    await moderateVendorCommand(
      vendorDb.db as never,
      "vendor_1",
      { status: "approved", reason: "Verified", actorUserId: "admin_1" },
      dependencies,
    );
    expect(vendorDb.batches[0]).toHaveLength(2);

    const productDb = createCommandDb([[
      {
        id: "product_1",
        vendorId: "vendor_1",
        approvalStatus: "submitted",
        moderationVersion: 4,
      },
    ]]);
    const result = await moderateProductCommand(
      productDb.db as never,
      "product_1",
      { status: "approved", reason: "Catalog review", actorUserId: "admin_1" },
      dependencies,
    );

    expect(result.moderationVersion).toBe(5);
    expect(productDb.batches[0]).toHaveLength(2);
    expect(productDb.batches[0]![1]!.values).toMatchObject({
      productId: "product_1",
      vendorId: "vendor_1",
      fromStatus: "submitted",
      toStatus: "approved",
      moderationVersion: 5,
      actorUserId: "admin_1",
    });
  });
});
