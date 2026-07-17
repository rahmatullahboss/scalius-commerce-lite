import {
    allocateMinorUnits,
    minorUnits,
    type MinorUnits,
} from "./money";

export type MarketplaceLedgerAccountCode =
    | "cash_clearing"
    | "vendor_pending_payable"
    | "vendor_available_payable"
    | "vendor_payout_reserved"
    | "vendor_paid"
    | "platform_commission_revenue"
    | "shipping_clearing"
    | "refund_clearing"
    | "marketplace_adjustment";

export interface MarketplaceLedgerEntryDraft {
    accountCode: MarketplaceLedgerAccountCode;
    debitMinor: number;
    creditMinor: number;
    vendorId?: string | null;
    vendorOrderId?: string | null;
    orderItemId?: string | null;
}

export interface MarketplaceLedgerJournalDraft {
    idempotencyKey: string;
    eventType: string;
    sourceType: string;
    sourceId: string;
    orderId?: string | null;
    orderPaymentId?: string | null;
    refundId?: string | null;
    payoutId?: string | null;
    reversalOfJournalId?: string | null;
    currency: string;
    occurredAt: Date;
    metadata?: Record<string, unknown> | null;
    entries: MarketplaceLedgerEntryDraft[];
}

export interface PaymentCapturedItemSnapshot {
    orderItemId: string;
    vendorOrderId: string;
    vendorId: string;
    vendorNetMinor: MinorUnits;
    commissionMinor: MinorUnits;
}

export interface BuildPaymentCapturedJournalInput {
    paymentId: string;
    orderId: string;
    currency: string;
    capturedMinor: MinorUnits;
    orderTotalMinor: MinorUnits;
    occurredAt: Date;
    items: PaymentCapturedItemSnapshot[];
}

export interface RefundCompletedItemAllocation {
    orderItemId: string;
    vendorOrderId: string;
    vendorId: string;
    refundAmountMinor: MinorUnits;
    vendorNetReversalMinor: MinorUnits;
    commissionReversalMinor: MinorUnits;
    shippingReversalMinor: MinorUnits;
    taxReversalMinor: MinorUnits;
}

export interface BuildRefundCompletedJournalInput {
    refundId: string;
    orderId: string;
    orderPaymentId?: string | null;
    currency: string;
    amountMinor: MinorUnits;
    occurredAt: Date;
    items: RefundCompletedItemAllocation[];
}

function assertNonEmpty(value: string, label: string): void {
    if (value.trim().length === 0) {
        throw new Error(`${label} is required.`);
    }
}

