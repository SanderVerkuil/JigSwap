# Two-level reviews: puzzle + copy, replacing per-solve reviews

**Date:** 2026-07-28
**Status:** Approved (revised after two-reviewer adversarial pass, same day)
**Lands on:** `feat/in-progress-solves` (PR #66) + one follow-up PR (schema
tightening — see Migration).

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
8. Rating-less definition-review texts (today's catalog form required text,
   stars optional) are MIGRATED AS TEXT-ONLY reviews — `puzzleReviews.rating`
   is optional in the schema; the form still requires stars going forward.
   No member prose is destroyed.
9. Completion-sourced review text migrates WITH text into the publicly
   attributed review list. The resulting visibility upgrade (per-solve text
   was self-facing/anonymised; reviews are public with real name, even
   unauthenticated when the profile is public) is ACCEPTED — pre-release,
   the dialog framed these as puzzle reviews, and reviews are public going
   forward.

## Design

### Data model

- `puzzleReviews`: `userId: v.id("users")`, `puzzleId: v.id("puzzles")`,
  `rating: v.optional(v.number())` (1–5; optional ONLY for migrated
  text-only rows — every new write requires it), `text: v.optional(v.string())`,
  `createdAt`, `updatedAt`. At least one of rating/text is always present.
  Indexes: `by_puzzle` (["puzzleId"]), `by_user_puzzle`
  (["userId", "puzzleId"]). Uniqueness per (member, puzzle) enforced at the
  write path (`.unique()` lookup then insert-or-patch).
- `copyReviews`: `userId: v.id("users")`, `copyId: v.id("ownedPuzzles")`,
  `rating: v.number()` (1–5), `createdAt`, `updatedAt`. Indexes: `by_copy`
  (["copyId"]), `by_user_copy` (["userId", "copyId"]).

### Domain

- Solving context removals: `Completion.review()`, the `PuzzleReview` value
  object (+ its spec file), `PuzzleReviewId`, the `rating`/`reviewText`
  fields on the record-completion command/port (the PUBLIC mutations carry
  no such args today — the removal is domain-side only), the
  `review-puzzle` use case/port/wiring, and the `PuzzleReviewed` event
  (zero consumers — verified; `completion.spec.ts` /
  `completion-use-cases.spec.ts` assertions updated).
- NEW review module (Solving context): `upsertPuzzleReview` and
  `upsertCopyReview` commands with create-or-replace semantics, `StarRating`
  reuse, whitespace-only text normalised to undefined (puzzle level only).
  New events `PuzzleReviewUpserted` / `CopyReviewUpserted` recorded to the
  durable event log for audit; no subscribers (all current subscribers
  no-op on unknown kinds; `domainEvents.name` is a plain string — no schema
  change).
- Copy-review permission rule (domain-level): actor must be the copy's
  owner OR have at least one completion referencing that copy. The
  completion-existence fact is provided by the composition root via the
  `by_user_owned_puzzle` index (port boundary — the domain stays pure).
- Insights: `computePersonalStats`' input shape changes — per-completion
  `ratingGiven` is removed and a `puzzleReviewRatings: number[]` input is
  added; `averageRatingGiven` averages the member's puzzle reviews.
  Domain spec tests updated (this is a deliberate `packages/domain/insights`
  edit alongside the Solving-context ones).

### Write paths

- NEW mutation `solving/submitReviews.ts`:
  `{ puzzleId: v.id("puzzles"), copyId: v.optional(v.id("ownedPuzzles")),
puzzle: v.optional({ rating: v.number(), text: v.optional(v.string()) }),
copy: v.optional({ rating: v.number() }) }`. Upserts both levels in one
  transaction. At least one of `puzzle`/`copy` required. `copy` requires
  `copyId`; the copy must exist and the permission rule above must pass.
  When `copyId` is present, the copy's `puzzleId` must match `args.puzzleId`
  (guards cross-puzzle writes).
- `solving/reviewPuzzle.ts` (completion-based) is DELETED end-to-end:
  mutation, use case + port + `ports/in` export, gateway line
  (`operations.ts`), committed `_generated/api.d.ts` entry, and the
  `gateway.solving.reviewPuzzle` binding in the follow-up provider.
- **Doc-id threading:** `recordCompletion` and `finishCompletion` change
  their return value to `{ completionId, puzzleId, copyId }` (doc ids
  resolved server-side; `puzzleId`/`copyId` nullable). Neither the finish
  flow nor the log flow holds these ids today (`InProgressSolveView` has
  no puzzleId; log-dialog callers hold the copy AGGREGATE id) — the
  mutation return is the cheapest correct channel. Contracts + gateway
  updated accordingly.
- `social/postPuzzleReview.ts` (catalog "write a review") is REWRITTEN to
  upsert the member's `puzzleReviews` row: rating REQUIRED (was optional),
  text optional (was required) — the form updates to match, including the
  swapped validation message. It no longer writes `puzzleComments`.
