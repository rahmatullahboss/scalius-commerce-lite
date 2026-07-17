# Marketplace Database Governance

**Applies to:** all human contributors, coding agents, review agents, migration generators, and release operators  
**Authority:** mandatory for marketplace-related database and domain changes  
**Primary goal:** allow parallel work without creating competing tables, duplicated sources of truth, unsafe migrations, or cross-seller data leaks

## 1. Governance hierarchy

When instructions conflict, use this order:

1. Applied production/shared database history and data-safety constraints.
2. Accepted architecture decisions in `docs/architecture/multivendor/`.
3. Repository-level `AGENTS.md` and package-specific instructions.
4. The active implementation master plan.
5. The claimed task packet in `task-progress.yaml`.
6. Feature-level implementation preferences.

An agent may not override a higher-level decision by introducing a convenient table or direct write path.

## 2. Roles and decision rights

Every marketplace database change names these reviewers:

- **Architecture owner:** validates bounded context, source of truth, and cross-domain effects.
- **Schema integrator:** owns migration numbering/journal integration and resolves concurrent schema changes.
- **Domain owner:** owns the business invariants and command boundary.
- **Financial reviewer:** required for money, commission, refund, settlement, ledger, or payout changes.
- **Security reviewer:** required for seller scope, membership, KYC, payout details, files, or credentials.

One person may hold multiple roles, but the pull request records the roles explicitly. An AI agent is never the final approval authority for a financial or destructive migration.

## 3. Schema ownership map

| Domain | Primary schema location | Primary core location | Required review |
|---|---|---|---|
| Vendor identity/membership | `packages/database/src/schema/vendors.ts` after canonical rename | `packages/core/src/modules/vendors/` and `packages/core/src/auth/` | Architecture + Security |
| Catalog ownership/moderation | `packages/database/src/schema/products.ts` | `packages/core/src/modules/products/` | Catalog domain + Security |
| Customer order/item allocation | `packages/database/src/schema/orders.ts` | `packages/core/src/modules/orders/` | Orders + Financial |
| Inventory | `packages/database/src/schema/inventory.ts` | `packages/core/src/modules/inventory/` | Inventory + Orders |
| Delivery/shipments | `packages/database/src/schema/marketplace-shipments.ts` with legacy compatibility in `delivery.ts` | `packages/core/src/modules/marketplace/` and `packages/core/src/modules/delivery/` | Fulfillment + Security |
| Payments/refunds | `packages/database/src/schema/orders.ts` plus normalized marketplace refunds in `marketplace-finance.ts` | `packages/core/src/modules/payments/` and `packages/core/src/modules/marketplace/` | Payments + Financial |
| Marketplace ledger | `packages/database/src/schema/marketplace-finance.ts` | `packages/core/src/modules/marketplace/` | Architecture + Financial |
| Payouts | `packages/database/src/schema/marketplace-payouts.ts` plus encrypted destinations in `vendors.ts` | `packages/core/src/modules/marketplace/` and `packages/core/src/modules/vendors/` | Financial + Security |
| Domain outbox | `packages/database/src/schema/marketplace-finance.ts` | `packages/core/src/modules/marketplace/outbox.ts` | Architecture + owning domain |
| Platform RBAC | `packages/database/src/schema/rbac.ts` | `packages/core/src/auth/rbac/` | Security |

Moving a table between schema files is a dedicated refactor. Feature agents must not opportunistically reorganize schema ownership while adding behavior.

## 4. Single migration integrator rule

Many agents may design and implement domain code in parallel. Only one active integration task may modify these shared coordination surfaces at a time:

- `packages/database/migrations/meta/_journal.json`
- migration snapshot metadata
- `packages/database/src/schema/index.ts`
- any migration number reservation file or program progress migration field

Feature agents that need a schema change must:

1. Submit a schema-change proposal.
2. Receive a migration number or integration slot from the schema integrator.
3. Modify only the approved schema files and migration.
4. Hand off generated/manual migration artifacts to the integrator when concurrent changes exist.

Two agents must not independently generate Drizzle migrations from diverging schema states and then merge both journals.

## 5. Mandatory work-packet protocol

Before an agent starts a task, it must:

