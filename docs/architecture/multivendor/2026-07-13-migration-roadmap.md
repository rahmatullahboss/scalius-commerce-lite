# Multi-Vendor Migration and Rollout Roadmap

**Date:** 2026-07-13  
**Strategy:** expand-and-contract, forward-only migrations, dual write/read comparison, deterministic backfill, reconciliation-gated cutover  
**Rollout posture:** marketplace writes and public seller catalog remain feature-flagged until accounting and isolation gates pass

## 1. Migration rule that must be resolved first

Before editing migrations `0058` or `0059`, classify their deployment state using Cloudflare D1 migration history for every environment.

### Track A — migrations have not reached any shared or production database

Use this track only when evidence proves both migrations exist solely in uncommitted/local disposable state.

- Replace the prototype migration content before it is merged.
- Generate one coherent canonical foundation migration sequence.
- Remove temporary schema/table names rather than preserving accidental compatibility.
- Recreate local disposable databases and run the complete migration chain.

### Track B — either migration has reached a shared or production database

- Treat `0058` and `0059` as immutable.
- Add forward corrective migrations starting at the next available migration number.
- Never rename/drop populated columns in the first corrective migration.
- Add canonical columns/tables, backfill, dual-write, compare, cut over, and only then retire legacy structures in a later release.

No agent may choose a track based on the presence of files alone. The migration history of each actual D1 environment is the authority.

## 2. Phase 0 — program freeze and safety repair

### Goals

- Stop schema proliferation.
- Establish migration deployment state.
- Prevent unapproved seller products from being publicly sold.
- Prevent new order edits from silently leaving stale seller allocation.
- Establish architecture ownership and feature flags.

### Work

1. Record the migration track decision in `.ai-bridge/decisions.md` and the marketplace program progress file.
2. Freeze creation of marketplace tables outside the approved target architecture.
3. Add independent marketplace feature flags with all write/public flags disabled by default.
4. Introduce a centralized public-sellable product predicate requiring approved product and approved vendor.
5. Apply that predicate to product list/detail/search/related/category/collection/widget/sitemap and checkout validation paths.
6. Disable or guard seller financial metrics currently derived from `vendor_orders.vendor_net_amount`.
7. Block order-item replacement for orders with seller allocation until the canonical rebuild command exists, or rebuild allocation in the same atomic command.
8. Separate platform vendor-management routes from seller dashboard authorization.
9. Add database governance, schema proposal, and ownership review to pull-request requirements.

### Acceptance gate

- Rejected/draft/suspended products are absent from every public read and cannot be checked out.
- Suspended vendors are absent from public catalog reads.
- Order edit tests prove no stale vendor order survives an item change.
- Seller access no longer requires global vendor-management permission.
- All marketplace feature flags can be disabled independently.
- Migration track A or B is documented with evidence.

### Rollback

Disable all marketplace public/write flags. Safety filters remain because they only reduce exposure. Order-edit blocking remains until a correct replacement path is available.

## 3. Phase 1 — canonical vendor identity and catalog ownership

### Goals

- Make every current product belong to a seller.
- Remove duplicate owner authority.
- Create safe seller profile, address, membership, verification-history, and payout-method boundaries.
- Introduce seller-scoped capability policy.

### Work

1. Create a deterministic platform vendor ID, for example `vendor_platform`, through a migration-safe insert.
2. Backfill every null product owner to the platform vendor.
3. Add validation that new products always receive a seller owner from trusted domain context.
4. After backfill and verification, enforce non-null ownership through a D1 table rebuild if required.
5. Migrate `vendor_users` semantics to canonical memberships; do not create a second active membership table unless the migration plan explicitly replaces the first.
6. Remove `vendors.owner_user_id` as authority. During transition, compare it with owner membership and report mismatches before removal.
7. Add atomic owner-transfer command and audit event.
8. Add vendor profile/address boundaries only for confirmed requirements.
9. Replace payout-account payload storage with encrypted payout methods and masked API output.
10. Add append-only vendor verification/review events.
11. Introduce seller capabilities independent of platform RBAC.
12. Move vendor and moderation writes from API routes to core domain commands.

### Backfill checks

```text
count(products where vendor_id is null) = 0
count(vendors with owner mismatch) = 0
count(active default payout methods per vendor) <= 1
count(plaintext payout account values exposed by normal API) = 0
```

### Acceptance gate

