# Completions: definition + instance tracking, pieces, and duration settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every puzzle completion durably anchored to the puzzle definition (plus an optional live copy link and a frozen copy snapshot), allow logging completions for borrowed copies, add a per-solve "all pieces present" checkbox, and add a domain-owned "track completion duration" preference surfaced through a federated user-settings API, with a secondary-modal first-time prompt.

**Architecture:** DDD / hexagonal monorepo. `@jigswap/domain` owns aggregates + use cases (pure). `packages/backend` adapts them to Convex via mappers + repository ports, with thin mutation "composition roots." `apps/web` calls Convex only through the `@jigswap/gateway` wrapper.

Two cross-cutting design decisions, per review:

1. **`allPiecesPresent`** is a genuine Solving-domain fact → threads through the `Completion` aggregate. **`copySnapshot`** pulls Library-context data the Solving domain deliberately never loads → it is a backend-only denormalization the mutation patches onto the row.
2. **Settings are federated, domain-owned per context** — there is no god "Settings" domain. `trackCompletionDuration` is a **Solving-context** preference (`SolvingPreferences` entity keyed by `memberId`, its own ports/use-cases/table). A thin backend composition root (`settings/getMyUserSettings`) iterates a registry of per-context `MemberSettingsSection` providers to build one read API. Writes belong to the owning context (`solving/setTrackCompletionDuration`). Adding a future setting = model it in its context + register a provider.

**First-time prompt** is a **secondary ShadCN `Dialog`** that opens after the log dialog closes (mounted once via a `DurationPromptProvider` in the dashboard shell so it survives the log dialog unmounting), with room for a GIF pointing at the Settings toggle. All prompts use ShadCN `Dialog` (no `AlertDialog` component exists in this repo); sonner is reserved for non-blocking success toasts.

**Tech Stack:** TypeScript, Convex (`convex-test` + Vitest), `@jigswap/domain` (Vitest `.spec.ts`), React + TanStack Router + shadcn/Radix + `use-intl`, Nx.

---

## File Structure

**Domain (`packages/domain/src/solving/`)**

- Modify `domain/completion.ts`, `application/ports/in/{record,start,finish}-completion.port.ts`, `application/use-cases/{record,start,finish}-completion.ts`, `domain/completion.spec.ts` — thread `allPiecesPresent`.
- Create `domain/solving-preferences.ts` (+ `.spec.ts`), `application/ports/out/solving-preferences.repository.ts`, `application/ports/in/get-solving-preferences.port.ts`, `application/ports/in/set-track-completion-duration.port.ts`, `application/use-cases/get-solving-preferences.ts`, `application/use-cases/set-track-completion-duration.ts`.
- Modify the domain/ports/use-cases barrels.

**Backend (`packages/backend/convex/`)**

- Modify `schema.ts` — `completions.allPiecesPresent`, `completions.copySnapshot`, new `solvingPreferences` table.
- Modify `solving/adapters/completionMapper.ts`, `solving/recordCompletion.ts`, `solving/finishCompletion.ts`.
- Create `solving/adapters/convexSolvingPreferencesRepository.ts`, `solving/adapters/solvingSettingsProvider.ts`, `solving/setTrackCompletionDuration.ts`.
- Create `settings/memberSettingsSection.ts`, `settings/providers.ts`, `settings/getMyUserSettings.ts`.
- Modify `solvingMutations.test.ts`; create `solvingPreferences.test.ts`.
- Create `solving/backfillCompletionPuzzleId.ts`.

**Gateway** — `packages/gateway/src/operations.ts`: add `solving.setTrackCompletionDuration` + `settings.mine`.

**Web (`apps/web/`)**

- Modify `locales/{en,nl,source}.json`.
- Create `src/hooks/use-user-settings.ts`, `src/components/solving/duration-prompt-provider.tsx`.
- Create `public/help/track-duration-setting.gif` (placeholder asset).
- Modify dashboard shell layout (mount the provider), `notifications/preferences.tsx`, `log-solve-dialog.tsx`, `finish-solve-dialog.tsx`, `completions.tsx`, `borrowed.tsx`, `copies/$id.tsx`.

---

## Phase 1 — Domain: thread `allPiecesPresent`

### Task 1: Add `allPiecesPresent` to the Completion aggregate

**Files:**

- Modify: `packages/domain/src/solving/domain/completion.ts`
- Test: `packages/domain/src/solving/domain/completion.spec.ts`

- [ ] **Step 1: Write the failing test** — append to `completion.spec.ts` (it already defines `recordValid`, `ID`, `ALICE`, `START`, `END`, `NOW`):

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
Expected: FAIL — `allPiecesPresent` not a valid prop / `finish` takes 3 args.

- [ ] **Step 3: Add the field to props, state, and the factories** — in `completion.ts`:

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

In `start()`, in the `new Completion({...})` literal (after `notes: props.notes,`):

```typescript
      allPiecesPresent: props.allPiecesPresent,
```

In `record()`, in the `new Completion({...})` literal (after `notes: props.notes,`):

```typescript
      allPiecesPresent: props.allPiecesPresent,
```

Change `finish`. Replace:

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

and replace the finish state assignment:

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
Expected: PASS.

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

- [ ] **Step 1: Add `allPiecesPresent` to the three commands**

`record-completion.port.ts` → `RecordCompletionCommand` (after `reviewText?`):

```typescript
  readonly allPiecesPresent?: boolean;
```

`start-completion.port.ts` → `StartCompletionCommand` (after `photoFileIds?`):

```typescript
  readonly allPiecesPresent?: boolean;
```

`finish-completion.port.ts` → `FinishCompletionCommand` (after `completionTimeMinutes?`):

```typescript
  readonly allPiecesPresent?: boolean;
```

- [ ] **Step 2: Pass it through the use cases**

`record-completion.ts`, in `Completion.record({...})` (after `photos: ...,`):

```typescript
      allPiecesPresent: cmd.allPiecesPresent,
```

