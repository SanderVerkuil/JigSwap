# Completions: definition + instance tracking, pieces, and duration settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every puzzle completion durably anchored to the puzzle definition (plus an optional live copy link and a frozen copy snapshot), allow logging completions for borrowed copies, add a per-solve "all pieces present" checkbox, and add a per-user "track completion duration" setting with a first-time prompt.

**Architecture:** This is a DDD monorepo. The `@jigswap/domain` package owns the Completion aggregate and use cases (pure, no storage). The `packages/backend` Convex layer adapts the domain to the `completions` table via a mapper + repository, with thin mutation "composition roots." The `apps/web` app calls Convex only through the `@jigswap/gateway` wrapper. `allPiecesPresent` is a genuine domain fact and threads through the aggregate. `copySnapshot` pulls Library-context data the Solving domain deliberately never loads, so it is a **backend-only denormalization** the mutation patches onto the row. `userSettings` is a **plain Convex table + query + mutation with no domain aggregate** — the setting has no invariants and nothing reacts to its change, so a full DDD aggregate (à la `NotificationPreference`) would be ceremony (deliberate YAGNI; flagged for review).

**Tech Stack:** TypeScript, Convex (`convex-test` + Vitest for backend), `@jigswap/domain` (Vitest `.spec.ts`), React + TanStack Router + shadcn/Radix + `use-intl` (web), Nx.

**Two open decisions surfaced for review (resolve before/while executing):**

1. **Settings page location** — this plan adds the "Track completion duration" toggle to the existing user-preferences surface at `apps/web/src/routes/_dashboard/notifications/preferences.tsx` as a new "Solving" section (lowest friction; it is the only existing server-backed preferences page). Alternative: a dedicated `/_dashboard/settings` route (more nav wiring). Task 8 assumes the former.
2. **Borrowed-copy entry point** — confirmed there is none today. Task 12 adds a "Log a solve" action to `apps/web/src/routes/_dashboard/borrowed.tsx`.

---

## File Structure

**Domain (`packages/domain/src/solving/`)** — thread `allPiecesPresent`:

- Modify `domain/completion.ts` — add `allPiecesPresent` to props/state, `start()`, `record()`, `finish()`.
- Modify `application/ports/in/record-completion.port.ts`, `start-completion.port.ts`, `finish-completion.port.ts` — add `allPiecesPresent` to commands.
- Modify `application/use-cases/record-completion.ts`, `start-completion.ts`, `finish-completion.ts` — pass it through.
- Modify `domain/completion.spec.ts` — cover the new field.

**Backend (`packages/backend/convex/`)**:

- Modify `schema.ts` — `completions.allPiecesPresent`, `completions.copySnapshot`, new `userSettings` table.
- Modify `solving/adapters/completionMapper.ts` — carry `allPiecesPresent`; exclude `copySnapshot` from the mapper's row type.
- Modify `solving/recordCompletion.ts` — `allPiecesPresent` arg, owner-or-holder authz, copy-snapshot patch.
- Modify `solving/finishCompletion.ts` — `allPiecesPresent` arg passthrough.
- Create `settings/getMyUserSettings.ts`, `settings/setTrackCompletionDuration.ts`.
- Modify `solvingMutations.test.ts` — borrower-can-log, snapshot, pieces, definition-anchor tests.
- Create `userSettings.test.ts` — settings query/mutation.
- Create `backfillCompletionPuzzleId.ts` — optional internal backfill.

**Gateway (`packages/gateway/src/operations.ts`)** — register the two settings functions; expose `allPiecesPresent` is automatic (args pass through).

**Web (`apps/web/`)**:

- Modify `locales/en.json`, `locales/nl.json`, `locales/source.json` — new i18n keys.
- Create `src/hooks/use-user-settings.ts` — read settings + helpers.
- Modify `src/routes/_dashboard/notifications/preferences.tsx` — duration toggle.
- Modify `src/components/solving/log-solve-dialog.tsx` — pieces checkbox, duration gating, first-time prompt, offer-to-update-copy.
- Modify `src/components/solving/finish-solve-dialog.tsx` — pieces checkbox + duration gating.
- Modify `src/routes/_dashboard/completions.tsx` — render pieces + snapshot, omit duration when absent.
- Modify `src/routes/_dashboard/borrowed.tsx` — "Log a solve" action.

---

## Phase 1 — Domain: thread `allPiecesPresent`

### Task 1: Add `allPiecesPresent` to the Completion aggregate

**Files:**

- Modify: `packages/domain/src/solving/domain/completion.ts`
- Test: `packages/domain/src/solving/domain/completion.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/domain/src/solving/domain/completion.spec.ts` (the file already defines `recordValid`, `ID`, `ALICE`, `START`, `END`, `NOW`):

```typescript
describe("Completion.allPiecesPresent", () => {
  it("defaults to undefined when not provided", () => {
    const result = recordValid();
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.toState().allPiecesPresent).toBeUndefined();
  });

  it("carries allPiecesPresent=false through record()", () => {
    const result = recordValid({ allPiecesPresent: false });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.toState().allPiecesPresent).toBe(false);
  });

  it("carries allPiecesPresent through start()", () => {
    const result = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      now: NOW,
      allPiecesPresent: true,
    });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.toState().allPiecesPresent).toBe(true);
  });

  it("finish() sets allPiecesPresent when provided and leaves it otherwise", () => {
    const started = Completion.start({
      id: ID,
      userId: ALICE,
      startDate: START,
      now: NOW,
    });
    expect(started.isOk).toBe(true);
    if (!started.isOk) return;
    const c = started.value;
    const outcome = c.finish(END, NOW, undefined, true);
    expect(outcome.isOk).toBe(true);
    expect(c.toState().allPiecesPresent).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/domain && npx vitest run src/solving/domain/completion.spec.ts`
