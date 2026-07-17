# Local Foundation Progress Report

> Historical foundation report. Superseded for current implementation status by [`2026-07-14-marketplace-implementation-progress.md`](./2026-07-14-marketplace-implementation-progress.md).

**Date:** 2026-07-13  
**Execution mode:** local-only implementation in the existing WIP checkout  
**Remote operations:** none  
**Migration track:** `A_unapplied_foundation_may_be_replaced`  
**Current result:** canonical local marketplace foundation implemented and verified

## 1. Owner decisions applied

The owner confirmed:

- migrations `0058` and `0059` were never applied;
- the public Scalius deployment is not this project's target;
- this repository was cloned only as a starting point and will be operated independently;
- active connections to the original project should be removed;
- development should continue locally before any new live Cloudflare environment is provisioned.

Based on that evidence, the old WIP contents of `0058` and `0059` were replaced in place. From this point onward, the replacement migrations are part of the canonical local baseline. They must not be edited after they are applied to any shared environment.

## 2. Original-project isolation

Active deployment/runtime configuration no longer references the original project's:

- public domains;
- Worker names;
- D1 name and UUID;
- KV namespace IDs;
- R2 bucket;
- queues;
- service bindings;
- API runtime fallback.

Local-owned placeholder identities are now used:

| Resource | Local identity |
|---|---|
| API Worker | `marketplace-api-local` |
| Admin Worker | `marketplace-admin-local` |
| Storefront Worker | `marketplace-storefront-local` |
| D1 | `marketplace-local-db` |
| R2 | `marketplace-local-media` |
| API URL | `http://localhost:8787` |
| Admin URL | `http://localhost:4323` |
| Storefront URL | `http://localhost:4322` |

Added automated guards:

- `scripts/check-project-isolation.mjs`
- `scripts/check-project-isolation.test.mjs`
- `scripts/deploy-guard.mjs`
- `scripts/deploy-guard.test.mjs`

Remote migration/deploy now fails before Wrangler unless all of the following are true:

1. explicit approval variable is present;
2. the configuration no longer contains local placeholder resources;
3. a future owner-approved Cloudflare environment has been provisioned.

## 3. Canonical migration 0058

`packages/database/migrations/0058_create_vendors.sql` now creates the canonical seller identity/catalog foundation.

Implemented:

- `vendors`;
- `vendor_users` as the sole seller-access/owner authority;
- one active owner per seller through a partial unique index;
- normalized seller addresses;
- encrypted and masked payout methods;
- verification documents using protected storage metadata;
- seller moderation events;
- versioned integer basis-point commission rules;
- approved platform seller seed `vendor_platform`;
- product seller ownership and moderation version;
- product moderation event history.

Removed from the old design:

- duplicated `vendors.owner_user_id` authority;
- floating-point commission rate;
- plaintext payout account number;
- raw public KYC file URL as the canonical document reference.

## 4. Canonical migration 0059

`packages/database/migrations/0059_vendor_order_split_foundation.sql` now creates the canonical seller order allocation foundation.

Implemented:

- fulfillment-only `vendor_orders`;
- seller/order uniqueness;
- versioned fulfillment status;
- immutable seller snapshots on `order_items`;
- integer minor-unit price, discount, commission, and seller-net fields;
- commission rule and basis-point snapshots;
- deterministic historical backfill;
- insert/update seller-allocation validation triggers;
- immutable marketplace snapshot trigger.

Removed from the old design:

- duplicate `vendor_order_items` table;
- financial totals on mutable `vendor_orders`;
- payout status on fulfillment rows;
- floating-point marketplace financial columns.

## 5. Canonical order allocation service

`packages/core/src/modules/orders/vendor-order-split.ts` was rebuilt around one pure allocation plan.

Properties:

- validates quantity, price, discount, and commission basis points;
- converts prices to integer minor units;
- uses deterministic integer commission rounding;
- groups one customer order into seller fulfillment partitions;
- uses product seller ownership and active commission rules;
- falls back to the platform seller for legacy/missing ownership context;
- creates seller fulfillment rows before allocated order-item rows;
- supports idempotent `vendor_orders` insertion;
- never writes a duplicate seller-item authority.

Integrated into:

- storefront synchronous order creation;
- order-ingest queue processing;
- admin-created orders.

The previous retry, acknowledgement, reservation release, and compensation assertions were preserved.

## 6. Vendor API and Admin UI alignment

The temporary vendor management API/UI was aligned to the canonical schema.

API now uses:

- membership-derived owner authority;
- normalized addresses;
- versioned basis-point commission rules;
- seller moderation events;
- masked payout method responses;
- protected verification document metadata.

The seller dashboard no longer calculates revenue, commission, payable balance, or pending payout from `vendor_orders`. It reports only:

- product counts;
- fulfillment counts;
- verified payout method counts;
- an explicit message that financial reporting is unavailable until the immutable ledger exists.

## 7. Toolchain repair

Packages that execute `tsc` now declare TypeScript directly:

- `packages/shared`;
- `packages/api-client`.

This repaired the clean-install root typecheck pipeline.

## 8. Fresh local D1 evidence

A fresh disposable local D1 rehearsal was created under:

```text
.wrangler/marketplace-verification
```

Verified results:

```text
Applied migrations: 60
Pending migrations: 0
First: 0000_cultured_newton_destine.sql
Last: 0059_vendor_order_split_foundation.sql
```

Canonical marketplace tables found:

- `vendors`;
- `vendor_users`;
- `vendor_addresses`;
- `vendor_payout_methods`;
- `vendor_verification_documents`;
- `vendor_moderation_events`;
- `vendor_commission_rules`;
- `product_moderation_events`;
- `vendor_orders`.

Confirmed absent:

- `vendor_order_items`.

Seller-allocation triggers found:

- `order_items_allocate_vendor_after_insert`;
- `order_items_validate_vendor_order_before_insert`;
- `order_items_validate_vendor_order_before_update`.

Platform seller seed:

```text
id: vendor_platform
name: Platform
status: approved
```

## 9. Verification evidence

Passed:

```text
pnpm install --frozen-lockfile
pnpm --filter @scalius/database check:migrations
pnpm typecheck
pnpm test
node scripts/deploy.mjs --dry-run
node scripts/check-project-isolation.mjs
```

Results:

- root typecheck: 7/7 workspaces passed;
- Storefront diagnostics: 0 errors, 0 warnings, 0 hints;
- tests: 265 files passed;
- tests: 1,610 tests passed, 0 failed;
- API build: passed;
- Admin build: passed;
- Storefront build: passed;
- deployment dry-run: passed without remote mutation;
- migration metadata: 60 SQL files and 60 journal entries valid;
- isolation/deploy-guard tests: passed.

## 10. Current limitations and next tasks

Not implemented yet:

- marketplace feature flags in the central settings system;
- centralized public-sellable product predicate across all Storefront/API surfaces;
- safe canonical order-item replacement/edit workflow;
- final separation of seller capabilities from platform-admin RBAC;
- seller self-service onboarding/catalog;
- immutable accounting ledger;
- item-allocated refund journal posting;
- settlement and payout workflow;
- seller-scoped shipments and courier workflow;
- production Cloudflare resources.

The next local tasks are Phase P00 safety tasks. Financial reporting and payouts remain blocked until the ledger phases are implemented and reconciled.

## 11. Staff handoff rule

Before parallel staff work begins:

1. configure an owner-approved private Git remote;
2. preserve the current WIP on a named snapshot branch;
3. assign one schema integrator;
4. claim the exact task in `task-progress.yaml`;
5. use an isolated branch/worktree;
6. do not edit `0058` or `0059` after they are used in a shared environment;
7. do not run remote migration/deploy commands.

The first staff task after source-control protection should be `P00-T02` or `P00-T03`, following the shared dependencies and owned-path rules.
