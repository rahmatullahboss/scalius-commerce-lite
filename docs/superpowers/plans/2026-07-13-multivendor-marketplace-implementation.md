# Scalius Commerce Multi-Vendor Marketplace Implementation Plan

> **For implementation agents:** Start with `docs/architecture/multivendor/START-HERE-FOR-STAFF.md`, use the repository `using-superpowers` workflow and the `executing-plans` skill, and claim the assigned task in `task-progress.yaml` before editing source files. The readiness phase R00 must finish before Task 1 or any marketplace schema/feature task begins.

**Goal:** Convert the existing single-store commerce platform into a production-safe multi-vendor marketplace without duplicating core commerce systems or allowing parallel agents to fragment the database.

**Architecture:** Keep the existing modular monolith and customer order/payment flows. Add explicit seller scope, immutable order-item seller/financial snapshots, seller fulfillment groups, a durable domain outbox, item-allocated refunds, and an append-only balanced marketplace subledger. Migrate using expand-and-contract with feature flags and reconciliation gates.

**Tech stack:** TypeScript, pnpm/Turborepo, Hono/OpenAPI, TanStack Start, Astro, Drizzle ORM, Cloudflare D1/SQLite, Cloudflare Queues, Vitest.

---

## 0. Execution rules

### Required reading

- `AGENTS.md`
- `docs/architecture/multivendor/START-HERE-FOR-STAFF.md`
- `docs/architecture/multivendor/2026-07-13-cloudflare-and-readiness-audit.md`
- `docs/architecture/multivendor/README.md`
- `docs/architecture/multivendor/2026-07-13-current-state-audit.md`
- `docs/architecture/multivendor/2026-07-13-target-architecture.md`
- `docs/architecture/multivendor/2026-07-13-migration-roadmap.md`
- `docs/architecture/multivendor/DATABASE-GOVERNANCE.md`
- `docs/architecture/multivendor/task-progress.yaml`

### Branch and worktree

Each implementation packet uses an isolated branch/worktree. The task claim records:

- task ID
- branch and worktree
- owned paths
- high-contention paths that remain integration-owner-only
- migration impact
- test commands

### High-contention files

Only the active schema integrator edits:

- `packages/database/src/schema/index.ts`
- `packages/database/migrations/meta/_journal.json`
- migration snapshots
- shared generated OpenAPI client output
- `pnpm-lock.yaml` when avoidable

Feature agents hand off their intended export/journal/client changes to the integrator.

### Verification baseline

Use focused tests during each task. Before a phase is marked complete, run:

```bash
pnpm --filter @scalius/database check:migrations
pnpm --filter @scalius/database typecheck
pnpm --filter @scalius/core typecheck
pnpm --filter @scalius/api typecheck
pnpm test
```

Do not enable a feature flag when its reconciliation command reports an unexplained mismatch.

### Mandatory readiness phase R00

The owner clarified that the original public deployment is not this project's target and confirmed that migrations `0058`/`0059` were never applied. Track A was selected and the canonical local foundation was implemented under `2026-07-13-local-ownership-and-canonical-foundation.md`.

Completed R00 evidence:

1. original runtime/deployment connections removed and guarded by automated isolation checks;
2. canonical replacements for `0058`/`0059` applied to a fresh local D1;
3. clean-install root TypeScript dependency/tooling repaired;
4. full regression baseline restored without weakening order retry/compensation assertions;
5. API/Admin/Storefront builds and root deploy dry-run pass without remote mutation;
6. fresh local D1 has 60 applied and 0 pending migrations.

The remaining R00 collaboration task is preserving the WIP on an owner-approved private remote snapshot branch before parallel staff work. Local Phase P00 safety work may continue in the owner-authorized current session. Payout, ledger exposure, seller financial reporting, remote migration, and Worker deployment remain blocked.

---

## Parallelization map

Tasks may run in parallel only after their contracts are frozen.

