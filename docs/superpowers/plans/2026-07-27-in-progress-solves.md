# In-Progress Solves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First-class "Start puzzle" action, in-progress views (completions page, dashboard), and friend-visible "currently solving" (profile section + activity feed), gated by an off-by-default `shareInProgress` preference.

**Architecture:** Hexagonal — pure domain in `packages/domain`, Convex composition roots/adapters in `packages/backend/convex`, DTOs in `packages/contracts`, single transport chokepoint in `packages/gateway/src/operations.ts`, TanStack Start web app in `apps/web`. The `Completion` aggregate already models start/finish; this feature adds a preference field, one mutation, two reads, feed/profile gating, and UI surfaces. Spec: `docs/superpowers/specs/2026-07-27-in-progress-solves-design.md` (read it first — it encodes review decisions).

**Tech Stack:** Convex, convex-test + Vitest (backend `.test.ts`), Vitest (domain `.spec.ts`), TanStack Router/Query, shadcn/ui, use-intl, sonner.

**Conventions that apply to EVERY task:**

- Run backend tests: `cd packages/backend && npx vitest run <file>` (or `pnpm nx run backend:coverage` for all). Domain: `cd packages/domain && npx vitest run <file>`.
- Before every commit: `pnpm prettier --write <changed files>` (CI runs `format:check` first).
- New Convex function files MUST be registered in `packages/backend/convex/_generated/api.d.ts` by hand (codegen needs a running deployment; hand-edit mirrors existing entries — see Task 3 Step 5 for the exact pattern).
- Locale keys land in ALL THREE files: `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json` (source = English source of truth; keep it identical to en for new keys).
- Never name a backend local `use[A-Z]…` (trips react-hooks lint); use `<verb>UseCase`.
- `pnpm arch:check` enforces: domain imports no convex/react/contracts; web imports gateway only.

---

### Task 1: Domain — `SolvingPreferences.shareInProgress`

**Files:**

- Modify: `packages/domain/src/solving/domain/solving-preferences.ts`
- Create: `packages/domain/src/solving/application/ports/in/set-share-in-progress.port.ts`
- Modify: `packages/domain/src/solving/application/ports/in/index.ts`
- Create: `packages/domain/src/solving/application/use-cases/set-share-in-progress.ts`
- Modify: `packages/domain/src/solving/application/use-cases/index.ts`
- Create: `packages/domain/src/solving/application/testing/in-memory-solving-preferences.repository.ts`
- Modify: `packages/domain/src/solving/application/testing/index.ts`
- Test: `packages/domain/src/solving/application/use-cases/solving-preferences-use-cases.spec.ts` (new)

- [ ] **Step 1: Write the failing spec**

Create `packages/domain/src/solving/application/use-cases/solving-preferences-use-cases.spec.ts`. Before writing the fake, open `packages/domain/src/solving/application/testing/in-memory-completion.repository.ts` and `packages/domain/src/solving/application/ports/out/solving-preferences.repository.ts` to mirror their exact style/signatures (the fake below assumes `findByMember`/`save`; adjust to the port if it differs).

```ts
import { describe, expect, test } from "vitest";
import { toMemberId } from "../../domain";
import { FixedClock } from "../testing/fixed-clock";
import { InMemorySolvingPreferencesRepository } from "../testing/in-memory-solving-preferences.repository";
import { makeSetShareInProgress } from "./set-share-in-progress";

const MEMBER = toMemberId("member-1");

describe("setShareInProgress", () => {
  test("defaults to undefined (never chosen) and persists an explicit true", async () => {
    const preferences = new InMemorySolvingPreferencesRepository();
    const clock = new FixedClock(new Date("2026-07-27T10:00:00Z"));
    const setShareUseCase = makeSetShareInProgress({ preferences, clock });

    expect(await preferences.findByMember(MEMBER)).toBeNull();

    await setShareUseCase({ memberId: MEMBER, enabled: true });
    const prefs = await preferences.findByMember(MEMBER);
    expect(prefs?.shareInProgress).toBe(true);
  });

  test("persists an explicit false (distinct from never-chosen undefined)", async () => {
    const preferences = new InMemorySolvingPreferencesRepository();
    const clock = new FixedClock(new Date("2026-07-27T10:00:00Z"));
    const setShareUseCase = makeSetShareInProgress({ preferences, clock });

    await setShareUseCase({ memberId: MEMBER, enabled: false });
    const prefs = await preferences.findByMember(MEMBER);
    expect(prefs?.shareInProgress).toBe(false);
  });

  test("does not disturb trackCompletionDuration", async () => {
    const preferences = new InMemorySolvingPreferencesRepository();
    const clock = new FixedClock(new Date("2026-07-27T10:00:00Z"));
    const setShareUseCase = makeSetShareInProgress({ preferences, clock });

    await setShareUseCase({ memberId: MEMBER, enabled: true });
    const prefs = await preferences.findByMember(MEMBER);
    expect(prefs?.trackCompletionDuration).toBeUndefined();
  });
});
```

Note: check `packages/domain/src/solving/application/testing/fixed-clock.ts` for whether `FixedClock` is a class or factory (`fixedClock(date)`) and match its real API in the spec.

- [ ] **Step 2: Run the spec to verify it fails**

Run: `cd packages/domain && npx vitest run src/solving/application/use-cases/solving-preferences-use-cases.spec.ts`
Expected: FAIL — `makeSetShareInProgress` / `InMemorySolvingPreferencesRepository` do not exist.

- [ ] **Step 3: Implement**

`packages/domain/src/solving/domain/solving-preferences.ts` — extend state, getter, setter (mirror `setTrackCompletionDuration` exactly):

```ts
export interface SolvingPreferencesState {
  readonly memberId: MemberId;
  readonly trackCompletionDuration?: boolean;
  // undefined = never chosen. Gates the friend-facing in-progress surfaces; every consumer must
  // test `=== true` (absent behaves as off).
  readonly shareInProgress?: boolean;
  readonly updatedAt: Date;
}
```

Add to the class:

```ts
  get shareInProgress(): boolean | undefined {
    return this.state.shareInProgress;
  }

  setShareInProgress(enabled: boolean, now: Date): void {
    if (this.state.shareInProgress === enabled) return;
    this.state = { ...this.state, shareInProgress: enabled, updatedAt: now };
  }
```

In `createDefault`, add `shareInProgress: undefined,` next to `trackCompletionDuration: undefined,`.

`packages/domain/src/solving/application/ports/in/set-share-in-progress.port.ts`:

```ts
import { MemberId } from "../../../domain";

export interface SetShareInProgressCommand {
  readonly memberId: MemberId;
  readonly enabled: boolean;
}

export interface SetShareInProgress {
  (cmd: SetShareInProgressCommand): Promise<void>;
}
```

`packages/domain/src/solving/application/use-cases/set-share-in-progress.ts`:

```ts
import { Clock } from "../../../shared-kernel";
import { SolvingPreferences } from "../../domain";
import {
  SetShareInProgress,
  SetShareInProgressCommand,
} from "../ports/in/set-share-in-progress.port";
import { SolvingPreferencesRepository } from "../ports/out/solving-preferences.repository";

export interface SetShareInProgressDeps {
  readonly preferences: SolvingPreferencesRepository;
  readonly clock: Clock;
}

// Upsert the member's in-progress-sharing choice: load or default, mutate, save.
export const makeSetShareInProgress =
  (deps: SetShareInProgressDeps): SetShareInProgress =>
  async (cmd: SetShareInProgressCommand) => {
    const now = deps.clock.now();
    const existing = await deps.preferences.findByMember(cmd.memberId);
    const prefs =
      existing ?? SolvingPreferences.createDefault(cmd.memberId, now);
    prefs.setShareInProgress(cmd.enabled, now);
    await deps.preferences.save(prefs);
  };
```

`packages/domain/src/solving/application/testing/in-memory-solving-preferences.repository.ts` (match the style of the sibling fakes):

```ts
import { SolvingPreferences } from "../../domain";
import type { MemberId } from "../../domain";
import type { SolvingPreferencesRepository } from "../ports/out/solving-preferences.repository";

export class InMemorySolvingPreferencesRepository implements SolvingPreferencesRepository {
  private rows = new Map<string, SolvingPreferences>();

  async findByMember(memberId: MemberId): Promise<SolvingPreferences | null> {
    return this.rows.get(memberId as unknown as string) ?? null;
  }

  async save(preferences: SolvingPreferences): Promise<void> {
    this.rows.set(preferences.memberId as unknown as string, preferences);
  }
}
```

