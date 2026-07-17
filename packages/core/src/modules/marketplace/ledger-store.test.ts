import { describe, expect, it, vi } from "vitest";
import { ConflictError } from "../../errors";
import { minorUnits } from "./money";
import { buildPaymentCapturedJournal } from "./ledger";
import {
  buildMarketplaceJournalStatements,
  getJournalContentHash,
  postMarketplaceJournal,
} from "./ledger-store";

function createLedgerDb({
  batchResults,
  existingJournal,
}: {
  batchResults: unknown[][];
  existingJournal?: { id: string; metadata: Record<string, unknown> | null } | null;
}) {
  const batch = vi.fn(async (_statements: unknown[]) => batchResults);
  const get = vi.fn(async () => existingJournal ?? null);
  const where = vi.fn(() => ({ get }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: unknown) => {
      insertCalls.push({ table, values });
      return {
        kind: "strict-insert",
        returning: vi.fn(() => ({ kind: "strict-journal-insert" })),
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => ({ kind: "journal-insert" })),
          kind: "entry-insert",
        })),
      };
    }),
  }));

  return { db: { select, insert, batch }, batch, insertCalls, get };
}

function journal() {
  return buildPaymentCapturedJournal({
    paymentId: "payment_1",
    orderId: "order_1",
    currency: "BDT",
    capturedMinor: minorUnits(1_000),
    orderTotalMinor: minorUnits(1_000),
    occurredAt: new Date("2026-07-14T00:00:00Z"),
    items: [
      {
        orderItemId: "item_1",
        vendorOrderId: "vendor_order_1",
        vendorId: "vendor_1",
        vendorNetMinor: minorUnits(800),
        commissionMinor: minorUnits(200),
      },
    ],
  });
}

describe("marketplace ledger persistence", () => {
  it("builds strict reusable journal statements for a larger atomic transaction", async () => {
    const { db, insertCalls } = createLedgerDb({ batchResults: [] });

    const result = await buildMarketplaceJournalStatements(db as never, journal(), {
      conflictMode: "error",
      createdAt: new Date("2026-07-14T04:00:00Z"),
    });

    expect(result.journalId).toBe("journal:payment:payment_1:capture");
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.statements).toEqual([
      { kind: "strict-journal-insert" },
      expect.objectContaining({ kind: "strict-insert" }),
    ]);
    expect(insertCalls[0]?.values).toMatchObject({
      id: "journal:payment:payment_1:capture",
      createdAt: new Date("2026-07-14T04:00:00Z"),
    });
    expect(insertCalls[1]?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "journal:payment:payment_1:capture:entry:0",
          createdAt: new Date("2026-07-14T04:00:00Z"),
        }),
      ]),
    );
  });

  it("uses deterministic journal and entry IDs and writes one atomic batch", async () => {
    const { db, batch, insertCalls } = createLedgerDb({
      batchResults: [[{ id: "journal:payment:payment_1:capture" }], []],
    });

    const result = await postMarketplaceJournal(db as never, journal());

    expect(result).toEqual({
      journalId: "journal:payment:payment_1:capture",
      replayed: false,
    });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);
    expect(insertCalls[0]?.values).toMatchObject({
      id: "journal:payment:payment_1:capture",
      idempotencyKey: "payment:payment_1:capture",
      metadata: expect.objectContaining({ contentHash: expect.any(String) }),
    });
    expect(insertCalls[1]?.values).toEqual([
      expect.objectContaining({
        id: "journal:payment:payment_1:capture:entry:0",
        journalId: "journal:payment:payment_1:capture",
      }),
      expect.objectContaining({
        id: "journal:payment:payment_1:capture:entry:1",
        journalId: "journal:payment:payment_1:capture",
      }),
      expect.objectContaining({
        id: "journal:payment:payment_1:capture:entry:2",
        journalId: "journal:payment:payment_1:capture",
      }),
    ]);
  });

  it("treats an identical idempotency replay as success", async () => {
    const draft = journal();
    const contentHash = await getJournalContentHash(draft);
    const { db, get } = createLedgerDb({
      batchResults: [[], []],
      existingJournal: {
        id: "journal:payment:payment_1:capture",
        metadata: { contentHash },
      },
    });

    await expect(postMarketplaceJournal(db as never, draft)).resolves.toEqual({
      journalId: "journal:payment:payment_1:capture",
      replayed: true,
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of an idempotency key with different content", async () => {
    const draft = journal();
    const { db } = createLedgerDb({
      batchResults: [[], []],
      existingJournal: {
        id: "journal:payment:payment_1:capture",
        metadata: { contentHash: "different" },
      },
    });

    await expect(postMarketplaceJournal(db as never, draft)).rejects.toBeInstanceOf(ConflictError);
  });
});
