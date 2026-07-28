# Two-Level Reviews (puzzle + copy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-solve completion reviews with one updatable puzzle review per (member, puzzle) and one star-only copy review per (member, copy), unify every community-rating surface on them, migrate legacy data, and add a copy-page → puzzle-page link.

**Architecture:** Hexagonal — new domain upsert commands in the Solving context (pure TS in `packages/domain`), Convex composition roots/adapters in `packages/backend/convex`, DTOs in `packages/contracts`, transport through `packages/gateway/src/operations.ts`, web derives types from the gateway. Two new Convex tables (`puzzleReviews`, `copyReviews`); legacy fields stay DECLARED in the schema until a follow-up PR (see Landing plan).

**Tech Stack:** Convex, convex-test + vitest, TanStack Start/Router, react-query via Convex bindings, i18n ×3 locale files.

**Spec:** `docs/superpowers/specs/2026-07-28-two-level-reviews-design.md` — read it first; it records 9 user decisions this plan implements exactly.

**Landing plan (two PRs — mandatory):** every task below lands on `feat/in-progress-solves` (PR #66) against the still-loose schema. Schema tightening (dropping `completions.rating/review`, `completions.by_rating`, `puzzleComments.rating`) is PR B, a follow-up executed ONLY after the migration has run on dev+prod. PR B is NOT part of this plan's tasks; Task 21 records the runbook.

**Conventions (apply to every task):**

- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; run `npx prettier --write` on touched files before each commit.
- Backend locals must NOT be named `use[A-Z]*` (react-hooks lint false-positive) — name composition-root locals `<verb>UseCase`.
- New Convex function files must be hand-registered in the committed `packages/backend/convex/_generated/api.d.ts` (codegen needs a deployment; mirror how sibling modules are declared there).
- Locale edits go to ALL THREE files: `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json` (source == en). Dutch uses "voltooiing" terminology.
- Verification mirrors CI: run nx with `--skip-nx-cache`.
- JSX snippets in this plan are written to be spliced WITHOUT `{ expr; }` statement wrappers — copy the JSX as-is into the surrounding tree.

---

### Task 1: Schema — `puzzleReviews` + `copyReviews` tables

**Files:**

- Modify: `packages/backend/convex/schema.ts` (completions table is ~line 370–420; puzzleComments ~888–901 — add the new tables near the solving tables; do NOT touch `completions.rating/review`, `completions.by_rating`, or `puzzleComments.rating` in this PR)

- [ ] **Step 1: Add both table definitions**

```ts
// One review per (member, puzzle definition). `rating` is optional ONLY to
// hold migrated text-only legacy reviews (the old catalog form required text,
// stars optional); every new write supplies a rating. At least one of
// rating/text is always present.
puzzleReviews: defineTable({
  userId: v.id("users"),
  puzzleId: v.id("puzzles"),
  rating: v.optional(v.number()),
  text: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_puzzle", ["puzzleId"])
  .index("by_user_puzzle", ["userId", "puzzleId"]),

// One star-only review per (member, physical copy). Write-gated to the
// copy's owner or a member with a completion on the copy.
copyReviews: defineTable({
  userId: v.id("users"),
  copyId: v.id("ownedPuzzles"),
  rating: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_copy", ["copyId"])
  .index("by_user_copy", ["userId", "copyId"]),
```

Match the surrounding `defineTable` style (some tables carry doc comments — keep these).

- [ ] **Step 2: Verify types compile**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): puzzleReviews + copyReviews tables"
```

---

### Task 2: Domain — review upsert module (Solving context)

**Files:**

- Create: `packages/domain/src/solving/domain/puzzle-review-entry.ts` (entity + events)
- Create: `packages/domain/src/solving/application/ports/out/review-repositories.port.ts`
- Create: `packages/domain/src/solving/application/ports/in/upsert-puzzle-review.port.ts`
- Create: `packages/domain/src/solving/application/ports/in/upsert-copy-review.port.ts`
- Create: `packages/domain/src/solving/application/use-cases/upsert-puzzle-review.ts`
- Create: `packages/domain/src/solving/application/use-cases/upsert-copy-review.ts`
- Create: `packages/domain/src/solving/review-upsert.spec.ts` (co-locate with existing domain .spec.ts convention)
- Modify: `packages/domain/src/solving/domain/index.ts`, `packages/domain/src/solving/application/ports/in/index.ts` (exports)

Follow the EXACT structural idiom of the existing `review-puzzle` use case (`packages/domain/src/solving/application/use-cases/review-puzzle.ts`) and its ports before deleting them in Task 3 — same Result type, error channel (`notCompletionOwner`-style discriminated errors), `StarRating.create` reuse, clock port.

- [ ] **Step 1: Write failing specs** — `review-upsert.spec.ts` covering:
  - `upsertPuzzleReview` creates a new review (rating 4, text "Great fit") → repository received a save with normalized state; event `PuzzleReviewUpserted` recorded with `(userId, puzzleId, rating, occurredAt)`.
  - Second call for the same (member, puzzle) replaces rating/text (repository upsert semantics — the use case passes through; cardinality is the adapter's job).
  - Rating bounds: 0 and 6 → `invalidRating` error (via `StarRating.create`).
  - Whitespace-only text → stored as undefined.
  - `upsertCopyReview` requires permission: the in-port command carries `{ actingMemberId, copyOwnerId, hasCompletionOnCopy: boolean, copyId, rating }`; owner passes, completion-holder passes, neither → `notAllowedToReviewCopy` error. (The composition root supplies `copyOwnerId`/`hasCompletionOnCopy` — the domain stays pure; no repository lookups for permission.)
  - `CopyReviewUpserted` event recorded on success.

Run: `cd packages/domain && npx vitest run src/solving/review-upsert.spec.ts`
Expected: FAIL (modules don't exist).

- [ ] **Step 2: Implement** the entity/events, ports, and the two use cases (minimal code to satisfy the specs; events follow the existing event-class pattern in `packages/domain/src/solving/domain/events.ts` — add `PuzzleReviewUpserted` and `CopyReviewUpserted` classes there alongside the others).

- [ ] **Step 3: Run specs + arch check**

Run: `cd packages/domain && npx vitest run src/solving/review-upsert.spec.ts && pnpm nx run @jigswap/domain:arch:check --skip-nx-cache`
Expected: PASS / no violations.

- [ ] **Step 4: Commit** — `feat(domain): puzzle/copy review upsert commands`

---

### Task 3: Domain — remove the per-solve review path

**Files:**

- Modify: `packages/domain/src/solving/domain/completion.ts` (delete `review()` ~line 345–362; delete the creation-time review recording at ~199–207; drop `rating`/`review` from state)
- Delete: `packages/domain/src/solving/domain/puzzle-review.ts`, `packages/domain/src/solving/puzzle-review.spec.ts`
- Modify: `packages/domain/src/solving/domain/events.ts` (delete `PuzzleReviewed`, ~line 65–74)
- Modify: `packages/domain/src/solving/domain/ids.ts` (delete `PuzzleReviewId`, line ~6)
- Modify: `packages/domain/src/solving/domain/index.ts` (drop the `puzzle-review` export, line ~7)
- Delete: `packages/domain/src/solving/application/use-cases/review-puzzle.ts`, `.../ports/in/review-puzzle.port.ts`
- Modify: `packages/domain/src/solving/application/ports/in/index.ts` (line ~9)
- Modify: `packages/domain/src/solving/application/ports/in/record-completion.port.ts` (drop `rating`/`reviewText`, ~line 22–23) and `use-cases/record-completion.ts` (~line 22–26)
- Modify: `packages/domain/src/solving/completion.spec.ts` (assertions at ~146, 567) and `completion-use-cases.spec.ts` (~88, 383) — remove `PuzzleReviewed`/rating expectations
- Modify: `packages/domain/src/insights/personal-stats.ts` — input shape: remove per-completion `ratingGiven` (~line 5–9), add `puzzleReviewRatings: number[]`; `averageRatingGiven` (~line 83–102) averages that array (null when empty). Update its spec.

- [ ] **Step 1:** Make all removals; fix compile errors ONLY by deletion/adjustment of the listed touchpoints (if tsc reveals another consumer, remove its review usage too and note it in the commit body).
- [ ] **Step 2:** Run: `cd packages/domain && npx vitest run && npx tsc --noEmit && pnpm nx run @jigswap/domain:arch:check --skip-nx-cache`
      Expected: full domain suite PASS (specs updated), clean compile.
- [ ] **Step 3: Commit** — `refactor(domain)!: remove per-solve review path`

Note: `packages/backend` will NOT compile between Tasks 3 and 5 (mapper/use-case references). That is expected mid-stack; Tasks 4–5 restore it. Do not run backend verification until Task 5.

---

### Task 4: Backend adapters — review repositories + completion plumbing

**Files:**

- Create: `packages/backend/convex/solving/adapters/convexReviewRepositories.ts`
- Modify: `packages/backend/convex/solving/adapters/completionMapper.ts` (drop rating/review round-trip, ~lines 34–37, 61–72)
- Modify: `packages/backend/convex/solving/recordCompletion.ts`, `finishCompletion.ts` — return `{ completionId, puzzleId, copyId }` (doc ids; nullable). `recordCompletion` currently returns the aggregate id (line ~110); `finishCompletion` returns void (~24–40). Resolve `puzzleId`/`copyId` from the completions row (`row.puzzleId ?? null`, `row.ownedPuzzleId ?? null`) after the use case succeeds.
- Modify: `packages/contracts` solving DTOs + `packages/gateway/src/operations.ts` for the new return shapes.
- Modify: `packages/backend/convex/solvingMutations.test.ts` — return-shape assertions; remove any rating/review seeding.

- [ ] **Step 1 (test-first):** In `solvingMutations.test.ts`, assert `recordCompletion` returns `{ completionId: string, puzzleId: <puzzles doc id>, copyId: <ownedPuzzles doc id> }` for a copy-linked record, and `finishCompletion` returns the same shape; a definition-only record returns `copyId: null`.

Run: `cd packages/backend && npx vitest run convex/solvingMutations.test.ts`
Expected: FAIL (shape mismatch).

- [ ] **Step 2:** Implement the repository adapter:

```ts
import type { MutationCtx } from "../../_generated/server";