1. Read `AGENTS.md` and relevant nested instructions.
2. Read all architecture documents in `docs/architecture/multivendor/`.
3. Read `docs/architecture/multivendor/task-progress.yaml`.
4. Confirm the task is not already claimed or completed.
5. Record its claim with task ID, branch/worktree, owned paths, and prohibited paths.
6. Work in an isolated branch/worktree when parallel implementation is active.
7. Avoid files owned by another active task unless the integration owner coordinates the overlap.
8. Update status, tests, decisions, questions, and migration impact before handoff.

A task claim is a coordination record, not a lock on business decisions. Architecture changes still require approval.

## 6. Schema-change proposal gate

A new table, persistent JSON shape, money column, status column, foreign key, unique constraint, delete rule, or source-of-truth change requires `SCHEMA-CHANGE-PROPOSAL-TEMPLATE.md`.

The proposal must prove:

- the business fact does not already have an authority
- an existing table cannot represent it without violating cohesion
- the proposed table belongs to one bounded context
- all lifecycle states and deletion semantics are known
- transaction and idempotency boundaries are specified
- migration/backfill/reconciliation/rollback are executable
- seller isolation and data sensitivity are addressed
- read models are distinguished from sources of truth

“Keeping the feature code simple” is not sufficient justification for a new table.

## 7. Source-of-truth rules

### 7.1 One authority

Every persisted fact names exactly one canonical authority. Other copies must be documented as:

- immutable snapshot
- cached projection
- audit event
- external provider reference
- compatibility field scheduled for retirement

A pull request that adds a duplicate value must state how it is rebuilt and reconciled.

### 7.2 Projections are never silently promoted

Examples:

- `vendor_orders` is fulfillment-only and stores no copied seller financial totals; seller balance comes from ledger entries.
- `orders.payment_status` is an operational projection; payment evidence is `order_payments`.
- current product seller is not historical order-item seller.
- a dashboard aggregate is not accounting evidence.

### 7.3 Historical snapshots are explicit

Snapshot columns use descriptive names such as `vendor_name_snapshot` or are documented together as immutable order-item commercial fields. They are not updated when the source entity changes.

## 8. Marketplace schema standards

### 8.1 Naming

- Tables and SQL columns use plural snake_case table names and snake_case columns consistent with the repository.
- TypeScript fields use camelCase through Drizzle.
- Avoid temporary names such as `vendorx`, `new_table`, `v2`, or agent-specific prefixes in accepted architecture.
- Join tables describe both entities or the business relationship.
- Status history uses `*_events` when append-only and `*_history` only when it is truly a historical snapshot log.

### 8.2 IDs

- Use a documented stable prefix plus `nanoid()` for new domain entities unless an external/provider ID is the natural key.
- Do not mix UUID and prefixed nanoid in the same new bounded context without an approved reason.
- Never expose sequential database IDs as public authorization boundaries.
- Idempotency keys are separate from primary keys unless the architecture explicitly makes them identical.

### 8.3 Money

- New marketplace money columns use `INTEGER` minor units and end in `_minor`.
- Rates use integer basis points and end in `_bps`.
- Each independent financial aggregate stores currency.
- Values are checked as safe integers at application boundaries.
- No new marketplace `REAL` money or percentage column is allowed.
- No persisted result comes directly from unbounded JavaScript floating-point arithmetic.

### 8.4 Status and state

- Status values are centralized in one const enum and one validation schema.
- State transitions occur through a named transition function.
- Database CHECK constraints are added where compatible with D1 migration strategy.
- Unknown strings are rejected; no fallback to a default state on read.
- State changes record actor/time/reason when the action is sensitive or moderated.

### 8.5 Timestamps

- Use Unix epoch seconds with Drizzle timestamp mode, matching repository convention.
- Business occurrence time and processing time are distinct where needed.
- Financial journals store both occurred and posted time.
- External provider timestamps are not trusted as the only local audit timestamp.

### 8.6 Foreign keys and deletion

- `CASCADE` is permitted for purely dependent draft/configuration rows that have no independent audit or financial value.
- `RESTRICT` is the default for historical commerce and financial relationships.
- `SET NULL` is appropriate for optional actor/reviewer references, not for erasing seller identity from orders, refunds, ledger, or payouts.
- Vendors with commercial activity are soft-deleted/suspended, not physically deleted.
- Ledger journals/entries never cascade-delete.

### 8.7 JSON

Persistent JSON is allowed only for bounded provider payloads, versioned configuration, or non-queryable metadata.

