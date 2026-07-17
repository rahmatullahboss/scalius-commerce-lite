# Staff Task Completion Report

Copy this file to:

```text
docs/architecture/multivendor/reports/YYYY-MM-DD-<task-id>-<short-slug>.md
```

## Task identity

- **Task ID:**
- **Title:**
- **Assignee:**
- **Branch:**
- **Worktree:**
- **Pull request:**
- **Started:**
- **Completed:**
- **Architecture documents followed:**

## Objective

State the exact business/technical objective. Do not describe unrelated cleanup.

## Scope delivered

- 

## Files changed

| File | Reason |
|---|---|
| | |

## Files deliberately not changed

List high-contention or out-of-scope files that were left alone.

- 

## Source-of-truth and invariants

- Canonical authority affected:
- Projection/snapshot affected:
- Seller scope:
- Money/currency impact:
- Idempotency/CAS rule:
- Delete/retention rule:

## Migration impact

- **Schema change:** yes | no
- **Proposal ID:**
- **Migration track:** A | B | not applicable
- **Migration number:**
- **Applied migration edited:** must be no
- **Backfill:**
- **Reconciliation:**
- **Rollback:**

## Cloudflare impact

- Worker(s):
- D1:
- KV:
- R2:
- Queues:
- Service bindings:
- Feature flags:
- Remote command run: none | list exact approved command
- Target account ID verified: yes | no | not applicable

Never include tokens, secrets, `.dev.vars`, customer PII, KYC documents, or raw payout details.

## Tests added or changed

| Test file | Scenario |
|---|---|
| | |

## Verification evidence

Include exact commands and exit results.

```text
command:
result:
```

Minimum applicable evidence:

- focused tests;
- relevant package typecheck;
- relevant build;
- migration metadata check;
- full/phase test suite;
- reconciliation command;
- cross-vendor negative tests;
- clean-install verification for tooling changes.

## Before/after behavior

### Before

Describe the verified failure or gap.

### After

Describe the verified behavior. Do not say “should work.”

## Security and privacy review

- Seller A cannot access Seller B data:
- Suspended membership/vendor behavior:
- Sensitive fields encrypted/masked:
- Logs/fixtures checked for secrets/PII:
- Platform RBAC and seller capability separation:

## Diff review

- Unrelated changes found: none | list
- Generated files reviewed:
- Existing WIP preserved:
- High-contention files changed with integrator approval:

## Known limitations

- 

## Owner decisions required

Use this section only for business/architecture/release decisions. The owner should not be asked to perform implementation.

- Decision:
- Options:
- Staff recommendation:
- Risk of deferring:

## Reviewer checklist

- [ ] Task matches claimed scope.
- [ ] Architecture/governance followed.
- [ ] No new duplicate source of truth.
- [ ] Tests prove the behavior and negative cases.
- [ ] Migration evidence is complete.
- [ ] Rollback preserves data.
- [ ] No prohibited remote deploy/migration occurred.
- [ ] Documentation and `task-progress.yaml` updated.
- [ ] Pull request is safe to approve or has explicit follow-up blockers.