// Upsert-by-unique-key adapters for the two review tables. Cardinality
// (one row per member+target) lives HERE via the by_user_* indexes.
export const convexPuzzleReviewRepository = (ctx: MutationCtx) => ({
  upsert: async (input: {
    userId: string;
    puzzleId: string;
    rating: number;
    text: string | undefined;
    now: number;
  }) => {
    const existing = await ctx.db
      .query("puzzleReviews")
      .withIndex("by_user_puzzle", (q) =>
        q
          .eq("userId", input.userId as never)
          .eq("puzzleId", input.puzzleId as never),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: input.rating,
        text: input.text,
        updatedAt: input.now,
      });
      return;
    }
    await ctx.db.insert("puzzleReviews", {
      userId: input.userId as never,
      puzzleId: input.puzzleId as never,
      rating: input.rating,
      text: input.text,
      createdAt: input.now,
      updatedAt: input.now,
    });
  },
});
// convexCopyReviewRepository: same shape against copyReviews/by_user_copy (no text).
```

Adapt casts/typing to the codebase's existing adapter idiom (see `convexCompletionRepository.ts`) — do not invent a new style. Then implement the mutation return changes and mapper cleanup.

- [ ] **Step 3:** Run: `cd packages/backend && npx vitest run convex/solvingMutations.test.ts && npx tsc --noEmit`
      Expected: PASS, clean compile (backend compiles again from here).
- [ ] **Step 4: Commit** — `feat(backend): review repositories; record/finish return doc ids`

---

### Task 5: Backend — `submitReviews` mutation + `getMyReviews` query

**Files:**

- Create: `packages/backend/convex/solving/submitReviews.ts`
- Create: `packages/backend/convex/solving/getMyReviews.ts`
- Delete: `packages/backend/convex/solving/reviewPuzzle.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (register submitReviews + getMyReviews; drop reviewPuzzle)
- Modify: `packages/gateway/src/operations.ts` (replace the `reviewPuzzle` line ~211 with the two new operations)
- Create: `packages/backend/convex/reviewMutations.test.ts`