| Lane | Safe parallel work | Blocking contract |
|---|---|---|
| A — Public safety | product predicate, cache invalidation tests, checkout revalidation | vendor/product status contract |
| B — Authorization | seller capability policy, context middleware, negative tests | membership authority |
| C — Money | minor-unit utilities, allocation property tests | money and commission formulas |
| D — Vendor identity | core commands, payout encryption, moderation events | migration track and schema proposal |
| E — Accounting | ledger pure journal builders, reconciliation tests | accepted ledger schema |
| F — Fulfillment | vendor-order state machine, shipment projection | canonical order-item/vendor-order contract |
| G — UI/API | seller pages and API client | accepted API contracts and feature flags |

Two agents must not independently redesign `order_items`, generate migration journals, or implement competing seller balance sources.

---

## Task 1: Confirm canonical migration baseline and schema lock — COMPLETED

**Owner:** release/schema integrator  
**Schema change:** completed Track A replacement  
**Blocks:** no longer blocks Phase P00; it still governs future schema work

**Completed evidence:**

- Owner confirmed `0058`/`0059` were never applied.
- Original public deployment was declared out of scope.
- Track A was recorded in `task-progress.yaml` and `.ai-bridge/decisions.md`.
- Canonical replacements were applied to a fresh local D1.
- All 60 migrations are applied and 0 are pending.
- The next schema integrator must claim the integration lock before changing migrations or shared schema files.

### Continuing rule

Do not edit `0058` or `0059` after a shared environment uses them. Future corrections must be forward-only. Every later schema task references the selected Track A baseline and the schema-governance rules.

---

## Task 2: Add marketplace feature flags disabled by default

**Owner:** platform configuration  
**Schema change:** use existing settings system; no new feature-specific table

**Files:**

- Modify: marketplace settings/feature flag module under `packages/core/src/modules/settings/`
- Modify: relevant API/app environment validation
- Test: add focused feature flag tests beside the settings module

### Required flags

```ts
type MarketplaceFeatureFlag =
  | "marketplace.vendor_onboarding_write"
  | "marketplace.vendor_catalog_write"
  | "marketplace.public_vendor_catalog"
  | "marketplace.seller_order_actions"
  | "marketplace.ledger_posting"
  | "marketplace.settlement_release"
  | "marketplace.payout_write"
  | "marketplace.vendor_shipments";
```

### Steps

1. Write failing tests proving every flag defaults to disabled when absent.
2. Implement typed flag retrieval through the existing settings authority.
3. Add route/service guards without hiding historical reads.
4. Add tests proving each write/public flag can be disabled independently.
5. Run focused tests and typecheck.

### Acceptance

- No marketplace public/write capability defaults to enabled.
- Seller history remains readable when writes are disabled.

---

## Task 3: Centralize the public-sellable product predicate

**Owner:** catalog  
**Schema change:** none

**Files:**

- Create: `packages/core/src/modules/products/public-sellable.ts`
- Modify: `packages/core/src/modules/products/products.storefront.ts`
- Modify: storefront search/category/collection/widget/sitemap query modules found by targeted search
- Modify: checkout product validation path
- Test: `packages/core/src/modules/products/public-sellable.test.ts`
- Test: focused storefront product query tests

### Contract

```ts
export interface PublicSellableProductOptions {
  allowPlatformVendor?: boolean;
}

export function buildPublicSellableProductCondition(
  options?: PublicSellableProductOptions,
): SQL;
```

The condition enforces:

```text
products.deleted_at IS NULL
AND products.is_active = true
AND products.approval_status = 'approved'
AND vendors.deleted_at IS NULL
AND vendors.status = 'approved'
```

The platform vendor is created with approved status, so it should not require a bypass after backfill.

### Steps

1. Write a status matrix test for product status × vendor status.
2. Add the shared predicate and vendor join.
3. Apply it to list, detail, related, search, category, collection, widget, sitemap, and checkout validation paths.
4. Add cache invalidation tests for product/vendor suspension.
5. Confirm current single-store products remain visible under the platform vendor.

### Acceptance

