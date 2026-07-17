# Canonical Marketplace Database Contract

**Date:** 2026-07-14  
**Status:** local implementation verified  
**Release status:** not approved for remote migration or production deployment  
**Applies to:** marketplace schema, Core commands, APIs, workers, seller/admin interfaces, reporting, reconciliation, and future migrations

## 1. Purpose

This document identifies the single canonical authority for each marketplace fact. It prevents a contributor or agent from creating a second seller, fulfillment, money, refund, shipment, or payout authority merely because a feature needs a convenient read or write path.

Compatibility fields and projections may remain where required by the inherited single-store platform, but they are not marketplace accounting or seller-authorization evidence.

## 2. Canonical authority matrix

| Business fact | Canonical authority | Notes |
|---|---|---|
| Seller identity and lifecycle | `vendors` | Status, public identity, settlement hold policy, and minimum payout policy. Vendors with commercial history are suspended/closed rather than physically erased. |
| Seller access and owner authority | `vendor_users` | An active membership and role/capability grant authority. `vendors` has no duplicated `owner_id`. |
| Seller addresses | `vendor_addresses` | Typed business, pickup, and return addresses. |
| Seller payout destination | `vendor_payout_methods` | Normalized destination is encrypted. Reads expose only method, display label, provider, status, and last-four mask. |
| Commission policy | `vendor_commission_rules` | Integer basis points, versioned by effective range and status. |
| Catalog ownership | `products.vendor_id` | Public eligibility additionally requires approved product moderation and an approved, active seller. |
| Product moderation history | product moderation state plus append-only moderation events | Seller edits cannot bypass platform review. |
| Historical seller ownership of a sale | immutable seller snapshots on `order_items` | Current product ownership is never used to reinterpret a historical order. |
| Historical commercial allocation | immutable minor-unit and basis-point snapshots on `order_items` | Includes line subtotal, discount, commission, vendor net, currency, and commission-rule identity. |
| Seller fulfillment partition | `vendor_orders` | Fulfillment-only. It contains no copied subtotal, commission, earning, balance, payout, currency, or rate authority. |
| Seller package | `vendor_shipments` | One seller, parent order, and vendor order per package. Provider/tracking references are package-scoped. |
| Seller package quantities | `vendor_shipment_items` | Normalized immutable references to seller-owned order lines. |
| Captured/refunded payment evidence | `order_payments` and provider evidence | Operational order payment status is a projection, not payment evidence. |
| Normalized refund | `refunds` | One durable refund workflow record. |
| Item-level refund allocation | `refund_items` | Explicit order-item quantities and allocated minor units. |
| Marketplace accounting | `marketplace_ledger_journals` and `marketplace_ledger_entries` | Immutable balanced double-entry authority. |
| Asynchronous financial intent | `domain_outbox_events` | Written with the local business change and processed idempotently. |
| Seller balance read model | `vendor_balance_projections` | Rebuildable projection only. Ledger entries remain authority. Payout eligibility is recalculated from ledger-derived balances and debt policy. |
| Settlement release | settlement journal in the marketplace ledger | Eligibility additionally depends on delivered seller fulfillment, hold policy, approved seller state, and no pending refund. |
| Payout batch and item workflow | `payout_batches`, `payout_items`, and `payout_attempts` | Reservation/completion/release journals provide financial evidence; provider references and bounded non-sensitive metadata provide operational evidence. |

## 3. Compatibility boundaries

The inherited platform still contains legacy order, product, payment, discount, shipping, and delivery columns stored as `REAL`. They may continue to serve existing single-store operational flows, display compatibility, or provider adapters.

They are not permitted as new marketplace financial authority.

In particular:

- `delivery_shipments` remains the compatibility path for parent-order shipments; seller ownership and package quantities come from `vendor_shipments` and `vendor_shipment_items`.
- legacy order totals do not determine seller payable balances;
- `vendor_orders` does not store or expose copied seller financial totals;
- seller finance dashboards, settlement, and payout must use the marketplace ledger or a documented rebuildable ledger projection;
- no new marketplace money or percentage column may use `REAL`.

## 4. Money and allocation contract

All new marketplace money uses safe integer minor units. Rates use integer basis points.

The order-allocation boundary calculates and snapshots, per order line:

- seller and seller name;
- vendor order identity;
- currency;
- unit price and line subtotal in minor units;
- line discount in minor units;
- commission rule and basis points;
- commission in minor units;
- seller net in minor units.