- [ ] **Step 1 (failing tests):** `reviewMutations.test.ts` with convex-test:
  - submit puzzle-only → one `puzzleReviews` row; submit again with new rating → still one row, updated values, `createdAt` stable, `updatedAt` bumped.
  - submit both levels for an owned copy → both rows in one call.
  - borrower (non-owner) WITH a completion on the copy → copy review allowed; member with neither → ConvexError.
  - `copyId` whose `puzzleId` ≠ `args.puzzleId` → ConvexError (cross-puzzle guard).
  - missing copy doc → ConvexError.
  - neither `puzzle` nor `copy` provided → ConvexError.
  - `getMyReviews`: returns own rows only; `copyReviewAllowed:false` for absent copyId, deleted copy, and unpermitted member; `true` for owner and for completion-holder.

Run: `cd packages/backend && npx vitest run convex/reviewMutations.test.ts` — expected FAIL.

- [ ] **Step 2:** Implement `submitReviews` as a composition root: `requireMember` → validate arg combination → when `copy` present: load copy (`ctx.db.get`), check existence + `copy.puzzleId === args.puzzleId`, compute `hasCompletionOnCopy` via `completions.by_user_owned_puzzle` (`.first() != null`) → call the two domain use cases (`upsertPuzzleReviewUseCase`, `upsertCopyReviewUseCase`) with the repository adapters, `inProcessEventPublisher`, `systemClock`; `toConvexError` on domain errors. Implement `getMyReviews` as a plain query (viewer-own lookups + the same permission computation; NO copy-content leakage — it returns only booleans/own rows).