- `social/postPuzzleComment.ts` (copy-scoped comments) DROPS its `rating`
  arg, and `rating` is removed END-TO-END from the comment path:
  `PuzzleCommentView` (contracts), `listPuzzleComments` projection, and the
  copy-page comment renderer's stars. Comments become plain text; copy
  opinions live in `copyReviews`. (Historical comment stars stop displaying
  — their latest values migrate into `copyReviews`.)

### Read paths (all rating surfaces unify)

- `library/definitionAggregates.ts` `ratingBreakdownOf` → reads
  `puzzleReviews.by_puzzle`, counting only rows with `rating != null`
  (text-only rows are listed but never aggregated). Callers unchanged:
  `getPuzzleDefinitionView`, `browsePublicCatalog`, AND
  `catalog/getPublicDefinitionView`. Displayed counts will visibly shrink
  after dedupe — expected (one voice per member).
- `social/listPuzzleReviews.ts` + `listPublicPuzzleReviews.ts` → read
  `puzzleReviews.by_puzzle` desc by `updatedAt`, same author-join and
  gating patterns as today (requireMember / approved-puzzle-only public;
  synthetic "Member" fallback for vanished authors). Contract flips:
  `text` becomes nullable, `rating` stays nullable; DTOs carry (and the UI
  shows) `updatedAt`, so an updated review doesn't surface with a stale
  date. Renderers handle rating-only rows (stars, no body) and text-only
  rows (body, no stars).
- `library/getCopyInstanceView.ts`:
  - `community` → the SAME `ratingBreakdownOf` helper (deletes the inline
    completions-based aggregation; the two pages now agree — the copy
    page's number becomes a definition-wide stat, per decision 4).
    `CopyInstanceCommunity` adopts the helper's full shape
    `{ rating, count, breakdown, percentages }`.
  - NEW `copyReviews` list on the view: `{ author, rating, updatedAt }[]`
    via `by_copy`. Authors are projected through the page's EXISTING
    `projectMemberIdentity` memo (salt = copyId) — hidden members stay
    anonymised, so a migrated borrow-derived rating cannot name a private
    borrower. Vanished authors fall back like the timeline does.
  - `stats.yourAvgRating` → replaced by `stats.yourCopyRating` (the
    viewer's `copyReviews` row, or null).
  - Per-completion `rating`/`note` REMOVED from `CopyCompletionEntry`.
  - NEW `puzzleId: copy.puzzleId` on the view (also serves navigation).
- `insights/getPersonalStats.ts` → feeds the member's `puzzleReviews`
  ratings into the new domain input (see Domain).
- `insights/exportUserData.ts` → completions in the export lose
  rating/review with the columns; BOTH new tables are ADDED to the export
  (`puzzleReviews`, `copyReviews`).
- `solving/listMyCompletions.ts`: rows stop carrying `rating`/`review`.
  The row's Review button becomes a single "Review" label (no add/edit
  distinction — prefill state is only known once the dialog opens) and is
  HIDDEN when the row has no resolvable `puzzleId` (legacy copy-only rows
  whose copy died pre-backfill).
- NEW query `solving/getMyReviews.ts`:
  `{ puzzleId, copyId? } → { puzzle: {rating, text}|null, copy: {rating}|null,
copyReviewAllowed: boolean }`, fetched when a dialog opens.
  `copyReviewAllowed: false` when `copyId` is absent, the copy row no
  longer exists, or the permission rule fails. Reveals only viewer-own
  facts (no copy-privacy leak — verified).
- Contracts + gateway + `_generated/api.d.ts` updated for every changed
  read/write; web derives types from the gateway as always.

### Lifecycle & cascades

- `deleteCopy` cascades the copy's `copyReviews` rows (alongside its
  existing membership/image cascades).
- Member deletion: review rows may dangle — both list surfaces already
  need the synthetic-"Member" author fallback; accepted (matches
  `listPuzzleReviews` today).
- Deleting the completion that granted copy-review permission does NOT
  delete the copy review (permission is evaluated at write time) — accepted.
- Ownership transfer (custody): a previous owner's/borrower's copy review
  persists on the copy page — accepted (they had custody).
- Non-approved/disabled puzzles: public reads keep the existing
  `status === "approved"` gate (lists AND the public breakdown callers).

### Dialogs (web)

- `ReviewPuzzleDialog` reworked: props become `{ puzzleId, copyId? }` (doc
  ids, not completionId). Two sections: "What did you think of this
  puzzle?" (star row + textarea) and, when `copyId` is present AND
  `copyReviewAllowed`, "What did you think of this copy?" (star row only).
  The form body renders ONLY after `getMyReviews` resolves (skeleton until
  then — prevents the seed-empty-then-overwrite race); when an existing
  review is prefilled, a hint line says saving updates it. **Dirty
  tracking:** `submitReviews` is called with only the levels the user
  actually changed; if nothing changed, Save closes without calling the
  mutation (no `updatedAt` bump, no list re-sort). Clearing the prefilled
  text and saving intentionally erases the text (upsert-overwrite; the
  prefill makes the stakes visible) — no delete-review path (out of scope).
