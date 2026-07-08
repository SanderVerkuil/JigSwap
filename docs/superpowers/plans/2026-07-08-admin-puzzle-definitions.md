# Admin Puzzle Definitions Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PR 3 of the approved spec (`docs/superpowers/specs/2026-07-08-admin-users-puzzles-and-confirm-dialogs-design.md`): an admin page at `/admin/puzzles` listing ALL puzzle definitions (every moderation status) with admin metadata (created date, submitter, distinct-owner count, thumbnail), plus a reversible **disable / re-enable** lifecycle — modeled in the domain state machine (`approved → disabled → approved`), exposed as admin-gated Convex mutations that stamp the `moderationActions` audit trail and append domain events to the durable outbox, and surfaced in the UI behind inline AlertDialog confirms. Disabled definitions disappear from every public browse/search surface and cannot be newly acquired; existing owned copies are untouched (they render from cached snapshots).

**Architecture:** Hexagonal, three rings. (1) **Domain** (`packages/domain/src/catalog`): `ApprovalStatus` gains `"disabled"`, the transition table gains `approved → [disabled]` and `disabled → [approved]`, the `PuzzleDefinition` aggregate gains `disable()`/`reenable()` recording new `PuzzleDefinitionDisabled`/`PuzzleDefinitionReenabled` events, and two use-cases reuse the shared `runDefinitionAction` load→act→save→publish wrapper. The Library ACL type `PuzzleApprovalStatus` also gains `"disabled"` so the existing `makeAcquireCopy` guard (`status !== "approved" && !isOwnSubmission → PuzzleNotAcquirable`) blocks new acquisitions of disabled definitions with zero logic change. (2) **Backend composition root** (`packages/backend/convex`): schema unions grow, two thin mutations mirror `approvePuzzleDefinition.ts` exactly (admin gate → `runDefinitionAction` → `stampModerationAction` with new kinds), and a new admin-gated paginated read model `admin/listPuzzleDefinitions.ts` returns typed `@jigswap/contracts` rows. (3) **Web** (`apps/web`): new route + nav entry + row actions with the established controlled-AlertDialog confirm pattern from `category-list.tsx`; the moderation Activity Log learns the two new audit kinds.

**Tech Stack:** TypeScript, Convex (convex-test + vitest, edge-runtime env), vitest for domain specs, TanStack Router/Query (+ the sanctioned `usePaginatedQuery` exception from `convex/react`), shadcn AlertDialog/Badge/Button, use-intl (en + nl), Nx monorepo, pnpm, prettier.

---

## Executor setup & non-negotiable constraints

- [ ] Branch from `main` in a worktree: `git worktree add ../jigswap-admin-puzzles -b feat/admin-puzzle-definitions main` (or use the worktree tooling). **All file writes must go through the worktree path, never the main-repo absolute path.**
- [ ] `pnpm install --frozen-lockfile` in the worktree root.

**CRITICAL worktree caveat — Convex codegen cannot run here.** `convex codegen` needs a live `CONVEX_DEPLOYMENT` and fails in a worktree. This plan adds three new Convex function modules (`catalog/disablePuzzleDefinition.ts`, `catalog/reenablePuzzleDefinition.ts`, `admin/listPuzzleDefinitions.ts`). You MUST register each by **hand-editing `packages/backend/convex/_generated/api.d.ts`**: add an `import type * as <ns>_<name> from "../<ns>/<name>.js";` line AND the matching `"<ns>/<name>": typeof <ns>_<name>,` entry inside `declare const fullApi: ApiFromModules<{ ... }>`, mirroring the existing sibling entries and keeping both lists alphabetical. `_generated/api.js` needs **no** edit (it exports `anyApi`, so runtime + convex-test resolution work regardless; the hand-edit only restores compile-time types for the gateway/web typecheck). Schema changes need NO `_generated` edit (`dataModel.d.ts` derives structurally from `schema.ts`). A real `convex dev` later regenerates the file.

**Scope guardrails (embed in every review):**

