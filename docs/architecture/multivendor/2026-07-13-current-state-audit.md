# Multi-Vendor Current-State Audit

**Date:** 2026-07-13  
**Scope:** database schema, migrations, seller access, product publication, order allocation, payments, refunds, inventory, shipments, and current marketplace APIs  
**Assessment:** foundation exists, but production marketplace enablement is blocked by correctness, isolation, and financial-ledger gaps

## 1. Audit conclusion

Scalius Commerce should be expanded rather than rebuilt. Its core commerce platform is significantly more mature than its marketplace layer. The correct program is to preserve the reliable checkout/payment/inventory foundations while replacing the current seller financial model with a canonical, auditable model.

The current multi-vendor work is a useful prototype. It establishes vendor identity, memberships, product ownership, order grouping, an admin vendor surface, and a seller dashboard. It should not be treated as complete because several paths can expose unapproved products, produce stale seller totals, or calculate a payable balance that is unrelated to captured payments and refunds.

## 2. Sources reviewed

### Database and migrations

- `packages/database/src/schema/index.ts`
- `packages/database/src/schema/products.ts`
- `packages/database/src/schema/orders.ts`
- `packages/database/src/schema/vendorx.ts`
- `packages/database/src/schema/vendor-orders.ts`
- `packages/database/src/schema/inventory.ts`
- `packages/database/src/schema/delivery.ts`
- `packages/database/src/schema/rbac.ts`
- `packages/database/migrations/0058_create_vendors.sql`
- `packages/database/migrations/0059_vendor_order_split_foundation.sql`
- `packages/database/migrations/meta/_journal.json`

### Domain and API write paths

- `packages/core/src/auth/vendor-context.ts`
- `packages/core/src/modules/orders/vendor-order-split.ts`
- `packages/core/src/modules/orders/orders.admin.ts`
- `packages/core/src/modules/orders/orders.ingest.ts`
- `packages/core/src/modules/products/products.storefront.ts`
- `packages/core/src/modules/payments/process-payment.ts`
- `packages/core/src/modules/payments/refund-service.ts`
- `apps/api/src/routes/admin/vendors.ts`
- `apps/api/src/routes/admin/vendor-dashboard.ts`
- `apps/api/src/routes/admin/products.ts`
- `packages/core/src/auth/rbac/route-permissions.ts`
- `packages/core/src/auth/rbac/auto-seed.ts`

## 3. What should be kept

| Capability | Assessment | Direction |
|---|---|---|
| Monorepo boundaries | Strong | Keep admin, storefront, API, core, database, shared package boundaries |
| D1 + Drizzle migration workflow | Suitable | Keep, with stricter migration ownership and contract tests |
| Checkout idempotency | Strong | Keep |
| Payment confirmation CAS and provider idempotency | Strong | Keep and emit seller-ledger postings after confirmed state transition |
| Refund claim coordination | Strong at order level | Keep provider coordination; add item/vendor allocation and ledger reversals |
| Inventory movement audit | Useful | Keep; extend ownership/location semantics |
| Order notification outbox | Strong | Reuse pattern for marketplace domain events |
| Product and variant model | Suitable for seller-owned catalogs | Keep for Phase 1; do not introduce shared catalog/offers unless the business requires multiple sellers on one catalog product |
| Vendor membership concept | Correct direction | Keep, but make it the sole ownership authority and separate seller capability policy from platform RBAC |
| Vendor order grouping | Necessary concept | Keep the fulfillment group, remove duplicated line-level financial source of truth |

## 4. Critical findings

### C-01 — Public storefront does not enforce product or vendor approval

**Evidence:** `buildStorefrontProductConditions()` in `packages/core/src/modules/products/products.storefront.ts` filters only active and non-deleted products. Product detail and related-product reads follow the same pattern. They do not require `products.approval_status = 'approved'` and do not join an approved vendor.

**Impact:** A rejected, draft, submitted, or suspended seller product can be public when `is_active` remains true. Suspending a vendor does not reliably remove its catalog from public reads.

**Required correction:** Centralize a public-sellable predicate and use it in every product list, detail, related-product, search, sitemap, collection, widget, and checkout validation path.

### C-02 — Editing an order invalidates seller allocation

**Evidence:** `updateOrder()` in `packages/core/src/modules/orders/orders.admin.ts` deletes and recreates `order_items`. It does not rebuild `vendor_orders`. Cascading foreign keys remove the old `vendor_order_items`, leaving the parent `vendor_orders` rows and copied totals stale.

**Impact:** Seller order views, commission, payable totals, and fulfillment ownership can disagree with the actual order after an edit. A changed product may belong to a different vendor while the old vendor order remains.

**Required correction:** Make order header, item replacement, seller allocation, financial allocation, and inventory state one coordinated command. Forbid order-line mutation after settlement eligibility unless performed through explicit adjustment/return flows.

