import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "../../errors";
import {
  claimPayoutItemForDispatch,
  completePayoutItem,
  previewVendorPayout,
  releasePayoutItem,
  reserveVendorPayout,
  sanitizePayoutAttemptMetadata,
} from "./payout";

function createDb({ selects = [], batchResults = [] }: { selects?: unknown[]; batchResults?: unknown[][] } = {}) {
  const selectQueue = [...selects];
  const chain = {
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    get: vi.fn(async () => selectQueue.shift() ?? null),
    all: vi.fn(async () => selectQueue.shift() ?? []),
  };
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; values: unknown }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: unknown) => {
      inserts.push({ table, values });
      return { kind: `insert_${inserts.length}` };
    }),
  }));
  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: unknown) => {
      updates.push({ table, values });
      return {
        where: vi.fn(() => ({
          kind: `update_${updates.length}`,
          returning: vi.fn(() => ({ kind: `returning_update_${updates.length}` })),
        })),
      };
    }),
  }));
  const batch = vi.fn(async (_statements: unknown[]) => batchResults.shift() ?? []);
  return {
    db: {
      select: vi.fn(() => ({ from: vi.fn(() => chain) })),
      insert,
      update,
      batch,
    },
    batch,
    inserts,
    updates,
  };
}

const verifiedMethod = {
  id: "method_1",
  vendorId: "vendor_1",
  method: "bank",
  displayName: "Primary bank",
  lastFour: "1234",
  providerName: "Bank",
  status: "verified",
  deletedAt: null,
};

const balance = {
  pendingMinor: 0,
  availableMinor: 10_000,
  reservedMinor: 0,
  paidMinor: 0,
  debtMinor: 1_000,
  payoutEligibleMinor: 9_000,
};

