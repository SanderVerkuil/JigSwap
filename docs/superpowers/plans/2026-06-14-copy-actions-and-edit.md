# Copy-page action buttons + Edit (with cover selection) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or executing-plans to implement this task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Make the `/copies/$id` (owned-copy) action buttons do the right, context-aware thing, and give a copy a real Edit flow that can also choose its cover picture (the puzzle's global image or one of the copy's uploaded photos).

**Architecture:** Frontend wiring on `apps/web/src/routes/_dashboard/copies/$id.tsx` against existing gateway ops, plus one new copy-cover field + mutation in the Convex/DDD library context. Reuse existing dialogs (`LogSolveDialog`) and the exchange-propose flow rather than building new ones.

**Tech stack:** TanStack Start routes, shadcn Dialog, Convex mutations via `gateway.*`, DDD library aggregate (`copy.ts`).

---

## Current state (facts)

- `copies/$id.tsx` owner actions all just `router.push(...)`:
  - "Propose a Swap" → `/trades` (wrong for your own copy — you don't propose a swap to yourself).
  - "Offer to Lend" → `/trades` (wrong — should change this copy's lend availability).
  - "Log a Completion" → `/my-puzzles/$copyId` (**404 / no-op**).
  - "Edit" → `/my-puzzles/$copyId/edit` (**404 — route doesn't exist**).
  - Non-owner: "Propose a Swap" → `/trades`; "Message" → `/messages`.
- `LogSolveDialog` (`components/solving/log-solve-dialog.tsx`) exists, props `{ open, onOpenChange, copyId, puzzleTitle }` — already used by My Puzzles.
- Exchange/propose flow lives in `components/details/puzzle-detail/puzzle-detail-actions.tsx` (reference for a real swap proposal targeting a copy).
- Availability is toggled via `gateway.library.updateSharing` (`api.library.updateCopySharing`), args shaped by `availabilityToSharing(copyId, {forTrade,forLend,forSale})`.
- `ownedPuzzles` has **no cover field**; the copy currently shows `snapshot.image` (the puzzle definition's global image). Per-copy photos live in `ownedPuzzleImages` (by_owned_puzzle, `fileId`).
- The Edit button should sit **top-right** (in the page-head actions slot, which the page already publishes via `usePageHeader`).

---

## Task 1: Fix "Log a Completion" — open the existing dialog

**Files:** Modify `apps/web/src/routes/_dashboard/copies/$id.tsx`.

- [ ] Import `LogSolveDialog`; add `const [logOpen, setLogOpen] = useState(false)`.
- [ ] Change the owner "Log a Completion" button from `router.push(...)` to `onClick={() => setLogOpen(true)}`.
- [ ] Render `<LogSolveDialog open={logOpen} onOpenChange={setLogOpen} copyId={copyId} puzzleTitle={snapshot.title} />`.
- [ ] Verify: clicking it opens the dialog; submitting records a completion (the page's `getCopyInstanceView` refetches via Convex reactivity and the new completion appears in history/stats).

## Task 2: Fix "Offer to Lend" / "Propose a Swap" for the OWNER (availability, not navigation)

The owner's copy isn't swapped _by proposing to themselves_ — these buttons should change what the copy is **offered for**.

**Files:** Modify `copies/$id.tsx`; reuse `gateway.library.updateSharing` + `availabilityToSharing`.

- [ ] Replace the owner "Propose a Swap" button with an **"Offer for Swap"** toggle: when `snapshot.availability.forTrade` is false, set it true (call `updateSharing(availabilityToSharing(copyId, {...availability, forTrade: true}))`); when already offered, label it "Offered for Swap" / allow turning off. Same pattern for "Offer to Lend" (`forLend`). (Optional polish: a small "Availability" popover with three toggles trade/lend/sale instead of two buttons — but two toggles satisfy the requirement.)
- [ ] Reflect current state in the button (active styling when the flag is on) so it's clear the copy is already offered.
- [ ] Verify: toggling updates the availability badges in the hero and persists (refetch).

## Task 3: Fix "Propose a Swap" for a NON-owner (real proposal)

**Files:** Modify `copies/$id.tsx`; reference `puzzle-detail-actions.tsx` for the propose flow.

- [ ] For the non-owner action set, wire "Propose a Swap" to the existing exchange-propose flow targeting this `copyId` (open the propose dialog/route used by `puzzle-detail-actions.tsx`), instead of a bare `/trades` push. If that flow needs the owner/copy, pass them from the view (`copy.owner`, `copyId`). Keep "Message" hidden when `owner.anonymous`.
- [ ] Verify: a non-owner can start a swap proposal for the copy.

## Task 4: Edit flow for a copy (top-right) + cover selection

This needs a small backend addition (per-copy cover) plus an edit UI.

### 4a. Backend — per-copy cover (DDD library context)

**Files:** `packages/backend/convex/schema.ts` (`ownedPuzzles`), `packages/domain/src/library/domain/copy.ts` (+event), a `setCopyCover` use-case + Convex mutation `library.setCopyCover`, gateway op; tests.

- [ ] Add `coverImageId: v.optional(v.id("ownedPuzzleImages"))` to `ownedPuzzles` (absent ⇒ use the puzzle's global image — the current behaviour).
- [ ] Domain: add a `changeCover(coverImageId | null, now)` method to the `Copy` aggregate emitting a `CopyCoverChanged` event (mirror an existing copy mutation like condition/notes edit). `.spec.ts` (mutation gate ≥95%).
- [ ] Convex `library.setCopyCover({ copyId, coverImageId: v.optional(...) })` (owner-only) running the use-case; validate the image belongs to this copy. Gateway op. `*.test.ts`.
- [ ] Extend `getCopyInstanceView` snapshot: resolve the cover — if `coverImageId` is set and resolves, use that storage URL; else fall back to the puzzle's global image. (Add `coverImageId`/the resolved cover URL to the snapshot.)

### 4b. Frontend — Edit dialog + cover picker, moved top-right

**Files:** `copies/$id.tsx` (or a new `components/copies/edit-copy-dialog.tsx`).

- [ ] Put the **Edit** button in the page-head actions (top-right) via `usePageHeader` — it's owner-only.
- [ ] Build an Edit dialog/form for the copy's editable fields: **condition** (SegmentedPills), **availability** (trade/lend/sale chips → `updateSharing`), **notes** (Textarea). Reuse the field components from `components/add-puzzle/*`. Save via the existing `updateSharing` + a copy-edit mutation for condition/notes (check for an existing `editCopy`/condition-change mutation; add one if missing following the DDD pattern).
- [ ] **Cover picker** inside the dialog: a row of choices = the puzzle's **global image** ("Use catalogue image") + each **uploaded photo** (`getCopyInstanceView.gallery`). Selecting one calls `setCopyCover({ copyId, coverImageId })` (null for global). Show the current selection.
- [ ] On save, the dialog closes and the hero cover + fields update (Convex refetch).
- [ ] Verify: Edit opens the form (no 404), changes persist, and the chosen cover renders in the hero and the My-Puzzles card.

---

## Self-review checklist

- Spec coverage: items 1 (swap), 2 (lend), 3 (completion 404), 4 (edit 404 + top-right + cover) each map to a task above. ✓
- No placeholders: each task lists exact files + the existing op/dialog to reuse.
- Type consistency: `copyId` is the `ownedPuzzles` `_id` string everywhere; `coverImageId` is `Id<"ownedPuzzleImages">`.

## Execution

Recommended: subagent-driven-development. Tasks 1–3 are frontend-only and independent; Task 4 has a backend half (4a) that must land before the cover picker (4b).