Every JSON column requires:

- schema version
- Zod validation
- maximum size
- secret/PII exclusion rules
- migration strategy when the shape changes

Do not place queryable relationships, order item lists, seller IDs, monetary allocations, or state-machine facts in JSON.

### 8.8 Indexes

- Seller-scoped list/query indexes normally begin with `vendor_id` followed by status/time/filter columns.
- Every foreign key used for joins or cleanup has an index unless evidence shows it is unnecessary.
- Unique constraints encode idempotency and business uniqueness.
- Index proposals include the exact query shape they support.
- Avoid speculative indexes without a query or measured need.

### 8.9 Sensitive data

- Payout account payloads and provider credentials are encrypted.
- Normal API schemas return masks, not raw identifiers.
- Logs, outbox payloads, audit metadata, and test fixtures contain no secrets.
- KYC files are accessed through authorized media/document services, not public permanent URLs.
- Financial/sensitive reveal operations are separately authorized and audited.

## 9. Domain write-boundary rules

Only core domain commands mutate marketplace tables. API routes, admin server functions, queue handlers, and UI code call those commands.

A domain command owns:

- authorization assertion
- current-state load
- state-transition validation
- amount/allocation calculation
- invariant validation
- D1 batch construction
- idempotency/CAS predicate
- outbox/audit event creation
- result contract

Direct route-level `db.insert`, `db.update`, or `db.delete` on marketplace tables is prohibited except for narrowly documented read-model maintenance owned by the same domain.

## 10. Transaction and external-effect rules

### 10.1 Atomic local invariants

Rows that must agree immediately are written in one D1 batch. Examples:

- vendor + initial owner membership + audit event
- order + items + seller groups + allocation snapshots
- payout reservation + payout item claim
- product status projection + moderation event

### 10.2 Durable external workflow

External provider calls follow claim/dispatch/finalize:

1. Validate and create a durable local claim with idempotency.
2. Dispatch to provider.
3. Finalize success or compensating failure.
4. Retry safely using the existing claim/provider reference.

Do not hold a conceptual database transaction open across a network call.

### 10.3 Outbox

When local state and asynchronous work must agree, write one `domain_outbox_events` row in the same batch. Consumers claim events with leases and use event key as downstream idempotency key.

## 11. Migration standards

### 11.1 Applied migrations are immutable

Before editing an existing migration, verify deployment history in every environment. If any shared/production environment applied it, create a forward migration.

### 11.2 Expand-and-contract

Destructive replacement follows:

1. add canonical structure
2. backfill
3. dual write
4. compare
5. cut over reads
6. stop legacy writes
7. observe/reconcile
8. remove legacy structure later

### 11.3 D1 table rebuilds

SQLite/D1 constraints may require table rebuilds. A rebuild plan specifies:

- foreign key handling
- indexes/triggers recreation
- exact copy/select mapping
- null/default behavior
- row-count and checksum/reconciliation query
- behavior for concurrent writes
- recovery from partial deployment

### 11.4 Generated and manual SQL

- Drizzle schema and migration SQL must describe the same structure.
- Intentional manual migrations are documented and accepted by `check:migrations` metadata.
- Do not manually edit generated snapshots without understanding and documenting the effect.
- Raw SQL constraints/triggers receive focused migration tests.

### 11.5 Backfills

Every backfill is idempotent, restartable, chunked, observable, and reconciled. It reports ambiguous data instead of silently choosing an owner or amount.

### 11.6 Migration PR isolation

A migration PR should not contain unrelated UI refactors or formatting. When implementation requires broad domain changes, commits still separate schema/migration, core command, API contract, UI, and cleanup so review can isolate risk.

## 12. Parallel-agent file coordination

### 12.1 Files considered high-contention

- schema index
- migration journal/snapshots
- shared enums
- OpenAPI generated client
- root package lock
- route permission map
- global navigation
- task progress/decision files

The integration owner coordinates edits to these files. Feature agents should hand off intended changes rather than racing.

### 12.2 Allowed parallel boundaries

Examples of safe parallel task division after schema contracts are frozen:

- public product predicate and tests
- seller capability policy and negative tests
- integer allocation pure functions
- ledger posting service against an accepted schema
- payout UI against an accepted API contract
- shipment projection against an accepted vendor-order contract
- reconciliation scripts for independent invariants