- Do NOT alter approve/reject behavior. `approvePuzzleDefinition.ts` / `rejectPuzzleDefinition.ts` are untouched. (Consequence of the transition table: `approve()` also becomes legal from `disabled` — that is the intended `disabled → approved` edge; the moderation console never offers Approve on a disabled row, and `reenable()` is the front door that records the right event.)
- `moderationActions` rows and `domainEvents` outbox rows are **append-only**: disable only flips `puzzles.status`; nothing is deleted, no rows are mutated.
- Existing owned copies are unaffected — they render from their cached `snapshot` on `ownedPuzzles`; no library write path changes.
- The existing own-submission acquisition carve-out is preserved as-is: a submitter may still log a copy of their own non-approved (pending/rejected/**disabled**) submission, exactly like today's rejected case. The public invariant ("new acquisitions of disabled definitions are blocked") applies to everyone else and is test-covered.
- No user-management features, no authorization changes (`isAdmin` stays JWT-only).

**Repo conventions:** domain tests are colocated `.spec.ts` in `packages/domain`; backend tests are `.test.ts` at the `packages/backend/convex/` ROOT (never in subdirs — the `import.meta.glob(["./**/*.{js,ts}", ...])` module bundling breaks otherwise). Prettier-format every changed file before each commit (CI runs `format:check` first). `apps/web/src/routeTree.gen.ts` is gitignored/generated: a direct web `tsc --noEmit` shows ~39 PRE-EXISTING `createFileRoute(...)`-pattern errors without it — only check that your changes add no NEW errors outside that pattern.

**Test commands used throughout:**

- Domain: `pnpm --filter @jigswap/domain exec vitest run <file>` (all: `pnpm --filter @jigswap/domain exec vitest run`)
- Backend: `pnpm --filter @jigswap/backend exec vitest run <convex/file.test.ts>` (all: `pnpm --filter @jigswap/backend exec vitest run`)
- Typecheck: `pnpm exec nx run-many -t type-check --skip-nx-cache` (single project: `pnpm --filter @jigswap/backend exec tsc --noEmit`)

---

### Task 1 — Domain state machine, events, and aggregate methods (TDD)

**Files:**

- `packages/domain/src/catalog/domain/puzzle-definition.spec.ts` (add tests; existing lifecycle tests at lines 100–137)
- `packages/domain/src/catalog/domain/approval.ts` (whole file, 13 lines)
- `packages/domain/src/catalog/domain/events.ts` (add 2 event classes + extend `CatalogDomainEvent` union at line 76)
- `packages/domain/src/catalog/domain/puzzle-definition.ts` (add `disable()`/`reenable()` after `reject()` at line 149; extend the events import at lines 5–10)

No new error type is needed: invalid transitions reuse `CatalogError.illegalApprovalTransition(from, to)` (`packages/domain/src/catalog/domain/errors.ts:47`), exactly like `approve()`/`reject()`.

**Steps:**

- [ ] Write the failing tests. In `packages/domain/src/catalog/domain/puzzle-definition.spec.ts`, append this describe block after the `describe("approval lifecycle", ...)` block (after line 137):

```ts
describe("disable / re-enable lifecycle", () => {
  const approved = (): PuzzleDefinition => {
    const def = submit();
    def.approve(NOW);
    def.pullEvents();
    return def;
  };

  it("disables an approved definition, recording PuzzleDefinitionDisabled", () => {
    const def = approved();
    const r = def.disable(LATER);
    expect(r.isOk).toBe(true);
    expect(def.status).toBe("disabled");
    expect(names(def.pullEvents())).toEqual(["PuzzleDefinitionDisabled"]);
    expect(def.toState().updatedAt).toBe(LATER);
  });

  it("re-enables a disabled definition back to approved, recording PuzzleDefinitionReenabled", () => {
    const def = approved();
    def.disable(NOW);
    def.pullEvents();
    const r = def.reenable(LATER);
    expect(r.isOk).toBe(true);
    expect(def.status).toBe("approved");
    expect(names(def.pullEvents())).toEqual(["PuzzleDefinitionReenabled"]);
    expect(def.toState().updatedAt).toBe(LATER);
  });

  it("cannot disable a pending or rejected definition (illegal transition)", () => {
    const pending = submit();
    const r1 = pending.disable(LATER);
    expect(r1.isErr).toBe(true);
    if (r1.isErr) expect(r1.error.code).toBe("IllegalApprovalTransition");

    const rejected = submit();
    rejected.reject(NOW);
    const r2 = rejected.disable(LATER);
    expect(r2.isErr).toBe(true);
    if (r2.isErr) expect(r2.error.code).toBe("IllegalApprovalTransition");
  });

  it("cannot disable twice", () => {
    const def = approved();
    def.disable(NOW);
    const again = def.disable(LATER);
    expect(again.isErr).toBe(true);
    if (again.isErr) expect(again.error.code).toBe("IllegalApprovalTransition");
  });

  // reenable is NOT a backdoor approve: even though pending → approved is a legal TABLE move,
  // reenable() itself must only act on a disabled definition.
  it("cannot re-enable a definition that is not disabled", () => {
    const r1 = approved().reenable(LATER);
    expect(r1.isErr).toBe(true);
    if (r1.isErr) expect(r1.error.code).toBe("IllegalApprovalTransition");

    const pending = submit();
    const r2 = pending.reenable(LATER);
    expect(r2.isErr).toBe(true);
    if (r2.isErr) expect(r2.error.code).toBe("IllegalApprovalTransition");
  });

  it("a re-enabled definition can be disabled again (full round-trip)", () => {
    const def = approved();
    expect(def.disable(NOW).isOk).toBe(true);
    expect(def.reenable(NOW).isOk).toBe(true);
    expect(def.disable(LATER).isOk).toBe(true);
    expect(def.status).toBe("disabled");
  });
});
```

- [ ] Run and watch it fail: `pnpm --filter @jigswap/domain exec vitest run src/catalog/domain/puzzle-definition.spec.ts` — expected failure: `TypeError: def.disable is not a function` (6 new tests fail; all pre-existing tests still pass).
- [ ] Implement the state machine. Replace the whole body of `packages/domain/src/catalog/domain/approval.ts` with:

```ts
// Moderation lifecycle of a PuzzleDefinition. Only `approved` definitions are publicly
// listable (an application-layer query concern); the aggregate owns the transitions.
export type ApprovalStatus = "pending" | "approved" | "rejected" | "disabled";

// Legal approval moves. A submission starts `pending`; moderation decides it once. An
// approved definition may be reversibly disabled (hidden from public surfaces) and
// re-enabled; `rejected` stays terminal (re-submission would be a new definition).
export const ALLOWED_APPROVAL_TRANSITIONS: Readonly<
  Record<ApprovalStatus, readonly ApprovalStatus[]>
> = {
  pending: ["approved", "rejected"],
  approved: ["disabled"],
  disabled: ["approved"],
  rejected: [],
};
```

- [ ] Add the events. In `packages/domain/src/catalog/domain/events.ts`, insert after the `PuzzleDefinitionUpdated` class (after line 39):

```ts
// Reversible admin lifecycle: a disabled definition is hidden from public browse/search but
// never deleted. No actor on the event — the acting admin is stamped at the composition root
// (moderationActions), same as approve/reject.
export class PuzzleDefinitionDisabled implements DomainEvent {
  readonly name = "PuzzleDefinitionDisabled";
  constructor(
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly occurredAt: Date,
  ) {}
}

export class PuzzleDefinitionReenabled implements DomainEvent {
  readonly name = "PuzzleDefinitionReenabled";
  constructor(
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly occurredAt: Date,
  ) {}
}
```

and extend the union at the bottom of the file:

```ts
export type CatalogDomainEvent =
  | PuzzleDefinitionSubmitted
  | PuzzleDefinitionApproved
  | PuzzleDefinitionRejected
  | PuzzleDefinitionUpdated
  | PuzzleDefinitionDisabled
  | PuzzleDefinitionReenabled
  | CatalogCategoryCreated
  | CatalogCategoryUpdated
  | CatalogCategoryActiveChanged
  | CatalogCategoryReordered;
```

- [ ] Add the aggregate methods. In `packages/domain/src/catalog/domain/puzzle-definition.ts`, extend the events import (lines 5–10) to:

```ts
import {
  PuzzleDefinitionApproved,
  PuzzleDefinitionDisabled,
  PuzzleDefinitionReenabled,
  PuzzleDefinitionRejected,
  PuzzleDefinitionSubmitted,
  PuzzleDefinitionUpdated,
} from "./events";
```

and insert after the `reject()` method (after line 149):

```ts
  // Admin reversibly disables an approved definition, hiding it from public browse/search.
  // Nothing is deleted; existing copies keep rendering from their cached snapshots.
  disable(now: Date): Result<void, CatalogError> {
    const moved = this.transition("disabled", now);
    if (moved.isErr) return moved;
    this.record(new PuzzleDefinitionDisabled(this.id, now));
    return ok(undefined);
  }

  // Admin re-enables a disabled definition, restoring it to approved. Guarded on the CURRENT
  // status (not just the table): pending → approved is a legal table move reserved for
  // approve(), so reenable() must never act as a backdoor approval.
  reenable(now: Date): Result<void, CatalogError> {
    if (this.state.status !== "disabled") {
      return err(
        CatalogError.illegalApprovalTransition(this.state.status, "approved"),
      );
    }
    const moved = this.transition("approved", now);
    if (moved.isErr) return moved;
    this.record(new PuzzleDefinitionReenabled(this.id, now));
    return ok(undefined);
  }
```

- [ ] Run to green: `pnpm --filter @jigswap/domain exec vitest run src/catalog/domain/puzzle-definition.spec.ts` — all tests pass.
- [ ] Run the whole domain suite to catch ripples: `pnpm --filter @jigswap/domain exec vitest run` — expected: all pass (nothing else pattern-matches on `ApprovalStatus` exhaustively).
- [ ] Format: `pnpm exec prettier --write packages/domain/src/catalog/domain/approval.ts packages/domain/src/catalog/domain/events.ts packages/domain/src/catalog/domain/puzzle-definition.ts packages/domain/src/catalog/domain/puzzle-definition.spec.ts`
- [ ] Commit:

```bash
git add packages/domain/src/catalog/domain/approval.ts packages/domain/src/catalog/domain/events.ts packages/domain/src/catalog/domain/puzzle-definition.ts packages/domain/src/catalog/domain/puzzle-definition.spec.ts
git commit -m "feat(domain): reversible disabled status on PuzzleDefinition

approved → disabled → approved in the approval state machine, with
PuzzleDefinitionDisabled/Reenabled events; rejected stays terminal and
reenable() is guarded against acting as a backdoor approve.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2 — Domain use-cases + inbound ports (TDD)

**Files:**

- `packages/domain/src/catalog/application/use-cases/puzzle-definition.spec.ts` (add tests; approve/reject use-case tests at lines 140–175)
- `packages/domain/src/catalog/application/ports/in/moderate-puzzle-definition.port.ts` (add 2 interfaces; already re-exported by `ports/in/index.ts` line 3)
- `packages/domain/src/catalog/application/use-cases/disable-puzzle-definition.ts` (new)
- `packages/domain/src/catalog/application/use-cases/reenable-puzzle-definition.ts` (new)
- `packages/domain/src/catalog/application/use-cases/index.ts` (add 2 export lines)

**Steps:**

- [ ] Write the failing tests. In `packages/domain/src/catalog/application/use-cases/puzzle-definition.spec.ts`, add to the import block (after the `makeApprovePuzzleDefinition` import at line 10):

```ts
import { makeDisablePuzzleDefinition } from "./disable-puzzle-definition";
import { makeReenablePuzzleDefinition } from "./reenable-puzzle-definition";
```

and append these tests inside the top-level describe, right after the `"surfaces the aggregate's illegal-transition on re-approval"` test (after line 165):

```ts
it("disables a stored approved definition and publishes PuzzleDefinitionDisabled", async () => {
  const id = await submitOk();
  const approve = makeApprovePuzzleDefinition(deps);
  await approve({ puzzleDefinitionId: id });
  events.published.length = 0;

  const disable = makeDisablePuzzleDefinition(deps);
  const r = await disable({ puzzleDefinitionId: id });
  expect(r.isOk).toBe(true);
  expect(events.names()).toEqual(["PuzzleDefinitionDisabled"]);
  const stored = await repo.findById(id);
  expect(stored?.status).toBe("disabled");
});

it("re-enables a disabled definition and publishes PuzzleDefinitionReenabled", async () => {
  const id = await submitOk();
  await makeApprovePuzzleDefinition(deps)({ puzzleDefinitionId: id });
  await makeDisablePuzzleDefinition(deps)({ puzzleDefinitionId: id });
  events.published.length = 0;

  const reenable = makeReenablePuzzleDefinition(deps);
  const r = await reenable({ puzzleDefinitionId: id });
  expect(r.isOk).toBe(true);
  expect(events.names()).toEqual(["PuzzleDefinitionReenabled"]);
  const stored = await repo.findById(id);
  expect(stored?.status).toBe("approved");
});

it("surfaces the aggregate's illegal-transition when disabling a pending definition", async () => {
  const id = await submitOk();
  const disable = makeDisablePuzzleDefinition(deps);
  const r = await disable({ puzzleDefinitionId: id });
  expect(r.isErr).toBe(true);
  if (r.isErr) expect(r.error.code).toBe("IllegalApprovalTransition");
});

it("rejects disabling an unknown definition (PuzzleDefinitionNotFound)", async () => {
  const disable = makeDisablePuzzleDefinition(deps);
  const r = await disable({
    puzzleDefinitionId: toPuzzleDefinitionId("missing"),
  });
  expect(r.isErr).toBe(true);
  if (r.isErr) expect(r.error.code).toBe("PuzzleDefinitionNotFound");
});
```

- [ ] Run and watch it fail: `pnpm --filter @jigswap/domain exec vitest run src/catalog/application/use-cases/puzzle-definition.spec.ts` — expected failure: `Cannot find module './disable-puzzle-definition'` (vitest module-resolution error).
- [ ] Add the port interfaces. In `packages/domain/src/catalog/application/ports/in/moderate-puzzle-definition.port.ts`, append after the `RejectPuzzleDefinition` interface (after line 28):

```ts
export interface DisablePuzzleDefinition {
  (
    cmd: ModeratePuzzleDefinitionCommand,
  ): Promise<ModeratePuzzleDefinitionResult>;
}

export interface ReenablePuzzleDefinition {
  (
    cmd: ModeratePuzzleDefinitionCommand,
  ): Promise<ModeratePuzzleDefinitionResult>;
}
```

Also widen the file's top comment (line 5–6) from "Both moderation use cases (approve/reject)" to "The moderation use cases (approve/reject/disable/re-enable)".

- [ ] Create `packages/domain/src/catalog/application/use-cases/disable-puzzle-definition.ts`:

```ts
import { DisablePuzzleDefinition } from "../ports/in/moderate-puzzle-definition.port";
import {
  DefinitionActionDeps,
  runDefinitionAction,
} from "./run-definition-action";

export const makeDisablePuzzleDefinition = (
  deps: DefinitionActionDeps,
): DisablePuzzleDefinition => {
  const run = runDefinitionAction(deps, (definition, now) =>
    definition.disable(now),
  );
  return (cmd) => run(cmd.puzzleDefinitionId);
};
```

- [ ] Create `packages/domain/src/catalog/application/use-cases/reenable-puzzle-definition.ts`:

```ts
import { ReenablePuzzleDefinition } from "../ports/in/moderate-puzzle-definition.port";
import {
  DefinitionActionDeps,
  runDefinitionAction,
} from "./run-definition-action";

export const makeReenablePuzzleDefinition = (
  deps: DefinitionActionDeps,
): ReenablePuzzleDefinition => {
  const run = runDefinitionAction(deps, (definition, now) =>
    definition.reenable(now),
  );
  return (cmd) => run(cmd.puzzleDefinitionId);
};
```

- [ ] Register the exports in `packages/domain/src/catalog/application/use-cases/index.ts` (keep alphabetical):

```ts
export * from "./approve-puzzle-definition";
export * from "./create-catalog-category";
export * from "./disable-puzzle-definition";
export * from "./import-puzzle-from-url";
export * from "./reenable-puzzle-definition";
export * from "./reject-puzzle-definition";
export * from "./reorder-catalog-categories";
export * from "./run-definition-action";
export * from "./set-catalog-category-active";
export * from "./submit-puzzle-definition";
export * from "./update-catalog-category";
export * from "./update-puzzle-definition";
```

- [ ] Run to green: `pnpm --filter @jigswap/domain exec vitest run src/catalog/application/use-cases/puzzle-definition.spec.ts`, then the full domain suite `pnpm --filter @jigswap/domain exec vitest run` — all pass.
- [ ] Typecheck the domain: `pnpm --filter @jigswap/domain exec tsc --noEmit` — clean.
- [ ] Format: `pnpm exec prettier --write packages/domain/src/catalog/application/ports/in/moderate-puzzle-definition.port.ts packages/domain/src/catalog/application/use-cases/disable-puzzle-definition.ts packages/domain/src/catalog/application/use-cases/reenable-puzzle-definition.ts packages/domain/src/catalog/application/use-cases/index.ts packages/domain/src/catalog/application/use-cases/puzzle-definition.spec.ts`
- [ ] Commit:

```bash
git add packages/domain/src/catalog/application
git commit -m "feat(domain): disable/re-enable puzzle-definition use-cases and ports

Both reuse the shared runDefinitionAction load→act→save→publish wrapper;
the inbound ports mirror the approve/reject moderation port.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 — Library ACL: "disabled" is not acquirable (TDD)

The Library authorizes acquisition in `packages/domain/src/library/application/use-cases/acquire-copy.ts:33-37`: `context.status !== "approved" && !isOwnSubmission → PuzzleNotAcquirable`. Adding `"disabled"` to the ACL status type makes that guard cover disabled definitions with no logic change — prove it with a spec first.

**Files:**

- `packages/domain/src/library/application/use-cases/copy-use-cases.spec.ts` (add 2 tests inside `describe("makeAcquireCopy", ...)`, after the `"refuses to acquire someone else's pending submission"` test at line 117)
- `packages/domain/src/library/application/ports/out/catalog-snapshot.provider.ts` (line 6: extend `PuzzleApprovalStatus`)

**Steps:**

- [ ] Write the failing tests. In `packages/domain/src/library/application/use-cases/copy-use-cases.spec.ts`, append inside `describe("makeAcquireCopy", ...)` after the existing pending-submission refusal test:

```ts
it("refuses to acquire someone else's DISABLED definition (PuzzleNotAcquirable)", async () => {
  snapshots.seed(snapshot(), { status: "disabled", submitterId: bob });
  const result = await acquire()({
    ownerId: alice,
    puzzleDefinitionId: definitionId,
    condition: "good",
  });
  expect(result.isErr).toBe(true);
  if (result.isErr) expect(result.error.code).toBe("PuzzleNotAcquirable");
  expect(events.published).toHaveLength(0);
  expect(copies.size()).toBe(0);
});

// Existing carve-out preserved: like pending/rejected, the SUBMITTER may still log a copy
// of their own disabled submission.
it("lets a member acquire their OWN disabled submission", async () => {
  snapshots.seed(snapshot(), { status: "disabled", submitterId: alice });
  const result = await acquire()({
    ownerId: alice,
    puzzleDefinitionId: definitionId,
    condition: "good",
  });
  expect(result.isOk).toBe(true);
  expect(events.names()).toEqual(["CopyAcquired"]);
});
```

- [ ] Run and watch it fail: `pnpm --filter @jigswap/domain exec vitest run src/library/application/use-cases/copy-use-cases.spec.ts` — expected failure: TypeScript rejects `status: "disabled"` (`Type '"disabled"' is not assignable to type 'PuzzleApprovalStatus'` — vitest surfaces it as a transform/type error).
- [ ] Implement. In `packages/domain/src/library/application/ports/out/catalog-snapshot.provider.ts`, change line 6 to:

```ts
export type PuzzleApprovalStatus =
  "pending" | "approved" | "rejected" | "disabled";
```

(The comment above it already says "Mirrors the Catalog's own lifecycle" — still true.)

- [ ] Run to green: `pnpm --filter @jigswap/domain exec vitest run src/library/application/use-cases/copy-use-cases.spec.ts`, then `pnpm --filter @jigswap/domain exec vitest run` — all pass.
- [ ] Format: `pnpm exec prettier --write packages/domain/src/library/application/ports/out/catalog-snapshot.provider.ts packages/domain/src/library/application/use-cases/copy-use-cases.spec.ts`
- [ ] Commit:

```bash
git add packages/domain/src/library
git commit -m "feat(domain): library ACL treats disabled definitions as not acquirable

PuzzleApprovalStatus gains \"disabled\"; the existing !== \"approved\" guard in
makeAcquireCopy blocks new public acquisitions while the own-submission
carve-out keeps matching pending/rejected semantics.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4 — Backend schema unions + contracts + Activity Log type ripple

Growing the `moderationActions.kind` union ripples into the web Activity Log (`KIND_META` is a `Record<kind, ...>` — it stops typechecking without the new entries) and growing `puzzles.status` ripples into the contracts view DTOs. Do all union growth in one commit so every commit typechecks.

**Files:**

- `packages/backend/convex/schema.ts` (puzzles.status at lines 85–89; moderationActions.kind at lines 411–418)
- `packages/contracts/src/catalog/views.ts` (status unions at lines 39 and 61)
- `apps/web/src/components/admin/moderation/activity-log.tsx` (KIND_META at lines 28–35; lucide imports at lines 14–21)
- `apps/web/locales/source.json`, `apps/web/locales/en.json`, `apps/web/locales/nl.json` (`admin.moderation.activity` kind sentences)

**Steps:**

- [ ] In `packages/backend/convex/schema.ts`, extend the `puzzles.status` union (lines 85–89) to:

```ts
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("disabled"),
    ),
