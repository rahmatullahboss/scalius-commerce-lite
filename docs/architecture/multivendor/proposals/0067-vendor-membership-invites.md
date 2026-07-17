# Schema Change Proposal 0067 — Vendor Membership Invitations

**Date:** 2026-07-14  
**Status:** accepted for local-only implementation  
**Remote execution:** prohibited

## Problem

The canonical seller access authority is `vendor_users`, but the current implementation has no durable invitation authority. Unaccepted credentials must not be represented as active or invited membership rows, and invitation secrets must not be stored in plaintext.

## Decision

Add `vendor_membership_invites` as the durable invitation record. The table stores:

- seller/vendor identity;
- normalized invitee email;
- intended non-owner seller role;
- SHA-256 token hash, never the raw token;
- pending/accepted/revoked/expired status;
- inviter identity and expiry;
- accepted user and acceptance timestamp;
- revocation timestamp and audit timestamps.

The raw invitation token is returned once by the create command and is not persisted.

## Invariants

- Only an active approved seller member with `members.manage` may create or revoke invitations.
- Invitation roles exclude `owner`; ownership changes use the dedicated owner-transfer workflow.
- At most one pending invitation exists for a vendor/email pair.
- Invite acceptance requires an authenticated user whose normalized account email matches the invitation email.
- Expired, revoked, or already accepted invitations cannot create or reactivate membership.
- Acceptance consumes the invitation and creates/reactivates the canonical `vendor_users` membership atomically.
- Existing active membership blocks a new invitation for the same vendor/user.
- Raw invite tokens, token hashes, and unrelated seller data are never returned by list endpoints.

## Migration safety

Migration `0067` is forward-only and creates one normalized table plus indexes. It does not rewrite seller, order, fulfillment, or financial history.

Before any future shared-environment rollout, verify that no separate invitation authority has been introduced and that application secrets use a secure random source.

## Rollback

Do not drop accepted invitation history after shared use. Future changes should add forward migrations and retain acceptance/revocation evidence.