Add `export * from "./set-share-in-progress.port";` to `ports/in/index.ts`, `export * from "./set-share-in-progress";` to `use-cases/index.ts`, and export the fake from `testing/index.ts`.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `cd packages/domain && npx vitest run src/solving/application/use-cases/solving-preferences-use-cases.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the whole domain suite + commit**

Run: `cd packages/domain && npx vitest run`
Expected: all pass.

```bash
pnpm prettier --write packages/domain/src/solving
git add packages/domain
git commit -m "feat(domain): shareInProgress preference on SolvingPreferences"
```

---

### Task 2: Backend — schema fields, preference plumbing, `setShareInProgress` mutation

**Files:**

- Modify: `packages/backend/convex/schema.ts` (solvingPreferences table ~line 772; completions indexes ~line 412)
- Modify: `packages/backend/convex/solving/adapters/convexSolvingPreferencesRepository.ts`
- Modify: `packages/backend/convex/solving/adapters/solvingSettingsProvider.ts`
- Modify: `packages/backend/convex/settings/getMyUserSettings.ts`
- Create: `packages/backend/convex/solving/setShareInProgress.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts`
- Modify: `packages/gateway/src/operations.ts` (solving block ~line 203)
- Test: `packages/backend/convex/solvingPreferences.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Open `packages/backend/convex/solvingPreferences.test.ts`, mirror its existing seed/identity helpers, and append:

```ts
describe("solving.setShareInProgress", () => {
  test("persists the choice and surfaces it via the federated settings read", async () => {
    const t = convexTest(schema, modules);
    await seed(t); // reuse the file's existing seed helper (adjust name if it differs)

    // Absent row → settings read reports undefined (never chosen).
    const before = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(before.solving.shareInProgress).toBeUndefined();

    await asAlice(t).mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: true },
    );
    const after = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(after.solving.shareInProgress).toBe(true);

    await asAlice(t).mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: false },
    );
    const off = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(off.solving.shareInProgress).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/backend && npx vitest run convex/solvingPreferences.test.ts`
Expected: FAIL — `api.solving.setShareInProgress` does not exist.

- [ ] **Step 3: Implement**

`schema.ts` — in `solvingPreferences` add below `trackCompletionDuration`:

```ts
    // Friend-facing in-progress sharing. undefined = never chosen; every gate tests `=== true`.
    shareInProgress: v.optional(v.boolean()),
```

`schema.ts` — in `completions` add after `.index("by_aggregate_id", ["aggregateId"])`:

```ts
    .index("by_user_completed", ["userId", "isCompleted"]),
```

(keep the chain's final comma placement valid — the last `.index(...)` ends the statement).

`convexSolvingPreferencesRepository.ts` — in `toDomain` add `shareInProgress: row.shareInProgress,` to the state object; in `save` add `shareInProgress: state.shareInProgress,` to the row object.

`solvingSettingsProvider.ts` — return both fields:

```ts
return {
  trackCompletionDuration: prefs.trackCompletionDuration,
  shareInProgress: prefs.shareInProgress,
};
```

`getMyUserSettings.ts` — widen the return cast:

```ts
return Object.fromEntries(sections) as {
  solving: { trackCompletionDuration?: boolean; shareInProgress?: boolean };
};
```

`packages/backend/convex/solving/setShareInProgress.ts`:

```ts
import { makeSetShareInProgress, type MemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexSolvingPreferencesRepository } from "./adapters/convexSolvingPreferencesRepository";
import { systemClock } from "./adapters/systemClock";

// Composition root: the member sets their own in-progress-sharing preference (member from auth).
export const setShareInProgress = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    const setShareUseCase = makeSetShareInProgress({
      preferences: convexSolvingPreferencesRepository(ctx),
      clock: systemClock,
    });
    await setShareUseCase({
      memberId: memberId as unknown as MemberId,
      enabled: args.enabled,
    });
  },
});
```

`_generated/api.d.ts` — add alongside the existing `solving_*` imports (alphabetical position):

```ts
import type * as solving_setShareInProgress from "../solving/setShareInProgress.js";
```

and in the `fullApi` module map (find the `"solving/setTrackCompletionDuration"` entry and mirror it):

```ts
  "solving/setShareInProgress": typeof solving_setShareInProgress;
```

`packages/gateway/src/operations.ts` — in the `solving:` block add:

```ts
    setShareInProgress: api.solving.setShareInProgress.setShareInProgress,
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/backend && npx vitest run convex/solvingPreferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex packages/gateway/src/operations.ts
git add packages/backend packages/gateway
git commit -m "feat(backend): shareInProgress preference + by_user_completed index"
```

---

### Task 3: Backend — shared copy-snapshot helper + `startCompletion` mutation

**Files:**

- Create: `packages/backend/convex/solving/copySnapshot.ts`
- Modify: `packages/backend/convex/solving/recordCompletion.ts:101-122`
- Create: `packages/backend/convex/solving/startCompletion.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts`
- Modify: `packages/gateway/src/operations.ts`
- Test: `packages/backend/convex/solvingMutations.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/convex/solvingMutations.test.ts` (reuse its `seed`, `asAlice`, `asBob`, `lendToBob`, `completionRow`, `HOUR` helpers):

```ts
describe("solving.startCompletion — first-class start", () => {
  test("creates an in-progress row with the copy snapshot and puzzleId denormalized", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, puzzleId } = await seed(t);

    const completionId = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - HOUR,
        notes: "corner pieces first",
      },
    )) as string;

    const row = await completionRow(t, completionId);
    expect(row?.isCompleted).toBe(false);
    expect(row?.endDate).toBeUndefined();
    expect(row?.notes).toBe("corner pieces first");
    // Review blocker: without this denormalization every downstream view is title-less.
    expect(row?.puzzleId).toBe(puzzleId);
    expect(row?.copySnapshot?.title).toBe("Mountain Vista");
    expect(row?.copySnapshot?.wasBorrowed).toBe(false);
  });

  test("accepts backdated and future start dates", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);

    const past = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - 30 * 24 * HOUR },
    )) as string;
    const future = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() + 3 * 24 * HOUR },
    )) as string;
    expect(await completionRow(t, past)).not.toBeNull();
    expect(await completionRow(t, future)).not.toBeNull();
  });

  test("rejects a member who neither owns nor holds the copy", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await expect(
      asBob(t).mutation(api.solving.startCompletion.startCompletion, {
        copyId: copyAggregateId,
        startDate: Date.now(),
      }),
    ).rejects.toThrow();
  });

  test("allows the borrower (current holder) and marks the snapshot borrowed", async () => {
    const t = convexTest(schema, modules);
    const { bob, copyAggregateId, ownedPuzzleId } = await seed(t);
    await lendToBob(t, ownedPuzzleId, bob);

    const completionId = (await asBob(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() },
    )) as string;
    const row = await completionRow(t, completionId);
    expect(row?.copySnapshot?.wasBorrowed).toBe(true);
  });

  test("the started solve can be finished via the existing finish flow", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - 2 * HOUR },
    )) as string;
    await asAlice(t).mutation(api.solving.finishCompletion.finishCompletion, {
      completionId,
      endDate: Date.now(),
    });
    const row = await completionRow(t, completionId);
    expect(row?.isCompleted).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/backend && npx vitest run convex/solvingMutations.test.ts`
Expected: new describe FAILs (`api.solving.startCompletion` missing); pre-existing tests PASS.

- [ ] **Step 3: Implement**

`packages/backend/convex/solving/copySnapshot.ts`:

```ts
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Denormalize the durable puzzleId anchor + copy snapshot onto a just-written completion row.
// Library-context data the Solving domain never loads, so the composition roots (record + start)
// write it after the use case persists. Survives copy deletion; the live ownedPuzzleId may go stale.
export const denormalizeCopyOntoCompletion = async (
  ctx: MutationCtx,
  completionId: string,
  copy: Doc<"ownedPuzzles">,
  copyAggregateId: string,
  loggerId: string,
): Promise<void> => {
  const row = await ctx.db
    .query("completions")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
    .unique();
  if (!row) return;
  await ctx.db.patch(row._id, {
    puzzleId: row.puzzleId ?? copy.puzzleId,
    copySnapshot: {
      copyId: copyAggregateId,
      ownerId: copy.ownerId,
      wasBorrowed: copy.ownerId !== loggerId,
      condition: copy.condition,
      missingPiecesCount: copy.missingPiecesCount,
      title: copy.snapshot?.title,
      brand: copy.snapshot?.brand,
      pieceCount: copy.snapshot?.pieceCount,
    },
  });
};
```

`recordCompletion.ts` — replace the whole `// Denormalize…` block (lines 101-122) with:

```ts
if (copy) {
  await denormalizeCopyOntoCompletion(
    ctx,
    completionId,
    copy,
    args.copyId as string,
    me,
  );
}
```

and add the import: `import { denormalizeCopyOntoCompletion } from "./copySnapshot";`.

**Snapshot-title caveat:** the existing block reads `copy.snapshot?.title` etc. If the seeded test copy has no `snapshot` field, the denormalized `title` is undefined and the first test's `copySnapshot.title` assertion fails. Check what the existing "borrower can log a solve" test asserts about `copySnapshot`; if `ownedPuzzles.snapshot` is not seeded, extend the `seed` helper to insert `snapshot: { title: "Mountain Vista", brand: "Ravensburger", pieceCount: 1000 }` on the ownedPuzzles row (matching the schema's snapshot shape) rather than weakening the assertion.

`packages/backend/convex/solving/startCompletion.ts`:

```ts
import {
  makeStartCompletion,
  type MemberId,
  toCopyId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { completionIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { denormalizeCopyOntoCompletion } from "./copySnapshot";
import { toConvexError } from "./errors";

// Composition root for the first-class "Start puzzle" action: mint an in-progress completion
// against a copy (owner or current holder only), then denormalize the copy snapshot exactly like
// recordCompletion so downstream views have a durable title source. Publishes CompletionStarted.
export const startCompletion = mutation({
  args: {
    copyId: v.string(),
    startDate: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireMember(ctx);
    const me = userId as unknown as string;

    const copy = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", args.copyId))
      .unique();
    if (!copy) throw new ConvexError("Copy not found");
    if (copy.ownerId !== me && copy.heldBy !== me) {
      throw new ConvexError(
        "Only the owner or current holder can log a solve for this copy",
      );
    }

    const startUseCase = makeStartCompletion({
      completions: convexCompletionRepository(ctx),
      ids: completionIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await startUseCase({
      userId: userId as unknown as MemberId,
      puzzleDefinitionId: copy.puzzleDefinitionId
        ? toPuzzleDefinitionId(copy.puzzleDefinitionId)
        : undefined,
      copyId: toCopyId(args.copyId),
      startDate: new Date(args.startDate),
      notes: args.notes,
    });
    if (result.isErr) throw toConvexError(result.error);

    await denormalizeCopyOntoCompletion(
      ctx,
      result.value as string,
      copy,
      args.copyId,
      me,
    );
    return result.value as string;
  },
});
```

`_generated/api.d.ts` — add (alphabetical among `solving_*`):

```ts
import type * as solving_copySnapshot from "../solving/copySnapshot.js";
import type * as solving_startCompletion from "../solving/startCompletion.js";
```

and in the module map:

```ts
  "solving/copySnapshot": typeof solving_copySnapshot;
  "solving/startCompletion": typeof solving_startCompletion;
```

`operations.ts` solving block:

```ts
    startCompletion: api.solving.startCompletion.startCompletion,
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/backend && npx vitest run convex/solvingMutations.test.ts`
Expected: PASS, including all pre-existing tests (the recordCompletion refactor is behavior-preserving).

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex packages/gateway/src/operations.ts
git add packages/backend packages/gateway
git commit -m "feat(backend): first-class startCompletion mutation + shared copy-snapshot helper"
```

---

### Task 4: Contracts `solving` package + `listMyInProgress` query

**Files:**

- Create: `packages/contracts/src/solving/views.ts`
- Create: `packages/contracts/src/solving/index.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/backend/convex/solving/listMyInProgress.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts`
- Modify: `packages/gateway/src/operations.ts`
- Test: `packages/backend/convex/solvingMutations.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `solvingMutations.test.ts`:

```ts
describe("solving.listMyInProgress", () => {
  test("returns only the caller's in-progress solves as DTOs, newest-started first", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);

    // One finished, two in-progress (started at different times).
    await recordForAlice(t, copyAggregateId);
    const older = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - 48 * HOUR },
    )) as string;
    const newer = (await asAlice(t).mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - HOUR },
    )) as string;

    const mine = await asAlice(t).query(
      api.solving.listMyInProgress.listMyInProgress,
      {},
    );
    expect(mine.map((s) => s.completionId)).toEqual([newer, older]);
    expect(mine[0].title).toBe("Mountain Vista");
    expect(mine[0].pieceCount).toBe(1000);
    // The DTO never carries notes/photos/raw rows. (Don't assert the full key list — Convex
    // strips undefined-valued fields like thumbnailUrl in serialization.)
    expect("notes" in mine[0]).toBe(false);
    expect("photos" in mine[0]).toBe(false);
    expect("_id" in mine[0]).toBe(false);

    // Bob sees nothing.
    const bobs = await asBob(t).query(
      api.solving.listMyInProgress.listMyInProgress,
      {},
    );
    expect(bobs).toEqual([]);
  });

  test("survives copy deletion via the snapshot/puzzle fallback chain", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, ownedPuzzleId } = await seed(t);
    await asAlice(t).mutation(api.solving.startCompletion.startCompletion, {
      copyId: copyAggregateId,
      startDate: Date.now(),
    });
    await t.run(async (ctx) => ctx.db.delete(ownedPuzzleId));

    const mine = await asAlice(t).query(
      api.solving.listMyInProgress.listMyInProgress,
      {},
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Mountain Vista"); // from copySnapshot / puzzles fallback
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/backend && npx vitest run convex/solvingMutations.test.ts`
Expected: new describe FAILs (module missing).

- [ ] **Step 3: Implement**

`packages/contracts/src/solving/views.ts`:

```ts
// Solving read-model view DTOs: typed shapes the gateway's `solving:` reads return where the UI
// must not receive raw completion rows (friend-facing or cross-context surfaces).

/**
 * One of the acting member's in-progress solves (dashboard / self surfaces). Excludes notes,
 * photos, and internal row ids by construction — only what the card renders.
 */
export interface InProgressSolveView {
  /** Solving CompletionId aggregateId (used to finish/edit/delete). */
  completionId: string;
  title?: string;
  pieceCount?: number;
  /** Epoch ms; may be in the future (user-editable). */
  startDate: number;
  /** Library CopyId aggregateId from the durable snapshot, when the solve was logged on a copy. */
  copyId?: string;
  /** Catalog box-art URL when the puzzle definition has one. Never a completion photo. */
  thumbnailUrl?: string;
}
```

`packages/contracts/src/solving/index.ts`:

```ts
export * from "./views";
```

`packages/contracts/src/index.ts` — add `export * from "./solving";` (alphabetical among the existing exports).

`packages/backend/convex/solving/listMyInProgress.ts`:

```ts
import type { InProgressSolveView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// The acting member's in-progress solves, newest-started first. Uses the narrow
// (userId, isCompleted) index so the read set is only the in-progress slice — the dashboard
// subscription must not re-run when an old finished solve is edited. Display data resolves
// copySnapshot -> catalog puzzle so rows survive copy deletion. Rows lacking an aggregateId
// (legacy) are dropped: the UI cannot finish them.
export const listMyInProgress = query({
  args: {},
  handler: async (ctx): Promise<InProgressSolveView[]> => {
    const memberId = await requireMember(ctx);
    const rows = await ctx.db
      .query("completions")
      .withIndex("by_user_completed", (q) =>
        q
          .eq("userId", memberId as unknown as Id<"users">)
          .eq("isCompleted", false),
      )
      .collect();

    const withIds = rows.filter((row) => row.aggregateId !== undefined);
    withIds.sort((a, b) => b.startDate - a.startDate);

    return Promise.all(
      withIds.map(async (row) => {
        let title = row.copySnapshot?.title;
        let pieceCount = row.copySnapshot?.pieceCount;
        let thumbnailUrl: string | undefined;
        const puzzle = row.puzzleId ? await ctx.db.get(row.puzzleId) : null;
        if (puzzle) {
          title ??= puzzle.title;
          pieceCount ??= puzzle.pieceCount;
          if (puzzle.image) {
            thumbnailUrl =
              (await ctx.storage.getUrl(puzzle.image)) ?? undefined;
          }
        }
        return {
          completionId: row.aggregateId as string,
          title,
          pieceCount,
          startDate: row.startDate,
          copyId: row.copySnapshot?.copyId,
          thumbnailUrl,
        };
      }),
    );
  },
});
```

(Check the `puzzles` schema for the box-art field name — the plan assumes `image: v.optional(v.id("_storage"))`; if it differs, e.g. `imageId`, use the real name.)

`_generated/api.d.ts`:

```ts
import type * as solving_listMyInProgress from "../solving/listMyInProgress.js";
```

```ts
  "solving/listMyInProgress": typeof solving_listMyInProgress;
```

`operations.ts` solving block:

```ts
    myInProgress: api.solving.listMyInProgress.listMyInProgress,
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/backend && npx vitest run convex/solvingMutations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex packages/contracts/src packages/gateway/src/operations.ts
git add packages/backend packages/contracts packages/gateway
git commit -m "feat: contracts/solving DTOs + listMyInProgress read"
```

---

### Task 5: Profile `currentlySolving` (friends-only gate)

**Files:**

