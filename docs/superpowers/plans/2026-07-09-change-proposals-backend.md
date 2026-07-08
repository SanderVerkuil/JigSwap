# Puzzle Change Proposals — Backend Core Implementation Plan (PR 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PR 1 of the approved spec (`docs/superpowers/specs/2026-07-08-puzzle-definition-change-proposals-design.md`): the complete backend for community change proposals on approved puzzle definitions — a new `PuzzleChangeProposal` aggregate (file/edit/withdraw/approve/reject), application use cases with the approve-orchestration applying the patch to `PuzzleDefinition` atomically, the `puzzleChangeProposals` Convex table + repository adapter, member/admin composition roots with `moderationActions` audit stamps, read-model queries with derived conflict flags, proposer outcome notifications, and gateway entries. PR 2 (member web UI) and PR 3 (admin web UI + direct admin edit) build on this.

**Architecture:** Hexagonal, three rings, mirroring the existing Catalog shape exactly. (1) **Domain** (`packages/domain/src/catalog`): a second aggregate `PuzzleChangeProposal` next to `PuzzleDefinition`, referencing it by identity only (`PuzzleDefinitionId`), with its own status machine (`pending → approved | rejected | withdrawn`), reusing `PuzzleDefinitionChanges` verbatim as the patch payload plus a same-shaped `baseline` snapshot for read-time conflict markers. (2) **Application**: five use cases through a new `ChangeProposalRepository` out-port; `approve-change-proposal` orchestrates BOTH aggregates in one transaction (load both → `proposal.approve` → `definition.update(proposal.changes)` → save both → publish both event batches) — orchestration within the context, event choreography only across contexts. Cross-aggregate rules (definition must be `approved`; one open proposal per definition+proposer) live here, like barcode uniqueness. Actor ACLs (proposer-only edit/withdraw, admin-only decide) live at the composition roots, like `updatePuzzleDefinition`. (3) **Backend composition roots** (`packages/backend/convex`): thin mutations mirroring `approvePuzzleDefinition.ts` (gate → use case → `stampModerationAction`), queries mirroring `listPendingPuzzleDefinitions.ts`, the Notifications subscriber learning `ChangeProposalApproved/Rejected`.

**Tech Stack:** TypeScript, Convex (convex-test + vitest), vitest for domain specs, Nx monorepo, pnpm, prettier.

---

## Executor setup & non-negotiable constraints

- [ ] Branch from `main` in a worktree: `git worktree add ../jigswap-change-proposals -b feat/change-proposals-backend main` (or use the worktree tooling). **All file writes must go through the worktree path, never the main-repo absolute path.**
- [ ] `pnpm install --frozen-lockfile` in the worktree root.
- [ ] First commit on the branch: the already-written spec. `git add docs/superpowers/specs/2026-07-08-puzzle-definition-change-proposals-design.md docs/superpowers/plans/2026-07-09-change-proposals-backend.md && git commit -m "docs: change-proposals spec + backend plan"`

**CRITICAL worktree caveat — Convex codegen cannot run here.** `convex codegen` needs a live `CONVEX_DEPLOYMENT` and fails in a worktree. This plan adds eight new Convex function modules (`catalog/proposeDefinitionChange.ts`, `catalog/editChangeProposal.ts`, `catalog/withdrawChangeProposal.ts`, `catalog/approveChangeProposal.ts`, `catalog/rejectChangeProposal.ts`, `catalog/listPendingChangeProposals.ts`, `catalog/listProposalsForDefinition.ts`, `catalog/listMyChangeProposals.ts`). You MUST register each by **hand-editing `packages/backend/convex/_generated/api.d.ts`**: add an `import type * as catalog_<name> from "../catalog/<name>.js";` line AND the matching `"catalog/<name>": typeof catalog_<name>,` entry inside `declare const fullApi: ApiFromModules<{ ... }>`, mirroring the existing sibling entries and keeping both lists alphabetical. `_generated/api.js` needs **no** edit. Schema changes need NO `_generated` edit (`dataModel.d.ts` derives structurally from `schema.ts`). A real `convex dev` later regenerates the file.

**Scope guardrails (embed in every review):**

- `PuzzleDefinition` (`puzzle-definition.ts`) is **not modified**. Approval calls its existing `update()`. `puzzle-change-proposal.ts` never imports `puzzle-definition.ts` except for the `PuzzleDefinitionChanges` **type**.
- `moderationActions` and `domainEvents` rows are **append-only**; nothing is deleted or mutated.
- No web UI in this PR (PR 2/3). No `definition_edited` direct-edit stamp (PR 3).
- Approve does NOT re-check barcode uniqueness — parity with today's `updatePuzzleDefinition` (a pre-existing, deliberate gap; do not "fix" it here).
- Conflict detection is **derived at read time** in the queries; never stored, never enforced by the domain.

**Repo conventions:** domain tests are colocated `.spec.ts` in `packages/domain`; backend tests are `.test.ts` at the `packages/backend/convex/` ROOT (never in subdirs — the `import.meta.glob` module bundling breaks otherwise). Prettier-format every changed file before each commit (CI runs `format:check` first).

**Test commands used throughout:**

- Domain: `pnpm --filter @jigswap/domain exec vitest run <file>` (all: `pnpm --filter @jigswap/domain exec vitest run`)
- Backend: `pnpm --filter @jigswap/backend exec vitest run <convex/file.test.ts>` (all: `pnpm --filter @jigswap/backend exec vitest run`)
- Typecheck: `pnpm exec nx run-many -t type-check --skip-nx-cache`

---

### Task 1 — Domain scaffolding: id brand, status machine, error factories

**Files:**

- Modify: `packages/domain/src/shared-kernel/branded-ids.ts` (append one constructor)
- Modify: `packages/domain/src/catalog/domain/ids.ts` (add `ChangeProposalId`)
- Create: `packages/domain/src/catalog/domain/proposal-status.ts`
- Modify: `packages/domain/src/catalog/domain/errors.ts` (3 new codes + factories)
- Modify: `packages/domain/src/catalog/domain/index.ts` (export `./proposal-status`)

No dedicated test file — these are exercised exhaustively by the Task 2 aggregate spec; this task's verification is the typecheck plus existing suites staying green.

**Steps:**

- [ ] In `packages/domain/src/shared-kernel/branded-ids.ts`, append after the `toMessageId` constructor (line 58-59):

```ts
export const toChangeProposalId = (value: string): Id<"ChangeProposalId"> =>
  toId<"ChangeProposalId">(value);
```

- [ ] In `packages/domain/src/catalog/domain/ids.ts`, extend the aggregate-identity block (after line 5):

```ts
export type ChangeProposalId = Id<"ChangeProposalId">;
```

- [ ] Create `packages/domain/src/catalog/domain/proposal-status.ts`:

```ts
// Lifecycle of a PuzzleChangeProposal. A member files it `pending`; an admin decides it once
// (approved/rejected) or the proposer withdraws it. All non-pending states are terminal —
// a member who wants to try again files a NEW proposal.
export type ProposalStatus = "pending" | "approved" | "rejected" | "withdrawn";

export const ALLOWED_PROPOSAL_TRANSITIONS: Readonly<
  Record<ProposalStatus, readonly ProposalStatus[]>
> = {
  pending: ["approved", "rejected", "withdrawn"],
  approved: [],
  rejected: [],
  withdrawn: [],
};
```

- [ ] In `packages/domain/src/catalog/domain/errors.ts`: add the import at the top (after the `approval` import at line 2):

```ts
import { ProposalStatus } from "./proposal-status";
```

extend the code union (lines 8-13):

```ts
export type CatalogErrorCode =
  | "EmptyTitle"
  | "InvalidPieceCount"
  | "InvalidBarcode"
  | "IllegalApprovalTransition"
  | "EmptyCategoryName"
  | "IllegalProposalTransition"
  | "EmptyProposal"
  | "ProposalNotPending";
```

and append three factories inside the class (after `emptyCategoryName`, before the closing brace):

```ts
  // The requested proposal move is not allowed from the current status.
  static illegalProposalTransition(
    from: ProposalStatus,
    to: ProposalStatus,
  ): CatalogError {
    return new CatalogError(
      "IllegalProposalTransition",
      `Cannot transition proposal from ${from} to ${to}`,
    );
  }

  // A change proposal must alter at least one field.
  static emptyProposal(): CatalogError {
    return new CatalogError(
      "EmptyProposal",
      "A change proposal requires at least one changed field",
    );
  }

  // Only a pending proposal can be edited in place.
  static proposalNotPending(status: ProposalStatus): CatalogError {
    return new CatalogError(
      "ProposalNotPending",
      `Only a pending proposal can be edited, got ${status}`,
    );
  }
```

- [ ] In `packages/domain/src/catalog/domain/index.ts`, add (keeping the list alphabetical):

```ts
export * from "./proposal-status";
```

- [ ] Verify: `pnpm --filter @jigswap/domain exec tsc --noEmit` passes and `pnpm --filter @jigswap/domain exec vitest run` stays green.
- [ ] Commit: `git add -A && git commit -m "feat(domain): change-proposal id brand, status machine, error factories"`

---

### Task 2 — Domain events + `PuzzleChangeProposal` aggregate (TDD)

**Files:**

- Modify: `packages/domain/src/catalog/domain/events.ts` (5 new event classes + extend `CatalogDomainEvent` union)
- Create: `packages/domain/src/catalog/domain/puzzle-change-proposal.spec.ts`
- Create: `packages/domain/src/catalog/domain/puzzle-change-proposal.ts`
- Modify: `packages/domain/src/catalog/domain/index.ts` (export `./puzzle-change-proposal`)

**Steps:**

- [ ] Write the failing spec. Create `packages/domain/src/catalog/domain/puzzle-change-proposal.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DomainEvent,
  toChangeProposalId,
  toPuzzleDefinitionId,
  toSubmitterId,
} from "../../shared-kernel";
import { ChangeProposalFiled, ChangeProposalRejected } from "./events";
import {
  FileChangeProposalProps,
  PuzzleChangeProposal,
} from "./puzzle-change-proposal";

const id = toChangeProposalId("cp1");
const definitionId = toPuzzleDefinitionId("pd1");
const proposer = toSubmitterId("alice");
const NOW = new Date("2026-07-08T10:00:00Z");
const LATER = new Date("2026-07-09T10:00:00Z");

const names = (events: readonly DomainEvent[]): string[] =>
  events.map((e) => e.name);

const file = (
  overrides: Partial<FileChangeProposalProps> = {},
): PuzzleChangeProposal => {
  const r = PuzzleChangeProposal.file({
    id,
    puzzleDefinitionId: definitionId,
    proposedBy: proposer,
    changes: { title: "Corrected Title" },
    baseline: { title: "Old Title" },
    now: NOW,
    ...overrides,
  });
  if (!r.isOk) throw new Error(`setup failed: ${r.error.message}`);
  return r.value;
};

describe("PuzzleChangeProposal.file", () => {
  it("starts pending and records ChangeProposalFiled with definition + proposer", () => {
    const proposal = file({ comment: "box says 500" });
    expect(proposal.status).toBe("pending");
    expect(proposal.toState().comment).toBe("box says 500");
    const events = proposal.pullEvents();
    expect(names(events)).toEqual(["ChangeProposalFiled"]);
    const filed = events[0] as ChangeProposalFiled;
    expect(filed.changeProposalId).toBe(id);
    expect(filed.puzzleDefinitionId).toBe(definitionId);
    expect(filed.proposedBy).toBe(proposer);
    expect(filed.occurredAt).toBe(NOW);
  });

  it("rejects an empty diff", () => {
    const r = PuzzleChangeProposal.file({
      id,
      puzzleDefinitionId: definitionId,
      proposedBy: proposer,
      changes: {},
      baseline: {},
      now: NOW,
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyProposal");
  });

  it("runs the definition's own invariants: blank title, bad piece count, bad barcode", () => {
    const blank = PuzzleChangeProposal.file({
      id,
      puzzleDefinitionId: definitionId,
      proposedBy: proposer,
      changes: { title: "   " },
      baseline: {},
      now: NOW,
    });
    expect(blank.isErr).toBe(true);
    if (blank.isErr) expect(blank.error.code).toBe("EmptyTitle");

    const pieces = PuzzleChangeProposal.file({
      id,
      puzzleDefinitionId: definitionId,
      proposedBy: proposer,
      changes: { pieceCount: -5 },
      baseline: {},
      now: NOW,
    });
    expect(pieces.isErr).toBe(true);
    if (pieces.isErr) expect(pieces.error.code).toBe("InvalidPieceCount");

    const barcode = PuzzleChangeProposal.file({
      id,
      puzzleDefinitionId: definitionId,
      proposedBy: proposer,
      changes: { barcodes: { ean: "not-an-ean" } },
      baseline: {},
      now: NOW,
    });
    expect(barcode.isErr).toBe(true);
    if (barcode.isErr) expect(barcode.error.code).toBe("InvalidBarcode");
  });
});

describe("edit", () => {
  it("replaces changes, baseline and comment in place on a pending proposal", () => {
    const proposal = file();
    proposal.pullEvents();
    const r = proposal.edit(
      { pieceCount: 500 },
      { pieceCount: 1000 },
      "recount",
      LATER,
    );
    expect(r.isOk).toBe(true);
    const state = proposal.toState();
    expect(state.changes).toEqual({ pieceCount: 500 });
    expect(state.baseline).toEqual({ pieceCount: 1000 });
    expect(state.comment).toBe("recount");
    expect(state.updatedAt).toBe(LATER);
    expect(names(proposal.pullEvents())).toEqual(["ChangeProposalEdited"]);
  });

  it("re-validates the new diff (empty diff rejected)", () => {
    const proposal = file();
    const r = proposal.edit({}, {}, undefined, LATER);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyProposal");
  });

  it("cannot edit a decided or withdrawn proposal", () => {
    const approved = file();
    approved.approve(NOW);
    const r1 = approved.edit({ title: "X" }, {}, undefined, LATER);
    expect(r1.isErr).toBe(true);
    if (r1.isErr) expect(r1.error.code).toBe("ProposalNotPending");

    const withdrawn = file();
    withdrawn.withdraw(NOW);
    const r2 = withdrawn.edit({ title: "X" }, {}, undefined, LATER);
    expect(r2.isErr).toBe(true);
    if (r2.isErr) expect(r2.error.code).toBe("ProposalNotPending");
  });
});

describe("decision lifecycle", () => {
  it("approve moves pending → approved, stamps decidedAt, records ChangeProposalApproved", () => {
    const proposal = file();
    proposal.pullEvents();
    const r = proposal.approve(LATER);
    expect(r.isOk).toBe(true);
    expect(proposal.status).toBe("approved");
    expect(proposal.toState().decidedAt).toBe(LATER);
    expect(names(proposal.pullEvents())).toEqual(["ChangeProposalApproved"]);
  });

  it("reject stores the reason, stamps decidedAt, records ChangeProposalRejected carrying it", () => {
    const proposal = file();
    proposal.pullEvents();
    const r = proposal.reject("duplicate of an existing fix", LATER);
    expect(r.isOk).toBe(true);
    expect(proposal.status).toBe("rejected");
    expect(proposal.toState().rejectionReason).toBe(
      "duplicate of an existing fix",
    );
    expect(proposal.toState().decidedAt).toBe(LATER);
    const events = proposal.pullEvents();
    expect(names(events)).toEqual(["ChangeProposalRejected"]);
    expect((events[0] as ChangeProposalRejected).reason).toBe(
      "duplicate of an existing fix",
    );
  });

  it("withdraw moves pending → withdrawn without decidedAt", () => {
    const proposal = file();
    proposal.pullEvents();
    const r = proposal.withdraw(LATER);
    expect(r.isOk).toBe(true);
    expect(proposal.status).toBe("withdrawn");
    expect(proposal.toState().decidedAt).toBeUndefined();
    expect(names(proposal.pullEvents())).toEqual(["ChangeProposalWithdrawn"]);
  });

  it.each([
    ["approve", (p: PuzzleChangeProposal) => p.approve(LATER)],
    ["reject", (p: PuzzleChangeProposal) => p.reject(undefined, LATER)],
    ["withdraw", (p: PuzzleChangeProposal) => p.withdraw(LATER)],
  ])("%s is illegal on an already-decided proposal", (_label, act) => {
    const proposal = file();
    proposal.approve(NOW);
    const r = act(proposal);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("IllegalProposalTransition");
  });
});

describe("rehydrate/toState round-trip", () => {
  it("preserves every field", () => {
    const proposal = file({ comment: "why" });
    const state = proposal.toState();
    const back = PuzzleChangeProposal.rehydrate(state);
    expect(back.toState()).toEqual(state);
    expect(back.pullEvents()).toEqual([]);
  });
});
```