- Every product has a valid vendor.
- Existing single-store products behave exactly as platform-vendor products.
- Vendor creation and owner transfer are atomic.
- Cross-vendor access negative tests pass.
- Payout details are encrypted at rest and masked in ordinary responses.
- Product status changes have actor/reason history.

### Rollback

Keep the platform vendor and ownership backfill. Disable seller onboarding/catalog write flags. Do not restore plaintext payout data after encrypted cutover.

## 4. Phase 2 — integer money and canonical seller order allocation

### Goals

- Snapshot seller identity on every order item.
- Replace floating-point marketplace calculations with integer minor units.
- Make seller fulfillment grouping atomic and rebuildable.
- Remove duplicated seller-line source of truth.

### Schema expansion

Add parallel minor-unit fields to `orders` and `order_items`. Add immutable seller/financial snapshots and canonical `vendor_order_id`. Transform `vendor_orders` into a fulfillment aggregate with versioning. Keep legacy REAL fields during comparison.

### Work

1. Add shared money types and safe conversion helpers.
2. Add deterministic integer allocation for discount, shipping, tax, and rounding remainder.
3. Add versioned commission-rule resolution using basis points.
4. Build a pure `allocateOrderToVendors()` function returning:
   - order minor-unit totals
   - vendor fulfillment groups
   - item seller snapshots
   - applied commission snapshots
   - reconciliation evidence
5. Use that function in storefront ingest, queue ingest, and admin-created order paths.
6. Execute order, items, vendor orders, financial snapshots, discount claims, notification outbox, and seller-allocation event through one coordinated D1 batch after inventory reservation.
7. Replace order edit with one pre-settlement command that recalculates all affected components atomically.
8. Reject destructive item edits after captured payment, seller acceptance, shipment, refund, settlement release, or payout reservation; use adjustment/return commands instead.
9. Backfill historical orders:
   - resolve seller from current product when present
   - otherwise assign platform vendor and mark backfill provenance
   - convert decimal strings/REAL values to minor units using configured currency exponent
   - build one vendor order per `(order, vendor)`
10. Compare legacy and canonical totals and classify every mismatch.
11. Stop writing duplicated `vendor_order_items` financial fields.
12. Retire `vendor_order_items` only after all reads use canonical `order_items` allocation.

### Reconciliation gate

For every order:

```text
sum(item.gross_minor) - sum(item.discount_minor)
+ sum(item.shipping_minor) + sum(item.tax_minor)
+ order.rounding_adjustment_minor
= order.total_minor
```

For every vendor order:

```text
all linked order_items have vendor_id = vendor_order.vendor_id
all linked order_items have order_id = vendor_order.order_id
```

The migration report must contain zero unexplained mismatches. Approved legacy anomalies are preserved in an exceptions artifact with order ID, reason, and resolution.

### Acceptance gate

- New orders write only canonical seller allocation logic.
- Retried order creation is idempotent.
- Order edits cannot leave stale seller groups.
- All new marketplace money uses integer minor units and basis points.
- Legacy and canonical totals reconcile within exact minor-unit rules, not a floating tolerance.

### Rollback

Switch reads back to legacy order totals while preserving canonical writes and mismatch logging. Do not delete canonical allocation. Disable seller order actions if ownership correctness is uncertain.

## 5. Phase 3 — marketplace ledger, captured-payment posting, and refunds

### Goals

- Make seller balance explainable and immutable.
- Connect seller earnings to actual captured payments.
- Allocate every marketplace refund to items and vendors.

### Work

1. Create ledger journal and entry schema with unique idempotency keys and immutable triggers.
2. Define account codes and journal templates for:
   - payment capture
   - settlement pending-to-available release
   - refund reversal
   - manual adjustment
   - payout reservation
   - payout completion
   - payout reservation release
3. Add `domain_outbox_events` with claim/lease/retry fields.
4. Write `payment.captured` outbox event in the same batch that marks the order payment succeeded.
5. Implement idempotent ledger posting consumer using event key as journal idempotency key.
6. Add balance projection and full rebuild command.
7. Create normalized `refunds` and `refund_items`.
8. Update refund API/contracts so marketplace partial refunds require item IDs and quantities.
9. Claim refund capacity per item and seller before provider dispatch.
10. On provider success, emit `refund.completed` and post reversal journals.
11. If a refund occurs after payout, post seller debt/negative available balance according to policy.
12. Replace seller dashboard revenue queries with ledger/balance projection queries.
13. Build reconciliation commands for payment-to-ledger, refund-to-ledger, and journal balancing.

### Ledger acceptance gate

