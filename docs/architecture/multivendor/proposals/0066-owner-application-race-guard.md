# Schema Change Proposal 0066 — Owner Application Race Guard

**Date:** 2026-07-14  
**Status:** accepted for local-only implementation  
**Remote execution:** prohibited

## Problem

The onboarding command intentionally permits one active owner store per authenticated user and blocks a second sequential application. The database currently enforces only one active owner per vendor. Two concurrent requests for the same user with different seller slugs can therefore both pass the pre-write lookup and create two active owner memberships.

## Decision

Add a forward-only partial unique index on `vendor_users.user_id` for rows where `role = 'owner'` and `status = 'active'`.

This preserves:

- multiple non-owner memberships for one user;
- invited, suspended, or revoked historical memberships;
- one active owner per vendor through the existing vendor-scoped partial unique index;
- the current product rule that one account may own one active seller store.

## Invariants

- One user may have at most one active `owner` membership across all vendors.
- One vendor may have at most one active `owner` membership.
- A revoked/suspended owner may retain historical rows and later own another seller only through an explicit lifecycle workflow.
- Concurrent different-slug applications fail closed at the database uniqueness boundary and are mapped to a domain conflict.
- Platform, catalog, fulfillment, finance, and viewer memberships are not affected.

## Migration safety

Migration `0066` is forward-only. It creates an index and does not rewrite seller, order, or financial history.

A future shared-environment rollout must first query for duplicate active owner memberships by user. The current independent local database has no such duplicates and is the only environment authorized for this implementation.

## Rollback

Do not drop the index after shared use without an approved architecture change. If a future business model intentionally permits one user to own multiple stores, introduce an explicit account/group ownership model and a forward migration rather than silently removing the guard.