- [ ] Run and watch it fail: `pnpm --filter @jigswap/domain exec vitest run src/catalog/domain/puzzle-change-proposal.spec.ts` — expected: module resolution failure for `./puzzle-change-proposal` (and `ChangeProposalFiled` not exported).
- [ ] Add the events. In `packages/domain/src/catalog/domain/events.ts`: extend the ids import (line 2) to include `ChangeProposalId`, then insert after `PuzzleDefinitionReenabled` (after line 58):

```ts
// Community change-proposal lifecycle. Approve/Reject carry the proposer so the Notifications
// subscriber can address the outcome without an extra lookup; per existing convention no ACTOR
// is on any event — the deciding admin is stamped into moderationActions at the composition root.
export class ChangeProposalFiled implements DomainEvent {
  readonly name = "ChangeProposalFiled";
  constructor(
    readonly changeProposalId: ChangeProposalId,
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly proposedBy: SubmitterId,
    readonly occurredAt: Date,
  ) {}
}

export class ChangeProposalEdited implements DomainEvent {
  readonly name = "ChangeProposalEdited";
  constructor(
    readonly changeProposalId: ChangeProposalId,
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly proposedBy: SubmitterId,
    readonly occurredAt: Date,
  ) {}
}

export class ChangeProposalWithdrawn implements DomainEvent {
  readonly name = "ChangeProposalWithdrawn";
  constructor(
    readonly changeProposalId: ChangeProposalId,
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly proposedBy: SubmitterId,
    readonly occurredAt: Date,
  ) {}
}

export class ChangeProposalApproved implements DomainEvent {
  readonly name = "ChangeProposalApproved";
  constructor(
    readonly changeProposalId: ChangeProposalId,
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly proposedBy: SubmitterId,
    readonly occurredAt: Date,
  ) {}
}

export class ChangeProposalRejected implements DomainEvent {
  readonly name = "ChangeProposalRejected";
  constructor(
    readonly changeProposalId: ChangeProposalId,
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly proposedBy: SubmitterId,
    readonly reason: string | undefined,
    readonly occurredAt: Date,
  ) {}
}
```

and extend the `CatalogDomainEvent` union at the bottom with the five new names:

```ts
  | ChangeProposalFiled
  | ChangeProposalEdited
  | ChangeProposalWithdrawn
  | ChangeProposalApproved
  | ChangeProposalRejected
```

- [ ] Create `packages/domain/src/catalog/domain/puzzle-change-proposal.ts`:

```ts
import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { validateBarcodes } from "./barcode";
import { CatalogError } from "./errors";
import {
  ChangeProposalApproved,
  ChangeProposalEdited,
  ChangeProposalFiled,
  ChangeProposalRejected,
  ChangeProposalWithdrawn,
} from "./events";
import { ChangeProposalId, PuzzleDefinitionId, SubmitterId } from "./ids";
import { PieceCount } from "./piece-count";
import {
  ALLOWED_PROPOSAL_TRANSITIONS,
  ProposalStatus,
} from "./proposal-status";
import type { PuzzleDefinitionChanges } from "./puzzle-definition";

// Input to file(): the field diff a member proposes against an approved definition. `changes`
// is the exact patch definition.update() will receive on approval; `baseline` is a same-shaped
// snapshot of ONLY the changed fields' current values, captured by the application layer at
// file/edit time — it exists purely so review UIs can derive "changed since proposed" markers.
export interface FileChangeProposalProps {
  readonly id: ChangeProposalId;
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly proposedBy: SubmitterId;
  readonly changes: PuzzleDefinitionChanges;
  readonly baseline: PuzzleDefinitionChanges;
  readonly comment?: string;
  readonly now: Date;
}

export interface PuzzleChangeProposalState {
  readonly id: ChangeProposalId;
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly proposedBy: SubmitterId;
  readonly status: ProposalStatus;
  readonly changes: PuzzleDefinitionChanges;
  readonly baseline: PuzzleDefinitionChanges;
  readonly comment?: string;
  readonly rejectionReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly decidedAt?: Date;
}

const hasAnyChange = (changes: PuzzleDefinitionChanges): boolean =>
  Object.values(changes).some((value) => value !== undefined);

// The same invariants PuzzleDefinition.update() enforces (non-blank title, positive integer
// piece count, well-formed barcodes), run at file/edit time so an invalid proposal can never
// sit in the review queue and then fail at approval.
const validateChanges = (
  changes: PuzzleDefinitionChanges,
): Result<void, CatalogError> => {
  if (!hasAnyChange(changes)) return err(CatalogError.emptyProposal());
  if (changes.title !== undefined && changes.title.trim().length === 0) {
    return err(CatalogError.emptyTitle());
  }
  if (changes.pieceCount !== undefined) {
    const validated = PieceCount.create(changes.pieceCount);
    if (validated.isErr) return err(validated.error);
  }
  if (changes.barcodes !== undefined) {
    const validated = validateBarcodes(changes.barcodes);
    if (validated.isErr) return err(validated.error);
  }
  return ok(undefined);
};

export class PuzzleChangeProposal {
  private events: DomainEvent[] = [];

  private constructor(private state: PuzzleChangeProposalState) {}

  get id(): ChangeProposalId {
    return this.state.id;
  }

  get puzzleDefinitionId(): PuzzleDefinitionId {
    return this.state.puzzleDefinitionId;
  }

  get proposedBy(): SubmitterId {
    return this.state.proposedBy;
  }

  get status(): ProposalStatus {
    return this.state.status;
  }

  get changes(): PuzzleDefinitionChanges {
    return this.state.changes;
  }

  // File a new proposal. Validates the diff from its own data only; cross-aggregate rules
  // (definition approved, no open duplicate) are the application layer's, like barcode
  // uniqueness on submit.
  static file(
    props: FileChangeProposalProps,
  ): Result<PuzzleChangeProposal, CatalogError> {
    const validated = validateChanges(props.changes);
    if (validated.isErr) return err(validated.error);

    const state: PuzzleChangeProposalState = {
      id: props.id,
      puzzleDefinitionId: props.puzzleDefinitionId,
      proposedBy: props.proposedBy,
      status: "pending",
      changes: props.changes,
      baseline: props.baseline,
      comment: props.comment,
      createdAt: props.now,
      updatedAt: props.now,
    };
    const proposal = new PuzzleChangeProposal(state);
    proposal.record(
      new ChangeProposalFiled(
        state.id,
        state.puzzleDefinitionId,
        state.proposedBy,
        props.now,
      ),
    );
    return ok(proposal);
  }

  // Replace the diff/baseline/comment in place (the proposer's "full editing" flow). Only a
  // pending proposal is editable; the new diff is re-validated exactly like file().
  edit(
    changes: PuzzleDefinitionChanges,
    baseline: PuzzleDefinitionChanges,
    comment: string | undefined,
    now: Date,
  ): Result<void, CatalogError> {
    if (this.state.status !== "pending") {
      return err(CatalogError.proposalNotPending(this.state.status));
    }
    const validated = validateChanges(changes);
    if (validated.isErr) return err(validated.error);

    this.state = { ...this.state, changes, baseline, comment, updatedAt: now };
    this.record(
      new ChangeProposalEdited(
        this.id,
        this.state.puzzleDefinitionId,
        this.state.proposedBy,
        now,
      ),
    );
    return ok(undefined);
  }

  // Proposer retracts a pending proposal. Terminal; re-filing creates a new proposal.
  withdraw(now: Date): Result<void, CatalogError> {
    const moved = this.transition("withdrawn", now);
    if (moved.isErr) return moved;
    this.record(
      new ChangeProposalWithdrawn(
        this.id,
        this.state.puzzleDefinitionId,
        this.state.proposedBy,
        now,
      ),
    );
    return ok(undefined);
  }

  // Admin accepts the proposal. Applying the patch to the definition is the approve use case's
  // orchestration; this aggregate only owns its own lifecycle.
  approve(now: Date): Result<void, CatalogError> {
    const moved = this.transition("approved", now);
    if (moved.isErr) return moved;
    this.state = { ...this.state, decidedAt: now };
    this.record(
      new ChangeProposalApproved(
        this.id,
        this.state.puzzleDefinitionId,
        this.state.proposedBy,
        now,
      ),
    );
    return ok(undefined);
  }

  // Admin declines the proposal, optionally explaining why (surfaced to the proposer).
  reject(reason: string | undefined, now: Date): Result<void, CatalogError> {
    const moved = this.transition("rejected", now);
    if (moved.isErr) return moved;
    this.state = { ...this.state, rejectionReason: reason, decidedAt: now };
    this.record(
      new ChangeProposalRejected(
        this.id,
        this.state.puzzleDefinitionId,
        this.state.proposedBy,
        reason,
        now,
      ),
    );
    return ok(undefined);
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: PuzzleChangeProposalState): PuzzleChangeProposal {
    return new PuzzleChangeProposal(state);
  }

  toState(): PuzzleChangeProposalState {
    return this.state;
  }

  // --- internals ---

  // The ONLY place status changes. Rejects any move not in the allow-list.
  private transition(
    to: ProposalStatus,
    now: Date,
  ): Result<void, CatalogError> {
    if (!ALLOWED_PROPOSAL_TRANSITIONS[this.state.status].includes(to)) {
      return err(CatalogError.illegalProposalTransition(this.state.status, to));
    }
    this.state = { ...this.state, status: to, updatedAt: now };
    return ok(undefined);
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
```

- [ ] In `packages/domain/src/catalog/domain/index.ts`, add:

```ts
export * from "./puzzle-change-proposal";
```

- [ ] Run: `pnpm --filter @jigswap/domain exec vitest run src/catalog/domain/puzzle-change-proposal.spec.ts` — expected: PASS (all tests).
- [ ] Run the whole domain suite to confirm nothing regressed: `pnpm --filter @jigswap/domain exec vitest run` — expected: PASS.
- [ ] Commit: `git add -A && git commit -m "feat(domain): PuzzleChangeProposal aggregate with file/edit/withdraw/approve/reject lifecycle"`