- No public or checkout path has an independent weaker predicate.
- Draft/submitted/rejected/suspended product tests all fail closed.
- Pending/rejected/suspended/deleted vendor tests all fail closed.

---

## Task 4: Separate seller capability authorization from platform RBAC

**Owner:** auth/security  
**Schema change:** none initially

**Files:**

- Create: `packages/core/src/auth/vendor-capabilities.ts`
- Modify: `packages/core/src/auth/vendor-context.ts`
- Modify: `packages/core/src/auth/index.ts`
- Modify: `apps/api/src/routes/admin/vendor-dashboard.ts` or move seller routes under a dedicated seller route namespace
- Modify: `packages/core/src/auth/rbac/route-permissions.ts`
- Test: `packages/core/src/auth/vendor-capabilities.test.ts`
- Test: API cross-vendor authorization tests

### Contract

```ts
export type VendorCapability =
  | "vendor.profile.read"
  | "vendor.profile.edit"
  | "vendor.members.read"
  | "vendor.members.manage"
  | "vendor.products.read"
  | "vendor.products.write"
  | "vendor.products.submit"
  | "vendor.orders.read"
  | "vendor.orders.fulfill"
  | "vendor.finance.read"
  | "vendor.payout_method.manage";

export interface MarketplaceActorContext {
  actorUserId: string;
  actorType: "platform" | "vendor" | "system";
  vendorId: string | null;
  capabilities: ReadonlySet<VendorCapability>;
  requestId: string;
}

export async function requireVendorCapability(
  db: Database,
  userId: string,
  vendorId: string,
  capability: VendorCapability,
): Promise<MarketplaceActorContext>;
```

### Steps

1. Write failing role-to-capability tests for owner/admin/staff/fulfillment.
2. Write negative tests for other vendor, suspended membership, and suspended vendor.
3. Implement deterministic membership selection; do not default to an unordered first membership for sensitive actions.
4. Remove the requirement for global `vendors.view` from seller routes.
5. Keep platform vendor-management routes protected by platform RBAC.
6. Ensure client-supplied vendor ID is verified against membership for seller actors.

### Acceptance

- Seller portal access grants no platform vendor-management visibility.
- Seller A cannot read or mutate Seller B resources.
- Suspensions fail closed on every request.

---

## Task 5: Canonicalize vendor identity, ownership, moderation, and payout methods

**Owner:** vendor domain + schema integrator  
**Schema change:** yes; proposal required

**Schema files:**

- Transform/rename in dedicated integration: `packages/database/src/schema/vendorx.ts` to `packages/database/src/schema/vendors.ts`
- Modify: `packages/database/src/schema/products.ts`
- Create or approved-domain file for moderation/verification events
- Add forward migration or replace foundation according to Task 1 decision

**Core files:**

- Create: `packages/core/src/modules/vendors/vendors.commands.ts`
- Create: `packages/core/src/modules/vendors/vendors.queries.ts`
- Create: `packages/core/src/modules/vendors/vendors.validation.ts`
- Create: `packages/core/src/modules/vendors/payout-method-encryption.ts`
- Modify: `apps/api/src/routes/admin/vendors.ts`
- Modify: `apps/api/src/routes/admin/products.ts`

**Tests:**

- `packages/core/src/modules/vendors/vendors.commands.test.ts`
- `packages/core/src/modules/vendors/payout-method-encryption.test.ts`
- moderation state-machine tests
- migration/backfill tests

### Canonical commands

```ts
interface CreateVendorCommand {
  displayName: string;
  slug: string;
  legalName: string | null;
  ownerUserId: string;
  defaultCurrency: string;
}

interface TransferVendorOwnershipCommand {
  vendorId: string;
  nextOwnerUserId: string;
  expectedVersion: number;
  reason: string;
}

interface ModerateProductCommand {
  productId: string;
  nextStatus: "approved" | "rejected" | "suspended";
  reasonCode: string;
  reasonText: string | null;
}
```

### Steps

