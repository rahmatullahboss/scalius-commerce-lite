# Local Ownership and Canonical Marketplace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detach the cloned project from the original Scalius Cloudflare deployment, establish a safe local-only development baseline, and replace the unapplied marketplace migrations `0058`/`0059` with a canonical seller foundation that does not create duplicated financial authorities.

**Architecture:** Keep the existing modular monolith and legacy `@scalius/*` package namespace temporarily to avoid a repository-wide import rewrite, but remove all active runtime/deployment connections to the original domains and Cloudflare resource IDs. Treat `0058` and `0059` as disposable because the owner confirmed they were never applied; replace their SQL and Drizzle schema with membership-authoritative vendors, protected payout methods, product seller ownership/moderation, immutable order-item seller snapshots, and vendor fulfillment groups without a duplicate `vendor_order_items` accounting table.

**Tech Stack:** TypeScript, pnpm/Turborepo, Hono, TanStack Start, Astro, Drizzle ORM, SQLite/Cloudflare D1, Wrangler, Vitest.

## Execution result — 2026-07-13

All eight tasks in this plan were executed locally. Evidence is recorded in `docs/architecture/multivendor/reports/2026-07-13-local-foundation-progress.md`.

Verified outcome:

- original deployment connections removed from active configuration;
- remote mutation guard works fail-closed;
- clean-install root typecheck repaired;
- canonical Track A replacements for migrations `0058` and `0059` implemented;
- canonical order allocation integrated into all order creation paths;
- seller dashboard financial claims removed pending ledger;
- fresh local D1 has 60 applied and 0 pending migrations;
- 265 test files and 1,610 tests pass;
- API/Admin/Storefront builds and deployment dry-run pass without remote mutation.

The only readiness item not completed by this plan is the owner-approved private Git remote/WIP snapshot, which remains required before parallel staff work.

## Global Constraints

- Work in the existing `mono-repo` checkout because the owner explicitly asked to continue the current WIP in place.
- Local development only; do not run any remote D1 migration or Worker deploy command.
- `0058` and `0059` are confirmed unapplied and may be replaced in place.
- Do not rename the internal `@scalius/*` package scope in this batch; it is a code namespace, not an active remote connection.
- Remove original production domains, Worker names, D1/KV/R2 IDs, and service bindings from active runtime/deployment configuration.
- Remote deploy commands must fail closed unless a future owner explicitly provisions new resources and supplies an approval guard.
- Vendor membership is the sole seller-access authority; do not keep `vendors.owner_user_id`.
- New marketplace money uses integer minor units; commission rates use integer basis points.
- `vendor_orders` is a fulfillment partition, not a payout/accounting source.
- Do not create `vendor_order_items`; `order_items` is the canonical item allocation authority.
- Sensitive payout destination data is encrypted/masked, never stored as plaintext account numbers.
- Every behavior change follows TDD; configuration-only changes require static verification tests.
- Keep marketplace feature exposure disabled until the canonical foundation and regression suite are green.

---

### Task 1: Add a fail-closed original-project isolation check