function assertSafeMinor(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer.`);
    }
}

function positiveCreditEntry(
    accountCode: MarketplaceLedgerAccountCode,
    amount: number,
    dimensions?: Pick<MarketplaceLedgerEntryDraft, "vendorId" | "vendorOrderId" | "orderItemId">,
): MarketplaceLedgerEntryDraft | null {
    if (amount === 0) return null;
    return {
        accountCode,
        debitMinor: 0,
        creditMinor: amount,
        ...dimensions,
    };
}

function positiveDebitEntry(
    accountCode: MarketplaceLedgerAccountCode,
    amount: number,
    dimensions?: Pick<MarketplaceLedgerEntryDraft, "vendorId" | "vendorOrderId" | "orderItemId">,
): MarketplaceLedgerEntryDraft | null {
    if (amount === 0) return null;
    return {
        accountCode,
        debitMinor: amount,
        creditMinor: 0,
        ...dimensions,
    };
}

function compactEntries(
    entries: Array<MarketplaceLedgerEntryDraft | null>,
): MarketplaceLedgerEntryDraft[] {
    return entries.filter((entry): entry is MarketplaceLedgerEntryDraft => entry !== null);
}

export function assertBalancedJournal(
    journal: MarketplaceLedgerJournalDraft,
): { debitMinor: number; creditMinor: number } {
    assertNonEmpty(journal.idempotencyKey, "Journal idempotency key");
    assertNonEmpty(journal.eventType, "Journal event type");
    assertNonEmpty(journal.sourceType, "Journal source type");
    assertNonEmpty(journal.sourceId, "Journal source ID");
    assertNonEmpty(journal.currency, "Journal currency");

    if (!(journal.occurredAt instanceof Date) || Number.isNaN(journal.occurredAt.getTime())) {
        throw new Error("Journal occurredAt must be a valid date.");
    }
    if (journal.entries.length < 2) {
        throw new Error("A journal must contain at least two entries.");
    }

    let debitMinor = 0;
    let creditMinor = 0;
    for (const [index, entry] of journal.entries.entries()) {
        assertSafeMinor(entry.debitMinor, `Entry ${index + 1} debit`);
        assertSafeMinor(entry.creditMinor, `Entry ${index + 1} credit`);
        const debitIsPositive = entry.debitMinor > 0;
        const creditIsPositive = entry.creditMinor > 0;
        if (debitIsPositive === creditIsPositive) {
            throw new Error(`Entry ${index + 1} must have exactly one positive side.`);
        }
        debitMinor += entry.debitMinor;
        creditMinor += entry.creditMinor;
        if (!Number.isSafeInteger(debitMinor) || !Number.isSafeInteger(creditMinor)) {
            throw new Error("Journal totals exceed safe integer range.");
        }
    }

    if (debitMinor !== creditMinor) {
        throw new Error(
            `Journal is not balanced: debits ${debitMinor} do not equal credits ${creditMinor}.`,
        );
    }

    return { debitMinor, creditMinor };
}

interface EffectivePaymentComponent {
    accountCode: "vendor_pending_payable" | "platform_commission_revenue" | "shipping_clearing";
    fullAmountMinor: MinorUnits;
    vendorId?: string;
    vendorOrderId?: string;
    orderItemId?: string;
}

function buildEffectivePaymentComponents(
    orderTotalMinor: MinorUnits,
    items: PaymentCapturedItemSnapshot[],
): EffectivePaymentComponent[] {
    const itemGrossWeights = items.map((item) => {
        const gross = Number(item.vendorNetMinor) + Number(item.commissionMinor);
        assertSafeMinor(gross, `Order item ${item.orderItemId} gross`);
        return gross;
    });
    const itemGrossTotal = itemGrossWeights.reduce((sum, value) => sum + value, 0);
    assertSafeMinor(itemGrossTotal, "Order item gross total");

    let effectiveItemGross: MinorUnits[];
    let shippingMinor = 0;
    if (Number(orderTotalMinor) < itemGrossTotal) {
        effectiveItemGross = allocateMinorUnits(orderTotalMinor, itemGrossWeights);
    } else {
        effectiveItemGross = itemGrossWeights.map(minorUnits);
        shippingMinor = Number(orderTotalMinor) - itemGrossTotal;
    }

    const components: EffectivePaymentComponent[] = [];
    for (const [index, item] of items.entries()) {
        const allocatedGross = effectiveItemGross[index] ?? minorUnits(0);
        const splitWeights = [Number(item.vendorNetMinor), Number(item.commissionMinor)];
        const [vendorNetMinor = minorUnits(0), commissionMinor = minorUnits(0)] =
            Number(allocatedGross) === 0
                ? [minorUnits(0), minorUnits(0)]
                : allocateMinorUnits(allocatedGross, splitWeights);

        if (Number(vendorNetMinor) > 0) {
            components.push({
                accountCode: "vendor_pending_payable",
                fullAmountMinor: vendorNetMinor,
                vendorId: item.vendorId,
                vendorOrderId: item.vendorOrderId,
                orderItemId: item.orderItemId,
            });
        }
        if (Number(commissionMinor) > 0) {
            components.push({
                accountCode: "platform_commission_revenue",
                fullAmountMinor: commissionMinor,
                orderItemId: item.orderItemId,
            });
        }
    }

    if (shippingMinor > 0) {
        components.push({
            accountCode: "shipping_clearing",
            fullAmountMinor: minorUnits(shippingMinor),
        });
    }

    if (components.length === 0 && Number(orderTotalMinor) > 0) {
        components.push({
            accountCode: "shipping_clearing",
            fullAmountMinor: orderTotalMinor,
        });
    }

    const effectiveTotal = components.reduce(
        (sum, component) => sum + Number(component.fullAmountMinor),
        0,
    );
    if (effectiveTotal !== Number(orderTotalMinor)) {
        throw new Error(
            `Payment components ${effectiveTotal} do not reconcile to order total ${orderTotalMinor}.`,
        );
    }

    return components;
}

export function buildPaymentCapturedJournal(
    input: BuildPaymentCapturedJournalInput,
): MarketplaceLedgerJournalDraft {
    assertNonEmpty(input.paymentId, "Payment ID");
    assertNonEmpty(input.orderId, "Order ID");
    assertNonEmpty(input.currency, "Currency");
    if (Number(input.capturedMinor) <= 0) {
        throw new Error("Captured amount must be greater than zero.");
    }
    if (Number(input.orderTotalMinor) <= 0) {
        throw new Error("Order total must be greater than zero.");
    }
    if (Number(input.capturedMinor) > Number(input.orderTotalMinor)) {
        throw new Error("Captured amount cannot exceed order total.");
    }

    const components = buildEffectivePaymentComponents(input.orderTotalMinor, input.items);
    const capturedComponents = allocateMinorUnits(
        input.capturedMinor,
        components.map((component) => Number(component.fullAmountMinor)),
    );

    const entries = compactEntries([
        positiveDebitEntry("cash_clearing", Number(input.capturedMinor)),
        ...components.map((component, index) =>
            positiveCreditEntry(component.accountCode, Number(capturedComponents[index] ?? 0), {
                vendorId: component.vendorId,
                vendorOrderId: component.vendorOrderId,
                orderItemId: component.orderItemId,
            }),
        ),
    ]);

    const journal: MarketplaceLedgerJournalDraft = {
        idempotencyKey: `payment:${input.paymentId}:capture`,
        eventType: "payment.captured",
        sourceType: "order_payment",
        sourceId: input.paymentId,
        orderId: input.orderId,
        orderPaymentId: input.paymentId,
        currency: input.currency,
        occurredAt: input.occurredAt,
        entries,
    };
    assertBalancedJournal(journal);
    return journal;
}

export interface BuildSettlementReleasedJournalInput {
    releaseId: string;
    vendorId: string;
    vendorOrderId: string;
    currency: string;
    amountMinor: MinorUnits;
    occurredAt: Date;
}

export interface BuildPayoutJournalInput {
    payoutItemId: string;
    vendorId: string;
    currency: string;
    amountMinor: MinorUnits;
    occurredAt: Date;
}

export interface BuildPayoutReleaseJournalInput extends BuildPayoutJournalInput {
    reason: string;
}

function assertPositiveTransitionAmount(amount: MinorUnits): number {
    const value = Number(amount);
    if (value <= 0) throw new Error("Marketplace financial transition amount must be greater than zero.");
    return value;
}

export function buildSettlementReleasedJournal(
    input: BuildSettlementReleasedJournalInput,
): MarketplaceLedgerJournalDraft {
    assertNonEmpty(input.releaseId, "Settlement release ID");
    assertNonEmpty(input.vendorId, "Vendor ID");
    assertNonEmpty(input.vendorOrderId, "Vendor order ID");
    assertNonEmpty(input.currency, "Currency");
    const amount = assertPositiveTransitionAmount(input.amountMinor);
    const dimensions = { vendorId: input.vendorId, vendorOrderId: input.vendorOrderId };
    const journal: MarketplaceLedgerJournalDraft = {
        idempotencyKey: `settlement:${input.releaseId}:released`,
        eventType: "settlement.released",
        sourceType: "vendor_order",
        sourceId: input.vendorOrderId,
        currency: input.currency,
        occurredAt: input.occurredAt,
        metadata: { releaseId: input.releaseId },
        entries: compactEntries([
            positiveDebitEntry("vendor_pending_payable", amount, dimensions),
            positiveCreditEntry("vendor_available_payable", amount, dimensions),
        ]),
    };
    assertBalancedJournal(journal);
    return journal;
}

function buildPayoutTransferJournal(
    input: BuildPayoutJournalInput,
    params: {
        suffix: "reserved" | "completed" | "released";
        eventType: "payout.requested" | "payout.completed" | "payout.released";
        debitAccount: MarketplaceLedgerAccountCode;
        creditAccount: MarketplaceLedgerAccountCode;
        metadata?: Record<string, unknown>;
    },
): MarketplaceLedgerJournalDraft {
    assertNonEmpty(input.payoutItemId, "Payout item ID");
    assertNonEmpty(input.vendorId, "Vendor ID");
    assertNonEmpty(input.currency, "Currency");
    const amount = assertPositiveTransitionAmount(input.amountMinor);
    const dimensions = { vendorId: input.vendorId };
    const journal: MarketplaceLedgerJournalDraft = {
        idempotencyKey: `payout:${input.payoutItemId}:${params.suffix}`,
        eventType: params.eventType,
        sourceType: "payout_item",
        sourceId: input.payoutItemId,
        payoutId: input.payoutItemId,
        currency: input.currency,
        occurredAt: input.occurredAt,
        metadata: params.metadata ?? null,
        entries: compactEntries([
            positiveDebitEntry(params.debitAccount, amount, dimensions),
            positiveCreditEntry(params.creditAccount, amount, dimensions),
        ]),
    };
    assertBalancedJournal(journal);
    return journal;
}

export function buildPayoutReservationJournal(
    input: BuildPayoutJournalInput,
): MarketplaceLedgerJournalDraft {
    return buildPayoutTransferJournal(input, {
        suffix: "reserved",
        eventType: "payout.requested",
        debitAccount: "vendor_available_payable",
        creditAccount: "vendor_payout_reserved",
    });
}

export function buildPayoutCompletedJournal(
    input: BuildPayoutJournalInput,
): MarketplaceLedgerJournalDraft {
    return buildPayoutTransferJournal(input, {
        suffix: "completed",
        eventType: "payout.completed",
        debitAccount: "vendor_payout_reserved",
        creditAccount: "vendor_paid",
    });
}

export function buildPayoutReleaseJournal(
    input: BuildPayoutReleaseJournalInput,
): MarketplaceLedgerJournalDraft {
    assertNonEmpty(input.reason, "Payout release reason");
    return buildPayoutTransferJournal(input, {
        suffix: "released",
        eventType: "payout.released",
        debitAccount: "vendor_payout_reserved",
        creditAccount: "vendor_available_payable",
        metadata: { reason: input.reason },
    });
}

export function buildRefundCompletedJournal(
    input: BuildRefundCompletedJournalInput,
): MarketplaceLedgerJournalDraft {
    assertNonEmpty(input.refundId, "Refund ID");
    assertNonEmpty(input.orderId, "Order ID");
    assertNonEmpty(input.currency, "Currency");
    if (Number(input.amountMinor) <= 0) {
        throw new Error("Refund amount must be greater than zero.");
    }
    if (input.items.length === 0) {
        throw new Error("Marketplace refunds require item allocations.");
    }

    const entries: Array<MarketplaceLedgerEntryDraft | null> = [];
    let allocatedRefundMinor = 0;
    for (const item of input.items) {
        const componentTotal =
            Number(item.vendorNetReversalMinor) +
            Number(item.commissionReversalMinor) +
            Number(item.shippingReversalMinor) +
            Number(item.taxReversalMinor);
        assertSafeMinor(componentTotal, `Refund item ${item.orderItemId} component total`);
        if (componentTotal !== Number(item.refundAmountMinor)) {
            throw new Error(
                `Refund item ${item.orderItemId} components do not equal its refund amount.`,
            );
        }
        allocatedRefundMinor += Number(item.refundAmountMinor);
        assertSafeMinor(allocatedRefundMinor, "Allocated refund total");

        const dimensions = {
            vendorId: item.vendorId,
            vendorOrderId: item.vendorOrderId,
            orderItemId: item.orderItemId,
        };
        entries.push(
            positiveDebitEntry(
                "vendor_pending_payable",
                Number(item.vendorNetReversalMinor),
                dimensions,
            ),
            positiveDebitEntry(
                "platform_commission_revenue",
                Number(item.commissionReversalMinor),
                { orderItemId: item.orderItemId },
            ),
            positiveDebitEntry(
                "shipping_clearing",
                Number(item.shippingReversalMinor) + Number(item.taxReversalMinor),
                { orderItemId: item.orderItemId },
            ),
        );
    }

    if (allocatedRefundMinor !== Number(input.amountMinor)) {
        throw new Error(
            `Refund item allocations ${allocatedRefundMinor} do not equal refund amount ${input.amountMinor}.`,
        );
    }
    entries.push(positiveCreditEntry("refund_clearing", Number(input.amountMinor)));

    const journal: MarketplaceLedgerJournalDraft = {
        idempotencyKey: `refund:${input.refundId}:completed`,
        eventType: "refund.completed",
        sourceType: "refund",
        sourceId: input.refundId,
        orderId: input.orderId,
        orderPaymentId: input.orderPaymentId ?? null,
        refundId: input.refundId,
        currency: input.currency,
        occurredAt: input.occurredAt,
        entries: compactEntries(entries),
    };
    assertBalancedJournal(journal);
    return journal;
}