- Modify: `packages/contracts/src/social/social.ts` (PublicProfileView ~line 183)
- Modify: `packages/backend/convex/social/getPublicProfile.ts`
- Test: `packages/backend/convex/publicProfile.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Open `packages/backend/convex/publicProfile.test.ts` and mirror its existing seed/follow helpers (it already tests locked/unlocked and mutual-follow cases — reuse those helpers verbatim; the snippets below name them generically). Append a describe implementing this exact gating matrix (one test per row):

| viewer                                   | target profile | shareInProgress       | expected `currentlySolving`                          |
| ---------------------------------------- | -------------- | --------------------- | ---------------------------------------------------- |
| anonymous (no identity)                  | public         | true                  | **absent/undefined**                                 |
| authenticated non-follower               | public         | true                  | absent                                               |
| mutual follower                          | public/private | true                  | **present** with items                               |
| mutual follower                          | public         | false or absent row   | absent                                               |
| self                                     | any            | absent (never chosen) | **present** (self always sees)                       |
| mutual follower, future-dated start only | public         | true                  | present but **empty array** (future starts excluded) |

Test skeleton (adapt helper names to the file's own):

```ts
describe("getPublicProfile — currentlySolving gating", () => {
  test("anonymous viewer on a public profile never sees currentlySolving even when sharing is on", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await asAlice(t).mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: true },
    );
    await asAlice(t).mutation(api.solving.startCompletion.startCompletion, {
      copyId: copyAggregateId,
      startDate: Date.now() - HOUR,
    });

    const view = await t.query(api.social.getPublicProfile.getPublicProfile, {
      handle: aliceHandle, // resolve the same way the file's existing tests do
    });
    expect(view?.locked).toBe(false); // public profile unlocks
    expect(
      view && "currentlySolving" in view ? view.currentlySolving : undefined,
    ).toBeUndefined();
  });

  test("mutual follower sees currentlySolving when sharing is on", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, copyAggregateId } = await seed(t);
    await makeMutualFollowers(t, alice, bob); // reuse/create via direct db inserts into `follows`
    await asAlice(t).mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: true },
    );
    await asAlice(t).mutation(api.solving.startCompletion.startCompletion, {
      copyId: copyAggregateId,
      startDate: Date.now() - HOUR,
    });

    const view = await asBob(t).query(
      api.social.getPublicProfile.getPublicProfile,
      {
        handle: aliceHandle,
      },
    );
    expect(view?.locked).toBe(false);
    const solving =
      view && "currentlySolving" in view ? view.currentlySolving : undefined;
    expect(solving).toHaveLength(1);
    expect(solving?.[0].title).toBe("Mountain Vista");
    // Field exclusion (review blocker F5): no notes/photos/ids ever leave the server. (Assert via
    // `in`, not a full key list — Convex strips undefined-valued fields like thumbnailUrl.)
    expect("notes" in solving![0]).toBe(false);
    expect("photos" in solving![0]).toBe(false);
    expect("copyId" in solving![0]).toBe(false);
    expect("completionId" in solving![0]).toBe(false);
  });

  // ...remaining matrix rows follow the same pattern:
  // - mutual follower + sharing off/absent -> undefined
  // - self + sharing absent -> present
  // - mutual follower + only a future-dated start -> present, []
  // - authenticated non-follower on public profile + sharing on -> undefined
});
```

If `makeMutualFollowers` does not already exist in the file, add it:

```ts
const makeMutualFollowers = (
  t: ReturnType<typeof convexTest>,
  a: Id<"users">,
  b: Id<"users">,
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("follows", {
      followerId: a,
      followeeId: b,
      createdAt: now,
    });
    await ctx.db.insert("follows", {
      followerId: b,
      followeeId: a,
      createdAt: now,
    });
  });
```

(check the `follows` table's exact required fields in `schema.ts:891` and match them).

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/backend && npx vitest run convex/publicProfile.test.ts`
Expected: new tests FAIL (`currentlySolving` never present).

- [ ] **Step 3: Implement**

`packages/contracts/src/social/social.ts` — add above `PublicProfileView`:

```ts
/**
 * One in-progress solve on the profile's "Currently solving" section. STRICTER gate than
 * `unlocked`: only self, or a mutual follower of a member whose `shareInProgress` preference is
 * explicitly true, ever receives this (anonymous viewers never do — getPublicProfile is
 * unauthenticated and profiles default public). Deliberately excludes notes, photos, and
 * copy/completion ids; `thumbnailUrl` is catalog box art, never a completion photo.
 */
export interface CurrentlySolvingItemView {
  title?: string;
  pieceCount?: number;
  /** startDate, epoch ms. Future-dated starts are excluded server-side. */
  startedAt: number;
  thumbnailUrl?: string;
}
```

and extend the unlocked arm of `PublicProfileView`:

```ts
      stats: PublicProfileStats;
      records: PublicProfileRecords;
      /** See CurrentlySolvingItemView — friends-only + opt-in; absent when the gate fails. */
      currentlySolving?: CurrentlySolvingItemView[];
```

`packages/backend/convex/social/getPublicProfile.ts` — import the type, and insert before the final `return`:

```ts
// "Currently solving" — deliberately NARROWER than `unlocked`: this read is unauthenticated
// and profiles default to public, so riding `unlocked` would expose real-time solving to
// anonymous visitors. Gate: self always; otherwise mutual follower AND the member's explicit
// opt-in (`shareInProgress === true`; tri-state, absent = off). Small indexed read (not the
// .take(2000) scan above, which takes the OLDEST rows and could miss new starts).
let currentlySolving: CurrentlySolvingItemView[] | undefined;
if (isSelf || isMutual) {
  const prefs = await ctx.db
    .query("solvingPreferences")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .unique();
  if (isSelf || prefs?.shareInProgress === true) {
    const now = Date.now();
    const inProgress = await ctx.db
      .query("completions")
      .withIndex("by_user_completed", (q) =>
        q.eq("userId", memberId).eq("isCompleted", false),
      )
      .collect();
    const shown = inProgress
      .filter((c) => c.startDate <= now)
      .sort((a, b) => b.startDate - a.startDate)
      .slice(0, 10);
    currentlySolving = await Promise.all(
      shown.map(async (c) => {
        let title = c.copySnapshot?.title;
        let pieceCount = c.copySnapshot?.pieceCount;
        let thumbnailUrl: string | undefined;
        const puzzle = c.puzzleId ? await ctx.db.get(c.puzzleId) : null;
        if (puzzle) {
          title ??= puzzle.title;
          pieceCount ??= puzzle.pieceCount;
          if (puzzle.image) {
            thumbnailUrl =
              (await ctx.storage.getUrl(puzzle.image)) ?? undefined;
          }
        }
        return { title, pieceCount, startedAt: c.startDate, thumbnailUrl };
      }),
    );
  }
}
```

and add `currentlySolving,` to the unlocked return object.

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/backend && npx vitest run convex/publicProfile.test.ts`
Expected: PASS (all matrix rows + pre-existing tests).

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex packages/contracts/src
git add packages/backend packages/contracts
git commit -m "feat(social): friends-only currentlySolving on the public profile"
```

---

### Task 6: Activity feed — `started` kind with opt-in + mutuality filtering

**Files:**

- Modify: `packages/domain/src/social/domain/activity-feed.ts:9`
- Modify: `packages/contracts/src/social/social.ts:44` (ActivityEntryView.kind)
- Modify: `packages/backend/convex/social/getActivityFeed.ts`
- Test: `packages/backend/convex/activityFeed.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/convex/activityFeed.test.ts` (module glob + seed copied from `solvingMutations.test.ts`; extend seed with a `carol` user):

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const HOUR = 60 * 60 * 1000;

// Seed: alice owns a copy; bob and carol exist. Follow edges are inserted per-test.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    const carol = await mkUser("carol");
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "Mountain Vista Ravensburger",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyAggregateId = crypto.randomUUID();
    await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, carol, copyAggregateId };
  });

const asUser = (t: ReturnType<typeof convexTest>, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

const follow = (
  t: ReturnType<typeof convexTest>,
  follower: Id<"users">,
  followee: Id<"users">,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId: follower,
      followeeId: followee,
      createdAt: Date.now(),
    });
  });

describe("social.getActivityFeed — started entries", () => {
  test("shows a followee's start only when they opted in AND are mutual", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, copyAggregateId } = await seed(t);
    await follow(t, bob, alice); // bob follows alice (one-way for now)

    await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - HOUR },
    );

    // Not opted in -> hidden.
    let feed = await asUser(t, "bob").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    expect(feed.filter((e) => e.kind === "started")).toHaveLength(0);

    // Opted in but NOT mutual -> still hidden (friends-only, decided in review).
    await asUser(t, "alice").mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: true },
    );
    feed = await asUser(t, "bob").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    expect(feed.filter((e) => e.kind === "started")).toHaveLength(0);

    // Mutual + opted in -> visible.
    await follow(t, alice, bob);
    feed = await asUser(t, "bob").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    const started = feed.filter((e) => e.kind === "started");
    expect(started).toHaveLength(1);
    expect(started[0].memberId).toBe(alice);
  });

  test("the viewer's own starts always appear, regardless of preference", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - HOUR },
    );
    const feed = await asUser(t, "alice").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    expect(feed.filter((e) => e.kind === "started")).toHaveLength(1);
  });

  test("future-dated starts are excluded from the feed", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    await asUser(t, "alice").mutation(
      api.solving.setShareInProgress.setShareInProgress,
      { enabled: true },
    );
    await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() + 24 * HOUR },
    );
    const feed = await asUser(t, "alice").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    expect(feed.filter((e) => e.kind === "started")).toHaveLength(0);
  });

  test("finishing a started solve yields both a started and a completion entry (distinct kinds, same ref)", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = (await asUser(t, "alice").mutation(
      api.solving.startCompletion.startCompletion,
      { copyId: copyAggregateId, startDate: Date.now() - 2 * HOUR },
    )) as string;
    await asUser(t, "alice").mutation(
      api.solving.finishCompletion.finishCompletion,
      { completionId, endDate: Date.now() },
    );
    const feed = await asUser(t, "alice").query(
      api.social.getActivityFeed.getActivityFeed,
      {},
    );
    expect(feed.filter((e) => e.ref === completionId)).toHaveLength(2);
  });
});
```

(Check the `follows` table's exact required fields in `schema.ts:891` before running; adjust the `follow` helper if it needs more than `followerId`/`followeeId`/`createdAt`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/backend && npx vitest run convex/activityFeed.test.ts`
Expected: FAIL — no `"started"` kind exists.