**Files:**
- Create: `scripts/check-project-isolation.mjs`
- Create: `scripts/check-project-isolation.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `checkProjectIsolation({ root, allowHistoricalDocs?: boolean })` returning a list of forbidden active references.
- Produces CLI command: `pnpm check:isolation`.

- [ ] Write tests proving active Wrangler configs/runtime fallbacks containing `scalius.com`, original Worker names, or original resource IDs are rejected, while historical audit documents and unit-test example URLs may be ignored.
- [ ] Run the focused test and verify it fails because the checker does not exist.
- [ ] Implement the smallest checker with an explicit active-file allowlist and forbidden-pattern list.
- [ ] Add `check:isolation` to root scripts.
- [ ] Run the focused test and verify it passes.

### Task 2: Convert active Cloudflare configuration to local-owned placeholders

**Files:**
- Modify: `apps/api/wrangler.jsonc`
- Modify: `apps/api/wrangler.local.jsonc`
- Modify: `apps/admin-v2/wrangler.jsonc`
- Modify: `apps/storefront/wrangler.jsonc`
- Modify: `apps/api/src/queue-consumer.ts`
- Modify: `scripts/deploy.mjs`
- Test: `scripts/check-project-isolation.test.mjs`
- Test: `scripts/deploy-guard.test.mjs`

**Interfaces:**
- Active local names: `marketplace-api-local`, `marketplace-admin-local`, `marketplace-storefront-local`, D1 `marketplace-local-db`, R2 `marketplace-local-media`.
- Local URLs: API `http://localhost:8787`, Admin `http://localhost:4323`, Storefront `http://localhost:4322`.
- Remote mutation guard: `MARKETPLACE_REMOTE_DEPLOY_APPROVED=YES` plus a non-placeholder configuration check.

- [ ] Write a failing deploy-guard test proving remote migration/deploy exits before Wrangler when the explicit approval variable is absent.
- [ ] Replace active original URLs/names/resource IDs with local-safe names/placeholders and localhost URLs.
- [ ] Remove the hard-coded production fallback from queue consumer; require configured base URL or localhost in development.
- [ ] Add fail-closed guard to `scripts/deploy.mjs` for every non-dry-run remote migration/deploy path.
- [ ] Run isolation and deploy-guard tests.
- [ ] Run API/Admin/Storefront dry builds to prove configs still parse.

### Task 3: Repair clean-install TypeScript ownership