Expected: FAIL — `allPiecesPresent` is not a valid prop / `finish` takes 3 args, and `toState().allPiecesPresent` is `undefined`/type error.

- [ ] **Step 3: Add the field to props, state, and the factories**

In `packages/domain/src/solving/domain/completion.ts`:

Add to `StartCompletionProps` (after `photos?`, before `now`):

```typescript
  readonly allPiecesPresent?: boolean;
```

Add to `RecordCompletionProps` (after `review?`, before `now`):

```typescript
  readonly allPiecesPresent?: boolean;
```

Add to `CompletionState` (after `review?`):

```typescript
  readonly allPiecesPresent?: boolean;
```

In `start()`, add to the `new Completion({...})` object (after `notes: props.notes,`):

```typescript
      allPiecesPresent: props.allPiecesPresent,
```

In `record()`, add to the `new Completion({...})` object (after `notes: props.notes,`):

```typescript
      allPiecesPresent: props.allPiecesPresent,
```

Change the `finish` signature and body. Replace:

```typescript
  finish(
    endDate: Date,
    now: Date,
    completionTimeMinutes?: number,
  ): Result<void, SolvingError> {
    if (this.state.isCompleted) return ok(undefined);
```

with:

```typescript
  finish(
    endDate: Date,
    now: Date,
    completionTimeMinutes?: number,
    allPiecesPresent?: boolean,
  ): Result<void, SolvingError> {
    if (this.state.isCompleted) return ok(undefined);
```

and in `finish`, replace the state assignment:

```typescript
this.state = {
  ...this.state,
  endDate,
  completionTimeMinutes: duration.value.minutes,
  isCompleted: true,
  updatedAt: now,
};
```

with:

```typescript
this.state = {
  ...this.state,
  endDate,
  completionTimeMinutes: duration.value.minutes,
  allPiecesPresent: allPiecesPresent ?? this.state.allPiecesPresent,
  isCompleted: true,
  updatedAt: now,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/domain && npx vitest run src/solving/domain/completion.spec.ts`