`start-completion.ts`, in `Completion.start({...})` (after `photos: ...,`):

```typescript
      allPiecesPresent: cmd.allPiecesPresent,
```

`finish-completion.ts`, replace:

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

- [ ] **Step 3: Verify**

Run: `cd packages/domain && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/solving/application
git commit -m "feat(domain): thread allPiecesPresent through record/start/finish use cases"
```

---

## Phase 2 — Backend: completion persistence + mutation

### Task 3: Schema — `allPiecesPresent` + `copySnapshot` on `completions`

**Files:**

- Modify: `packages/backend/convex/schema.ts`

- [ ] **Step 1: Add the two columns** — inside `completions: defineTable({...})`, after `photos: v.array(v.id("_storage")),`:

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

- [ ] **Step 2: Codegen**

Run: `cd packages/backend && npx convex codegen`
Expected: success. (In a worktree without a deployment, hand-edit `_generated/` per repo memory "Convex codegen needs deployment".)

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/_generated
git commit -m "feat(backend): completions.allPiecesPresent + copySnapshot columns"
```

---

### Task 4: Mapper carries `allPiecesPresent`; excludes `copySnapshot`

**Files:**

- Modify: `packages/backend/convex/solving/adapters/completionMapper.ts`

- [ ] **Step 1: Exclude `copySnapshot` from the mapper row type** — replace:

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

- [ ] **Step 2: Carry `allPiecesPresent`** — in `toDomain`'s `state` (after `notes: row.notes,`):

```typescript
    allPiecesPresent: row.allPiecesPresent,
```

in `toRow`'s returned object (after `notes: state.notes,`):

```typescript
    allPiecesPresent: state.allPiecesPresent,
```

- [ ] **Step 3: Verify** — `cd packages/backend && npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/solving/adapters/completionMapper.ts
git commit -m "feat(backend): map allPiecesPresent; keep copySnapshot out of the domain mapper"
```

---

### Task 5: `recordCompletion` — pieces arg, owner-or-holder authz, copy snapshot + puzzleId anchor

**Files:**

- Modify: `packages/backend/convex/solving/recordCompletion.ts`
- Modify: `packages/backend/convex/solving/finishCompletion.ts`
- Test: `packages/backend/convex/solvingMutations.test.ts`

- [ ] **Step 1: Write the failing tests** — in `solvingMutations.test.ts`, add after `seed`:

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

and a new describe block:

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
    expect(row?.puzzleId).toBe(puzzleId);
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

- [ ] **Step 2: Run to verify failure** — `cd packages/backend && npx vitest run convex/solvingMutations.test.ts`
      Expected: FAIL (borrower rejected, snapshot undefined, `allPiecesPresent` not accepted).

- [ ] **Step 3: Rewrite `recordCompletion.ts`** — full file:

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
// referenced; the puzzle definition is always persisted as the durable anchor (derived from the
// copy when only a copy is given). Logging a copy's solve is allowed for the OWNER or the current
// HOLDER (borrower); everyone else is rejected. After the use case persists, the copy's state is
// denormalized onto the row as a durable snapshot.
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
      if (copy.ownerId !== me && copy.heldBy !== me) {
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

    // Denormalize the durable puzzleId anchor + copy snapshot onto the just-written row.
    if (copy) {
      const row = await ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
        .unique();
      if (row) {
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
      }
    }

    return completionId;
  },
});
```

- [ ] **Step 4: Add `allPiecesPresent` to `finishCompletion.ts`** — add to `args` (after `completionTimeMinutes`):

```typescript
    allPiecesPresent: v.optional(v.boolean()),
```

and to the `finish({...})` command (after `completionTimeMinutes: args.completionTimeMinutes,`):

```typescript
      allPiecesPresent: args.allPiecesPresent,
```

