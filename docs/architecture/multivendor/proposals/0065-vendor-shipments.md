# Schema Change Proposal 0065 — Seller-Scoped Shipments

**Date:** 2026-07-14  
**Status:** accepted for local-only implementation  
**Remote execution:** prohibited

## Problem

The legacy `delivery_shipments` table is parent-order scoped, stores shipment items as JSON, and uses REAL shipment amounts. It cannot safely authorize one seller or prove which seller-owned order lines were shipped.

## Decision

Keep the legacy table for existing platform shipments. Add canonical seller-scoped tables used by marketplace seller workflows:

- `vendor_shipments`
- `vendor_shipment_items`

Every shipment references exactly one `vendor_order`, parent order, and seller. Items are normalized and reference immutable `order_items.vendor_order_id` snapshots.

## Invariants

- Shipment seller/order/vendor-order identities must agree.
- Every shipment line belongs to the same vendor order.
- Quantity is a positive integer.
- Cumulative quantity across non-cancelled/non-failed shipments cannot exceed purchased quantity.
- Seller shipment statuses follow an explicit transition graph.
- Tracking/provider metadata never contains provider credentials.
- Shipment amount uses integer minor units.
- A vendor order becomes delivered only when delivered shipment quantities cover every seller-owned order line.
- `delivered_at` is set by a database trigger on first complete delivery and becomes the settlement hold-clock source.
- Seller commands are gated by `vendorShipments`, active seller membership, approved seller status, and `orders.write` capability.

## Existing courier integration reuse

The marketplace layer reuses the repository's existing encrypted delivery-provider infrastructure rather than creating a second courier subsystem.

- Pathao and Steadfast are resolved through the existing provider factory and encrypted credential records.
- The canonical `vendor_shipments.id` is sent as the provider merchant/invoice reference so two seller packages belonging to the same customer order cannot collide.
- Only the seller-owned shipment lines, package item count/description, note, and shipment-specific COD amount are sent to the provider.
- A replay that is already `processing` but has no provider external ID is treated as reconciliation-required and is never booked a second time automatically.
- Manual/own-rider shipments remain supported without provider credentials.

## Provider status projection

Courier status can reach a seller package through either verified Pathao/Steadfast webhooks or an authenticated seller-initiated status refresh. Both paths use the same canonical projection command.

- Provider external ID, shipment merchant reference, or tracking ID may resolve the package.
- Polling additionally binds the configured provider ID to prevent collisions between multiple accounts of the same provider type.
- Skipped provider events are bridged through the shortest valid canonical status path.
- Backward or terminal regressions are ignored.
- Unknown/unavailable polling responses do not mutate shipment state.
- Existing parent-order `delivery_shipments` webhook behavior remains as a compatibility fallback.

## Parent-order and customer projection

Database triggers derive each `vendor_order` fulfillment state from delivered seller-owned quantities. The Core shipment command then projects all non-cancelled seller groups into the parent customer order:

- any active seller group in shipment progress may move the parent order to `shipped` with partial fulfillment;
- the parent order becomes `delivered` and complete only when every active seller group is complete;
- one delivered seller package can never complete a multi-seller parent order;
- terminal parent-order states are not regressed.

Customer account APIs merge legacy order shipments with canonical seller packages. Customer-visible package records contain public seller name/slug, courier/tracking status, and the package's order-line quantities. Internal seller IDs, provider credentials, and shipment metadata are not exposed.

When the parent order actually changes to a customer-notifiable state, the existing notification outbox and product-availability cache invalidation flows are reused. Durable webhook claims prevent duplicate notification delivery.

## Rollback

Disable `marketplace.vendor_shipments`. Existing seller shipment records remain readable. Do not delete shipment history or manually clear `delivered_at`; corrections use forward status/history commands. Legacy `delivery_shipments` and their existing provider workflows remain available as the compatibility path.
