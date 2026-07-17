import { describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "../../errors";
import { processSettlementReleaseBatch } from "./settlement-sweep";

function dbWithCandidates(ids: string[]) {
  const all = vi.fn(async () => ids.map((vendorOrderId) => ({ vendorOrderId })));
  const limit = vi.fn(() => ({ all }));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  return { select: vi.fn(() => ({ from })) };
}

describe("settlement release sweep", () => {
  it("does not query or mutate while settlement release is disabled", async () => {
    const db = dbWithCandidates([]);
    const release = vi.fn();
    await expect(
      processSettlementReleaseBatch(db as never, { enabled: false, release }),
    ).resolves.toEqual({
      enabled: false,
      scanned: 0,
      released: 0,
      replayed: 0,
      skipped: 0,
      failed: 0,
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("releases eligible candidates and counts replays and policy skips separately", async () => {
    const db = dbWithCandidates(["vo_1", "vo_2", "vo_3", "vo_4"]);
    const release = vi
      .fn()
      .mockResolvedValueOnce({ released: true, replayed: false })
      .mockResolvedValueOnce({ released: true, replayed: true })
      .mockRejectedValueOnce(new ValidationError("hold period"))
      .mockRejectedValueOnce(new ConflictError("refund pending"));

    await expect(
      processSettlementReleaseBatch(db as never, {
        enabled: true,
        release,
        now: new Date("2026-07-14T09:00:00Z"),
        limit: 10,
      }),
    ).resolves.toEqual({
      enabled: true,
      scanned: 4,
      released: 1,
      replayed: 1,
      skipped: 2,
      failed: 0,
    });
    expect(release).toHaveBeenCalledTimes(4);
  });

  it("contains unexpected failures without stopping the remaining candidates", async () => {
    const db = dbWithCandidates(["vo_1", "vo_2"]);
    const release = vi
      .fn()
      .mockRejectedValueOnce(new Error("D1 unavailable"))
      .mockResolvedValueOnce({ released: true, replayed: false });

    await expect(
      processSettlementReleaseBatch(db as never, { enabled: true, release }),
    ).resolves.toMatchObject({ scanned: 2, released: 1, failed: 1 });
  });
});
