# Marketplace Implementation Progress Report

**Date:** 2026-07-14  
**Execution mode:** local-only implementation in the owner-authorized WIP checkout  
**Remote operations:** none  
**Release status:** not approved for remote migration or deployment  
**Current result:** the independent multi-vendor marketplace workflow is implemented through seller onboarding and resubmission, secure seller-team invitations, seller-managed public profiles, catalog, seller-scoped courier fulfillment, customer multi-package tracking, financial-event evidence reconciliation, ledger, settlement, payout, and public seller storefront foundations.

## 1. Current architecture

The repository remains an independent project. Active runtime and deployment configuration uses local-owned placeholder identities only. The original Scalius domains, Cloudflare resource identities, queues, buckets, service bindings, and production API fallback are not active targets.

Canonical authority remains:

- `vendor_users` for accepted seller membership and owner access;
- `vendor_membership_invites` for hashed, expiring, auditable seller-team invitations;
- `vendor_profiles` for draft/published public presentation and contact-visibility policy;
- `products.vendor_id` and product moderation state for catalog ownership;
- immutable seller and money snapshots on `order_items`;
- fulfillment-only `vendor_orders`;
- immutable double-entry journals and entries for marketplace money;
- item-level refund allocation;
- ledger-derived seller balance projections;
- encrypted payout destinations with masked API/UI responses.

All marketplace public and write capabilities are independently feature-flagged and default disabled.

## 2. Implemented seller lifecycle

### Seller onboarding

Authenticated users without a seller membership can submit a seller application from the Seller Dashboard.

The Core onboarding command atomically creates:

- a `pending` vendor;
- an active owner membership derived from the authenticated user;
- an initial active zero-basis-point commission rule;
- normalized business and pickup addresses;
- a moderation audit event.

The client cannot choose the owner, approval status, or commission policy. Existing pending owner applications replay idempotently. A rejected owner can correct the same seller record, business address, pickup address, contact details, and reserved slug, then atomically resubmit it to `pending` with a moderation audit event. Approved, suspended, or closed ownership blocks another application.

Seller URL uniqueness is checked before writing and database uniqueness races are mapped to a domain conflict. Forward migration `0066` adds a partial unique index that permits at most one active owner store per user, closing the concurrent different-slug application race while preserving non-owner and inactive historical memberships.

Operational seller tabs remain locked until the vendor is approved. Pending, suspended, and closed states render a status panel; rejected state additionally renders the correction/resubmission form.

### Seller team access

Approved seller owners/admins can manage non-owner team access through one-time invitations:

- raw invitation credentials are returned once and never persisted;
- only SHA-256 token hashes are stored;
- invitation email must match the authenticated accepting account;
- invite consumption and membership activation are atomic;
- owner access cannot be granted or changed through this workflow;
- pending invitations can be revoked, and non-owner memberships can be suspended, reactivated, role-adjusted, or revoked;
- concurrent and duplicate invitation/membership races fail closed.

### Catalog and moderation

Implemented:

- seller-scoped product create, edit, and submit;
- tenant ownership checks on every seller catalog command;
- draft/submitted/approved/rejected/suspended moderation rules;
- approved catalog changes automatically return to submitted review;
- stock-only changes preserve approval;
- seller-scoped SKU, price, barcode, discount, option, and inventory changes;
- optimistic version and stock-version guards;
- inventory movement journaling;
- storefront cache invalidation after visibility-affecting changes.

### Public seller experience

Implemented:

- public approved-seller discovery API;
- `/vendors/[slug]` Storefront page;
- centralized public-sellable product eligibility;
- product-page seller attribution;
- seller-managed draft/published store profile;
- canonical logo/banner media references;
- opt-in public contact email/phone visibility;
- seller SEO title/description, return policy, and support hours;
- seller sitemap and master sitemap integration;
- fail-closed public vendor catalog feature flag.

Unapproved products or products belonging to an unapproved/inactive seller are excluded from public reads and revalidated during cart/checkout/order creation.

## 3. Fulfillment and shipments

Implemented:

- deterministic customer-order partitioning into seller fulfillment groups;
- seller-scoped order list/detail;
- controlled seller transitions to processing and ready;
- seller shipment creation from owned order lines;
- shipment item quantities;
- versioned shipment state transitions;
- database and domain guards against cross-seller access and invalid transitions;
- seller dashboard order and shipment controls;
- existing encrypted Pathao and Steadfast provider reuse rather than a second courier subsystem;
- canonical seller shipment IDs as provider merchant/invoice references;
- seller-line-only provider payloads with package item descriptions and shipment-specific COD;
- duplicate-booking protection for uncertain provider replays;
- verified webhook projection and authenticated seller-initiated courier status refresh;
- provider-account isolation, skipped-event bridging, and backward/terminal regression protection;
- parent-order aggregation that becomes delivered only after every active seller group completes;
- customer account multi-package tracking with public seller labels and package line quantities;
- notification outbox and product-availability cache parity when the parent order actually changes.

