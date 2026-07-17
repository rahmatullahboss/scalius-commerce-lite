import { describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "../../errors";
import {
  isSettlementEligibleAt,
  releaseVendorOrderSettlement,
} from "./settlement";

function createSettlementDb(results: unknown[]) {
  const queue = [...results];
  const chain = {
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    get: vi.fn(async () => queue.shift() ?? null),
    all: vi.fn(async () => queue.shift() ?? []),
  };
  const select = vi.fn(() => ({ from: vi.fn(() => chain) }));
  const batch = vi.fn(async (_statements: unknown[]) => [[], [], []]);
  return { db: { select, batch }, batch };
}

describe("marketplace settlement release", () => {
  it("enforces delivery plus seller hold period", () => {
    const deliveredAt = new Date("2026-07-01T00:00:00Z");
    expect(
      isSettlementEligibleAt(
        deliveredAt,
        7,
        new Date("2026-07-08T00:00:00Z"),
      ),
    ).toBe(true);
    expect(
      isSettlementEligibleAt(
        deliveredAt,
        7,
        new Date("2026-07-07T23:59:59Z"),
      ),
    ).toBe(false);
  });

  it("posts one strict journal and outbox event, then rebuilds the disposable projection", async () => {
    const { db, batch } = createSettlementDb([
      null,
      {
        vendorOrderId: "vendor_order_1",
        orderId: "order_1",
        vendorId: "vendor_1",
        status: "delivered",
        deliveredAt: new Date("2026-07-01T00:00:00Z"),
        settlementHoldDays: 7,
        vendorStatus: "approved",
        vendorDeletedAt: null,
      },
      null,
      null,
      [
        {
          currency: "BDT",
          debitMinor: 0,
          creditMinor: 8_000,
        },
      ],
    ]);
    const buildJournalStatements = vi.fn().mockResolvedValue({
      journalId: "journal:settlement:vendor_order_1:BDT:released",
      contentHash: "hash",
      statements: [{ kind: "journal" }, { kind: "entries" }],
    });
    const createOutboxStatement = vi.fn(() => ({ kind: "outbox" }));
    const rebuildProjections = vi.fn().mockResolvedValue({ vendors: 1, entries: 2 });

    await expect(
      releaseVendorOrderSettlement(
        db as never,
        {
          vendorOrderId: "vendor_order_1",
          now: new Date("2026-07-10T00:00:00Z"),
        },
        {
          buildJournalStatements,
          createOutboxStatement: createOutboxStatement as never,
          rebuildProjections,
        },
      ),
    ).resolves.toEqual({
      released: true,
      replayed: false,
      journalId: "journal:settlement:vendor_order_1:BDT:released",
      vendorOrderId: "vendor_order_1",
      vendorId: "vendor_1",
      currency: "BDT",
      amountMinor: 8_000,
    });

    expect(buildJournalStatements).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        idempotencyKey: "settlement:vendor_order_1:BDT:released",
        eventType: "settlement.released",
      }),
      expect.objectContaining({ conflictMode: "error" }),
    );
    expect(batch.mock.calls[0]?.[0]).toEqual([
      { kind: "journal" },
      { kind: "entries" },
      { kind: "outbox" },
    ]);
    expect(rebuildProjections).toHaveBeenCalledWith(db, expect.any(Date));
  });

  it("blocks release while an order-level or normalized refund is pending", async () => {
    const { db, batch } = createSettlementDb([
      null,
      {
        vendorOrderId: "vendor_order_1",
        orderId: "order_1",
        vendorId: "vendor_1",
        status: "delivered",
        deliveredAt: new Date("2026-07-01T00:00:00Z"),
        settlementHoldDays: 0,
        vendorStatus: "approved",
        vendorDeletedAt: null,
      },
      { id: "pending_refund_payment" },
    ]);

    await expect(
      releaseVendorOrderSettlement(db as never, {
        vendorOrderId: "vendor_order_1",
        now: new Date("2026-07-10T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(batch).not.toHaveBeenCalled();
  });

  it("returns an existing release as an idempotent replay", async () => {
    const { db, batch } = createSettlementDb([
      { id: "journal:settlement:vendor_order_1:BDT:released", currency: "BDT" },
    ]);

    await expect(
      releaseVendorOrderSettlement(db as never, {
        vendorOrderId: "vendor_order_1",
        now: new Date("2026-07-10T00:00:00Z"),
      }),
    ).resolves.toMatchObject({
      released: true,
      replayed: true,
      journalId: "journal:settlement:vendor_order_1:BDT:released",
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("rejects non-delivered, suspended, or not-yet-eligible seller orders", async () => {
    for (const candidate of [
      {
        vendorOrderId: "vendor_order_1",
        orderId: "order_1",
        vendorId: "vendor_1",
        status: "processing",
        deliveredAt: null,
        settlementHoldDays: 0,
        vendorStatus: "approved",
        vendorDeletedAt: null,
      },
      {
        vendorOrderId: "vendor_order_1",
        orderId: "order_1",
        vendorId: "vendor_1",
        status: "delivered",
        deliveredAt: new Date("2026-07-01T00:00:00Z"),
        settlementHoldDays: 0,
        vendorStatus: "suspended",
        vendorDeletedAt: null,
      },
      {
        vendorOrderId: "vendor_order_1",
        orderId: "order_1",
        vendorId: "vendor_1",
        status: "delivered",
        deliveredAt: new Date("2026-07-09T00:00:00Z"),
        settlementHoldDays: 7,
        vendorStatus: "approved",
        vendorDeletedAt: null,
      },
    ]) {
      const { db } = createSettlementDb([null, candidate]);
      await expect(
        releaseVendorOrderSettlement(db as never, {
          vendorOrderId: "vendor_order_1",
          now: new Date("2026-07-10T00:00:00Z"),
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });
});