### 12.3 Prohibited parallel boundaries

- two agents redesigning `order_items`
- two agents generating migrations from different schema states
- one agent changing commission rules while another hardcodes commission calculations
- seller dashboard implementation before ledger API contract is accepted
- payout implementation before encrypted payout method and ledger reservation contracts are accepted

## 13. Testing requirements by change type

| Change | Minimum tests |
|---|---|
| Seller-scoped query | positive own-vendor + negative other-vendor + suspended membership/vendor |
| Status transition | allowed matrix + rejected matrix + concurrent version conflict |
| Money allocation | exact sums + zero/one/many lines + remainder + maximum safe values + property tests |
| Ledger posting | balanced journal + replay idempotency + immutable rows + reversal |
| Refund | item sum = refund + concurrent claim + post-payout negative balance |
| Payout | concurrent reservation + failure release + retry + completion idempotency |
| Migration | empty DB + representative old snapshot + row-count/reconciliation |
| Public catalog | product status × vendor status matrix across all read surfaces |
| Shipment | cross-seller denial + duplicate claim + webhook replay + aggregate projection |

Tests that only prove the happy path are insufficient for seller isolation or money.

## 14. Pull-request database checklist

A marketplace database PR cannot merge unless every applicable item is answered:

- [ ] Schema-change proposal is linked.
- [ ] Canonical source of truth is named.
- [ ] No existing table can safely own the fact.
- [ ] Domain/schema owner approved.
- [ ] Financial/security reviewers approved where required.
- [ ] Migration deployment state and number are verified.
- [ ] Applied migrations were not edited.
- [ ] Backfill is idempotent and restartable.
- [ ] Reconciliation command/query is included.
- [ ] Rollback uses feature flags/forward correction without data deletion.
- [ ] Money uses minor units and rates use basis points.
- [ ] Seller scope and cross-tenant tests are included.
- [ ] Foreign-key delete behavior preserves history.
- [ ] Sensitive data is encrypted/masked and absent from logs.
- [ ] Route handlers do not own multi-table business writes.
- [ ] Status transitions and idempotency are explicit.
- [ ] Indexes correspond to documented query shapes.
- [ ] Database README/architecture/progress files are updated.
- [ ] Migration check, typecheck, focused tests, and full relevant tests pass.

## 15. Prohibited patterns

The following require rejection or redesign:

- one new table per UI screen or endpoint
- duplicate seller totals used by different features
- a `reference_type`/`reference_id` polymorphic pair for core financial integrity when real foreign keys are possible
- nullable seller ID on new marketplace commercial/financial rows
- `ON DELETE SET NULL` for historical seller identity
- REAL money or floating commission rate in new marketplace structures
- mutable ledger rows
- payout derived directly from order totals
- refund amount without item/vendor allocation for marketplace orders
- seller route authorized only by client-supplied vendor ID
- global platform permission granted solely for seller portal access
- direct route writes coordinating several tables
- state strings invented in individual files
- JSON arrays replacing relational item/amount/ownership tables
- editing an applied migration
- generating a second migration journal from a stale branch
- silent backfill fallback without an exceptions report

## 16. Architecture decision and exception process

When implementation discovers a genuine contradiction or new requirement:

1. Stop the affected schema/write-path work.
2. Record the question and evidence in the shared decision log.
3. Propose alternatives, affected invariants, and migration consequences.
4. Obtain architecture/domain/financial/security review as applicable.
5. Update the target architecture and master plan first.
6. Resume implementation under the accepted decision.

An exception is scoped and dated. It does not become a general precedent unless the governance document is updated.

## 17. Required verification commands

Use the repository’s actual scripts:

```bash
pnpm --filter @scalius/database check:migrations
pnpm --filter @scalius/database typecheck
pnpm --filter @scalius/core typecheck
pnpm --filter @scalius/api typecheck
pnpm test
```

Run narrower focused tests during development and the complete relevant suite before handoff. Never claim completion from code inspection alone.

## 18. Definition of an agent-safe task

A task is ready for a human or AI agent only when it declares:

- task ID and objective
- accepted architecture references
- exact owned files/directories
- files it must not edit
- input/output contracts
- database impact and migration slot
- invariants and security scope
- focused test files and commands
- completion evidence
- handoff requirements

If these are missing, the task remains planning work and must not create schema.