1. Create the platform vendor with a deterministic ID.
2. Backfill null product vendor IDs and verify zero nulls.
3. Make membership the ownership authority; compare and resolve `owner_user_id` mismatches.
4. Implement vendor creation as one batch: vendor, owner membership, audit event.
5. Implement ownership transfer as one CAS batch.
6. Add product moderation events and transition service.
7. Replace direct route table writes with core commands.
8. Replace payout account storage with encrypted payload + key version + display mask.
9. Remove raw payout identifiers from normal response schemas.
10. Add security tests proving raw data is absent from logs/API responses.

### Acceptance

- Every product has a seller.
- Vendor ownership has one authority.
- Create/transfer/moderation operations are atomic and audited.
- Payout details are encrypted and masked.

---

## Task 6: Add integer-money and deterministic allocation utilities

**Owner:** money/allocation lane  
**Schema change:** none

**Files:**

- Create: `packages/shared/src/money/minor-units.ts`
- Create: `packages/shared/src/money/allocation.ts`
- Create: `packages/shared/src/money/commission.ts`
- Export through the shared package public map
- Test: matching `.test.ts` files

### Contract

```ts
export type MoneyMinor = number & { readonly __brand: "MoneyMinor" };
export type BasisPoints = number & { readonly __brand: "BasisPoints" };

export function asMoneyMinor(value: number): MoneyMinor;
export function majorToMinor(value: string | number, exponent: number): MoneyMinor;
export function minorToMajor(value: MoneyMinor, exponent: number): string;

export interface AllocationInput {
  id: string;
  weightMinor: MoneyMinor;
}

export function allocateProportionally(
  totalMinor: MoneyMinor,
  inputs: readonly AllocationInput[],
): ReadonlyMap<string, MoneyMinor>;

export function calculateCommissionMinor(
  baseMinor: MoneyMinor,
  rateBps: BasisPoints,
  fixedFeeMinor?: MoneyMinor,
): MoneyMinor;
```

### Tests

- invalid non-integer inputs are rejected
- zero total and zero weights
- one line
- many lines with remainder
- deterministic tie by ID
- negative values rejected where not permitted
- maximum safe integer guards
- property: allocations always sum exactly to total
- property: commission is deterministic and bounded

### Acceptance

- No marketplace allocation uses floating point.
- The utility returns exact sums and deterministic output.

---

## Task 7: Add canonical order-item seller and financial snapshots

**Owner:** orders + schema integrator + financial reviewer  
**Schema change:** yes; proposal required

**Files:**

- Modify: `packages/database/src/schema/orders.ts`
- Transform: `packages/database/src/schema/vendor-orders.ts`
- Add migration according to selected track
- Create: `packages/core/src/modules/orders/order-allocation.ts`
- Modify: `packages/core/src/modules/orders/orders.ingest.ts`
- Modify: `packages/core/src/modules/orders/orders.queue.ts`
- Modify: `packages/core/src/modules/orders/orders.admin.ts`
- Replace/retire: `packages/core/src/modules/orders/vendor-order-split.ts`
- Test: `packages/core/src/modules/orders/order-allocation.test.ts`
- Test: all order creation/edit path tests

### Allocation contract

```ts
interface OrderAllocationLineInput {
  orderItemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPriceMinor: MoneyMinor;
  vendorId: string;
  vendorNameSnapshot: string;
  productNameSnapshot: string;
  skuSnapshot: string | null;
  commissionRule: AppliedCommissionRule;
}

interface CanonicalOrderAllocation {
  orderTotals: {
    itemSubtotalMinor: MoneyMinor;
    discountMinor: MoneyMinor;
    shippingMinor: MoneyMinor;
    taxMinor: MoneyMinor;
    roundingAdjustmentMinor: MoneyMinor;
    totalMinor: MoneyMinor;
  };
  vendorOrders: readonly VendorOrderInsert[];
  orderItems: readonly CanonicalOrderItemInsert[];
}

export function allocateOrderToVendors(
  input: AllocateOrderInput,
): CanonicalOrderAllocation;
```