Expected: PASS (all describe blocks, including the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/solving/domain/completion.ts packages/domain/src/solving/domain/completion.spec.ts
git commit -m "feat(domain): record allPiecesPresent on Completion (start/record/finish)"
```

---

### Task 2: Thread `allPiecesPresent` through the solving use cases

**Files:**

- Modify: `packages/domain/src/solving/application/ports/in/record-completion.port.ts`
- Modify: `packages/domain/src/solving/application/ports/in/start-completion.port.ts`
- Modify: `packages/domain/src/solving/application/ports/in/finish-completion.port.ts`
- Modify: `packages/domain/src/solving/application/use-cases/record-completion.ts`
- Modify: `packages/domain/src/solving/application/use-cases/start-completion.ts`
- Modify: `packages/domain/src/solving/application/use-cases/finish-completion.ts`

- [ ] **Step 1: Add `allPiecesPresent` to the three command types**

In `record-completion.port.ts`, add to `RecordCompletionCommand` (after `reviewText?`):

```typescript
  readonly allPiecesPresent?: boolean;
```

In `start-completion.port.ts`, add to `StartCompletionCommand` (after `photoFileIds?`):

```typescript
  readonly allPiecesPresent?: boolean;
```

In `finish-completion.port.ts`, add to `FinishCompletionCommand` (after `completionTimeMinutes?`):

```typescript
  readonly allPiecesPresent?: boolean;
```

- [ ] **Step 2: Pass it through the use cases**

In `record-completion.ts`, in the `Completion.record({...})` call add (after `photos: ...,`):

```typescript
      allPiecesPresent: cmd.allPiecesPresent,
```

In `start-completion.ts`, in the `Completion.start({...})` call add (after `photos: ...,`):

```typescript
      allPiecesPresent: cmd.allPiecesPresent,
```

In `finish-completion.ts`, replace:

```typescript
const outcome = completion.finish(
  cmd.endDate,
  deps.clock.now(),
  cmd.completionTimeMinutes,
);
```

with:

```typescript
const outcome = completion.finish(
  cmd.endDate,
  deps.clock.now(),
  cmd.completionTimeMinutes,
  cmd.allPiecesPresent,
);
```

- [ ] **Step 3: Verify the domain package type-checks and tests pass**

Run: `cd packages/domain && npx tsc --noEmit && npx vitest run`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/solving/application
git commit -m "feat(domain): thread allPiecesPresent through record/start/finish use cases"
```

---

## Phase 2 — Backend: schema + persistence + mutation

### Task 3: Schema changes — `allPiecesPresent`, `copySnapshot`, `userSettings`

**Files:**

- Modify: `packages/backend/convex/schema.ts`

- [ ] **Step 1: Add the two new columns to the `completions` table**

In `packages/backend/convex/schema.ts`, inside `completions: defineTable({...})`, add after `photos: v.array(v.id("_storage")),`:

```typescript
    // Per-solve record: were all pieces present this time? Optional so legacy rows and
    // "didn't say" stay valid. Set by the domain path (record/finish).
    allPiecesPresent: v.optional(v.boolean()),
    // Denormalized, durable snapshot of the copy at completion time. Library-context data the
    // Solving domain never loads, so it is written by the recordCompletion composition root (not
    // the domain mapper). Survives copy deletion; the live `ownedPuzzleId` link may go stale.
    copySnapshot: v.optional(
      v.object({
        copyId: v.string(), // original Library CopyId aggregateId, kept even after deletion
        ownerId: v.id("users"),
        wasBorrowed: v.boolean(), // true if the logger was not the owner
        condition: v.union(
          v.literal("new_sealed"),
          v.literal("like_new"),
          v.literal("good"),
          v.literal("fair"),
          v.literal("poor"),
        ),
        missingPiecesCount: v.optional(v.number()),
        title: v.optional(v.string()),
        brand: v.optional(v.string()),
        pieceCount: v.optional(v.number()),
      }),
    ),
```

- [ ] **Step 2: Add the `userSettings` table**

In `schema.ts`, add a new table definition (place it next to `notificationPreferences` for locality):

```typescript
  // Per-member app settings (no domain aggregate: no invariants, nothing reacts to changes).
  // `trackCompletionDuration` undefined = never asked → drives the first-time prompt in the UI.
  userSettings: defineTable({
    userId: v.id("users"),
    trackCompletionDuration: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
```

- [ ] **Step 3: Verify the schema compiles (codegen)**

Run: `cd packages/backend && npx convex codegen`
Expected: success, `_generated/dataModel.d.ts` updates with the new columns/table. (In a worktree without a deployment, hand-edit `_generated/` per the project's known constraint — see repo memory "Convex codegen needs deployment".)

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/_generated
git commit -m "feat(backend): completions.allPiecesPresent + copySnapshot, userSettings table"
```

---

### Task 4: Mapper carries `allPiecesPresent`; excludes `copySnapshot`

**Files:**

- Modify: `packages/backend/convex/solving/adapters/completionMapper.ts`

- [ ] **Step 1: Exclude `copySnapshot` from the mapper's row type**

In `completionMapper.ts`, change the `CompletionRow` type. Replace:

```typescript
export type CompletionRow = Omit<
  Doc<"completions">,
  "_id" | "_creationTime" | "puzzleId" | "ownedPuzzleId"
>;
```

with:

```typescript
export type CompletionRow = Omit<
  Doc<"completions">,
  "_id" | "_creationTime" | "puzzleId" | "ownedPuzzleId" | "copySnapshot"
>;
```

(The `copySnapshot` column is written by the recordCompletion composition root, not the domain mapper, so it must not be part of the mapper's payload. `ctx.db.patch` of other fields leaves it intact.)

- [ ] **Step 2: Carry `allPiecesPresent` in both directions**

In `toDomain`, add to the `state` object (after `notes: row.notes,`):

```typescript
    allPiecesPresent: row.allPiecesPresent,
```

In `toRow`, add to the returned object (after `notes: state.notes,`):

```typescript
    allPiecesPresent: state.allPiecesPresent,
```

- [ ] **Step 3: Verify backend type-checks**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: PASS (no type error; `CompletionRow` now satisfies the insert/patch payload).

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/solving/adapters/completionMapper.ts
git commit -m "feat(backend): map allPiecesPresent; keep copySnapshot out of the domain mapper"
```

---

### Task 5: `recordCompletion` — pieces arg, owner-or-holder authz, copy snapshot

**Files:**

- Modify: `packages/backend/convex/solving/recordCompletion.ts`
- Modify: `packages/backend/convex/solving/finishCompletion.ts`
- Test: `packages/backend/convex/solvingMutations.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/backend/convex/solvingMutations.test.ts`, add a helper to seed a borrowed copy and new tests. First, add this helper after the existing `seed` function (it reuses the same shape but lends Alice's copy to Bob):

```typescript
// Lend the seeded copy to Bob: ownership stays with Alice, possession (heldBy) moves to Bob.
const lendToBob = async (
  t: ReturnType<typeof convexTest>,
  ownedPuzzleId: Id<"ownedPuzzles">,
  bob: Id<"users">,
) =>
  t.run(async (ctx) => {
    await ctx.db.patch(ownedPuzzleId, { heldBy: bob });
  });
```

Then add a new describe block:

```typescript
describe("solving.recordCompletion — borrowing, snapshot, pieces", () => {
  test("the current holder (borrower) can log a solve on a copy they do not own", async () => {
    const t = convexTest(schema, modules);
    const { bob, copyAggregateId, ownedPuzzleId } = await seed(t);
    await lendToBob(t, ownedPuzzleId, bob);

    const completionId = (await asBob(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - 2 * HOUR,
        endDate: Date.now() - HOUR,
      },
    )) as string;

    const row = await completionRow(t, completionId);
    expect(row?.userId).toBe(bob);
    expect(row?.ownedPuzzleId).toBe(ownedPuzzleId);
    expect(row?.copySnapshot?.wasBorrowed).toBe(true);
  });

  test("a non-owner who is not the holder is still rejected", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, ownedPuzzleId } = await seed(t);
    await expect(
      asBob(t).mutation(api.solving.recordCompletion.recordCompletion, {
        copyId: copyAggregateId,
        startDate: Date.now() - 2 * HOUR,
        endDate: Date.now() - HOUR,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("completions")
        .withIndex("by_owned_puzzle", (q) =>
          q.eq("ownedPuzzleId", ownedPuzzleId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("an owner's completion gets a copy snapshot and a populated puzzleId anchor", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, puzzleId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId, {
      allPiecesPresent: false,
    });
    const row = await completionRow(t, completionId);
    expect(row?.puzzleId).toBe(puzzleId); // durable definition anchor, derived from the copy
    expect(row?.allPiecesPresent).toBe(false);
    expect(row?.copySnapshot?.wasBorrowed).toBe(false);
    expect(row?.copySnapshot?.condition).toBe("good");
    expect(row?.copySnapshot?.copyId).toBe(copyAggregateId);
  });

  test("deleting the copy keeps puzzleId + snapshot; only the live link is affected", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, puzzleId, ownedPuzzleId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    await t.run(async (ctx) => {
      await ctx.db.delete(ownedPuzzleId);
    });
    const row = await completionRow(t, completionId);
    expect(row?.puzzleId).toBe(puzzleId);
    expect(row?.copySnapshot?.copyId).toBe(copyAggregateId);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && npx vitest run convex/solvingMutations.test.ts`
Expected: FAIL — borrower is rejected (current owner-only rule), `copySnapshot` is undefined, `allPiecesPresent` not accepted.

- [ ] **Step 3: Rewrite the `recordCompletion` handler**

Replace the entire `handler` in `packages/backend/convex/solving/recordCompletion.ts` and add `allPiecesPresent` to `args`. The new file body:

```typescript
import {
  makeRecordCompletion,
  makeStartCompletion,
  type MemberId,
  toCopyId,
  toFileId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { completionIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for logging a solve. Either a copy or a puzzle definition (or both) may be
// referenced; the puzzle definition is always persisted as the durable anchor (resolved from the
// copy when only a copy is given). Logging a copy's solve is allowed for the OWNER or the current
// HOLDER (borrower), so a borrowed copy can be logged; everyone else is rejected. After the use
// case persists, the copy's state is denormalized onto the row as a durable snapshot.
export const recordCompletion = mutation({
  args: {
    puzzleDefinitionId: v.optional(v.string()),
    copyId: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.optional(v.number()),
    completionTimeMinutes: v.optional(v.number()),
    notes: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    allPiecesPresent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireMember(ctx);
    const me = userId as unknown as string;

    // Resolve + authorize the copy once (owner OR current holder); reused for the snapshot.
    let copy: Doc<"ownedPuzzles"> | null = null;
    if (args.copyId !== undefined) {
      copy = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", args.copyId))
        .unique();
      if (!copy) throw new ConvexError("Copy not found");
      const isOwner = copy.ownerId === me;
      const isHolder = copy.heldBy === me;
      if (!isOwner && !isHolder) {
        throw new ConvexError(
          "Only the owner or current holder can log a solve for this copy",
        );
      }
    }

    const puzzleDefinitionId = args.puzzleDefinitionId
      ? toPuzzleDefinitionId(args.puzzleDefinitionId)
      : undefined;
    const copyId = args.copyId ? toCopyId(args.copyId) : undefined;
    const photoFileIds = args.photos?.map((id) => toFileId(id));

    let completionId: string;
    if (args.endDate === undefined) {
      const start = makeStartCompletion({
        completions: convexCompletionRepository(ctx),
        ids: completionIdGenerator,
        events: inProcessEventPublisher(ctx),
        clock: systemClock,
      });
      const result = await start({
        userId: userId as unknown as MemberId,
        puzzleDefinitionId,
        copyId,
        startDate: new Date(args.startDate),
        notes: args.notes,
        photoFileIds,
        allPiecesPresent: args.allPiecesPresent,
      });
      if (result.isErr) throw toConvexError(result.error);
      completionId = result.value as string;
    } else {
      const record = makeRecordCompletion({
        completions: convexCompletionRepository(ctx),
        ids: completionIdGenerator,
        events: inProcessEventPublisher(ctx),
        clock: systemClock,
      });
      const result = await record({
        userId: userId as unknown as MemberId,
        puzzleDefinitionId,
        copyId,
        startDate: new Date(args.startDate),
        endDate: new Date(args.endDate),
        completionTimeMinutes: args.completionTimeMinutes,
        notes: args.notes,
        photoFileIds,
        allPiecesPresent: args.allPiecesPresent,
      });
      if (result.isErr) throw toConvexError(result.error);
      completionId = result.value as string;
    }

    // Denormalize a durable copy snapshot onto the just-written row (same transaction).
    if (copy) {
      const row = await ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
        .unique();
      if (row) {
        await ctx.db.patch(row._id, {
          copySnapshot: {
            copyId: args.copyId as string,
            ownerId: copy.ownerId,
            wasBorrowed: copy.ownerId !== me,
            condition: copy.condition,
            missingPiecesCount: copy.missingPiecesCount,
            title: copy.snapshot?.title,
            brand: copy.snapshot?.brand,
            pieceCount: copy.snapshot?.pieceCount,
          },
        });
      }
    }

    return completionId;
  },
});
```

Note: when only `puzzleDefinitionId` is given (no copy), the use case persists `puzzleId` already (the repository resolves it). When only a `copyId` is given, the domain derives nothing for the definition — so to guarantee the durable anchor, the copy path must also persist `puzzleId`. The repository resolves `puzzleId` from `state.puzzleDefinitionId`; with a copy-only completion that is `undefined`. **Therefore also patch `puzzleId` from the copy** in the snapshot block. Extend the `ctx.db.patch(row._id, {...})` object above to include:

```typescript
// (inside the patch object, alongside copySnapshot)
```

Replace the `await ctx.db.patch(row._id, { copySnapshot: {...} });` call with:

```typescript
await ctx.db.patch(row._id, {
  puzzleId: row.puzzleId ?? copy.puzzleId,
  copySnapshot: {
    copyId: args.copyId as string,
    ownerId: copy.ownerId,
    wasBorrowed: copy.ownerId !== me,
    condition: copy.condition,
    missingPiecesCount: copy.missingPiecesCount,
    title: copy.snapshot?.title,
    brand: copy.snapshot?.brand,
    pieceCount: copy.snapshot?.pieceCount,
  },
});
```

(`copy.puzzleId` is the real `puzzles._id` FK on the ownedPuzzle row, exactly the durable anchor.)

- [ ] **Step 4: Add `allPiecesPresent` to `finishCompletion`**

In `packages/backend/convex/solving/finishCompletion.ts`, add to `args` (after `completionTimeMinutes`):

```typescript
    allPiecesPresent: v.optional(v.boolean()),
```

and add to the `finish({...})` command (after `completionTimeMinutes: args.completionTimeMinutes,`):

```typescript
      allPiecesPresent: args.allPiecesPresent,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/backend && npx vitest run convex/solvingMutations.test.ts`
Expected: PASS — including the existing tests (the owner path and the original "non-owner rejected" test still hold, since a non-holder non-owner is still rejected) and the four new tests.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/solving/recordCompletion.ts packages/backend/convex/solving/finishCompletion.ts packages/backend/convex/solvingMutations.test.ts
git commit -m "feat(backend): borrowed-copy logging, durable puzzleId anchor + copy snapshot, allPiecesPresent"
```

---

## Phase 3 — Backend: userSettings + gateway

### Task 6: `userSettings` query + mutation + gateway registration

**Files:**

- Create: `packages/backend/convex/settings/getMyUserSettings.ts`
- Create: `packages/backend/convex/settings/setTrackCompletionDuration.ts`
- Modify: `packages/gateway/src/operations.ts`
- Test: `packages/backend/convex/userSettings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/convex/userSettings.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUser = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("settings.getMyUserSettings", () => {
  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    await expect(
      t.query(api.settings.getMyUserSettings.getMyUserSettings, {}),
    ).rejects.toThrow("Unauthenticated");
  });

  test("returns undefined trackCompletionDuration before it is ever set", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    const settings = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(settings.trackCompletionDuration).toBeUndefined();
  });
});