Payment capture converts the immutable allocation into balanced ledger journals. Refunds reverse the relevant item quantities and amounts. Settlement moves seller payable value from pending to available. Payout reservation, completion, and release move the same value through reserved, paid, or available accounts without mutating history.

## 5. Ownership and tenant isolation contract

A caller-supplied vendor ID never grants access by itself.

Seller commands require:

1. an authenticated user;
2. an active `vendor_users` membership for the resolved seller;
3. the required seller capability;
4. an eligible seller state;
5. the relevant marketplace feature flag;
6. domain-level seller predicates on every loaded or mutated row.

Platform RBAC and seller capabilities are separate authorities. Platform-admin status does not silently create seller membership, and seller membership does not grant platform finance or moderation authority.

The current product model permits one active owner store per user. Database partial unique indexes enforce both one active owner per vendor and one active owner store per user. Rejected applications reuse the same seller and owner membership, may be corrected and resubmitted to `pending`, and append moderation history rather than creating a second store.

## 6. Shipment and courier contract

The repository reuses the existing encrypted Pathao and Steadfast provider infrastructure.

- A provider booking uses the canonical seller shipment ID as merchant/invoice reference.
- Only seller-owned package lines and shipment-specific collection amount are sent.
- Provider credentials never enter shipment metadata, API responses, logs, outbox payloads, or customer views.
- Webhooks and authenticated polling converge through the same canonical status projection.
- Provider status may move only through the valid forward graph; backward or terminal regressions are ignored.
- Parent customer order fulfillment is aggregated from all active seller groups; one delivered package cannot complete a multi-seller order.

## 7. Write and read rules

Only Core domain commands mutate canonical marketplace tables. API routes, scheduled handlers, queue consumers, and UI server functions delegate to those commands.

A marketplace read may use a projection only when the projection is explicitly documented as rebuildable and reconciliation exists. A projection must never be used as authorization evidence or silently become financial authority.

The following patterns are prohibited:

- direct route-level marketplace inserts/updates/deletes;
- copied seller totals on `vendor_orders`;
- plaintext payout account columns or responses;
- seller authorization from a request vendor ID alone;
- seller finance derived from current products or mutable order totals;
- queryable seller, item, quantity, state, or money relationships stored only in JSON;
- a second shipment, refund, ledger, balance, or payout table for one feature.

## 8. Reconciliation requirements

Operational review must be able to detect at least:

- unbalanced or missing marketplace journals;
- ledger/projection divergence;
- refund allocation mismatch;
- payout item/batch/journal mismatch;
- seller shipment identity or quantity violations;
- successful financial events that did not produce their required journal/outbox evidence.

Corrections use forward commands, compensating journals, or projection rebuilds. Financial history and delivered shipment evidence are not deleted or rewritten manually.

## 9. Migration baseline

The local canonical marketplace baseline is:

- `0058_create_vendors.sql`;
- `0059_vendor_order_split_foundation.sql`;
- `0060_marketplace_ledger_refunds.sql`;
- `0061_settlement_payouts.sql`;
- `0062_marketplace_ledger_transition_guards.sql`;
- `0063_payout_state_guards.sql`;
- `0064_payout_journal_state_guards.sql`;
- `0065_vendor_shipments.sql`;
- `0066_owner_application_race_guard.sql`.

Migrations `0058` and `0059` were replaced only because the owner confirmed they had never been applied to a shared environment. After any shared use, all changes are forward-only.

Current local metadata verification: 67 SQL files, 67 journal entries, 32 snapshots, and 35 approved manual snapshot gaps.

## 10. Generated API contract

The OpenAPI document and `@scalius/api-client` SDK are generated locally from the mounted Hono application. The generator installs a process-local Cloudflare virtual-module loader so contract generation does not require a running API server or remote Worker runtime.

Current generated contract evidence:

- 305 documented routes;
- seller courier status refresh included at `/api/v1/admin/vendor-dashboard/shipments/{shipmentId}/check-status`;
- generated API client typecheck passing.

Any API contract change must regenerate the spec and SDK and pass the deterministic generation boundary test.

## 11. Release boundary

This contract describes the locally verified implementation. It does not approve production release.

Production remains blocked until the owner approves source-control preservation, browser-level acceptance, dedicated security and financial review, live courier and payout operating procedures/certification, independent Cloudflare resources, secrets, staged flags, migration rehearsal, monitoring, and rollback evidence.