- [ ] **Step 3: Implement**

`packages/domain/src/social/domain/activity-feed.ts:9`:

```ts
// The kinds of activity Social surfaces in a feed, translated from foreign events at the seam.
// "started" (CompletionStarted) is opt-in + friends-only — that policy lives at the read seam
// (getActivityFeed), not here; the projection stays pure.
export type ActivityKind =
  "completion" | "acquisition" | "exchange" | "started";
```

`packages/contracts/src/social/social.ts:44`:

```ts
kind: "completion" | "acquisition" | "exchange" | "started";
```

`packages/backend/convex/social/getActivityFeed.ts`:

1. Add `"CompletionStarted"` to `FEED_EVENT_NAMES` and extend the doc comment:

```ts
//   CompletionStarted  (Solving)  -> "started",     member = payload.userId,  ref = completionId
//                                    (opt-in + mutual-followers-only, filtered below)
const FEED_EVENT_NAMES = [
  "CompletionRecorded",
  "CompletionStarted",
  "CopyAcquired",
  "ExchangeCompleted",
] as const;
```

2. Import the gate: `import { areMutualFollowers } from "./privacy";`

3. In `toActivityEntries`, add a case:

```ts
    case "CompletionStarted": {
      // A future-dated start hasn't begun; don't announce it (spec §2).
      const startDate = p.startDate as number | undefined;
      if (startDate !== undefined && startDate > Date.now()) return [];
      return make(p.userId as string, "started", p.completionId as string);
    }
```

4. Between the `deduped` computation and `buildActivityFeed`, insert the policy filter (MUST run before the limit slice — review finding: drop-after-slice yields short pages):

```ts
// "started" is OPT-IN and FRIENDS-ONLY (spec §4): the actor must have shareInProgress === true
// (tri-state; absent = off) AND be a mutual follower of the viewer. The viewer's own starts are
// exempt. Checked once per distinct actor — bounded by the audience-filtered entries, not the
// raw event batch — and BEFORE buildActivityFeed's limit slice so pages are never short.
const startedActorIds = [
  ...new Set(
    deduped
      .filter(
        (e) =>
          e.kind === "started" && (e.memberId as string) !== (meId as string),
      )
      .map((e) => e.memberId as string),
  ),
];
const startedActorAllowed = new Map(
  await Promise.all(
    startedActorIds.map(async (id) => {
      const actorId = id as unknown as Id<"users">;
      const prefs = await ctx.db
        .query("solvingPreferences")
        .withIndex("by_member", (q) => q.eq("memberId", actorId))
        .unique();
      if (prefs?.shareInProgress !== true) return [id, false] as const;
      return [id, await areMutualFollowers(ctx, meId, actorId)] as const;
    }),
  ),
);
const visible = deduped.filter(
  (e) =>
    e.kind !== "started" ||
    (e.memberId as string) === (meId as string) ||
    startedActorAllowed.get(e.memberId as string) === true,
);

const feed = buildActivityFeed(visible, {
  limit: args.limit ?? DEFAULT_LIMIT,
});
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/backend && npx vitest run convex/activityFeed.test.ts`
Expected: PASS (4 tests). Also run `npx vitest run convex/publicProfile.test.ts convex/solvingMutations.test.ts` — still green.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write packages/backend/convex packages/contracts/src packages/domain/src/social
git add packages/backend packages/contracts packages/domain
git commit -m "feat(social): opt-in friends-only 'started' activity feed entries"
```

---

### Task 7: Web feed renderers — defensive kinds, `started` copy, exhaustiveness test

**Files:**

- Create: `apps/web/src/components/social/activity-feed-meta.ts`
- Modify: `apps/web/src/components/social/activity-feed.tsx`
- Modify: `apps/web/src/components/dashboard-home/pulse-section.tsx` (ActivityRow ~line 300)
- Modify: `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json`
- Test: `apps/web/src/components/social/activity-feed-meta.test.ts` (new)

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/social/activity-feed-meta.test.ts` (pattern: `notification-meta.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { ACTIVITY_KINDS, ACTIVITY_META } from "./activity-feed-meta";

type LocaleShape = {
  activity: Record<string, unknown>;
  dashboard: { pulse: { latest: Record<string, unknown> } };
};
const locales: [string, LocaleShape][] = [
  ["en", en as unknown as LocaleShape],
  ["nl", nl as unknown as LocaleShape],
  ["source", source as unknown as LocaleShape],
];

describe("ACTIVITY_META", () => {
  it("covers every activity kind", () => {
    for (const kind of ACTIVITY_KINDS) {
      expect(ACTIVITY_META[kind], `META missing kind "${kind}"`).toBeDefined();
    }
  });

  it("has activity.<kind>.{you,other} and dashboard.pulse.latest.<kind> in every locale", () => {
    for (const [name, locale] of locales) {
      for (const kind of ACTIVITY_KINDS) {
        const entry = locale.activity[kind] as
          { you?: string; other?: string } | undefined;
        expect(entry?.you, `${name}: activity.${kind}.you`).toBeTruthy();
        expect(entry?.other, `${name}: activity.${kind}.other`).toBeTruthy();
        expect(
          locale.dashboard.pulse.latest[kind],
          `${name}: dashboard.pulse.latest.${kind}`,
        ).toBeTruthy();
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && npx vitest run src/components/social/activity-feed-meta.test.ts`
Expected: FAIL — `activity-feed-meta.ts` does not exist.

- [ ] **Step 3: Implement**

`apps/web/src/components/social/activity-feed-meta.ts`:

```ts
import type { ActivityEntryView } from "@jigswap/contracts";
import type { LucideIcon } from "lucide-react";
import { ArrowRightLeft, CircleCheck, Package, Puzzle } from "lucide-react";

// Every activity kind the web app knows how to render. The type-level assertions below force this
// list to stay in sync with the contracts union in BOTH directions — adding a kind to the contract
// without touching this file is a compile error, and vice versa.
export const ACTIVITY_KINDS = [
  "completion",
  "acquisition",
  "exchange",
  "started",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

// Bidirectional exhaustiveness check against the contract.
type _ContractCoversLocal = ActivityEntryView["kind"] extends ActivityKind
  ? true
  : never;
type _LocalCoversContract = ActivityKind extends ActivityEntryView["kind"]
  ? true
  : never;
const _exhaustive: [_ContractCoversLocal, _LocalCoversContract] = [true, true];
void _exhaustive;

// Icon + accent per kind; labels are translated at render time (activity.<kind>.*).
export const ACTIVITY_META: Record<
  ActivityKind,
  { icon: LucideIcon; accent: string }
> = {
  completion: { icon: CircleCheck, accent: "text-green-500" },
  acquisition: { icon: Package, accent: "text-blue-500" },
  exchange: { icon: ArrowRightLeft, accent: "text-amber-500" },
  started: { icon: Puzzle, accent: "text-sky-500" },
};

// Deploy-order safety: Convex deploys before web bundles, so an already-open client can receive a
// kind this bundle doesn't know. Renderers MUST skip unknown kinds instead of crashing.
export const isKnownActivityKind = (kind: string): kind is ActivityKind =>
  (ACTIVITY_KINDS as readonly string[]).includes(kind);
```

`activity-feed.tsx` — delete the local `type ActivityKind` and `META` const (lines 16-24); import from the new module:

```ts
import { ACTIVITY_META, isKnownActivityKind } from "./activity-feed-meta";
```

and change the row rendering (line 48-50) to skip unknown kinds:

```tsx
      {feed.map((entry, index) => {
        if (!isKnownActivityKind(entry.kind)) return null;
        const meta = ACTIVITY_META[entry.kind];
        const Icon = meta.icon;
```

(Note: with skipped entries the `index < feed.length - 1` border check can double-draw a border on the last visible row — acceptable cosmetic edge; do not restructure for it.)

`pulse-section.tsx` — in `ActivityRow` (the component starting ~line 300), add the same guard as the FIRST statement of the component body:

```ts
if (!isKnownActivityKind(entry.kind)) return null;
```

Wait — hooks must not be conditional. `ActivityRow` calls hooks (`useTranslations`, `useQuery`). Place the guard in `LatestColumn` instead, where entries are mapped (~line 369):

```tsx
          {shown.map((entry, i) => (
```

becomes

```tsx
{
  shown
    .filter((entry) => isKnownActivityKind(entry.kind))
    .map((entry, i, visible) => (
      <ActivityRow
        key={`${entry.kind}-${entry.ref}-${entry.occurredAt}`}
        entry={entry}
        me={me}
        isLast={i === visible.length - 1}
      />
    ));
}
```

with the import `import { isKnownActivityKind } from "@/components/social/activity-feed-meta";`. Keep `shown = entries.slice(0, 4)` as is.

Locale additions — `en.json` and `source.json` (identical):

```json
"activity": { ..., "started": { "you": "You started a puzzle", "other": "<strong>{name}</strong> started a puzzle" } }
"dashboard": { "pulse": { "latest": { ..., "started": "<strong>{name}</strong> started a puzzle" } } }
```

`nl.json`:

```json
"activity": { ..., "started": { "you": "Je bent aan een puzzel begonnen", "other": "<strong>{name}</strong> is aan een puzzel begonnen" } }
"dashboard": { "pulse": { "latest": { ..., "started": "<strong>{name}</strong> is aan een puzzel begonnen" } } }
```

(Insert keys with the JSON structure intact — these files are large; edit surgically next to the sibling `completion` keys.)

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && npx vitest run src/components/social/activity-feed-meta.test.ts`
Expected: PASS. Also `pnpm nx run web:type-check` if a target exists (else `cd apps/web && npx tsc --noEmit`; routeTree.gen noise is a known pre-existing issue — only new errors matter).

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write apps/web/src/components apps/web/locales
git add apps/web
git commit -m "feat(web): 'started' activity kind with deploy-safe unknown-kind skipping"
```

---

### Task 8: `StartSolveDialog` + Start/Finish buttons on copy detail, my-puzzles, borrowed

**Files:**

- Create: `apps/web/src/components/solving/start-solve-dialog.tsx`
- Modify: `apps/web/src/components/solving/finish-solve-dialog.tsx`
- Modify: `apps/web/src/routes/_dashboard/copies/$id.tsx` (~lines 469-490 actions, ~688-695 dialogs)
- Modify: `apps/web/src/routes/_dashboard/my-puzzles/index.tsx` (~lines 122, 168-181, 224-236, 397-405)
- Modify: `apps/web/src/routes/_dashboard/borrowed.tsx`
- Modify: locale files ×3 (`solving.startSolve` namespace + `solving.logSolve.endBeforeStartError`)

- [ ] **Step 0: FinishSolveDialog — start-date floor + specific error (spec §2)**

`finish-solve-dialog.tsx`: add an optional `minEndDate?: number` prop (epoch ms of the solve's startDate). Wire it:

```tsx
interface FinishSolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completionId: string;
  /** The solve's startDate (epoch ms); floors the end-date input so a future-dated start can't
   * produce an opaque domain rejection. Optional — call sites without the row omit it. */
  minEndDate?: number;
}
```

```tsx
<Input
  id="finish-end"
  type="date"
  value={endDate}
  min={
    minEndDate !== undefined
      ? new Date(minEndDate).toISOString().slice(0, 10)
      : undefined
  }
  onChange={(e) => setEndDate(e.target.value)}
/>
```

In the catch block, map the end-before-start domain error to a specific message. First check `packages/backend/convex/solving/errors.ts` + the domain's solving error codes for the exact code the `finish()` end<start rejection produces (search `packages/domain/src/solving` for the error construction in `completion.ts:218`), then:

```tsx
    } catch (error) {
      console.error("Failed to finish solve:", error);
      const code =
        error instanceof ConvexError
          ? (typeof error.data === "string"
              ? (JSON.parse(error.data) as { code?: string })
              : (error.data as { code?: string })
            )?.code
          : undefined;
      toast.error(
        code === "END_BEFORE_START" // replace with the REAL code found above
          ? t("endBeforeStartError")
          : t("saveError"),
      );
    }
```

(import `ConvexError` from `convex/values`; if the error shape differs at the browser boundary, match how other web catch blocks inspect ConvexError data — search `apps/web/src` for `ConvexError` and mirror; if no precedent exists, a plain `minEndDate` floor without code-sniffing is acceptable — note it in the PR.)

Existing call sites (`completions/index.tsx`) pass `minEndDate={completion.startDate}` where the row is in hand — update the finish-dialog mount in the completions page dialog wiring (`dialog.kind === "finish"` needs `startDate` added to its DialogState variant and the `setDialog` call at the Finish button). Task 10's dashboard section passes `minEndDate={solve.startDate}` (add `startDate` to its `finishTarget` state: `{ completionId: string; startDate: number } | null`). Task 8's page wirings below pass it wherever the in-progress row's `startDate` is already tracked (my-puzzles `inProgressStartDate`, borrowed map's `startDate`, copies `myInProgress.startDate`).

Locale (`solving.logSolve.endBeforeStartError`): en/source "The finish date can't be before the start date ({date}).", nl "De einddatum kan niet vóór de startdatum ({date}) liggen." — pass `date: new Date(minEndDate).toLocaleDateString()` when available, else use a `{date}`-free variant key. If threading the date param is awkward, use the simpler copy "The finish date can't be before the start date." / "De einddatum kan niet vóór de startdatum liggen." without a param.

- [ ] **Step 1: Create the dialog**

`apps/web/src/components/solving/start-solve-dialog.tsx`:

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
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

interface StartSolveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The Library CopyId aggregateId to start a solve on; the backend resolves + authorizes it.
  copyId: string;
  puzzleTitle: string;
  onSuccess?: () => void;
}