---

### Task 3 — Application errors, repository out-port, in-memory test double, id generator

**Files:**

- Modify: `packages/domain/src/catalog/application/errors.ts` (3 new codes + factories)
- Create: `packages/domain/src/catalog/application/ports/out/change-proposal.repository.ts`
- Modify: `packages/domain/src/catalog/application/ports/out/catalog-id-generator.ts` (add `nextChangeProposalId`)
- Modify: `packages/domain/src/catalog/application/ports/out/index.ts`
- Create: `packages/domain/src/catalog/application/testing/in-memory-change-proposal.repository.ts`
- Modify: `packages/domain/src/catalog/application/testing/sequential-id-generator.ts`
- Modify: `packages/domain/src/catalog/application/testing/index.ts`
- Modify: `packages/backend/convex/catalog/adapters/catalogIdGenerator.ts` (implement the widened port)

Exercised by the Task 4-6 use-case specs; verification here is typecheck + existing suites.

**Steps:**

- [ ] In `packages/domain/src/catalog/application/errors.ts`: extend the domain import (line 2) to also bring in `ApprovalStatus` and `ChangeProposalId`, extend the code union:

```ts
export type CatalogApplicationErrorCode =
  | "DuplicateBarcode"
  | "PuzzleDefinitionNotFound"
  | "CatalogCategoryNotFound"
  | "ChangeProposalNotFound"
  | "OpenProposalAlreadyExists"
  | "DefinitionNotProposable";
```

and append three factories inside the class:

```ts
  // No change proposal exists for the given id.
  static changeProposalNotFound(id: ChangeProposalId): CatalogApplicationError {
    return new CatalogApplicationError(
      "ChangeProposalNotFound",
      `Change proposal ${id} could not be found`,
    );
  }

  // One open proposal per (definition, proposer): the member should edit the pending one.
  static openProposalAlreadyExists(
    definitionId: PuzzleDefinitionId,
  ): CatalogApplicationError {
    return new CatalogApplicationError(
      "OpenProposalAlreadyExists",
      `You already have an open proposal for definition ${definitionId}`,
    );
  }

  // Community proposals only target APPROVED (publicly visible) definitions.
  static definitionNotProposable(
    id: PuzzleDefinitionId,
    status: ApprovalStatus,
  ): CatalogApplicationError {
    return new CatalogApplicationError(
      "DefinitionNotProposable",
      `Definition ${id} is ${status}; only approved definitions accept change proposals`,
    );
  }
```

- [ ] Create `packages/domain/src/catalog/application/ports/out/change-proposal.repository.ts`:

```ts
import {
  ChangeProposalId,
  PuzzleChangeProposal,
  PuzzleDefinitionId,
  SubmitterId,
} from "../../../domain";

// Outbound port: persistence for the PuzzleChangeProposal aggregate. The convex adapter
// implements this over `ctx.db` (the `puzzleChangeProposals` table) behind a mapper.
export interface ChangeProposalRepository {
  findById(id: ChangeProposalId): Promise<PuzzleChangeProposal | null>;
  // Backs the one-open-proposal-per-(definition, proposer) rule.
  findPendingByDefinitionAndProposer(
    definitionId: PuzzleDefinitionId,
    proposer: SubmitterId,
  ): Promise<PuzzleChangeProposal | null>;
  save(proposal: PuzzleChangeProposal): Promise<void>;
}
```

- [ ] In `packages/domain/src/catalog/application/ports/out/catalog-id-generator.ts`, extend the interface with (mirroring the two existing members — read the file first; it declares `nextPuzzleDefinitionId()` and `nextCatalogCategoryId()`):

```ts
  nextChangeProposalId(): ChangeProposalId;
```

(add `ChangeProposalId` to its domain import.)

- [ ] In `packages/domain/src/catalog/application/ports/out/index.ts`, add (alphabetical):

```ts
export * from "./change-proposal.repository";
```

- [ ] Create `packages/domain/src/catalog/application/testing/in-memory-change-proposal.repository.ts`:

```ts
import {
  ChangeProposalId,
  PuzzleChangeProposal,
  PuzzleDefinitionId,
  SubmitterId,
} from "../../domain";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";

// In-memory ChangeProposalRepository for use-case tests. Stores persisted state and rehydrates
// a fresh aggregate on read, mirroring the round-trip a real adapter performs.
export class InMemoryChangeProposalRepository implements ChangeProposalRepository {
  private readonly store = new Map<
    ChangeProposalId,
    ReturnType<PuzzleChangeProposal["toState"]>
  >();

  async findById(id: ChangeProposalId): Promise<PuzzleChangeProposal | null> {
    const state = this.store.get(id);
    return state ? PuzzleChangeProposal.rehydrate(state) : null;
  }

  async findPendingByDefinitionAndProposer(
    definitionId: PuzzleDefinitionId,
    proposer: SubmitterId,
  ): Promise<PuzzleChangeProposal | null> {
    for (const state of this.store.values()) {
      if (
        state.status === "pending" &&
        state.puzzleDefinitionId === definitionId &&
        state.proposedBy === proposer
      ) {
        return PuzzleChangeProposal.rehydrate(state);
      }
    }
    return null;
  }

  async save(proposal: PuzzleChangeProposal): Promise<void> {
    this.store.set(proposal.id, proposal.toState());
  }

  // Test helper: how many proposals are currently stored.
  size(): number {
    return this.store.size;
  }
}
```

- [ ] In `packages/domain/src/catalog/application/testing/sequential-id-generator.ts`, extend the class (add `toChangeProposalId` to the shared-kernel import and `ChangeProposalId` to the domain import):

```ts
  private proposalCounter = 0;

  nextChangeProposalId(): ChangeProposalId {
    this.proposalCounter += 1;
    return toChangeProposalId(`cp-${this.proposalCounter}`);
  }
```

- [ ] In `packages/domain/src/catalog/application/testing/index.ts`, add:

```ts
export * from "./in-memory-change-proposal.repository";
```

- [ ] In `packages/backend/convex/catalog/adapters/catalogIdGenerator.ts`, implement the widened port (add `ChangeProposalId` type + `toChangeProposalId` to the `@jigswap/domain` import):

```ts
  nextChangeProposalId: (): ChangeProposalId =>
    toChangeProposalId(crypto.randomUUID()),
```

- [ ] Verify: `pnpm --filter @jigswap/domain exec tsc --noEmit && pnpm --filter @jigswap/backend exec tsc --noEmit` pass; `pnpm --filter @jigswap/domain exec vitest run` stays green.
- [ ] Commit: `git add -A && git commit -m "feat(domain): ChangeProposalRepository port, in-memory double, proposal id generation"`

---

### Task 4 — `file-change-proposal` use case (TDD)

**Files:**

- Create: `packages/domain/src/catalog/application/ports/in/file-change-proposal.port.ts`
- Modify: `packages/domain/src/catalog/application/ports/in/index.ts`
- Create: `packages/domain/src/catalog/application/use-cases/proposal-baseline.ts`
- Create: `packages/domain/src/catalog/application/use-cases/file-change-proposal.ts`
- Create: `packages/domain/src/catalog/application/use-cases/change-proposal.spec.ts` (shared by Tasks 4-6; created here)
- Modify: `packages/domain/src/catalog/application/use-cases/index.ts`

**Steps:**

- [ ] Create `packages/domain/src/catalog/application/ports/in/file-change-proposal.port.ts`:

```ts
import { Result } from "../../../../shared-kernel";
import {
  CatalogError,
  ChangeProposalId,
  PuzzleDefinitionChanges,
  PuzzleDefinitionId,
  SubmitterId,
} from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// The command to file a community change proposal against an approved definition. The baseline
// snapshot is NOT part of the command: the use case derives it server-side from the definition's
// current state, so a stale client can never forge "what the proposer saw".
export interface FileChangeProposalCommand {
  readonly puzzleDefinitionId: PuzzleDefinitionId;
  readonly proposedBy: SubmitterId;
  readonly changes: PuzzleDefinitionChanges;
  readonly comment?: string;
}

// Inbound port: the file-change-proposal use case. Succeeds with the new proposal's id.
export interface FileChangeProposal {
  (
    cmd: FileChangeProposalCommand,
  ): Promise<Result<ChangeProposalId, CatalogError | CatalogApplicationError>>;
}
```

- [ ] In `packages/domain/src/catalog/application/ports/in/index.ts`, add (alphabetical):

```ts
export * from "./file-change-proposal.port";
```

- [ ] Create `packages/domain/src/catalog/application/use-cases/proposal-baseline.ts`:

```ts
import { PuzzleDefinition, PuzzleDefinitionChanges } from "../../domain";

// Snapshot the CURRENT value of every field the diff touches, in the same shape as the diff.
// Captured server-side at file/edit time; review UIs later compare it against the then-current
// definition to derive "changed since proposed" markers. Fields the diff does not touch stay
// undefined (indistinguishable from "base value was absent", which is fine: conflict detection
// iterates the CHANGES' defined fields, not the baseline's).
export const baselineFor = (
  definition: PuzzleDefinition,
  changes: PuzzleDefinitionChanges,
): PuzzleDefinitionChanges => {
  const state = definition.toState();
  return {
    title: changes.title !== undefined ? state.title : undefined,
    description:
      changes.description !== undefined ? state.description : undefined,
    brand: changes.brand !== undefined ? state.brand : undefined,
    pieceCount: changes.pieceCount !== undefined ? state.pieceCount : undefined,
    artist: changes.artist !== undefined ? state.artist : undefined,
    series: changes.series !== undefined ? state.series : undefined,
    barcodes:
      changes.barcodes !== undefined
        ? { ean: state.ean, upc: state.upc, modelNumber: state.modelNumber }
        : undefined,
    dimensions: changes.dimensions !== undefined ? state.dimensions : undefined,
    shape: changes.shape !== undefined ? state.shape : undefined,
    difficulty: changes.difficulty !== undefined ? state.difficulty : undefined,
    category: changes.category !== undefined ? state.category : undefined,
    tags:
      changes.tags !== undefined
        ? state.tags
          ? [...state.tags]
          : undefined
        : undefined,
    image: changes.image !== undefined ? state.image : undefined,
  };
};
```

- [ ] Write the failing spec. Create `packages/domain/src/catalog/application/use-cases/change-proposal.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { toPuzzleDefinitionId, toSubmitterId } from "../../../shared-kernel";
import { PuzzleDefinition } from "../../domain";
import {
  FixedClock,
  InMemoryChangeProposalRepository,
  InMemoryPuzzleDefinitionRepository,
  RecordingEventPublisher,
  SequentialIdGenerator,
} from "../testing";
import { makeFileChangeProposal } from "./file-change-proposal";

const NOW = new Date("2026-07-08T10:00:00Z");
const alice = toSubmitterId("alice");
const bob = toSubmitterId("bob");

// Shared world for every proposal use-case spec: repositories + one approved definition.
const definitionId = toPuzzleDefinitionId("pd-existing");

let definitions: InMemoryPuzzleDefinitionRepository;
let proposals: InMemoryChangeProposalRepository;
let events: RecordingEventPublisher;
let clock: FixedClock;
let ids: SequentialIdGenerator;

const seedDefinition = async (status: "pending" | "approved" = "approved") => {
  const r = PuzzleDefinition.submit({
    id: definitionId,
    title: "Starry Night",
    pieceCount: 1000,
    submittedBy: bob,
    now: NOW,
  });
  if (!r.isOk) throw new Error("seed failed");
  if (status === "approved") {
    const approved = r.value.approve(NOW);
    if (approved.isErr) throw new Error("seed approve failed");
  }
  r.value.pullEvents();
  await definitions.save(r.value);
};

const deps = () => ({ proposals, definitions, ids, events, clock });

beforeEach(() => {
  definitions = new InMemoryPuzzleDefinitionRepository();
  proposals = new InMemoryChangeProposalRepository();
  events = new RecordingEventPublisher();
  clock = new FixedClock(NOW);
  ids = new SequentialIdGenerator();
});

describe("makeFileChangeProposal", () => {
  it("files a pending proposal with a server-derived baseline and publishes ChangeProposalFiled", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());

    const r = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "Corrected", pieceCount: 500 },
      comment: "box says 500",
    });

    expect(r.isOk).toBe(true);
    if (!r.isOk) return;
    const saved = await proposals.findById(r.value);
    expect(saved).not.toBeNull();
    const state = saved!.toState();
    expect(state.status).toBe("pending");
    expect(state.changes).toEqual({ title: "Corrected", pieceCount: 500 });
    // Baseline snapshots the CURRENT values of exactly the changed fields.
    expect(state.baseline).toEqual({ title: "Starry Night", pieceCount: 1000 });
    expect(state.comment).toBe("box says 500");
    expect(events.names()).toEqual(["ChangeProposalFiled"]);
  });

  it("rejects a proposal against a missing definition", async () => {
    const file = makeFileChangeProposal(deps());
    const r = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("PuzzleDefinitionNotFound");
  });

  it("rejects a proposal against a non-approved definition", async () => {
    await seedDefinition("pending");
    const file = makeFileChangeProposal(deps());
    const r = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("DefinitionNotProposable");
  });

  it("enforces one OPEN proposal per (definition, proposer)", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const first = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    expect(first.isOk).toBe(true);

    const second = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { brand: "Ravensburger" },
    });
    expect(second.isErr).toBe(true);
    if (second.isErr)
      expect(second.error.code).toBe("OpenProposalAlreadyExists");

    // A DIFFERENT member may file concurrently.
    const other = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: bob,
      changes: { brand: "Ravensburger" },
    });
    expect(other.isOk).toBe(true);
  });

  it("propagates aggregate validation failures without saving", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const r = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: {},
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyProposal");
    expect(proposals.size()).toBe(0);
    expect(events.published).toEqual([]);
  });
});
```

