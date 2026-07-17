import { describe, expect, it, vi } from "vitest";
import {
  buildDomainOutboxEvent,
  createDomainOutboxInsertStatement,
} from "./outbox";

describe("marketplace domain outbox", () => {
  it("builds a bounded versioned event without sensitive payload data", () => {
    const event = buildDomainOutboxEvent({
      id: "event_1",
      eventKey: "payment:payment_1:capture",
      aggregateType: "order_payment",
      aggregateId: "payment_1",
      eventType: "payment.captured",
      schemaVersion: 1,
      payload: {
        paymentId: "payment_1",
        orderId: "order_1",
        amountMinor: 10_000,
        currency: "BDT",
      },
      createdAt: new Date("2026-07-14T00:00:00Z"),
    });

    expect(event).toMatchObject({
      id: "event_1",
      eventKey: "payment:payment_1:capture",
      aggregateType: "order_payment",
      aggregateId: "payment_1",
      eventType: "payment.captured",
      schemaVersion: 1,
      status: "pending",
      attempts: 0,
    });
  });

  it.each([
    { accessToken: "secret" },
    { password: "secret" },
    { payout: { accountNumber: "01700000000" } },
    { document: { storageKey: "private/kyc.pdf" } },
    { encryptedPayload: "ciphertext" },
  ])("rejects sensitive payload keys", (payload) => {
    expect(() =>
      buildDomainOutboxEvent({
        eventKey: "test:event",
        aggregateType: "test",
        aggregateId: "1",
        eventType: "test.event",
        payload,
      }),
    ).toThrow(/sensitive payload key/i);
  });

  it("rejects oversized and non-serializable payloads", () => {
    expect(() =>
      buildDomainOutboxEvent({
        eventKey: "test:large",
        aggregateType: "test",
        aggregateId: "1",
        eventType: "test.event",
        payload: { data: "x".repeat(17_000) },
      }),
    ).toThrow(/payload exceeds/i);

    const payload: Record<string, unknown> = {};
    payload.self = payload;
    expect(() =>
      buildDomainOutboxEvent({
        eventKey: "test:cycle",
        aggregateType: "test",
        aggregateId: "1",
        eventType: "test.event",
        payload,
      }),
    ).toThrow(/serializable/i);
  });

  it("creates a duplicate-safe insert statement keyed by event_key", () => {
    const onConflictDoNothing = vi.fn(() => ({ kind: "outbox-statement" }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));

    const statement = createDomainOutboxInsertStatement(
      { insert } as never,
      {
        id: "event_1",
        eventKey: "payment:payment_1:capture",
        aggregateType: "order_payment",
        aggregateId: "payment_1",
        eventType: "payment.captured",
        payload: { paymentId: "payment_1" },
        createdAt: new Date("2026-07-14T00:00:00Z"),
      },
    );

    expect(statement).toEqual({ kind: "outbox-statement" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: "payment:payment_1:capture" }),
    );
    expect(onConflictDoNothing).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.anything() }),
    );
  });
});