// The first-class "Start puzzle" action: date (default today, editable to past/future) + optional
// notes. Recording an already-finished solve stays in LogSolveDialog.
export function StartSolveDialog({
  open,
  onOpenChange,
  copyId,
  puzzleTitle,
  onSuccess,
}: StartSolveDialogProps) {
  const t = useTranslations("solving.startSolve");
  const startCompletion = useMutation({
    mutationFn: useConvexMutation(gateway.solving.startCompletion),
  });

  const [startDate, setStartDate] = useState(todayInputValue);
  const [notes, setNotes] = useState("");

  const handleSubmit = async () => {
    const start = dateInputToMs(startDate);
    if (start === undefined) return;
    try {
      await startCompletion.mutateAsync({
        copyId,
        startDate: start,
        notes: notes.trim() || undefined,
      });
      toast.success(t("started"));
      setStartDate(todayInputValue());
      setNotes("");
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to start solve:", error);
      toast.error(t("saveError"));
    }
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
          <div className="space-y-2">
            <Label htmlFor="start-solve-date">{t("startDate")}</Label>
            <Input
              id="start-solve-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="start-solve-notes">{t("notes")}</Label>
            <Textarea
              id="start-solve-notes"
              placeholder={t("notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={startCompletion.isPending || !startDate}
          >
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Locale (`solving.startSolve`, en + source; nl in parentheses):

```json
"startSolve": {
  "trigger": "Start puzzle",
  "title": "Start puzzle",
  "description": "Mark {puzzle} as in progress. You can adjust the date if you started earlier.",
  "startDate": "Start date",
  "notes": "Notes",
  "notesPlaceholder": "Anything to remember about this solve?",
  "submit": "Start",
  "started": "Puzzle started",
  "finishTrigger": "Finish solve",
  "saveError": "Could not save — please try again."
}
```

nl: trigger "Puzzel starten", title "Puzzel starten", description "Markeer {puzzle} als bezig. Je kunt de datum aanpassen als je eerder bent begonnen.", startDate "Startdatum", notes "Notities", notesPlaceholder "Iets om te onthouden over deze sessie?", submit "Starten", started "Puzzel gestart", finishTrigger "Puzzel afronden", saveError "Opslaan mislukt — probeer het opnieuw."

- [ ] **Step 2: Wire the copy detail page** (`copies/$id.tsx`)

The page already loads the caller's per-copy history via `gateway.solving.completionHistory` (~line 567) and mounts `LogSolveDialog` (~line 691). Locate the button that opens the log dialog (~lines 469-490, guarded by `copy.aggregateId == null`). Add, next to it, state + a swap button:

```tsx
const [startOpen, setStartOpen] = useState(false);
const [finishTarget, setFinishTarget] = useState<string | null>(null);
// The CALLER's most recent in-progress solve on this copy (completionHistory is caller-scoped).
// The caller-not-the-owner case matters: a borrower's in-progress solve must not flip the owner's
// button — verify completionHistory only returns the caller's rows; if it returns others', filter.
const myInProgress = (completionHistory ?? [])
  .filter((c) => !c.isCompleted && c.aggregateId)
  .sort((a, b) => b.startDate - a.startDate)[0];
```

Button (same placement/disabled pattern as the existing log button):

```tsx
{
  myInProgress ? (
    <Button
      variant="outline"
      disabled={copy.aggregateId == null}
      onClick={() => setFinishTarget(myInProgress.aggregateId!)}
    >
      {tStart("finishTrigger")}
    </Button>
  ) : (
    <Button
      variant="outline"
      disabled={copy.aggregateId == null}
      onClick={() => setStartOpen(true)}
    >
      {tStart("trigger")}
    </Button>
  );
}
```

with `const tStart = useTranslations("solving.startSolve");`, and mount next to the existing dialogs:

```tsx
<StartSolveDialog
  open={startOpen}
  onOpenChange={setStartOpen}
  copyId={copy.aggregateId ?? ""}
  puzzleTitle={/* same title variable LogSolveDialog receives */}
/>;
{
  finishTarget && (
    <FinishSolveDialog
      open
      onOpenChange={(open) => !open && setFinishTarget(null)}
      completionId={finishTarget}
    />
  );
}
```

Read the surrounding code first and match its exact variable names (title prop, owner guards). The **behavioural requirements** are fixed: swap on caller-only in-progress state; disable when `aggregateId == null`.

- [ ] **Step 3: Wire my-puzzles** (`my-puzzles/index.tsx`)

Extend `solveStateByCopyId` (~line 168) to retain the newest in-progress aggregateId:

```ts
const solveStateByCopyId = useMemo(() => {
  const map = new Map<
    string,
    {
      inProgress: boolean;
      completed: boolean;
      inProgressCompletionId?: string;
      inProgressStartDate?: number;
    }
  >();
  for (const completion of completions ?? []) {
    if (!completion.ownedPuzzleId) continue;
    const state = map.get(completion.ownedPuzzleId) ?? {
      inProgress: false,
      completed: false,
    };
    if (completion.isCompleted) state.completed = true;
    else {
      state.inProgress = true;
      if (
        completion.aggregateId &&
        (state.inProgressStartDate === undefined ||
          completion.startDate > state.inProgressStartDate)
      ) {
        state.inProgressCompletionId = completion.aggregateId;
        state.inProgressStartDate = completion.startDate;
      }
    }
    map.set(completion.ownedPuzzleId, state);
  }
  return map;
}, [completions]);
```

Add state + handlers next to `solveTarget` (~line 122):

```ts
const [startTarget, setStartTarget] = useState<{
  copyId: string;
  title: string;
} | null>(null);
const [finishTarget, setFinishTarget] = useState<string | null>(null);

const handleStartSolve = (ownedPuzzleId: Id<"ownedPuzzles">) => {
  const copy = userownedPuzzles?.find((p) => p._id === ownedPuzzleId);
  if (!copy?.aggregateId) {
    console.error("Cannot start a solve: copy is missing its aggregateId.");
    return;
  }
  const inProgressId =
    solveStateByCopyId.get(ownedPuzzleId)?.inProgressCompletionId;
  if (inProgressId) setFinishTarget(inProgressId);
  else
    setStartTarget({
      copyId: copy.aggregateId,
      title: copy.puzzle?.title ?? "",
    });
};
```

Wire a Start/Finish action onto the card next to wherever `handleLogSolve` is already wired (search the JSX below line 280 for the existing log-solve action and mirror it, labelled with `tStart("trigger")` / `tStart("finishTrigger")` based on `solveStateByCopyId.get(puzzle._id)?.inProgress`). Mount next to the existing `LogSolveDialog` (~line 397):

```tsx
{
  startTarget && (
    <StartSolveDialog
      open
      onOpenChange={(open) => !open && setStartTarget(null)}
      copyId={startTarget.copyId}
      puzzleTitle={startTarget.title}
    />
  );
}
{
  finishTarget && (
    <FinishSolveDialog
      open
      onOpenChange={(open) => !open && setFinishTarget(null)}
      completionId={finishTarget}
    />
  );
}
```

- [ ] **Step 4: Wire the borrowed page** (`borrowed.tsx`)

The page loads no completion data today. Add:

```ts
const { data: completions } = useQuery(
  convexQuery(gateway.solving.myCompletions, {}),
);
// Caller's newest in-progress solve per copy _id; borrowed loans expose the copy as loan.copyDocId
// ("" when the copy row is gone — skip those).
const inProgressByCopyDocId = useMemo(() => {
  const map = new Map<string, { completionId: string; startDate: number }>();
  for (const completion of completions ?? []) {
    if (
      completion.isCompleted ||
      !completion.ownedPuzzleId ||
      !completion.aggregateId
    )
      continue;
    const existing = map.get(completion.ownedPuzzleId);
    if (!existing || completion.startDate > existing.startDate) {
      map.set(completion.ownedPuzzleId, {
        completionId: completion.aggregateId,
        startDate: completion.startDate,
      });
    }
  }
  return map;
}, [completions]);
```

Per loan row, next to the existing "Log solve" button (search for where `setSolveFor` is called), add the swap:

```tsx
{
  loan.copyDocId !== "" && inProgressByCopyDocId.has(loan.copyDocId) ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        setFinishTarget(inProgressByCopyDocId.get(loan.copyDocId)!.completionId)
      }
    >
      {tStart("finishTrigger")}
    </Button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setStartFor({ copyId: loan.copyId, title: loan.title })}
    >
      {tStart("trigger")}
    </Button>
  );
}
```

Read the loan view's actual field names first (`loan.copyId` aggregate vs `copyDocId` doc id vs the title field — check `packages/contracts/src/lending` or the existing `setSolveFor` call, which already extracts exactly the right `{copyId, title}` pair — mirror that call). Add `startFor`/`finishTarget` state + dialog mounts exactly as on my-puzzles. Add `useMemo` to the imports.

- [ ] **Step 5: Verify + commit**

Run: `cd apps/web && npx tsc --noEmit` (only new errors matter — `routeTree.gen` noise is pre-existing).
Manual check: `pnpm dev` runs on :3001 if a visual sanity check is wanted (browser automation is unavailable in this environment).

```bash
pnpm prettier --write apps/web/src apps/web/locales
git add apps/web
git commit -m "feat(web): StartSolveDialog + start/finish swap on copy, my-puzzles, borrowed"
```

---

### Task 9: Completions page — in-progress section on top

**Files:**

- Modify: `apps/web/src/routes/_dashboard/completions/index.tsx`
- Modify: locale files ×3 (`solving.completions.inProgressSection`, `historySection`)

- [ ] **Step 1: Split the list**

In `CompletionsPage`, after the existing `sorted` computation (line 183-185), add:

```ts
// In-progress on top (newest-started first), finished history below. isCompleted is authoritative
// (edit() can attach an endDate to a still-in-progress row) — never key on endDate presence.
const inProgress = sorted
  .filter((c) => !c.isCompleted)
  .sort((a, b) => b.startDate - a.startDate);
const history = sorted.filter((c) => c.isCompleted);
```

Extract the row JSX (the whole `sorted.map` callback body, lines 205-386) into a local component `CompletionRow({ completion, index, isLast })` inside the same file, preserving every prop/handler it closes over (pass `infoByCopyId`, `formatDate`, `formatTime`, `t`, `setDialog` as props or keep it as an inner closure — an inner function component defined inside `CompletionsPage` keeps the closures and is the smallest change). Then render:

```tsx
<section>
  {sorted.length === 0 ? (
    <EmptyState title={t("empty")} sub={t("emptyHint")} />
  ) : (
    <>
      {inProgress.length > 0 && (
        <>
          <h2 className="text-muted-foreground mb-2 text-sm font-medium">
            {t("inProgressSection")}
          </h2>
          <div className="mb-6 flex flex-col">
            {inProgress.map((completion, index) => (
              <CompletionRow
                key={completion._id}
                completion={completion}
                index={index}
                isLast={index === inProgress.length - 1}
              />
            ))}
          </div>
        </>
      )}
      {history.length > 0 && (
        <>
          {inProgress.length > 0 && (
            <h2 className="text-muted-foreground mb-2 text-sm font-medium">
              {t("historySection")}
            </h2>
          )}
          <div className="flex flex-col">
            {history.map((completion, index) => (
              <CompletionRow
                key={completion._id}
                completion={completion}
                index={index}
                isLast={index === history.length - 1}
              />
            ))}
          </div>
        </>
      )}
    </>
  )}
</section>
```

Change the row's border condition from `index < sorted.length - 1` to `!isLast`.

Locale: `solving.completions.inProgressSection`: en/source "In progress", nl "Bezig"; `historySection`: en/source "History", nl "Geschiedenis".

- [ ] **Step 2: Verify + commit**

Run: `cd apps/web && npx tsc --noEmit` — no new errors.

```bash
pnpm prettier --write apps/web/src/routes/_dashboard/completions/index.tsx apps/web/locales
git add apps/web
git commit -m "feat(web): split completions page into in-progress and history sections"
```

---

### Task 10: Dashboard "Solving now" section

**Files:**

- Create: `apps/web/src/components/dashboard-home/solving-now-section.tsx`
- Modify: `apps/web/src/routes/_dashboard/dashboard.tsx`
- Modify: locale files ×3 (`dashboard.solvingNow` namespace)

- [ ] **Step 1: Create the section**

`apps/web/src/components/dashboard-home/solving-now-section.tsx` (card-free, per the dashboard's layout language — `SectionHead` + open rows, NOT a boxed Card):

```tsx
"use client";

import { Link } from "@/compat/link";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { FinishSolveDialog } from "@/components/solving/finish-solve-dialog";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Puzzle } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

// The dashboard's in-progress rail: what the member is solving right now, with a one-click finish.
export function SolvingNowSection() {
  const t = useTranslations("dashboard.solvingNow");
  const { member } = useCurrentMember();
  const { data: solves } = useQuery(
    convexQuery(gateway.solving.myInProgress, member?._id ? {} : "skip"),
  );
  const [finishTarget, setFinishTarget] = useState<string | null>(null);

  if (!member || solves === undefined) return null;

  // Clamped relative copy: future-dated starts read "starts in N days", never "-N days ago".
  const startedLabel = (startDate: number): string => {
    const days = Math.floor((Date.now() - startDate) / 86400000);
    if (days < 0) return t("startsInDays", { days: -days });
    if (days === 0) return t("startedToday");
    return t("startedDaysAgo", { days });
  };

  return (
    <section>
      <SectionHead title={t("title")} icon={Puzzle} />
      {solves.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("empty")}{" "}
          <Link href="/my-puzzles" className="underline underline-offset-2">
            {t("emptyCta")}
          </Link>
        </p>
      ) : (
        <div className="flex flex-col">
          {solves.map((solve, index) => (
            <div
              key={solve.completionId}
              className={cn(
                "flex items-center gap-3.5 py-3",
                index < solves.length - 1 && "border-b",
              )}
            >
              {solve.thumbnailUrl ? (
                <img
                  src={solve.thumbnailUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-md object-cover"
                />
              ) : (
                <span className="bg-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-md">
                  <Puzzle className="text-muted-foreground h-5 w-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {solve.title ?? t("untitled")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {solve.pieceCount !== undefined &&
                    `${t("pieces", { count: solve.pieceCount })} · `}
                  {startedLabel(solve.startDate)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFinishTarget(solve.completionId)}
              >
                <CircleCheck className="h-4 w-4" />
                {t("finish")}
              </Button>
            </div>
          ))}
        </div>
      )}

      {finishTarget && (
        <FinishSolveDialog
          open
          onOpenChange={(open) => !open && setFinishTarget(null)}
          completionId={finishTarget}
        />
      )}
    </section>
  );
}
```

`dashboard.tsx` — import and mount between `ShelfSection` and `PulseSection`:

```tsx
      <ShelfSection />
      <SolvingNowSection />
      <PulseSection />
```

Locale (`dashboard.solvingNow`), en/source:

```json
"solvingNow": {
  "title": "Solving now",
  "empty": "Nothing on the table right now.",
  "emptyCta": "Start one from your puzzles",
  "untitled": "A puzzle",
  "pieces": "{count} pieces",
  "startedToday": "Started today",
  "startedDaysAgo": "Started {days} days ago",
  "startsInDays": "Starts in {days} days",
  "finish": "Finish"
}
```

nl: title "Nu aan het puzzelen", empty "Er ligt nu niets op tafel.", emptyCta "Start er een vanuit je puzzels", untitled "Een puzzel", pieces "{count} stukjes", startedToday "Vandaag gestart", startedDaysAgo "{days} dagen geleden gestart", startsInDays "Start over {days} dagen", finish "Afronden".

- [ ] **Step 2: Verify + commit**

Run: `cd apps/web && npx tsc --noEmit` — no new errors.

```bash
pnpm prettier --write apps/web/src apps/web/locales
git add apps/web
git commit -m "feat(web): dashboard 'Solving now' section"
```

---

### Task 11: Profile "Currently solving" section

**Files:**

- Modify: `apps/web/src/components/members/profile-body.tsx`
- Modify: locale files ×3 (`profile.currentlySolving` namespace)

- [ ] **Step 1: Add the section**

In `profile-body.tsx`, the unlocked branch renders `<StatStrip …/><RecordsRow …/><ShelfSection …/>` (~lines 104-106). Insert between `RecordsRow` and `ShelfSection`:

```tsx
<CurrentlySolvingSection
  firstName={firstName}
  items={"currentlySolving" in profile ? (profile.currentlySolving ?? []) : []}
/>
```

and add the component in the same file (following `RecordsRow`'s style):

```tsx
function CurrentlySolvingSection({
  firstName,
  items,
}: {
  firstName: string;
  items: NonNullable<UnlockedProfile["currentlySolving"]>;
}) {
  const t = useTranslations("profile.currentlySolving");
  const format = useFormatter();
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHead title={t("title", { name: firstName })} icon={Puzzle} />
      <div className="flex flex-col">
        {items.map((item, index) => (
          <div
            key={`${item.startedAt}-${index}`}
            className={cn(
              "flex items-center gap-3.5 py-3",
              index < items.length - 1 && "border-b",
            )}
          >
            {item.thumbnailUrl ? (
              <img
                src={item.thumbnailUrl}
                alt=""
                className="h-11 w-11 shrink-0 rounded-md object-cover"
              />
            ) : (
              <span className="bg-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-md">
                <Puzzle className="text-muted-foreground h-5 w-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {item.title ?? t("untitled")}
              </p>
              <p className="text-muted-foreground text-xs">
                {item.pieceCount !== undefined &&
                  `${t("pieces", { count: item.pieceCount })} · `}
                {format.relativeTime(new Date(item.startedAt))}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

Add missing imports (`Puzzle` from lucide-react, `useFormatter` from use-intl, `cn`) if not already present; check how `UnlockedProfile` is derived at line 49 — the `currentlySolving` field flows in from the contract automatically. Note the `"currentlySolving" in profile` guard: the gateway type is the unlocked union arm, so plain `profile.currentlySolving` should typecheck — prefer that if it does.

Locale (`profile.currentlySolving`), en/source:

```json
"currentlySolving": {
  "title": "{name} is currently solving",
  "untitled": "A puzzle",
  "pieces": "{count} pieces"
}
```

nl: title "{name} is nu bezig met", untitled "Een puzzel", pieces "{count} stukjes".

Check whether the `profile` namespace exists in the locale files (ShelfSection uses `profile.shelf`); nest `currentlySolving` beside `shelf`.

- [ ] **Step 2: Verify + commit**

Run: `cd apps/web && npx tsc --noEmit` — no new errors.

```bash
pnpm prettier --write apps/web/src/components/members apps/web/locales
git add apps/web
git commit -m "feat(web): 'Currently solving' section on member profiles"
```

---

### Task 12: Settings toggle for `shareInProgress`

**Files:**

- Modify: `apps/web/src/hooks/use-user-settings.ts`
- Modify: `apps/web/src/components/dashboard-layout/shell-user-button.tsx` (PreferencesPage, ~lines 93-159)
- Modify: locale files ×3 (`solving.settings` keys)

- [ ] **Step 1: Extend the hook**

`use-user-settings.ts`:

```ts
export function useUserSettings() {
  const { data: settings, isPending } = useQuery(
    convexQuery(gateway.settings.mine, {}),
  );
  const { mutateAsync: setTrackDuration } = useMutation({
    mutationFn: useConvexMutation(gateway.solving.setTrackCompletionDuration),
  });
  const { mutateAsync: setShare } = useMutation({
    mutationFn: useConvexMutation(gateway.solving.setShareInProgress),
  });
  return {
    isLoading: isPending || settings === undefined,
    trackCompletionDuration: settings?.solving.trackCompletionDuration,
    shareInProgress: settings?.solving.shareInProgress,
    setTrackDuration: (enabled: boolean) => setTrackDuration({ enabled }),
    setShareInProgress: (enabled: boolean) => setShare({ enabled }),
  };
}
```

- [ ] **Step 2: Add the toggle**

In `shell-user-button.tsx` `PreferencesPage`, extend the destructuring:

```ts
const {
  trackCompletionDuration,
  setTrackDuration,
  shareInProgress,
  setShareInProgress,
} = useUserSettings();
```

and after the existing track-duration block (ends ~line 156 with `{ts("trackDurationHint")}`), add inside the same solving section:

```tsx
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="share-in-progress" className="text-sm">
            {ts("shareInProgressLabel")}
          </label>
          <Switch
            id="share-in-progress"
            checked={shareInProgress === true}
            onCheckedChange={(checked) => void setShareInProgress(checked)}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {ts("shareInProgressHint")}
        </p>
```

Locale (`solving.settings`), en/source — the hint MUST state the retro-exposure (review decision):

```json
"shareInProgressLabel": "Share in-progress puzzles with friends",
"shareInProgressHint": "Friends (people you follow who follow you back) can see which puzzles you're working on — including ones you've already started."
```

nl: label "Deel puzzels waar je mee bezig bent met vrienden", hint "Vrienden (mensen die je volgt en die jou terugvolgen) zien aan welke puzzels je werkt — ook puzzels waar je al aan begonnen bent."

- [ ] **Step 3: Verify + commit**

Run: `cd apps/web && npx tsc --noEmit` — no new errors.

```bash
pnpm prettier --write apps/web/src apps/web/locales
git add apps/web
git commit -m "feat(web): shareInProgress settings toggle"
```

---

### Task 13: Full verification sweep

- [ ] **Step 1: Architecture + types**

Run: `pnpm arch:check` — expected: clean (domain never imports convex; web imports gateway only).
Run: `pnpm type-check` — expected: no NEW errors (`routeTree.gen` noise is pre-existing).

- [ ] **Step 2: Full test suites, cache-bypassed (mirrors CI)**

Run: `pnpm test -- --skip-nx-cache` (or `pnpm nx run-many -t test coverage --skip-nx-cache` — check `nx.json` target names; the backend target is `coverage`).
Expected: all green — domain specs, backend convex-tests (solvingMutations, solvingPreferences, publicProfile, activityFeed, notifications, libraryReads…), web tests.

- [ ] **Step 3: Format check**

Run: `pnpm prettier --check .` (scoped to changed files if the repo has no root check script).
Expected: clean.

- [ ] **Step 4: Fix anything found, re-run, commit fixes**

```bash
git add -A
git commit -m "chore: verification fixes for in-progress solves feature"
```

(only if fixes were needed)
