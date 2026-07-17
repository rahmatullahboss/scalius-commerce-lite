# Start Here — Staff Execution Guide

**Project:** independent local-owned multi-vendor commerce expansion  
**Audience:** staff developers, contractors, and AI coding agents  
**Owner's role:** review evidence and approve architecture, migrations, and releases  
**Current mode:** local development only  
**Remote status:** do not migrate or deploy remotely

## 1. Read this before touching code

This repository was cloned from an existing commerce project, but it is now being developed as an independent project. The original public deployment, domains, Worker names, D1, KV, R2, queues, and service bindings are not target resources.

The owner confirmed that migrations `0058` and `0059` had never been applied. Their old WIP design has already been replaced with the canonical local marketplace foundation and applied to a fresh local D1.

Do not repeat the old Cloudflare-account investigation and do not restore original project connections.

## 2. Required reading order

Read these documents in order:

1. [`reports/2026-07-14-marketplace-implementation-progress.md`](./reports/2026-07-14-marketplace-implementation-progress.md)
2. [`task-progress.yaml`](./task-progress.yaml)
3. [`README.md`](./README.md)
4. [`reports/2026-07-13-local-foundation-progress.md`](./reports/2026-07-13-local-foundation-progress.md) — historical foundation evidence
5. [`2026-07-13-current-state-audit.md`](./2026-07-13-current-state-audit.md)
6. [`2026-07-13-target-architecture.md`](./2026-07-13-target-architecture.md)
7. [`2026-07-13-migration-roadmap.md`](./2026-07-13-migration-roadmap.md)
8. [`DATABASE-GOVERNANCE.md`](./DATABASE-GOVERNANCE.md)
9. [`MARKETPLACE-DATABASE-CONTRACT.md`](./MARKETPLACE-DATABASE-CONTRACT.md)
10. [`../../superpowers/plans/2026-07-13-local-ownership-and-canonical-foundation.md`](../../superpowers/plans/2026-07-13-local-ownership-and-canonical-foundation.md)
11. [`../../superpowers/plans/2026-07-13-multivendor-marketplace-implementation.md`](../../superpowers/plans/2026-07-13-multivendor-marketplace-implementation.md)
12. repository `AGENTS.md`

When documents disagree, use this priority:

1. latest owner decision;
2. `task-progress.yaml`;
3. latest dated progress report;
4. target architecture and governance;
5. older historical audits.

## 3. Current verified baseline

The following is already complete and must be preserved:

- original runtime/deployment connections removed from active configuration;
- automated isolation and remote-mutation guards;
- canonical migrations `0058` through `0065`;
- membership-derived seller authorization and onboarding;
- seller catalog, moderation, SKU, and inventory workflows;
- centralized public seller/product eligibility and seller storefronts;
- immutable order-item seller and minor-unit snapshots;
- deterministic seller fulfillment allocation;
- seller orders and vendor-scoped shipments;
- immutable marketplace ledger, item-allocated refunds, and projections;
- settlement and payout domain workflows;
- encrypted/masked payout methods and platform review;
- seller and platform finance interfaces;
- fresh local D1 with 67 applied and 0 pending migrations;
- 334 test files and 1,916 tests passing;
- root typecheck, API/Admin/Storefront builds, project isolation, and deployment dry-run passing.

Current evidence: [`reports/2026-07-14-marketplace-implementation-progress.md`](./reports/2026-07-14-marketplace-implementation-progress.md).

## 4. First staff action: protect source control

Before more than one staff member/agent works on the repository, complete `R00-T01`:

1. configure an owner-approved private Git remote;
2. preserve the current dirty WIP on a named snapshot branch;
3. do not merge the snapshot directly to the production/default branch;
4. create an integration branch for reviewed work;
5. record the remote and branch names in `task-progress.yaml`.

Recommended snapshot branch:

```text
wip/canonical-multivendor-foundation-2026-07-13
```

No staff member may discard, reset, or rewrite the current WIP before the snapshot exists.

## 5. Next implementation and release-preparation phase

After source-control protection, use `task-progress.yaml` to claim one of the remaining review or completion tasks. Do not repeat completed P00–P06 foundation work.

Priority work:

### Browser-level local end-to-end evidence

Cover the complete staged journey:

- seller application and platform approval;
- product create, moderation, public publication, and checkout;
- multi-seller order allocation and fulfillment;
- shipment creation and status projection;
- payment posting, allocated refund, and reconciliation;
- settlement release and payout reservation/finalization.

### Security and financial review

Review tenant isolation, feature-flag fail-closed behavior, encrypted payout handling, immutable ledger guards, idempotency, negative balances, and reconciliation. Do not enable feature flags based only on unit tests.

### Remaining product gaps

- live courier account certification and browser-level multi-package acceptance evidence;
- browser acceptance evidence for rejected seller application correction/resubmission;
- real payout-provider certification or documented manual payout procedure;
- optional internal package-namespace rename only under separate owner approval;
- non-fatal Admin chunk-size warning cleanup through a dedicated performance pass.