- [ ] Run and watch it fail: `pnpm --filter @jigswap/domain exec vitest run src/catalog/application/use-cases/change-proposal.spec.ts` — expected: module resolution failure for `./file-change-proposal`.
- [ ] Create `packages/domain/src/catalog/application/use-cases/file-change-proposal.ts`:

```ts
import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import {
  CatalogError,
  ChangeProposalId,
  PuzzleChangeProposal,
} from "../../domain";
import { CatalogApplicationError } from "../errors";
import {
  FileChangeProposal,
  FileChangeProposalCommand,
} from "../ports/in/file-change-proposal.port";
import { CatalogIdGenerator } from "../ports/out/catalog-id-generator";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";
import { baselineFor } from "./proposal-baseline";

export interface FileChangeProposalDeps {
  readonly proposals: ChangeProposalRepository;
  readonly definitions: PuzzleDefinitionRepository;
  readonly ids: CatalogIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: enforce the cross-aggregate rules (definition exists AND is approved;
// no open proposal by this proposer), derive the baseline snapshot server-side, then delegate
// the diff's entity rules to the aggregate. Load → act → save → publish.
export const makeFileChangeProposal =
  (deps: FileChangeProposalDeps): FileChangeProposal =>
  async (
    cmd: FileChangeProposalCommand,
  ): Promise<
    Result<ChangeProposalId, CatalogError | CatalogApplicationError>
  > => {
    const definition = await deps.definitions.findById(cmd.puzzleDefinitionId);
    if (!definition) {
      return err(
        CatalogApplicationError.puzzleDefinitionNotFound(
          cmd.puzzleDefinitionId,
        ),
      );
    }
    if (definition.status !== "approved") {
      return err(
        CatalogApplicationError.definitionNotProposable(
          cmd.puzzleDefinitionId,
          definition.status,
        ),
      );
    }

    const open = await deps.proposals.findPendingByDefinitionAndProposer(
      cmd.puzzleDefinitionId,
      cmd.proposedBy,
    );
    if (open) {
      return err(
        CatalogApplicationError.openProposalAlreadyExists(
          cmd.puzzleDefinitionId,
        ),
      );
    }

    const proposal = PuzzleChangeProposal.file({
      id: deps.ids.nextChangeProposalId(),
      puzzleDefinitionId: cmd.puzzleDefinitionId,
      proposedBy: cmd.proposedBy,
      changes: cmd.changes,
      baseline: baselineFor(definition, cmd.changes),
      comment: cmd.comment,
      now: deps.clock.now(),
    });
    if (proposal.isErr) return err(proposal.error);

    await deps.proposals.save(proposal.value);
    await deps.events.publish(proposal.value.pullEvents());
    return ok(proposal.value.id);
  };
```

- [ ] In `packages/domain/src/catalog/application/use-cases/index.ts`, add (alphabetical):

```ts
export * from "./file-change-proposal";
export * from "./proposal-baseline";
```

- [ ] Run: `pnpm --filter @jigswap/domain exec vitest run src/catalog/application/use-cases/change-proposal.spec.ts` — expected: PASS.
- [ ] Commit: `git add -A && git commit -m "feat(domain): file-change-proposal use case with server-derived baseline"`

---

### Task 5 — `edit-change-proposal` + `withdraw-change-proposal` use cases (TDD)

**Files:**

- Create: `packages/domain/src/catalog/application/ports/in/edit-change-proposal.port.ts`
- Create: `packages/domain/src/catalog/application/ports/in/withdraw-change-proposal.port.ts`
- Modify: `packages/domain/src/catalog/application/ports/in/index.ts`
- Create: `packages/domain/src/catalog/application/use-cases/edit-change-proposal.ts`
- Create: `packages/domain/src/catalog/application/use-cases/withdraw-change-proposal.ts`
- Modify: `packages/domain/src/catalog/application/use-cases/change-proposal.spec.ts` (append describes)
- Modify: `packages/domain/src/catalog/application/use-cases/index.ts`

Actor ACL ("only the proposer") is deliberately NOT here — it lives at the composition roots (Task 9), matching `updatePuzzleDefinition`'s ownership check; the convex tests cover it.

**Steps:**

- [ ] Create `packages/domain/src/catalog/application/ports/in/edit-change-proposal.port.ts`:

```ts
import { Result } from "../../../../shared-kernel";
import {
  CatalogError,
  ChangeProposalId,
  PuzzleDefinitionChanges,
} from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// The command to replace a pending proposal's diff/comment in place. Like filing, the baseline
// is re-derived server-side against the definition's CURRENT state.
export interface EditChangeProposalCommand {
  readonly changeProposalId: ChangeProposalId;
  readonly changes: PuzzleDefinitionChanges;
  readonly comment?: string;
}

// Inbound port: the edit-change-proposal use case.
export interface EditChangeProposal {
  (
    cmd: EditChangeProposalCommand,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>>;
}
```

- [ ] Create `packages/domain/src/catalog/application/ports/in/withdraw-change-proposal.port.ts`:

```ts
import { Result } from "../../../../shared-kernel";
import { CatalogError, ChangeProposalId } from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// The command to retract a pending proposal (proposer-only; the ACL sits at the composition root).
export interface WithdrawChangeProposalCommand {
  readonly changeProposalId: ChangeProposalId;
}

// Inbound port: the withdraw-change-proposal use case.
export interface WithdrawChangeProposal {
  (
    cmd: WithdrawChangeProposalCommand,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>>;
}
```

- [ ] In `packages/domain/src/catalog/application/ports/in/index.ts`, add both exports (alphabetical):

```ts
export * from "./edit-change-proposal.port";
export * from "./withdraw-change-proposal.port";
```

- [ ] Append the failing tests to `packages/domain/src/catalog/application/use-cases/change-proposal.spec.ts` (extend the imports with `makeEditChangeProposal` from `./edit-change-proposal` and `makeWithdrawChangeProposal` from `./withdraw-change-proposal`):

```ts
describe("makeEditChangeProposal", () => {
  it("replaces changes/comment and re-derives the baseline against the CURRENT definition", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const filed = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "First idea" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    events.published.length = 0;

    const edit = makeEditChangeProposal(deps());
    const r = await edit({
      changeProposalId: filed.value,
      changes: { pieceCount: 500 },
      comment: "recount",
    });

    expect(r.isOk).toBe(true);
    const state = (await proposals.findById(filed.value))!.toState();
    expect(state.changes).toEqual({ pieceCount: 500 });
    expect(state.baseline).toEqual({ pieceCount: 1000 });
    expect(state.comment).toBe("recount");
    expect(events.names()).toEqual(["ChangeProposalEdited"]);
  });

  it("fails with ChangeProposalNotFound for an unknown id", async () => {
    await seedDefinition();
    const edit = makeEditChangeProposal(deps());
    const r = await edit({
      changeProposalId: ids.nextChangeProposalId(),
      changes: { title: "X" },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("ChangeProposalNotFound");
  });

  it("propagates ProposalNotPending from the aggregate", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const filed = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    const withdraw = makeWithdrawChangeProposal(deps());
    await withdraw({ changeProposalId: filed.value });

    const edit = makeEditChangeProposal(deps());
    const r = await edit({
      changeProposalId: filed.value,
      changes: { title: "Y" },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("ProposalNotPending");
  });
});

describe("makeWithdrawChangeProposal", () => {
  it("moves a pending proposal to withdrawn and publishes ChangeProposalWithdrawn", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const filed = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    events.published.length = 0;

    const withdraw = makeWithdrawChangeProposal(deps());
    const r = await withdraw({ changeProposalId: filed.value });

    expect(r.isOk).toBe(true);
    expect((await proposals.findById(filed.value))!.status).toBe("withdrawn");
    expect(events.names()).toEqual(["ChangeProposalWithdrawn"]);
  });

  it("after withdrawing, the same member may file a fresh proposal", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const filed = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    const withdraw = makeWithdrawChangeProposal(deps());
    await withdraw({ changeProposalId: filed.value });

    const again = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "Y" },
    });
    expect(again.isOk).toBe(true);
  });
});
```

- [ ] Run and watch the new describes fail: `pnpm --filter @jigswap/domain exec vitest run src/catalog/application/use-cases/change-proposal.spec.ts` — expected: module resolution failure for `./edit-change-proposal`.
- [ ] Create `packages/domain/src/catalog/application/use-cases/edit-change-proposal.ts`:

```ts
import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { CatalogError } from "../../domain";
import { CatalogApplicationError } from "../errors";
import {
  EditChangeProposal,
  EditChangeProposalCommand,
} from "../ports/in/edit-change-proposal.port";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";
import { baselineFor } from "./proposal-baseline";

export interface EditChangeProposalDeps {
  readonly proposals: ChangeProposalRepository;
  readonly definitions: PuzzleDefinitionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Load proposal + its target definition (for a FRESH baseline), delegate the pending-only and
// diff-validity rules to the aggregate, save, publish.
export const makeEditChangeProposal =
  (deps: EditChangeProposalDeps): EditChangeProposal =>
  async (
    cmd: EditChangeProposalCommand,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>> => {
    const proposal = await deps.proposals.findById(cmd.changeProposalId);
    if (!proposal) {
      return err(
        CatalogApplicationError.changeProposalNotFound(cmd.changeProposalId),
      );
    }

    const definition = await deps.definitions.findById(
      proposal.puzzleDefinitionId,
    );
    if (!definition) {
      return err(
        CatalogApplicationError.puzzleDefinitionNotFound(
          proposal.puzzleDefinitionId,
        ),
      );
    }

    const outcome = proposal.edit(
      cmd.changes,
      baselineFor(definition, cmd.changes),
      cmd.comment,
      deps.clock.now(),
    );
    if (outcome.isErr) return err(outcome.error);

    await deps.proposals.save(proposal);
    await deps.events.publish(proposal.pullEvents());
    return ok(undefined);
  };
```

- [ ] Create `packages/domain/src/catalog/application/use-cases/withdraw-change-proposal.ts`:

```ts
import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { CatalogError } from "../../domain";
import { CatalogApplicationError } from "../errors";
import {
  WithdrawChangeProposal,
  WithdrawChangeProposalCommand,
} from "../ports/in/withdraw-change-proposal.port";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";

export interface WithdrawChangeProposalDeps {
  readonly proposals: ChangeProposalRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Load → withdraw (aggregate owns the pending-only rule) → save → publish.
export const makeWithdrawChangeProposal =
  (deps: WithdrawChangeProposalDeps): WithdrawChangeProposal =>
  async (
    cmd: WithdrawChangeProposalCommand,
  ): Promise<Result<void, CatalogError | CatalogApplicationError>> => {
    const proposal = await deps.proposals.findById(cmd.changeProposalId);
    if (!proposal) {
      return err(
        CatalogApplicationError.changeProposalNotFound(cmd.changeProposalId),
      );
    }

    const outcome = proposal.withdraw(deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.proposals.save(proposal);
    await deps.events.publish(proposal.pullEvents());
    return ok(undefined);
  };
```

- [ ] In `packages/domain/src/catalog/application/use-cases/index.ts`, add both exports (alphabetical).
- [ ] Run: `pnpm --filter @jigswap/domain exec vitest run src/catalog/application/use-cases/change-proposal.spec.ts` — expected: PASS.
- [ ] Commit: `git add -A && git commit -m "feat(domain): edit + withdraw change-proposal use cases"`

---

### Task 6 — `approve-change-proposal` + `reject-change-proposal` use cases (TDD)

**Files:**

- Create: `packages/domain/src/catalog/application/ports/in/decide-change-proposal.port.ts`
- Modify: `packages/domain/src/catalog/application/ports/in/index.ts`
- Create: `packages/domain/src/catalog/application/use-cases/approve-change-proposal.ts`
- Create: `packages/domain/src/catalog/application/use-cases/reject-change-proposal.ts`
- Modify: `packages/domain/src/catalog/application/use-cases/change-proposal.spec.ts` (append describes)
- Modify: `packages/domain/src/catalog/application/use-cases/index.ts`

This is the orchestration at the heart of the spec: approve touches BOTH aggregates in one transaction. Each aggregate still owns its own rules; the use case only sequences them.

**Steps:**

- [ ] Create `packages/domain/src/catalog/application/ports/in/decide-change-proposal.port.ts`:

```ts
import { Result } from "../../../../shared-kernel";
import { CatalogError, ChangeProposalId } from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// Admin decisions on a pending proposal. `now` comes from the Clock port, not the command; the
// deciding admin is stamped into moderationActions at the composition root, never here.
export interface ApproveChangeProposalCommand {
  readonly changeProposalId: ChangeProposalId;
}

export interface RejectChangeProposalCommand {
  readonly changeProposalId: ChangeProposalId;
  readonly reason?: string;
}

export type DecideChangeProposalResult = Result<
  void,
  CatalogError | CatalogApplicationError
>;

export interface ApproveChangeProposal {
  (cmd: ApproveChangeProposalCommand): Promise<DecideChangeProposalResult>;
}

export interface RejectChangeProposal {
  (cmd: RejectChangeProposalCommand): Promise<DecideChangeProposalResult>;
}
```