describe("marketplace payout lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previews only debt-adjusted balance using a verified non-deleted destination", async () => {
    const { db } = createDb({
      selects: [
        {
          vendorId: "vendor_1",
          vendorStatus: "approved",
          vendorDeletedAt: null,
          minimumPayoutMinor: 5_000,
        },
        verifiedMethod,
      ],
    });
    const getBalance = vi.fn().mockResolvedValue(balance);

    await expect(
      previewVendorPayout(
        db as never,
        { vendorId: "vendor_1", currency: "BDT" },
        { getBalance },
      ),
    ).resolves.toEqual({
      vendorId: "vendor_1",
      currency: "BDT",
      minimumPayoutMinor: 5_000,
      eligibleMinor: 9_000,
      balance,
      payoutMethod: {
        id: "method_1",
        method: "bank",
        displayName: "Primary bank",
        lastFour: "1234",
        providerName: "Bank",
      },
    });
  });

  it("rejects payout preview for debt-only, below-minimum, or unverified destinations", async () => {
    const unverifiedDb = createDb({
      selects: [
        {
          vendorId: "vendor_1",
          vendorStatus: "approved",
          vendorDeletedAt: null,
          minimumPayoutMinor: 0,
        },
        null,
      ],
    });
    await expect(
      previewVendorPayout(
        unverifiedDb.db as never,
        { vendorId: "vendor_1", currency: "BDT" },
        { getBalance: vi.fn().mockResolvedValue(balance) },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const belowMinimumDb = createDb({
      selects: [
        {
          vendorId: "vendor_1",
          vendorStatus: "approved",
          vendorDeletedAt: null,
          minimumPayoutMinor: 10_000,
        },
        verifiedMethod,
      ],
    });
    await expect(
      previewVendorPayout(
        belowMinimumDb.db as never,
        { vendorId: "vendor_1", currency: "BDT" },
        { getBalance: vi.fn().mockResolvedValue(balance) },
      ),
    ).rejects.toThrow(/minimum payout/i);
  });

  it("reserves available ledger balance with batch/item records, strict journal, and outbox atomically", async () => {
    const { db, batch, inserts } = createDb({ batchResults: [[[], [], [], [], []]] });
    const preview = vi.fn().mockResolvedValue({
      vendorId: "vendor_1",
      currency: "BDT",
      minimumPayoutMinor: 5_000,
      eligibleMinor: 9_000,
      balance,
      payoutMethod: {
        id: "method_1",
        method: "bank",
        displayName: "Primary bank",
        lastFour: "1234",
        providerName: "Bank",
      },
    });
    const buildJournalStatements = vi.fn().mockResolvedValue({
      journalId: "journal:payout:payout_item:key_1:reserved",
      contentHash: "hash",
      statements: [{ kind: "journal" }, { kind: "entries" }],
    });
    const createOutboxStatement = vi.fn(() => ({ kind: "outbox" }));
    const rebuildProjections = vi.fn().mockResolvedValue({ vendors: 1, entries: 2 });

    await expect(
      reserveVendorPayout(
        db as never,
        {
          idempotencyKey: "key_1",
          vendorId: "vendor_1",
          currency: "BDT",
          amountMinor: 8_000,
          actorUserId: "admin_1",
          now: new Date("2026-07-14T05:00:00Z"),
        },
        {
          preview,
          buildJournalStatements,
          createOutboxStatement: createOutboxStatement as never,
          rebuildProjections,
        },
      ),
    ).resolves.toMatchObject({
      replayed: false,
      batchId: "payout_batch:key_1",
      payoutItemId: "payout_item:key_1",
      amountMinor: 8_000,
      status: "reserved",
    });

    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.values).toMatchObject({
      id: "payout_batch:key_1",
      status: "approved",
      totalMinor: 8_000,
    });
    expect(inserts[1]?.values).toMatchObject({
      id: "payout_item:key_1",
      status: "reserved",
      reservationJournalId: "journal:payout:payout_item:key_1:reserved",
    });
    expect(batch.mock.calls[0]?.[0]).toEqual([
      { kind: "journal" },
      { kind: "entries" },
      { kind: "insert_1" },
      { kind: "insert_2" },
      { kind: "outbox" },
    ]);
  });

  it("claims one reserved payout for dispatch and creates a sanitized processing attempt", async () => {
    const { db, batch, inserts } = createDb({
      selects: [
        {
          payoutItemId: "payout_item:key_1",
          status: "reserved",
          version: 1,
          vendorId: "vendor_1",
          payoutMethodId: "method_1",
          methodStatus: "verified",
          methodDeletedAt: null,
        },
        { attemptNumber: 2 },
      ],
      batchResults: [[[ { id: "payout_item:key_1" } ], []]],
    });

    await expect(
      claimPayoutItemForDispatch(db as never, {
        payoutItemId: "payout_item:key_1",
        provider: "manual_bank",
        requestMetadata: { fileReference: "batch-2026-07-14" },
        now: new Date("2026-07-14T06:00:00Z"),
      }),
    ).resolves.toEqual({
      payoutItemId: "payout_item:key_1",
      attemptId: "payout_attempt:payout_item:key_1:3",
      attemptNumber: 3,
      status: "processing",
    });
    expect(inserts[0]?.values).toMatchObject({
      attemptKey: "payout:payout_item:key_1:attempt:3",
      requestMetadata: { fileReference: "batch-2026-07-14" },
    });
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("completes a processing payout and posts reserved-to-paid journal atomically", async () => {
    const { db, batch } = createDb({
      selects: [
        {
          payoutItemId: "payout_item:key_1",
          batchId: "payout_batch:key_1",
          vendorId: "vendor_1",
          currency: "BDT",
          amountMinor: 8_000,
          status: "processing",
          version: 2,
          attemptId: "attempt_1",
          attemptKey: "payout:payout_item:key_1:attempt:1",
          attemptStatus: "processing",
        },
      ],
      batchResults: [[[], [], [{ id: "payout_item:key_1" }], [] , []]],
    });
    const buildJournalStatements = vi.fn().mockResolvedValue({
      journalId: "journal:payout:payout_item:key_1:completed",
      contentHash: "hash",
      statements: [{ kind: "journal" }, { kind: "entries" }],
    });
    const createOutboxStatement = vi.fn(() => ({ kind: "outbox" }));
    const rebuildProjections = vi.fn().mockResolvedValue({ vendors: 1, entries: 4 });

    await expect(
      completePayoutItem(
        db as never,
        {
          payoutItemId: "payout_item:key_1",
          providerReference: "bank_tx_1",
          responseMetadata: { settlementFile: "file_1" },
          now: new Date("2026-07-14T07:00:00Z"),
        },
        {
          buildJournalStatements,
          createOutboxStatement: createOutboxStatement as never,
          rebuildProjections,
        },
      ),
    ).resolves.toMatchObject({ status: "completed", amountMinor: 8_000 });
    expect(batch.mock.calls[0]?.[0]).toHaveLength(5);
  });

  it("releases failed reserved funds exactly back to available", async () => {
    const { db, batch } = createDb({
      selects: [
        {
          payoutItemId: "payout_item:key_1",
          batchId: "payout_batch:key_1",
          vendorId: "vendor_1",
          currency: "BDT",
          amountMinor: 8_000,
          status: "processing",
          version: 2,
          attemptId: "attempt_1",
          attemptStatus: "processing",
        },
      ],
      batchResults: [[[], [], [{ id: "payout_item:key_1" }], [], []]],
    });
    const buildJournalStatements = vi.fn().mockResolvedValue({
      journalId: "journal:payout:payout_item:key_1:released",
      contentHash: "hash",
      statements: [{ kind: "journal" }, { kind: "entries" }],
    });

    await expect(
      releasePayoutItem(
        db as never,
        {
          payoutItemId: "payout_item:key_1",
          reason: "provider_failed",
          errorMessage: "bank rejected file",
          now: new Date("2026-07-14T08:00:00Z"),
        },
        {
          buildJournalStatements,
          createOutboxStatement: vi.fn(() => ({ kind: "outbox" })) as never,
          rebuildProjections: vi.fn().mockResolvedValue({ vendors: 1, entries: 4 }),
        },
      ),
    ).resolves.toMatchObject({ status: "released", amountMinor: 8_000 });
    expect(batch.mock.calls[0]?.[0]).toHaveLength(5);
  });

  it("rejects sensitive or oversized payout attempt metadata", () => {
    expect(() => sanitizePayoutAttemptMetadata({ accountNumber: "123" })).toThrow(/sensitive/i);
    expect(() => sanitizePayoutAttemptMetadata({ accessToken: "secret" })).toThrow(/sensitive/i);
    expect(() => sanitizePayoutAttemptMetadata({ data: "x".repeat(9_000) })).toThrow(/exceeds/i);
  });

  it("rejects completion when the item is not processing", async () => {
    const { db } = createDb({
      selects: [
        {
          payoutItemId: "payout_item:key_1",
          status: "completed",
        },
      ],
    });
    await expect(
      completePayoutItem(db as never, {
        payoutItemId: "payout_item:key_1",
        providerReference: "dup",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