- Every posted journal balances exactly by currency.
- Duplicate payment/refund events produce one journal.
- Every captured marketplace payment has a capture journal or a visible retryable outbox event.
- Every completed refund has allocated refund items and a reversal journal.
- Seller dashboard pending/available values equal a fresh ledger rebuild.
- Ledger rows reject update/delete operations.

### Rollback

Disable ledger posting consumer and payout/release flags. Keep outbox events pending for replay. Seller financial dashboard displays “temporarily unavailable” rather than reverting to mutable vendor-order totals.

## 6. Phase 4 — settlement release and payout workflow

### Goals

- Move earnings through pending, available, reserved, and paid states.
- Prevent double payout.
- Make provider/manual payout retries auditable.

### Work

1. Implement settlement policy from delivery completion plus hold period and dispute/refund conditions.
2. Add idempotent release command moving eligible pending liability to available liability.
3. Create payout batch, item, and attempt schema.
4. Build payout preview from available balance projection.
5. Approving a payout atomically reserves ledger balance and creates payout items.
6. Dispatch provider/manual payment only after durable reservation.
7. Successful dispatch posts completion journal; failed/cancelled dispatch releases reservation.
8. Enforce dual authorization for sensitive payout approval if required by operating policy.
9. Add masked payout review and immutable payout audit trail.
10. Add negative-balance and minimum-payout policy.
11. Add reconciliation for batch totals, reserved balances, attempts, and completed journals.

### Acceptance gate

- Two concurrent payout requests cannot reserve the same balance.
- Failed payouts return the exact reserved amount to available.
- Completed payout item amount equals its completion journal.
- No payout uses an unverified or deleted payout method.
- Every payout attempt is idempotent and auditable.
- Platform and seller views expose no decrypted account number by default.

### Rollback

Disable payout-write and settlement-release flags. Existing completed payouts remain visible. Reserved-but-undispatched payout items can be cancelled through the documented release command.

## 7. Phase 5 — seller fulfillment and shipment partitioning

### Goals

- Let each seller operate only its portion of a customer order.
- Support one or more shipments per seller order without cross-seller ambiguity.
- Derive customer order fulfillment from seller groups.

### Work

1. Add vendor-order state machine and optimistic versioning.
2. Add seller acceptance/rejection policy and deadlines.
3. Add `vendor_order_id` and seller snapshot to delivery shipments.
4. Normalize shipment-item quantities when partial shipments are allowed.
5. Add seller-scoped shipment claims to prevent duplicate courier bookings.
6. Adapt Pathao/Steadfast payloads to one seller fulfillment group and pickup address.
7. Map delivery webhooks to seller shipment, seller order, and projected customer order status.
8. Define COD ownership: platform-collected COD is payment evidence at order level and ledger-posted to sellers only after successful collection policy.
9. Add cancellation, return-to-origin, delivered, and return flows per seller group.
10. Add customer-facing multi-package tracking.

### Acceptance gate

- Seller A cannot view or ship Seller B items.
- One seller’s shipment status cannot mark the whole order delivered prematurely.
- Duplicate booking attempts are rejected or return the existing shipment.
- Courier webhook replay is idempotent.
- Order fulfillment projection exactly matches its active seller groups.

### Rollback

Disable seller shipment writes and return fulfillment to platform operators. Keep seller-group ownership and shipment records intact.

## 8. Phase 6 — seller portal completion and public seller experience

### Goals

- Provide a safe seller operating surface.
- Publish seller profiles and seller-scoped product discovery.
- Remove platform-admin permissions from seller users.

### Work

1. Create seller navigation independent of platform admin navigation.
2. Add seller product draft/create/edit/submit flows through seller-scoped commands.
3. Add seller order acceptance, fulfillment, and shipment actions.
4. Add ledger-derived balance, statements, refunds, and payout history.
5. Add membership/invitation management according to role capabilities.
6. Add public seller profile page, seller product listing, SEO, and sitemap entries.
7. Apply centralized public-sellable predicate everywhere.
8. Audit all exports, analytics, media access, and search for vendor scope.
9. Add support impersonation only through audited platform capability; never reuse a seller session.

### Acceptance gate

- Complete cross-tenant API and UI security suite passes.
- Seller users hold no platform-management permission solely for portal access.
- All seller financial figures are ledger-derived.
- Public seller pages expose only approved profile and product data.

## 9. Phase 7 — contract cleanup

Cleanup occurs only after canonical reads have been stable and reconciliation reports remain clean.