- [ ] In `packages/domain/src/catalog/application/ports/in/index.ts`, add the export (alphabetical).
- [ ] Append the failing tests to `change-proposal.spec.ts` (extend imports with `makeApproveChangeProposal` and `makeRejectChangeProposal`):

```ts
describe("makeApproveChangeProposal", () => {
  const fileOne = async (
    changes: Parameters<
      ReturnType<typeof makeFileChangeProposal>
    >[0]["changes"],
  ) => {
    const filed = await makeFileChangeProposal(deps())({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes,
    });
    if (!filed.isOk) throw new Error("setup failed");
    events.published.length = 0;
    return filed.value;
  };

  it("approves the proposal AND applies the patch to the definition, publishing both batches", async () => {
    await seedDefinition();
    const proposalId = await fileOne({ title: "Corrected", pieceCount: 500 });

    const approve = makeApproveChangeProposal(deps());
    const r = await approve({ changeProposalId: proposalId });

    expect(r.isOk).toBe(true);
    const proposal = (await proposals.findById(proposalId))!;
    expect(proposal.status).toBe("approved");
    const definition = (await definitions.findById(definitionId))!.toState();
    expect(definition.title).toBe("Corrected");
    expect(definition.pieceCount).toBe(500);
    // Both aggregates' events land in one publish sequence: proposal first, then definition.
    expect(events.names()).toEqual([
      "ChangeProposalApproved",
      "PuzzleDefinitionUpdated",
    ]);
  });

  it("fails with ChangeProposalNotFound for an unknown id", async () => {
    await seedDefinition();
    const approve = makeApproveChangeProposal(deps());
    const r = await approve({ changeProposalId: ids.nextChangeProposalId() });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("ChangeProposalNotFound");
  });

  it("cannot approve twice — and does not double-apply the patch", async () => {
    await seedDefinition();
    const proposalId = await fileOne({ title: "Corrected" });
    const approve = makeApproveChangeProposal(deps());
    await approve({ changeProposalId: proposalId });

    const again = await approve({ changeProposalId: proposalId });
    expect(again.isErr).toBe(true);
    if (again.isErr) expect(again.error.code).toBe("IllegalProposalTransition");
  });

  it("saves NOTHING when applying the patch fails on the definition", async () => {
    await seedDefinition();
    const proposalId = await fileOne({ title: "Corrected" });
    // Sabotage: the definition disappears between filing and approval.
    definitions = new InMemoryPuzzleDefinitionRepository();

    const approve = makeApproveChangeProposal(deps());
    const r = await approve({ changeProposalId: proposalId });

    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("PuzzleDefinitionNotFound");
    // The proposal is untouched (still pending) and nothing was published.
    expect((await proposals.findById(proposalId))!.status).toBe("pending");
    expect(events.published).toEqual([]);
  });
});

describe("makeRejectChangeProposal", () => {
  it("rejects with a reason, leaves the definition untouched, publishes ChangeProposalRejected", async () => {
    await seedDefinition();
    const filed = await makeFileChangeProposal(deps())({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "Wrong idea" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    events.published.length = 0;

    const reject = makeRejectChangeProposal(deps());
    const r = await reject({
      changeProposalId: filed.value,
      reason: "title matches the box",
    });

    expect(r.isOk).toBe(true);
    const state = (await proposals.findById(filed.value))!.toState();
    expect(state.status).toBe("rejected");
    expect(state.rejectionReason).toBe("title matches the box");
    expect((await definitions.findById(definitionId))!.toState().title).toBe(
      "Starry Night",
    );
    expect(events.names()).toEqual(["ChangeProposalRejected"]);
  });
});
```

- [ ] Run and watch the new describes fail: `pnpm --filter @jigswap/domain exec vitest run src/catalog/application/use-cases/change-proposal.spec.ts` — expected: module resolution failure for `./approve-change-proposal`.
- [ ] Create `packages/domain/src/catalog/application/use-cases/approve-change-proposal.ts`:

```ts
import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { CatalogApplicationError } from "../errors";
import {
  ApproveChangeProposal,
  ApproveChangeProposalCommand,
  DecideChangeProposalResult,
} from "../ports/in/decide-change-proposal.port";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";

export interface ApproveChangeProposalDeps {
  readonly proposals: ChangeProposalRepository;
  readonly definitions: PuzzleDefinitionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// The one same-context orchestration in Catalog: the admin's click means "approve AND apply"
// atomically, so this use case sequences BOTH aggregates inside one transaction — no event
// choreography between them (that is reserved for cross-context integration). Every failure
// path returns BEFORE any save, so a failed approval leaves both aggregates untouched.
export const makeApproveChangeProposal =
  (deps: ApproveChangeProposalDeps): ApproveChangeProposal =>
  async (
    cmd: ApproveChangeProposalCommand,
  ): Promise<DecideChangeProposalResult> => {
    const proposal = await deps.proposals.findById(cmd.changeProposalId);
    if (!proposal) {
      return err(
        CatalogApplicationError.changeProposalNotFound(cmd.changeProposalId),
      );
    }

    const definition = await deps.definitions.findById(
      proposal.puzzleDefinitionId,
    );
    if (!definition) {
      return err(
        CatalogApplicationError.puzzleDefinitionNotFound(
          proposal.puzzleDefinitionId,
        ),
      );
    }

    const now = deps.clock.now();
    const approved = proposal.approve(now);
    if (approved.isErr) return err(approved.error);

    const applied = definition.update(proposal.changes, now);
    if (applied.isErr) return err(applied.error);

    await deps.proposals.save(proposal);
    await deps.definitions.save(definition);
    await deps.events.publish(proposal.pullEvents());
    await deps.events.publish(definition.pullEvents());
    return ok(undefined);
  };
```

- [ ] Create `packages/domain/src/catalog/application/use-cases/reject-change-proposal.ts`:

```ts
import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { CatalogApplicationError } from "../errors";
import {
  DecideChangeProposalResult,
  RejectChangeProposal,
  RejectChangeProposalCommand,
} from "../ports/in/decide-change-proposal.port";
import { ChangeProposalRepository } from "../ports/out/change-proposal.repository";

export interface RejectChangeProposalDeps {
  readonly proposals: ChangeProposalRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Load → reject (aggregate owns the pending-only rule + stores the reason) → save → publish.
// The definition is never touched on a rejection.
export const makeRejectChangeProposal =
  (deps: RejectChangeProposalDeps): RejectChangeProposal =>
  async (
    cmd: RejectChangeProposalCommand,
  ): Promise<DecideChangeProposalResult> => {
    const proposal = await deps.proposals.findById(cmd.changeProposalId);
    if (!proposal) {
      return err(
        CatalogApplicationError.changeProposalNotFound(cmd.changeProposalId),
      );
    }

    const outcome = proposal.reject(cmd.reason, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.proposals.save(proposal);
    await deps.events.publish(proposal.pullEvents());
    return ok(undefined);
  };
```

- [ ] In `packages/domain/src/catalog/application/use-cases/index.ts`, add both exports (alphabetical).
- [ ] Run: `pnpm --filter @jigswap/domain exec vitest run` — expected: the whole domain suite PASSES.
- [ ] Commit: `git add -A && git commit -m "feat(domain): approve/reject change-proposal use cases with atomic two-aggregate approve"`

---

### Task 7 — Convex schema table, mapper, repository adapter

**Files:**

- Modify: `packages/backend/convex/schema.ts` (new `puzzleChangeProposals` table)
- Create: `packages/backend/convex/catalog/adapters/proposalMapper.ts`
- Create: `packages/backend/convex/catalog/adapters/convexChangeProposalRepository.ts`

No `_generated` edits needed for schema/adapters (only function modules need the `api.d.ts` hand-edit).

**Steps:**

- [ ] In `packages/backend/convex/schema.ts`, insert the new table directly after the `moderationActions` table definition (after its indexes, around line 435). The `changes`/`baseline` columns are typed field-for-field (no `v.any()`); `category` holds the Catalog `CatalogCategoryId` **aggregate id string** (domain-owned — NOT an `adminCategories` `_id`; the puzzles-row FK resolution happens only when the patch is applied through the existing definition repository); `image` holds the storage id as a plain string for the same reason:

```ts
  // Community change proposals against APPROVED catalog definitions. `changes` is the exact
  // patch the definition receives on approval; `baseline` snapshots the changed fields' values
  // at file/edit time so review UIs can derive "changed since proposed" markers (derived at
  // read time — never stored, never enforced). One PENDING proposal per (definition, proposer);
  // decided/withdrawn rows are kept as history. Domain-owned: `puzzleDefinitionId` and
  // `changes.category` are Catalog aggregate-id strings, `changes.image` a storage id string.
  puzzleChangeProposals: defineTable({
    aggregateId: v.string(), // ChangeProposalId
    puzzleDefinitionId: v.string(), // Catalog PuzzleDefinitionId (aggregate id, not puzzles._id)
    proposedBy: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("withdrawn"),
    ),
    changes: proposalFields,
    baseline: proposalFields,
    comment: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index("by_aggregate_id", ["aggregateId"])
    .index("by_status", ["status"])
    .index("by_definition", ["puzzleDefinitionId"])
    .index("by_proposer", ["proposedBy", "status"]),
```

and define the shared field-shape validator ONCE near the top of the file, after the imports and before `export default defineSchema({`:

```ts
// The proposable field diff, shared by puzzleChangeProposals.changes and .baseline. Mirrors the
// domain PuzzleDefinitionChanges shape exactly (barcodes grouped: supplying the group replaces
// all three values, same as updatePuzzleDefinition).
const proposalFields = v.object({
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  brand: v.optional(v.string()),
  pieceCount: v.optional(v.number()),
  artist: v.optional(v.string()),
  series: v.optional(v.string()),
  barcodes: v.optional(
    v.object({
      ean: v.optional(v.string()),
      upc: v.optional(v.string()),
      modelNumber: v.optional(v.string()),
    }),
  ),
  dimensions: v.optional(
    v.object({
      width: v.number(),
      height: v.number(),
      unit: v.union(v.literal("cm"), v.literal("in")),
    }),
  ),
  shape: v.optional(
    v.union(
      v.literal("rectangular"),
      v.literal("panoramic"),
      v.literal("round"),
      v.literal("shaped"),
    ),
  ),
  difficulty: v.optional(
    v.union(
      v.literal("easy"),
      v.literal("medium"),
      v.literal("hard"),
      v.literal("expert"),
    ),
  ),
  category: v.optional(v.string()), // CatalogCategoryId aggregate id string
  tags: v.optional(v.array(v.string())),
  image: v.optional(v.string()), // _storage id as plain string (domain-owned shape)
});
```

- [ ] Create `packages/backend/convex/catalog/adapters/proposalMapper.ts`:

```ts
import {
  type PuzzleChangeProposalState,
  type PuzzleDefinitionChanges,
  PuzzleChangeProposal,
  toCatalogCategoryId,
  toChangeProposalId,
  toPuzzleDefinitionId,
  toSubmitterId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `puzzleChangeProposals` row and the PuzzleChangeProposal aggregate.
// Schema shape stops here and never ripples into the domain.

export type ProposalRow = Omit<
  Doc<"puzzleChangeProposals">,
  "_id" | "_creationTime"
>;

type FieldsColumn = Doc<"puzzleChangeProposals">["changes"];

// The stored diff column ↔ the domain PuzzleDefinitionChanges. Field-for-field except `category`,
// which is re-branded (both sides carry the aggregate id string).
const toChanges = (column: FieldsColumn): PuzzleDefinitionChanges => ({
  ...column,
  category: column.category ? toCatalogCategoryId(column.category) : undefined,
});

const toColumn = (changes: PuzzleDefinitionChanges): FieldsColumn => ({
  ...changes,
  category: changes.category ? (changes.category as string) : undefined,
  tags: changes.tags ? [...changes.tags] : undefined,
});

export const toDomain = (
  row: Doc<"puzzleChangeProposals">,
): PuzzleChangeProposal =>
  PuzzleChangeProposal.rehydrate({
    id: toChangeProposalId(row.aggregateId),
    puzzleDefinitionId: toPuzzleDefinitionId(row.puzzleDefinitionId),
    proposedBy: toSubmitterId(row.proposedBy as unknown as string),
    status: row.status,
    changes: toChanges(row.changes),
    baseline: toChanges(row.baseline),
    comment: row.comment,
    rejectionReason: row.rejectionReason,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    decidedAt:
      row.decidedAt !== undefined ? new Date(row.decidedAt) : undefined,
  });

export const toRow = (proposal: PuzzleChangeProposal): ProposalRow => {
  const state: PuzzleChangeProposalState = proposal.toState();
  return {
    aggregateId: state.id as string,
    puzzleDefinitionId: state.puzzleDefinitionId as string,
    proposedBy: state.proposedBy as unknown as Id<"users">,
    status: state.status,
    changes: toColumn(state.changes),
    baseline: toColumn(state.baseline),
    comment: state.comment,
    rejectionReason: state.rejectionReason,
    createdAt: state.createdAt.getTime(),
    updatedAt: state.updatedAt.getTime(),
    decidedAt: state.decidedAt?.getTime(),
  };
};
```

- [ ] Create `packages/backend/convex/catalog/adapters/convexChangeProposalRepository.ts`:

```ts
import {
  type ChangeProposalId,
  type ChangeProposalRepository,
  type PuzzleChangeProposal,
  type PuzzleDefinitionId,
  type SubmitterId,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { toDomain, toRow } from "./proposalMapper";

// Driven adapter for the ChangeProposalRepository port over `ctx.db`. The only place the
// `puzzleChangeProposals` table is read/written for the domain path; the mapper is the ACL.
export const convexChangeProposalRepository = (
  ctx: MutationCtx,
): ChangeProposalRepository => ({
  async findById(id: ChangeProposalId): Promise<PuzzleChangeProposal | null> {
    const row = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();
    return row ? toDomain(row) : null;
  },

  // Backs the one-open-proposal rule. `by_proposer` is (proposedBy, status), so the pending
  // rows of this member are one indexed scan; the definition filter is applied in memory.
  async findPendingByDefinitionAndProposer(
    definitionId: PuzzleDefinitionId,
    proposer: SubmitterId,
  ): Promise<PuzzleChangeProposal | null> {
    const pending = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_proposer", (q) =>
        q
          .eq("proposedBy", proposer as unknown as Id<"users">)
          .eq("status", "pending"),
      )
      .collect();
    const match = pending.find(
      (row) => row.puzzleDefinitionId === (definitionId as string),
    );
    return match ? toDomain(match) : null;
  },

  async save(proposal: PuzzleChangeProposal): Promise<void> {
    const row = toRow(proposal);
    const existing = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.aggregateId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("puzzleChangeProposals", row);
  },
});
```

- [ ] Verify: `pnpm --filter @jigswap/backend exec tsc --noEmit` passes and `pnpm --filter @jigswap/backend exec vitest run` stays green (schema change is additive).
- [ ] Commit: `git add -A && git commit -m "feat(backend): puzzleChangeProposals table, mapper, repository adapter"`

---

### Task 8 — Member composition roots: propose / edit / withdraw (+ convex tests)

**Files:**