### Steps

1. Add parallel order/item minor-unit columns and immutable seller snapshot columns.
2. Add commission rule ID, basis points, base, fee, and vendor net snapshots.
3. Define `vendor_orders` as operational fulfillment groups with version/status timestamps.
4. Stop duplicating quantity/price/fulfillment in `vendor_order_items`; retain only during compatibility if Track B requires it.
5. Implement pure allocation with exact reconciliation assertions.
6. Integrate the same function into every order creation path.
7. Ensure all writes participate in one safe D1 batch after inventory reservation.
8. Replace order edit with atomic pre-settlement reallocation or fail closed when the order is no longer editable.
9. Add tests for products from one/two/many vendors, discounts, shipping, commission overrides, retries, and edits moving a line to another vendor.

### Acceptance

- Every new order item has immutable seller and integer money snapshots.
- One order creates exactly one vendor order per seller.
- All totals reconcile exactly.
- Editing cannot leave stale seller groups.

---

## Task 8: Add versioned commission rules

**Owner:** marketplace accounting + schema integrator  
**Schema change:** yes; proposal required

**Files:**

- Create: approved schema file for `commission_rules`
- Create: `packages/core/src/modules/marketplace-accounting/commission-rules.ts`
- Test: `commission-rules.test.ts`
- Add migration and indexes

### Contract

```ts
interface ResolveCommissionRuleInput {
  vendorId: string;
  productId: string;
  categoryId: string | null;
  currency: string;
  occurredAt: Date;
}

interface AppliedCommissionRule {
  ruleId: string;
  rateBps: BasisPoints;
  fixedFeeMinor: MoneyMinor;
  minimumFeeMinor: MoneyMinor | null;
  maximumFeeMinor: MoneyMinor | null;
}
```

Resolution precedence:

```text
product > category > vendor > platform_default
then priority DESC, effective_from DESC, id ASC
```

### Acceptance

- Historical orders retain applied rule snapshots after rule edits.
- Overlapping/ambiguous rules are rejected or deterministically resolved with tests.

---

## Task 9: Backfill and reconcile canonical order allocation

**Owner:** data migration/reconciliation  
**Schema change:** data migration/script

**Files:**

- Create: `scripts/marketplace/backfill-order-allocation.mjs` or typed repository-standard equivalent
- Create: `scripts/marketplace/reconcile-order-allocation.mjs`
- Create: representative fixture snapshots under the database test fixtures
- Modify: `docs/architecture/multivendor/task-progress.yaml`

### Steps

1. Read orders in stable primary-key order with restartable checkpoints.
2. Convert REAL/decimal values through configured currency exponent.
3. Resolve seller from product; use platform vendor for missing/retired legacy product and record provenance.
4. Create canonical vendor orders and order-item snapshots idempotently.
5. Report ambiguous or mathematically inconsistent orders without silent correction.
6. Run exact reconciliation equations.
7. Store bounded exception report with order IDs and reason; no customer PII.
8. Re-run the backfill to prove idempotency.

### Acceptance

- Zero null seller snapshots.
- Zero unexplained money or vendor-group mismatch.
- Repeated execution makes no duplicate rows or changed totals.

---

## Task 10: Add durable domain outbox

**Owner:** platform events + schema integrator  
**Schema change:** yes; proposal required

**Files:**

- Add approved `domain_outbox_events` schema
- Create: `packages/core/src/modules/domain-events/outbox.ts`
- Create: queue consumer/dispatcher in the API worker integration
- Test: claim, lease expiry, retry, idempotency tests

### Contract

```ts
interface DomainOutboxEvent<TPayload> {
  id: string;
  eventKey: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  schemaVersion: number;
  payload: TPayload;
}

export function buildDomainOutboxInsert<TPayload>(
  event: DomainOutboxEvent<TPayload>,
): DomainOutboxInsert;
```

### Acceptance

- Local commands write the outbox event in the same batch.
- Consumers use leases and replay safely.
- Payloads are bounded, versioned, and secret-free.