describe("settings.setTrackCompletionDuration", () => {
  test("upserts the preference and reads back the value", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    await asAlice(t).mutation(
      api.settings.setTrackCompletionDuration.setTrackCompletionDuration,
      { enabled: true },
    );
    let settings = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(settings.trackCompletionDuration).toBe(true);

    // Setting again patches the same row (no duplicate insert).
    await asAlice(t).mutation(
      api.settings.setTrackCompletionDuration.setTrackCompletionDuration,
      { enabled: false },
    );
    settings = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(settings.trackCompletionDuration).toBe(false);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("userSettings").collect(),
    );
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/backend && npx vitest run convex/userSettings.test.ts`
Expected: FAIL — `api.settings...` does not exist.

- [ ] **Step 3: Create the query**

Create `packages/backend/convex/settings/getMyUserSettings.ts`:

```typescript
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side: the caller's app settings. `trackCompletionDuration` is undefined when the member has
// never answered the first-time prompt — the UI uses that to decide whether to ask. Side-effect
// free: the row is materialised lazily on the first setTrackCompletionDuration.
export const getMyUserSettings = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    const row = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) =>
        q.eq("userId", memberId as unknown as Id<"users">),
      )
      .unique();
    return { trackCompletionDuration: row?.trackCompletionDuration };
  },
});
```

- [ ] **Step 4: Create the mutation**

Create `packages/backend/convex/settings/setTrackCompletionDuration.ts`:

```typescript
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Upsert the caller's "track completion duration" preference. Member-gated; a member can only set
// their own settings (the userId comes from auth, never the client).
export const setTrackCompletionDuration = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;
    const now = Date.now();
    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        trackCompletionDuration: args.enabled,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("userSettings", {
        userId,
        trackCompletionDuration: args.enabled,
        updatedAt: now,
      });
    }
  },
});
```

- [ ] **Step 5: Register both in the gateway**

In `packages/gateway/src/operations.ts`, add a new top-level group (place it after the `solving` group, before `reputation`):

```typescript
  // Per-member app settings (no domain aggregate; member-gated). `mine.trackCompletionDuration`
  // is undefined until first answered, which drives the first-time duration prompt.
  settings: {
    mine: api.settings.getMyUserSettings.getMyUserSettings,
    setTrackDuration:
      api.settings.setTrackCompletionDuration.setTrackCompletionDuration,
  },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/backend && npx convex codegen && npx vitest run convex/userSettings.test.ts`
Expected: PASS (3 tests). Codegen first so `api.settings.*` exists.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/settings packages/backend/convex/userSettings.test.ts packages/backend/convex/_generated packages/gateway/src/operations.ts
git commit -m "feat(backend): userSettings query+mutation for trackCompletionDuration + gateway"
```