- [ ] **Step 3:** Run the new test file + `npx tsc --noEmit` — PASS.
- [ ] **Step 4:** Register both modules in `api.d.ts`, wire the gateway ops (`solving.submitReviews`, `solving.getMyReviews`), remove `reviewPuzzle` everywhere backend/gateway-side (the WEB binding is Task 12 — expect `apps/web` tsc to be red until then, do not run web checks yet).
- [ ] **Step 5: Commit** — `feat(backend): submitReviews + getMyReviews; drop reviewPuzzle`

---

### Task 6: Backend — catalog review write path (`postPuzzleReview`)

**Files:**

- Modify: `packages/backend/convex/social/postPuzzleReview.ts` (args at ~23–26; currently delegates to `makePostComment`)
- Modify: `packages/backend/convex/postPuzzleReview.test.ts`

- [ ] **Step 1 (failing tests):** rewrite tests: rating REQUIRED (`rating: v.number()`), text optional; posting twice by one member on one puzzle → ONE `puzzleReviews` row (upserted), ZERO new `puzzleComments` rows; whitespace-only text → undefined.
- [ ] **Step 2:** Rewrite the mutation to call the SAME `upsertPuzzleReviewUseCase` + repository used by `submitReviews` (no duplicate logic — extract a small shared helper in `solving/` if needed). Keep the module path/name (public API surface for the catalog form stays put).
- [ ] **Step 3:** Run: `npx vitest run convex/postPuzzleReview.test.ts` — PASS.
- [ ] **Step 4: Commit** — `feat(backend): catalog review form upserts puzzleReviews`

---

### Task 7: Backend — comment path loses `rating` end-to-end

**Files:**

- Modify: `packages/backend/convex/social/postPuzzleComment.ts` (drop `rating` arg, line ~28 writes it)
- Modify: `packages/backend/convex/social/listPuzzleComments.ts` (projection line ~49)
- Modify: `packages/contracts/src/social/social.ts` — `PuzzleCommentView` (~57–63): remove `rating`; flip `text` handling ONLY if shared with reviews (see Task 8 — if `PuzzleCommentView` is review-shared, SPLIT the DTO: `PuzzleCommentView` (text required, no rating) and a new `PuzzleReviewView` for Task 8)
- Modify: `packages/backend/convex/postPuzzleComment.test.ts`

- [ ] **Step 1:** Failing tests: `postPuzzleComment` rejects/ignores rating (arg removed → TS-level), `listPuzzleComments` rows carry no `rating` key.
- [ ] **Step 2:** Implement; split the contract DTO as described.
- [ ] **Step 3:** `npx vitest run convex/postPuzzleComment.test.ts` + backend tsc — PASS (web red is expected until Tasks 12–15).
- [ ] **Step 4: Commit** — `refactor(backend)!: comments are plain text; rating removed`

