# Schema Change Proposal — 0060 Marketplace Ledger, Outbox, Refunds, and Balance Projection

**Date:** 2026-07-14  
**Migration integrator:** current ChatGPT session  
**Migration:** `0060_marketplace_ledger_refunds.sql`  
**Track:** forward-only after the local canonical `0058`/`0059` baseline  
**Execution mode:** local only

## 1. Problem

The marketplace currently has immutable seller allocation snapshots on `order_items`, but it does not yet have a durable accounting authority for captured payments, commission, seller pending/available balances, refunds, settlement, or payouts. `vendor_orders` is fulfillment-only and must not become a financial balance source.

Payment and refund workflows also need a durable same-transaction handoff so external provider success cannot be separated from marketplace accounting. A single shared domain outbox is required instead of one event table per feature.

## 2. Existing authorities preserved

- `orders` remains the customer purchase aggregate.
- `order_items` remains the immutable seller, price, commission, and seller-net snapshot authority.
- `order_payments` remains the gateway payment record.
- `vendor_orders` remains fulfillment-only.
- `vendors` and `vendor_users` remain seller identity and access authorities.

No existing table becomes a second ledger or payout balance source.

## 3. New canonical tables

### `domain_outbox_events`

One shared durable event handoff for payment capture, refunds, settlement, payout, seller moderation, and fulfillment events.

Authority:

- unique `event_key` provides producer idempotency;
- bounded JSON payload with explicit schema version;
- status/attempt/lease fields support safe at-least-once processing;
- consumers use the event key as downstream idempotency input.

### `marketplace_ledger_journals`

One immutable posted journal per business event and currency.

Authority:

- globally unique `idempotency_key`;
- source and optional order/payment/refund/payout references;
- reversal journals reference the original journal;
- posted journals cannot be changed or deleted.

### `marketplace_ledger_entries`

Immutable debit/credit lines for each journal.

Authority:

- exactly one side is positive;
- no negative values;
- journal builders must prove total debits equal total credits before insertion;
- seller and order-item dimensions explain each seller balance.

Initial account codes:

- `cash_clearing`
- `vendor_pending_payable`
- `vendor_available_payable`
- `vendor_payout_reserved`
- `vendor_paid`
- `platform_commission_revenue`
- `shipping_clearing`
- `refund_clearing`
- `marketplace_adjustment`

### `refunds`

Normalized refund lifecycle and provider/idempotency record.

Authority:

- customer-facing refund total is integer `amount_minor`;
- unique `claim_key` prevents duplicate refund creation;
- provider references and status are durable;
- return/inventory state is not inferred from this table.

### `refund_items`

Required item/seller allocation for marketplace refunds.

Authority:

- unique `(refund_id, order_item_id)`;
- positive quantity;
- non-negative integer financial components;
- explicit `refund_amount_minor` reconciles exactly to the parent refund total;
- commission and seller-net reversal fields support deterministic journal posting.

### `vendor_balance_projections`

Disposable, rebuildable read projection by seller and currency.

Authority:

- never used as accounting truth;
- rebuilt from immutable ledger entries;
- pending, available, reserved, paid, and debt are separate integer buckets;
- `last_journal_id` and version support incremental projection.

## 4. Invariants

1. Journal idempotency keys are globally unique.
2. Each ledger entry has exactly one positive side.
3. Posted journals and all entries are immutable; SQL triggers reject update/delete.
4. Application journal builders reject unbalanced journals before database writes.
5. A refund total equals the sum of its `refund_items.refund_amount_minor` rows.
6. Marketplace partial refunds require item allocations.
7. Seller balances are derived from ledger entries, never mutable order/fulfillment totals.
8. Domain events and the local state change that produced them are written in one D1 batch.
9. Projection rows may be deleted/rebuilt without loss of financial truth.
10. All money is integer minor units and rates remain integer basis points.

## 5. Delete and retention policy

- Journals and entries: no update/delete.
- Completed refunds and refund items: retained; correction uses another refund/adjustment or reversal journal.
- Outbox processed rows: retained for audit until a future approved archival policy.
- Balance projections: disposable and rebuildable.

## 6. Sensitive data

- No payout account number, KYC object location, provider secret, or raw provider payload is stored in ledger/outbox/refund tables.
- Metadata and payload are bounded, sanitized JSON.
- Payout methods remain encrypted in the existing canonical payout-method table.

## 7. Rollout

1. Add schema and migration with all financial feature flags disabled.
2. Apply to a fresh disposable local D1.
3. Add pure balanced journal builders and reconciliation tests.
4. Emit `payment.captured` in the same batch as payment confirmation.
5. Process events idempotently into journals.
6. Add normalized refunds and refund-item allocation before refund ledger posting.
7. Build/rebuild vendor balance projection and verify it against ledger entries.
8. Only after reconciliation may seller financial reads be enabled.

## 8. Rollback and correction

Before shared use, a disposable local database can be recreated. After any shared environment applies migration `0060`, the migration is immutable. Corrections are forward-only. Posted financial history is corrected with reversal/adjustment journals, never destructive edits.

## 9. Acceptance evidence

- migration metadata check passes;
- schema boundary tests pass;
- fresh local D1 applies through `0060` with no pending migration;
- update/delete trigger tests prove ledger immutability;
- journal builder property tests prove balance and idempotency;
- refund allocation reconciliation reports zero mismatch;
- root typecheck and full regression suite pass;
- no remote migration or deployment occurs.