---

## Task 11: Add immutable balanced marketplace subledger

**Owner:** marketplace accounting + financial reviewer + schema integrator  
**Schema change:** yes; proposal required

**Files:**

- Create approved schema for ledger journals, entries, and optional balance projection
- Create: `packages/core/src/modules/marketplace-accounting/ledger.ts`
- Create: `packages/core/src/modules/marketplace-accounting/journal-builders.ts`
- Create: `packages/core/src/modules/marketplace-accounting/reconciliation.ts`
- Test: ledger, journal-builder, immutability, and reconciliation tests
- Add raw SQL triggers preventing update/delete of posted rows

### Contract

```ts
type MarketplaceAccountCode =
  | "cash_clearing"
  | "vendor_pending_payable"
  | "vendor_available_payable"
  | "vendor_payout_reserved"
  | "vendor_paid"
  | "platform_commission_revenue"
  | "shipping_clearing"
  | "refund_clearing"
  | "marketplace_adjustment";

interface LedgerEntryDraft {
  vendorId: string | null;
  accountCode: MarketplaceAccountCode;
  debitMinor: MoneyMinor;
  creditMinor: MoneyMinor;
  vendorOrderId?: string;
  orderItemId?: string;
}

interface LedgerJournalDraft {
  idempotencyKey: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
  currency: string;
  entries: readonly LedgerEntryDraft[];
}

export async function postLedgerJournal(
  db: Database,
  draft: LedgerJournalDraft,
): Promise<{ journalId: string; alreadyPosted: boolean }>;
```

### Steps

1. Write failing tests for unbalanced journal, duplicate idempotency key, update/delete, and reversal.
2. Implement journal balance validation.
3. Insert journal and all entries in one batch.
4. Add immutable update/delete triggers.
5. Add balance projection rebuild from entries.
6. Add exact journal and vendor-balance reconciliation.

### Acceptance

- Every journal balances by currency.
- Posted rows are immutable.
- Replay returns the existing journal.
- Projection rebuild equals incremental projection.

---

## Task 12: Post captured payments to the ledger

**Owner:** payments + accounting  
**Schema change:** no after ledger/outbox

**Files:**

- Modify: `packages/core/src/modules/payments/process-payment.ts`
- Modify: COD payment capture path
- Modify: Polar/Stripe/SSLCommerz success integration as required
- Create: payment-captured event contract
- Create: ledger consumer handler
- Test: payment replay, partial/deposit/balance, COD, and event backlog tests

### Steps

1. Add `payment.captured` outbox row to the same batch that marks an order payment succeeded.
2. Include only IDs and immutable event facts; no sensitive gateway payload.
3. Consumer loads canonical order-item financial snapshots and builds capture journal.
4. Use event key as ledger idempotency key.
5. Handle partial payment policy explicitly; do not make seller value available before the selected captured-payment allocation policy is met.
6. Add reconciliation: every succeeded payment has a journal or pending/retryable event.

### Acceptance

- Seller pending balance increases only from captured payment evidence.
- Event replay cannot double seller earnings.
- Checkout/payment remains operational when ledger consumer is temporarily paused; outbox backlog is visible.

---

## Task 13: Add item-allocated refunds and ledger reversals

**Owner:** payments/refunds + accounting + schema integrator  
**Schema change:** yes; proposal required

**Files:**

- Add `refunds` and `refund_items` schema/migration
- Modify: `packages/core/src/modules/payments/refund-service.ts`
- Create: `packages/core/src/modules/payments/refund-allocation.ts`
- Modify: admin refund API request/response schema
- Regenerate API client through integration owner
- Test: allocation, concurrency, replay, post-payout negative balance, and stock separation tests

### Request contract

```ts
interface MarketplaceRefundItemInput {
  orderItemId: string;
  quantity: number;
  amountMinor?: MoneyMinor;
}

interface CreateMarketplaceRefundCommand {
  orderId: string;
  paymentId?: string;
  items: readonly MarketplaceRefundItemInput[];
  reason: string;
  idempotencyKey: string;
}
```