---

### Task 8: Backend — review lists + rating breakdown re-sourced

**Files:**

- Modify: `packages/backend/convex/library/definitionAggregates.ts` (`ratingBreakdownOf`, ~71–107)
- Modify: `packages/backend/convex/social/listPuzzleReviews.ts`, `listPublicPuzzleReviews.ts`
- Modify: `packages/contracts` — new/changed `PuzzleReviewView`: `{ id, author, rating: number | null, text: string | null, updatedAt: number }` (public twin analogous)
- Modify tests: `getPuzzleDefinitionView.test.ts`, `publicCatalog.test.ts`, and the listPuzzleReviews coverage wherever it lives

- [ ] **Step 1 (failing tests):**
  - Breakdown: seed 3 rated `puzzleReviews` rows (one per member) + 1 text-only row → `count: 3`, text-only excluded; a member CANNOT have two rows (guaranteed by Task 5, no test here).
  - Dedupe proof: one member's single row counts once even after multiple `submitReviews` calls.
  - Lists: ordered desc by `updatedAt`; text-only and rating-only rows both serialize (`text: null` / `rating: null`); vanished-author synthetic "Member" fallback preserved; public list empty for non-approved puzzles.
- [ ] **Step 2:** Implement: `ratingBreakdownOf` queries `puzzleReviews.by_puzzle`, filters `rating != null`, keeps its `{rating, count, breakdown, percentages}` return shape. Lists mirror today's author-join/gating structure (`listPuzzleReviews.ts` requireMember + `toMemberView`; public twin `projectPublicAuthor` + approved gate).
- [ ] **Step 3:** Run the three test files — PASS. All three breakdown callers (`getPuzzleDefinitionView`, `browsePublicCatalog`, `catalog/getPublicDefinitionView`) compile untouched.
- [ ] **Step 4: Commit** — `feat(backend): unify rating breakdown + review lists on puzzleReviews`

---

### Task 9: Backend — copy page view (`getCopyInstanceView`)

**Files:**

- Modify: `packages/backend/convex/library/getCopyInstanceView.ts` (inline community aggregation ~241–265; yourAvgRating ~224–239; completion entries ~182–189; return object ~341–373; `projectMemberIdentity` memo ~69–85)
- Modify: `packages/contracts/src/library/views.ts` (`CopyInstanceView` ~382–440, `CopyInstanceCommunity`, `CopyCompletionEntry`)
- Modify: `packages/backend/convex/getCopyInstanceView.test.ts`

- [ ] **Step 1 (failing tests):**
  - `community` equals the definition-page breakdown for the same puzzle (seed reviews, compare against `ratingBreakdownOf` output; includes `percentages`).
  - `copyReviews` on the view: rows `{ author, rating, updatedAt }`; a HIDDEN member's review is anonymised exactly like the timeline (same `projectMemberIdentity` salt = copyId); vanished author → fallback view.
  - `stats.yourCopyRating` = viewer's copyReviews rating or null; `yourAvgRating` gone.
  - Completion entries no longer expose `rating`/`note`.
  - View exposes `puzzleId` (puzzles doc id).
- [ ] **Step 2:** Implement — reuse the existing per-page `projectMemberIdentity` memo for review authors; delete the inline aggregation in favor of `ratingBreakdownOf(ctx, copy.puzzleId)`; add `puzzleId: copy.puzzleId` to the return; update contracts.
- [ ] **Step 3:** `npx vitest run convex/getCopyInstanceView.test.ts` — PASS.
- [ ] **Step 4: Commit** — `feat(backend): copy view — unified community, copyReviews, puzzleId`

---

### Task 10: Backend — stats, export, cascades, completions list

**Files:**

