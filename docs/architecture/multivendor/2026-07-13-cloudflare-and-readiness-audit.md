# Cloudflare Deployment, Migration, and Repository Readiness Audit

**Audit date:** 2026-07-13  
**Project:** Scalius Commerce Lite  
**Audit mode:** read-only Wrangler/API checks, local build/typecheck/test verification, repository inspection  
**Deployment decision:** **DO NOT DEPLOY the current multi-vendor working tree**

> **Superseding owner clarification and local implementation update — 2026-07-13:** The public deployment audited below belongs to the project from which this repository was cloned and is not a target environment for the independent project. The owner confirmed migrations `0058` and `0059` were never applied. Active original-project connections have now been removed, Track A was selected, canonical replacements for `0058`/`0059` were applied to a fresh local D1, and the local typecheck/test/build/dry-run baseline is green. Use [`reports/2026-07-13-local-foundation-progress.md`](./reports/2026-07-13-local-foundation-progress.md) as the current execution evidence. The original audit below is retained as historical provenance and explains why isolation guards were added.

## 1. Executive finding

Scalius Commerce is a Cloudflare Workers project and the public production domains are currently live. However, the Wrangler session available in this workspace is authenticated to a Cloudflare account that does not contain the Scalius Workers, D1 database, configured KV namespaces, R2 bucket, or queues.

Therefore:

- The public system is deployed somewhere on Cloudflare.
- The current workspace is not authenticated to the owning Cloudflare account.
- Remote migration history for `0058_create_vendors.sql` and `0059_vendor_order_split_foundation.sql` cannot yet be read safely.
- The live API does not expose the new multi-vendor routes, so the uncommitted marketplace code has not been deployed as the currently served API contract.
- Local multi-vendor code typechecks and builds, but the full regression suite is not green.
- The repository has no Git remote, so reviewable staff workflow and disaster recovery are not ready.

The correct next step is not deployment. The next step is to establish source-control and Cloudflare ownership, repair the baseline pipeline/tests, then decide the migration track from the real D1 migration history.

## 2. Cloudflare architecture confirmed from repository

The repository defines three Cloudflare Workers:

| Application | Worker name | Public URL |
|---|---|---|
| API | `scalius-api` | `https://api.scalius.com` |
| Admin | `scalius-admin-v2` | `https://dashboard.scalius.com` |
| Storefront | `scalius-storefront` | `https://storefront.scalius.com` |

The API/Admin configs reference the same D1 database:

- Name: `scalius-commerce`
- Configured ID: `2efcad0d-841e-4f8d-b8f6-5b735d881edc`
- Migration directory: `packages/database/migrations`

Other configured resources include KV, R2, Cloudflare Queues, AI, email, service bindings, a Durable Object, and a scheduled trigger.

The deployment script `scripts/deploy.mjs` is capable of:

1. typechecking all workspaces;
2. building all targets;
3. applying D1 migrations remotely;
4. deploying API, Admin, and Storefront Workers.

Because it applies remote migrations before Worker deployment, this command must never be used until the correct Cloudflare account and migration track are verified.

## 3. Wrangler authentication result

Command:

```bash
pnpm exec wrangler whoami
```

Result:

- Authenticated email: `rahmatullahzisan@gmail.com`
- Account ID: `474078d5f990169d7dadf4e1df83214a`
- The OAuth token has Workers and D1 write access.

This account is operational, but it is not the account containing the configured Scalius resources.

## 4. Remote D1 verification result

Command:

```bash
cd apps/api
pnpm exec wrangler d1 migrations list scalius-commerce --remote
```

Result:

```text
Database 2efcad0d-841e-4f8d-b8f6-5b735d881edc could not be found
Cloudflare error code: 7404
```

The account's D1 inventory was also listed. It does not contain a database named `scalius-commerce` and does not contain the configured D1 UUID.

### Migration conclusion

Remote application state of migrations `0058` and `0059` is **UNKNOWN**, not unapplied.

It is unsafe to edit or replace these migrations until the workspace is authenticated to the actual owning account and the real `d1_migrations` table is inspected.

## 5. Worker deployment verification result

Read-only deployment-list checks were run from each Worker directory:

```bash
cd apps/api && pnpm exec wrangler deployments list
cd apps/admin-v2 && pnpm exec wrangler deployments list
cd apps/storefront && pnpm exec wrangler deployments list
```

All three returned:

```text
This Worker does not exist on your account
Cloudflare error code: 10007
```

This means only that the currently authenticated account does not own these Worker scripts.

## 6. Other Cloudflare resource verification

The current account's KV, R2, and queue inventories were checked.

The configured Scalius resources were absent, including:

- configured API/Admin/Storefront KV namespace IDs;
- R2 bucket `scalius-media`;
- queues `payment-events`, `order-notifications`, `auth-otp`, and `order-ingest`;
- their configured dead-letter queues.

This further confirms an account mismatch rather than a single stale D1 ID.

## 7. Public production availability

Public read-only HTTP checks succeeded:

| URL | Result |
|---|---|
| `https://api.scalius.com/api/v1/health` | HTTP 200, healthy JSON response |
| `https://dashboard.scalius.com` | HTTP 307 redirect to `/admin` |
| `https://storefront.scalius.com` | HTTP 200 |

All responses are served through Cloudflare.

Therefore the system is deployed and reachable, but not under the Cloudflare account currently selected by Wrangler in this workspace.

## 8. Live API versus local multi-vendor code

The live OpenAPI document was inspected:

```text
Title: Scalius Commerce API
Version: 1.0.0
Total paths: 288
Multi-vendor/vendor/approval-status paths found: 0
```

The local working tree contains:

- Admin vendor APIs;
- vendor dashboard APIs;
- product approval status API;
- vendor UI routes;
- vendor dashboard UI;
- vendor database migrations;
- vendor order split service.

### Deployment conclusion

The current uncommitted multi-vendor foundation is **not represented in the live API contract**. It should be treated as local/WIP work, not deployed production behavior.

This does not prove that D1 migrations `0058`/`0059` were never applied separately. Only the correct remote D1 migration history can prove that.

## 9. Local D1 migration state

The repository's standard local Wrangler state was checked:

```bash
cd apps/api
pnpm exec wrangler d1 migrations list scalius-commerce \
  --local --persist-to ../../.wrangler/state
```

Result:

- All 60 migration SQL files are pending locally.
- The local database contains only Cloudflare metadata tables.
- The local `d1_migrations` table has zero applied rows.

Therefore the current default local D1 state is not a usable migrated development database.

This local state does not indicate production state.

## 10. Source-control readiness

Command:

```bash
git remote -v
```

Result: no remote configured.

The working tree also contains a large set of modified and untracked marketplace files. Until a private remote and WIP snapshot branch exist:

- staff changes are not safely reviewable;
- work cannot be recovered easily;
- multiple staff/agents cannot coordinate through pull requests;
- no one should attempt schema integration.

## 11. Verification results

### 11.1 Migration metadata

Passed:

```text
60 SQL files
60 journal entries
32 snapshots
28 allowed manual snapshot gaps
```

### 11.2 Individual typechecks

Passed:

- `@scalius/database`
- `@scalius/core`
- `@scalius/api`
- `@scalius/admin-v2`
- `@scalius/storefront` with zero Astro diagnostics

### 11.3 Builds

Passed:

- API Wrangler dry build
- Admin production build
- Storefront production build
- dist environment-file safety checks

The Admin build includes vendor and vendor-dashboard route chunks, confirming the local WIP UI is buildable.

### 11.4 Root deployment dry-run

Failed before build because two packages run `tsc` without declaring TypeScript directly:

- `packages/shared`
- `packages/api-client`

The root pipeline must be repaired so `pnpm typecheck` works from a clean install. Individual application/domain typechecks passed, so this is a workspace dependency/tooling defect, not evidence that the multi-vendor source fails TypeScript compilation.

### 11.5 Full test suite

Result:

```text
Test files: 257 passed, 3 failed
Tests: 1576 passed, 17 failed, 1593 total
```

Failures are concentrated in:

- `packages/core/src/modules/orders/orders.queue.test.ts`
- `packages/core/src/modules/orders/orders.ingest.test.ts`
- `tests/unit/core/orders/order-ingest-queue.test.ts`

The new `vendor-order-split` logic performs an additional product/vendor query. Existing test database mocks do not implement the new `leftJoin`/row-return behavior, causing order-ingest/queue regression tests to fail or follow the wrong retry path.

This must be fixed before any deployment or migration.

## 12. Readiness classification

| Area | Status | Reason |
|---|---|---|
| Public production | Live | Three public domains respond through Cloudflare |
| Owning Cloudflare account access | Blocked | Current Wrangler account has none of the configured resources |
| Remote migration history | Unknown | Correct D1 cannot be queried |
| Local development database | Not initialized | All 60 migrations pending |
| Git collaboration/review | Blocked | No remote; large dirty working tree |
| Marketplace typecheck/build | Mostly green | Individual packages and builds pass |
| Root typecheck/deploy dry-run | Red | Missing direct TypeScript dependencies in two packages |
| Full regression tests | Red | 17 order-ingest/queue failures |
| Marketplace production release | Blocked | Account, migration, source-control, and test gates unresolved |

## 13. Strict next-action order

1. Configure a private Git remote and preserve the current working tree on a named WIP snapshot branch.
2. Authenticate Wrangler to the Cloudflare account that owns the public Scalius deployment.
3. Verify every configured Worker/D1/KV/R2/Queue resource in that account.
4. Read the real remote D1 migration history and classify `0058`/`0059` as Track A or Track B.
5. Repair clean-install root typecheck by declaring TypeScript where scripts use it.
6. Repair the 17 order-ingest/queue regression tests and confirm the behavior, not only the mocks.
7. Run the complete baseline verification suite.
8. Begin canonical Phase P00 safety tasks.

## 14. Commands staff must use after correct Cloudflare login

These are read-only discovery commands until migration state is recorded:

```bash
cd apps/api
pnpm exec wrangler whoami
pnpm exec wrangler d1 list
pnpm exec wrangler d1 migrations list scalius-commerce --remote
pnpm exec wrangler d1 execute scalius-commerce --remote \
  --command "SELECT id,name,applied_at FROM d1_migrations ORDER BY id;"
pnpm exec wrangler deployments list
pnpm exec wrangler kv namespace list
pnpm exec wrangler r2 bucket list
pnpm exec wrangler queues list
```

Then run deployment-list checks from Admin and Storefront directories.

No staff member may run either command below until the migration track and release gate are approved:

```bash
pnpm db:migrate:remote
pnpm deploy
```

## 15. Evidence retention

The staff member resolving Cloudflare ownership must copy sanitized command output into a dated audit update. Do not commit access tokens, secrets, `.dev.vars`, raw payout details, or customer data.
