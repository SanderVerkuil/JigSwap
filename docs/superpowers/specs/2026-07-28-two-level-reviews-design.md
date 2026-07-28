# Two-level reviews: puzzle + copy, replacing per-solve reviews

**Date:** 2026-07-28
**Status:** Approved
**Lands on:** `feat/in-progress-solves` (PR #66).

## Problem

Reviews today attach to a single completion (`completions.rating/review` via
`reviewPuzzle`). They never reach the puzzle definition page (whose review
list reads `puzzleComments`), and the copy page's "community rating"
aggregates completions WITHOUT per-member dedupe — a member who solved a
puzzle three times moves the average three times, and the catalog page and
copy page disagree on what "community rating" means. The user wants: a
review OF the puzzle (one per member, updated when re-completing) plus a
second star row for the copy ("What did you think of this puzzle?" / "What
did you think of this copy?"). Separately: `/my-puzzles/<id>` needs a quick
link to the puzzle definition page.

## User decisions (recorded)

1. Puzzle review: ONE per (member, puzzle), shown globally — it surfaces in
   the definition page's community reviews, unifying with that system.
2. Copy review: ONE per (member, copy); permitted for the copy's owner or
   anyone with a completion on that copy. **Stars only** (no text — the
   written review stays definition-level; copy prose goes in copy comments).
3. Per-solve reviews are REPLACED ENTIRELY: fields removed from completions,
   rows stop showing per-solve stars; existing data migrated (latest wins).
4. Community rating unified: catalog AND copy pages both read the new
   per-member puzzle reviews. One voice per member.
5. Storage: dedicated tables (`puzzleReviews`, `copyReviews`), not
   `puzzleComments` reuse.
6. Any member may review a puzzle (catalog affordance preserved; no
   solved-it requirement at the definition level).
7. Migration merges BOTH legacy sources (completion reviews and rated
   `puzzleComments`), latest per member wins.

## Design

### Data model

- `puzzleReviews`: `userId: v.id("users")`, `puzzleId: v.id("puzzles")`,
  `rating: v.number()` (1–5), `text: v.optional(v.string())`, `createdAt`,
  `updatedAt`. Indexes: `by_puzzle` (["puzzleId"]), `by_user_puzzle`
  (["userId", "puzzleId"]). Uniqueness per (member, puzzle) enforced at the
  write path (`.unique()` lookup then insert-or-patch).
- `copyReviews`: `userId: v.id("users")`, `copyId: v.id("ownedPuzzles")`,
  `rating: v.number()` (1–5), `createdAt`, `updatedAt`. Indexes: `by_copy`
  (["copyId"]), `by_user_copy` (["userId", "copyId"]).

### Domain (Solving context)

- REMOVE `Completion.review()`, the `PuzzleReview` value object, the
  `rating`/`review` fields from completion state/commands, and the
  `PuzzleReviewed` event (zero consumers — verified; only spec tests assert
  on it, which are updated).
- NEW review module: `upsertPuzzleReview` and `upsertCopyReview` commands
  with create-or-replace semantics, `StarRating` reuse, whitespace-only
  text normalised to undefined (puzzle level only). New events
  `PuzzleReviewUpserted` / `CopyReviewUpserted` recorded to the durable
  event log for audit; no subscribers (all current subscribers no-op on
  unknown kinds by design).
- Copy-review permission rule (domain-level): actor must be the copy's
  owner OR have at least one completion referencing that copy. The
  completion-existence fact is provided by the composition root (port
  boundary), not queried inside the domain.

### Write paths

- NEW mutation `solving/submitReviews.ts`:
  `{ puzzleId: v.id("puzzles"), copyId: v.optional(v.id("ownedPuzzles")),
puzzle: v.optional({ rating: v.number(), text: v.optional(v.string()) }),
copy: v.optional({ rating: v.number() }) }`. Upserts both levels in one
  transaction. At least one of `puzzle`/`copy` required. `copy` requires
  `copyId`; the copy must exist and the permission rule above must pass.
  When `copyId` is present, the copy's `puzzleId` must match `args.puzzleId`
  (guards cross-puzzle writes).
- `solving/reviewPuzzle.ts` (completion-based) is DELETED, along with its
  gateway line and use-case wiring.
- `recordCompletion` / `editCompletion` (mutations AND domain commands)
  drop their `rating`/`review` args; any web form fields feeding them
  (e.g. a rating input in the log-solve flow, if present) are removed —
  reviews are captured only via the two-level dialogs.
- `social/postPuzzleReview.ts` (catalog "write a review") is REWRITTEN to
  upsert the member's `puzzleReviews` row: rating REQUIRED (was optional),
  text optional (was required) — the form updates to match. It no longer
  writes `puzzleComments`.
- `social/postPuzzleComment.ts` (copy-scoped comments) DROPS its `rating`
  arg; the copy-page comment form removes its rating input. Comments become
  plain text; copy opinions live in `copyReviews`.

### Read paths (all rating surfaces unify)

- `library/definitionAggregates.ts` `ratingBreakdownOf` → reads
  `puzzleReviews.by_puzzle`. Callers unchanged
  (`getPuzzleDefinitionView`, `browsePublicCatalog`).
- `social/listPuzzleReviews.ts` + `listPublicPuzzleReviews.ts` → read
  `puzzleReviews.by_puzzle` desc by `updatedAt`, same author-join and
  gating patterns as today (requireMember / approved-only public).
- `library/getCopyInstanceView.ts`:
  - `community` → the SAME `ratingBreakdownOf` helper (deletes the inline
    completions-based aggregation; the two pages now agree).
  - NEW `copyReviews` list on the view: `{ author, rating, updatedAt }[]`
    via `by_copy` (page access is already gated; no extra per-row gate).
  - `stats.yourAvgRating` → replaced by `stats.yourCopyRating` (the
    viewer's `copyReviews` row, or null).
  - Per-completion `rating`/`note` REMOVED from `CopyCompletionEntry`.
  - NEW `puzzleId: copy.puzzleId` on the view (also serves navigation).
- `insights/getPersonalStats.ts` `ratingGiven`/`averageRatingGiven` →
  computed from the member's `puzzleReviews` instead of completions.
- `solving/listMyCompletions.ts`: rows stop carrying `rating`/`review`.
  The row's Review button opens the two-level dialog; prefill comes from a
  NEW small query `solving/getMyReviews.ts`
  `{ puzzleId, copyId? } → { puzzle: {rating, text}|null, copy: {rating}|null,
copyReviewAllowed: boolean }`, fetched when the dialog opens.
- Contracts + gateway + `_generated/api.d.ts` updated for every changed
  read/write; web derives types from the gateway as always.

### Dialogs (web)

- `ReviewPuzzleDialog` reworked: props become `{ puzzleId, copyId? }` (doc
  ids, not completionId). Two sections: "What did you think of this
  puzzle?" (star row + textarea) and, when `copyId` is present AND
  `copyReviewAllowed`, "What did you think of this copy?" (star row only).
  Prefilled from `getMyReviews`; saving calls `submitReviews` with only the
  levels the user rated (puzzle text may be saved with its rating; a copy
  row needs a copy rating). Conditional mount per target stays (the
  seed-once `useState` pattern).
- Completion follow-up dialog: same two-level review section replaces the
  single star row; prefilled via `getMyReviews` (re-completion = update).
  The `reviewDoneRef` retry guard and photo section are unchanged; the
  provider's `requestFollowUp` now needs the completion's `puzzleId` +
  `copyId` alongside `completionId` (threaded from the finish/log flows,
  which have them).
- Completions rows: read-only per-solve stars and review text are removed;
  the Review button remains (opens the dialog for that row's puzzle/copy).
- Copy page: comment form loses its star input; a copy-reviews display
  (avg + per-member rows) joins the copy page using the new view data;
  "community rating" section unchanged visually (new source).
- Catalog review form: rating required, text optional; submitting replaces
  your previous review (button copy switches to "Update review" when
  `getMyReviews` reports an existing one).
- Locale keys ×3 (`en`, `nl`, `source`): the two question labels, copy
  review section strings, "Update review", migration-free.

### Migration (one-off, internal)

`migrations/backfillTwoLevelReviews.ts` (internal mutation, batched like
`backfillCompletionPuzzleId`; runbook: dev first, then prod):

1. Puzzle level: for each member+puzzle, gather candidates — completions
   with `rating != null` (timestamp: `updatedAt`) and definition-scoped
   `puzzleComments` with `rating != null` (timestamp: `createdAt`/doc
   time). Latest wins → insert `puzzleReviews` (rating + that candidate's
   text, comment body serving as text for comment candidates).
2. Copy level: for each member+copy, candidates — completions on that copy
   with `rating != null`, and copy-scoped rated `puzzleComments` by that
   member. Latest wins → insert `copyReviews` (rating only).
3. Cleanup: unset `rating`/`review` on all completions rows; DELETE
   definition-scoped `puzzleComments` (fully superseded — their latest
   content was migrated; older duplicates are intentionally dropped per
   "one voice per member"); copy-scoped comments are KEPT (as plain
   comments — their `rating` values are simply no longer read; the column
   is removed from the schema only after data is unset, same batch).
4. After cleanup lands, schema drops `completions.rating`, `completions.review`,
   the dead `completions.by_rating` index, and `puzzleComments.rating`.

Ordering note: schema field removals deploy AFTER the migration has unset
the data (Convex rejects schemas that existing rows violate). Within this
pre-release app a two-step deploy (code+migration, then schema tightening)
is acceptable and mirrors the puzzleId backfill precedent.

### Navigation link (rides along)

- `getCopyInstanceView` exposes `puzzleId` (loaded already at handler top;
  one line + `puzzleId: DocId` on `CopyInstanceView` in contracts —
  idiomatic, sibling DTOs carry it).
- `CopyInstanceScreen` hero subtitle (brand · pieces line) gains a
  "View puzzle page" link (`@/compat/link`, needs import) to
  `/puzzles/<puzzleId>`, serving both `/my-puzzles/<id>` and
  `/copies/<id>`. Locale key ×3.

## Testing

- Domain specs: upsert create + replace semantics; star bounds; text
  normalisation; copy-review permission (owner / solver / neither);
  removed review path no longer compiles/exists.
- Backend tests: `submitReviews` (insert then update = one row; copy
  gating incl. borrower-with-completion; puzzle/copy mismatch rejected;
  atomic both-level write), `postPuzzleReview` upsert, breakdown dedupe
  (3 solves → 1 voice), copy page community == catalog community for same
  puzzle, `getMyReviews` shapes, migration merge/latest-wins scenarios
  (completion vs comment, both orders) + cleanup assertions,
  `getPersonalStats` new source.
- Web: tsc/lint/meta; flows via PR preview.

## Out of scope

- Copy-review text (stars only — decided); review moderation; notifying
  puzzle owners of reviews; editing/deleting reviews from the catalog list
  beyond upsert-overwrite; friend-facing review feeds; re-ranking browse
  by the new ratings beyond what `ratingBreakdownOf` already feeds.
