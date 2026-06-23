# Completions: definition + instance tracking, pieces, and duration settings

**Date:** 2026-06-23
**Status:** Approved design, pending implementation plan

## Problem

Completions today are effectively **instance-anchored**. `recordCompletion`
(`packages/backend/convex/solving/recordCompletion.ts`) requires a `copyId`, is
**owner-only**, and hangs the completion off the owned copy. Consequences:

- You **cannot** log a completion for a copy borrowed from a friend (owner-only rejects it).
- If the owned copy is deleted, the completion's copy link dangles and there is no
  preserved record of which copy it was or its state.
- Although the `completions` table already has an optional `puzzleId` (definition) column,
  it is not reliably populated or surfaced, so "I completed this puzzle 5 years ago" does
  not durably persist across copy deletion or buying a new copy later.

There is also **no per-user settings storage** (only a separate `notificationPreferences`
table), and **no per-solve record of whether all pieces were present**.

## Goals

1. Track every completion against **both** the puzzle definition (durable anchor) and the
   copy/instance (optional, with a durable snapshot).
2. Allow logging completions for **borrowed** copies (current holder, not just owner).
3. Add a per-solve **"all pieces present"** checkbox; offer to update the owned copy's
   condition when pieces are marked missing.
4. Add a per-user **"track completion duration"** setting so users can simplify completions.
5. The **first time** a user logs a completion, prompt "Do you want to keep track of
   duration?", then show a one-time tip that the setting lives in user settings.

## Non-goals (YAGNI)

- Community-wide "how many people completed this puzzle" aggregation / leaderboards.
- Changing the photo model.
- Any destructive migration. (Optional non-required backfill only.)

## Design

### Section 1 — Data model

**`completions` table** (`packages/backend/convex/schema.ts:304`):

- `puzzleId` — **always populated by new code** (stays `v.optional` in the validator only
  for legacy rows). This is the durable definition anchor.
- `ownedPuzzleId` — stays optional; the **live** copy link, nulls out if the copy is deleted.
- **New** `allPiecesPresent: v.optional(v.boolean())` — per-solve "all pieces there"
  checkbox. Optional so legacy rows and "didn't say" stay valid.
- **New** `copySnapshot: v.optional(v.object({...}))` — frozen copy state captured at
  completion time, surviving copy deletion:
  - `copyId` (original id as a **string**, for reference even after deletion)
  - `ownerId`
  - `wasBorrowed` (true if the logger was not the owner)
  - `condition`
  - `missingPiecesCount`
  - `title`, `brand`, `pieceCount` (so the row still renders if copy/definition titles drift)

Net: each completion has a durable **definition** link (always), an optional **live copy**
link (may null), and a durable **copy snapshot** (survives deletion).

**New `userSettings` table:**

```ts
userSettings: defineTable({
  aggregateId: v.optional(v.string()),
  userId: v.id("users"),
  trackCompletionDuration: v.optional(v.boolean()), // undefined = never asked → first-time prompt
  updatedAt: v.number(),
}).index("by_user", ["userId"]);
```

`trackCompletionDuration` is optional on purpose: `undefined` means the user has never been
asked and is what drives the first-time prompt. After answering it is `true`/`false`.

### Section 2 — Backend functions & authz

**`recordCompletion`** (`packages/backend/convex/solving/recordCompletion.ts`):

- Accepts **either** `copyId` **or** `puzzleDefinitionId` (or both); today it requires `copyId`.
  - With `copyId`: resolve the copy → derive `puzzleId` from `copy.puzzleId`, build the
    `copySnapshot`, set the live `ownedPuzzleId` link.
  - With only `puzzleDefinitionId`: definition-only completion, no copy link, no snapshot.
- **`puzzleId` is always written** (derived from the copy or passed directly).
- **Authz loosens from owner-only to owner-or-current-holder.** A copy reference may be
  attached when the logger is `copy.ownerId` **or** the current holder (`copy.heldBy === me`,
  i.e. an active loan). This unblocks the borrowed-copy case. A definition-only completion
  needs no copy permission — just an authenticated member.
- New arg `allPiecesPresent` flows onto the completion and into the snapshot.

**Copy-condition sync:** the mutation only records the completion. When `allPiecesPresent`
is false, the **UI** offers a follow-up "update this copy's missing-pieces too?" that calls
the existing copy-update mutation. Kept explicit so we never silently mutate a friend's copy;
borrowed copies (holder, not owner) get no offer.

**New settings functions** (new `settings/` folder under convex, or alongside `solving/`):

- `getMyUserSettings` query — returns the row, or `{ trackCompletionDuration: undefined }`
  when none exists.
- `setTrackCompletionDuration` mutation — upserts the row, member-gated.

**Snapshot building** lives in the repository/mapper layer
(`convexCompletionRepository.ts` / `completionMapper.ts`), consistent with the existing FK
resolution pattern: the mutation passes resolved data, the repository persists the snapshot
alongside the row.

### Section 3 — UX flow

**First-time duration prompt** (`apps/web/src/components/solving/log-solve-dialog.tsx`,
`finish-solve-dialog.tsx`):

- Dialog reads `getMyUserSettings`.
- If `trackCompletionDuration === undefined`, the first time the user goes to log a solve a
  prompt appears: **"Do you want to keep track of how long puzzles take you?"** (Yes / No).
- On answer → `setTrackCompletionDuration`, then a one-time tip/toast:
  _"You can change this anytime in Settings."_
- Thereafter duration fields (hours/minutes) are shown when `true`, hidden when `false`.
  The setting governs **only** duration; dates, notes, rating, and the pieces checkbox are
  always available.

**Pieces checkbox:**

- New checkbox **"All pieces were present"**, default **checked**.
- If unchecked **and** the user owns the copy, an inline follow-up offers:
  _"Update this copy's condition to note missing pieces?"_ → existing copy-update mutation.
  Borrowed copies skip the offer.

**Settings page:** a "Track completion duration" toggle in the user settings route (find /
extend the existing one) — the destination the help tip points to.

**Completion history** (`apps/web/src/routes/_dashboard/completions.tsx`):

- Render from durable data: definition title always, plus copy snapshot detail when present
  (_"Solved your copy — was complete"_ / _"Solved a borrowed copy — 2 pieces missing"_).
- Rows without tracked duration omit the time rather than showing blank/zero.

**Borrowing entry point:** confirm during planning whether borrowed copies surface a
"Log solve" action; if not, add one so the borrowed path is reachable.

### Section 4 — Testing & migration

**Migration / backfill:**

- All new fields optional → existing completions keep working, no destructive migration.
- Optional, non-required internal mutation to backfill `puzzleId` on legacy rows that have
  `ownedPuzzleId` but no `puzzleId` (derive from the copy). Rows whose copy is already
  deleted stay as-is.
- No backfill for `userSettings` — absence = "never asked," the correct initial state.

**Testing** (repo conventions: domain `.spec.ts`, backend `.test.ts` at the convex root):

- Domain specs: completion carries `allPiecesPresent` + snapshot; definition link always set;
  completion valid with definition-only (no copy).
- Backend `.test.ts`:
  - owner can log on their copy (snapshot built, `puzzleId` set);
  - current holder (borrower) can log on a held copy they don't own;
  - non-owner/non-holder rejected from attaching that copy;
  - definition-only completion succeeds with no copy;
  - deleting a copy leaves `puzzleId` + snapshot intact and nulls only the live link;
  - `setTrackCompletionDuration` upsert + `getMyUserSettings` default-undefined behavior.
- UI: duration fields hidden when setting is `false`; first-time prompt fires only when
  setting is `undefined`.
