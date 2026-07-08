# Admin puzzle-definition detail view (`/admin/puzzles/$puzzleId`)

**Date:** 2026-07-08
**Status:** Approved
**Delivery:** amended into PR #39 (`feat/admin-puzzle-definitions`), same precedent as the
user-detail amendment into PR #38.

## Goal

Give admins a per-definition drill-down from the `/admin/puzzles` list, mirroring the
`/admin/users/$userId` detail view: full definition metadata, ownership stats, an owners
list, the moderation/audit trail ("what's happening"), and the reversible
disable/re-enable action available in place.

Non-goals: editing definition fields from this page, pagination of owners/audit (capped
lists in v1, like the user detail view), any authorization change (`isAdmin` stays
JWT-only).

## Backend read model

New `packages/backend/convex/admin/getPuzzleDefinitionDetail.ts` query — ONE aggregate
query per page load, the `getUserDetail` pattern:

- Gate: `await requireMember(ctx)` + `if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden")`.
- Args: `{ puzzleId: v.id("puzzles") }`. Missing doc → `ConvexError("Puzzle definition not found")`.
- Returns `AdminPuzzleDefinitionDetailView` (typed view DTO in `packages/contracts`,
  next to `AdminUserDetailView`):
  - **definition**: `_id`, `aggregateId`, `title`, `brand`, `pieceCount`, `status`,
    `createdAt`, resolved `image` URL (`ctx.storage.getUrl`), and
    `submitter: { _id, name }` (from `submittedBy`).
  - **stats**: distinct-owner count, total copy count, and availability breakdown
    (`forTrade` / `forSale` / `forLend`) — from `ownedPuzzles.by_puzzle`, the
    `listPuzzleDefinitions` owner-count pattern.
  - **owners**: capped at 50 distinct members, grouped per owner: `_id`, `name`,
    `username`, `avatar`, `copyCount`, and aggregate availability flags (true if ANY of
    that member's copies has the flag).
  - **audit**: `moderationActions.by_target` with `targetId` = the definition's
    `aggregateId` (what `stampModerationAction` writes for definition rows), newest
    first, capped at 20, mapped to the same audit-entry shape as `getUserDetail`
    (`kind`, `actorName`, `targetLabel`, `targetId`, `at`).
- Gateway: joins the `admin` namespace in `packages/gateway/src/operations.ts`.
- Admin read models stay thin Convex queries — no domain-package involvement for pure
  reads (established precedent).

## Frontend

- Restructure the flat route `apps/web/src/routes/_dashboard/admin/puzzles.tsx` into
  `admin/puzzles/index.tsx` (content unchanged) + new `admin/puzzles/$puzzleId.tsx`,
  exactly how `admin/users/` is laid out.
- List rows on `/admin/puzzles` link to the detail page.
- Detail page layout mirrors `admin/users/$userId.tsx`:
  - Header card: cover image, title, brand, piece count, status badge, created date,
    submitter (linking to `/admin/users/$userId`), and the Disable/Re-enable action —
    same AlertDialog-confirmed mutation the list page uses, rendered only for
    approved/disabled statuses respectively.
  - Stats tiles: owner count, total copies, for-trade / for-sale / for-lend counts.
  - Owners section: capped list, each row linking to that member's admin detail page.
  - Activity section: reuses the `AuditList` component from PR #38
    (`components/admin/users/audit-list.tsx` — move/re-export to `components/admin/` if
    the import path reads oddly from the puzzles route, otherwise import as-is; kind
    labels already have translations for `definition_disabled` / `definition_reenabled`).
- i18n: new keys in `source.json`/`en.json` (byte-identical) and `nl.json`.

## Error handling

- Unauthenticated / non-admin → `ConvexError("Forbidden")` (existing gate semantics).
- Unknown id → not-found error surfaced with the same error treatment the user detail
  page uses.

## Testing

- Backend `.test.ts` at `packages/backend/convex/` root for `getPuzzleDefinitionDetail`:
  gate (anonymous + non-admin), not-found, definition/stat/owner aggregation (distinct
  owners, availability rollup, cap), and audit trail retrieval (by aggregateId, order,
  cap).
- Typecheck via `pnpm exec tsc -p packages/backend/convex/tsconfig.json --noEmit`; web
  typecheck; prettier before commit.