- Create: `packages/backend/convex/catalog/proposeDefinitionChange.ts`
- Create: `packages/backend/convex/catalog/editChangeProposal.ts`
- Create: `packages/backend/convex/catalog/withdrawChangeProposal.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (hand-register the 3 modules — see setup section)
- Create: `packages/backend/convex/changeProposals.test.ts`

All three mutations share the arg shape of `updatePuzzleDefinition` (`packages/backend/convex/catalog/updatePuzzleDefinition.ts:20-57`). Define the shared pieces once in the propose module and import them from the other two.

**Steps:**

- [ ] Create `packages/backend/convex/catalog/proposeDefinitionChange.ts`:

```ts
import {
  makeFileChangeProposal,
  type PuzzleDefinitionChanges,
  toCatalogCategoryId,
  toPuzzleDefinitionId,
  toSubmitterId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { catalogIdGenerator } from "./adapters/catalogIdGenerator";
import { convexChangeProposalRepository } from "./adapters/convexChangeProposalRepository";
import { convexPuzzleDefinitionRepository } from "./adapters/convexPuzzleDefinitionRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// The proposable field args, shared verbatim by proposeDefinitionChange and editChangeProposal.
// Mirrors updatePuzzleDefinition's args (grouped-barcode semantics included).
export const proposalFieldArgs = {
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  brand: v.optional(v.string()),
  pieceCount: v.optional(v.number()),
  artist: v.optional(v.string()),
  series: v.optional(v.string()),
  ean: v.optional(v.string()),
  upc: v.optional(v.string()),
  modelNumber: v.optional(v.string()),
  dimensions: v.optional(
    v.object({
      width: v.number(),
      height: v.number(),
      unit: v.union(v.literal("cm"), v.literal("in")),
    }),
  ),
  shape: v.optional(
    v.union(
      v.literal("rectangular"),
      v.literal("panoramic"),
      v.literal("round"),
      v.literal("shaped"),
    ),
  ),
  difficulty: v.optional(
    v.union(
      v.literal("easy"),
      v.literal("medium"),
      v.literal("hard"),
      v.literal("expert"),
    ),
  ),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  image: v.optional(v.string()),
} as const;

type ProposalFieldArgs = {
  title?: string;
  description?: string;
  brand?: string;
  pieceCount?: number;
  artist?: string;
  series?: string;
  ean?: string;
  upc?: string;
  modelNumber?: string;
  dimensions?: { width: number; height: number; unit: "cm" | "in" };
  shape?: "rectangular" | "panoramic" | "round" | "shaped";
  difficulty?: "easy" | "medium" | "hard" | "expert";
  category?: string;
  tags?: string[];
  image?: string;
};

// Fold the flat mutation args into the domain patch shape (same grouped-barcode rule as
// updatePuzzleDefinition: any barcode arg present replaces the whole group).
export const toChanges = (args: ProposalFieldArgs): PuzzleDefinitionChanges => {
  const hasBarcode =
    args.ean !== undefined ||
    args.upc !== undefined ||
    args.modelNumber !== undefined;
  return {
    title: args.title,
    description: args.description,
    brand: args.brand,
    pieceCount: args.pieceCount,
    artist: args.artist,
    series: args.series,
    barcodes: hasBarcode
      ? { ean: args.ean, upc: args.upc, modelNumber: args.modelNumber }
      : undefined,
    dimensions: args.dimensions,
    shape: args.shape,
    difficulty: args.difficulty,
    category: args.category ? toCatalogCategoryId(args.category) : undefined,
    tags: args.tags,
    image: args.image,
  };
};

// Composition root: any signed-in member proposes a field diff against an APPROVED definition.
// Cross-aggregate rules (approved-only, one open proposal per member+definition) live in the
// use case; this root only authenticates and adapts transport ⇄ domain.
export const proposeDefinitionChange = mutation({
  args: {
    puzzleDefinitionId: v.string(),
    comment: v.optional(v.string()),
    ...proposalFieldArgs,
  },
  handler: async (ctx, args) => {
    const actingMember = await requireMember(ctx);

    const file = makeFileChangeProposal({
      proposals: convexChangeProposalRepository(ctx),
      definitions: convexPuzzleDefinitionRepository(ctx),
      ids: catalogIdGenerator,
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await file({
      puzzleDefinitionId: toPuzzleDefinitionId(args.puzzleDefinitionId),
      proposedBy: toSubmitterId(actingMember as unknown as string),
      changes: toChanges(args),
      comment: args.comment,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
```

- [ ] Create `packages/backend/convex/catalog/editChangeProposal.ts`:

```ts
import { makeEditChangeProposal, toChangeProposalId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexChangeProposalRepository } from "./adapters/convexChangeProposalRepository";
import { convexPuzzleDefinitionRepository } from "./adapters/convexPuzzleDefinitionRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";
import { proposalFieldArgs, toChanges } from "./proposeDefinitionChange";

// Composition root: the proposer replaces their PENDING proposal's diff/comment in place.
// Ownership ACL here (like updatePuzzleDefinition); the pending-only rule is the aggregate's.
export const editChangeProposal = mutation({
  args: {
    changeProposalId: v.string(),
    comment: v.optional(v.string()),
    ...proposalFieldArgs,
  },
  handler: async (ctx, args) => {
    const actingMember = await requireMember(ctx);

    const proposals = convexChangeProposalRepository(ctx);
    const existing = await proposals.findById(
      toChangeProposalId(args.changeProposalId),
    );
    if (!existing) throw new ConvexError("Not found");
    if (
      (existing.proposedBy as unknown as string) !==
      (actingMember as unknown as string)
    ) {
      throw new ConvexError("Forbidden");
    }

    const edit = makeEditChangeProposal({
      proposals,
      definitions: convexPuzzleDefinitionRepository(ctx),
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await edit({
      changeProposalId: toChangeProposalId(args.changeProposalId),
      changes: toChanges(args),
      comment: args.comment,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
```

- [ ] Create `packages/backend/convex/catalog/withdrawChangeProposal.ts`:

```ts
import {
  makeWithdrawChangeProposal,
  toChangeProposalId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexChangeProposalRepository } from "./adapters/convexChangeProposalRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root: the proposer retracts their PENDING proposal. Ownership ACL here; the
// pending-only rule is the aggregate's.
export const withdrawChangeProposal = mutation({
  args: { changeProposalId: v.string() },
  handler: async (ctx, args) => {
    const actingMember = await requireMember(ctx);

    const proposals = convexChangeProposalRepository(ctx);
    const existing = await proposals.findById(
      toChangeProposalId(args.changeProposalId),
    );
    if (!existing) throw new ConvexError("Not found");
    if (
      (existing.proposedBy as unknown as string) !==
      (actingMember as unknown as string)
    ) {
      throw new ConvexError("Forbidden");
    }

    const withdraw = makeWithdrawChangeProposal({
      proposals,
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await withdraw({
      changeProposalId: toChangeProposalId(args.changeProposalId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
```

- [ ] Hand-register all three modules in `packages/backend/convex/_generated/api.d.ts` (import lines + `fullApi` entries, alphabetical — see setup section).
- [ ] Create `packages/backend/convex/changeProposals.test.ts`:

```ts
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Member-side proposal lifecycle: propose (approved-only, one open per member+definition),
// edit in place (proposer-only), withdraw (proposer-only). Decisions are covered in
// changeProposalDecisions.test.ts.

const seedMembers = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await mkUser("clerk_alice", "Alice"),
      bob: await mkUser("clerk_bob", "Bob"),
    };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

// Submit + approve, returning an APPROVED definition's aggregateId.
const submitApproved = async (t: ReturnType<typeof convexTest>) => {
  const id = await asAlice(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", pieceCount: 1000 },
  );
  await asAdmin(t).mutation(
    api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
    { puzzleDefinitionId: id as string },
  );
  return id as string;
};

const proposalRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

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

describe("catalog.proposeDefinitionChange", () => {
  test("requires auth", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await submitApproved(t);
    await expect(
      t.mutation(api.catalog.proposeDefinitionChange.proposeDefinitionChange, {
        puzzleDefinitionId: id,
        title: "X",
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });

  test("files a pending proposal with server-derived baseline + outbox event", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const id = await submitApproved(t);

    const proposalId = await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      {
        puzzleDefinitionId: id,
        title: "Mountain Vista (Panorama)",
        pieceCount: 500,
        comment: "box says 500",
      },
    );

    const row = await proposalRow(t, proposalId as string);
    expect(row).toMatchObject({
      puzzleDefinitionId: id,
      proposedBy: bob,
      status: "pending",
      comment: "box says 500",
      changes: { title: "Mountain Vista (Panorama)", pieceCount: 500 },
      baseline: { title: "Mountain Vista", pieceCount: 1000 },
    });
    expect(await outboxNames(t)).toContain("ChangeProposalFiled");
  });

  test("rejects proposals against non-approved definitions with DefinitionNotProposable", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const pendingId = await asAlice(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Still Pending", pieceCount: 500 },
    );
    await expectConvexCode(
      asBob(t).mutation(
        api.catalog.proposeDefinitionChange.proposeDefinitionChange,
        { puzzleDefinitionId: pendingId as string, title: "X" },
      ),
      "DefinitionNotProposable",
    );
  });

  test("enforces one open proposal per member+definition with OpenProposalAlreadyExists", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await submitApproved(t);
    await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: id, title: "X" },
    );
    await expectConvexCode(
      asBob(t).mutation(
        api.catalog.proposeDefinitionChange.proposeDefinitionChange,
        { puzzleDefinitionId: id, brand: "Ravensburger" },
      ),
      "OpenProposalAlreadyExists",
    );
  });
});

describe("catalog.editChangeProposal / withdrawChangeProposal", () => {
  const fileAsBob = async (t: ReturnType<typeof convexTest>) => {
    const id = await submitApproved(t);
    const proposalId = await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: id, title: "First idea" },
    );
    return { definitionId: id, proposalId: proposalId as string };
  };

  test("only the proposer may edit (others get Forbidden)", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await expect(
      asAlice(t).mutation(api.catalog.editChangeProposal.editChangeProposal, {
        changeProposalId: proposalId,
        title: "Hijacked",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("edit replaces the diff and re-derives the baseline", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);

    await asBob(t).mutation(api.catalog.editChangeProposal.editChangeProposal, {
      changeProposalId: proposalId,
      pieceCount: 500,
      comment: "recount",
    });

    const row = await proposalRow(t, proposalId);
    expect(row).toMatchObject({
      status: "pending",
      comment: "recount",
      changes: { pieceCount: 500 },
      baseline: { pieceCount: 1000 },
    });
    expect(await outboxNames(t)).toContain("ChangeProposalEdited");
  });

  test("only the proposer may withdraw; withdrawal is terminal + re-filing allowed", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { definitionId, proposalId } = await fileAsBob(t);

    await expect(
      asAlice(t).mutation(
        api.catalog.withdrawChangeProposal.withdrawChangeProposal,
        { changeProposalId: proposalId },
      ),
    ).rejects.toThrow(/Forbidden/);

    await asBob(t).mutation(
      api.catalog.withdrawChangeProposal.withdrawChangeProposal,
      { changeProposalId: proposalId },
    );
    expect((await proposalRow(t, proposalId))?.status).toBe("withdrawn");

    // A withdrawn proposal no longer blocks a fresh one.
    const again = await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: definitionId, title: "Second idea" },
    );
    expect(again).toBeTruthy();

    // Editing the withdrawn proposal fails with the domain code.
    await expectConvexCode(
      asBob(t).mutation(api.catalog.editChangeProposal.editChangeProposal, {
        changeProposalId: proposalId,
        title: "Zombie",
      }),
      "ProposalNotPending",
    );
  });
});
```

- [ ] Run: `pnpm --filter @jigswap/backend exec vitest run convex/changeProposals.test.ts` — expected: PASS.
- [ ] Run the full backend suite: `pnpm --filter @jigswap/backend exec vitest run` — expected: PASS.
- [ ] Commit: `git add -A && git commit -m "feat(backend): propose/edit/withdraw change-proposal mutations with ownership ACLs"`

---

### Task 9 — Admin composition roots: approve / reject with audit stamps (+ convex tests)

**Files:**

- Modify: `packages/backend/convex/admin/stampModerationAction.ts` (2 new kinds)
- Modify: `packages/backend/convex/schema.ts` (`moderationActions.kind` union: 2 new literals)
- Create: `packages/backend/convex/catalog/approveChangeProposal.ts`
- Create: `packages/backend/convex/catalog/rejectChangeProposal.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (hand-register the 2 modules)
- Create: `packages/backend/convex/changeProposalDecisions.test.ts`

**Steps:**

- [ ] In `packages/backend/convex/schema.ts`, extend the `moderationActions.kind` union (after `"definition_reenabled"`):

```ts
      v.literal("proposal_approved"),
      v.literal("proposal_rejected"),
```

- [ ] In `packages/backend/convex/admin/stampModerationAction.ts`, extend the `ModerationKind` union identically:

```ts
  | "proposal_approved"
  | "proposal_rejected"
```

- [ ] Create `packages/backend/convex/catalog/approveChangeProposal.ts`:

```ts
import { makeApproveChangeProposal } from "@jigswap/domain";
import { toChangeProposalId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { convexChangeProposalRepository } from "./adapters/convexChangeProposalRepository";
import { convexPuzzleDefinitionRepository } from "./adapters/convexPuzzleDefinitionRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Moderation: approve a pending change proposal. The use case orchestrates BOTH aggregates in
// this one transaction — the proposal is approved AND the patch lands on the definition
// atomically. Domain events carry no actor, so the composition root stamps the deciding admin.
export const approveChangeProposal = mutation({
  args: { changeProposalId: v.string() },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const approve = makeApproveChangeProposal({
      proposals: convexChangeProposalRepository(ctx),
      definitions: convexPuzzleDefinitionRepository(ctx),
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await approve({
      changeProposalId: toChangeProposalId(args.changeProposalId),
    });
    if (result.isErr) throw toConvexError(result.error);

    // Audit stamp: label with the (now updated) definition title. The action succeeded, so
    // both rows exist.
    const proposal = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.changeProposalId),
      )
      .unique();
    const puzzle = proposal
      ? await ctx.db
          .query("puzzles")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", proposal.puzzleDefinitionId),
          )
          .unique()
      : null;
    await stampModerationAction(ctx, {
      actorId: memberId as unknown as Id<"users">,
      kind: "proposal_approved",
      targetLabel: puzzle?.title ?? args.changeProposalId,
      targetId: args.changeProposalId,
    });
  },
});
```

- [ ] Create `packages/backend/convex/catalog/rejectChangeProposal.ts`:

```ts
import { makeRejectChangeProposal, toChangeProposalId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { convexChangeProposalRepository } from "./adapters/convexChangeProposalRepository";
import { catalogEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Moderation: reject a pending change proposal with an optional reason (stored on the proposal,
// carried on the domain event, surfaced to the proposer). The definition is never touched.
export const rejectChangeProposal = mutation({
  args: { changeProposalId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const reject = makeRejectChangeProposal({
      proposals: convexChangeProposalRepository(ctx),
      events: catalogEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await reject({
      changeProposalId: toChangeProposalId(args.changeProposalId),
      reason: args.reason,
    });
    if (result.isErr) throw toConvexError(result.error);

    const proposal = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.changeProposalId),
      )
      .unique();
    const puzzle = proposal
      ? await ctx.db
          .query("puzzles")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", proposal.puzzleDefinitionId),
          )
          .unique()
      : null;
    await stampModerationAction(ctx, {
      actorId: memberId as unknown as Id<"users">,
      kind: "proposal_rejected",
      targetLabel: puzzle?.title ?? args.changeProposalId,
      targetId: args.changeProposalId,
    });
  },
});
```

- [ ] Hand-register both modules in `packages/backend/convex/_generated/api.d.ts`.
- [ ] Create `packages/backend/convex/changeProposalDecisions.test.ts` (reuse the exact helper block from `changeProposals.test.ts` — `modules`, `seedMembers`, `asAlice`/`asBob`/`asAdmin`, `submitApproved`, `proposalRow`, `outboxNames`, `dataOf`, `expectConvexCode` — copied, since backend tests are standalone files):

```ts
// ... helper block identical to changeProposals.test.ts ...

const puzzleRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const allActions = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

const fileAsBob = async (t: ReturnType<typeof convexTest>) => {
  const definitionId = await submitApproved(t);
  const proposalId = await asBob(t).mutation(
    api.catalog.proposeDefinitionChange.proposeDefinitionChange,
    {
      puzzleDefinitionId: definitionId,
      title: "Mountain Vista (Panorama)",
      pieceCount: 500,
    },
  );
  return { definitionId, proposalId: proposalId as string };
};

describe("catalog.approveChangeProposal", () => {
  test("is admin-gated", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await expect(
      t.mutation(api.catalog.approveChangeProposal.approveChangeProposal, {
        changeProposalId: proposalId,
      }),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      asBob(t).mutation(
        api.catalog.approveChangeProposal.approveChangeProposal,
        {
          changeProposalId: proposalId,
        },
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("atomically approves the proposal AND applies the patch, stamps proposal_approved, appends both outbox events", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedMembers(t);
    const { definitionId, proposalId } = await fileAsBob(t);

    await asAdmin(t).mutation(
      api.catalog.approveChangeProposal.approveChangeProposal,
      { changeProposalId: proposalId },
    );

    expect((await proposalRow(t, proposalId))?.status).toBe("approved");
    const puzzle = await puzzleRow(t, definitionId);
    expect(puzzle?.title).toBe("Mountain Vista (Panorama)");
    expect(puzzle?.pieceCount).toBe(500);

    const names = await outboxNames(t);
    expect(names).toContain("ChangeProposalApproved");
    expect(names).toContain("PuzzleDefinitionUpdated");

    const actions = await allActions(t);
    const stamp = actions.find((a) => a.kind === "proposal_approved");
    expect(stamp).toMatchObject({
      actorId: alice,
      targetId: proposalId,
      targetLabel: "Mountain Vista (Panorama)",
    });
  });

  test("cannot approve twice (IllegalProposalTransition), patch not double-applied", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await asAdmin(t).mutation(
      api.catalog.approveChangeProposal.approveChangeProposal,
      { changeProposalId: proposalId },
    );
    await expectConvexCode(
      asAdmin(t).mutation(
        api.catalog.approveChangeProposal.approveChangeProposal,
        { changeProposalId: proposalId },
      ),
      "IllegalProposalTransition",
    );
  });
});

describe("catalog.rejectChangeProposal", () => {
  test("rejects with reason, leaves the definition untouched, stamps proposal_rejected", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { definitionId, proposalId } = await fileAsBob(t);

    await asAdmin(t).mutation(
      api.catalog.rejectChangeProposal.rejectChangeProposal,
      { changeProposalId: proposalId, reason: "title matches the box" },
    );

    const row = await proposalRow(t, proposalId);
    expect(row?.status).toBe("rejected");
    expect(row?.rejectionReason).toBe("title matches the box");
    expect((await puzzleRow(t, definitionId))?.title).toBe("Mountain Vista");

    const actions = await allActions(t);
    expect(actions.some((a) => a.kind === "proposal_rejected")).toBe(true);
    expect(await outboxNames(t)).toContain("ChangeProposalRejected");
  });

  test("a rejected proposal cannot be approved afterwards", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await asAdmin(t).mutation(
      api.catalog.rejectChangeProposal.rejectChangeProposal,
      { changeProposalId: proposalId },
    );
    await expectConvexCode(
      asAdmin(t).mutation(
        api.catalog.approveChangeProposal.approveChangeProposal,
        { changeProposalId: proposalId },
      ),
      "IllegalProposalTransition",
    );
  });
});
```

- [ ] Run: `pnpm --filter @jigswap/backend exec vitest run convex/changeProposalDecisions.test.ts` — expected: PASS.
- [ ] Commit: `git add -A && git commit -m "feat(backend): admin approve/reject change-proposal mutations with moderation audit stamps"`

---

### Task 10 — Read models: pending queue (with conflict flags), per-definition list, my proposals

**Files:**

- Create: `packages/backend/convex/catalog/proposalReadModel.ts` (shared pure helpers)
- Create: `packages/backend/convex/catalog/listPendingChangeProposals.ts`
- Create: `packages/backend/convex/catalog/listProposalsForDefinition.ts`
- Create: `packages/backend/convex/catalog/listMyChangeProposals.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (hand-register the 3 query modules)
- Create: `packages/backend/convex/changeProposalQueries.test.ts`

**Steps:**

- [ ] Create `packages/backend/convex/catalog/proposalReadModel.ts`:

```ts
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Read-model helpers shared by the proposal queries. Conflict detection is DERIVED here at
// read time (spec: "Show conflict, admin decides") — never stored, never enforced.

type Fields = Doc<"puzzleChangeProposals">["changes"];

// Structural equality good enough for these value shapes (scalars, one flat object, one array
// built with stable key order by toRow/currentFieldsFor).
const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Snapshot the definition row's CURRENT values in the proposal field shape, for exactly the
// fields the diff touches — the review UI's "current → proposed" left-hand side. `category` is
// resolved back to its aggregate id so it compares against the domain-shaped stored columns.
export const currentFieldsFor = async (
  ctx: QueryCtx,
  puzzle: Doc<"puzzles">,
  changes: Fields,
): Promise<Fields> => {
  let category: string | undefined;
  if (changes.category !== undefined && puzzle.category) {
    const row = await ctx.db.get(puzzle.category);
    category = row?.aggregateId ?? (puzzle.category as string);
  }
  return {
    title: changes.title !== undefined ? puzzle.title : undefined,
    description:
      changes.description !== undefined ? puzzle.description : undefined,
    brand: changes.brand !== undefined ? puzzle.brand : undefined,
    pieceCount:
      changes.pieceCount !== undefined ? puzzle.pieceCount : undefined,
    artist: changes.artist !== undefined ? puzzle.artist : undefined,
    series: changes.series !== undefined ? puzzle.series : undefined,
    barcodes:
      changes.barcodes !== undefined
        ? { ean: puzzle.ean, upc: puzzle.upc, modelNumber: puzzle.modelNumber }
        : undefined,
    dimensions:
      changes.dimensions !== undefined ? puzzle.dimensions : undefined,
    shape: changes.shape !== undefined ? puzzle.shape : undefined,
    difficulty:
      changes.difficulty !== undefined ? puzzle.difficulty : undefined,
    category: changes.category !== undefined ? category : undefined,
    tags: changes.tags !== undefined ? puzzle.tags : undefined,
    image:
      changes.image !== undefined
        ? (puzzle.image as string | undefined)
        : undefined,
  };
};

// The changed fields whose CURRENT value no longer matches the proposal's baseline — i.e. the
// definition moved (another approved proposal, a direct edit) since the proposer looked at it.
export const conflictFields = (
  changes: Fields,
  baseline: Fields,
  current: Fields,
): string[] =>
  (Object.keys(changes) as (keyof Fields)[])
    .filter((key) => changes[key] !== undefined)
    .filter((key) => !same(baseline[key], current[key]))
    .map((key) => key as string);

// Enrich a proposal row for admin/member lists: definition context, proposer name, current
// values + conflicts, resolved image URLs for review rendering.
export const enrichProposal = async (
  ctx: QueryCtx,
  proposal: Doc<"puzzleChangeProposals">,
) => {
  const puzzle = await ctx.db
    .query("puzzles")
    .withIndex("by_aggregate_id", (q) =>
      q.eq("aggregateId", proposal.puzzleDefinitionId),
    )
    .unique();
  const proposer = await ctx.db.get(proposal.proposedBy);

  const current = puzzle
    ? await currentFieldsFor(ctx, puzzle, proposal.changes)
    : ({} as Doc<"puzzleChangeProposals">["changes"]);
  const conflicts = puzzle
    ? conflictFields(proposal.changes, proposal.baseline, current)
    : [];

  return {
    ...proposal,
    puzzleId: puzzle?._id,
    definitionTitle: puzzle?.title,
    definitionImage: puzzle?.image
      ? await ctx.storage.getUrl(puzzle.image)
      : undefined,
    proposerName: proposer?.name,
    current,
    conflictFields: conflicts,
    hasConflict: conflicts.length > 0,
    proposedImageUrl: proposal.changes.image
      ? await ctx.storage.getUrl(
          proposal.changes.image as Parameters<typeof ctx.storage.getUrl>[0],
        )
      : undefined,
  };
};
```

- [ ] Create `packages/backend/convex/catalog/listPendingChangeProposals.ts`:

```ts
import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { enrichProposal } from "./proposalReadModel";

// Read side for the admin proposals queue: every PENDING community change proposal, newest
// first, enriched with definition context, proposer, and derived conflict flags.
export const listPendingChangeProposals = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const pending = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("desc")
      .collect();

    return Promise.all(pending.map((row) => enrichProposal(ctx, row)));
  },
});
```

- [ ] Create `packages/backend/convex/catalog/listProposalsForDefinition.ts`:

```ts
import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { enrichProposal } from "./proposalReadModel";

// Read side for the admin definition detail page: every proposal (open + decided) that targets
// this definition, newest first.
export const listProposalsForDefinition = query({
  args: { puzzleDefinitionId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const rows = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_definition", (q) =>
        q.eq("puzzleDefinitionId", args.puzzleDefinitionId),
      )
      .order("desc")
      .collect();

    return Promise.all(rows.map((row) => enrichProposal(ctx, row)));
  },
});
```

- [ ] Create `packages/backend/convex/catalog/listMyChangeProposals.ts`:

```ts
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enrichProposal } from "./proposalReadModel";

// Read side for the member's "my suggestions" view: their proposals across ALL statuses,
// newest first (pending ones are editable/withdrawable; decided ones show the outcome +
// rejection reason).
export const listMyChangeProposals = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);

    const mine = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_proposer", (q) =>
        // The domain MemberId is the user's Convex _id.
        q.eq("proposedBy", memberId as unknown as Id<"users">),
      )
      .order("desc")
      .collect();

    return Promise.all(mine.map((row) => enrichProposal(ctx, row)));
  },
});
```

- [ ] Hand-register the three query modules in `packages/backend/convex/_generated/api.d.ts`.
- [ ] Create `packages/backend/convex/changeProposalQueries.test.ts` — reuse the exact helper block from `changeProposals.test.ts` (Task 8: `modules`, `seedMembers`, `asAlice`/`asBob`/`asAdmin`, `submitApproved`, `dataOf` not needed here) plus Task 9's `fileAsBob`, then these tests:

```ts
describe("catalog.listPendingChangeProposals", () => {
  test("is admin-gated", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    await expect(
      t.query(
        api.catalog.listPendingChangeProposals.listPendingChangeProposals,
        {},
      ),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      asBob(t).query(
        api.catalog.listPendingChangeProposals.listPendingChangeProposals,
        {},
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("returns pending proposals enriched with definition, proposer, and NO conflict when nothing moved", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);

    const queue = await asAdmin(t).query(
      api.catalog.listPendingChangeProposals.listPendingChangeProposals,
      {},
    );

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      aggregateId: proposalId,
      definitionTitle: "Mountain Vista",
      proposerName: "Bob",
      hasConflict: false,
      conflictFields: [],
      changes: { title: "Mountain Vista (Panorama)", pieceCount: 500 },
      baseline: { title: "Mountain Vista", pieceCount: 1000 },
      current: { title: "Mountain Vista", pieceCount: 1000 },
    });
  });

  test("derives a conflict marker when the definition moved since the proposal was filed", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { definitionId } = await fileAsBob(t);

    // A direct edit lands between filing and review: title now differs from the baseline.
    await asAdmin(t).mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      { puzzleDefinitionId: definitionId, title: "Renamed Meanwhile" },
    );

    const queue = await asAdmin(t).query(
      api.catalog.listPendingChangeProposals.listPendingChangeProposals,
      {},
    );
    expect(queue[0]).toMatchObject({
      hasConflict: true,
      conflictFields: ["title"],
      baseline: { title: "Mountain Vista" },
      current: { title: "Renamed Meanwhile", pieceCount: 1000 },
    });
  });

  test("decided proposals leave the queue but stay in listProposalsForDefinition", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { definitionId, proposalId } = await fileAsBob(t);
    await asAdmin(t).mutation(
      api.catalog.rejectChangeProposal.rejectChangeProposal,
      { changeProposalId: proposalId, reason: "no" },
    );

    const queue = await asAdmin(t).query(
      api.catalog.listPendingChangeProposals.listPendingChangeProposals,
      {},
    );
    expect(queue).toHaveLength(0);

    const history = await asAdmin(t).query(
      api.catalog.listProposalsForDefinition.listProposalsForDefinition,
      { puzzleDefinitionId: definitionId },
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      status: "rejected",
      rejectionReason: "no",
    });
  });
});