### Steps

1. Validate order item quantities and remaining refundable amounts.
2. Allocate discount/shipping/tax/commission/vendor-net reversals exactly.
3. Claim refund capacity per item in the same local claim batch.
4. Dispatch provider refund after durable claim.
5. Finalize normalized refund and emit `refund.completed`.
6. Post reversal journal referencing original capture journal.
7. Keep inventory return separate; restore stock only through return/inspection outcome.
8. Add legacy single-seller expansion rule for old order-level refund requests or reject ambiguous requests.

### Acceptance

- Refund item totals equal provider refund exactly.
- Concurrent requests cannot over-refund an item.
- Seller and commission reversals are explainable.
- Refund after payout creates defined negative/debt balance, not ledger mutation.

---

## Task 14: Add settlement release and payout workflow

**Owner:** payouts + accounting + security + schema integrator  
**Schema change:** yes; proposal required

**Files:**

- Add payout batch/item/attempt schema
- Create: `packages/core/src/modules/payouts/payouts.commands.ts`
- Create: `packages/core/src/modules/payouts/payouts.queries.ts`
- Create: settlement eligibility/release module
- Add platform payout API routes
- Add seller payout-history queries
- Test: concurrency, reserve/release, provider retry, verified-method requirement, and masking

### Contracts

```ts
interface CreatePayoutBatchCommand {
  currency: string;
  vendorIds?: readonly string[];
  minimumAmountMinor: MoneyMinor;
  idempotencyKey: string;
}

interface CompletePayoutAttemptCommand {
  payoutItemId: string;
  attemptId: string;
  providerReference: string;
  completedAt: Date;
}
```

### Steps

1. Implement pending-to-available settlement release based on delivery and hold policy.
2. Build payout preview from available ledger balance.
3. Reserve available balance in ledger and create payout items atomically.
4. Dispatch only from a durable reserved item and verified encrypted payout method.
5. Complete or release reservation idempotently.
6. Store sanitized attempt metadata; never copy raw payout credentials.
7. Reconcile batch, item, attempts, and ledger journals.

### Acceptance

- Concurrent payout requests cannot double reserve.
- Failure/cancellation returns exact funds.
- Completed payout amount equals completion journal.
- No unverified/deleted method can receive payout.

---

## Task 15: Scope seller fulfillment and shipments

**Owner:** fulfillment/delivery + security + schema integrator  
**Schema change:** yes

**Files:**

- Modify: `packages/database/src/schema/delivery.ts`
- Modify canonical vendor-order schema
- Create: `packages/core/src/modules/orders/vendor-order-state.ts`
- Modify delivery service/provider adapters
- Modify delivery webhook handlers
- Add seller shipment API routes
- Test: cross-seller, duplicate claim, webhook replay, partial shipment, order projection

### Contract

```ts
interface CreateVendorShipmentCommand {
  vendorOrderId: string;
  orderItemQuantities: readonly {
    orderItemId: string;
    quantity: number;
  }[];
  providerType: string;
  idempotencyKey: string;
}
```

### Steps

1. Add vendor-order state machine and optimistic version.
2. Add `vendor_order_id` and seller snapshot to shipments.
3. Add normalized shipment items only if partial shipments are enabled.
4. Claim seller items before provider booking.
5. Use seller pickup address and platform-approved provider credentials.
6. Map webhook to shipment, seller order, and customer order projection idempotently.
7. Implement multi-package customer tracking.

### Acceptance

- Seller can ship only own items.
- One package does not mark a multi-seller order delivered.
- Provider/webhook replay is safe.

---

## Task 16: Replace seller dashboard financial reads

**Owner:** accounting API/UI  
**Schema change:** none after balance projection

**Files:**

- Modify: `apps/api/src/routes/admin/vendor-dashboard.ts` or dedicated seller routes
- Add marketplace accounting query service
- Modify seller/admin dashboard components
- Regenerate API client through integration owner
- Test: ledger account mapping and tenant isolation