- [ ] **Step 5: Run tests** — `cd packages/backend && npx vitest run convex/solvingMutations.test.ts`
      Expected: PASS (existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/solving/recordCompletion.ts packages/backend/convex/solving/finishCompletion.ts packages/backend/convex/solvingMutations.test.ts
git commit -m "feat(backend): borrowed-copy logging, durable puzzleId anchor + copy snapshot, allPiecesPresent"
```

---

## Phase 3 — Domain: Solving preferences (federated settings, owner context)

### Task 6: `SolvingPreferences` entity

**Files:**

- Create: `packages/domain/src/solving/domain/solving-preferences.ts`
- Create: `packages/domain/src/solving/domain/solving-preferences.spec.ts`
- Modify: `packages/domain/src/solving/domain/index.ts`

- [ ] **Step 1: Write the failing spec** — create `solving-preferences.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { toMemberId } from "../../shared-kernel";
import { SolvingPreferences } from "./solving-preferences";

const ALICE = toMemberId("alice");
const NOW = new Date("2026-06-01T10:00:00Z");
const LATER = new Date("2026-06-02T10:00:00Z");

describe("SolvingPreferences", () => {
  it("createDefault leaves trackCompletionDuration unset (never asked)", () => {
    const prefs = SolvingPreferences.createDefault(ALICE, NOW);
    expect(prefs.memberId).toBe(ALICE);
    expect(prefs.trackCompletionDuration).toBeUndefined();
  });

  it("setTrackCompletionDuration sets the value and bumps updatedAt", () => {
    const prefs = SolvingPreferences.createDefault(ALICE, NOW);
    prefs.setTrackCompletionDuration(true, LATER);
    expect(prefs.trackCompletionDuration).toBe(true);
    expect(prefs.toState().updatedAt).toEqual(LATER);
  });

  it("setting the same value is a no-op (updatedAt unchanged)", () => {
    const prefs = SolvingPreferences.createDefault(ALICE, NOW);
    prefs.setTrackCompletionDuration(false, LATER);
    const firstUpdate = prefs.toState().updatedAt;
    prefs.setTrackCompletionDuration(false, new Date("2026-06-03T10:00:00Z"));
    expect(prefs.toState().updatedAt).toEqual(firstUpdate);
  });

  it("rehydrate round-trips state", () => {
    const state = {
      memberId: ALICE,
      trackCompletionDuration: true,
      updatedAt: NOW,
    };
    const prefs = SolvingPreferences.rehydrate(state);
    expect(prefs.toState()).toEqual(state);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd packages/domain && npx vitest run src/solving/domain/solving-preferences.spec.ts`
      Expected: FAIL — module not found.

- [ ] **Step 3: Create the entity** — `solving-preferences.ts`:

```typescript
import { MemberId } from "./ids";

// A member's Solving-context preferences. Identified by memberId (one per member). Eventless:
// settings carry no domain events that other contexts react to. `trackCompletionDuration`
// undefined means the member has never chosen — the UI uses that to drive the first-time prompt.
export interface SolvingPreferencesState {
  readonly memberId: MemberId;
  readonly trackCompletionDuration?: boolean;
  readonly updatedAt: Date;
}

export class SolvingPreferences {
  private constructor(private state: SolvingPreferencesState) {}

  get memberId(): MemberId {
    return this.state.memberId;
  }

  get trackCompletionDuration(): boolean | undefined {
    return this.state.trackCompletionDuration;
  }

  static createDefault(memberId: MemberId, now: Date): SolvingPreferences {
    return new SolvingPreferences({
      memberId,
      trackCompletionDuration: undefined,
      updatedAt: now,
    });
  }

  setTrackCompletionDuration(enabled: boolean, now: Date): void {
    if (this.state.trackCompletionDuration === enabled) return;
    this.state = {
      ...this.state,
      trackCompletionDuration: enabled,
      updatedAt: now,
    };
  }

  static rehydrate(state: SolvingPreferencesState): SolvingPreferences {
    return new SolvingPreferences(state);
  }

  toState(): SolvingPreferencesState {
    return this.state;
  }
}
```

- [ ] **Step 4: Export it** — in `packages/domain/src/solving/domain/index.ts`, add (keep the list alphabetical-ish):

```typescript
export * from "./solving-preferences";
```

- [ ] **Step 5: Run to verify pass** — `cd packages/domain && npx vitest run src/solving/domain/solving-preferences.spec.ts`
      Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/solving/domain/solving-preferences.ts packages/domain/src/solving/domain/solving-preferences.spec.ts packages/domain/src/solving/domain/index.ts
git commit -m "feat(domain): SolvingPreferences entity (trackCompletionDuration)"
```

---

### Task 7: Solving-preferences ports + use cases

**Files:**

- Create: `packages/domain/src/solving/application/ports/out/solving-preferences.repository.ts`
- Create: `packages/domain/src/solving/application/ports/in/get-solving-preferences.port.ts`
- Create: `packages/domain/src/solving/application/ports/in/set-track-completion-duration.port.ts`
- Create: `packages/domain/src/solving/application/use-cases/get-solving-preferences.ts`
- Create: `packages/domain/src/solving/application/use-cases/set-track-completion-duration.ts`
- Modify: the ports + use-cases barrels (`application/ports/out/index.ts`, `application/ports/in/index.ts`, `application/use-cases/index.ts` — match whatever barrel files exist; if a directory is barrelled via `export *`, add the new lines).

- [ ] **Step 1: Out-port with a segregated reader** — `solving-preferences.repository.ts`:

```typescript
import { MemberId, SolvingPreferences } from "../../../domain";

// Read side of the SolvingPreferences port — used by the federated settings read path, which has
// no write capability (Convex QueryCtx). Interface-segregated from the full repository.
export interface SolvingPreferencesReader {
  findByMember(memberId: MemberId): Promise<SolvingPreferences | null>;
}

export interface SolvingPreferencesRepository extends SolvingPreferencesReader {
  save(preferences: SolvingPreferences): Promise<void>;
}
```

- [ ] **Step 2: In-ports** — `get-solving-preferences.port.ts`:

```typescript
import { MemberId, SolvingPreferences } from "../../../domain";

export interface GetSolvingPreferencesCommand {
  readonly memberId: MemberId;
}

export interface GetSolvingPreferences {
  (cmd: GetSolvingPreferencesCommand): Promise<SolvingPreferences>;
}
```

`set-track-completion-duration.port.ts`:

```typescript
import { MemberId } from "../../../domain";

export interface SetTrackCompletionDurationCommand {
  readonly memberId: MemberId;
  readonly enabled: boolean;
}

export interface SetTrackCompletionDuration {
  (cmd: SetTrackCompletionDurationCommand): Promise<void>;
}
```

- [ ] **Step 3: Use cases** — `get-solving-preferences.ts`:

```typescript
import { Clock } from "../../../shared-kernel";
import { SolvingPreferences } from "../../domain";
import {
  GetSolvingPreferences,
  GetSolvingPreferencesCommand,
} from "../ports/in/get-solving-preferences.port";
import { SolvingPreferencesReader } from "../ports/out/solving-preferences.repository";

export interface GetSolvingPreferencesDeps {
  readonly preferences: SolvingPreferencesReader;
  readonly clock: Clock;
}

// Returns the member's stored preferences, or a fresh default (nothing persisted on read).
export const makeGetSolvingPreferences =
  (deps: GetSolvingPreferencesDeps): GetSolvingPreferences =>
  async (cmd: GetSolvingPreferencesCommand) => {
    const existing = await deps.preferences.findByMember(cmd.memberId);
    return (
      existing ??
      SolvingPreferences.createDefault(cmd.memberId, deps.clock.now())
    );
  };
```

`set-track-completion-duration.ts`:

```typescript
import { Clock } from "../../../shared-kernel";
import { SolvingPreferences } from "../../domain";
import {
  SetTrackCompletionDuration,
  SetTrackCompletionDurationCommand,
} from "../ports/in/set-track-completion-duration.port";
import { SolvingPreferencesRepository } from "../ports/out/solving-preferences.repository";

export interface SetTrackCompletionDurationDeps {
  readonly preferences: SolvingPreferencesRepository;
  readonly clock: Clock;
}

// Upsert the member's duration-tracking choice: load or default, mutate, save.
export const makeSetTrackCompletionDuration =
  (deps: SetTrackCompletionDurationDeps): SetTrackCompletionDuration =>
  async (cmd: SetTrackCompletionDurationCommand) => {
    const now = deps.clock.now();
    const existing = await deps.preferences.findByMember(cmd.memberId);
    const prefs =
      existing ?? SolvingPreferences.createDefault(cmd.memberId, now);
    prefs.setTrackCompletionDuration(cmd.enabled, now);
    await deps.preferences.save(prefs);
  };
```

- [ ] **Step 4: Update barrels** — ensure each new file is re-exported. Open `packages/domain/src/solving/application/ports/out/index.ts`, `.../ports/in/index.ts`, `.../use-cases/index.ts`. If they use explicit `export * from "./x"` lines, add:
  - out/index: `export * from "./solving-preferences.repository";`
  - in/index: `export * from "./get-solving-preferences.port";` and `export * from "./set-track-completion-duration.port";`
  - use-cases/index: `export * from "./get-solving-preferences";` and `export * from "./set-track-completion-duration";`
    (If a barrel instead globs the directory, no edit is needed — confirm by reading the file.)

- [ ] **Step 5: Verify** — `cd packages/domain && npx tsc --noEmit && npx vitest run`
      Expected: PASS, and `makeGetSolvingPreferences` / `makeSetTrackCompletionDuration` / `SolvingPreferencesRepository` are importable from `@jigswap/domain`.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/solving/application
git commit -m "feat(domain): SolvingPreferences ports + get/set use cases"
```

---

## Phase 4 — Backend: solving-prefs persistence + federated settings API

### Task 8: `solvingPreferences` table

**Files:**

- Modify: `packages/backend/convex/schema.ts`

- [ ] **Step 1: Add the table** (next to `notificationPreferences` for locality):

```typescript
  // Solving-context member preferences (federated settings: each context owns its settings).
  // Keyed by member; `trackCompletionDuration` undefined = never asked → first-time prompt.
  solvingPreferences: defineTable({
    memberId: v.id("users"),
    trackCompletionDuration: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_member", ["memberId"]),
```

- [ ] **Step 2: Codegen** — `cd packages/backend && npx convex codegen` → success.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/_generated
git commit -m "feat(backend): solvingPreferences table"
```

---

### Task 9: Solving-preferences repository adapter

**Files:**

- Create: `packages/backend/convex/solving/adapters/convexSolvingPreferencesRepository.ts`

- [ ] **Step 1: Write the adapter** (mirrors `convexNotificationPreferenceRepository`; identity is `memberId`, no aggregateId). It accepts `QueryCtx` for the read path and narrows to `MutationCtx` only for `save`:

```typescript
import {
  type MemberId,
  SolvingPreferences,
  type SolvingPreferencesRepository,
  type SolvingPreferencesState,
  toMemberId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

const toDomain = (row: Doc<"solvingPreferences">): SolvingPreferences => {
  const state: SolvingPreferencesState = {
    memberId: toMemberId(row.memberId as unknown as string),
    trackCompletionDuration: row.trackCompletionDuration,
    updatedAt: new Date(row.updatedAt),
  };
  return SolvingPreferences.rehydrate(state);
};

const findRow = (ctx: QueryCtx, memberId: MemberId) =>
  ctx.db
    .query("solvingPreferences")
    .withIndex("by_member", (q) =>
      q.eq("memberId", memberId as unknown as Id<"users">),
    )
    .unique();

// Read-only adapter: satisfies SolvingPreferencesReader from a Convex QueryCtx (the federated
// settings read path runs in a query and must not write).
export const convexSolvingPreferencesReader = (ctx: QueryCtx) => ({
  async findByMember(memberId: MemberId): Promise<SolvingPreferences | null> {
    const row = await findRow(ctx, memberId);
    return row ? toDomain(row) : null;
  },
});

// Full repository: read + upsert, from a MutationCtx.
export const convexSolvingPreferencesRepository = (
  ctx: MutationCtx,
): SolvingPreferencesRepository => ({
  async findByMember(memberId: MemberId): Promise<SolvingPreferences | null> {
    const row = await findRow(ctx, memberId);
    return row ? toDomain(row) : null;
  },
  async save(preferences: SolvingPreferences): Promise<void> {
    const state = preferences.toState();
    const row = {
      memberId: state.memberId as unknown as Id<"users">,
      trackCompletionDuration: state.trackCompletionDuration,
      updatedAt: state.updatedAt.getTime(),
    };
    const existing = await findRow(ctx, state.memberId);
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("solvingPreferences", row);
  },
});
```

- [ ] **Step 2: Verify** — `cd packages/backend && npx tsc --noEmit` → PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/solving/adapters/convexSolvingPreferencesRepository.ts
git commit -m "feat(backend): Convex SolvingPreferences repository + read-only reader"
```

---

### Task 10: `setTrackCompletionDuration` mutation (owner context) + gateway

**Files:**

- Create: `packages/backend/convex/solving/setTrackCompletionDuration.ts`
- Modify: `packages/gateway/src/operations.ts`

- [ ] **Step 1: Write the composition-root mutation**:

```typescript
import { makeSetTrackCompletionDuration, type MemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexSolvingPreferencesRepository } from "./adapters/convexSolvingPreferencesRepository";
import { systemClock } from "./adapters/systemClock";

// Composition root: the member sets their own duration-tracking preference (member from auth).
export const setTrackCompletionDuration = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    const set = makeSetTrackCompletionDuration({
      preferences: convexSolvingPreferencesRepository(ctx),
      clock: systemClock,
    });
    await set({
      memberId: memberId as unknown as MemberId,
      enabled: args.enabled,
    });
  },
});
```

- [ ] **Step 2: Register in the gateway** — in `operations.ts`, inside the `solving:` group (after `myGoals: ...`):

```typescript
    setTrackCompletionDuration:
      api.solving.setTrackCompletionDuration.setTrackCompletionDuration,
```

- [ ] **Step 3: Codegen + verify** — `cd packages/backend && npx convex codegen && npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/solving/setTrackCompletionDuration.ts packages/backend/convex/_generated packages/gateway/src/operations.ts
git commit -m "feat(backend): solving.setTrackCompletionDuration mutation + gateway"
```

---

### Task 11: Federated settings read endpoint + provider registry + gateway

**Files:**

- Create: `packages/backend/convex/settings/memberSettingsSection.ts`
- Create: `packages/backend/convex/solving/adapters/solvingSettingsProvider.ts`
- Create: `packages/backend/convex/settings/providers.ts`
- Create: `packages/backend/convex/settings/getMyUserSettings.ts`
- Modify: `packages/gateway/src/operations.ts`
- Test: `packages/backend/convex/solvingPreferences.test.ts`

- [ ] **Step 1: Write the failing test** — create `solvingPreferences.test.ts`:

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

  test("returns the solving section with undefined duration before it is set", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    const settings = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(settings.solving.trackCompletionDuration).toBeUndefined();
  });
});

describe("solving.setTrackCompletionDuration", () => {
  test("upserts the preference; the federated read reflects it; one row only", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    await asAlice(t).mutation(
      api.solving.setTrackCompletionDuration.setTrackCompletionDuration,
      { enabled: true },
    );
    let settings = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(settings.solving.trackCompletionDuration).toBe(true);

    await asAlice(t).mutation(
      api.solving.setTrackCompletionDuration.setTrackCompletionDuration,
      { enabled: false },
    );
    settings = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(settings.solving.trackCompletionDuration).toBe(false);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("solvingPreferences").collect(),
    );
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd packages/backend && npx vitest run convex/solvingPreferences.test.ts`
      Expected: FAIL — `api.settings...` not found.

- [ ] **Step 3: Provider contract** — `settings/memberSettingsSection.ts`:

```typescript
import type { MemberId } from "@jigswap/domain";
import type { QueryCtx } from "../_generated/server";

// A bounded context contributes a named slice of a member's settings to the federated read. Each
// context owns its settings domain; this is only the read-composition seam (infrastructure).
export interface MemberSettingsSection {
  readonly section: string;
  read(ctx: QueryCtx, memberId: MemberId): Promise<Record<string, unknown>>;
}
```

- [ ] **Step 4: Solving's provider** — `solving/adapters/solvingSettingsProvider.ts`:

```typescript
import { makeGetSolvingPreferences, type MemberId } from "@jigswap/domain";
import type { QueryCtx } from "../../_generated/server";
import type { MemberSettingsSection } from "../../settings/memberSettingsSection";
import { convexSolvingPreferencesReader } from "./convexSolvingPreferencesRepository";
import { systemClock } from "./systemClock";

// The Solving context's slice of the federated user settings: { trackCompletionDuration }.
export const solvingSettingsSection: MemberSettingsSection = {
  section: "solving",
  async read(ctx: QueryCtx, memberId: MemberId) {
    const get = makeGetSolvingPreferences({
      preferences: convexSolvingPreferencesReader(ctx),
      clock: systemClock,
    });
    const prefs = await get({ memberId });
    return { trackCompletionDuration: prefs.trackCompletionDuration };
  },
};
```

- [ ] **Step 5: Registry** — `settings/providers.ts`:

```typescript
import { solvingSettingsSection } from "../solving/adapters/solvingSettingsProvider";
import type { MemberSettingsSection } from "./memberSettingsSection";

// Every context that owns member settings registers its section here. The read endpoint iterates
// this list — adding a future setting means adding one context provider, no endpoint change.
export const memberSettingsSections: MemberSettingsSection[] = [
  solvingSettingsSection,
];
```

- [ ] **Step 6: Read endpoint** — `settings/getMyUserSettings.ts`:

```typescript
import { toMemberId } from "@jigswap/domain";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { memberSettingsSections } from "./providers";

// Member-gated composition root: builds the member's full settings object by reading every
// registered context section. Shape: { [section]: { ...sectionValues } }. Read-only.
export const getMyUserSettings = query({
  args: {},
  handler: async (ctx) => {
    const memberId = toMemberId(
      (await requireMember(ctx)) as unknown as string,
    );
    const sections = await Promise.all(
      memberSettingsSections.map(async (provider) => [
        provider.section,
        await provider.read(ctx, memberId),
      ]),
    );
    return Object.fromEntries(sections) as {
      solving: { trackCompletionDuration?: boolean };
    };
  },
});
```

- [ ] **Step 7: Register the read in the gateway** — in `operations.ts`, add a new top-level group after `solving`:

```typescript
  // Federated user settings: a read-composition over each context's settings section. Writes are
  // owned by the originating context (e.g. solving.setTrackCompletionDuration).
  settings: {
    mine: api.settings.getMyUserSettings.getMyUserSettings,
  },
```

- [ ] **Step 8: Codegen + run tests** — `cd packages/backend && npx convex codegen && npx vitest run convex/solvingPreferences.test.ts`
      Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/backend/convex/settings packages/backend/convex/solving/adapters/solvingSettingsProvider.ts packages/backend/convex/solvingPreferences.test.ts packages/backend/convex/_generated packages/gateway/src/operations.ts
git commit -m "feat(backend): federated getMyUserSettings + solving settings provider"
```

---

## Phase 5 — Web UI

### Task 12: i18n keys

**Files:**

- Modify: `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json`

- [ ] **Step 1: Add keys under `solving.logSolve`** — in `en.json` and `source.json` (after `"saveError"`):

```json
    "allPiecesPresent": "All pieces were present",
    "updateCopyPiecesTitle": "Update this copy?",
    "updateCopyPiecesBody": "You marked pieces missing. Update this copy's missing-pieces count too?",
    "updateCopyPiecesConfirm": "Update copy",
    "updateCopyPiecesDismiss": "Not now"
```

`nl.json`:

```json
    "allPiecesPresent": "Alle stukjes waren aanwezig",
    "updateCopyPiecesTitle": "Dit exemplaar bijwerken?",
    "updateCopyPiecesBody": "Je gaf aan dat er stukjes ontbreken. Wil je het aantal ontbrekende stukjes van dit exemplaar ook bijwerken?",
    "updateCopyPiecesConfirm": "Exemplaar bijwerken",
    "updateCopyPiecesDismiss": "Niet nu"
```

- [ ] **Step 2: Add a `solving.durationPrompt` group** — `en.json` + `source.json`:

```json
    "durationPrompt": {
      "title": "Track how long puzzles take you?",
      "body": "Some solvers like recording solve times; others prefer to keep it simple. You can change this anytime in Settings.",
      "imageAlt": "Where to change duration tracking in Settings",
      "yes": "Track duration",
      "no": "Keep it simple"
    }
```

`nl.json`:

```json
    "durationPrompt": {
      "title": "Bijhouden hoelang puzzels duren?",
      "body": "Sommige puzzelaars houden hun tijd graag bij, anderen houden het liever simpel. Je kunt dit altijd wijzigen in Instellingen.",
      "imageAlt": "Waar je het bijhouden van tijd wijzigt in Instellingen",
      "yes": "Tijd bijhouden",
      "no": "Houd het simpel"
    }
```

- [ ] **Step 3: Add a `solving.settings` group + completion render keys** — `en.json` + `source.json`, under `solving`:

```json
    "settings": {
      "sectionTitle": "Solving",
      "trackDurationLabel": "Track completion duration",
      "trackDurationHint": "When on, the solve dialogs ask how long a puzzle took."
    }
```

and under `solving.completions`:

```json
    "solvedOwnCopy": "Solved your copy",
    "solvedBorrowedCopy": "Solved a borrowed copy",
    "piecesComplete": "was complete",
    "piecesMissing": "had missing pieces"
```

`nl.json` equivalents: settings → `"Puzzelen"`, `"Voltooiingstijd bijhouden"`, `"Indien aan vragen de dialoogvensters hoelang een puzzel duurde."`; completions → `"Eigen exemplaar opgelost"`, `"Geleend exemplaar opgelost"`, `"was compleet"`, `"miste stukjes"`.

- [ ] **Step 4: Verify JSON** — `cd apps/web && node -e "require('./locales/en.json');require('./locales/nl.json');require('./locales/source.json');console.log('ok')"` → `ok`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/locales
git commit -m "i18n: pieces, duration prompt, solving settings, completion snapshot keys"
```

---

### Task 13: `useUserSettings` hook + preferences toggle

**Files:**

- Create: `apps/web/src/hooks/use-user-settings.ts`
- Modify: `apps/web/src/routes/_dashboard/notifications/preferences.tsx`

- [ ] **Step 1: Create the hook** (reads the federated `settings.mine`, writes via the owner context):

```typescript
import { gateway } from "@/gateway";
import { useMutation, useQuery } from "convex/react";

// Reads the member's federated settings and exposes the solving duration preference + its setter.
// `trackCompletionDuration` is undefined until first chosen; the dialogs use that to decide whether
// to show the secondary first-time prompt. `isLoading` guards the initial fetch.
export function useUserSettings() {
  const settings = useQuery(gateway.settings.mine, {});
  const setTrackDuration = useMutation(
    gateway.solving.setTrackCompletionDuration,
  );
  return {
    isLoading: settings === undefined,
    trackCompletionDuration: settings?.solving.trackCompletionDuration,
    setTrackDuration: (enabled: boolean) => setTrackDuration({ enabled }),
  };
}
```

- [ ] **Step 2: Add the toggle section to the preferences page** — in `preferences.tsx`, add imports:

```typescript
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useTranslations } from "use-intl";
```

Inside the component:

```typescript
const ts = useTranslations("solving.settings");
const { trackCompletionDuration, setTrackDuration } = useUserSettings();
```

Render near the existing sections (adapt wrapper classes to the page style):

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

- [ ] **Step 3: Verify** — `cd apps/web && npx tsc --noEmit` (ignore known routeTree.gen noise).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/use-user-settings.ts apps/web/src/routes/_dashboard/notifications/preferences.tsx
git commit -m "feat(web): useUserSettings hook + track-completion-duration toggle"
```

---

### Task 14: `DurationPromptProvider` (secondary modal) + shell mount + asset

**Files:**

- Create: `apps/web/src/components/solving/duration-prompt-provider.tsx`
- Create: `apps/web/public/help/track-duration-setting.gif` (placeholder)
- Modify: the dashboard shell layout that wraps `_dashboard` routes (the file rendering the authenticated shell; confirm its path, e.g. `apps/web/src/routes/_dashboard.tsx` or `apps/web/src/components/dashboard-layout/*`).

- [ ] **Step 1: Create the provider + context** — `duration-prompt-provider.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUserSettings } from "@/hooks/use-user-settings";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

interface DurationPromptApi {
  // Open the first-time prompt (no-op if the member already chose). Call after a solve is logged.
  requestPrompt: () => void;
}

const DurationPromptContext = createContext<DurationPromptApi | null>(null);

// Mounted once in the dashboard shell so the prompt survives any solve dialog unmounting. It opens
// as a separate modal *after* the log dialog closes, and can show a GIF pointing at the Settings
// toggle.
export function DurationPromptProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("solving.durationPrompt");
  const { trackCompletionDuration, setTrackDuration } = useUserSettings();
  const [open, setOpen] = useState(false);

  const requestPrompt = () => {
    if (trackCompletionDuration === undefined) setOpen(true);
  };

  const choose = async (enabled: boolean) => {
    await setTrackDuration(enabled);
    setOpen(false);
  };

  return (
    <DurationPromptContext.Provider value={{ requestPrompt }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          <img
            src="/help/track-duration-setting.gif"
            alt={t("imageAlt")}
            className="w-full rounded-md border"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => choose(false)}>
              {t("no")}
            </Button>
            <Button onClick={() => choose(true)}>{t("yes")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DurationPromptContext.Provider>
  );
}

// Solve dialogs call requestPrompt() after a first-time save. Safe no-op outside the provider.
export function useDurationPrompt(): DurationPromptApi {
  return useContext(DurationPromptContext) ?? { requestPrompt: () => {} };
}
```

- [ ] **Step 2: Mount it in the dashboard shell** — find the layout that wraps authenticated routes (read `apps/web/src/routes/_dashboard.tsx`; if it renders an `<Outlet />` inside a shell component, wrap that subtree). Wrap the shell content:

```tsx
import { DurationPromptProvider } from "@/components/solving/duration-prompt-provider";
// ...
<DurationPromptProvider>
  {/* existing shell children / <Outlet /> */}
</DurationPromptProvider>;
```

- [ ] **Step 3: Add the placeholder asset** — create the directory and a tiny placeholder so the `<img>` path resolves (replace later with a real GIF/screencast). A 1×1 transparent GIF:

```bash
mkdir -p apps/web/public/help
printf 'GIF89a\1\0\1\0\200\0\0\0\0\0\377\377\377!\371\4\1\0\0\0\0,\0\0\0\0\1\0\1\0\0\2\2D\1\0;' > apps/web/public/help/track-duration-setting.gif
```

(The `onError` handler hides the image gracefully if the asset is ever missing; the real design asset should replace this file.)

- [ ] **Step 4: Verify** — `cd apps/web && npx tsc --noEmit` (ignore routeTree.gen noise).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/solving/duration-prompt-provider.tsx apps/web/public/help/track-duration-setting.gif apps/web/src/routes/_dashboard.tsx
git commit -m "feat(web): DurationPromptProvider secondary modal mounted in the dashboard shell"
```

---

### Task 15: Log-solve dialog — pieces checkbox, duration gating, first-time prompt, copy-update offer

**Files:**

- Modify: `apps/web/src/components/solving/log-solve-dialog.tsx`
- Modify: `apps/web/src/routes/_dashboard/copies/$id.tsx`

- [ ] **Step 1: Rewrite `log-solve-dialog.tsx`**:

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
import { useDurationPrompt } from "@/components/solving/duration-prompt-provider";
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
  copyId: string;
  puzzleTitle: string;
  // True when the viewer owns this copy: only then do we offer to update its missing-pieces count.
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
  const { trackCompletionDuration } = useUserSettings();
  const { requestPrompt } = useDurationPrompt();

  const [startDate, setStartDate] = useState(todayInputValue);
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [allPiecesPresent, setAllPiecesPresent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [offerUpdateCopy, setOfferUpdateCopy] = useState(false);

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

  const handleSubmit = async () => {
    const start = dateInputToMs(startDate);
    if (start === undefined) return;
    const end = dateInputToMs(endDate);
    const totalMinutes =
      (Number(hours) || 0) * 60 + (Number(minutes) || 0) || undefined;
    const wasFirstChoice = trackCompletionDuration === undefined;

    setSubmitting(true);
    try {
      await recordCompletion({
        copyId,
        startDate: start,
        endDate: end,
        completionTimeMinutes:
          end === undefined || !showDuration ? undefined : totalMinutes,
        notes: notes.trim() || undefined,
        allPiecesPresent: end === undefined ? undefined : allPiecesPresent,
      });
      toast.success(end === undefined ? t("savedInProgress") : t("saved"));

      const piecesMissing = end !== undefined && !allPiecesPresent;
      reset();
      onOpenChange(false);

      // After the log dialog closes: ask the first-time duration question (secondary modal), and/or
      // offer to sync the owned copy's missing-pieces count.
      if (wasFirstChoice) requestPrompt();
      if (piecesMissing && viewerIsOwner) setOfferUpdateCopy(true);
    } catch (error) {
      console.error("Failed to log solve:", error);
      toast.error(t("saveError"));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmUpdateCopy = async () => {
    try {
      await updateDetails({ copyId, missingPiecesCount: 1 });
    } finally {
      setOfferUpdateCopy(false);
    }
  };

  return (
    <>
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

      <Dialog open={offerUpdateCopy} onOpenChange={setOfferUpdateCopy}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("updateCopyPiecesTitle")}</DialogTitle>
            <DialogDescription>{t("updateCopyPiecesBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferUpdateCopy(false)}>
              {t("updateCopyPiecesDismiss")}
            </Button>
            <Button onClick={confirmUpdateCopy}>
              {t("updateCopyPiecesConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Pass `viewerIsOwner`** — in `copies/$id.tsx`, where `<LogSolveDialog ... />` renders inside the `copy.viewerIsOwner` block, add:

```tsx
            viewerIsOwner={copy.viewerIsOwner}
```

- [ ] **Step 3: Verify** — `cd apps/web && npx tsc --noEmit` (ignore routeTree.gen noise).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/solving/log-solve-dialog.tsx apps/web/src/routes/_dashboard/copies/\$id.tsx
git commit -m "feat(web): log dialog — pieces, duration gating, first-time prompt, copy-update offer"
```

---

### Task 16: Finish-solve dialog — pieces checkbox + duration gating

**Files:**

- Modify: `apps/web/src/components/solving/finish-solve-dialog.tsx`

- [ ] **Step 1: Extend the dialog** — add imports:

```typescript
import { Checkbox } from "@/components/ui/checkbox";
import { useUserSettings } from "@/hooks/use-user-settings";
```

Add state + setting read (after `const [submitting, setSubmitting] = useState(false);`):

```typescript
const [allPiecesPresent, setAllPiecesPresent] = useState(true);
const { trackCompletionDuration } = useUserSettings();
const showDuration = trackCompletionDuration === true;
```

Replace the `finishCompletion({...})` call:

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

Wrap the existing time block (the `<div className="space-y-2">` containing the `timeLabel` Label and the two number Inputs) in `{showDuration && ( ... )}`, and add the pieces checkbox after it:

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

- [ ] **Step 2: Verify** — `cd apps/web && npx tsc --noEmit` (ignore routeTree.gen noise).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/solving/finish-solve-dialog.tsx
git commit -m "feat(web): finish dialog pieces checkbox + duration gating"
```

---

### Task 17: Completions history — snapshot + pieces, omit untracked duration

**Files:**

- Modify: `apps/web/src/routes/_dashboard/completions.tsx`
- Possibly modify: `packages/backend/convex/solving/listMyCompletions.ts`

- [ ] **Step 1: Ensure the read surfaces the new fields** — open `listMyCompletions.ts`. If it hand-builds a DTO per row, add `allPiecesPresent: row.allPiecesPresent` and `copySnapshot: row.copySnapshot` to the returned shape, matching the file's existing mapping style. If it returns the row directly, no change.

- [ ] **Step 2: Render snapshot + pieces; guard duration** — in `completions.tsx`, in the per-completion row:
      Guard the time so an untracked duration omits it:

```tsx
{
  completion.completionTimeMinutes ? (
    <span>{/* existing time formatting */}</span>
  ) : null;
}
```

Add a snapshot line (`t = useTranslations("solving.completions")`):

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

- [ ] **Step 3: Verify** — `cd apps/web && node -e "require('./locales/en.json')" && npx tsc --noEmit` (ignore routeTree.gen noise).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_dashboard/completions.tsx packages/backend/convex/solving/listMyCompletions.ts
git commit -m "feat(web): show copy snapshot + pieces, omit untracked duration"
```

---

### Task 18: Borrowed-copy "Log a solve" entry point

**Files:**

- Modify: `apps/web/src/routes/_dashboard/borrowed.tsx`

- [ ] **Step 1: Add the action** — import + state:

```typescript
import { LogSolveDialog } from "@/components/solving/log-solve-dialog";
import { useState } from "react";
```

```typescript
const [solveFor, setSolveFor] = useState<{
  copyId: string;
  title: string;
} | null>(null);
```

Next to each loan's existing "Return" button (confirm the loan's copy-id + title field names in the file's DTO — e.g. `loan.copyId`, `loan.puzzleTitle`):

```tsx
<Button
  variant="outline"
  onClick={() => setSolveFor({ copyId: loan.copyId, title: loan.puzzleTitle })}
>
  {t("logSolve.trigger")}
</Button>
```

Render the dialog once, outside the list (`viewerIsOwner={false}` → no copy-update offer):

```tsx
{
  solveFor && (
    <LogSolveDialog
      open={true}
      onOpenChange={(o) => !o && setSolveFor(null)}
      copyId={solveFor.copyId}
      puzzleTitle={solveFor.title}
      viewerIsOwner={false}
    />
  );
}
```

- [ ] **Step 2: Verify** — `cd apps/web && npx tsc --noEmit` (ignore routeTree.gen noise; adjust `loan.copyId`/`loan.puzzleTitle` to the real DTO field names).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/_dashboard/borrowed.tsx
git commit -m "feat(web): log a solve from a borrowed copy"
```

---

## Phase 6 — Backfill + verification

### Task 19: Optional internal backfill of `puzzleId` on legacy completions

**Files:**

- Create: `packages/backend/convex/solving/backfillCompletionPuzzleId.ts`

- [ ] **Step 1: Write the internal mutation**:

```typescript
import { internalMutation } from "../_generated/server";

// One-off, idempotent backfill: legacy completions with a copy link but no puzzleId get the durable
// definition anchor derived from the copy. Rows whose copy was already deleted are skipped. Run
// manually (npx convex run solving/backfillCompletionPuzzleId:run); not part of the feature path.
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

- [ ] **Step 2: Verify** — `cd packages/backend && npx convex codegen && npx tsc --noEmit` → PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/solving/backfillCompletionPuzzleId.ts packages/backend/convex/_generated
git commit -m "chore(backend): optional backfill of puzzleId on legacy completions"
```

---

### Task 20: Full CI-mirror verification

- [ ] **Step 1: Format (CI runs format:check first)**

Run: `cd /home/sander/Documenten/Projects/SanderVerkuil/JigSwap && npx prettier --write $(git diff --name-only main...HEAD)`
Then: `git add -A && git commit -m "style: prettier" || echo "nothing to format"`

- [ ] **Step 2: Domain tests** — `cd packages/domain && npx vitest run` → PASS.

- [ ] **Step 3: Backend tests** — `cd packages/backend && npx vitest run` → PASS (incl. `solvingMutations.test.ts`, `solvingPreferences.test.ts`).

- [ ] **Step 4: Repo typecheck + lint, no Nx cache (mirrors CI)**

Run: `cd /home/sander/Documenten/Projects/SanderVerkuil/JigSwap && npx nx run-many -t typecheck lint --skip-nx-cache`
Expected: PASS apart from the known `routeTree.gen` tsc noise. Investigate any other failure.

- [ ] **Step 5: Manual smoke (dev server :3001)** — browser automation is unavailable per repo memory, but the dev server runs. Verify: first solve log → after the dialog closes the duration prompt modal appears (with the placeholder image/GIF) → choosing sets the preference; the pieces checkbox shows for finished solves; the Settings "Solving" toggle reflects/changes the preference; a borrowed copy offers "Log a solve"; the completions list omits time when duration is off and shows the snapshot/pieces line.

- [ ] **Step 6: Final commit (if pending)**

```bash
git add -A && git commit -m "test: verify completions definition+instance tracking end-to-end" || echo "clean"
```