```

- [ ] In the same file, extend `moderationActions.kind` (lines 411–418) to:

```ts
    kind: v.union(
      v.literal("definition_approved"),
      v.literal("definition_rejected"),
      v.literal("definition_edited_approved"),
      v.literal("definition_disabled"),
      v.literal("definition_reenabled"),
      v.literal("photo_restored"),
      v.literal("photo_removal_confirmed"),
      v.literal("photo_auto_rejected"),
    ),
```

- [ ] In `packages/contracts/src/catalog/views.ts`, change BOTH status fields (line 39 in `PuzzleDefinitionView`, line 61 in `PuzzleSummaryView`) to:

```ts
status: "pending" | "approved" | "rejected" | "disabled";
```

- [ ] In `apps/web/src/components/admin/moderation/activity-log.tsx`, add `Eye` and `EyeOff` to the lucide import (lines 14–21):

```ts
import {
  CheckCircle,
  Eye,
  EyeOff,
  Flag,
  type LucideIcon,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
```

and add the two entries to `KIND_META` (after `definition_rejected`):

```ts
const KIND_META: Record<ActivityRow["kind"], [LucideIcon, string]> = {
  definition_approved: [CheckCircle, "text-jigsaw-success"],
  definition_edited_approved: [CheckCircle, "text-jigsaw-success"],
  definition_rejected: [XCircle, "text-destructive"],
  definition_disabled: [EyeOff, "text-jigsaw-warning"],
  definition_reenabled: [Eye, "text-jigsaw-success"],
  photo_removal_confirmed: [Trash2, "text-destructive"],
  photo_auto_rejected: [Flag, "text-jigsaw-warning"],
  photo_restored: [Undo2, "text-muted-foreground"],
};
```

- [ ] Add the activity sentences. In BOTH `apps/web/locales/source.json` and `apps/web/locales/en.json`, inside `admin.moderation.activity` (after the `"definition_rejected"` key):

```json
"definition_disabled": "<strong>{actor}</strong> disabled <strong>{target}</strong>",
"definition_reenabled": "<strong>{actor}</strong> re-enabled <strong>{target}</strong>",
```

In `apps/web/locales/nl.json`, same position:

```json
"definition_disabled": "<strong>{actor}</strong> schakelde <strong>{target}</strong> uit",
"definition_reenabled": "<strong>{actor}</strong> schakelde <strong>{target}</strong> weer in",
```

- [ ] Verify the backend typechecks with the wider unions: `pnpm --filter @jigswap/backend exec tsc --noEmit` — clean. (The `library/adapters/convexCatalogSnapshotProvider.ts` `status: row.status` mapping now compiles because Task 3 widened `PuzzleApprovalStatus`; `catalog/adapters/mapper.ts` passes `status` straight through and compiles because Task 1 widened the domain `ApprovalStatus`. No `_generated` edit is needed for schema-only changes.)
- [ ] Verify contracts + backend tests still pass: `pnpm --filter @jigswap/backend exec vitest run` — all pass (no behavior changed yet).
- [ ] Format: `pnpm exec prettier --write packages/backend/convex/schema.ts packages/contracts/src/catalog/views.ts apps/web/src/components/admin/moderation/activity-log.tsx apps/web/locales/source.json apps/web/locales/en.json apps/web/locales/nl.json`
- [ ] Commit:

```bash
git add packages/backend/convex/schema.ts packages/contracts/src/catalog/views.ts apps/web/src/components/admin/moderation/activity-log.tsx apps/web/locales/source.json apps/web/locales/en.json apps/web/locales/nl.json
git commit -m "feat(backend): disabled status + disable/reenable audit kinds in schema

puzzles.status and moderationActions.kind unions grow; contracts view DTOs
and the moderation Activity Log (icons + en/nl sentences) follow the types.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5 — Convex mutations: disable/reenable + audit stamps + KPI guard (TDD)

Mirror `catalog/approvePuzzleDefinition.ts` / `rejectPuzzleDefinition.ts` EXACTLY. Also fix a latent KPI mis-count: `admin/getModerationStats.ts:34-37` counts any non-approve/reject kind into `flagsCleared` via a bare `else`, and line 38 feeds every `definition_*` stamp into `avgReviewMins` — the new lifecycle kinds must be excluded from both (they are toggles, not review decisions).

**Files:**

- `packages/backend/convex/adminPuzzleLifecycle.test.ts` (new, at the convex/ ROOT)
- `packages/backend/convex/admin/stampModerationAction.ts` (extend local `ModerationKind` union, lines 4–10)
- `packages/backend/convex/catalog/disablePuzzleDefinition.ts` (new)
- `packages/backend/convex/catalog/reenablePuzzleDefinition.ts` (new)
- `packages/backend/convex/admin/getModerationStats.ts` (loop at lines 26–50)
- `packages/backend/convex/_generated/api.d.ts` (hand-register the 2 new modules — see worktree caveat)

**Steps:**

- [ ] Write the failing test file `packages/backend/convex/adminPuzzleLifecycle.test.ts`:

```ts
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Reversible disable lifecycle: an admin disables an approved definition (hiding it from
// public surfaces) and can re-enable it. Each mutation is admin-gated, flips ONLY the status,
// stamps one append-only moderationActions row, and appends the domain event to the durable
// outbox. Nothing is deleted.

// Seed a single member; the Clerk subject maps to the user via by_clerk_id.
const seedMember = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

// Alice submits a pending definition, returning the aggregateId.
const submitPending = async (t: ReturnType<typeof convexTest>) => {
  const id = await asAlice(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", pieceCount: 1000 },
  );
  return id as string;
};

// Submit + approve, returning an APPROVED definition's aggregateId.
const submitApproved = async (t: ReturnType<typeof convexTest>) => {
  const id = await submitPending(t);
  await asAdmin(t).mutation(
    api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
    { puzzleDefinitionId: id },
  );
  return id;
};

const puzzleRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const allActions = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

const outboxNames = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) =>
    (await ctx.db.query("domainEvents").collect()).map((e) => e.name),
  );

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<unknown>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

describe("catalog.disablePuzzleDefinition", () => {
  test("is admin-gated: unauthenticated and non-admin members are rejected", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await submitApproved(t);

    await expect(
      t.mutation(api.catalog.disablePuzzleDefinition.disablePuzzleDefinition, {
        puzzleDefinitionId: id,
      }),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      asAlice(t).mutation(
        api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("flips approved → disabled, stamps definition_disabled, appends the outbox event", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const id = await submitApproved(t);

    await asAdmin(t).mutation(
      api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
      { puzzleDefinitionId: id },
    );

    const row = await puzzleRow(t, id);
    expect(row?.status).toBe("disabled");

    // Audit rows are append-only: the approve stamp is still there, plus the new one.
    const actions = await allActions(t);
    expect(actions).toHaveLength(2);
    expect(actions[1]).toMatchObject({
      actorId: alice,
      kind: "definition_disabled",
      targetLabel: "Mountain Vista",
      targetId: id,
    });

    expect(await outboxNames(t)).toContain("PuzzleDefinitionDisabled");
  });

  test("disabling a PENDING definition is an illegal transition and stamps nothing", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await submitPending(t);

    await expectConvexCode(
      asAdmin(t).mutation(
        api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
      "IllegalApprovalTransition",
    );
    expect(await allActions(t)).toHaveLength(0);
    expect((await puzzleRow(t, id))?.status).toBe("pending");
  });
});

describe("catalog.reenablePuzzleDefinition", () => {
  test("is admin-gated: unauthenticated and non-admin members are rejected", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await submitApproved(t);
    await asAdmin(t).mutation(
      api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
      { puzzleDefinitionId: id },
    );

    await expect(
      t.mutation(
        api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      asAlice(t).mutation(
        api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("flips disabled → approved, stamps definition_reenabled, appends the outbox event", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const id = await submitApproved(t);
    await asAdmin(t).mutation(
      api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
      { puzzleDefinitionId: id },
    );

    await asAdmin(t).mutation(
      api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
      { puzzleDefinitionId: id },
    );

    const row = await puzzleRow(t, id);
    expect(row?.status).toBe("approved");

    const actions = await allActions(t);
    expect(actions).toHaveLength(3); // approve + disable + reenable, append-only
    expect(actions[2]).toMatchObject({
      actorId: alice,
      kind: "definition_reenabled",
      targetLabel: "Mountain Vista",
      targetId: id,
    });

    expect(await outboxNames(t)).toContain("PuzzleDefinitionReenabled");
  });

  test("re-enabling a definition that is not disabled is an illegal transition and stamps nothing", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await submitApproved(t);

    await expectConvexCode(
      asAdmin(t).mutation(
        api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
      "IllegalApprovalTransition",
    );
    expect(await allActions(t)).toHaveLength(1); // only the approve stamp
    expect((await puzzleRow(t, id))?.status).toBe("approved");
  });
});

describe("getModerationStats ignores lifecycle toggles", () => {
  test("definition_disabled / definition_reenabled feed no KPI bucket and no review-time sample", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("moderationActions", {
        kind: "definition_disabled",
        targetLabel: "Some Puzzle",
        targetId: "target-1",
        at: now - 1000,
      });
      await ctx.db.insert("moderationActions", {
        kind: "definition_reenabled",
        targetLabel: "Some Puzzle",
        targetId: "target-1",
        at: now - 2000,
      });
    });

    const stats = await asAdmin(t).query(
      api.admin.getModerationStats.getModerationStats,
      {},
    );
    expect(stats).toMatchObject({
      approved: 0,
      rejected: 0,
      flagsCleared: 0,
    });
    expect(stats.avgReviewMins).toBeNull();
  });
});
```

- [ ] Run and watch it fail: `pnpm --filter @jigswap/backend exec vitest run convex/adminPuzzleLifecycle.test.ts` — expected failure: convex-test cannot find the function module (`Could not find … catalog/disablePuzzleDefinition`), and the stats test fails on `flagsCleared: 2`.
- [ ] Extend the local kind union in `packages/backend/convex/admin/stampModerationAction.ts` (lines 4–10):

```ts
type ModerationKind =
  | "definition_approved"
  | "definition_rejected"
  | "definition_edited_approved"
  | "definition_disabled"
  | "definition_reenabled"
  | "photo_restored"
  | "photo_removal_confirmed"
  | "photo_auto_rejected";
```

- [ ] Create `packages/backend/convex/catalog/disablePuzzleDefinition.ts`:

```ts
import { makeDisablePuzzleDefinition } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { runDefinitionAction } from "./runDefinitionAction";

// Moderation: reversibly disable an APPROVED definition, hiding it from public browse/search.
// Only the status flips — nothing is deleted, and existing owned copies keep rendering from
// their cached snapshots. The aggregate enforces the legal approval transition.
export const disablePuzzleDefinition = mutation({
  args: { puzzleDefinitionId: v.string() },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    await runDefinitionAction(
      ctx,
      args.puzzleDefinitionId,
      makeDisablePuzzleDefinition,
    );
    // Audit trail: the domain event carries no actor, so the composition root stamps the
    // decision with the acting admin. The action succeeded, so the row exists.
    const row = await ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.puzzleDefinitionId),
      )
      .unique();
    await stampModerationAction(ctx, {
      actorId: memberId as unknown as Id<"users">,
      kind: "definition_disabled",
      targetLabel: row?.title ?? args.puzzleDefinitionId,
      targetId: args.puzzleDefinitionId,
    });
  },
});
```

- [ ] Create `packages/backend/convex/catalog/reenablePuzzleDefinition.ts`:

```ts
import { makeReenablePuzzleDefinition } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { runDefinitionAction } from "./runDefinitionAction";

// Moderation: re-enable a DISABLED definition, restoring it to approved (publicly listable
// again). The aggregate enforces the legal approval transition.
export const reenablePuzzleDefinition = mutation({
  args: { puzzleDefinitionId: v.string() },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    await runDefinitionAction(
      ctx,
      args.puzzleDefinitionId,
      makeReenablePuzzleDefinition,
    );
    // Audit trail: the domain event carries no actor, so the composition root stamps the
    // decision with the acting admin. The action succeeded, so the row exists.
    const row = await ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.puzzleDefinitionId),
      )
      .unique();
    await stampModerationAction(ctx, {
      actorId: memberId as unknown as Id<"users">,
      kind: "definition_reenabled",
      targetLabel: row?.title ?? args.puzzleDefinitionId,
      targetId: args.puzzleDefinitionId,
    });
  },
});
```

- [ ] Guard the KPI read model. In `packages/backend/convex/admin/getModerationStats.ts`, replace the loop body (lines 26–50) with:

```ts
for (const row of rows) {
  if (
    row.kind === "definition_approved" ||
    row.kind === "definition_edited_approved"
  ) {
    approved += 1;
  } else if (row.kind === "definition_rejected") {
    rejected += 1;
  } else if (row.kind.startsWith("photo_")) {
    // photo_restored | photo_removal_confirmed | photo_auto_rejected
    flagsCleared += 1;
  }
  // definition_disabled / definition_reenabled are reversible lifecycle toggles, not
  // review decisions: they appear in the Activity Log but feed no KPI bucket and no
  // review-time sample.
  if (
    row.kind === "definition_approved" ||
    row.kind === "definition_edited_approved" ||
    row.kind === "definition_rejected"
  ) {
    // Approximation: review time = decision time minus the submission's createdAt.
    // The decision row's targetId is the puzzle's Catalog aggregateId; a since-deleted
    // puzzle simply contributes no sample.
    const puzzle = await ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.targetId))
      .unique();
    if (puzzle) reviewMins.push((row.at - puzzle.createdAt) / 60_000);
  }
}
```

- [ ] Hand-register the two new modules in `packages/backend/convex/_generated/api.d.ts` (worktree caveat above). Add import lines in alphabetical order among the `catalog_*` imports:

```ts
import type * as catalog_disablePuzzleDefinition from "../catalog/disablePuzzleDefinition.js";
```

(after `catalog_createCatalogCategory`, before `catalog_errors`), and

```ts
import type * as catalog_reenablePuzzleDefinition from "../catalog/reenablePuzzleDefinition.js";
```

(after `catalog_rejectPuzzleDefinition`... note alphabetical: `reenable` < `reject`, so it goes right BEFORE `catalog_rejectPuzzleDefinition`). Then add the matching entries inside `declare const fullApi: ApiFromModules<{ ... }>`:

```ts
  "catalog/disablePuzzleDefinition": typeof catalog_disablePuzzleDefinition;
```

(after `"catalog/createCatalogCategory"`), and

```ts
  "catalog/reenablePuzzleDefinition": typeof catalog_reenablePuzzleDefinition;
```

(right before `"catalog/rejectPuzzleDefinition"`).

- [ ] Run to green: `pnpm --filter @jigswap/backend exec vitest run convex/adminPuzzleLifecycle.test.ts` — all pass. Then guard against KPI regressions: `pnpm --filter @jigswap/backend exec vitest run convex/moderationActions.test.ts` — all pass (the stats bucketing tests at lines 247–334 must be unaffected).
- [ ] Typecheck: `pnpm --filter @jigswap/backend exec tsc --noEmit` — clean.
- [ ] Format: `pnpm exec prettier --write packages/backend/convex/adminPuzzleLifecycle.test.ts packages/backend/convex/admin/stampModerationAction.ts packages/backend/convex/catalog/disablePuzzleDefinition.ts packages/backend/convex/catalog/reenablePuzzleDefinition.ts packages/backend/convex/admin/getModerationStats.ts packages/backend/convex/_generated/api.d.ts`
- [ ] Commit:

```bash
git add packages/backend/convex/adminPuzzleLifecycle.test.ts packages/backend/convex/admin/stampModerationAction.ts packages/backend/convex/catalog/disablePuzzleDefinition.ts packages/backend/convex/catalog/reenablePuzzleDefinition.ts packages/backend/convex/admin/getModerationStats.ts packages/backend/convex/_generated/api.d.ts
git commit -m "feat(backend): disable/reenable puzzle-definition mutations with audit stamps

Admin gate → runDefinitionAction → stampModerationAction, mirroring
approve/reject exactly; getModerationStats excludes the new lifecycle
kinds from KPI buckets and review-time samples. _generated/api.d.ts is
hand-registered (codegen needs a live deployment).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6 — Admin list read model + contracts DTO + gateway wiring (TDD)

**Files:**

- `packages/backend/convex/adminListPuzzleDefinitions.test.ts` (new, at the convex/ ROOT)
- `packages/contracts/src/catalog/views.ts` (append the row DTO)
- `packages/backend/convex/admin/listPuzzleDefinitions.ts` (new; distinct-owner pattern from `library/getPuzzleDefinitionView.ts:132-140`; pagination pattern from `catalog/listAllPuzzles.ts`; gate pattern from `admin/getModerationActivity.ts`)
- `packages/backend/convex/_generated/api.d.ts` (hand-register the new module)
- `packages/gateway/src/operations.ts` (catalog namespace lines 19–20; admin namespace lines 315–322)

**Steps:**

- [ ] Write the failing test file `packages/backend/convex/adminListPuzzleDefinitions.test.ts`:

```ts
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Admin read model over ALL definitions regardless of status (the public lists filter to
// approved), newest first, paginated, with submitter name and distinct-owner count joined in.

const seedMember = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

// One puzzle per status, inserted oldest→newest so order("desc") returns the reverse.
const seedPuzzles = (t: ReturnType<typeof convexTest>, alice: Id<"users">) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const statuses = ["approved", "pending", "rejected", "disabled"] as const;
    const ids: Id<"puzzles">[] = [];
    for (const [i, status] of statuses.entries()) {
      ids.push(
        await ctx.db.insert("puzzles", {
          aggregateId: `agg-${status}`,
          title: `Puzzle ${status}`,
          pieceCount: 500 + i,
          status,
          submittedBy: alice,
          createdAt: now + i,
          updatedAt: now + i,
        }),
      );
    }
    return ids;
  });