- Completion follow-up dialog: same two-level review section replaces the
  single star row; prefill + dirty-tracking as above. The `reviewDoneRef`
  retry guard and photo section are unchanged; `requestFollowUp` now takes
  `{ completionId, puzzleId, copyId }`, supplied by the new
  `recordCompletion`/`finishCompletion` return values. When `puzzleId` is
  null (legacy edge), the review section is omitted (photos still work).
- Completions rows: read-only per-solve stars and review text are removed;
  the Review button remains per the listMyCompletions rules above.
- Copy page: comment form loses its star input and the comment list loses
  its stars; a copy-reviews display (avg + per-member rows) joins the copy
  page using the new view data; "community rating" section unchanged
  visually (new source).
- Catalog review form: rating required, text optional; submitting replaces
  your previous review (button copy switches to "Update review" when
  `getMyReviews` reports an existing one).
- Locale keys ×3 (`en`, `nl`, `source`): the two question labels, copy
  review section strings, "Update review", the "updates your existing
  review" hint, the catalog form's rating-required validation message
  (replacing text-required), the single "Review" row-button label, the
  reworked `solving.review` + `solving.followUp` descriptions (current
  copy references per-solve semantics), and the copy-page stat label
  replacing "your avg. rating".

### Migration (one-off, internal) & landing plan

`migrations/backfillTwoLevelReviews.ts` (internal mutation, batched like
`backfillCompletionPuzzleId`).

Candidate timestamps: completions contribute `updatedAt` (caveat: photo
attach bumps it — accepted, data volume is small and pre-release);
comments contribute `_creationTime`.

1. Puzzle level: for each member+puzzle, candidates — completions with
   `rating != null` AND a resolvable `puzzleId` (rows without one are
   skipped at this level), definition-scoped `puzzleComments` (rated OR
   text-only, per decision 8). `rating` and `text` are resolved
   INDEPENDENTLY: each takes the value from the newest candidate that
   carries that field (so a newer text-only comment doesn't erase an older
   star, and vice versa) → insert `puzzleReviews`.
2. Copy level: for each member+copy, candidates — completions on that copy
   with `rating != null`, and copy-scoped rated `puzzleComments` by that
   member. Latest wins → insert `copyReviews` (rating only). Candidates
   whose copy row no longer exists are SKIPPED.
3. Cleanup: unset `rating`/`review` on all completions rows; unset
   `rating` on ALL remaining (copy-scoped) `puzzleComments` rows; DELETE
   definition-scoped `puzzleComments` (now fully superseded — rated and
   text-only content alike was migrated; older per-member duplicates are
   intentionally dropped per "one voice per member").

**Landing plan (two PRs — mandatory):** dev/prod deploys are AUTOMATIC on
main merges, so the tightened schema cannot ride with the migration.

- **PR A (= PR #66):** tables, all code, the migration, and tests — against
  the still-loose schema (legacy fields remain declared; migration tests
  seed them). After merge + auto-deploy, run the migration PROMPTLY on dev
  then prod (runbook note: between deploy and migration, community ratings
  read empty — accepted, pre-release).
- **PR B (follow-up):** schema drops `completions.rating`,
  `completions.review`, the dead `completions.by_rating` index, and
  `puzzleComments.rating`; the migration tests that must seed legacy
  fields are removed/adjusted in the same PR (they cannot coexist with the
  tightened schema — convex-test validates inserts against it).

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
  `computePersonalStats` new input; removed review path no longer exists.
- Backend tests: `submitReviews` (insert then update = one row; copy
  gating incl. borrower-with-completion; puzzle/copy mismatch rejected;
  atomic both-level write; missing copy rejected), `postPuzzleReview`
  upsert, breakdown dedupe (3 solves → 1 voice) + text-only rows excluded
  from aggregates, copy page community == catalog community for same
  puzzle, `copyReviews` author anonymisation (hidden member) + vanished
  author fallback, `getMyReviews` shapes incl. deleted-copy →
  `copyReviewAllowed: false`, `recordCompletion`/`finishCompletion` return
  shapes, `deleteCopy` cascades copyReviews, `exportUserData` contains
  both new tables, `getPersonalStats` new source (incl. catalog-only
  reviewer who never solved), migration scenarios: latest-wins across
  sources (both orders), independent rating/text resolution (newer
  text-only comment + older rated completion), text-only definition
  comment migrated, candidate with deleted copy skipped, completion
  without puzzleId skipped at puzzle level, cleanup assertions (completions
  unset, copy-scoped comment ratings unset, definition comments deleted).
- Web: tsc/lint/meta; unchanged-prefill Save is a no-op and nothing-rated
  Save skips the mutation (component-level if practical, else PR-preview
  verified); flows via PR preview.

## Out of scope

- Copy-review text (stars only — decided); review moderation; notifying
  puzzle owners of reviews; deleting one's review (upsert-overwrite only);
  friend-facing review feeds; re-ranking browse by the new ratings beyond
  what `ratingBreakdownOf` already feeds; re-anonymising pre-migration
  data beyond decision 9.