### Environment and release preparation

A new independent environment may be provisioned only after an owner-approved release packet defines resource ownership, secrets, flags, migration rehearsal, rollback, monitoring, and staged acceptance gates.

## 6. Task claim workflow

Before editing, add an active claim to `task-progress.yaml` containing:

- task ID;
- assignee;
- branch;
- worktree;
- owned paths;
- high-contention paths not owned;
- schema impact;
- expected tests;
- start date.

Only one active schema integrator may modify:

- `packages/database/src/schema/index.ts`;
- migration SQL;
- migration journal/snapshots;
- shared generated API contracts;
- lockfile changes caused by schema/tooling integration.

## 7. Branch/worktree rules

Each implementation task uses an isolated branch/worktree.

Recommended branch format:

```text
staff/<task-id>-<short-slug>
```

Examples:

```text
staff/P00-T02-marketplace-flags
staff/P00-T03-public-sellable-predicate
staff/P00-T04-safe-order-edits
staff/P00-T05-seller-capabilities
```

Do not work directly on the default/production branch.

## 8. Required implementation method

For every behavior change:

1. write or identify a failing focused test;
2. run it and record the failure;
3. implement the smallest correct domain change;
4. run the focused test;
5. run relevant typecheck and lint;
6. run the relevant broader suite;
7. run full tests when the change affects shared order/auth/catalog paths;
8. review the diff for unrelated changes;
9. update `task-progress.yaml` and documentation;
10. submit a completion report and pull request.

Do not weaken assertions, remove tests, or convert a failing behavior test into a source-text-only check merely to obtain green output.

## 9. Safe local commands

```bash
pnpm install --frozen-lockfile
node scripts/check-project-isolation.mjs
pnpm --filter @scalius/database check:migrations
pnpm typecheck
pnpm test
node scripts/deploy.mjs --dry-run
```

Local D1 commands:

```bash
cd apps/api
pnpm exec wrangler d1 migrations list marketplace-local-db --local --persist-to ../../.wrangler/state
pnpm exec wrangler d1 migrations apply marketplace-local-db --local --persist-to ../../.wrangler/state
```

Use a separate disposable persist path for migration rehearsals.

## 10. Prohibited commands

Without an owner-approved release packet, never run:

```bash
pnpm db:migrate:remote
pnpm deploy
pnpm deploy:api
pnpm deploy:admin
pnpm deploy:storefront
wrangler d1 migrations apply ... --remote
wrangler deploy
```

The deployment script is fail-closed, but staff must not try to bypass the guard.

## 11. Do not restore original project connections

Do not reintroduce:

- original public domains;
- original Worker names;
- original D1 name/UUID;
- original KV IDs;
- original R2 bucket;
- original queues/service bindings;
- original production API fallback.

Run:

```bash
node scripts/check-project-isolation.mjs
```

before handoff.

The internal `@scalius/*` package namespace is temporarily retained to avoid a repository-wide import rewrite. It is an internal code namespace, not an active external connection. Rename it only in a separately approved refactor.

## 12. Do not edit migrations 0058/0059 casually

The owner-confirmed Track A replacement is complete. The canonical migrations now form the local baseline.

Rules:

- do not restore the old migration contents;
- do not add plaintext payout fields;
- do not add `REAL` marketplace financial fields;
- do not recreate `vendor_order_items`;
- do not add seller financial totals to `vendor_orders`;
- after a shared environment uses these migrations, all corrections are forward-only.

## 13. Financial implementation rules

The immutable ledger, allocated refunds, settlement, payout state machines, reconciliation, and seller finance projections are implemented locally. Preserve these rules:

- never derive seller payable balance from `vendor_orders`;
- never mutate ledger journals or entries after posting;
- never bypass idempotency, transition, or reconciliation guards;
- never expose encrypted payout payloads or fingerprints;
- never reserve a payout against an unverified destination;
- never enable financial flags without browser E2E, security review, financial review, and staged reconciliation evidence;
- provider dispatch remains uncertified until a real provider or approved manual procedure is reviewed.

## 14. Definition of complete

A task is complete only when applicable evidence exists:

- focused tests pass;
- relevant typechecks pass;
- relevant build passes;
- full tests pass when required;
- migration metadata passes for schema work;
- isolation check passes;
- cross-seller negative tests pass for seller routes;
- no secrets/PII/raw payout/KYC data appears in logs or fixtures;
- task progress is updated;
- rollback/forward-fix is explained;
- pull request is reviewable and scope-limited.

“Code written,” “page loads,” or “typecheck passes” alone is not completion.

## 15. Handoff format

Every task must use:

[`STAFF-TASK-COMPLETION-TEMPLATE.md`](./STAFF-TASK-COMPLETION-TEMPLATE.md)

The owner receives:

- pull-request link;
- task completion report;
- exact test/typecheck/build results;
- UI screenshots when UI changed;
- migration/reconciliation evidence when applicable;
- genuine decisions requiring owner approval.

The owner reviews; staff implements.