### Required metrics

- captured gross sales
- refunded sales
- commission charged/reversed
- pending settlement
- available payout balance
- payout reserved
- paid
- negative/debt balance

### Steps

1. Remove queries summing mutable `vendor_orders.vendor_net_amount` as payout balance.
2. Read ledger/balance projection through seller-scoped query service.
3. Fix product pending status terminology (`submitted`, not `pending`).
4. Label operational order value separately from financial balance.
5. Add date-basis documentation: capture date, refund date, available date, payout date.

### Acceptance

- Fresh projection rebuild returns the same dashboard values.
- Seller A cannot query Seller B finance.

---

## Task 17: Complete seller catalog/order portal and public seller pages

**Owner:** seller API/UI + storefront  
**Schema change:** only accepted profile fields; no feature-specific tables

**Files:**

- Add dedicated seller route namespace/components
- Add seller product draft/edit/submit flows
- Add seller order accept/process/ready/ship flows
- Add membership/invite UI according to capabilities
- Add public seller profile and product listing in storefront
- Update sitemap/cache invalidation
- Test UI/API authorization and public eligibility

### Rules

- Seller forms never submit an authoritative vendor ID without server membership verification.
- Seller product creation always derives vendor from actor context.
- Approved product edits follow moderation policy.
- Financial UI uses ledger APIs only.
- Public seller pages use approved profile and centralized sellable predicate.

### Acceptance

- No seller user needs platform vendor-management permission.
- Complete tenant-isolation suite passes.
- Feature flags can disable each write/public surface independently.

---

## Task 18: Contract cleanup and legacy retirement

**Owner:** schema integrator + all domain owners  
**Schema change:** yes, only after stable cutover

**Files:**

- Remove legacy copied seller financial reads/writes
- Retire `vendor_order_items` duplicate authority
- Remove `vendors.owner_user_id`
- Remove plaintext payout columns
- Retire marketplace REAL financial fields through D1 rebuild
- Rename `vendorx.ts` in a dedicated refactor if not already completed
- Update `packages/database/README.md`
- Update all architecture documents and progress state

### Preconditions

- Canonical reads have been enabled and stable.
- Reconciliation reports zero unexplained mismatches.
- No API/client consumer uses legacy fields.
- Payout, refund, ledger, and fulfillment production gates pass.

### Steps

1. Search all legacy references and create an explicit removal inventory.
2. Stop legacy writes behind flags.
3. Reconcile and observe.
4. Remove legacy reads.
5. Apply forward contract migration/table rebuild.
6. Regenerate OpenAPI client and documentation.
7. Run full verification suite and representative migration tests.

### Acceptance

- One authority remains for every marketplace fact.
- Database documentation matches implemented schema.
- No legacy seller balance path remains.

---

## Phase review checklist

At the end of every phase:

1. Review `show_changes` and confirm no unrelated existing work was overwritten.
2. Run migration check, relevant typechecks, focused tests, and phase suite.
3. Run phase reconciliation commands.
4. Update `task-progress.yaml` task statuses and evidence.
5. Update decisions/questions and architecture docs when implementation differs.
6. Confirm feature flags remain disabled unless the release gate is explicitly satisfied.
7. Hand off with exact changed paths, migration status, tests, unresolved risks, and rollback action.

## Final definition of done

The program is complete when:

- current single-store data operates as the platform vendor
- every active product has explicit seller ownership
- public catalog and checkout enforce seller/product approval
- seller authorization is tenant-scoped and separate from platform RBAC
- every order item has immutable seller and integer financial snapshots
- seller fulfillment groups and shipments reconcile to order items
- payments/refunds post idempotent balanced ledger journals
- seller balances rebuild exactly from immutable entries
- payouts reserve, complete, or release balances without duplication
- sensitive payout data is encrypted and masked
- all legacy duplicate seller financial authorities are retired
- architecture, governance, migration history, OpenAPI, and database documentation agree