const listPage = (
  t: ReturnType<typeof convexTest>,
  paginationOpts: { numItems: number; cursor: string | null },
) =>
  asAdmin(t).query(api.admin.listPuzzleDefinitions.listPuzzleDefinitions, {
    paginationOpts,
  });

describe("admin.listPuzzleDefinitions", () => {
  test("is admin-gated: unauthenticated and non-admin members are rejected", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await expect(
      t.query(api.admin.listPuzzleDefinitions.listPuzzleDefinitions, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      asAlice(t).query(api.admin.listPuzzleDefinitions.listPuzzleDefinitions, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("returns EVERY status newest-first with submitter name joined in", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    await seedPuzzles(t, alice);

    const result = await listPage(t, { numItems: 10, cursor: null });
    expect(result.isDone).toBe(true);
    expect(result.page.map((row) => row.status)).toEqual([
      "disabled",
      "rejected",
      "pending",
      "approved",
    ]);
    expect(result.page[0]).toMatchObject({
      aggregateId: "agg-disabled",
      title: "Puzzle disabled",
      pieceCount: 503,
      submitterName: "Alice",
      ownerCount: 0,
      image: null,
    });
    expect(typeof result.page[0].createdAt).toBe("number");
  });

  test("counts DISTINCT owners per definition", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const [approvedId] = await seedPuzzles(t, alice);

    await t.run(async (ctx) => {
      const now = Date.now();
      const bob = await ctx.db.insert("users", {
        clerkId: "clerk_bob",
        email: "bob@example.com",
        name: "Bob",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const copy = (ownerId: Id<"users">) =>
        ctx.db.insert("ownedPuzzles", {
          puzzleId: approvedId,
          ownerId,
          condition: "good",
          availability: { forTrade: false, forSale: false, forLend: false },
          snapshot: { title: "Puzzle approved", pieceCount: 500 },
          createdAt: now,
          updatedAt: now,
        });
      // Alice owns TWO copies, Bob one: distinct owners = 2.
      await copy(alice);
      await copy(alice);
      await copy(bob);
    });

    const result = await listPage(t, { numItems: 10, cursor: null });
    const approved = result.page.find((row) => row.status === "approved");
    expect(approved?.ownerCount).toBe(2);
  });

  test("paginates with a continue cursor", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    await seedPuzzles(t, alice);

    const first = await listPage(t, { numItems: 3, cursor: null });
    expect(first.page).toHaveLength(3);
    expect(first.isDone).toBe(false);

    const second = await listPage(t, {
      numItems: 3,
      cursor: first.continueCursor,
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
    expect(second.page[0].status).toBe("approved");
  });
});
```

- [ ] Run and watch it fail: `pnpm --filter @jigswap/backend exec vitest run convex/adminListPuzzleDefinitions.test.ts` — expected failure: convex-test cannot find `admin/listPuzzleDefinitions`.
- [ ] Add the contracts DTO. In `packages/contracts/src/catalog/views.ts`, append after `PuzzleCategoryView` (after line 78):

```ts
/**
 * One row of the admin puzzle-definitions console (`admin.listPuzzleDefinitions`): catalog
 * facts plus admin metadata (submitter display name, distinct-owner count, resolved thumbnail
 * URL). Unlike the public views it carries EVERY moderation status. Disable/re-enable actions
 * key on `aggregateId`; legacy rows without one still render but their actions are disabled.
 */
export interface AdminPuzzleDefinitionRowView {
  _id: DocId;
  aggregateId?: string;
  title: string;
  brand?: string;
  pieceCount: number;
  status: "pending" | "approved" | "rejected" | "disabled";
  createdAt: number;
  submitterName: string | null;
  image: string | null;
  ownerCount: number;
}
```

- [ ] Create `packages/backend/convex/admin/listPuzzleDefinitions.ts`:

```ts
import type { AdminPuzzleDefinitionRowView } from "@jigswap/contracts";
import { type PaginationResult, paginationOptsValidator } from "convex/server";
import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// Admin read model: EVERY catalog definition regardless of status, newest first, paginated.
// The public lists filter to approved; this console must also show pending/rejected/disabled.
// Each row joins the admin metadata the /admin/puzzles table renders: submitter display name,
// resolved thumbnail URL, and the distinct-owner count (ownedPuzzles.by_puzzle → dedupe
// ownerId, the getPuzzleDefinitionView pattern). Admin-only, gated exactly like
// getModerationActivity.
export const listPuzzleDefinitions = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (
    ctx,
    args,
  ): Promise<PaginationResult<AdminPuzzleDefinitionRowView>> => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const puzzles = await ctx.db
      .query("puzzles")
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      puzzles.page.map(
        async (puzzle): Promise<AdminPuzzleDefinitionRowView> => {
          const owned = await ctx.db
            .query("ownedPuzzles")
            .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzle._id))
            .collect();
          const distinctOwners = new Set(
            owned.map((copy) => copy.ownerId as unknown as string),
          );
          const submitter = await ctx.db.get(puzzle.submittedBy);
          return {
            _id: puzzle._id as string,
            aggregateId: puzzle.aggregateId,
            title: puzzle.title,
            brand: puzzle.brand,
            pieceCount: puzzle.pieceCount,
            status: puzzle.status,
            createdAt: puzzle.createdAt,
            submitterName: submitter?.name ?? null,
            image: puzzle.image ? await ctx.storage.getUrl(puzzle.image) : null,
            ownerCount: distinctOwners.size,
          };
        },
      ),
    );

    return { ...puzzles, page };
  },
});
```

- [ ] Hand-register in `packages/backend/convex/_generated/api.d.ts`: import line (alphabetical — `listPuzzleDefinitions` sorts before `listRejectedPhotos`):

```ts
import type * as admin_listPuzzleDefinitions from "../admin/listPuzzleDefinitions.js";
```

(between `admin_getModerationStats` and `admin_listRejectedPhotos`), and the fullApi entry:

```ts
  "admin/listPuzzleDefinitions": typeof admin_listPuzzleDefinitions;
