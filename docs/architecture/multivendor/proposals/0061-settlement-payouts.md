# Schema Change Proposal 0061 — Settlement Policy and Payout Workflow

**Date:** 2026-07-14  
**Status:** accepted for local-only implementation  
**Migration integrator:** current ChatGPT session  
**Remote execution:** prohibited

## Problem

The immutable marketplace ledger can represent pending, available, reserved, and paid seller liabilities, but there is no durable payout workflow and no concurrency-safe way to reserve seller balance. `vendor_orders` is fulfillment-only and `vendor_balance_projections` is rebuildable, so neither may become accounting authority.

## Decisions

1. The immutable ledger remains the only financial authority.
2. `vendor_balance_projections` is used as a disposable optimistic-lock/CAS guard. Every projection mutation is written in the same D1 batch as its corresponding ledger journal.
3. Settlement eligibility is derived from delivery time, seller hold policy, seller status, pending-refund conditions, and ledger balance. It is not a mutable boolean on `vendor_orders`.
4. Payout destinations must be verified, non-deleted `vendor_payout_methods`; encrypted account payloads are never copied to payout rows or attempts.
5. Payout provider/manual dispatch happens only after a durable reservation journal exists.
6. Failed or cancelled dispatch releases exactly the reserved amount back to available through a reversal/release journal.
7. Seller debt blocks payout preview and reservation until policy clears it.
8. New marketplace money uses integer minor units only.

## Schema changes

### Existing tables

`vendors` adds:

- `settlement_hold_days INTEGER NOT NULL DEFAULT 7`
- `minimum_payout_minor INTEGER NOT NULL DEFAULT 0`

`vendor_orders` adds:

- `delivered_at INTEGER NULL`

Existing delivered rows backfill `delivered_at` from `updated_at`.

### `payout_batches`

Platform-controlled processing group:

- ID and unique idempotency key
- currency and optional method grouping
- status: `draft`, `approved`, `processing`, `completed`, `partially_failed`, `failed`, `cancelled`
- processing window
- created/approved actors and timestamps
- integer cached item count and total for operational display
- notes and timestamps

Cached totals are validated against items by reconciliation and are not accounting authority.

### `payout_items`

One seller obligation per batch:

- batch, seller, verified payout method
- currency and integer amount
- status: `draft`, `reserved`, `processing`, `completed`, `failed`, `released`, `cancelled`
- unique idempotency key
- reservation/completion/release ledger journal references
- provider reference and sanitized failure reason
- optimistic version and timestamps

Unique `(batch_id, vendor_id, currency)` prevents duplicate seller obligations in one batch.

### `payout_attempts`

Append-only provider/manual attempt evidence:

- payout item
- unique attempt key and attempt number
- provider name and status: `processing`, `succeeded`, `failed`
- provider reference
- bounded sanitized request/response metadata
- bounded error text and timestamps

Sensitive payout destination fields are prohibited in metadata.

## Transaction boundaries

### Settlement release

One D1 batch:

1. CAS projection: pending decreases, available increases.
2. Insert balanced immutable `settlement.released` journal and entries.
3. Insert shared outbox event.

### Payout reservation

One D1 batch:

1. Insert payout batch/item records.
2. CAS projection: available decreases, reserved increases.
3. Insert balanced immutable reservation journal and entries.
4. Insert `payout.requested` outbox event.

### Payout completion

One D1 batch:

1. CAS payout item `processing → completed`.
2. CAS projection: reserved decreases, paid increases.
3. Insert completion journal.
4. Insert successful attempt and `payout.completed` event.

### Payout failure/cancellation

One D1 batch:

1. CAS payout item to `released` or `failed`.
2. CAS projection: reserved decreases, available increases.
3. Insert reservation-release journal.
4. Insert failed attempt/event metadata without account details.

## Invariants

- All amounts are safe non-negative integers.
- Reservation cannot exceed projection available balance.
- Projection version must match and affected-row result must be non-empty.
- Payout requires verified, non-deleted destination belonging to the seller.
- Every item has one reservation journal before dispatch.
- Completed item amount equals completion journal amount.
- Released item amount equals reservation-release journal amount.
- Concurrent reservations cannot both consume the same projection version/balance.
- No decrypted destination data is returned or persisted in payout attempts.

## Rollback

Disable `marketplace.settlement_release` and `marketplace.payout_write`. Existing ledger and payout history remains readable. Reserved but undispatched items may use the documented release command. Do not delete or rewrite posted journals.
