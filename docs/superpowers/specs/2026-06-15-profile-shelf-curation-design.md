# Profile shelf curation ("highlight")

**Date:** 2026-06-15
**Status:** Approved (design) — autonomous build per "continue until everything is completed"; the WHAT was pre-decided (curate which puzzles show + order, separate from the catalogue, small backend field).
**Sub-project ④ of the punch list** (① ✓ → ② ✓ → ③ ✓ → **④ profile shelf curation** → ⑤ rigid-body physics).

## Goal

Let a member curate **which** of their owned puzzles appear on their profile shelf and **in what order** — a hand-arranged display shelf, distinct from the full catalogue (My Puzzles). The profile shelf (now the 3D plank from ③) renders the curated, ordered set; with nothing curated it falls back to the current behavior (most-recent 6). Owners get an "Arrange shelf" editor on their own profile.

This is one cohesive feature spanning the DDD stack: domain → schema → Convex → gateway → codegen → web. It is **sequential** (each layer depends on the one below), so it builds in a single isolated worktree with atomic commits per layer — not parallel intents.

## Decisions (documented)

- **Storage:** an ordered `featuredCopyIds` array on the `profiles` aggregate/table (opaque CopyId strings, capped at 6, de-duplicated). Order in the array = display order. Chosen over a per-copy boolean flag because it captures order natively and keeps the curated set on the profile aggregate that owns the shelf.
- **Edit surface:** an owner-only "Arrange shelf" affordance on the member's **own** profile shelf, opening a dialog: the owner's owned copies as a selectable grid (toggle to include, max 6) with **up/down reorder controls** on the selected items. No drag-and-drop dependency — accessible, robust, and verifiable without a browser (important: browser automation is unavailable in this environment). Save calls the `arrangeShelf` mutation.
- **Ownership validation** (curated copies must belong to the member) lives in the **Convex mutation** (cross-aggregate concern), not the Profile aggregate. The aggregate stores opaque ordered ids, deduping + capping only.
- **Fallback:** empty `featuredCopyIds` → the profile shelf shows the most-recent 6 owned copies (today's behavior), so existing profiles are unchanged until the owner curates.

## Architecture (by layer)

### 1. Domain — `packages/domain/src/social/`

- `domain/profile.ts`: add `featuredCopyIds: readonly string[]` to `ProfileState` (default `[]` in `create`). Add `arrangeShelf(copyIds: readonly string[], now: Date): Result<void, SocialError>` that de-duplicates (preserving first occurrence order), caps to `MAX_FEATURED = 6`, sets state + `updatedAt`, and records a new `ProfileShelfArranged` event. `rehydrate` accepts the new field (treat missing as `[]`).
- `domain/events.ts`: add `ProfileShelfArranged(profileId, memberId, copyIds: readonly string[], at: Date)`.
- `application/use-cases/arrange-shelf.ts`: a use-case mirroring `edit-profile.ts` — loads the member's Profile via the repo, calls `arrangeShelf`, saves, publishes events. Input `{ memberId, copyIds, now }`.
- Tests: `domain/profile.spec.ts` (dedupe, cap-at-6, order preserved, event emitted, empty clears) and `application/use-cases/arrange-shelf.spec.ts` (loads/saves/publishes) — following the existing `.spec.ts` convention and the in-memory profile repository.

### 2. Schema — `packages/backend/convex/schema.ts`

`profiles`: add `featuredCopyIds: v.optional(v.array(v.id("ownedPuzzles")))`. Optional so existing rows validate; absent = uncurated.

### 3. Convex — `packages/backend/convex/identity/`

- A mutation `arrangeShelf({ copyIds })` (auth: current user → their `memberId`): loads each `ownedPuzzles` row, **rejects any copy not owned by the caller**, maps Convex `_id`s to domain CopyId strings, runs the domain use-case via the existing profile repository/mapper, and persists `featuredCopyIds` on the profile row. Mirror the structure of the existing `setProfileVisibility`/`editProfile` mutations.
- A read that resolves the **ordered featured copies** to the same owned-copy view DTO the shelf already consumes: add `featuredShelf({ userId })` returning the curated copies in order, or extend the existing profile read. Resolves each featured `_id` against `ownedPuzzles`, drops any that no longer exist / are no longer owned (defensive), and returns `[]` when uncurated (the web layer applies the recent-6 fallback).
- Tests: `identity/arrangeShelf.test.ts` (ownership rejection, dedupe/cap via domain, persisted order) following the `*.test.ts` convention at the convex root.
- **Codegen:** new functions need `_generated/api.d.ts`. Per project convention, in a worktree the deployment-driven codegen isn't run — **hand-edit `packages/backend/convex/_generated/api.d.ts`** to add the new function signatures so the gateway + web typecheck. (See the [[convex-codegen-needs-deployment]] memory.)

### 4. Gateway — `packages/gateway/src/operations.ts`

Expose `arrangeShelf` (mutation) and `featuredShelf` (query) alongside the existing `library.ownedByOwner` / profile ops, matching the existing operation-wrapping pattern.

### 5. Web — profile shelf + editor

- `apps/web/src/components/profile/shelf-section.tsx`:
  - Read the curated set via the new gateway query; map to `PuzzlePlankBox[]` in curated order. When empty, fall back to `copies.slice(0, 6)` (today's recent-6) so uncurated profiles look identical.
  - Feed the (already 3D from ③) `PuzzlePlank3D`.
  - When the viewer **is the owner**, render an "Arrange shelf" button opening the editor dialog.
- New `apps/web/src/components/profile/arrange-shelf-dialog.tsx`:
  - Lists the owner's owned copies (from `library.ownedByOwner`), each toggleable into the featured set (cap 6, disable further selection at the cap with a hint).
  - Selected items show their position with **Move up / Move down** controls (and remove). Selection/array order = display order.
  - Save → `arrangeShelf({ copyIds })`; optimistic close; Convex reactivity refreshes the shelf.
  - Accessible (buttons, `aria-pressed`, focus management) — no DnD library.

## Components / boundaries

- **`Profile.arrangeShelf` (domain)** — pure: dedupe + cap + order + event. No knowledge of copies' validity (the mutation guards ownership).
- **`arrangeShelf` mutation (convex)** — owns auth + ownership validation + persistence.
- **`featuredShelf` query (convex/gateway)** — resolves ids → ordered view DTOs; defensive against stale ids.
- **`ArrangeShelfDialog` (web)** — owns the editor UX; depends only on `ownedByOwner` + the `arrangeShelf` mutation.
- **profile `shelf-section`** — chooses curated-vs-fallback and renders the plank + (owner-only) editor entry point.

## Testing / verification

- **Domain (TDD, `.spec.ts`):** `profile.spec.ts` arrangeShelf cases; `arrange-shelf.spec.ts` use-case wiring. These run in CI and are fully testable here.
- **Backend (`.test.ts`):** `arrangeShelf.test.ts` ownership-rejection + persistence.
- **Web:** no component tests (convention); the editor's accessible button-based reorder is reasoned, not browser-tested (automation unavailable).
- **Manual/user:** own profile shows "Arrange shelf"; picking + ordering persists and reorders the 3D shelf; other members' profiles show their curated shelf (or recent-6 fallback); the editor caps at 6.

## Out of scope

- The 3D rendering itself (③, done) — ④ only changes _which ordered boxes_ the profile passes to `PuzzlePlank3D`.
- Curating the **dashboard** shelf (the dashboard keeps showing recent owned copies; curation is a profile/identity feature).
- Physics (⑤).

## Risks

- **Codegen in worktree:** the hand-edited `_generated/api.d.ts` must match the real function signatures; a real deploy regenerates it. Flag clearly in the plan.
- **Stale featured ids:** copies can be deleted/transferred after curation; the `featuredShelf` read drops ids that no longer resolve to an owned copy, so the shelf never shows a broken box.