```

(between `"admin/getModerationStats"` and `"admin/listRejectedPhotos"`).

- [ ] Run to green: `pnpm --filter @jigswap/backend exec vitest run convex/adminListPuzzleDefinitions.test.ts` — all pass.
- [ ] Wire the gateway. In `packages/gateway/src/operations.ts`:
  - In the `catalog` namespace, directly after `reject: api.catalog.rejectPuzzleDefinition.rejectPuzzleDefinition,` (line 20) add:

```ts
    // Reversible admin lifecycle on an approved definition (audit-stamped; nothing deleted).
    disable: api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
    reenable: api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
```

- In the `admin` namespace (lines 315–322), after `getModerationActivity` add:

```ts
    // Every catalog definition regardless of status, for the /admin/puzzles console.
    listPuzzleDefinitions:
      api.admin.listPuzzleDefinitions.listPuzzleDefinitions,
```

- [ ] Typecheck backend + gateway: `pnpm --filter @jigswap/backend exec tsc --noEmit && pnpm --filter @jigswap/gateway exec tsc --noEmit` (if the gateway package has no local tsc script, `pnpm exec nx run-many -t type-check --skip-nx-cache` covers it) — clean.
- [ ] Format: `pnpm exec prettier --write packages/backend/convex/adminListPuzzleDefinitions.test.ts packages/backend/convex/admin/listPuzzleDefinitions.ts packages/contracts/src/catalog/views.ts packages/gateway/src/operations.ts packages/backend/convex/_generated/api.d.ts`
- [ ] Commit:

```bash
git add packages/backend/convex/adminListPuzzleDefinitions.test.ts packages/backend/convex/admin/listPuzzleDefinitions.ts packages/contracts/src/catalog/views.ts packages/gateway/src/operations.ts packages/backend/convex/_generated/api.d.ts
git commit -m "feat(backend): admin listPuzzleDefinitions read model + gateway wiring

