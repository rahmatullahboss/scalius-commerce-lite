import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";

const dependencies = vi.hoisted(() => ({
  buildStockMovementClaim: vi.fn(),
  checkAndAlertLowStock: vi.fn(),
}));

vi.mock("../inventory/stock-movement-claims", () => ({
  buildStockMovementClaim: dependencies.buildStockMovementClaim,
}));
vi.mock("../inventory/alerts", () => ({
  checkAndAlertLowStock: dependencies.checkAndAlertLowStock,
}));

import {
  listVendorProductVariants,
  updateVendorProductVariant,
} from "./products.vendor";

interface Statement {
  kind: string;
  values?: unknown;
  set?: unknown;
}

function createDb(selectResults: unknown[], batchResults: unknown[][] = []) {
  const queue = [...selectResults];
  const statements: Statement[] = [];
  const batchQueue = [...batchResults];

  function selectChain() {
    const result = queue.shift();
    const chain = {
      innerJoin: vi.fn(() => chain),
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
      select: vi.fn(() => ({
        returning: vi.fn(() => {
          const statement = { kind: "guarded-insert" };
          statements.push(statement);
          return statement;
        }),
      })),
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
    batch: vi.fn(async () => batchQueue.shift() ?? []),
  };

  return { db, statements };
}

const approvedProduct = {
  id: "product_1",
  vendorId: "vendor_1",
  approvalStatus: "approved" as const,
  moderationVersion: 4,
  price: 1250,
};

const defaultVariant = {
  id: "variant_1",
  productId: "product_1",
  isDefault: true,
  size: null,
  color: null,
  weight: null,
  sku: "SIMPLE-product_1",
  price: 1250,
  stock: 10,
  reservedStock: 2,
  stockVersion: 3,
  version: 2,
  trackInventory: true,
  barcode: null,
  barcodeType: null,
  discountType: "percentage" as const,
  discountPercentage: 0,
  discountAmount: 0,
};

const updateInput = {
  size: null,
  color: null,
  weight: null,
  sku: "SIMPLE-product_1",
  price: 999,
  stock: 8,
  trackInventory: true,
  barcode: null,
  barcodeType: null,
  discountType: "percentage" as const,
  discountPercentage: 0,
  discountAmount: 0,
};

function commandDependencies() {
  let id = 0;
  return {
    now: () => new Date("2026-07-14T08:00:00Z"),
    id: () => `generated_${++id}`,
  };
}

describe("seller SKU and inventory commands", () => {
  beforeEach(() => {
    dependencies.buildStockMovementClaim.mockReset();
    dependencies.checkAndAlertLowStock.mockReset();
    dependencies.buildStockMovementClaim.mockReturnValue({ kind: "movement" });
    dependencies.checkAndAlertLowStock.mockResolvedValue(undefined);
  });

  it("lists variants only after proving seller product ownership", async () => {
    const variants = [{ ...defaultVariant, createdAt: new Date(), updatedAt: new Date() }];
    const { db } = createDb([approvedProduct, variants]);

    await expect(
      listVendorProductVariants(db as never, "vendor_1", "product_1"),
    ).resolves.toEqual(variants);
  });

  it("returns not found for a cross-seller product before reading variants", async () => {
    const { db } = createDb([null]);
    await expect(
      listVendorProductVariants(db as never, "vendor_1", "product_other"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("updates stock with movement and CAS without resubmitting an approved product", async () => {
    const { db, statements } = createDb(
      [approvedProduct, defaultVariant, null],
      [[[{ id: "movement_1" }], [{ id: "variant_1", stockVersion: 4, version: 3 }]]],
    );

    const result = await updateVendorProductVariant(
      db as never,
      {
        vendorId: "vendor_1",
        productId: "product_1",
        variantId: "variant_1",
        actorUserId: "user_1",
        data: updateInput,
      },
      commandDependencies(),
    );

    expect(result).toEqual({
      variantId: "variant_1",
      stockVersion: 4,
      version: 3,
      approvalStatus: "approved",
      moderationVersion: 4,
    });
    expect(dependencies.buildStockMovementClaim).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        variantId: "variant_1",
        stockVersion: 3,
        quantity: -2,
        previousStock: 10,
        newStock: 8,
        adminUserId: "user_1",
      }),
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]?.set).toMatchObject({
      stock: 8,
      stockVersion: expect.anything(),
      version: expect.anything(),
      price: 1250,
    });
    expect(dependencies.checkAndAlertLowStock).toHaveBeenCalledWith(db, "variant_1");
  });

  it("atomically resubmits an approved product when seller changes SKU or pricing", async () => {
    const { db, statements } = createDb(
      [approvedProduct, defaultVariant, null],
      [[
        [{ id: "product_1", moderationVersion: 5 }],
        [{ id: "variant_1", stockVersion: 3, version: 3 }],
        [{ id: "event_1" }],
      ]],
    );

    const result = await updateVendorProductVariant(
      db as never,
      {
        vendorId: "vendor_1",
        productId: "product_1",
        variantId: "variant_1",
        actorUserId: "user_1",
        data: { ...updateInput, stock: 10, sku: "SIMPLE-UPDATED" },
      },
      commandDependencies(),
    );

    expect(result).toEqual({
      variantId: "variant_1",
      stockVersion: 3,
      version: 3,
      approvalStatus: "submitted",
      moderationVersion: 5,
    });
    expect(statements).toHaveLength(3);
    expect(statements[0]?.set).toMatchObject({ approvalStatus: "submitted", moderationVersion: 5 });
    expect(statements[1]?.set).toMatchObject({ sku: "SIMPLE-UPDATED", price: 1250 });
    expect(statements[2]?.kind).toBe("guarded-insert");
    expect(dependencies.buildStockMovementClaim).not.toHaveBeenCalled();
  });

  it("blocks catalog-changing variant edits while product is submitted or suspended", async () => {
    for (const status of ["submitted", "suspended"] as const) {
      const { db } = createDb([
        { ...approvedProduct, approvalStatus: status },
        defaultVariant,
        null,
      ]);
      await expect(
        updateVendorProductVariant(
          db as never,
          {
            vendorId: "vendor_1",
            productId: "product_1",
            variantId: "variant_1",
            actorUserId: "user_1",
            data: { ...updateInput, stock: 10, sku: "SIMPLE-UPDATED" },
          },
          commandDependencies(),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("rejects duplicate SKU and stale stock/version writes", async () => {
    const duplicate = createDb([
      approvedProduct,
      defaultVariant,
      { id: "variant_other" },
    ]);
    await expect(
      updateVendorProductVariant(
        duplicate.db as never,
        {
          vendorId: "vendor_1",
          productId: "product_1",
          variantId: "variant_1",
          actorUserId: "user_1",
          data: { ...updateInput, sku: "TAKEN-SKU" },
        },
        commandDependencies(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const stale = createDb(
      [approvedProduct, defaultVariant, null],
      [[[], []]],
    );
    await expect(
      updateVendorProductVariant(
        stale.db as never,
        {
          vendorId: "vendor_1",
          productId: "product_1",
          variantId: "variant_1",
          actorUserId: "user_1",
          data: updateInput,
        },
        commandDependencies(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