**Files:**
- Modify: `packages/shared/package.json`
- Modify: `packages/api-client/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Both packages that execute `tsc` declare compatible `typescript` dev dependency `^6.0.3`.

- [ ] Add the direct dependencies.
- [ ] Run `pnpm install --frozen-lockfile` after lockfile update.
- [ ] Run root `pnpm typecheck` and record actual result.

### Task 4: Replace migration 0058 with canonical vendor/catalog foundation

**Files:**
- Replace: `packages/database/migrations/0058_create_vendors.sql`
- Replace/Rename: `packages/database/src/schema/vendorx.ts` -> `packages/database/src/schema/vendors.ts`
- Modify: `packages/database/src/schema/products.ts`
- Modify: `packages/database/src/schema/index.ts`
- Modify: `packages/database/migrations/meta/_journal.json`
- Test: `packages/database/__tests__/marketplace-foundation-boundaries.test.ts`

**Interfaces:**
- Tables: `vendors`, `vendor_users`, `vendor_addresses`, `vendor_payout_methods`, `vendor_verification_documents`, `vendor_moderation_events`, `product_moderation_events`, `vendor_commission_rules`.
- Platform vendor ID: `vendor_platform`.
- Product columns: `vendor_id`, `approval_status`, `moderation_version`.
- Payout method fields include encrypted payload, fingerprint, last four, verification status; no plaintext account number column.
- Commission fields use `rate_bps` integer.

- [ ] Write schema boundary tests that fail against the old schema: no owner column, no real commission field, no plaintext payout account number, required new tables/fields.
- [ ] Replace the Drizzle schema with the canonical tables and exports.
- [ ] Replace migration SQL with table creation, platform-vendor seed, product ownership backfill, and write-time non-null enforcement for product vendor ownership.
- [ ] Keep migration tag/index `0058` but change the tag name to `0058_marketplace_vendor_foundation` because it is confirmed unapplied.
- [ ] Run database typecheck and migration metadata check.

### Task 5: Replace migration 0059 with canonical order allocation foundation

**Files:**
- Replace: `packages/database/migrations/0059_vendor_order_split_foundation.sql`
- Replace: `packages/database/src/schema/vendor-orders.ts`
- Modify: `packages/database/src/schema/orders.ts`
- Modify: `packages/database/src/schema/index.ts`
- Modify: `packages/database/migrations/meta/_journal.json`
- Test: `packages/database/__tests__/marketplace-order-allocation-boundaries.test.ts`

**Interfaces:**
- `vendor_orders`: fulfillment-only columns (`order_id`, `vendor_id`, status, fulfillment status, version, notes, timestamps); no payout status or financial totals.
- `order_items`: `vendor_order_id`, immutable `vendor_id_snapshot`, `vendor_name_snapshot`, `currency`, `unit_price_minor`, `line_subtotal_minor`, `discount_minor`, `commission_rule_id`, `commission_bps`, `commission_minor`, `vendor_net_minor`.
- No `vendor_order_items` table/export.

- [ ] Write boundary tests that fail against the old schema and SQL.
- [ ] Replace schema and SQL, including deterministic backfill of historical order items from product ownership and platform-vendor fallback.
- [ ] Add triggers preventing null seller allocation for newly inserted/updated order items.
- [ ] Change migration tag to `0059_marketplace_order_allocation` because it is confirmed unapplied.
- [ ] Run database typecheck and migration metadata check.

### Task 6: Rebuild the order split service around canonical allocation

**Files:**
- Replace: `packages/core/src/modules/orders/vendor-order-split.ts`
- Modify: `packages/core/src/modules/orders/orders.ingest.ts`
- Modify: `packages/core/src/modules/orders/orders.queue.ts`
- Modify: `packages/core/src/modules/orders/orders.admin.ts`
- Test: `packages/core/src/modules/orders/vendor-order-split.test.ts`
- Test: existing order ingest/queue tests.

**Interfaces:**
- Pure allocator consumes validated order items and seller/commission context, returns vendor fulfillment groups and immutable order-item allocation updates using integers.
- Database write builder inserts `vendor_orders` and inserts/updates canonical `order_items`; it never inserts `vendor_order_items`.
- Deterministic minor-unit rounding and remainder allocation.

- [ ] Write focused failing pure-function tests for platform product, seller product, multi-seller order, and integer commission allocation.
- [ ] Implement pure allocation first.
- [ ] Adapt database lookup/write builder.
- [ ] Update existing mocks to model the actual product/vendor/commission query.
- [ ] Run focused tests, then the three previously failing regression files.

### Task 7: Remove financial claims from the temporary vendor dashboard

**Files:**
- Modify: `apps/api/src/routes/admin/vendor-dashboard.ts`
- Modify: `apps/admin-v2/src/lib/api-functions/vendor-dashboard.ts`
- Modify: `apps/admin-v2/src/routes/admin/vendor-dashboard.tsx`
- Test: relevant API/Admin tests or new boundary tests.

**Interfaces:**
- Dashboard may report product and fulfillment counts.
- Revenue, commission, pending payout, and net payable fields are unavailable until the ledger phase.

- [ ] Add failing boundary/API tests proving no payout/revenue values are sourced from `vendor_orders`.
- [ ] Remove financial aggregation and UI cards based on mutable fulfillment rows.
- [ ] Keep an explicit “financial reporting unavailable until ledger” state.
- [ ] Run API/Admin typechecks and focused tests.

### Task 8: Initialize and verify a fresh local D1

**Files:**
- Modify: `docs/architecture/multivendor/task-progress.yaml`
- Modify: `.ai-bridge/current-plan.md`
- Create: `docs/architecture/multivendor/reports/2026-07-13-local-foundation-progress.md`

**Interfaces:**
- Standard local persistence: `.wrangler/state`.
- No remote commands.

- [ ] Reset only the disposable local D1 state.
- [ ] Apply all migrations locally.
- [ ] Query `d1_migrations`, canonical marketplace tables, platform vendor, product backfill, and absence of `vendor_order_items`.
- [ ] Run isolation check, migration metadata, root typecheck, focused tests, full tests, and deployment dry-run.
- [ ] Record every pass/failure honestly in progress/report files and leave unfinished tasks clearly marked.