Paginated, admin-gated list over ALL statuses with submitter name,
thumbnail URL and distinct-owner count; typed AdminPuzzleDefinitionRowView
contract; disable/reenable join the gateway catalog namespace.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7 — Visibility invariant tests (disable → hidden → re-enable)

The spec expects these to fall out of existing filters — VERIFY, then lock with tests.

**Files:**

- `packages/backend/convex/disabledDefinitionInvariants.test.ts` (new, at the convex/ ROOT)

**Steps:**

- [ ] Verification grep (no code change): run

```bash
grep -rn '"approved"' packages/backend/convex --include="*.ts" | grep -v _generated | grep -v ".test.ts" | grep -v moderationStatus
```

and confirm every PUBLIC puzzle read filters `status === "approved"` (so `"disabled"` rows are excluded automatically). Expected list of definition-status sites — check each one:

- `catalog/listAllPuzzles.ts:14` (`.filter(q.eq(status,"approved"))`)
- `catalog/getRecentPuzzles.ts:15`
- `catalog/getPuzzleSuggestions.ts:19` (search index `.eq("status","approved")`)
- `catalog/getAllBrands.ts:17` / `catalog/getAllTags.ts:17`
- `catalog/getPuzzleById.ts:37` (non-approved disclosed only to submitter/admin)
- `catalog/findPuzzleByBarcode.ts:28`
- `catalog/listMyContributedPuzzles.ts:25` (`!== "approved"` → a member's own disabled submission shows in "my contributions"; acceptable, it IS theirs)
- `search/globalSearch.ts:55`
- `insights/getRecommendations.ts:72` / `insights/getPlankPuzzles.ts:47`
  If any public surface does NOT filter, stop and report — do not silently patch unrelated queries.
- [ ] Write the invariants test file `packages/backend/convex/disabledDefinitionInvariants.test.ts`:

```ts
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// End-to-end invariants of the reversible disable lifecycle, exercised through the REAL
// mutations: a disabled definition disappears from every public browse/search surface and
// cannot be newly acquired by other members, while existing owned copies (cached snapshots)
// are untouched. Re-enabling restores public visibility and acquirability.

const seedMembers = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

// Alice submits, admin approves. Returns the aggregateId.
const seedApprovedDefinition = async (t: ReturnType<typeof convexTest>) => {
  const id = (await asAlice(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", brand: "Ravensburger", pieceCount: 1000 },
  )) as string;
  await asAdmin(t).mutation(
    api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
    { puzzleDefinitionId: id },
  );
  return id;
};

const disable = (t: ReturnType<typeof convexTest>, id: string) =>
  asAdmin(t).mutation(
    api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
    { puzzleDefinitionId: id },
  );

const reenable = (t: ReturnType<typeof convexTest>, id: string) =>
  asAdmin(t).mutation(
    api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
    { puzzleDefinitionId: id },
  );

const browseTitles = async (t: ReturnType<typeof convexTest>) => {
  const result = await t.query(api.catalog.listAllPuzzles.listAllPuzzles, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  return result.page.map((p) => p.title);
};

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<unknown>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

describe("disabled definitions leave every public surface", () => {
  test("browse (listAllPuzzles) hides a disabled definition and shows it again after re-enable", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await seedApprovedDefinition(t);

    expect(await browseTitles(t)).toEqual(["Mountain Vista"]);
    await disable(t, id);
    expect(await browseTitles(t)).toEqual([]);
    await reenable(t, id);
    expect(await browseTitles(t)).toEqual(["Mountain Vista"]);
  });

  test("search suggestions (search-index filter) hide a disabled definition", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await seedApprovedDefinition(t);

    const before = await t.query(
      api.catalog.getPuzzleSuggestions.getPuzzleSuggestions,
      { searchTerm: "mountain" },
    );
    expect(before.map((p) => p.title)).toEqual(["Mountain Vista"]);

    await disable(t, id);
    const after = await t.query(
      api.catalog.getPuzzleSuggestions.getPuzzleSuggestions,
      { searchTerm: "mountain" },
    );
    expect(after).toEqual([]);
  });

  test("getPuzzleById discloses a disabled definition only to its submitter or an admin", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await seedApprovedDefinition(t);
    await disable(t, id);

    const puzzleId = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("puzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
        .unique();
      return row!._id;
    });

    expect(
      await asBob(t).query(api.catalog.getPuzzleById.getPuzzleById, {
        puzzleId,
      }),
    ).toBeNull();
    expect(
      await asAlice(t).query(api.catalog.getPuzzleById.getPuzzleById, {
        puzzleId,
      }),
    ).not.toBeNull(); // submitter keeps visibility of their own submission
  });
});

describe("acquisition ACL", () => {
  test("another member cannot acquire a disabled definition (PuzzleNotAcquirable), but can after re-enable", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await seedApprovedDefinition(t);
    await disable(t, id);

    await expectConvexCode(
      asBob(t).mutation(api.library.acquireCopy.acquireCopy, {
        puzzleDefinitionId: id,
        condition: "good",
      }),
      "PuzzleNotAcquirable",
    );

    await reenable(t, id);
    const copyId = await asBob(t).mutation(
      api.library.acquireCopy.acquireCopy,
      {
        puzzleDefinitionId: id,
        condition: "good",
      },
    );
    expect(typeof copyId).toBe("string");
  });

  test("existing owned copies are untouched by disable (cached snapshot keeps rendering)", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await seedApprovedDefinition(t);

    // Bob acquires BEFORE the disable.
    const copyId = (await asBob(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: id, condition: "good" },
    )) as string;

    await disable(t, id);

    const copy = await t.run(async (ctx) =>
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique(),
    );
    expect(copy).not.toBeNull();
    expect(copy?.snapshot).toMatchObject({
      title: "Mountain Vista",
      pieceCount: 1000,
    });
  });
});
```

- [ ] Run: `pnpm --filter @jigswap/backend exec vitest run convex/disabledDefinitionInvariants.test.ts` — expected: ALL PASS on first run (the invariants fall out of existing filters + Tasks 1–6; the `ownedPuzzles.by_aggregate_id` index lookup matches `libraryMutations.test.ts`'s `copyRow` helper at line 78). If any test fails, a public surface leaks disabled rows: STOP, report the failing surface, and fix only that filter with a matching test assertion.
- [ ] Run the full backend suite: `pnpm --filter @jigswap/backend exec vitest run` — all pass.
- [ ] Format: `pnpm exec prettier --write packages/backend/convex/disabledDefinitionInvariants.test.ts`
- [ ] Commit:

```bash
git add packages/backend/convex/disabledDefinitionInvariants.test.ts
git commit -m "test(backend): disabled-definition visibility + acquisition invariants

Disable hides the definition from browse/search/by-id (except submitter
and admin) and blocks new acquisitions by others; existing copies keep
their cached snapshot; re-enable restores everything.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8 — Frontend: nav entry, /admin/puzzles route, confirm dialogs, i18n

**Files:**

- `apps/web/src/components/dashboard-layout/route-meta.ts` (`ADMIN_GROUP` items at lines 93–103; `ROUTE_META` admin block at lines 164–169)
- `apps/web/src/routes/_dashboard/admin/puzzles.tsx` (new; structural reference `categories.tsx`/`moderation.tsx`; confirm pattern from `components/admin/category-list.tsx:195-230`)
- `apps/web/locales/source.json`, `apps/web/locales/en.json`, `apps/web/locales/nl.json` (`shell.pages.adminPuzzles` + new `admin.puzzles` namespace)

Notes: there is NO `components/ui/table.tsx` in this repo — render the table as a bordered `rounded-xl border bg-card` row list (the `category-list.tsx`/`activity-log.tsx` idiom). `Badge` exists (`components/ui/badge.tsx`, variants default/secondary/destructive/outline). Pagination uses the sanctioned `usePaginatedQuery` exception from `convex/react` (precedent: `components/puzzles/puzzle-client.tsx:11,51`), with a Load-more button. The admin route group gate (`routes/_dashboard/admin/route.tsx`) already covers the new child route — no gate work needed. `GroupLanding` on `/admin` picks up the new `ADMIN_GROUP` item automatically.

**Steps:**

- [ ] Add the nav entry. In `apps/web/src/components/dashboard-layout/route-meta.ts` (the `Puzzle` lucide icon is already imported at line 24), insert into `ADMIN_GROUP.items` after the moderation entry:

```ts
  items: [
    { key: "adminModeration", href: "/admin/moderation", icon: Gavel },
    { key: "adminPuzzles", href: "/admin/puzzles", icon: Puzzle },
    { key: "adminCategories", href: "/admin/categories", icon: Tags },
    { key: "adminContact", href: "/admin/contact", icon: Mail },
    { key: "adminFeedback", href: "/admin/feedback", icon: ThumbsUp },
  ],
```

and into `ROUTE_META`'s admin block (after the `/admin/moderation` line):

```ts
  "/admin/puzzles": { pageKey: "adminPuzzles", group: "admin" },
```

- [ ] Add the shell page strings. In BOTH `apps/web/locales/source.json` and `apps/web/locales/en.json`, inside `shell.pages` after `adminModeration`:

```json
"adminPuzzles": {
  "title": "Puzzles",
  "subtitle": "Every catalog definition with its moderation status; disable or re-enable approved definitions.",
  "description": "Browse all puzzle definitions and manage their lifecycle"
},
```

In `apps/web/locales/nl.json`, same position:

```json
"adminPuzzles": {
  "title": "Puzzels",
  "subtitle": "Alle catalogusdefinities met hun moderatiestatus; schakel goedgekeurde definities uit of weer in.",
  "description": "Blader door alle puzzeldefinities en beheer hun levenscyclus"
},
```

- [ ] Add the page namespace. In BOTH `apps/web/locales/source.json` and `apps/web/locales/en.json`, inside the top-level `admin` object (as a sibling of `moderation`/`categories`):

```json
"puzzles": {
  "loading": "Loading puzzle definitions…",
  "empty": {
    "title": "No puzzle definitions yet",
    "description": "Submitted puzzle definitions will appear here with their moderation status."
  },
  "pieces": "{count} pieces",
  "submittedBy": "by {name}",
  "ownerCount": "{count, plural, one {# owner} other {# owners}}",
  "status": {
    "pending": "Pending",
    "approved": "Approved",
    "rejected": "Rejected",
    "disabled": "Disabled"
  },
  "disable": "Disable",
  "reenable": "Re-enable",
  "disableConfirmTitle": "Disable “{title}”?",
  "disableConfirmBody": "The puzzle disappears from browse and search and can no longer be added to collections. Existing copies are not affected. You can re-enable it at any time.",
  "reenableConfirmTitle": "Re-enable “{title}”?",
  "reenableConfirmBody": "The puzzle becomes publicly visible and acquirable again.",
  "disableSuccess": "“{title}” disabled",
  "disableError": "Could not disable the puzzle. Please try again.",
  "reenableSuccess": "“{title}” re-enabled",
  "reenableError": "Could not re-enable the puzzle. Please try again.",
  "loadMore": "Load more"
},
```

In `apps/web/locales/nl.json`, same position:

```json
"puzzles": {
  "loading": "Puzzeldefinities laden…",
  "empty": {
    "title": "Nog geen puzzeldefinities",
    "description": "Ingediende puzzeldefinities verschijnen hier met hun moderatiestatus."
  },
  "pieces": "{count} stukjes",
  "submittedBy": "door {name}",
  "ownerCount": "{count, plural, one {# eigenaar} other {# eigenaren}}",
  "status": {
    "pending": "In afwachting",
    "approved": "Goedgekeurd",
    "rejected": "Afgewezen",
    "disabled": "Uitgeschakeld"
  },
  "disable": "Uitschakelen",
  "reenable": "Weer inschakelen",
  "disableConfirmTitle": "“{title}” uitschakelen?",
  "disableConfirmBody": "De puzzel verdwijnt uit bladeren en zoeken en kan niet meer aan collecties worden toegevoegd. Bestaande exemplaren blijven onaangetast. Je kunt de puzzel altijd weer inschakelen.",
  "reenableConfirmTitle": "“{title}” weer inschakelen?",
  "reenableConfirmBody": "De puzzel wordt weer openbaar zichtbaar en kan weer worden toegevoegd.",
  "disableSuccess": "“{title}” uitgeschakeld",
  "disableError": "Kon de puzzel niet uitschakelen. Probeer het opnieuw.",
  "reenableSuccess": "“{title}” weer ingeschakeld",
  "reenableError": "Kon de puzzel niet weer inschakelen. Probeer het opnieuw.",
  "loadMore": "Meer laden"
},
```

- [ ] Create the route `apps/web/src/routes/_dashboard/admin/puzzles.tsx`:

```tsx
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import type { AdminPuzzleDefinitionRowView } from "@jigswap/contracts";
import { useMutation } from "@tanstack/react-query";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { Puzzle as PuzzleIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/puzzles")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminPuzzles") }],
  }),
  component: AdminPuzzlesPage,
});

