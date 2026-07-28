# Completion rows: navigation, images & status wording

**Date:** 2026-07-27
**Status:** Approved (revised after adversarial review, same day)
**Lands on:** `feat/in-progress-solves` (PR #66), by decision.

## Problem

Completion rows on `/completions` are dead ends: no way to reach the puzzle
copy or definition, no artwork, and the own/borrowed status line shows
completed-phrasing ("Solved your copy") for rows that are merely in progress.

A completion anchors durably to a puzzle definition (`puzzleId`) and
optionally to a copy (`ownedPuzzleId`) that may since have been returned,
traded, deleted, or hidden — navigation must degrade through those states.

## Requirements

- Each completion row shows an image and links (stretched-link over the row,
  anchored on the title) to the most specific reachable target:
  1. Copy exists and `ownerId === viewer` → `/my-puzzles/<id>`.
  2. Copy exists and `heldBy === viewer` (currently borrowed) → `/copies/<id>`.
  3. Copy exists and `canViewCopy(viewer, copy)` → `/copies/<id>`.
  4. Otherwise, the `puzzles` doc exists → `/puzzles/<id>` (definition).
  5. No reachable anchor (orphaned row, or puzzle doc deleted) → no link.
- Image: the copy's cover photo when the copy is reachable under the same
  rule as navigation (cases 1-3), else catalog box art via `puzzleId`, else
  the existing `CoverChip` fallback. Cover resolution runs only AFTER the
  reachability result for that copy, and always through
  `resolveCopyCoverUrl` (approved-moderation filter included).
- In-progress rows say "solving", not "solved": new locale keys chosen by
  `isCompleted` — en/source "Solving your copy" / "Solving a borrowed copy",
  nl "Bezig met eigen exemplaar" / "Bezig met geleend exemplaar" (mirrors
  the existing `solvedOwnCopy`/`solvedBorrowedCopy` phrasing).
- **Decision (approved):** `canViewCopy` gains a `copy.heldBy === viewerId`
  clause — the current physical holder may always view the copy page.

## Design

### 1. Backend enrichment in `listMyCompletions`

`packages/backend/convex/solving/listMyCompletions.ts` enriches each row
(alongside the existing `photoUrls`) with:

- `thumbnailUrl?: string` — via `resolveCopyCoverUrl`
  (`packages/backend/convex/library/resolveCoverUrl.ts`) for reachable
  copies (it applies the approved-only moderation filter and the box-art
  fallback), or the catalog `puzzles.image` URL when only the definition
  anchor remains.
- `link?: { kind: "myCopy" | "copy" | "definition"; id: string }` where the
  id is a Convex doc `_id` matching what the routes parse (verified):
  `myCopy`/`copy` → `ownedPuzzles._id` (the row's `ownedPuzzleId`),
  `definition` → `puzzles._id` (the row's `puzzleId`). **Never
  `copySnapshot.copyId`** — that is the aggregate string and the routes
  reject it. A `definition` link is emitted only when the `puzzles` doc
  still exists (no knowingly-dead links).

Cost control (all verified against existing precedent):

- Resolve per **distinct** `ownedPuzzleId`/`puzzleId` — including the
  `storage.getUrl` calls — then map results back onto rows.
- Extract `canViewCopyWithContext(ctx, viewerId, copy, context)` in
  `canViewCopy.ts`, where `context` carries a once-per-request circle-shared
  open-copy id set and a per-owner `profileVisibilityOf` memo; the existing
  `canViewCopy` becomes a thin wrapper building the context lazily. The
  heldBy clause sits before the open+public check, so owner/holder rows
  never touch the circle machinery. (Precedent: `getPuzzleDefinitionView`
  already inlines this shape; extracting keeps the file's "THE single
  copy-reachability gate" promise true.)

Scale note: for 1000 completions / 300 distinct copies this adds well under
the existing per-photo `getUrl` cost; the pre-existing unpaginated
`.collect()` remains the real ceiling (recorded debt).

### 2. `canViewCopy` extension — blast radius (reviewed and accepted)

`packages/backend/convex/library/canViewCopy.ts` gains, before the
open+public check:

```ts
// The current physical holder may always view the copy they hold — they can
// already log solves against it from the Borrowed page.
if (copy.heldBy === viewerId) return true;
```

Verified consumer list and what a current holder newly gets (Browse does
NOT consume this gate and is unaffected):

- `getCopyInstanceView`, `getCopyLoanHistory`, `getCopyCustodyTimeline` —
  the copy page and its loan/custody/completion history. Owner-personal
  fields (notes, acquisition data, prices) remain owner-gated; hidden
  member identities remain anonymized via `projectMemberIdentity`.
- `getOwnedPuzzlesByOwner`, `featuredShelf`, `getCollectionById` — the
  borrowed copy becomes visible to the holder inside the owner's
  library/shelf/collection listings.
- `listPuzzleComments`, `listPuzzleReviews`, `listPhotoComments`, and the
  **mutation** `postPhotoComment` — the holder can read comments/reviews and
  write photo comments on the copy.

**Accepted disclosure:** the holder of a private copy sees its social
history (other borrowers, prior owners, other members' reviews) — the same
payload any member sees when the copy is public+open, with the identity
projection chokepoint as the mitigation. The write-side consequence
(holders may post photo comments) is intended.

**Companion fix (same PR):** `getCopyInstanceView` resolves its hero cover
without a moderation filter (pre-existing bug; rejected covers still render
because auto-rejection does not clear `coverImageId`). Since this change
widens that page's audience to holders, route its cover resolution through
`resolveCopyCoverUrl` (or equivalent approved-only filter).

Known residual (documented, not fixed here): trading a copy away while it
is lent out sets `heldBy` to the new owner, so the borrower loses page
access mid-loan — an availability quirk, not a leak.

### 3. Web row changes (`completions/index.tsx`)

- The `CoverChip` block is replaced by the thumbnail image (44px, `Image`
  from `@/compat/image`, `rounded-lg object-cover` to match `CoverChip`'s
  radius, `alt=""`), keeping `CoverChip` as the no-image fallback. The
  in-progress signal is unaffected: the "In progress" badge and section
  headers carry it.
- **Stretched-link pattern** (house pattern, see
  `puzzle-card-shell.tsx:140-145`): the row gets `relative`, a single
  `Link` on the title with `after:absolute after:inset-0`, and the action
  button cluster gets `relative z-10`. One tab stop; the image and row
  become click surface; no flex restructuring. Rows without a `link` render
  exactly as today.
- Route mapping: `myCopy → /my-puzzles/$id`, `copy → /copies/$id`,
  `definition → /puzzles/$id`.
- Accepted: the link retargets reactively (e.g. a return while the page is
  open flips copy → definition); a click racing a state change degrades to
  the target page's own not-found handling.
- Accepted: a `definition` link may reach a non-approved catalog entry
  (e.g. the solver's own pending submission); the page renders it today and
  the solver has history with that puzzle.

### 4. Status-line wording

The own/borrowed line becomes `isCompleted ? solved* : solving*`. New keys
`solving.completions.solvingOwnCopy` / `solvingBorrowedCopy` ×3 locales:
en/source "Solving your copy" / "Solving a borrowed copy"; nl "Bezig met
eigen exemplaar" / "Bezig met geleend exemplaar".

### 5. Testing

Backend:

- Own copy → `myCopy` link; approved cover photo preferred over box art;
  a pending/rejected cover photo is NOT used (box art instead).
- Borrowed now (`heldBy = viewer`, private owner) → `copy` link (pins the
  gate extension).
- Returned + viewable (public owner, open copy) → `copy` link.
- Returned + unviewable (private owner, closed copy) → `definition` link
  and box-art (never cover-photo) thumbnail.
- Copy deleted → `definition` link; puzzle doc ALSO deleted → no link.
- Orphaned row (no copy, no puzzleId) → no link.
- `canViewCopy` holder clause: holder passes on a private closed copy;
  after `returnLoan`/`recallLoan` the ROW's `heldBy` equals `ownerId`
  (persistence-level assert) and the ex-borrower falls through to the old
  rules.
- Companion fix: `getCopyInstanceView` cover excludes non-approved photos.

Web: tsc + existing suites; the row change is presentational.

## Out of scope

- Full DTO-ification of `listMyCompletions` (raw-row read remains; recorded
  as future debt).
- Cover photos or links on the dashboard "Solving now" rail and profile
  "Currently solving" section (rail rows stay unlinked for now — noted as a
  possible follow-up; friend-facing surfaces never show another member's
  copy photos by design).
- Clearing `coverImageId` on photo rejection (the read-side filter suffices
  here; the write-side cleanup is separate debt).
- `completions/new` picker rows (selection targets, not navigation) and the
  copy page's own history list (already on the copy page).