Seller allocation snapshots remain immutable. Unsupported canonical item replacement is blocked rather than leaving stale seller fulfillment rows. Legacy parent-order `delivery_shipments` remain as a compatibility path and are not used as seller ownership authority.

## 4. Marketplace accounting and refunds

Migrations `0060` through `0064` add the marketplace financial foundation:

- `domain_outbox_events`;
- `refunds` and `refund_items`;
- immutable `marketplace_ledger_journals`;
- immutable `marketplace_ledger_entries`;
- `vendor_balance_projections`;
- settlement release policy;
- payout batches, items, and attempts;
- ledger transition guards;
- payout state and journal guards.

Implemented services include:

- idempotent captured-payment posting through the outbox;
- deterministic item-allocated refund planning;
- idempotent refund reversal posting;
- balance projection rebuild and reconciliation;
- direct evidence reconciliation for confirmed payments and completed refunds, including missing/failed/dead outbox evidence, missing journals, invalid journal contracts, and journals without entries;
- settlement eligibility and release;
- payout preview and reservation;
- payout dispatch claim, completion, failure release, and reconciliation;
- scheduled outbox and settlement sweep hooks.

Seller finance reads use ledger-derived projections rather than `vendor_orders` totals.

## 5. Payout destination security and review

Seller payout destinations:

- require an application encryption key;
- store encrypted normalized payloads;
- store a seller-scoped fingerprint for duplicate prevention;
- expose only method, provider, display name, status, and masked last four;
- support default selection and historical disable without deletion.

Platform finance users can review masked pending destinations and verify or reject them with actor and timestamp audit fields. No decryption/read-full-account endpoint was added.

A verified destination is required by the payout workflow.

## 6. Admin and seller interfaces

### Seller Dashboard

Implemented functional panels for:

- seller application and application status;
- one-time seller-team invitation acceptance;
- owner/admin team invitation and non-owner membership management;
- seller-managed draft/published public store profile;
- overview metrics;
- product create/edit/submit;
- SKU and inventory editing;
- seller orders;
- manual or configured Pathao/Steadfast shipment creation;
- shipment-specific COD collection amount;
- courier webhook status projection and manual courier refresh fallback;
- shipment status updates with parent-order aggregation;
- ledger-derived balances;
- encrypted payout destination registration and management.

### Marketplace Finance

Implemented platform controls for:

- reconciliation, including successful payment/refund evidence mismatches;
- outbox processing;
- projection rebuild;
- settlement sweep and single release;
- masked payout destination verification/rejection;
- payout preview and reservation;
- payout claim, completion, and release;
- payout history.

All platform finance writes remain protected by platform RBAC and independent marketplace flags.

## 7. Contract cleanup and generated API contracts

The final local contract-cleanup audit is encoded as a regression boundary:

- `vendor_orders` is fulfillment-only and contains no copied seller subtotal, commission, earning, balance, payout, currency, or rate authority;
- seller finance, settlement, and payout reads are ledger-derived;
- active `vendor_users` membership remains the sole seller owner/access authority;
- payout destinations remain encrypted at rest and masked in reads;
- new marketplace accounting, payout, and shipment money uses integer minor units rather than `REAL`;
- inherited `REAL` order/product/delivery fields remain compatibility-only and are not marketplace financial authority.

The canonical authority matrix and compatibility rules are finalized in `MARKETPLACE-DATABASE-CONTRACT.md`.

OpenAPI and `@scalius/api-client` generation now run deterministically without a live API server. A process-local loader stubs Cloudflare virtual modules only during spec generation. The generated contract currently contains 311 routes, including seller courier status refresh, team invitation/member management, and seller profile management endpoints, and the generated client typecheck passes.

Admin route generation now ignores test/spec files through `routeFileIgnorePattern`, removing the previous route-test discovery warnings.

## 8. Fresh verification evidence

### Full tests

```text
Test files: 338 passed / 338
Tests:      1,956 passed / 1,956
Failures:   0
```

The first full run exposed four stale payment/refund test-double contracts after outbox and refund-planner integration. The production safeguards were preserved; only the unit-test doubles were updated to model the real Drizzle insert conflict chain, atomic outbox statement, and `.all()` query method. The focused payment/refund regression then passed 39/39 before the final full suite passed.

### Local browser release suite — 2026-07-17

Playwright Chromium coverage now passes 10/10 for:

