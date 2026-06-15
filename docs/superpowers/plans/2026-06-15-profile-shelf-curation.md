# Profile Shelf Curation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Members curate which owned puzzles appear on their profile shelf and in what order; the profile 3D plank renders the curated ordered set (falling back to recent-6 when uncurated), edited via an owner-only "Arrange shelf" dialog.

**Architecture:** Full DDD stack, sequential (each layer depends on the one below), single worktree, one atomic commit per layer. Domain is TDD (`.spec.ts`); backend has a Convex `.test.ts`; the worktree needs a hand-edited `_generated/api.d.ts` (codegen isn't deployed in worktrees). Web adds a curated read + an accessible (no-DnD) reorder dialog.

**Tech Stack:** TypeScript DDD (domain/application/ports), Convex, the gateway operations layer, React/TanStack, Vitest.

**Reference files to READ and MIRROR (do not blindly copy — follow their structure):**

- Domain: `packages/domain/src/social/domain/{profile.ts,events.ts,errors.ts,ids.ts}`, `application/use-cases/{edit-profile.ts,set-profile-visibility.ts}`, `application/ports/in/edit-profile.port.ts`, `application/ports/out/profile.repository.ts`, `application/testing/in-memory-profile.repository.ts`, and the existing `domain/profile.spec.ts` / `application/use-cases/edit-profile.spec.ts`.
- Backend: `packages/backend/convex/identity/` (the `setProfileVisibility` mutation + its profile repository/mapper + `identityQueries`), `packages/backend/convex/identity/setProfileVisibility.test.ts`, `schema.ts` (`profiles`, `ownedPuzzles`), `_generated/api.d.ts`.
- Gateway: `packages/gateway/src/operations.ts` (the `library.ownedByOwner` + profile/identity ops).
- Web: `apps/web/src/components/profile/shelf-section.tsx`, `member-view.tsx` (the `Member` type + whether the viewer is the owner), and an existing dialog under `apps/web/src/components/ui/` for the editor shell.

**Verify** (from repo root unless noted): domain `pnpm --filter @jigswap/domain test` (or `npx vitest run` in `packages/domain`); backend `cd packages/backend && pnpm test`; types `cd apps/web && pnpm type-check` (ignore `routeTree.gen` noise). Browser automation is unavailable — the editor + plank refresh are reasoned, not browser-tested.

---

## Task 1: Domain — `Profile.arrangeShelf` + event + use-case (TDD)

**Files (all under `packages/domain/src/social/`):** modify `domain/profile.ts`, `domain/events.ts`; create `application/ports/in/arrange-shelf.port.ts`, `application/use-cases/arrange-shelf.ts`; add cases to `domain/profile.spec.ts`; create `application/use-cases/arrange-shelf.spec.ts`.

- [ ] **Step 1: Add the event.** In `domain/events.ts`, add (mirroring `ProfileVisibilityChanged`) and append to the `SocialDomainEvent` union:

```ts
// A member re-arranged their profile display shelf (the ordered, curated set of owned copies
// shown on their profile). copyIds is the new ordered list (deduped, capped); empty clears it.
export class ProfileShelfArranged implements DomainEvent {
  readonly name = "ProfileShelfArranged";
  constructor(
    readonly profileId: ProfileId,
    readonly memberId: MemberId,
    readonly copyIds: readonly string[],
    readonly occurredAt: Date,
  ) {}
}
```

- [ ] **Step 2: Write failing domain tests.** Add to `domain/profile.spec.ts` a describe block for `arrangeShelf` (use the existing test setup/helpers in that file to construct a Profile):
  - sets `featuredCopyIds` in the given order and records a `ProfileShelfArranged` event;
  - de-duplicates, preserving first-occurrence order (`["a","b","a"]` → `["a","b"]`);
  - caps at `MAX_FEATURED` (6) — an 8-item input keeps the first 6;
  - empty array clears the shelf (and still records the event);
  - `updatedAt` is set to the passed `now`.
    Run `npx vitest run profile.spec.ts` in `packages/domain` → FAIL (no `arrangeShelf`).

- [ ] **Step 3: Implement in `domain/profile.ts`.** Add `featuredCopyIds: readonly string[]` to `ProfileState`; initialise to `[]` in `create`; treat missing as `[]` in `rehydrate` (`featuredCopyIds: state.featuredCopyIds ?? []`); add a getter; export `const MAX_FEATURED = 6;`. Add the method:

```ts
arrangeShelf(copyIds: readonly string[], now: Date): Result<void, SocialError> {
  const deduped = [...new Set(copyIds)].slice(0, MAX_FEATURED);
  this.state = { ...this.state, featuredCopyIds: deduped, updatedAt: now };
  this.record(
    new ProfileShelfArranged(
      this.state.id,
      this.state.memberId,
      deduped,
      now,
    ),
  );
  return ok(undefined);
}
```

(Import `ProfileShelfArranged`. `[...new Set(...)]` dedupes preserving first-occurrence order. Always succeeds — `Result` shape matches `changeVisibility` for uniform call sites.) Run the spec → PASS.

- [ ] **Step 4: Add the in-port.** Create `application/ports/in/arrange-shelf.port.ts` mirroring `edit-profile.port.ts`:

```ts
import { Result } from "../../../shared-kernel";
import { SocialError } from "../../domain";
import { SocialApplicationError } from "../errors";
import { MemberId } from "../../domain/ids";

export interface ArrangeShelfCommand {
  readonly memberId: MemberId;
  readonly copyIds: readonly string[];
}

export type ArrangeShelf = (
  cmd: ArrangeShelfCommand,
) => Promise<Result<void, SocialError | SocialApplicationError>>;
```

(Match the exact import paths/spelling used by `edit-profile.port.ts` after reading it.)

- [ ] **Step 5: Write the use-case + its failing spec.** Create `application/use-cases/arrange-shelf.ts` mirroring `edit-profile.ts` exactly (load profile via `deps.profiles.findByMember`, `profileNotFound` if absent, call `profile.arrangeShelf(cmd.copyIds, deps.clock.now())`, `save`, `publish(profile.pullEvents())`). Create `arrange-shelf.spec.ts` mirroring `edit-profile.spec.ts` using the in-memory profile repository: asserts the saved profile's `featuredCopyIds` and that a `ProfileShelfArranged` event was published; `profileNotFound` when the member has no profile. Run → PASS.

- [ ] **Step 6: Commit:** `feat(domain): Profile.arrangeShelf + arrange-shelf use-case`.

---

## Task 2: Schema field

**Files:** `packages/backend/convex/schema.ts`.

- [ ] **Step 1:** In the `profiles` table add, after `visibility`:

```ts
    // Ordered, curated set of the member's owned copies featured on their profile shelf
    // (sub-project ④). Optional so existing rows validate; absent/empty = uncurated (recent-6 fallback).
    featuredCopyIds: v.optional(v.array(v.id("ownedPuzzles"))),
```

- [ ] **Step 2:** `cd packages/backend && pnpm type-check` (or repo type-check) — schema compiles.
- [ ] **Step 3: Commit:** `feat(backend): add profiles.featuredCopyIds for shelf curation`.

---

## Task 3: Convex mutation + read + test

**Files:** under `packages/backend/convex/identity/` — a new `arrangeShelf` mutation, a `featuredShelf` query (or extend the existing profile/shelf read), the profile repository/mapper update for `featuredCopyIds`, and `identity/arrangeShelf.test.ts`.

Read `setProfileVisibility` (mutation + how it builds the domain use-case via the convex-backed `ProfileRepository`/mapper) and mirror it.

- [ ] **Step 1:** Update the convex profile repository/mapper (the 1b mapper referenced in `profile.ts`) to read/write `featuredCopyIds` (Convex `Id<"ownedPuzzles">[]` ⇄ domain `string[]`).

- [ ] **Step 2: `arrangeShelf` mutation** — args `{ copyIds: v.array(v.id("ownedPuzzles")) }`; resolve the authed user → `memberId`; load each copy from `ownedPuzzles` and **reject (throw) if any copy's `ownerId` !== the caller**; map `_id`s → domain CopyId strings; run `makeArrangeShelf({ profiles, events, clock })({ memberId, copyIds })`; surface domain errors as thrown ConvexErrors like the existing mutations.

- [ ] **Step 3: `featuredShelf` query** — args `{ userId: v.id("users") }`; load the member's profile; for each `featuredCopyIds` entry in order, resolve the `ownedPuzzles` row, **skipping ids that no longer exist or are no longer owned by `userId`**; project each to the SAME owned-copy view DTO that `library.ownedByOwner` returns (reuse the existing projection helper). Return `[]` when uncurated.

- [ ] **Step 4: Test** `identity/arrangeShelf.test.ts` (mirror `setProfileVisibility.test.ts`, using the convex-test harness): arranging with another user's copy is rejected; arranging with owned copies persists the deduped/capped ordered `featuredCopyIds`; `featuredShelf` returns them in order and drops a deleted copy. Run `cd packages/backend && pnpm test` → PASS.

- [ ] **Step 5: Commit:** `feat(backend): arrangeShelf mutation + featuredShelf query`.

---

## Task 4: Generated API types (worktree codegen)

**Files:** `packages/backend/convex/_generated/api.d.ts`.

Codegen runs on deploy, not in this worktree. Hand-add the new function refs so downstream packages typecheck.

- [ ] **Step 1:** Mirror the existing `identity.setProfileVisibility` / `identity.*` entries in `api.d.ts` to add `identity.arrangeShelf` (mutation) and `identity.featuredShelf` (query) with matching arg/return types. (See [[convex-codegen-needs-deployment]].)
- [ ] **Step 2:** `cd packages/backend && pnpm type-check` clean for the new refs.
- [ ] **Step 3: Commit:** `chore(backend): hand-add generated types for shelf-curation fns`.

---

## Task 5: Gateway operations

**Files:** `packages/gateway/src/operations.ts`.

- [ ] **Step 1:** Expose `arrangeShelf` (mutation) and `featuredShelf` (query) mirroring the existing `library.ownedByOwner` / identity op wrappers (same namespacing + typing pattern).
- [ ] **Step 2:** Repo type-check clean.
- [ ] **Step 3: Commit:** `feat(gateway): expose arrangeShelf + featuredShelf`.

---

## Task 6: Web — curated read + Arrange-shelf editor

**Files:** modify `apps/web/src/components/profile/shelf-section.tsx`; create `apps/web/src/components/profile/arrange-shelf-dialog.tsx`.

- [ ] **Step 1: Curated read + fallback.** In `profile/shelf-section.tsx`, query `featuredShelf({ userId: member._id })`. Build `boxes` from the featured copies in order when non-empty; otherwise fall back to `copies.slice(0, 6)` (current behavior). Keep the existing `useMemo`. Feed `PuzzlePlank3D` (from ③) unchanged.

- [ ] **Step 2: Owner detect + entry point.** Determine whether the viewer is the owner (compare the signed-in user to `member._id` — read `member-view.tsx`/the profile route for how "is own profile" is already expressed; reuse it). When owner, render an "Arrange shelf" `Button` (in the `SectionHead` action slot) that opens `ArrangeShelfDialog`.

- [ ] **Step 3: `ArrangeShelfDialog`.** Build with the existing `ui/dialog`. Props: `{ ownerId, currentFeaturedIds, onClose }`. Loads `library.ownedByOwner({ ownerId })`. State: an ordered `selected: Id<"ownedPuzzles">[]` seeded from `currentFeaturedIds`. UI:
  - A scrollable grid of owned copies; each is a toggle button (`aria-pressed`) — clicking adds (appends) / removes from `selected`. At 6 selected, un-selected toggles are disabled with a "max 6" hint.
  - A "Selected (n/6)" ordered list showing the chosen copies with **Move up / Move down** buttons (disabled at ends) and a Remove button. Array order = display order.
  - Footer: Cancel + Save. Save calls the `arrangeShelf` mutation with `{ copyIds: selected }`, then `onClose()`; Convex reactivity refreshes the shelf.
  - Accessible: real `<button>`s, `aria-pressed`, dialog focus trap from the `ui/dialog` primitive. No drag-and-drop.

- [ ] **Step 4:** `cd apps/web && pnpm type-check` — no errors referencing the two files (ignore `routeTree.gen` noise). `npx prettier --write` the changed/new files.

- [ ] **Step 5: Commit:** `feat(web): curated profile shelf + Arrange-shelf editor`.

---

## Final verification

- [ ] Domain tests pass (`packages/domain`), backend tests pass (`packages/backend`), `apps/web` type-check clean for changed files.
- [ ] Prettier clean across all changed files (CI `format:check`).
- [ ] Manual/user: own profile shows "Arrange shelf"; selecting + ordering up to 6 persists and reorders the 3D shelf; other profiles show curated-or-recent-6; picking another user's copy is impossible (only your own copies are listed) and rejected server-side.

## Self-review notes

- **Spec coverage:** domain (T1) · schema (T2) · convex mutation+read+test (T3) · codegen (T4) · gateway (T5) · web read+editor (T6) — every spec layer mapped.
- **Type consistency:** `featuredCopyIds: readonly string[]` (domain) ⇄ `Id<"ownedPuzzles">[]` (convex/web); `arrangeShelf({ copyIds })` consistent across mutation, gateway, dialog; `MAX_FEATURED = 6` shared via the domain cap (UI enforces the same 6).
- **Risk:** the hand-edited `_generated/api.d.ts` (T4) must match T3's real signatures; a deploy regenerates it. Ownership is enforced server-side (T3 step 2), not just in the UI.