### C-03 — Seller revenue is not connected to captured payments

**Evidence:** `processPaymentConfirmed()` updates `orders`, `order_payments`, and `payment_plans`, but not seller allocations or a seller ledger. The seller dashboard sums `vendor_orders.vendor_net_amount` regardless of payment state, fulfillment eligibility, return window, dispute, or hold.

**Impact:** A seller may see unpaid, cancelled, refunded, or otherwise ineligible order value as pending payout.

**Required correction:** Post immutable ledger entries only after a recognized business event. A projected balance must distinguish pending, available, held, paid, and reversed amounts.

### C-04 — Refunds cannot be allocated correctly across vendors

**Evidence:** `processRefund()` supports an order-level amount and selects a successful payment record. It does not require refunded order items or quantities and creates no seller-specific reversal.

**Impact:** A partial refund on a multi-vendor order cannot determine which seller revenue and commission to reverse. Already-paid settlements cannot be reconciled correctly.

**Required correction:** Introduce `refunds` and `refund_items`; every marketplace refund must allocate quantity and amount to immutable order items. Ledger reversals reference the original seller entries.

### C-05 — Monetary values use SQLite REAL and JavaScript floating-point arithmetic

**Evidence:** product prices, order totals, payment amounts, vendor order totals, commission rates, shipment amounts, and discount values use `real()`. `vendor-order-split.ts` rounds JavaScript `number` calculations to two decimals.

**Impact:** Repeated allocation, commission, refund, shipping, tax, and payout arithmetic can drift. Sum-of-lines may differ from order or payout totals.

**Required correction:** All new financial records use integer minor units. All rates use integer basis points. Existing REAL columns are migrated through parallel integer columns with reconciliation before cutover.

### C-06 — Mutable copied summaries are treated as financial source of truth

**Evidence:** `vendor_orders` and `vendor_order_items` copy subtotal, commission, and net amounts. The dashboard directly sums these mutable rows.

**Impact:** Rebuilds, edits, refunds, shipping changes, commission-rule changes, or migration defects create conflicting numbers. There is no immutable evidence explaining a seller balance.

**Required correction:** Seller payable amounts come from append-only ledger entries. Vendor-order totals are rebuildable display projections only.

### C-07 — Payout account data is stored and returned in plaintext

**Evidence:** `vendor_payout_accounts.account_number` and routing details are plain text. `apps/api/src/routes/admin/vendors.ts` returns the full row in API responses.

**Impact:** Sensitive financial identifiers are unnecessarily exposed to application code, logs, browser clients, backups, and anyone with broad vendor-read access.

**Required correction:** Encrypt sensitive payout payloads using the existing credential-encryption pattern, store a safe display mask separately, restrict reveal operations, and audit every review/change.

### C-08 — Seller ownership has two authorities

**Evidence:** `vendors.owner_user_id` identifies an owner while `vendor_users.role = 'owner'` independently represents owner membership. Create and update routes write these records in separate statements.

**Impact:** Failures or concurrent updates can produce a vendor whose owner column and membership rows disagree. Multiple owners or no owner can emerge without an explicit policy.

**Required correction:** `vendor_memberships` is the membership authority. If exactly one legal owner is required, enforce a dedicated owner-membership invariant or a separate transfer workflow; do not duplicate the user ID on `vendors`.

### C-09 — Platform RBAC and seller authorization are conflated

**Evidence:** vendor dashboard routes require global `vendors.view`, while the route also checks vendor membership. The same global permission is used for platform vendor-management surfaces.

**Impact:** Granting a seller access to its dashboard can unintentionally grant visibility into platform vendor administration. Membership role names exist, but there is no central seller action policy.

**Required correction:** Platform administrator permissions and seller-scoped capabilities are separate. A seller endpoint authorizes `(actor, vendor, capability)`; a platform endpoint authorizes global RBAC. No shared route permission should bridge both.

### C-10 — Shipments are order-scoped instead of seller-fulfillment-scoped

**Evidence:** `delivery_shipments` references only `orders.id`; shipment items are serialized JSON. It has no `vendor_order_id` or seller ownership.

**Impact:** Multiple sellers cannot independently book couriers, dispatch parcels, receive webhook updates, collect COD, or complete fulfillment without overwriting or ambiguously sharing order-level state.

**Required correction:** Shipments reference a seller fulfillment group. Shipment items use normalized rows or validated immutable item IDs. Order fulfillment becomes a projection of all seller fulfillment groups.

### C-11 — Inventory has no explicit seller or location boundary

**Evidence:** inventory quantities live on `product_variants`; movement rows identify variant and optional order but not vendor or stock location.

**Impact:** Ownership is inferred through the current product relationship. Historical movements become ambiguous if product ownership changes. Multiple pickup locations or seller warehouses cannot be represented.