1. Stop dual writes to legacy seller financial fields.
2. Remove reads of `vendor_orders.commission_amount`, `vendor_net_amount`, and payout status as accounting authority.
3. Retire `vendor_order_items` duplicate money/quantity fields or table.
4. Remove `vendors.owner_user_id` after membership migration.
5. Remove plaintext payout columns after encrypted migration and retention review.
6. Remove legacy REAL columns only through a D1 table rebuild after all API/client contracts use minor units or deliberate major-unit presentation conversion.
7. Rename unclear schema files, including `vendorx.ts`, in one dedicated refactor.
8. Regenerate OpenAPI client and update database documentation.
9. Keep compatibility views only when a verified consumer still requires them.

## 10. Backfill execution standard

Every backfill is:

- idempotent
- chunked by stable primary key
- restartable with a checkpoint
- safe under concurrent reads
- either safe under concurrent writes or run while the relevant feature write flag is disabled
- instrumented with attempted/succeeded/skipped/failed counts
- followed by deterministic reconciliation

A backfill must not silently coerce missing seller identity. Ambiguous rows are assigned to the platform vendor only under a documented rule and marked with provenance.

## 11. Dual-write and cutover standard

For each migrated fact:

1. Add canonical structure.
2. Backfill existing rows.
3. Start canonical write beside legacy write.
4. Compare values asynchronously and alert on mismatch.
5. Switch internal reads behind a flag.
6. Switch API reads.
7. Stop legacy writes.
8. Observe/reconcile.
9. Remove legacy structure in a later release.

Never add a new table and immediately delete the old source in one deployment.

## 12. Required reconciliation commands

Recommended scripts or internal commands:

- `marketplace:reconcile-product-ownership`
- `marketplace:reconcile-order-allocation`
- `marketplace:reconcile-order-money`
- `marketplace:reconcile-payment-ledger`
- `marketplace:reconcile-refund-ledger`
- `marketplace:rebuild-vendor-balances`
- `marketplace:reconcile-payouts`
- `marketplace:reconcile-fulfillment`

Each command returns a non-zero exit status for unexplained mismatches and writes a bounded report without secrets.

## 13. CI and release gates

Every marketplace schema PR runs:

```bash
pnpm --filter @scalius/database check:migrations
pnpm --filter @scalius/database typecheck
pnpm --filter @scalius/core typecheck
pnpm --filter @scalius/api typecheck
pnpm test
```

Focused tests must include:

- migration from empty database
- migration from a representative pre-marketplace snapshot
- migration from a representative `0058`/`0059` snapshot when Track B applies
- rollback-by-feature-flag behavior
- cross-seller negative authorization
- integer allocation property tests
- journal balance and immutability
- event replay/idempotency
- payout concurrency
- refund-after-payout behavior

A release cannot enable a marketplace write flag when its reconciliation command reports an unexplained mismatch.

## 14. Operational rollback matrix

| Failure | Immediate action | Data action |
|---|---|---|
| Public catalog leak | Disable public vendor catalog; purge catalog caches | Repair approval/vendor status and rerun public-query tests |
| Order allocation mismatch | Disable seller order actions and affected order edits | Rebuild allocation from canonical item snapshots; do not infer from mutable product when snapshot exists |
| Ledger posting backlog | Disable settlement/payout; keep checkout operating | Replay durable outbox after fix |
| Unbalanced journal | Stop ledger consumer and payouts | Reject journal, investigate code path; never patch posted rows |
| Refund allocation mismatch | Disable marketplace partial refund | Use platform-reviewed item allocation; post corrective reversal journal |
| Payout provider failure | Stop dispatch; keep reservations visible | Retry idempotently or cancel and release reservation |
| Cross-seller authorization defect | Disable affected seller route group | Audit access logs and rotate/revoke impacted sessions where necessary |
| Shipment mapping defect | Disable seller shipment creation | Platform operators reconcile shipments and seller groups |

## 15. Definition of migration complete

The marketplace migration is complete only when:

- all active products have canonical seller ownership
- every marketplace order item has immutable seller and integer financial snapshots
- seller order groups reconcile to order items
- captured payments and completed refunds reconcile to ledger journals
- seller balances rebuild exactly from immutable entries
- payout reservations/completions reconcile exactly
- shipments are seller-fulfillment-scoped
- seller authorization tests prove tenant isolation
- legacy seller financial tables/columns are no longer read as authority
- the architecture and governance documents match implemented behavior
