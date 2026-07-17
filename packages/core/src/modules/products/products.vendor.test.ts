import { describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import {
  createVendorProduct,
  submitVendorProduct,
  updateVendorProduct,
} from "./products.vendor";

interface Statement {
  kind: "insert" | "update" | "delete";
  table: unknown;
  values?: unknown;
  set?: unknown;
}

function createDb(selectResults: unknown[]) {
  const queue = [...selectResults];
  const statements: Statement[] = [];
  const batches: Statement[][] = [];

  function selectChain() {
    const result = queue.shift();
    const chain = {
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      get: vi.fn(async () => result ?? null),
      all: vi.fn(async () => result ?? []),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result ?? []).then(resolve),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => selectChain()) })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        const statement: Statement = { kind: "insert", table, values };
        statements.push(statement);
        return statement;
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((set: unknown) => ({
        where: vi.fn(() => {
          const statement: Statement = { kind: "update", table, set };
          statements.push(statement);
          return statement;
        }),
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(() => {
        const statement: Statement = { kind: "delete", table };
        statements.push(statement);
        return statement;
      }),
    })),
    batch: vi.fn(async (batch: Statement[]) => {
      batches.push(batch);
      return batch.map(() => []);
    }),
  };

  return { db, statements, batches };
}

const productInput = {
  name: "Seller Product",
  description: "A seller-owned marketplace product.",
  price: 1250,
  categoryId: "category_1",
  isActive: true,
  discountType: "percentage" as const,
  discountPercentage: 10,
  discountAmount: null,
  freeDelivery: false,
  metaTitle: "Seller Product",
  metaDescription: "Seller product description",
  slug: "seller-product",
  images: [
    {
      id: "temp_image_1",
      url: "https://cdn.example/product.jpg",
      filename: "product.jpg",
      size: 1234,
      createdAt: new Date("2026-07-14T00:00:00Z"),
    },
  ],
  attributes: [{ attributeId: "attribute_1", value: "Cotton" }],
  additionalInfo: [{ id: "item-1", title: "Care", content: "Hand wash", sortOrder: 0 }],
};

function dependencies() {
  let id = 0;
  return {
    now: () => new Date("2026-07-14T00:00:00Z"),
    id: () => `generated_${++id}`,
  };
}

describe("seller catalog commands", () => {
  it("creates an inactive seller-owned draft and moderation event atomically", async () => {
    const { db, batches } = createDb([null]);

    const result = await createVendorProduct(
      db as never,
      {
        vendorId: "vendor_1",
        actorUserId: "user_1",
        data: productInput,
      },
      dependencies(),
    );

    expect(result).toEqual({ productId: "generated_1", approvalStatus: "draft" });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(6);
    expect(batches[0]?.[0]?.values).toMatchObject({
      id: "generated_1",
      vendorId: "vendor_1",
      approvalStatus: "draft",
      moderationVersion: 1,
      isActive: true,
    });
    expect(batches[0]?.[5]?.values).toMatchObject({
      productId: "generated_1",
      vendorId: "vendor_1",
      fromStatus: null,
      toStatus: "draft",
      actorUserId: "user_1",
      moderationVersion: 1,
    });
  });

  it("rejects duplicate slugs before writing", async () => {
    const { db, batches } = createDb([{ id: "existing_product" }]);

    await expect(
      createVendorProduct(
        db as never,
        { vendorId: "vendor_1", actorUserId: "user_1", data: productInput },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(batches).toHaveLength(0);
  });

  it("moves an approved seller product to inactive submitted revision when edited", async () => {
    const { db, batches } = createDb([
      {
        id: "product_1",
        vendorId: "vendor_1",
        approvalStatus: "approved",
        moderationVersion: 4,
      },
      null,
      [{ id: "variant_default", isDefault: true, size: null, color: null }],
    ]);

    const result = await updateVendorProduct(
      db as never,
      {
        vendorId: "vendor_1",
        productId: "product_1",
        actorUserId: "user_1",
        data: { ...productInput, id: "product_1", name: "Updated Seller Product" },
      },
      dependencies(),
    );

    expect(result).toEqual({ approvalStatus: "submitted", moderationVersion: 5 });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.[0]?.set).toMatchObject({
      name: "Updated Seller Product",
      approvalStatus: "submitted",
      moderationVersion: 5,
      isActive: true,
    });
    expect(batches[0]?.at(-1)?.values).toMatchObject({
      productId: "product_1",
      vendorId: "vendor_1",
      fromStatus: "approved",
      toStatus: "submitted",
      actorUserId: "user_1",
      moderationVersion: 5,
    });
  });

  it("returns a rejected product to draft when edited", async () => {
    const { db } = createDb([
      {
        id: "product_1",
        vendorId: "vendor_1",
        approvalStatus: "rejected",
        moderationVersion: 2,
      },
      null,
      [],
    ]);

    await expect(
      updateVendorProduct(
        db as never,
        {
          vendorId: "vendor_1",
          productId: "product_1",
          actorUserId: "user_1",
          data: { ...productInput, id: "product_1" },
        },
        dependencies(),
      ),
    ).resolves.toEqual({ approvalStatus: "draft", moderationVersion: 3 });
  });

  it("blocks cross-seller, submitted, and suspended product edits", async () => {
    const crossSeller = createDb([null]);
    await expect(
      updateVendorProduct(
        crossSeller.db as never,
        {
          vendorId: "vendor_1",
          productId: "product_other",
          actorUserId: "user_1",
          data: { ...productInput, id: "product_other" },
        },
        dependencies(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    for (const status of ["submitted", "suspended"] as const) {
      const blocked = createDb([{
        id: "product_1",
        vendorId: "vendor_1",
        approvalStatus: status,
        moderationVersion: 2,
      }]);
      await expect(
        updateVendorProduct(
          blocked.db as never,
          {
            vendorId: "vendor_1",
            productId: "product_1",
            actorUserId: "user_1",
            data: { ...productInput, id: "product_1" },
          },
          dependencies(),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("submits a seller-owned draft for moderation and is idempotent for submitted status", async () => {
    const draft = createDb([{
      id: "product_1",
      vendorId: "vendor_1",
      approvalStatus: "draft",
      moderationVersion: 1,
    }]);

    await expect(
      submitVendorProduct(
        draft.db as never,
        {
          vendorId: "vendor_1",
          productId: "product_1",
          actorUserId: "user_1",
        },
        dependencies(),
      ),
    ).resolves.toEqual({ approvalStatus: "submitted", moderationVersion: 2 });
    expect(draft.batches[0]?.[0]?.set).toMatchObject({
      approvalStatus: "submitted",
      moderationVersion: 2,
    });

    const replay = createDb([{
      id: "product_1",
      vendorId: "vendor_1",
      approvalStatus: "submitted",
      moderationVersion: 2,
    }]);
    await expect(
      submitVendorProduct(
        replay.db as never,
        {
          vendorId: "vendor_1",
          productId: "product_1",
          actorUserId: "user_1",
        },
        dependencies(),
      ),
    ).resolves.toEqual({ approvalStatus: "submitted", moderationVersion: 2 });
    expect(replay.batches).toHaveLength(0);
  });
});
