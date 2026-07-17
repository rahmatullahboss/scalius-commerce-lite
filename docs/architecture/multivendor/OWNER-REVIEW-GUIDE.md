# Owner Review Guide

**Owner:** Rahmatullah Zisan  
**Owner role:** approve direction, evidence, migrations, and releases; do not implement staff tasks

## 1. What the owner should review

For each staff task, review only these items:

1. pull-request summary and diff scope;
2. completed staff task report;
3. test/typecheck/build results;
4. migration and reconciliation evidence when applicable;
5. security/tenant-isolation evidence;
6. rollback plan;
7. unresolved decision requiring business approval.

The owner does not need to reproduce the code changes personally.

## 2. What staff must provide before asking for approval

A review request is incomplete without:

- task ID and claimed scope;
- link to the architecture section followed;
- exact files changed;
- exact commands run and results;
- explanation of failed tests, if any;
- migration track and target Cloudflare account, if applicable;
- statement confirming no prohibited remote operation occurred;
- completed [`STAFF-TASK-COMPLETION-TEMPLATE.md`](./STAFF-TASK-COMPLETION-TEMPLATE.md).

Return incomplete requests to staff without reviewing implementation details.

## 3. Decisions reserved for the owner

Staff may recommend, but the owner approves:

- the private Git remote and default/integration branch;
- the future independent Cloudflare staging/production account and resource plan;
- any future change to the owner-confirmed Track A decision;
- acceptance of schema-change proposals;
- business commission/hold/refund/payout policies;
- enabling marketplace feature flags;
- applying remote D1 migrations;
- deploying Workers to production;
- destructive legacy cleanup after reconciliation.

## 4. Automatic rejection conditions

Reject a task or release when any of these is true:

- staff worked directly on the production/default branch;
- task was not claimed in `task-progress.yaml`;
- a new table/financial column was added without a proposal;
- an applied migration was edited;
- new marketplace money uses `REAL` or floating rates;
- seller scope trusts a client-supplied vendor ID without membership verification;
- seller portal access requires broad platform-admin permission;
- payout balance is calculated from mutable `vendor_orders` totals;
- full or required test suite has unexplained failures;
- cross-vendor negative tests are missing;
- migration/backfill has no reconciliation and rollback;
- sensitive payout/KYC information appears in API responses, logs, or fixtures;
- remote deployment/migration was run against an unverified Cloudflare account;
- the pull request contains unrelated changes or overwrites existing WIP.

## 5. First owner review milestone

The canonical local foundation has already passed its technical readiness review. Before assigning parallel staff work, require:

- a private Git remote;
- the current WIP preserved on a remote snapshot branch;
- an integration branch and branch-protection convention;
- one named schema integrator;
- staff task claims with owned paths and required tests.

The verified local baseline that staff must preserve is:

- owner-confirmed Track A replacements for `0058`/`0059`;
- 60 applied and 0 pending migrations on a fresh local D1;
- root typecheck passing;
- 1,610 tests passing with zero failures;
- API/Admin/Storefront builds passing;
- deployment dry-run passing without remote mutation;
- original-project isolation guard passing.

The next owner approval authorizes Phase P00 safety tasks only, not payouts or production release.

## 6. Phase review questions

### P00 — Safety

- Can an unapproved product or suspended vendor appear publicly?
- Can an order edit leave stale vendor allocation?
- Can Seller A access Seller B data?
- Are all marketplace write/public flags disabled by default?

### P01 — Vendor identity/catalog

- Is membership the only seller-access authority?
- Is product ownership explicit and historical ownership preserved?
- Are payout details encrypted/masked?
- Are moderation decisions audited?

### P02 — Money/order allocation

- Does every item have immutable seller and minor-unit snapshots?
- Do item/vendor/order totals reconcile exactly?
- Is commission rule resolution versioned and deterministic?

### P03 — Ledger/refunds

- Does every journal balance?
- Does replay create no duplicate posting?
- Is every marketplace refund allocated to items/vendors?
- Does seller balance rebuild exactly from ledger entries?

### P04 — Payouts

- Can concurrent requests double-reserve balance?
- Do failed payouts release the exact amount?
- Is every payout method verified and masked?

### P05 — Fulfillment

- Can each seller ship only its own items?
- Can one seller's shipment incorrectly complete the whole order?
- Are courier retries/webhooks idempotent?

### P06/P07 — Portal and cleanup

- Are public seller pages approval-gated?
- Are financial pages ledger-derived?
- Are legacy sources removed only after stable cutover/reconciliation?

## 7. Production release approval checklist

Before approving a remote migration or deploy:

- [ ] Target Cloudflare account ID is written in the release report.
- [ ] Worker/D1/resource names match repository config.
- [ ] Database backup/export/recovery procedure is recorded.
- [ ] Pending migrations are listed exactly.
- [ ] Migration Track A/B is confirmed.
- [ ] Backfill and reconciliation have been rehearsed on a representative database.
- [ ] Root typecheck, tests, builds, migration metadata, and dry-run pass.
- [ ] Feature flags remain disabled during schema expansion unless explicitly required.
- [ ] Rollback/forward-fix commands are documented.
- [ ] Monitoring/health checks are prepared.
- [ ] Staff names the exact deploy command and execution order.
- [ ] Post-deploy API/DB/reconciliation checks are listed.

## 8. Daily/weekly oversight

The owner can manage the project by reviewing:

- `task-progress.yaml` for current claims and blockers;
- pull requests for completed work;
- task completion reports for evidence;
- architecture decisions only when staff raises a genuine choice;
- weekly readiness/reconciliation summary.

Avoid assigning work through disconnected chat instructions. Add or update a task packet in the shared plan so every worker follows the same source of truth.