- API, Admin, and Storefront local reachability;
- fail-closed public vendor catalog behavior while its feature flag is disabled;
- unauthenticated Seller Dashboard redirect to login;
- real local-admin sign-in and authenticated Seller Dashboard access;
- fresh seller-user creation, application submission, pending review, platform approval, and approved Seller Dashboard unlock;
- rejected seller correction, resubmission, and approval;
- published seller profile visibility on the public Storefront;
- team invitation acceptance, role change, suspension, reactivation, and revocation;
- seller product moderation and payout-destination verification;
- checkout, seller allocation, fulfillment, shipment delivery, COD collection, ledger processing, settlement release, manual payout completion, full refund, and post-payout seller-debt projection.

The browser runs exposed and fixed additional local-release blockers: empty D1 admin detection treated Drizzle `undefined` as an existing admin, the local admin reset helper used the wrong Wrangler config and did not clear completed setup claims, the previous default `.test` admin email was rejected by Better Auth validation, the frontend incorrectly required platform `vendors:view` permission for the membership-authorized seller workspace, and implicit server/client timezones caused Vendor Detail hydration mismatches. Controlled React inputs now wait for hydration before interaction. The tests enable only local D1 marketplace flags, clear local KV cache, and always restore the previous disabled state; no remote mutation occurs.

The expanded release suite also exposed and fixed five integration defects that unit coverage had not caught: public seller-catalog cache invalidation after product/profile/vendor moderation, a legacy JWT middleware that made configured guest checkout impossible, raw phone-transform exceptions that surfaced as HTTP 500 instead of validation responses, parent-order projection that could not advance across valid intermediate states after seller shipment completion, and missing `payment.captured` outbox insertion for COD collections. COD payment, order, and financial-outbox writes are now atomic.

This evidence certifies the complete local onboarding-to-payout-and-refund marketplace journey. It does not constitute production approval; dedicated security review, financial review, independent Cloudflare provisioning, and payout-provider or manual-SOP certification remain required.

### Typecheck and builds

```text
Root typecheck:        7/7 workspace tasks passed
Storefront diagnostics: 0 errors, 0 warnings, 0 hints
API build:             passed
Admin build:           passed
Storefront build:      passed
Deployment dry run:    passed without remote mutation
```

The Admin build still emits a non-fatal warning because some existing chunks exceed the configured warning threshold. Route-test discovery warnings have been removed by ignoring test/spec files in the TanStack route generator. Node also emits the existing `punycode` deprecation warning.

### Isolation and migration metadata

```text
Project isolation: passed
Migration metadata: 69 SQL files / 69 journal entries
Git diff whitespace check: passed
```

### Source-control snapshot

The verified current source tree is published as a clean public snapshot in `rahmatullahboss/scalius-commerce-lite` on the canonical `main` branch. Earlier development history is retained separately in a private archive because a historical security-alert export contained sensitive fields and was not suitable for public distribution. No application deployment or remote database migration was performed.

### Fresh disposable local D1

Persist path:

```text
.wrangler/marketplace-onboarding-verification
```

Results:

```text
Applied migrations: 69
Pending migrations: 0
First migration: 0000_cultured_newton_destine.sql
Last migration:  0068_vendor_profiles.sql
Canonical marketplace tables found: 21/21
Platform vendor: vendor_platform / approved
Selected critical allocation and immutability triggers found: 8/8
```

Verified canonical tables include:

- all vendor identity, accepted membership, hashed invitation, public profile, address, commission, payout, moderation, order, shipment, and balance-projection tables;
- domain outbox events;
- refunds and item allocations;
- marketplace ledger journals and entries;
- payout batches, items, and attempts.

No remote D1 operation occurred. Every Wrangler database command explicitly used `--local` and the placeholder database ID.

## 9. Remaining limitations and release blockers

This is not a production-release approval.

Remaining items include:

- perform dedicated security and financial reviews;
- define and provision a new independent Cloudflare environment only through an owner-approved release packet;
- configure real encryption secrets and provider credentials in that future environment;
- complete a dedicated concurrent owner-store conflict browser stress scenario;
- connect and certify a real payout provider or documented manual payout operating procedure;
- reduce existing non-fatal Admin chunk-size warnings through a dedicated performance/code-splitting pass;
- perform the dedicated internal package-namespace rename only if separately approved.

All marketplace feature flags remain disabled by default. Enabling them must be staged and evidence-driven.

## 10. Staff handoff rule

Before parallel implementation or release preparation:

1. fetch the private repository and start from the canonical `main` branch after its verified push;
2. create an integration branch and isolated task worktrees;
3. assign one schema integrator;
4. claim owned paths in `task-progress.yaml`;
5. do not edit already shared migrations;
6. do not run remote migration or deploy commands without the owner-approved release packet.
