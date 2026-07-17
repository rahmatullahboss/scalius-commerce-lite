import { describe, expect, it, vi } from "vitest";
import { processMarketplaceOutboxBatch } from "./outbox-processor";

function createProcessorDb({
  candidates,
  claimResults,
}: {
  candidates: Array<{
    id: string;
    eventType: string;
    aggregateId: string;
    attempts: number;
  }>;
  claimResults: Array<{ id: string } | null>;
}) {
  const selectChain = {
    where: vi.fn(() => selectChain),
    orderBy: vi.fn(() => selectChain),
    limit: vi.fn(() => selectChain),
    all: vi.fn(async () => candidates),
  };
  const updates: Array<Record<string, unknown>> = [];
  const claimQueue = [...claimResults];
  const update = vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => ({
            get: vi.fn(async () => claimQueue.shift() ?? null),
          })),
          run: vi.fn(async () => ({ success: true })),
        })),
      };
    }),
  }));

  return {
    db: {
      select: vi.fn(() => ({ from: vi.fn(() => selectChain) })),
      update,
    },
    updates,
  };
}

describe("marketplace outbox processor", () => {
  it("does nothing while ledger posting is disabled", async () => {
    const { db } = createProcessorDb({ candidates: [], claimResults: [] });
    const handler = vi.fn();

    await expect(
      processMarketplaceOutboxBatch(db as never, {
        enabled: false,
        handler,
      }),
    ).resolves.toEqual({
      enabled: false,
      scanned: 0,
      claimed: 0,
      processed: 0,
      failed: 0,
      dead: 0,
      skipped: 0,
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("claims and processes supported events exactly through the injected handler", async () => {
    const candidates = [
      { id: "event_1", eventType: "payment.captured", aggregateId: "payment_1", attempts: 0 },
      { id: "event_2", eventType: "refund.completed", aggregateId: "refund_1", attempts: 1 },
    ];
    const { db, updates } = createProcessorDb({
      candidates,
      claimResults: [{ id: "event_1" }, { id: "event_2" }],
    });
    const handler = vi.fn().mockResolvedValue({ journalId: "journal_1", replayed: false });

    const result = await processMarketplaceOutboxBatch(db as never, {
      enabled: true,
      handler,
      now: new Date("2026-07-14T00:00:00Z"),
      claimId: () => "claim_1",
    });

    expect(result).toEqual({
      enabled: true,
      scanned: 2,
      claimed: 2,
      processed: 2,
      failed: 0,
      dead: 0,
      skipped: 0,
    });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(
      1,
      db,
      { eventType: "payment.captured", aggregateId: "payment_1" },
    );
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "processing", attempts: 1, claimId: "claim_1" }),
      expect.objectContaining({ status: "processed", claimId: null }),
      expect.objectContaining({ status: "processing", attempts: 2, claimId: "claim_1" }),
    ]));
  });

  it("skips lost claims and applies retry/dead-letter decisions", async () => {
    const candidates = [
      { id: "lost", eventType: "payment.captured", aggregateId: "payment_lost", attempts: 0 },
      { id: "retry", eventType: "payment.captured", aggregateId: "payment_retry", attempts: 2 },
      { id: "dead", eventType: "refund.completed", aggregateId: "refund_dead", attempts: 7 },
    ];
    const { db, updates } = createProcessorDb({
      candidates,
      claimResults: [null, { id: "retry" }, { id: "dead" }],
    });
    const handler = vi.fn().mockRejectedValue(new Error("temporary failure"));

    const result = await processMarketplaceOutboxBatch(db as never, {
      enabled: true,
      handler,
      now: new Date("2026-07-14T00:00:00Z"),
      claimId: () => "claim_failure",
      maxAttempts: 8,
    });

    expect(result).toEqual({
      enabled: true,
      scanned: 3,
      claimed: 2,
      processed: 0,
      failed: 1,
      dead: 1,
      skipped: 1,
    });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "failed",
        attempts: 3,
        claimId: null,
        lastError: "temporary failure",
        nextAttemptAt: expect.any(Date),
      }),
      expect.objectContaining({
        status: "dead",
        attempts: 8,
        claimId: null,
        lastError: "temporary failure",
        failedAt: expect.any(Date),
      }),
    ]));
  });
});
