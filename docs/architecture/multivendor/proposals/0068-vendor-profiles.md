# Schema Change Proposal 0068 — Seller-Facing Vendor Profiles

**Date:** 2026-07-14  
**Status:** accepted for local-only implementation  
**Remote execution:** prohibited

## Problem

The canonical `vendors` table owns seller identity and lifecycle, but public presentation fields currently have no normalized authority. Storing descriptions, media, SEO, contact visibility, return policy, and support hours on `vendors` would mix public presentation with lifecycle and financial policy.

## Decision

Add one `vendor_profiles` row per seller. The profile owns:

- public description;
- logo and banner media IDs;
- public contact-email and contact-phone visibility choices;
- SEO title and description;
- return policy and support hours;
- draft/published state;
- audit timestamps.

The seller's actual contact email/phone remain on `vendors`; the profile stores only visibility policy. Media references point to the existing canonical `media` table.

## Invariants

- `vendor_id` is both primary key and foreign key, enforcing one profile per seller.
- Only active approved owner/admin seller contexts with `profile.manage` may write a profile.
- Catalog, fulfillment, finance, and viewer roles cannot publish seller identity content.
- Media IDs must reference active media records.
- Draft profiles are visible to authorized seller management only and never enrich public API responses.
- Public profile data is returned only when both vendor state is public and profile state is `published`.
- Public contact details are derived from canonical vendor contact fields and filtered by visibility flags.
- Profile updates do not mutate seller lifecycle, commission, payout, order, or financial records.

## Migration safety

Migration `0068` is forward-only and creates one table plus supporting indexes. It does not backfill guessed presentation data and does not rewrite historical seller records.

## Rollback

After shared use, do not drop published profile history without an approved forward migration and public-cache migration plan.