---

## Phase 4 — Web UI

### Task 7: i18n keys

**Files:**

- Modify: `apps/web/locales/en.json`
- Modify: `apps/web/locales/nl.json`
- Modify: `apps/web/locales/source.json`

- [ ] **Step 1: Add keys to `solving.logSolve` in each locale**

In `apps/web/locales/en.json`, inside `solving.logSolve` (after `"saveError": ...`):

```json
    "allPiecesPresent": "All pieces were present",
    "trackDurationPromptTitle": "Track how long puzzles take you?",
    "trackDurationPromptBody": "Some solvers like recording solve times; others don't. You can change this anytime in Settings.",
    "trackDurationYes": "Yes, track duration",
    "trackDurationNo": "No, keep it simple",
    "trackDurationTip": "You can change duration tracking anytime in Settings.",
    "updateCopyPiecesTitle": "Update this copy?",
    "updateCopyPiecesBody": "You marked pieces missing. Update this copy's missing-pieces count too?",
    "updateCopyPiecesConfirm": "Update copy",
    "updateCopyPiecesDismiss": "Not now"
```

In `apps/web/locales/nl.json`, inside `solving.logSolve` (Dutch translations):

```json
    "allPiecesPresent": "Alle stukjes waren aanwezig",
    "trackDurationPromptTitle": "Bijhouden hoelang puzzels duren?",
    "trackDurationPromptBody": "Sommige puzzelaars houden hun tijd graag bij, anderen niet. Je kunt dit altijd wijzigen in Instellingen.",
    "trackDurationYes": "Ja, tijd bijhouden",
    "trackDurationNo": "Nee, houd het simpel",
    "trackDurationTip": "Je kunt het bijhouden van tijd altijd wijzigen in Instellingen.",
    "updateCopyPiecesTitle": "Dit exemplaar bijwerken?",
    "updateCopyPiecesBody": "Je gaf aan dat er stukjes ontbreken. Wil je het aantal ontbrekende stukjes van dit exemplaar ook bijwerken?",
    "updateCopyPiecesConfirm": "Exemplaar bijwerken",
    "updateCopyPiecesDismiss": "Niet nu"
```

In `apps/web/locales/source.json`, mirror the English block under `solving.logSolve` (same keys/values as `en.json`).

Also add, in each locale, a settings label under a sensible existing namespace. Add to `solving` (sibling of `logSolve`) a `settings` group. In `en.json` and `source.json`:

```json
    "settings": {
      "sectionTitle": "Solving",
      "trackDurationLabel": "Track completion duration",
      "trackDurationHint": "When on, the solve dialogs ask how long a puzzle took."
    }
```

In `nl.json`:

```json
    "settings": {
      "sectionTitle": "Puzzelen",
      "trackDurationLabel": "Voltooiingstijd bijhouden",
      "trackDurationHint": "Indien aan vragen de dialoogvensters hoelang een puzzel duurde."
    }
```

- [ ] **Step 2: Verify JSON is valid**

Run: `cd apps/web && node -e "require('./locales/en.json');require('./locales/nl.json');require('./locales/source.json');console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/locales
git commit -m "i18n: keys for pieces checkbox, duration prompt, and solving settings"
```

---

### Task 8: User-settings hook + duration toggle on the preferences page

**Files:**

- Create: `apps/web/src/hooks/use-user-settings.ts`
- Modify: `apps/web/src/routes/_dashboard/notifications/preferences.tsx`

- [ ] **Step 1: Create the settings hook**

Create `apps/web/src/hooks/use-user-settings.ts`:

```typescript
import { gateway } from "@/gateway";
import { useMutation, useQuery } from "convex/react";

// Reads the caller's app settings and exposes the duration-tracking preference plus its setter.
// `trackCompletionDuration` is undefined until the member first answers the prompt; the dialogs
// use that to decide whether to ask. `isLoading` guards the initial fetch.
export function useUserSettings() {
  const settings = useQuery(gateway.settings.mine, {});
  const setTrackDuration = useMutation(gateway.settings.setTrackDuration);
  return {
    isLoading: settings === undefined,
    trackCompletionDuration: settings?.trackCompletionDuration,
    setTrackDuration: (enabled: boolean) => setTrackDuration({ enabled }),
  };
}
```

- [ ] **Step 2: Add the toggle section to the preferences page**

In `apps/web/src/routes/_dashboard/notifications/preferences.tsx`, import the pieces:

```typescript
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useTranslations } from "use-intl";
```

Inside the component, read the hook:

```typescript
const ts = useTranslations("solving.settings");
const { trackCompletionDuration, setTrackDuration } = useUserSettings();
```