**Required correction:** For MVP, prohibit product ownership transfer after commercial activity and snapshot vendor on movements. Add seller-owned inventory locations and inventory levels when multiple locations are enabled.

### C-12 — Marketplace statuses are inconsistent and weakly constrained

**Evidence:** product moderation accepts `draft`, `submitted`, `approved`, `rejected`, and `suspended`; the seller dashboard counts `pending`. Most status columns are unconstrained text. Vendor order status duplicates order state without a defined transition map.

**Impact:** Metrics are wrong and agents can invent new strings. State transitions can diverge between order, seller order, payment, and fulfillment.

**Required correction:** Define centralized const enums, validation schemas, database CHECK constraints where D1 migration support permits, and explicit transition functions with tests.

## 5. High-risk findings

### H-01 — Vendor create/update operations are not atomic

The vendor row, owner membership deletion, owner membership insert/update, and related status changes are separate database operations in `apps/api/src/routes/admin/vendors.ts`. A failure between operations leaves inconsistent ownership.

**Direction:** Move writes into core domain commands and execute each invariant-preserving mutation in one D1 batch.

### H-02 — Route handlers write marketplace tables directly

Vendor CRUD and product moderation bypass a marketplace domain service. This distributes invariants across routes and encourages future agents to add one-off writes.

**Direction:** Routes validate transport input and invoke commands. Only domain services may mutate marketplace tables.

### H-03 — Vendor identity may be erased from historical records

Products and vendor order references use `ON DELETE SET NULL`. Financial and commercial history must retain seller identity even when an account is deleted or suspended.

**Direction:** Use soft deletion for vendors, `RESTRICT` physical deletion after commercial activity, and immutable vendor snapshots on order items and ledger entries.

### H-04 — Order-item ownership is derived from current product ownership

`buildVendorOrderSplitWrites()` loads the product’s current vendor while creating the order. It does not store the vendor directly on canonical `order_items`.

**Direction:** Checkout validation resolves seller ownership and records it atomically on each order item. Future product changes never affect historical ownership.

### H-05 — Commission policy is a mutable vendor field

A single `vendors.commission_rate` is read at order creation. There is no versioned rule, category/product override, effective date, minimum/maximum fee, or evidence of which policy produced the amount.

**Direction:** Add versioned commission rules; snapshot the applied rule ID, basis points, base amount, and result on order-item financial allocation.

### H-06 — Shipping and discounts are not allocated

Seller order split writes set shipping and discount to zero. There is no deterministic allocation rule.

**Direction:** Define allocation algorithms with a final-line remainder rule so all seller/item components exactly reconcile to the customer order total.

### H-07 — Seller dashboard numbers are operational summaries, not accounting balances

Revenue queries sum all vendor order rows and label the result pending payout. There are no settlement eligibility rules or balance classes.

**Direction:** Rename/remove the current metric until the ledger exists. Seller balance APIs must read a ledger projection.

### H-08 — No marketplace-specific reconciliation suite

There are no focused invariant tests for seller allocation rebuilds, payment postings, refunds, payouts, or cross-table reconciliation.

**Direction:** Add deterministic reconciliation functions and CI tests before rollout.

## 6. Current sources of truth and duplication

| Business fact | Current source(s) | Problem | Canonical target |
|---|---|---|---|
| Vendor owner | `vendors.owner_user_id`, `vendor_users.role=owner` | Duplicate | Membership/transfer workflow |
| Product seller | `products.vendor_id` | Nullable and mutable | Non-null seller ID after platform-vendor backfill; immutable order snapshot |
| Product publication | `products.is_active`, `products.approval_status`, vendor status | Public query ignores two dimensions | Central public-sellable predicate |
| Order item seller | Current product lookup, `vendor_order_items.vendor_id` | Derived and duplicated | `order_items.vendor_id` snapshot |
| Commission | Vendor rate, vendor order total, vendor order item total | Mutable/copy-based | Applied commission snapshot + ledger entries |
| Seller payable | `vendor_orders.vendor_net_amount`, `payout_status` | Not payment/refund aware | Seller ledger and balance projection |
| Order payment | `orders.paid_amount`, `orders.payment_status`, `order_payments`, `payment_plans` | Existing duplication is managed by CAS but seller side is absent | Keep operational projection; ledger postings reference succeeded payment |
| Refund | Refund `order_payments` metadata and order paid amount | No item/vendor allocation | `refunds`, `refund_items`, reversal ledger entries |
| Shipment ownership | `delivery_shipments.order_id`, JSON items | Not seller-partitioned | `vendor_order_id` + normalized shipment-item links |
| Inventory ownership | Product/variant relation | Current-state inference | Seller/location snapshot on stock ledger |

## 7. Transaction-boundary audit

### Correct or reusable patterns