type Row = AdminPuzzleDefinitionRowView;
// The row + action awaiting the AlertDialog confirm (the category-list pattern).
type PendingAction = { row: Row; action: "disable" | "reenable" };

const STATUS_VARIANT: Record<
  Row["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  disabled: "outline",
};

// Admin console over EVERY catalog definition (all moderation statuses), newest first with
// load-more pagination. Approved rows can be reversibly disabled and disabled rows re-enabled,
// each behind an inline AlertDialog confirm; the audit trail lands in the moderation Activity
// Log via the mutations' moderationActions stamps.
function AdminPuzzlesPage() {
  const t = useTranslations("admin.puzzles");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  const {
    results: rows,
    status,
    loadMore,
    isLoading,
  } = usePaginatedQuery(
    gateway.admin.listPuzzleDefinitions,
    {},
    { initialNumItems: 25 },
  );

  const disable = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.disable),
  });
  const reenable = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.reenable),
  });

  const [confirming, setConfirming] = useState<PendingAction | null>(null);
  const busy = disable.isPending || reenable.isPending;

  const runConfirmed = async () => {
    if (!confirming?.row.aggregateId) return;
    const { row, action } = confirming;
    setConfirming(null);
    try {
      const run = action === "disable" ? disable : reenable;
      await run.mutateAsync({ puzzleDefinitionId: row.aggregateId! });
      toast.success(
        t(action === "disable" ? "disableSuccess" : "reenableSuccess", {
          title: row.title,
        }),
      );
    } catch {
      toast.error(t(action === "disable" ? "disableError" : "reenableError"));
    }
  };

  if (isLoading && rows.length === 0) {
    return <PageLoading message={t("loading")} />;
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <PuzzleIcon className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-semibold">{t("empty.title")}</p>
          <p className="text-sm text-muted-foreground">
            {t("empty.description")}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          {rows.map((row) => (
            <div
              key={row._id}
              className="flex items-center gap-3 border-b px-4 py-3 last:border-0"
            >
              {row.image ? (
                <img
                  src={row.image}
                  alt=""
                  className="size-11 shrink-0 rounded-lg border object-cover"
                />
              ) : (
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted">
                  <PuzzleIcon
                    className="size-5 text-muted-foreground"
                    aria-hidden
                  />
                </span>
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate font-semibold">{row.title}</span>
                  <Badge variant={STATUS_VARIANT[row.status]}>
                    {t(`status.${row.status}`)}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {row.brand && `${row.brand} · `}
                  {t("pieces", { count: row.pieceCount })}
                  {row.submitterName &&
                    ` · ${t("submittedBy", { name: row.submitterName })}`}
                </p>
              </div>
              <div className="hidden shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground sm:flex">
                <span>
                  {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                </span>
                <span>{t("ownerCount", { count: row.ownerCount })}</span>
              </div>
              <div className="flex shrink-0 items-center">
                {row.status === "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={busy || !row.aggregateId}
                    onClick={() => setConfirming({ row, action: "disable" })}
                  >
                    {t("disable")}
                  </Button>
                )}
                {row.status === "disabled" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !row.aggregateId}
                    onClick={() => setConfirming({ row, action: "reenable" })}
                  >
                    {t("reenable")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {status === "CanLoadMore" && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadMore(25)}
            disabled={isLoading}
          >
            {t("loadMore")}
          </Button>
        </div>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.action === "reenable"
                ? t("reenableConfirmTitle", { title: confirming.row.title })
                : t("disableConfirmTitle", {
                    title: confirming?.row.title ?? "",
                  })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.action === "reenable"
                ? t("reenableConfirmBody")
                : t("disableConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirming?.action === "disable"
                  ? buttonVariants({ variant: "destructive" })
                  : undefined
              }
              onClick={() => void runConfirmed()}
            >
              {confirming?.action === "reenable" ? t("reenable") : t("disable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] Verify web lints and typechecks: `pnpm exec nx lint web --skip-nx-cache` and `pnpm --filter @jigswap/web exec tsc --noEmit`. Expected: lint clean; tsc shows ONLY the known pre-existing `routeTree.gen.ts`-missing pattern (the new route file's `createFileRoute("/_dashboard/admin/puzzles")` joins that pattern until `vite dev`/`build` regenerates the tree) — no NEW errors of any other kind. If a Convex dev deployment is available (main checkout, `.env` present), `pnpm exec nx dev web` on :3001 and drive: /admin/puzzles renders for an admin, Disable shows the dialog, cancel aborts, confirm flips the badge to Disabled, the puzzle disappears from /puzzles browse, Re-enable restores it, and the Activity Log shows both entries. Otherwise note in the PR that browser verification was environment-blocked (no Chrome/deployment in worktree).
- [ ] Format: `pnpm exec prettier --write apps/web/src/components/dashboard-layout/route-meta.ts apps/web/src/routes/_dashboard/admin/puzzles.tsx apps/web/locales/source.json apps/web/locales/en.json apps/web/locales/nl.json`
- [ ] Commit:

```bash
git add apps/web/src/components/dashboard-layout/route-meta.ts apps/web/src/routes/_dashboard/admin/puzzles.tsx apps/web/locales/source.json apps/web/locales/en.json apps/web/locales/nl.json
git commit -m "feat(web): /admin/puzzles console with reversible disable/re-enable

All-status definition list (thumbnail, status badge, created date, owner
count, submitter) with load-more pagination; Disable/Re-enable behind
inline AlertDialog confirms; nav entry + en/nl strings.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9 — Final verification (CI mirror)

**Files:** none (verification only; fix-forward anything that fails, amend the responsible commit or add a `fix:` commit).

**Steps:**

- [ ] `pnpm run format:check` — clean (CI runs this FIRST; if it fails, `pnpm exec prettier --write` the listed files and commit).
- [ ] Mirror CI exactly (the Nx cache hides fresh failures — never trust a cached green): `pnpm exec nx run-many -t lint type-check test build arch-check --parallel=4 --skip-nx-cache` — all projects pass. Known acceptable noise: the web type-check/build behavior around the generated `routeTree.gen.ts` matches pre-existing main-branch behavior (build regenerates it; nothing new fails).
- [ ] Run both test suites once more, uncached and in full: `pnpm --filter @jigswap/domain exec vitest run && pnpm --filter @jigswap/backend exec vitest run` — all pass.
- [ ] Confirm the diff respects the guardrails: `git diff main --stat` — verify NO changes to `catalog/approvePuzzleDefinition.ts`, `catalog/rejectPuzzleDefinition.ts`, `notifications/subscriber.ts` (its `default:` case already ignores the new events — no notification on disable/re-enable is intentional), or any library write path other than the type-only `catalog-snapshot.provider.ts` line.
- [ ] Push and open the PR against `main`:

```bash
git push -u origin feat/admin-puzzle-definitions
gh pr create --title "feat(admin): puzzle-definitions console with reversible disable lifecycle" --body "$(cat <<'EOF'
PR 3 of docs/superpowers/specs/2026-07-08-admin-users-puzzles-and-confirm-dialogs-design.md.

- Domain: ApprovalStatus gains "disabled" (approved → disabled → approved; rejected stays terminal); PuzzleDefinition.disable()/reenable() record PuzzleDefinitionDisabled/Reenabled; use-cases reuse runDefinitionAction.
- Backend: disable/reenable mutations (admin gate → domain → moderationActions stamp, mirroring approve/reject); admin/listPuzzleDefinitions paginated read model over ALL statuses (submitter, thumbnail, distinct-owner count); getModerationStats excludes lifecycle toggles from KPIs.
- Invariants (test-locked): disabled definitions leave browse/search/by-id, new acquisitions by others are blocked (PuzzleNotAcquirable), existing copies keep cached snapshots, re-enable restores everything. Audit rows and domainEvents are append-only.
- Web: /admin/puzzles route + nav entry; status badges; Disable/Re-enable behind inline AlertDialog confirms; Activity Log labels for the new kinds (en + nl).

Note: packages/backend/convex/_generated/api.d.ts was hand-registered for the three new function modules (convex codegen needs a live deployment; a later `convex dev` regenerates it identically).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