Render a new section near the existing preferences sections (adapt the surrounding markup to match the page's section styling):

```tsx
<section className="space-y-2">
  <h2 className="text-lg font-semibold">{ts("sectionTitle")}</h2>
  <div className="flex items-center justify-between gap-4">
    <div className="space-y-0.5">
      <Label htmlFor="track-duration">{ts("trackDurationLabel")}</Label>
      <p className="text-muted-foreground text-sm">{ts("trackDurationHint")}</p>
    </div>
    <Switch
      id="track-duration"
      checked={trackCompletionDuration === true}
      onCheckedChange={(checked) => setTrackDuration(checked)}
    />
  </div>
</section>
```

- [ ] **Step 3: Verify the web app type-checks**

Run: `cd apps/web && npx tsc --noEmit` (expect only the known `routeTree.gen` noise per repo memory; no new errors in the edited files).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/use-user-settings.ts apps/web/src/routes/_dashboard/notifications/preferences.tsx
git commit -m "feat(web): user-settings hook + track-completion-duration toggle"
```

---

### Task 9: Log-solve dialog — pieces checkbox, duration gating, first-time prompt, offer-to-update-copy

**Files:**

- Modify: `apps/web/src/components/solving/log-solve-dialog.tsx`

- [ ] **Step 1: Replace the dialog with the extended version**

Rewrite `apps/web/src/components/solving/log-solve-dialog.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateInputToMs(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

interface LogSolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The Library CopyId aggregateId this solve is logged against; the backend resolves it.
  copyId: string;
  puzzleTitle: string;
  // True when the viewer owns this copy: only then do we offer to update the copy's missing-pieces
  // count after a "pieces missing" solve. Borrowed copies (viewer is holder, not owner) skip it.
  viewerIsOwner?: boolean;
}

export function LogSolveDialog({
  open,
  onOpenChange,
  copyId,
  puzzleTitle,
  viewerIsOwner = false,
}: LogSolveDialogProps) {
  const t = useTranslations("solving.logSolve");
  const recordCompletion = useMutation(gateway.solving.recordCompletion);
  const updateDetails = useMutation(gateway.library.updateDetails);
  const { trackCompletionDuration, setTrackDuration } = useUserSettings();

  const [startDate, setStartDate] = useState(todayInputValue);
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [allPiecesPresent, setAllPiecesPresent] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // The duration fields show only when the member opted in. When the preference is still unset
  // (undefined), we ask once before saving rather than hiding the fields silently.
  const showDuration = trackCompletionDuration === true;
  const isFinished = endDate !== "";

  const reset = () => {
    setStartDate(todayInputValue());
    setEndDate("");
    setHours("");
    setMinutes("");
    setNotes("");
    setAllPiecesPresent(true);
  };

  const persist = async () => {
    const start = dateInputToMs(startDate);
    if (start === undefined) return;
    const end = dateInputToMs(endDate);
    const totalMinutes =
      (Number(hours) || 0) * 60 + (Number(minutes) || 0) || undefined;

    setSubmitting(true);
    try {
      await recordCompletion({
        copyId,
        startDate: start,
        endDate: end,
        completionTimeMinutes:
          end === undefined || !showDuration ? undefined : totalMinutes,
        notes: notes.trim() || undefined,
        // Pieces are only a completion fact: send only for a finished solve.
        allPiecesPresent: end === undefined ? undefined : allPiecesPresent,
      });
      toast.success(end === undefined ? t("savedInProgress") : t("saved"));

      // Offer to sync the owned copy's missing-pieces count when pieces were marked missing.
      if (isFinished && !allPiecesPresent && viewerIsOwner) {
        toast(t("updateCopyPiecesTitle"), {
          description: t("updateCopyPiecesBody"),
          action: {
            label: t("updateCopyPiecesConfirm"),
            onClick: () => {
              void updateDetails({ copyId, missingPiecesCount: 1 });
            },
          },
        });
      }

      reset();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to log solve:", error);
      toast.error(t("saveError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    // First-time prompt: if the member has never chosen, ask before the first save and show a tip.
    if (trackCompletionDuration === undefined) {
      // Render a confirm prompt via toast actions; defer the save until they pick.
      toast(t("trackDurationPromptTitle"), {
        description: t("trackDurationPromptBody"),
        action: {
          label: t("trackDurationYes"),
          onClick: async () => {
            await setTrackDuration(true);
            toast.info(t("trackDurationTip"));
            void persist();
          },
        },
        cancel: {
          label: t("trackDurationNo"),
          onClick: async () => {
            await setTrackDuration(false);
            toast.info(t("trackDurationTip"));
            void persist();
          },
        },
      });
      return;
    }
    await persist();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { puzzle: puzzleTitle })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="solve-start">{t("startDate")}</Label>
              <Input
                id="solve-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="solve-end">{t("endDate")}</Label>
              <Input
                id="solve-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("endDateHint")}
              </p>
            </div>
          </div>

          {showDuration && (
            <div className="space-y-2">
              <Label>{t("timeLabel")}</Label>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder={t("hours")}
                  aria-label={t("hours")}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
                <Input
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  placeholder={t("minutes")}
                  aria-label={t("minutes")}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </div>
            </div>
          )}

          {isFinished && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="solve-pieces"
                checked={allPiecesPresent}
                onCheckedChange={(checked) =>
                  setAllPiecesPresent(checked === true)
                }
              />
              <Label htmlFor="solve-pieces">{t("allPiecesPresent")}</Label>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="solve-notes">{t("notes")}</Label>
            <Textarea
              id="solve-notes"
              placeholder={t("notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !startDate}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Pass `viewerIsOwner` from the copy detail page**

In `apps/web/src/routes/_dashboard/copies/$id.tsx`, where `<LogSolveDialog ... />` is rendered inside the `copy.viewerIsOwner` block, add the prop:

```tsx
            viewerIsOwner={copy.viewerIsOwner}
```

- [ ] **Step 3: Verify the web app type-checks**

Run: `cd apps/web && npx tsc --noEmit` (ignore the known routeTree.gen noise; confirm no new errors in the edited files).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/solving/log-solve-dialog.tsx apps/web/src/routes/_dashboard/copies/\$id.tsx
git commit -m "feat(web): pieces checkbox, duration gating, first-time prompt, offer-to-update-copy"
```

---

### Task 10: Finish-solve dialog — pieces checkbox + duration gating

**Files:**

- Modify: `apps/web/src/components/solving/finish-solve-dialog.tsx`

- [ ] **Step 1: Extend the finish dialog**

In `apps/web/src/components/solving/finish-solve-dialog.tsx`, add imports:

```typescript
import { Checkbox } from "@/components/ui/checkbox";
import { useUserSettings } from "@/hooks/use-user-settings";
```

Add state + setting read inside the component (after `const [submitting, setSubmitting] = useState(false);`):

```typescript
const [allPiecesPresent, setAllPiecesPresent] = useState(true);
const { trackCompletionDuration } = useUserSettings();
const showDuration = trackCompletionDuration === true;
```

Change the `finishCompletion` call to send pieces + gate duration. Replace:

```typescript
await finishCompletion({
  completionId,
  endDate: end,
  completionTimeMinutes: totalMinutes,
});
```

with:

```typescript
await finishCompletion({
  completionId,
  endDate: end,
  completionTimeMinutes: showDuration ? totalMinutes : undefined,
  allPiecesPresent,
});
```

Wrap the existing time `<div className="space-y-2">...</div>` block in `{showDuration && ( ... )}`, and add the pieces checkbox after it:

```tsx
<div className="flex items-center gap-2">
  <Checkbox
    id="finish-pieces"
    checked={allPiecesPresent}
    onCheckedChange={(checked) => setAllPiecesPresent(checked === true)}
  />
  <Label htmlFor="finish-pieces">{t("allPiecesPresent")}</Label>
</div>
```

- [ ] **Step 2: Verify type-check**

Run: `cd apps/web && npx tsc --noEmit` (ignore routeTree.gen noise).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/solving/finish-solve-dialog.tsx
git commit -m "feat(web): finish dialog pieces checkbox + duration gating"
```

---

### Task 11: Completions history — render pieces + snapshot, omit duration when absent

**Files:**

- Modify: `apps/web/src/routes/_dashboard/completions.tsx`
- Possibly modify: `packages/backend/convex/solving/listMyCompletions.ts` (only if the new fields aren't surfaced)

- [ ] **Step 1: Confirm the read query surfaces the new fields**

Open `packages/backend/convex/solving/listMyCompletions.ts`. If it maps rows to a hand-built DTO (rather than returning the raw row), add `allPiecesPresent: row.allPiecesPresent` and `copySnapshot: row.copySnapshot` to the returned shape. If it returns the row/`toState()` directly, no change is needed (the columns flow through). Mirror whatever field-mapping style the file already uses.

- [ ] **Step 2: Render the new context in the completions list**

In `apps/web/src/routes/_dashboard/completions.tsx`, within the per-completion row markup:

- Where solve time is rendered, guard it so a completion without a tracked duration omits the time entirely instead of showing 0:

```tsx
{
  completion.completionTimeMinutes ? (
    <span>{/* existing time formatting using completionTimeMinutes */}</span>
  ) : null;
}
```

- Add a small line describing the copy snapshot + pieces, near the title/notes:

```tsx
{
  completion.copySnapshot ? (
    <p className="text-muted-foreground text-xs">
      {completion.copySnapshot.wasBorrowed
        ? t("solvedBorrowedCopy")
        : t("solvedOwnCopy")}
      {completion.allPiecesPresent === false
        ? ` — ${t("piecesMissing")}`
        : completion.allPiecesPresent === true
          ? ` — ${t("piecesComplete")}`
          : ""}
    </p>
  ) : null;
}
```

where `t` is the page's existing `useTranslations("solving.completions")`. Add these keys to all three locale files under `solving.completions`:

```json
    "solvedOwnCopy": "Solved your copy",
    "solvedBorrowedCopy": "Solved a borrowed copy",
    "piecesComplete": "was complete",
    "piecesMissing": "had missing pieces"
```

(Dutch: `"Eigen exemplaar opgelost"`, `"Geleend exemplaar opgelost"`, `"was compleet"`, `"miste stukjes"`.)

- [ ] **Step 3: Verify type-check + JSON**

Run: `cd apps/web && node -e "require('./locales/en.json');require('./locales/nl.json');require('./locales/source.json');console.log('ok')" && npx tsc --noEmit` (ignore routeTree.gen noise).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_dashboard/completions.tsx apps/web/locales packages/backend/convex/solving/listMyCompletions.ts
git commit -m "feat(web): show copy snapshot + pieces, omit untracked duration in completions"
```

---

### Task 12: Borrowed-copy "Log a solve" entry point

**Files:**

- Modify: `apps/web/src/routes/_dashboard/borrowed.tsx`

- [ ] **Step 1: Add a Log-a-solve action per borrowed loan**

In `apps/web/src/routes/_dashboard/borrowed.tsx`, import the dialog and state:

```typescript
import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
import { useState } from "react";
```

Track which borrowed copy's dialog is open (the borrowed loan exposes the copy's aggregateId — use the same id field the "Return" button already keys on; confirm the field name in the file, e.g. `loan.copyId`):

```typescript
const [solveFor, setSolveFor] = useState<{
  copyId: string;
  title: string;
} | null>(null);
```

Next to each loan's existing "Return" button, add:

```tsx
<Button
  variant="outline"
  onClick={() => setSolveFor({ copyId: loan.copyId, title: loan.puzzleTitle })}
>
  {t("logSolve.trigger")}
</Button>
```

(`t` = the page's translations root; `logSolve.trigger` already exists as "Log a solve".) Render the dialog once, outside the list:

```tsx
{
  solveFor && (
    <LogSolveDialog
      open={true}
      onOpenChange={(open) => !open && setSolveFor(null)}
      copyId={solveFor.copyId}
      puzzleTitle={solveFor.title}
      viewerIsOwner={false}
    />
  );
}
```

- [ ] **Step 2: Verify type-check**

Run: `cd apps/web && npx tsc --noEmit` (ignore routeTree.gen noise; confirm the `loan.copyId`/`loan.puzzleTitle` field names match the borrowed query's DTO — adjust to the real names if different).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/_dashboard/borrowed.tsx
git commit -m "feat(web): log a solve from a borrowed copy"
```

---

## Phase 5 — Backfill + verification

### Task 13: Optional internal backfill of `puzzleId` on legacy completions

**Files:**

- Create: `packages/backend/convex/solving/backfillCompletionPuzzleId.ts`

- [ ] **Step 1: Write the internal mutation**

Create `packages/backend/convex/solving/backfillCompletionPuzzleId.ts`:

```typescript
import { internalMutation } from "../_generated/server";

// One-off, idempotent backfill: legacy completions that have a copy link but no puzzleId get the
// durable definition anchor derived from the copy. Rows whose copy was already deleted are skipped.
// Run manually (npx convex run solving/backfillCompletionPuzzleId:run); not part of the feature path.
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("completions").collect();
    let patched = 0;
    for (const row of rows) {
      if (row.puzzleId || !row.ownedPuzzleId) continue;
      const copy = await ctx.db.get(row.ownedPuzzleId);
      if (!copy) continue;
      await ctx.db.patch(row._id, { puzzleId: copy.puzzleId });
      patched += 1;
    }
    return { scanned: rows.length, patched };
  },
});
```

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/backend && npx convex codegen && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/solving/backfillCompletionPuzzleId.ts packages/backend/convex/_generated
git commit -m "chore(backend): optional backfill of puzzleId on legacy completions"
```

---

### Task 14: Full CI-mirror verification

- [ ] **Step 1: Format check (CI runs this first)**

Run: `cd /home/sander/Documenten/Projects/SanderVerkuil/JigSwap && npx prettier --write $(git diff --name-only main...HEAD)`
Then re-commit any reformatting:

```bash
git add -A && git commit -m "style: prettier" || echo "nothing to format"
```

- [ ] **Step 2: Domain tests**

Run: `cd packages/domain && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Backend tests**

Run: `cd packages/backend && npx vitest run`
Expected: PASS (including `solvingMutations.test.ts` and `userSettings.test.ts`).

- [ ] **Step 4: Typecheck the whole repo via Nx, mirroring CI (no Nx cache)**

Run: `cd /home/sander/Documenten/Projects/SanderVerkuil/JigSwap && npx nx run-many -t typecheck lint --skip-nx-cache`
Expected: PASS apart from the known `routeTree.gen` tsc noise documented in repo memory. Investigate any other failure before finishing.

- [ ] **Step 5: Manual smoke (dev server on :3001)**

Per repo memory, browser automation is unavailable but the dev server runs. Start it, then manually verify: first solve log shows the duration prompt → choosing an answer shows the tip; the pieces checkbox appears for finished solves; a borrowed copy now offers "Log a solve"; the completions list omits time when duration is off and shows the snapshot/pieces line.

- [ ] **Step 6: Final commit (if anything pending)**

```bash
git add -A && git commit -m "test: verify completions definition+instance tracking end-to-end" || echo "clean"
```
