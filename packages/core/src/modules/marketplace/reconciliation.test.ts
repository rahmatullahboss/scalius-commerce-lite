import { describe, expect, it } from "vitest";
import {
  findFinancialEventEvidenceMismatches,
  findLedgerBalanceMismatches,
  findPayoutBatchMismatches,
  findPayoutItemMismatches,
  findProjectionMismatches,
  findRefundAllocationMismatches,
} from "./reconciliation";

describe("marketplace financial reconciliation", () => {
  it("finds unbalanced journals and invalid entry sides", () => {
    expect(
      findLedgerBalanceMismatches([
        { journalId: "balanced", debitMinor: 100, creditMinor: 0 },
        { journalId: "balanced", debitMinor: 0, creditMinor: 100 },
        { journalId: "unbalanced", debitMinor: 90, creditMinor: 0 },
        { journalId: "unbalanced", debitMinor: 0, creditMinor: 80 },
        { journalId: "invalid_side", debitMinor: 10, creditMinor: 10 },
      ]),
    ).toEqual([
      {
        journalId: "invalid_side",
        debitMinor: 10,
        creditMinor: 10,
        invalidEntrySides: 1,
      },
      {
        journalId: "unbalanced",
        debitMinor: 90,
        creditMinor: 80,
        invalidEntrySides: 0,
      },
    ]);
  });

  it("finds refunds whose item allocations do not equal the parent amount", () => {
    expect(
      findRefundAllocationMismatches(
        [
          { refundId: "refund_ok", amountMinor: 100 },
          { refundId: "refund_bad", amountMinor: 200 },
          { refundId: "refund_empty", amountMinor: 50 },
        ],
        [
          { refundId: "refund_ok", refundAmountMinor: 40 },
          { refundId: "refund_ok", refundAmountMinor: 60 },
          { refundId: "refund_bad", refundAmountMinor: 150 },
        ],
      ),
    ).toEqual([
      { refundId: "refund_bad", amountMinor: 200, allocatedMinor: 150 },
      { refundId: "refund_empty", amountMinor: 50, allocatedMinor: 0 },
    ]);
  });

  it("finds missing, extra, and numerically stale seller projections", () => {
    const expected = [
      {
        vendorId: "vendor_1",
        currency: "BDT",
        pendingMinor: 100,
        availableMinor: 20,
        reservedMinor: 0,
        paidMinor: 0,
        debtMinor: 0,
        lastJournalId: "journal_2",
        version: 1,
      },
      {
        vendorId: "vendor_2",
        currency: "BDT",
        pendingMinor: 50,
        availableMinor: 0,
        reservedMinor: 0,
        paidMinor: 0,
        debtMinor: 0,
        lastJournalId: "journal_3",
        version: 1,
      },
    ];
    const actual = [
      {
        vendorId: "vendor_1",
        currency: "BDT",
        pendingMinor: 99,
        availableMinor: 20,
        reservedMinor: 0,
        paidMinor: 0,
        debtMinor: 0,
        lastJournalId: "journal_1",
        version: 1,
      },
      {
        vendorId: "vendor_extra",
        currency: "BDT",
        pendingMinor: 1,
        availableMinor: 0,
        reservedMinor: 0,
        paidMinor: 0,
        debtMinor: 0,
        lastJournalId: "journal_extra",
        version: 1,
      },
    ];

    expect(findProjectionMismatches(expected, actual)).toEqual([
      expect.objectContaining({
        vendorId: "vendor_1",
        currency: "BDT",
        reason: "values_differ",
      }),
      expect.objectContaining({
        vendorId: "vendor_2",
        currency: "BDT",
        reason: "missing_projection",
      }),
      expect.objectContaining({
        vendorId: "vendor_extra",
        currency: "BDT",
        reason: "unexpected_projection",
      }),
    ]);
  });

  it("finds missing or mismatched payout lifecycle journals", () => {
    const items = [
      {
        payoutItemId: "reserved_ok",
        status: "reserved",
        amountMinor: 100,
        reservationJournalId: "jr_reserve_ok",
        completionJournalId: null,
        releaseJournalId: null,
      },
      {
        payoutItemId: "completed_bad",
        status: "completed",
        amountMinor: 200,
        reservationJournalId: "jr_reserve_bad",
        completionJournalId: "jr_complete_bad",
        releaseJournalId: null,
      },
      {
        payoutItemId: "released_missing",
        status: "released",
        amountMinor: 300,
        reservationJournalId: "jr_reserve_released",
        completionJournalId: null,
        releaseJournalId: null,
      },
    ];
    const journals = [
      { journalId: "jr_reserve_ok", eventType: "payout.requested", payoutId: "reserved_ok", amountMinor: 100 },
      { journalId: "jr_reserve_bad", eventType: "payout.requested", payoutId: "completed_bad", amountMinor: 200 },
      { journalId: "jr_complete_bad", eventType: "payout.completed", payoutId: "completed_bad", amountMinor: 199 },
      { journalId: "jr_reserve_released", eventType: "payout.requested", payoutId: "released_missing", amountMinor: 300 },
    ];

    expect(findPayoutItemMismatches(items, journals)).toEqual([
      {
        payoutItemId: "completed_bad",
        reason: "completion_journal_mismatch",
        expectedAmountMinor: 200,
        actualAmountMinor: 199,
        journalId: "jr_complete_bad",
      },
      {
        payoutItemId: "released_missing",
        reason: "missing_release_journal",
        expectedAmountMinor: 300,
        actualAmountMinor: null,
        journalId: null,
      },
    ]);
  });

  it("finds payout batches whose cached item count or total differs from items", () => {
    expect(findPayoutBatchMismatches(
      [
        { batchId: "batch_ok", itemCount: 2, totalMinor: 300 },
        { batchId: "batch_bad", itemCount: 2, totalMinor: 500 },
        { batchId: "batch_empty", itemCount: 1, totalMinor: 100 },
      ],
      [
        { batchId: "batch_ok", amountMinor: 100 },
        { batchId: "batch_ok", amountMinor: 200 },
        { batchId: "batch_bad", amountMinor: 400 },
      ],
    )).toEqual([
      {
        batchId: "batch_bad",
        expectedItemCount: 2,
        actualItemCount: 1,
        expectedTotalMinor: 500,
        actualTotalMinor: 400,
      },
      {
        batchId: "batch_empty",
        expectedItemCount: 1,
        actualItemCount: 0,
        expectedTotalMinor: 100,
        actualTotalMinor: 0,
      },
    ]);
  });

  it("finds successful payment and refund records whose outbox or journal evidence is missing or invalid", () => {
    const events = [
      { sourceKind: "payment" as const, sourceId: "payment_ok", currency: "BDT" },
      { sourceKind: "payment" as const, sourceId: "payment_pending", currency: "BDT" },
      { sourceKind: "payment" as const, sourceId: "payment_missing_journal", currency: "BDT" },
      { sourceKind: "payment" as const, sourceId: "payment_failed_outbox", currency: "BDT" },
      { sourceKind: "refund" as const, sourceId: "refund_missing_all", currency: "BDT" },
      { sourceKind: "refund" as const, sourceId: "refund_bad_contract", currency: "BDT" },
      { sourceKind: "refund" as const, sourceId: "refund_empty_journal", currency: "BDT" },
    ];
    const outbox = [
      { outboxId: "outbox_ok", aggregateType: "order_payment", aggregateId: "payment_ok", eventType: "payment.captured", status: "processed" },
      { outboxId: "outbox_pending", aggregateType: "order_payment", aggregateId: "payment_pending", eventType: "payment.captured", status: "pending" },
      { outboxId: "outbox_missing_journal", aggregateType: "order_payment", aggregateId: "payment_missing_journal", eventType: "payment.captured", status: "processed" },
      { outboxId: "outbox_failed", aggregateType: "order_payment", aggregateId: "payment_failed_outbox", eventType: "payment.captured", status: "failed" },
      { outboxId: "outbox_bad_contract", aggregateType: "refund", aggregateId: "refund_bad_contract", eventType: "refund.completed", status: "processed" },
      { outboxId: "outbox_empty_journal", aggregateType: "refund", aggregateId: "refund_empty_journal", eventType: "refund.completed", status: "processed" },
    ];
    const journals = [
      {
        journalId: "journal_ok",
        eventType: "payment.captured",
        sourceType: "order_payment",
        sourceId: "payment_ok",
        currency: "BDT",
        orderPaymentId: "payment_ok",
        refundId: null,
        hasEntries: true,
      },
      {
        journalId: "journal_bad_contract",
        eventType: "refund.completed",
        sourceType: "refund",
        sourceId: "refund_bad_contract",
        currency: "USD",
        orderPaymentId: null,
        refundId: "refund_bad_contract",
        hasEntries: true,
      },
      {
        journalId: "journal_empty",
        eventType: "refund.completed",
        sourceType: "refund",
        sourceId: "refund_empty_journal",
        currency: "BDT",
        orderPaymentId: null,
        refundId: "refund_empty_journal",
        hasEntries: false,
      },
    ];

    expect(findFinancialEventEvidenceMismatches(events, outbox, journals)).toEqual([
      {
        sourceKind: "payment",
        sourceId: "payment_failed_outbox",
        eventType: "payment.captured",
        reason: "failed_outbox",
        evidenceId: "outbox_failed",
      },
      {
        sourceKind: "payment",
        sourceId: "payment_missing_journal",
        eventType: "payment.captured",
        reason: "missing_journal",
        evidenceId: null,
      },
      {
        sourceKind: "refund",
        sourceId: "refund_bad_contract",
        eventType: "refund.completed",
        reason: "journal_contract_mismatch",
        evidenceId: "journal_bad_contract",
      },
      {
        sourceKind: "refund",
        sourceId: "refund_empty_journal",
        eventType: "refund.completed",
        reason: "journal_missing_entries",
        evidenceId: "journal_empty",
      },
      {
        sourceKind: "refund",
        sourceId: "refund_missing_all",
        eventType: "refund.completed",
        reason: "missing_journal",
        evidenceId: null,
      },
      {
        sourceKind: "refund",
        sourceId: "refund_missing_all",
        eventType: "refund.completed",
        reason: "missing_outbox",
        evidenceId: null,
      },
    ]);
  });
});