- Modify: `packages/backend/convex/insights/getPersonalStats.ts` (~line 57) — feed `puzzleReviewRatings` from `puzzleReviews.by_user_puzzle` prefix query on the member
- Modify: `packages/backend/convex/insights/exportUserData.ts` (~89–92) — add `puzzleReviews` + `copyReviews` arrays to the export payload
- Modify: `packages/backend/convex/library/adapters/convexCopyRepository.ts` (delete cascade ~92–107) — cascade `copyReviews.by_copy` on copy delete
- Modify: `packages/backend/convex/solving/listMyCompletions.ts` — rows stop carrying `rating`/`review` (strip in the enrichment return; raw spread currently leaks them)
- Modify tests: `insightsQueries.test.ts`, the copy-deletion coverage, `listMyCompletions` coverage

- [ ] **Step 1 (failing tests):** personal stats averages puzzle reviews (incl. a catalog-only reviewer with zero completions → average present, and a review-less member → null); export contains both new tables; deleting a copy removes its copyReviews rows; listMyCompletions rows have no `rating`/`review` keys.
- [ ] **Step 2:** Implement all four.
- [ ] **Step 3:** Run the touched test files + full backend suite: `pnpm nx run @jigswap/backend:coverage --skip-nx-cache` — PASS (this is the first full-suite checkpoint; fix any straggler references revealed here within this task).
- [ ] **Step 4: Commit** — `feat(backend): stats/export/cascade/list re-sourced to review tables`

---

### Task 11: Backend — migration `backfillTwoLevelReviews`

**Files:**

