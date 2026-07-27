# Completion rows: navigation, images & status wording

**Date:** 2026-07-27
**Status:** Draft (pending adversarial review)
**Lands on:** `feat/in-progress-solves` (PR #66), by decision.

## Problem

Completion rows on `/completions` are dead ends: no way to reach the puzzle
copy or definition, no artwork, and the own/borrowed status line shows
completed-phrasing ("solved own copy") for rows that are merely in progress.

A completion anchors durably to a puzzle definition (`puzzleId`) and
optionally to a copy (`ownedPuzzleId`) that may since have been returned,
traded, deleted, or hidden — navigation must degrade through those states.

## Requirements

- Each completion row shows an image and links (thumbnail + title) to the
  most specific reachable target:
  1. Copy exists and `ownerId === viewer` → `/my-puzzles/<id>`.
  2. Copy exists and `heldBy === viewer` (currently borrowed) → `/copies/<id>`.
  3. Copy exists and `canViewCopy(viewer, copy)` → `/copies/<id>`.
  4. Otherwise, `puzzleId` known → `/puzzles/<id>` (definition).
  5. No anchor at all (orphaned legacy row) → no link, plain text.
- Image: the copy's cover photo when the copy is reachable under the same
  rule as navigation (cases 1-3), else catalog box art via `puzzleId`, else
  the existing `CoverChip` fallback.
- In-progress rows say "solving", not "solved": new
  `solvingOwnCopy`/`solvingBorrowedCopy` locale keys chosen by `isCompleted`.
- **Decision (approved):** `canViewCopy` gains a `copy.heldBy === viewerId`
  clause — the current physical holder may always view the copy page. This
  fixes case 2 end-to-end (the copy-detail reads gate on the same function)
  and is applied wherever the gate is used.

## Design

### 1. Backend enrichment in `listMyCompletions`

`packages/backend/convex/solving/listMyCompletions.ts` enriches each row
(alongside the existing `photoUrls`) with:

- `thumbnailUrl?: string` — resolved as: reachable copy's `coverImageId`
  (via `ownedPuzzleImages` → `storage.getUrl`) → catalog `puzzles.image` →
  undefined (UI falls back to `CoverChip`).
- `link?: { kind: "myCopy" | "copy" | "definition"; id: string }` — computed
  per the requirement rules with `canViewCopy`.

Cost control:

- Resolve per **distinct** `ownedPuzzleId`/`puzzleId` (many completions share
  one copy), then map results back onto rows.
- The circle-shared set used by `canViewCopy` is collected **once per
  request** and reused across distinct foreign copies (not per row). The
  owner/holder short-circuits never touch it.

The `id` values match what the target routes actually parse (verified during
planning: `/my-puzzles/$id` and `/copies/$id` share `CopyInstanceScreen`;
`/puzzles/$id` feeds `getPuzzleDefinitionView` — the plan pins doc-id vs
aggregate-id per route).

### 2. `canViewCopy` extension

`packages/backend/convex/library/canViewCopy.ts` gains, before the open+public
check:

```ts
if (copy.heldBy === viewerId) return true;
```

with a comment recording the rationale (the member physically holding a copy
may view its page — they can already log solves against it). Every consumer
of the gate (copy detail reads, loan history, custody timeline, browse
filtering) inherits the rule; the adversarial review checks this blast
radius.

### 3. Web row changes (`completions/index.tsx`)

- The `CoverChip` block is replaced by the thumbnail image (44px, `Image`
  from `@/compat/image`, `rounded-md object-cover`, `alt=""`), keeping
  `CoverChip` as the no-image fallback.
- Thumbnail and title are wrapped in a `Link` to the resolved target when
  `link` is present; rows without a link render exactly as today. Action
  buttons are untouched.
- Route mapping: `myCopy → /my-puzzles/$id`, `copy → /copies/$id`,
  `definition → /puzzles/$id`.

### 4. Status-line wording

The own/borrowed line becomes `isCompleted ? solved* : solving*`. New keys
`solving.completions.solvingOwnCopy` / `solvingBorrowedCopy` in en/nl/source,
following #65's nl terminology (voltooiing family; e.g. "Bezig op eigen
exemplaar" / "Bezig op geleend exemplaar" — final copy at implementation).

### 5. Testing

Backend (`solvingMutations.test.ts` or a dedicated read test file):

- Own copy → `myCopy` link; cover photo preferred over box art when set.
- Borrowed now (`heldBy = viewer`, private owner) → `copy` link (pins the
  gate extension).
- Returned + viewable (public owner, open copy) → `copy` link.
- Returned + unviewable (private owner, closed copy) → `definition` link and
  box-art (not cover-photo) thumbnail.
- Copy deleted → `definition` link.
- Orphaned row (no copy, no puzzleId) → no link.
- `canViewCopy` unit coverage for the new holder clause, including
  holder-after-return (heldBy cleared → falls through to the old rules).

Web: tsc + existing suites; the row change is presentational.

## Out of scope

- Full DTO-ification of `listMyCompletions` (raw-row read remains; recorded
  as future debt).
- Cover photos on the dashboard "Solving now" rail or profile section (they
  keep catalog box art by design — friend-facing surfaces never show another
  member's copy photos).
- Any change to copy-page content for borrowers beyond reachability.