- Storefront order ingestion builds customer/order/items/notification/discount writes and executes them through one D1 batch after inventory reservation.
- Payment confirmation uses gateway uniqueness, optimistic order versioning, and a coordinated batch.
- Refund processing claims capacity locally before external provider dispatch and compensates provider failure.
- Inventory movement logic already treats durable claims and compensation as first-class concerns.

### Boundaries that must change

1. **Vendor creation:** vendor + initial membership + audit event must be atomic.
2. **Owner transfer:** old owner demotion, new owner activation, transfer record, and audit event must be atomic.
3. **Product submission/moderation:** product state, moderation event, actor, reason, and cache/outbox event must be coordinated.
4. **Order mutation:** order, items, seller allocation, item financial allocation, inventory deltas, and version update must be one command.
5. **Payment posting:** succeeded payment and seller ledger postings need idempotent coordination. If not in one batch, a durable outbox with a unique event key must make eventual posting provably recoverable.
6. **Refund posting:** refund-item allocation and seller reversal ledger entries must be recorded before or atomically with final local refund state.
7. **Payout:** balance reservation, batch item, attempt, provider response, and final debit must use claims and idempotency.
8. **Shipment creation:** seller fulfillment claim and shipment row must prevent two actors/providers from booking the same seller items.

## 8. Reconciliation invariants

The implementation must provide executable checks for these equations:

```text
order_total_minor
= item_subtotal_minor
- order_discount_minor
+ shipping_minor
+ tax_minor
+ rounding_adjustment_minor
```

```text
sum(order_item.vendor_allocated_subtotal_minor) = order.item_subtotal_minor
sum(order_item.vendor_allocated_discount_minor) = order.discount_minor
sum(order_item.vendor_allocated_shipping_minor) = order.shipping_minor
```

```text
seller_item_gross_minor
- seller_discount_share_minor
+ seller_shipping_credit_minor
- platform_commission_minor
- seller_refund_minor
+ seller_adjustment_minor
= seller_net_ledger_effect_minor
```

```text
seller_pending + seller_available + seller_held - seller_paid
= sum(posted seller ledger entries by balance class)
```

```text
for every payout item:
reserved_amount_minor = completed_amount_minor + released_amount_minor
```

```text
for every order item:
ordered_quantity >= fulfilled_quantity + cancelled_quantity + returned_quantity
refunded_quantity <= returned_quantity or explicitly approved non-return refund quantity
```

## 9. Keep / Transform / Merge / Replace / Retire

| Current element | Action | Rationale |
|---|---|---|
| `vendors` | Transform | Keep identity/status; remove owner duplication; add profile/policy boundaries |
| `vendor_users` | Rename/transform to membership domain | Make sole access authority and add invitation/audit semantics |
| `vendor_payout_accounts` | Replace storage shape | Encrypt payload, mask display, add version and audit |
| `vendor_kyc_documents` | Transform | Add verification case/events and immutable review history |
| `products.vendor_id` | Keep, then require | Correct for seller-owned-product MVP after platform-vendor backfill |
| `products.approval_status` | Transform | Central enum/state machine, audit log, public predicate |
| `vendor_orders` | Transform | Keep as seller fulfillment partition/projection, not accounting source |
| `vendor_order_items` | Merge into canonical order-item seller allocation | Avoid duplicate quantities and prices when one line has one seller |
| Copied vendor commission/net totals | Retire as source of truth | Replace with applied allocation and immutable ledger |
| `orders` payment projections | Keep | Existing reliable operational state |
| `order_payments` | Keep | Existing payment evidence; reference from ledger events |
| Order-level partial refund input | Transform | Require item allocations for marketplace orders |
| `delivery_shipments.order_id` only | Transform | Add seller fulfillment-group ownership |
| Variant stock columns | Keep for MVP | Add seller/location model when required; do not prematurely rebuild inventory |
| Global platform RBAC | Keep | Use only for platform administration |
| Vendor roles in membership | Transform | Map to seller-scoped capabilities, separate from platform permissions |
| `vendorx.ts` filename | Rename in a coordinated schema refactor | Use clear domain naming such as `vendors.ts`; avoid ad-hoc aliases |

## 10. Production readiness gate

Marketplace production rollout is blocked until all of the following pass:

- Public catalog cannot return unapproved products or products of unapproved vendors.
- Every order item has an immutable seller snapshot.
- Order edits cannot leave stale seller allocation.
- Seller balances are ledger-derived and reconcile to payment/refund events.
- Partial refunds identify seller items and quantities.
- Payout credentials are encrypted and masked.
- Seller endpoints prove tenant isolation with negative tests.
- Multi-seller shipments are seller-fulfillment-scoped.
- Migration/backfill checks report zero unexplained mismatches.
- Feature flags support immediate disablement of seller write, payout, and public seller catalog surfaces.