describe("catalog.listMyChangeProposals", () => {
  test("requires auth and returns ONLY the caller's proposals across statuses", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { definitionId, proposalId } = await fileAsBob(t);
    await asBob(t).mutation(
      api.catalog.withdrawChangeProposal.withdrawChangeProposal,
      { changeProposalId: proposalId },
    );
    await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: definitionId, brand: "Ravensburger" },
    );

    await expect(
      t.query(api.catalog.listMyChangeProposals.listMyChangeProposals, {}),
    ).rejects.toThrow(/Unauthenticated/);

    const mine = await asBob(t).query(
      api.catalog.listMyChangeProposals.listMyChangeProposals,
      {},
    );
    expect(mine).toHaveLength(2);
    expect(mine.map((p) => p.status).sort()).toEqual(["pending", "withdrawn"]);
    expect(mine.every((p) => p.definitionTitle === "Mountain Vista")).toBe(
      true,
    );

    const alices = await asAlice(t).query(
      api.catalog.listMyChangeProposals.listMyChangeProposals,
      {},
    );
    expect(alices).toHaveLength(0);
  });
});
```

- [ ] Run: `pnpm --filter @jigswap/backend exec vitest run convex/changeProposalQueries.test.ts` — expected: PASS.
- [ ] Commit: `git add -A && git commit -m "feat(backend): change-proposal read models with derived conflict flags"`

---

### Task 11 — Proposer outcome notifications (Notifications subscriber)

**Files:**

- Modify: `packages/domain/src/notifications/domain/notification-type.ts` (2 new literals, union + array)
- Modify: `packages/backend/convex/schema.ts` (`notifications.type` union: 2 new literals)
- Modify: `packages/backend/convex/notifications/subscriber.ts` (2 new `translate` cases)
- Create: `packages/backend/convex/changeProposalNotifications.test.ts`

**Steps:**

- [ ] In `packages/domain/src/notifications/domain/notification-type.ts`, extend BOTH the union and the `NOTIFICATION_TYPES` array (they are kept in sync by construction):

```ts
  | "proposal_approved" // Catalog: ChangeProposalApproved (member's suggested edit applied)
  | "proposal_rejected"; // Catalog: suggested edit declined
```

```ts
  "proposal_approved",
  "proposal_rejected",
```

- [ ] In `packages/backend/convex/schema.ts`, extend the `notifications.type` union (after `"exchange_disputed"`):

```ts
      v.literal("proposal_approved"),
      v.literal("proposal_rejected"),
```

- [ ] In `packages/backend/convex/notifications/subscriber.ts`, add two cases to `translate` in the `--- Catalog ---` section, after `PuzzleDefinitionRejected`. The events carry `proposedBy` (a users `_id` string — SubmitterId is the member's Convex id) precisely so no proposal-row lookup is needed; the puzzle row is still loaded for the title + relatedId:

```ts
    case "ChangeProposalApproved": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(
          p.proposedBy as string,
          "proposal_approved",
          "Suggestion Applied",
          `Your suggested edit to "${puzzle.title}" was approved`,
          puzzle._id,
        ),
      ];
    }
    case "ChangeProposalRejected": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      const reason = p.reason as string | undefined;
      return [
        cmd(
          p.proposedBy as string,
          "proposal_rejected",
          "Suggestion Declined",
          reason
            ? `Your suggested edit to "${puzzle.title}" was declined: ${reason}`
            : `Your suggested edit to "${puzzle.title}" was declined`,
          puzzle._id,
        ),
      ];
    }
```

- [ ] Create `packages/backend/convex/changeProposalNotifications.test.ts` (helper block again, PLUS the scheduled-dispatch drain from `conversationSubscriber.test.ts:12-17`):

```ts
// Drain the async event dispatcher: yield a macrotask so the pending runAfter(0) job fires,
// then await any in-progress jobs — looped a few times to settle the chain.
const flushScheduled = async (t: ReturnType<typeof convexTest>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const notificationsFor = (
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );

describe("change-proposal outcome notifications", () => {
  test("approval notifies the proposer with proposal_approved", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await flushScheduled(t); // settle the Filed event first

    await asAdmin(t).mutation(
      api.catalog.approveChangeProposal.approveChangeProposal,
      { changeProposalId: proposalId },
    );
    await flushScheduled(t);

    const rows = await notificationsFor(t, bob);
    const outcome = rows.find((n) => n.type === "proposal_approved");
    expect(outcome).toBeDefined();
    expect(outcome?.message).toContain("Mountain Vista");
  });

  test("rejection notifies the proposer including the reason", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await flushScheduled(t);

    await asAdmin(t).mutation(
      api.catalog.rejectChangeProposal.rejectChangeProposal,
      { changeProposalId: proposalId, reason: "matches the box" },
    );
    await flushScheduled(t);

    const rows = await notificationsFor(t, bob);
    const outcome = rows.find((n) => n.type === "proposal_rejected");
    expect(outcome).toBeDefined();
    expect(outcome?.message).toContain("matches the box");
  });

  test("filing/editing/withdrawing produce NO notifications", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await asBob(t).mutation(
      api.catalog.withdrawChangeProposal.withdrawChangeProposal,
      { changeProposalId: proposalId },
    );
    await flushScheduled(t);

    expect(await notificationsFor(t, bob)).toEqual([]);
    expect(await notificationsFor(t, alice)).toEqual([]);
  });
});
```

(`fileAsBob` here files a proposal titled `"Mountain Vista (Panorama)"` against `submitApproved`'s `"Mountain Vista"`, as in Task 9.)

- [ ] Run: `pnpm --filter @jigswap/backend exec vitest run convex/changeProposalNotifications.test.ts` — expected: PASS.
- [ ] Run: `pnpm --filter @jigswap/domain exec vitest run` — expected: PASS (the notification-preference default-toggle spec derives from `NOTIFICATION_TYPES`, so it must absorb the two new literals; if a spec hardcodes the type count, update that expectation).
- [ ] Commit: `git add -A && git commit -m "feat(backend): notify proposer on change-proposal approval/rejection"`

---

### Task 12 — Gateway entries + full verification sweep

**Files:**

- Modify: `packages/gateway/src/operations.ts`

**Steps:**

- [ ] In `packages/gateway/src/operations.ts`, extend the `catalog` group (after the `reenable` entry, line 23) with the member + admin proposal operations:

```ts
    // Community change proposals against approved definitions: any member proposes a field
    // diff; the proposer edits/withdraws their pending one; admins decide from the queue.
    proposeChange:
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
    editChangeProposal: api.catalog.editChangeProposal.editChangeProposal,
    withdrawChangeProposal:
      api.catalog.withdrawChangeProposal.withdrawChangeProposal,
    approveChangeProposal:
      api.catalog.approveChangeProposal.approveChangeProposal,
    rejectChangeProposal:
      api.catalog.rejectChangeProposal.rejectChangeProposal,
    listMyChangeProposals:
      api.catalog.listMyChangeProposals.listMyChangeProposals,
```

and the `admin` group (near `listPuzzleDefinitions`, line 323-324):

```ts
    // Community change-proposal review: the pending queue (with derived conflict flags) and
    // the per-definition history for the detail page.
    listPendingChangeProposals:
      api.catalog.listPendingChangeProposals.listPendingChangeProposals,
    listProposalsForDefinition:
      api.catalog.listProposalsForDefinition.listProposalsForDefinition,
```

- [ ] Full verification sweep (mirrors CI; Nx cache off per repo convention):

```bash
pnpm exec nx run-many -t type-check --skip-nx-cache
pnpm exec nx run-many -t test --skip-nx-cache
pnpm exec nx run-many -t lint --skip-nx-cache
pnpm exec prettier --check .
```

Expected: all green except the known pre-existing web `routeTree.gen`-related `tsc` noise (only check that no NEW errors appear outside that pattern). Run `pnpm exec prettier --write` on any file it flags, re-check.

- [ ] Commit: `git add -A && git commit -m "feat(gateway): change-proposal operations"`
- [ ] Push and open the PR: title `feat(catalog): community change proposals on approved definitions — backend core`; body summarises the aggregate, the atomic approve orchestration, audit trail (domainEvents + moderationActions), notifications, and notes PR 2 (member UI) / PR 3 (admin UI + direct edit) follow.

---

## Follow-up plans (not in this PR)

- **PR 2 — Member web UI** (`2026-07-09-change-proposals-member-ui.md`, to be written when this PR lands): "Suggest an edit" pre-filled diff form on `/_dashboard/puzzles/$id` (client computes the diff, sends only changed fields + comment; switches to "Edit your suggestion" when the member has an open proposal), "My suggestions" list with edit/withdraw, i18n EN/NL.
- **PR 3 — Admin web UI + direct edit** (`2026-07-09-change-proposals-admin-ui.md`): proposals queue tab on `/admin/puzzles` with conflict badges, per-field current→proposed review screen (baseline shown on conflicts, images side-by-side), reject-with-reason AlertDialog, proposals section + Edit form on `/admin/puzzles/$puzzleId` submitting to the existing `updatePuzzleDefinition`, which gains a `definition_edited` moderationActions stamp for admin edits of others' definitions, i18n EN/NL, Activity Log learning the three new audit kinds.