- Create: `packages/backend/convex/migrations/backfillTwoLevelReviews.ts` (internal mutation, batched — mirror `solving/backfillCompletionPuzzleId.ts`'s pagination/batching idiom)
- Create: `packages/backend/convex/backfillTwoLevelReviews.test.ts`

Rules (from spec — implement EXACTLY):

- Candidate timestamps: completions → `updatedAt`; comments → `_creationTime`.
- Puzzle level: per (member, puzzle) — candidates are completions with `rating != null` AND resolvable `puzzleId`, plus ALL definition-scoped `puzzleComments` (rated or text-only). `rating` and `text` resolve INDEPENDENTLY (newest candidate carrying each field wins).
- Copy level: per (member, copy) — rated completions on the copy + rated copy-scoped comments; latest wins; skip candidates whose copy doc is gone.
- Cleanup (same migration run): unset `rating`/`review` on ALL completions; unset `rating` on ALL remaining `puzzleComments`; DELETE definition-scoped `puzzleComments`.
- Idempotent: re-running after completion is a no-op (existing puzzleReviews/copyReviews rows are left alone — skip members+targets that already have a row).

- [ ] **Step 1 (failing tests):** scenarios — (a) rated completion only; (b) rated definition comment only; (c) both, each order of recency (latest wins); (d) newer text-only comment + older rated completion → row has old rating AND new text; (e) text-only comment alone → text-only row; (f) copy-level merge from completion + copy comment; (g) candidate copy deleted → skipped at copy level, still counted at puzzle level; (h) completion without `puzzleId` → skipped at puzzle level, counted at copy level; (i) cleanup assertions: completions rating/review gone, copy-scoped comment ratings gone, definition-scoped comments deleted, copy-scoped comments retained; (j) idempotency: second run changes nothing.
- [ ] **Step 2:** Implement; register in `api.d.ts` (internal namespace).
- [ ] **Step 3:** `npx vitest run convex/backfillTwoLevelReviews.test.ts` — PASS.
- [ ] **Step 4: Commit** — `feat(backend): two-level reviews backfill migration`

---

### Task 12: Web — `ReviewPuzzleDialog` rework (two levels, prefill, dirty tracking)

**Files:**

- Modify: `apps/web/src/components/solving/review-puzzle-dialog.tsx` (props ~22–30, seed-once state ~44–45, submit ~54–58)
- Locales ×3: new keys under `solving.review` (see Task 16 for the full key list — add the ones this component needs now, in all three files)

Behavior (spec-exact):

- Props: `{ open, onOpenChange, puzzleId: string, copyId?: string }` (doc ids).
- On open, query `gateway.solving.getMyReviews({ puzzleId, copyId })`; render a skeleton INSIDE the dialog until it resolves; only then mount the form seeded from the result (keeps the seed-once `useState` correct — the form subcomponent mounts once with data).
- Section 1 "What did you think of this puzzle?": star row + textarea, seeded from `puzzle` result. Section 2 "What did you think of this copy?": star row only, rendered when `copyId != null && copyReviewAllowed`.
- When either level was prefilled, show a hint line (saving updates your existing review).
- Dirty tracking: compare against the seeded snapshot; Save submits ONLY changed levels via `gateway.solving.submitReviews`; if nothing changed → close, NO mutation. A puzzle text change without a star (new review) is invalid client-side (rating required) — reuse the existing `rating < 1` toast for the puzzle level ONLY when the puzzle level is dirty.
- Delete nothing: clearing text and saving sends `text: undefined` (upsert-overwrite; allowed).

- [ ] **Step 1:** Implement. Keep the conditional-mount-per-target pattern at call sites.
- [ ] **Step 2:** Verify: `cd apps/web && npx tsc --noEmit` (routeTree.gen noise is known — judge real errors only) — the `reviewPuzzle` binding removal (follow-up provider) is Task 13; this file must no longer reference `completionId`.
- [ ] **Step 3: Commit** — `feat(web): two-level review dialog with prefill + dirty tracking`

---

### Task 13: Web — follow-up provider + finish/log threading

**Files:**

- Modify: `apps/web/src/components/solving/completion-follow-up-provider.tsx` (`requestFollowUp` ~33–35/86–91; review save step ~204–211; `gateway.solving.reviewPuzzle` binding line ~70)
- Modify: `apps/web/src/components/solving/finish-solve-dialog.tsx`, `log-solve-dialog.tsx` (success paths — thread the NEW `{ completionId, puzzleId, copyId }` mutation returns into `requestFollowUp`)
- Modify: the no-provider stub + any `requestFollowUp` call sites (`/completions/new` route)

Behavior:

- `requestFollowUp({ completionId, puzzleId, copyId })` (first-wins semantics unchanged).
- Review section of the follow-up dialog becomes the SAME two-level UI as Task 12 (extract a shared `TwoLevelReviewFields` component from Task 12's form rather than duplicating — put it in `apps/web/src/components/solving/two-level-review-fields.tsx`), prefilled via `getMyReviews`, dirty-tracked; `reviewDoneRef` now guards the single `submitReviews` call on photo-retry loops.
- `puzzleId == null` → review section omitted entirely (photos still work).
- Nothing-changed + no photos → Save/Skip closes with no mutation.

- [ ] **Step 1:** Implement provider + threading (finish/log dialogs consume the new return values from Task 4).
- [ ] **Step 2:** `cd apps/web && npx tsc --noEmit` — zero real errors; `npx vitest run` for the web meta tests.
- [ ] **Step 3: Commit** — `feat(web): follow-up dialog reviews puzzle + copy`

---

### Task 14: Web — completions rows + copy page

**Files:**

- Modify: `apps/web/src/routes/_dashboard/completions/index.tsx` — remove read-only stars (~403–405) and review text (~330–333); Review button (~427–452): single label (one locale key, no add/edit ternary — delete the `completion.rating !== undefined` gate), pass `{ puzzleId: completion.puzzleId, copyId: completion.ownedPuzzleId }` doc ids from the row, HIDE when `completion.puzzleId == null`; dialog union member carries the ids (~53–56, render ~562–569)
- Modify: `apps/web/src/routes/_dashboard/copies/$id.tsx` — comment form star input removed (~1163–1230) and comment list stars removed (~1276–1278); `CommunityRating` unchanged visually (data now includes `percentages` — reconcile its props, ~1085–1128); NEW copy-reviews block (avg from view.community? NO — copy-level avg computed inline from `view.copyReviews` + per-member rows with author/stars/date) placed beside/below the comments section following the page's `SectionHead` idiom; `stats` grid swaps "your avg rating" for the new `yourCopyRating` (~224-derived stat + `MetaItem`/stat renderer); hero subtitle (~405–411) gains the "View puzzle page" link to `/puzzles/${view.puzzleId}` (import `Link` from `@/compat/link` — not currently imported)

- [ ] **Step 1:** Implement both routes. Keep the stretched-link/z-index conventions on the completions rows (action cluster stays `relative z-10`).
- [ ] **Step 2:** `cd apps/web && npx tsc --noEmit` + web vitest — clean.
- [ ] **Step 3: Commit** — `feat(web): rows + copy page on two-level reviews; puzzle-page link`

---

### Task 15: Web — catalog review surfaces (authed + public)

**Files:**

- Modify: `apps/web/src/routes/_dashboard/puzzles/$id/index.tsx` — review form (~490–500): rating REQUIRED (swap validation + message), text optional; submit still `postPuzzleReview`; button label switches to "Update review" when `getMyReviews` reports an existing review (fetch on mount for this puzzle, no copyId); list renderer (~591–595): show `updatedAt`, handle `text: null` (stars-only rows render without body) and `rating: null` (text-only rows render without stars)
- Modify: `apps/web/src/routes/_public/catalog/$id.tsx` (~422–426): same nullable-text/rating rendering + `updatedAt`

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `cd apps/web && npx tsc --noEmit` + vitest — clean.
- [ ] **Step 3: Commit** — `feat(web): catalog review form + lists on puzzleReviews`

---

### Task 16: Locales ×3 sweep + full verification battery

**Files:**

- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json`

- [ ] **Step 1:** Reconcile ALL new/changed keys across the three files (source == en). Complete list (namespaces follow existing structure — verify exact paths against the components as built):
  - `solving.review.puzzleQuestion` — "What did you think of this puzzle?" / nl "Wat vond je van deze puzzel?"
  - `solving.review.copyQuestion` — "What did you think of this copy?" / nl "Wat vond je van dit exemplaar?"
  - `solving.review.updatesExisting` — "Saving updates your existing review." / nl "Opslaan werkt je bestaande beoordeling bij."
  - `solving.review.title`/`description` — rephrase away from per-solve wording
  - `solving.followUp.description` — rephrase (current copy says both parts optional per-solve)
  - `solving.completions.review` — single row-button label "Review" / nl "Beoordelen" (replaces `addReview`/`editReview`; delete the stale keys)
  - catalog form: rating-required validation message (replace text-required); "Update review" / nl "Beoordeling bijwerken"
  - copy page: copy-reviews section title (e.g. "Copy reviews" / nl "Beoordelingen van dit exemplaar"); stat label replacing "your avg. rating" (e.g. "Your rating of this copy" / nl "Jouw beoordeling van dit exemplaar")
  - copy page hero: "View puzzle page" / nl "Bekijk puzzelpagina"
  - Remove keys orphaned by the removals (per-solve star labels on rows, comment-form rating label) — grep each candidate key for remaining usages before deleting.
- [ ] **Step 2: Full battery** (from repo root):

```bash
pnpm nx run @jigswap/domain:arch:check --skip-nx-cache
pnpm nx run-many -t type-check --skip-nx-cache
pnpm nx run @jigswap/domain:test --skip-nx-cache
pnpm nx run @jigswap/backend:coverage --skip-nx-cache
pnpm nx run @jigswap/web:test --skip-nx-cache
npx prettier --check .
```

Expected: all green.

- [ ] **Step 3: Commit** — `feat(web): review locale sweep` (plus any battery fixes as their own focused commits)

---

### Task 17 (documentation only — no code): PR B + runbook note

- [ ] **Step 1:** Append to `docs/deployment` runbook notes (or the PR #66 description): after merge + auto-deploy, IMMEDIATELY run `backfillTwoLevelReviews` on dev, verify, then prod (between deploy and migration, community ratings read empty — accepted). PR B afterwards: drop `completions.rating`, `completions.review`, `completions.by_rating`, `puzzleComments.rating` from `schema.ts` and remove/adjust the migration tests that seed legacy fields.
- [ ] **Step 2:** Update the PR #66 body to cover this slice.

---

## Self-review checklist (run after writing, before dispatch)

- Spec coverage: decisions 1–9 → Tasks 1–16 (verified: text-only rows T1/T8/T11; visibility upgrade is migration behavior T11; two-PR landing T17).
- No placeholders; type names consistent (`PuzzleReviewView`, `getMyReviews` shape, `{ completionId, puzzleId, copyId }` return) across tasks.
- Mid-stack red windows are EXPLICIT (after T3 backend red until T4/T5; web red from T5 until T12–15) — implementers must not "fix" them ahead of order.
