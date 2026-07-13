# Follow Requests + Follow Notifications Implementation Plan (Phase 2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 2 of the friend-discovery spec (`docs/superpowers/specs/2026-07-11-friend-discovery-and-public-catalog-design.md`): a `FollowRequest` aggregate with a hybrid follow model (public targets: instant follow, unchanged; private targets: request → approve/decline), three new notification types wired through all five sync points, and the web UI (visibility-aware FollowButton, incoming-requests strip on the People page).

**Architecture:** Hexagonal, mirroring the existing Social `Follow` shape exactly. (1) **Domain** (`packages/domain/src/social`): a `FollowRequest` aggregate (`pending → approved | declined`) beside `Follow`, with events `FollowRequested`/`FollowRequestApproved`/`FollowRequestDeclined`; four use cases through a new `FollowRequestRepository` out-port; `approve-follow-request` orchestrates BOTH aggregates (approve request → establish Follow edge → save both → publish both event batches). (2) **Backend** (`packages/backend/convex/social`): `followMember` becomes visibility-aware at the composition root using the existing `profileVisibilityOf` chokepoint (private target with no reverse edge → request path); new thin mutations + two read queries. The Notifications subscriber translates the new events; `MemberFollowed` gains a `new_follower` case with approval-suppression so approvers aren't double-notified. (3) **Web**: FollowButton rewritten around a composite `getFollowRelation` read; a `FollowRequestsStrip` above the People grid.

**Tech Stack:** TypeScript, Convex (convex-test + vitest), vitest domain specs, TanStack Query + Convex react-query, use-intl, Nx monorepo, pnpm, prettier.

---

## Executor setup & non-negotiable constraints

- [ ] Branch from `main` in a worktree: `git worktree add ../jigswap-follow-requests -b feat/follow-requests main`. **All file writes must go through the worktree path, never the main-repo absolute path.**
- [ ] `pnpm install --frozen-lockfile` in the worktree root.
- [ ] If `docs/superpowers/specs/2026-07-11-friend-discovery-and-public-catalog-design.md` is not yet committed on this branch, make it the first commit together with this plan: `git add docs/superpowers/specs/2026-07-11-friend-discovery-and-public-catalog-design.md docs/superpowers/plans/2026-07-11-phase-2-follow-requests.md && git commit -m "docs: friend-discovery spec + phase-2 plan"`

**CRITICAL worktree caveat — Convex codegen cannot run here.** `convex codegen` needs a live `CONVEX_DEPLOYMENT` and fails in a worktree. This plan adds five new Convex function modules (`social/approveFollowRequest.ts`, `social/cancelFollowRequest.ts`, `social/declineFollowRequest.ts`, `social/getFollowRelation.ts`, `social/listIncomingFollowRequests.ts`). You MUST register each by **hand-editing `packages/backend/convex/_generated/api.d.ts`**: add an `import type * as social_<name> from "../social/<name>.js";` line AND the matching `"social/<name>": typeof social_<name>,` entry inside `declare const fullApi: ApiFromModules<{ ... }>`, mirroring the existing sibling entries and keeping both lists alphabetical. `_generated/api.js` needs **no** edit. Schema changes need NO `_generated` edit. A real `convex dev` later regenerates the file.

**Scope guardrails (embed in every review):**

- `Follow` (`follow.ts`) is **not modified**. Approval creates the edge via the existing `Follow.establish` + `FollowRepository`.
- Decline is **silent**: no notification case for `FollowRequestDeclined`, and `getFollowRelation` presents a declined request still inside its 7-day cooldown **as pending** to the requester — decline must be indistinguishable from "no response yet", including against direct API probing.
- Exception rule (spec): a private target who **already follows the actor** gets an instant follow, not a request — otherwise the "follow back" accelerator would dead-end in a request to someone who initiated contact.
- Owner going private does NOT retroactively remove followers (asserted in a test).
- The three new notification types use the repo's **snake_case** literal convention: `new_follower`, `follow_request_received`, `follow_request_approved` (the spec's dotted names `follow.new_follower` etc. deviate from every existing literal; snake_case wins).
- Notification actions: the strip on `/people` is where approve/decline/follow-back happen; all three notification types deep-link to `/people` via `notificationHref`. (No action buttons inside notification rows — that UI doesn't exist and is out of scope.)
- No tabs on the People page (Phase 4). No QR/invite code (Phase 3). No `/members/$handle` work (Phase 1) — the FollowButton upgrade is what makes the Phase 1 interstitial request-aware, wherever that button is mounted.

**Repo conventions:** domain tests are colocated `.spec.ts` in `packages/domain`; backend tests are `.test.ts` at the `packages/backend/convex/` ROOT (never in subdirs — the `import.meta.glob` module bundling breaks otherwise). Prettier-format every changed file before each commit (CI runs `format:check` first): `pnpm exec prettier --write <files>`.

**Test commands used throughout:**

- Domain: `pnpm --filter @jigswap/domain exec vitest run <file>` (all: `pnpm --filter @jigswap/domain exec vitest run`)
- Backend: `pnpm --filter @jigswap/backend exec vitest run convex/followRequests.test.ts` (all: `pnpm --filter @jigswap/backend exec vitest run`)
- Typecheck: `pnpm exec nx run-many -t type-check --skip-nx-cache` (web `routeTree.gen` noise is known; ignore errors only in `routeTree.gen.ts`)

---

### Task 1 — Domain scaffolding: id brand, errors, events

**Files:**

- Modify: `packages/domain/src/shared-kernel/branded-ids.ts` (add after `toFollowId`, line ~48)
- Modify: `packages/domain/src/social/domain/ids.ts`
- Modify: `packages/domain/src/social/domain/errors.ts`
- Modify: `packages/domain/src/social/application/errors.ts`
- Modify: `packages/domain/src/social/domain/events.ts`

- [ ] **Step 1: Add the branded id helper**

In `branded-ids.ts`, directly after the `toFollowId` export:

```typescript
export const toFollowRequestId = (value: string): Id<"FollowRequestId"> =>
  toId<"FollowRequestId">(value);
```

(Match the exact one-liner style of the neighbouring helpers — check how `toFollowId` at line 48 wraps.)

- [ ] **Step 2: Add the aggregate id type**

In `packages/domain/src/social/domain/ids.ts`, after `FollowId`:

```typescript
export type FollowRequestId = Id<"FollowRequestId">;
```

- [ ] **Step 3: Extend SocialError with the invalid-transition code**

In `packages/domain/src/social/domain/errors.ts`, extend the code union and add a factory:

```typescript
export type SocialErrorCode =
  | "SelfFollow"
  | "RequestNotPending"
  | "InvalidDisplayName"
  | "EmptyCommentText"
  | "InvalidCommentRating";
```

and inside the class, after `selfFollow()`:

```typescript
  // A follow request can only be approved or declined while it is still pending.
  static requestNotPending(): SocialError {
    return new SocialError(
      "RequestNotPending",
      "This follow request has already been resolved",
    );
  }
```

- [ ] **Step 4: Extend SocialApplicationError**

In `packages/domain/src/social/application/errors.ts`, extend the union:

```typescript
export type SocialApplicationErrorCode =
  | "AlreadyFollowing"
  | "NotFollowing"
  | "ProfileNotFound"
  | "RequestNotFound"
  | "NotRequestTarget"
  | "NotRequestOwner";
```

and add factories after `profileNotFound`:

```typescript
  // No follow request exists with the given id.
  static requestNotFound(): SocialApplicationError {
    return new SocialApplicationError(
      "RequestNotFound",
      "No such follow request",
    );
  }

  // Only the member the request targets may approve or decline it.
  static notRequestTarget(): SocialApplicationError {
    return new SocialApplicationError(
      "NotRequestTarget",
      "Only the requested member can resolve this follow request",
    );
  }

  // Only the member who sent the request may cancel it.
  static notRequestOwner(): SocialApplicationError {
    return new SocialApplicationError(
      "NotRequestOwner",
      "Only the requesting member can cancel this follow request",
    );
  }
```

- [ ] **Step 5: Add the three domain events**

In `packages/domain/src/social/domain/events.ts`: add `FollowRequestId` to the import from `./ids`, add the three classes after `MemberUnfollowed`, and extend `SocialDomainEvent`:

```typescript
// A member asked to follow a private-profile member; the target must approve.
export class FollowRequested implements DomainEvent {
  readonly name = "FollowRequested";
  constructor(
    readonly requestId: FollowRequestId,
    readonly requesterId: MemberId,
    readonly targetId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// The target approved a pending follow request; the follow edge is established alongside.
export class FollowRequestApproved implements DomainEvent {
  readonly name = "FollowRequestApproved";
  constructor(
    readonly requestId: FollowRequestId,
    readonly requesterId: MemberId,
    readonly targetId: MemberId,
    readonly occurredAt: Date,
  ) {}
}

// The target declined a pending follow request. Deliberately never notified (silent decline).
export class FollowRequestDeclined implements DomainEvent {
  readonly name = "FollowRequestDeclined";
  constructor(
    readonly requestId: FollowRequestId,
    readonly requesterId: MemberId,
    readonly targetId: MemberId,
    readonly occurredAt: Date,
  ) {}
}
```

```typescript
export type SocialDomainEvent =
  | MemberFollowed
  | MemberUnfollowed
  | FollowRequested
  | FollowRequestApproved
  | FollowRequestDeclined
  | ProfileUpdated
  | ProfileVisibilityChanged
  | CommentPosted
  | PhotoCommentPosted
  | ProfileShelfArranged;
```

- [ ] **Step 6: Verify it compiles**

Run: `pnpm --filter @jigswap/domain exec vitest run src/social/domain/follow.spec.ts`
Expected: PASS (existing tests unaffected; new code compiles).

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/domain/src/shared-kernel/branded-ids.ts packages/domain/src/social/domain/ids.ts packages/domain/src/social/domain/errors.ts packages/domain/src/social/application/errors.ts packages/domain/src/social/domain/events.ts
git add -A packages/domain && git commit -m "feat(domain): follow-request id, errors, and events"
```

---

### Task 2 — `FollowRequest` aggregate (TDD)

**Files:**

- Test: `packages/domain/src/social/domain/follow-request.spec.ts`
- Create: `packages/domain/src/social/domain/follow-request.ts`
- Modify: `packages/domain/src/social/domain/index.ts`

- [ ] **Step 1: Write the failing spec**

`packages/domain/src/social/domain/follow-request.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { toFollowRequestId, toMemberId } from "../../shared-kernel";
import { FollowRequest } from "./follow-request";

const requester = toMemberId("alice");
const target = toMemberId("bob");
const requestId = toFollowRequestId("req-1");
const NOW = new Date("2026-07-11T10:00:00Z");
const LATER = new Date("2026-07-12T10:00:00Z");

const pending = () => {
  const result = FollowRequest.request({
    id: requestId,
    requesterId: requester,
    targetId: target,
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup");
  return result.value;
};

describe("FollowRequest.request", () => {
  it("creates a pending request and records FollowRequested", () => {
    const request = pending();
    expect(request.status).toBe("pending");
    expect(request.requesterId).toBe(requester);
    expect(request.targetId).toBe(target);

    const events = request.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["FollowRequested"]);
  });

  it("rejects a self-request", () => {
    const result = FollowRequest.request({
      id: requestId,
      requesterId: requester,
      targetId: requester,
      now: NOW,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfFollow");
  });

  it("drains events only once", () => {
    const request = pending();
    expect(request.pullEvents()).toHaveLength(1);
    expect(request.pullEvents()).toHaveLength(0);
  });
});

describe("FollowRequest.approve", () => {
  it("moves pending → approved, stamps respondedAt, records FollowRequestApproved", () => {
    const request = pending();
    request.pullEvents();

    const result = request.approve(LATER);
    expect(result.isOk).toBe(true);
    expect(request.status).toBe("approved");
    expect(request.toState().respondedAt).toBe(LATER);
    expect(request.pullEvents().map((e) => e.name)).toEqual([
      "FollowRequestApproved",
    ]);
  });

  it("rejects approving a non-pending request", () => {
    const request = pending();
    request.approve(LATER);
    const again = request.approve(LATER);
    expect(again.isErr).toBe(true);
    if (again.isErr) expect(again.error.code).toBe("RequestNotPending");
  });
});

describe("FollowRequest.decline", () => {
  it("moves pending → declined, stamps respondedAt, records FollowRequestDeclined", () => {
    const request = pending();
    request.pullEvents();

    const result = request.decline(LATER);
    expect(result.isOk).toBe(true);
    expect(request.status).toBe("declined");
    expect(request.toState().respondedAt).toBe(LATER);
    expect(request.pullEvents().map((e) => e.name)).toEqual([
      "FollowRequestDeclined",
    ]);
  });

  it("rejects declining a non-pending request", () => {
    const request = pending();
    request.decline(LATER);
    const again = request.decline(LATER);
    expect(again.isErr).toBe(true);
    if (again.isErr) expect(again.error.code).toBe("RequestNotPending");
  });
});

describe("FollowRequest rehydration", () => {
  it("round-trips through toState/rehydrate without re-emitting events", () => {
    const request = pending();
    const rehydrated = FollowRequest.rehydrate(request.toState());
    expect(rehydrated.id).toBe(requestId);
    expect(rehydrated.status).toBe("pending");
    expect(rehydrated.pullEvents()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm --filter @jigswap/domain exec vitest run src/social/domain/follow-request.spec.ts`
Expected: FAIL — cannot resolve `./follow-request`.

- [ ] **Step 3: Implement the aggregate**

`packages/domain/src/social/domain/follow-request.ts`:

```typescript
import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { SocialError } from "./errors";
import {
  FollowRequestApproved,
  FollowRequestDeclined,
  FollowRequested,
} from "./events";
import { FollowRequestId, MemberId } from "./ids";

export type FollowRequestStatus = "pending" | "approved" | "declined";

// Input to request(): the two parties and the instant the request is made. Pair-uniqueness
// (one open request per requester/target) needs the repository and is an application-layer
// concern; the aggregate decides only the self-request rule from its own data.
export interface RequestProps {
  readonly id: FollowRequestId;
  readonly requesterId: MemberId;
  readonly targetId: MemberId;
  readonly now: Date;
}

// The persistable shape, kept close to a `followRequests` table row so the 1b mapper is a
// trivial field-for-field translation. respondedAt is set when the target resolves it and
// backs the 7-day decline cooldown.
export interface FollowRequestState {
  readonly id: FollowRequestId;
  readonly requesterId: MemberId;
  readonly targetId: MemberId;
  readonly status: FollowRequestStatus;
  readonly createdAt: Date;
  readonly respondedAt?: Date;
}

// FollowRequest: a member asks to follow a private-profile member. Lifecycle is
// pending → approved | declined; only the pending state accepts a resolution. Records
// FollowRequested on creation and the matching event on each resolution.
export class FollowRequest {
  private events: DomainEvent[] = [];

  private constructor(private state: FollowRequestState) {}

  get id(): FollowRequestId {
    return this.state.id;
  }

  get requesterId(): MemberId {
    return this.state.requesterId;
  }

  get targetId(): MemberId {
    return this.state.targetId;
  }

  get status(): FollowRequestStatus {
    return this.state.status;
  }

  // Create a brand-new pending request. Rejects a self-request; pair-uniqueness is gated
  // upstream by the application layer via the repository.
  static request(props: RequestProps): Result<FollowRequest, SocialError> {
    if (props.requesterId === props.targetId) {
      return err(SocialError.selfFollow());
    }
    const request = new FollowRequest({
      id: props.id,
      requesterId: props.requesterId,
      targetId: props.targetId,
      status: "pending",
      createdAt: props.now,
    });
    request.record(
      new FollowRequested(
        props.id,
        props.requesterId,
        props.targetId,
        props.now,
      ),
    );
    return ok(request);
  }

  // Target accepts: pending → approved. The application layer establishes the Follow edge
  // in the same transaction; the aggregate only records the approval.
  approve(now: Date): Result<void, SocialError> {
    if (this.state.status !== "pending") {
      return err(SocialError.requestNotPending());
    }
    this.state = { ...this.state, status: "approved", respondedAt: now };
    this.record(
      new FollowRequestApproved(
        this.state.id,
        this.state.requesterId,
        this.state.targetId,
        now,
      ),
    );
    return ok(undefined);
  }

  // Target declines: pending → declined. Deliberately silent downstream — no notification
  // subscriber case exists for FollowRequestDeclined; respondedAt starts the re-request cooldown.
  decline(now: Date): Result<void, SocialError> {
    if (this.state.status !== "pending") {
      return err(SocialError.requestNotPending());
    }
    this.state = { ...this.state, status: "declined", respondedAt: now };
    this.record(
      new FollowRequestDeclined(
        this.state.id,
        this.state.requesterId,
        this.state.targetId,
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

  static rehydrate(state: FollowRequestState): FollowRequest {
    return new FollowRequest(state);
  }

  toState(): FollowRequestState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
```

- [ ] **Step 4: Export from the domain barrel**

In `packages/domain/src/social/domain/index.ts`, add alphabetically:

```typescript
export * from "./follow-request";
```

- [ ] **Step 5: Run the spec — must pass**

Run: `pnpm --filter @jigswap/domain exec vitest run src/social/domain/follow-request.spec.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/domain/src/social/domain/follow-request.ts packages/domain/src/social/domain/follow-request.spec.ts packages/domain/src/social/domain/index.ts
git add -A packages/domain && git commit -m "feat(domain): FollowRequest aggregate with pending/approved/declined lifecycle"
```

---

### Task 3 — Ports + in-memory testing fakes

**Files:**

- Create: `packages/domain/src/social/application/ports/out/follow-request.repository.ts`
- Modify: `packages/domain/src/social/application/ports/out/id-generators.ts`
- Modify: `packages/domain/src/social/application/ports/out/index.ts`
- Create: `packages/domain/src/social/application/testing/in-memory-follow-request.repository.ts`
- Modify: `packages/domain/src/social/application/testing/sequential-id-generators.ts`
- Modify: `packages/domain/src/social/application/testing/index.ts`

- [ ] **Step 1: Repository port**

`packages/domain/src/social/application/ports/out/follow-request.repository.ts`:

```typescript
import { FollowRequest, FollowRequestId, MemberId } from "../../../domain";

// Outbound port: persistence for FollowRequest aggregates. The 1b-convex adapter implements
// this over `ctx.db` (the `followRequests` table) behind a mapper; the domain never sees a row.
export interface FollowRequestRepository {
  // Backs pair-uniqueness and the cooldown rule: the most recent request for this
  // (requester, target) pair regardless of status, else null.
  findByPair(
    requesterId: MemberId,
    targetId: MemberId,
  ): Promise<FollowRequest | null>;
  findById(id: FollowRequestId): Promise<FollowRequest | null>;
  save(request: FollowRequest): Promise<void>;
  remove(request: FollowRequest): Promise<void>;
}
```

- [ ] **Step 2: Id-generator port**

In `packages/domain/src/social/application/ports/out/id-generators.ts`: add `FollowRequestId` to the import from `../../../domain` and append:

```typescript
export interface FollowRequestIdGenerator {
  next(): FollowRequestId;
}
```

- [ ] **Step 3: Export the port**

In `packages/domain/src/social/application/ports/out/index.ts`, add alphabetically:

```typescript
export * from "./follow-request.repository";
```

- [ ] **Step 4: In-memory fake**

`packages/domain/src/social/application/testing/in-memory-follow-request.repository.ts` (mirror the style of `in-memory-follow.repository.ts` — read it first and match its storage idiom; the reference implementation):

```typescript
import { FollowRequest, FollowRequestId, MemberId } from "../../domain";
import { FollowRequestRepository } from "../ports/out/follow-request.repository";

// In-memory FollowRequestRepository for use-case specs. Keyed by aggregate id; findByPair
// scans, matching the adapter's index semantics (one live row per pair).
export class InMemoryFollowRequestRepository implements FollowRequestRepository {
  private rows = new Map<string, FollowRequest>();

  async findByPair(
    requesterId: MemberId,
    targetId: MemberId,
  ): Promise<FollowRequest | null> {
    for (const request of this.rows.values()) {
      if (
        request.requesterId === requesterId &&
        request.targetId === targetId
      ) {
        return request;
      }
    }
    return null;
  }

  async findById(id: FollowRequestId): Promise<FollowRequest | null> {
    return this.rows.get(id as string) ?? null;
  }

  async save(request: FollowRequest): Promise<void> {
    this.rows.set(request.id as string, request);
  }

  async remove(request: FollowRequest): Promise<void> {
    this.rows.delete(request.id as string);
  }

  size(): number {
    return this.rows.size;
  }
}
```

- [ ] **Step 5: Sequential id fake**

In `packages/domain/src/social/application/testing/sequential-id-generators.ts`, mirror `SequentialFollowIdGenerator` (read the file; add the same shape):

```typescript
export class SequentialFollowRequestIdGenerator implements FollowRequestIdGenerator {
  private n = 0;
  next(): FollowRequestId {
    this.n += 1;
    return toFollowRequestId(`follow-request-${this.n}`);
  }
}
```

(Add `FollowRequestIdGenerator` to the ports import and `toFollowRequestId`/`FollowRequestId` to the existing imports, matching how the sibling generators import theirs.)

- [ ] **Step 6: Export the fake**

In `packages/domain/src/social/application/testing/index.ts`, add alphabetically:

```typescript
export * from "./in-memory-follow-request.repository";
```

- [ ] **Step 7: Verify it compiles**

Run: `pnpm --filter @jigswap/domain exec vitest run src/social`
Expected: PASS (all existing social tests still green).

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write packages/domain/src/social/application
git add -A packages/domain && git commit -m "feat(domain): FollowRequest repository/id ports + testing fakes"
```

---

### Task 4 — `request-follow` use case (TDD)

**Files:**

- Test: `packages/domain/src/social/application/use-cases/request-follow.spec.ts`
- Create: `packages/domain/src/social/application/ports/in/request-follow.port.ts`
- Create: `packages/domain/src/social/application/use-cases/request-follow.ts`
- Modify: `packages/domain/src/social/application/ports/in/index.ts`, `packages/domain/src/social/application/use-cases/index.ts`

- [ ] **Step 1: Write the failing spec**

`packages/domain/src/social/application/use-cases/request-follow.spec.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId } from "../../../shared-kernel";
import { Follow } from "../../domain";
import {
  FixedClock,
  InMemoryFollowRepository,
  InMemoryFollowRequestRepository,
  RecordingEventPublisher,
  SequentialFollowIdGenerator,
  SequentialFollowRequestIdGenerator,
} from "../testing";
import { COOLDOWN_MS, makeRequestFollow } from "./request-follow";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const NOW = new Date("2026-07-11T10:00:00Z");

describe("makeRequestFollow", () => {
  let requests: InMemoryFollowRequestRepository;
  let follows: InMemoryFollowRepository;
  let events: RecordingEventPublisher;
  let request: ReturnType<typeof makeRequestFollow>;

  const build = (now: Date) => {
    request = makeRequestFollow({
      requests,
      follows,
      requestIds: new SequentialFollowRequestIdGenerator(),
      events,
      clock: new FixedClock(now),
    });
  };

  beforeEach(() => {
    requests = new InMemoryFollowRequestRepository();
    follows = new InMemoryFollowRepository();
    events = new RecordingEventPublisher();
    build(NOW);
  });

  it("creates a pending request and publishes FollowRequested", async () => {
    const result = await request({ requesterId: alice, targetId: bob });
    expect(result.isOk).toBe(true);
    expect(requests.size()).toBe(1);
    expect(events.names()).toEqual(["FollowRequested"]);
  });

  it("is idempotent while a request is pending: returns the same id, no new row/event", async () => {
    const first = await request({ requesterId: alice, targetId: bob });
    const second = await request({ requesterId: alice, targetId: bob });
    expect(second.isOk).toBe(true);
    if (first.isOk && second.isOk) expect(second.value).toBe(first.value);
    expect(requests.size()).toBe(1);
    expect(events.names()).toEqual(["FollowRequested"]); // only the first
  });

  it("rejects when the requester already follows the target", async () => {
    const edge = Follow.establish({
      id: new SequentialFollowIdGenerator().next(),
      followerId: alice,
      followeeId: bob,
      now: NOW,
    });
    if (!edge.isOk) throw new Error("setup");
    await follows.save(edge.value);

    const result = await request({ requesterId: alice, targetId: bob });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("AlreadyFollowing");
  });

  it("silently no-ops during the decline cooldown (indistinguishable from pending)", async () => {
    const first = await request({ requesterId: alice, targetId: bob });
    if (!first.isOk) throw new Error("setup");
    const row = await requests.findByPair(alice, bob);
    if (!row) throw new Error("setup");
    row.decline(NOW);
    await requests.save(row);

    build(new Date(NOW.getTime() + COOLDOWN_MS - 1000)); // still inside cooldown
    const again = await request({ requesterId: alice, targetId: bob });
    expect(again.isOk).toBe(true);
    if (again.isOk) expect(again.value).toBe(first.value);
    expect(requests.size()).toBe(1); // no new row
  });

  it("re-opens with a fresh request after the cooldown has passed", async () => {
    const first = await request({ requesterId: alice, targetId: bob });
    if (!first.isOk) throw new Error("setup");
    const row = await requests.findByPair(alice, bob);
    if (!row) throw new Error("setup");
    row.decline(NOW);
    await requests.save(row);

    build(new Date(NOW.getTime() + COOLDOWN_MS + 1000)); // past cooldown
    const again = await request({ requesterId: alice, targetId: bob });
    expect(again.isOk).toBe(true);
    if (again.isOk) expect(again.value).not.toBe(first.value);
    expect(requests.size()).toBe(1); // stale row replaced
    const fresh = await requests.findByPair(alice, bob);
    expect(fresh?.status).toBe("pending");
  });

  it("rejects a self-request", async () => {
    const result = await request({ requesterId: alice, targetId: alice });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfFollow");
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm --filter @jigswap/domain exec vitest run src/social/application/use-cases/request-follow.spec.ts`
Expected: FAIL — cannot resolve `./request-follow`.

- [ ] **Step 3: Inbound port**

`packages/domain/src/social/application/ports/in/request-follow.port.ts`:

```typescript
import { Result } from "../../../../shared-kernel";
import { FollowRequestId, MemberId, SocialError } from "../../../domain";
import { SocialApplicationError } from "../../errors";

// The command to request to follow a private-profile member. `requesterId` is resolved from
// auth by the transport adapter; the visibility decision (instant follow vs request) is made
// at the composition root before this port is invoked.
export interface RequestFollowCommand {
  readonly requesterId: MemberId;
  readonly targetId: MemberId;
}

// Inbound port: yields the (new or still-pending) request's id. Idempotent for an open
// request and silently idempotent during a decline cooldown, so a declined request is
// indistinguishable from an unanswered one.
export interface RequestFollow {
  (
    cmd: RequestFollowCommand,
  ): Promise<Result<FollowRequestId, SocialError | SocialApplicationError>>;
}
```

- [ ] **Step 4: Use case**

`packages/domain/src/social/application/use-cases/request-follow.ts`:

```typescript
import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { FollowRequest, FollowRequestId, SocialError } from "../../domain";
import { SocialApplicationError } from "../errors";
import {
  RequestFollow,
  RequestFollowCommand,
} from "../ports/in/request-follow.port";
import { FollowRepository } from "../ports/out/follow.repository";
import { FollowRequestRepository } from "../ports/out/follow-request.repository";
import { FollowRequestIdGenerator } from "../ports/out/id-generators";

// How long after a (silent) decline the requester's next attempt is swallowed. Chosen in the
// spec: 7 days. Exported so the read side presents "declined but cooling down" as pending.
export const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export interface RequestFollowDeps {
  readonly requests: FollowRequestRepository;
  readonly follows: FollowRepository;
  readonly requestIds: FollowRequestIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: reject if already following; dedupe against the existing request for the
// pair (pending → idempotent; declined inside cooldown → SILENT idempotent no-op so probing
// cannot reveal a decline; anything older → replace with a fresh pending request).
export const makeRequestFollow =
  (deps: RequestFollowDeps): RequestFollow =>
  async (
    cmd: RequestFollowCommand,
  ): Promise<Result<FollowRequestId, SocialError | SocialApplicationError>> => {
    const edge = await deps.follows.find(cmd.requesterId, cmd.targetId);
    if (edge) {
      return err(
        SocialApplicationError.alreadyFollowing(cmd.requesterId, cmd.targetId),
      );
    }

    const now = deps.clock.now();
    const existing = await deps.requests.findByPair(
      cmd.requesterId,
      cmd.targetId,
    );
    if (existing) {
      const state = existing.toState();
      if (state.status === "pending") return ok(existing.id);
      if (
        state.status === "declined" &&
        state.respondedAt &&
        now.getTime() - state.respondedAt.getTime() < COOLDOWN_MS
      ) {
        // Silent decline: inside the cooldown a re-request is swallowed and the old id
        // returned, exactly as if the target simply hadn't answered yet.
        return ok(existing.id);
      }
      // Cooldown passed, or a stale approved row whose edge was later unfollowed: replace.
      await deps.requests.remove(existing);
    }

    const request = FollowRequest.request({
      id: deps.requestIds.next(),
      requesterId: cmd.requesterId,
      targetId: cmd.targetId,
      now,
    });
    if (request.isErr) return err(request.error);

    await deps.requests.save(request.value);
    await deps.events.publish(request.value.pullEvents());
    return ok(request.value.id);
  };
```

- [ ] **Step 5: Barrel exports**

Add to `packages/domain/src/social/application/ports/in/index.ts`: `export * from "./request-follow.port";`
Add to `packages/domain/src/social/application/use-cases/index.ts`: `export * from "./request-follow";`

- [ ] **Step 6: Run — must pass**

Run: `pnpm --filter @jigswap/domain exec vitest run src/social/application/use-cases/request-follow.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/domain/src/social/application
git add -A packages/domain && git commit -m "feat(domain): request-follow use case with silent decline cooldown"
```

---

### Task 5 — `approve` / `decline` / `cancel` use cases (TDD)

**Files:**

- Test: `packages/domain/src/social/application/use-cases/resolve-follow-request.spec.ts`
- Create: `packages/domain/src/social/application/ports/in/approve-follow-request.port.ts`, `.../decline-follow-request.port.ts`, `.../cancel-follow-request.port.ts`
- Create: `packages/domain/src/social/application/use-cases/approve-follow-request.ts`, `.../decline-follow-request.ts`, `.../cancel-follow-request.ts`
- Modify: both `index.ts` barrels

- [ ] **Step 1: Write the failing spec**

`packages/domain/src/social/application/use-cases/resolve-follow-request.spec.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId } from "../../../shared-kernel";
import { Follow, FollowRequestId } from "../../domain";
import {
  FixedClock,
  InMemoryFollowRepository,
  InMemoryFollowRequestRepository,
  RecordingEventPublisher,
  SequentialFollowIdGenerator,
  SequentialFollowRequestIdGenerator,
} from "../testing";
import { makeApproveFollowRequest } from "./approve-follow-request";
import { makeCancelFollowRequest } from "./cancel-follow-request";
import { makeDeclineFollowRequest } from "./decline-follow-request";
import { makeRequestFollow } from "./request-follow";

const alice = toMemberId("alice"); // requester
const bob = toMemberId("bob"); // target
const carol = toMemberId("carol"); // bystander
const NOW = new Date("2026-07-11T10:00:00Z");

describe("resolving follow requests", () => {
  let requests: InMemoryFollowRequestRepository;
  let follows: InMemoryFollowRepository;
  let events: RecordingEventPublisher;
  let requestId: FollowRequestId;
  let approve: ReturnType<typeof makeApproveFollowRequest>;
  let decline: ReturnType<typeof makeDeclineFollowRequest>;
  let cancel: ReturnType<typeof makeCancelFollowRequest>;

  beforeEach(async () => {
    requests = new InMemoryFollowRequestRepository();
    follows = new InMemoryFollowRepository();
    events = new RecordingEventPublisher();
    const clock = new FixedClock(NOW);
    const request = makeRequestFollow({
      requests,
      follows,
      requestIds: new SequentialFollowRequestIdGenerator(),
      events,
      clock,
    });
    const created = await request({ requesterId: alice, targetId: bob });
    if (!created.isOk) throw new Error("setup");
    requestId = created.value;
    events.published.length = 0; // discard the FollowRequested from setup

    const deps = {
      requests,
      follows,
      followIds: new SequentialFollowIdGenerator(),
      events,
      clock,
    };
    approve = makeApproveFollowRequest(deps);
    decline = makeDeclineFollowRequest({ requests, events, clock });
    cancel = makeCancelFollowRequest({ requests });
  });

  it("approve: creates the requester→target edge and publishes both events", async () => {
    const result = await approve({ requestId, actorId: bob });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    expect(result.value.requesterId).toBe(alice);
    expect(result.value.alreadyFollowsBack).toBe(false);
    expect(await follows.find(alice, bob)).not.toBeNull();
    expect(events.names().sort()).toEqual([
      "FollowRequestApproved",
      "MemberFollowed",
    ]);
  });

  it("approve: reports alreadyFollowsBack when the target already follows the requester", async () => {
    const back = Follow.establish({
      id: new SequentialFollowIdGenerator().next(),
      followerId: bob,
      followeeId: alice,
      now: NOW,
    });
    if (!back.isOk) throw new Error("setup");
    await follows.save(back.value);

    const result = await approve({ requestId, actorId: bob });
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.alreadyFollowsBack).toBe(true);
  });

  it("approve: only the target may approve", async () => {
    const result = await approve({ requestId, actorId: carol });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotRequestTarget");
    expect(await follows.find(alice, bob)).toBeNull();
  });

  it("approve: unknown request id", async () => {
    const result = await approve({
      requestId: "nope" as FollowRequestId,
      actorId: bob,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("RequestNotFound");
  });

  it("decline: marks declined, publishes FollowRequestDeclined, creates no edge", async () => {
    const result = await decline({ requestId, actorId: bob });
    expect(result.isOk).toBe(true);
    expect(events.names()).toEqual(["FollowRequestDeclined"]);
    expect(await follows.find(alice, bob)).toBeNull();
    const row = await requests.findById(requestId);
    expect(row?.status).toBe("declined");
  });

  it("decline: only the target may decline", async () => {
    const result = await decline({ requestId, actorId: alice });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotRequestTarget");
  });

  it("cancel: the requester withdraws their pending request (row removed, no events)", async () => {
    const result = await cancel({ requestId, actorId: alice });
    expect(result.isOk).toBe(true);
    expect(await requests.findById(requestId)).toBeNull();
    expect(events.published).toHaveLength(0);
  });

  it("cancel: only the requester may cancel", async () => {
    const result = await cancel({ requestId, actorId: bob });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotRequestOwner");
  });

  it("approve after decline fails (RequestNotPending)", async () => {
    await decline({ requestId, actorId: bob });
    const result = await approve({ requestId, actorId: bob });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("RequestNotPending");
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm --filter @jigswap/domain exec vitest run src/social/application/use-cases/resolve-follow-request.spec.ts`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: The three ports**

`packages/domain/src/social/application/ports/in/approve-follow-request.port.ts`:

```typescript
import { Result } from "../../../../shared-kernel";
import { FollowRequestId, MemberId, SocialError } from "../../../domain";
import { SocialApplicationError } from "../../errors";

export interface ApproveFollowRequestCommand {
  readonly requestId: FollowRequestId;
  readonly actorId: MemberId; // must be the request's target
}

// What the UI needs to offer "follow back" in one tap after approving.
export interface ApproveFollowRequestResult {
  readonly requesterId: MemberId;
  readonly alreadyFollowsBack: boolean;
}

export interface ApproveFollowRequest {
  (
    cmd: ApproveFollowRequestCommand,
  ): Promise<
    Result<ApproveFollowRequestResult, SocialError | SocialApplicationError>
  >;
}
```

`packages/domain/src/social/application/ports/in/decline-follow-request.port.ts`:

```typescript
import { Result } from "../../../../shared-kernel";
import { FollowRequestId, MemberId, SocialError } from "../../../domain";
import { SocialApplicationError } from "../../errors";

export interface DeclineFollowRequestCommand {
  readonly requestId: FollowRequestId;
  readonly actorId: MemberId; // must be the request's target
}

export interface DeclineFollowRequest {
  (
    cmd: DeclineFollowRequestCommand,
  ): Promise<Result<void, SocialError | SocialApplicationError>>;
}
```

`packages/domain/src/social/application/ports/in/cancel-follow-request.port.ts`:

```typescript
import { Result } from "../../../../shared-kernel";
import { FollowRequestId, MemberId } from "../../../domain";
import { SocialApplicationError } from "../../errors";

export interface CancelFollowRequestCommand {
  readonly requestId: FollowRequestId;
  readonly actorId: MemberId; // must be the request's requester
}

export interface CancelFollowRequest {
  (
    cmd: CancelFollowRequestCommand,
  ): Promise<Result<void, SocialApplicationError>>;
}
```

- [ ] **Step 4: The three use cases**

`packages/domain/src/social/application/use-cases/approve-follow-request.ts`:

```typescript
import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { Follow, SocialError } from "../../domain";
import { SocialApplicationError } from "../errors";
import {
  ApproveFollowRequest,
  ApproveFollowRequestCommand,
  ApproveFollowRequestResult,
} from "../ports/in/approve-follow-request.port";
import { FollowRepository } from "../ports/out/follow.repository";
import { FollowRequestRepository } from "../ports/out/follow-request.repository";
import { FollowIdGenerator } from "../ports/out/id-generators";

export interface ApproveFollowRequestDeps {
  readonly requests: FollowRequestRepository;
  readonly follows: FollowRepository;
  readonly followIds: FollowIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Orchestrates BOTH aggregates in one transaction: approve the request, then establish the
// requester→target Follow edge (tolerating an already-existing edge), then publish both event
// batches. The actor ACL (only the target resolves) is checked here — it needs the loaded
// aggregate, not just auth.
export const makeApproveFollowRequest =
  (deps: ApproveFollowRequestDeps): ApproveFollowRequest =>
  async (
    cmd: ApproveFollowRequestCommand,
  ): Promise<
    Result<ApproveFollowRequestResult, SocialError | SocialApplicationError>
  > => {
    const request = await deps.requests.findById(cmd.requestId);
    if (!request) return err(SocialApplicationError.requestNotFound());
    if (request.targetId !== cmd.actorId) {
      return err(SocialApplicationError.notRequestTarget());
    }

    const now = deps.clock.now();
    const approved = request.approve(now);
    if (approved.isErr) return err(approved.error);

    // Establish the edge unless a stray one already exists (duplicate-tolerant).
    const existingEdge = await deps.follows.find(
      request.requesterId,
      request.targetId,
    );
    let edgeEvents: readonly unknown[] = [];
    if (!existingEdge) {
      const edge = Follow.establish({
        id: deps.followIds.next(),
        followerId: request.requesterId,
        followeeId: request.targetId,
        now,
      });
      if (edge.isErr) return err(edge.error);
      await deps.follows.save(edge.value);
      edgeEvents = edge.value.pullEvents();
    }

    await deps.requests.save(request);
    await deps.events.publish([
      ...request.pullEvents(),
      ...(edgeEvents as never[]),
    ]);

    const alreadyFollowsBack =
      (await deps.follows.find(request.targetId, request.requesterId)) !== null;
    return ok({ requesterId: request.requesterId, alreadyFollowsBack });
  };
```

`packages/domain/src/social/application/use-cases/decline-follow-request.ts`:

```typescript
import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { SocialError } from "../../domain";
import { SocialApplicationError } from "../errors";
import {
  DeclineFollowRequest,
  DeclineFollowRequestCommand,
} from "../ports/in/decline-follow-request.port";
import { FollowRequestRepository } from "../ports/out/follow-request.repository";

export interface DeclineFollowRequestDeps {
  readonly requests: FollowRequestRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Decline is silent downstream: the event is recorded for the durable log, but the
// Notifications subscriber deliberately has no case for it and the read side keeps
// presenting the request as pending until the cooldown lapses.
export const makeDeclineFollowRequest =
  (deps: DeclineFollowRequestDeps): DeclineFollowRequest =>
  async (
    cmd: DeclineFollowRequestCommand,
  ): Promise<Result<void, SocialError | SocialApplicationError>> => {
    const request = await deps.requests.findById(cmd.requestId);
    if (!request) return err(SocialApplicationError.requestNotFound());
    if (request.targetId !== cmd.actorId) {
      return err(SocialApplicationError.notRequestTarget());
    }

    const declined = request.decline(deps.clock.now());
    if (declined.isErr) return err(declined.error);

    await deps.requests.save(request);
    await deps.events.publish(request.pullEvents());
    return ok(undefined);
  };
```

`packages/domain/src/social/application/use-cases/cancel-follow-request.ts`:

```typescript
import { err, ok, Result } from "../../../shared-kernel";
import { SocialApplicationError } from "../errors";
import {
  CancelFollowRequest,
  CancelFollowRequestCommand,
} from "../ports/in/cancel-follow-request.port";
import { FollowRequestRepository } from "../ports/out/follow-request.repository";

export interface CancelFollowRequestDeps {
  readonly requests: FollowRequestRepository;
}

// Withdrawing a pending request removes the row outright: nothing subscribes to a
// cancellation, and a removed row lets the requester re-request immediately.
export const makeCancelFollowRequest =
  (deps: CancelFollowRequestDeps): CancelFollowRequest =>
  async (
    cmd: CancelFollowRequestCommand,
  ): Promise<Result<void, SocialApplicationError>> => {
    const request = await deps.requests.findById(cmd.requestId);
    if (!request) return err(SocialApplicationError.requestNotFound());
    if (request.requesterId !== cmd.actorId) {
      return err(SocialApplicationError.notRequestOwner());
    }
    await deps.requests.remove(request);
    return ok(undefined);
  };
```

- [ ] **Step 5: Barrel exports**

Add to `ports/in/index.ts`: `export * from "./approve-follow-request.port"; export * from "./cancel-follow-request.port"; export * from "./decline-follow-request.port";` (one per line, alphabetical). Add to `use-cases/index.ts`: the three matching `export * from` lines.

- [ ] **Step 6: Run — must pass**

Run: `pnpm --filter @jigswap/domain exec vitest run src/social/application/use-cases/resolve-follow-request.spec.ts`
Expected: PASS (9 tests). Then the full domain suite: `pnpm --filter @jigswap/domain exec vitest run` — PASS.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/domain/src/social/application
git add -A packages/domain && git commit -m "feat(domain): approve/decline/cancel follow-request use cases"
```

---

### Task 6 — Sync points 1+2: domain NotificationType and Convex schema

**Files:**

- Modify: `packages/domain/src/notifications/domain/notification-type.ts`
- Modify: `packages/backend/convex/schema.ts` (notifications validator ~line 709–729; new table after `follows` ~line 884)

- [ ] **Step 1: Domain notification types (sync point 1 of 5)**

In `notification-type.ts`, append to the union (before the closing `;`):

```typescript
  | "new_follower" // Social: MemberFollowed (instant follow; suppressed when it came from an approval)
  | "follow_request_received" // Social: FollowRequested — a private-profile member has a pending request
  | "follow_request_approved"; // Social: FollowRequestApproved — the requester's access was granted
```

and append the same three strings to the `NOTIFICATION_TYPES` array:

```typescript
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
```

- [ ] **Step 2: Schema validator (sync point 2 of 5) + the new table**

In `packages/backend/convex/schema.ts`, inside the `notifications.type` `v.union(...)`, after `v.literal("admin_definition_submitted"),`:

```typescript
      v.literal("new_follower"),
      v.literal("follow_request_received"),
      v.literal("follow_request_approved"),
```

After the `follows` table definition (ends ~line 884), add:

```typescript
  // FollowRequest aggregate rows: a member asking to follow a private-profile member.
  // status pending → approved | declined; respondedAt backs the 7-day decline cooldown.
  // Declined rows are kept (not deleted) so a re-request inside the cooldown can be
  // silently swallowed — deleting them would make a decline observable.
  followRequests: defineTable({
    aggregateId: v.string(),
    requesterId: v.id("users"),
    targetId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
    ),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_requester", ["requesterId"])
    .index("by_target", ["targetId"])
    .index("by_requester_target", ["requesterId", "targetId"])
    .index("by_aggregate_id", ["aggregateId"]),
```

- [ ] **Step 3: Verify backend still compiles/tests**

Run: `pnpm --filter @jigswap/backend exec vitest run convex/adminReviewNotifications.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write packages/domain/src/notifications/domain/notification-type.ts packages/backend/convex/schema.ts
git add -A packages/domain packages/backend && git commit -m "feat(backend): followRequests table + follow notification type literals"
```

---

### Task 7 — Backend adapters + composition roots + codegen registration

**Files:**

- Modify: `packages/backend/convex/social/adapters/mappers.ts`, `.../adapters/idGenerators.ts`
- Create: `packages/backend/convex/social/adapters/convexFollowRequestRepository.ts`
- Modify: `packages/backend/convex/social/followMember.ts`
- Create: `packages/backend/convex/social/approveFollowRequest.ts`, `.../cancelFollowRequest.ts`, `.../declineFollowRequest.ts`, `.../getFollowRelation.ts`, `.../listIncomingFollowRequests.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (hand-registration, see setup note)

- [ ] **Step 1: Mapper**

In `social/adapters/mappers.ts`: add `FollowRequest`, `type FollowRequestState`, `toFollowRequestId` to the `@jigswap/domain` import; add the row type and two mappers after the Follow mappers:

```typescript
export type FollowRequestRow = Omit<
  Doc<"followRequests">,
  "_id" | "_creationTime"
>;

// Row -> FollowRequest aggregate.
export const followRequestToDomain = (
  row: Doc<"followRequests">,
): FollowRequest => {
  const state: FollowRequestState = {
    id: toFollowRequestId(row.aggregateId),
    requesterId: toMemberId(row.requesterId),
    targetId: toMemberId(row.targetId),
    status: row.status,
    createdAt: new Date(row.createdAt),
    respondedAt:
      row.respondedAt !== undefined ? new Date(row.respondedAt) : undefined,
  };
  return FollowRequest.rehydrate(state);
};

// FollowRequest aggregate -> row payload.
export const followRequestToRow = (
  request: FollowRequest,
): FollowRequestRow => {
  const state = request.toState();
  return {
    aggregateId: state.id as string,
    requesterId: state.requesterId as unknown as Id<"users">,
    targetId: state.targetId as unknown as Id<"users">,
    status: state.status,
    createdAt: state.createdAt.getTime(),
    respondedAt: state.respondedAt?.getTime(),
  };
};
```

- [ ] **Step 2: Id generator adapter**

In `social/adapters/idGenerators.ts`: add `type FollowRequestId`, `type FollowRequestIdGenerator`, `toFollowRequestId` to the import and append:

```typescript
export const followRequestIdGenerator: FollowRequestIdGenerator = {
  next: (): FollowRequestId => toFollowRequestId(crypto.randomUUID()),
};
```

- [ ] **Step 3: Repository adapter**

`packages/backend/convex/social/adapters/convexFollowRequestRepository.ts`:

```typescript
import {
  type FollowRequest,
  type FollowRequestId,
  type FollowRequestRepository,
  type MemberId,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { followRequestToDomain, followRequestToRow } from "./mappers";

// Driven adapter for the FollowRequestRepository port over `ctx.db`. The only place the
// `followRequests` table is read/written for the domain path; the mapper is the ACL.
export const convexFollowRequestRepository = (
  ctx: MutationCtx,
): FollowRequestRepository => ({
  async findByPair(
    requesterId: MemberId,
    targetId: MemberId,
  ): Promise<FollowRequest | null> {
    const row = await ctx.db
      .query("followRequests")
      .withIndex("by_requester_target", (q) =>
        q
          .eq("requesterId", requesterId as unknown as Id<"users">)
          .eq("targetId", targetId as unknown as Id<"users">),
      )
      .first();
    return row ? followRequestToDomain(row) : null;
  },

  async findById(id: FollowRequestId): Promise<FollowRequest | null> {
    const row = await ctx.db
      .query("followRequests")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();
    return row ? followRequestToDomain(row) : null;
  },

  async save(request: FollowRequest): Promise<void> {
    const row = followRequestToRow(request);
    const existing = await ctx.db
      .query("followRequests")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.aggregateId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("followRequests", row);
  },

  async remove(request: FollowRequest): Promise<void> {
    const existing = await ctx.db
      .query("followRequests")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", request.id as string),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});
```

- [ ] **Step 4: Visibility-aware `followMember`**

Replace the body of `packages/backend/convex/social/followMember.ts` with:

```typescript
import {
  makeFollowMember,
  makeRequestFollow,
  toMemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { convexFollowRequestRepository } from "./adapters/convexFollowRequestRepository";
import {
  followIdGenerator,
  followRequestIdGenerator,
} from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";
import { profileVisibilityOf } from "./privacy";

// Composition root for following a member — now visibility-aware (spec: hybrid follow
// model). Public target → instant follow, exactly as before. Private target → a pending
// FollowRequest instead, UNLESS the target already follows the actor (they initiated
// contact; a follow-back completes mutuality and must not dead-end in a request).
// The follower is derived from auth, never the client.
export const followMember = mutation({
  args: { followeeId: v.id("users") },
  handler: async (
    ctx,
    args,
  ): Promise<{ kind: "followed" | "requested"; id: string }> => {
    const followerId = await requireMember(ctx);

    const visibility = await profileVisibilityOf(ctx, args.followeeId);
    const reverseEdge = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q
          .eq("followerId", args.followeeId)
          .eq("followeeId", followerId as unknown as Id<"users">),
      )
      .first();

    if (visibility === "private" && !reverseEdge) {
      const requestFollowUseCase = makeRequestFollow({
        requests: convexFollowRequestRepository(ctx),
        follows: convexFollowRepository(ctx),
        requestIds: followRequestIdGenerator,
        events: inProcessEventPublisher(ctx),
        clock: systemClock,
      });
      const result = await requestFollowUseCase({
        requesterId: followerId,
        targetId: toMemberId(args.followeeId),
      });
      if (result.isErr) throw toConvexError(result.error);
      return { kind: "requested", id: result.value as string };
    }

    const followMemberUseCase = makeFollowMember({
      follows: convexFollowRepository(ctx),
      followIds: followIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await followMemberUseCase({
      followerId,
      followeeId: toMemberId(args.followeeId),
    });
    if (result.isErr) throw toConvexError(result.error);
    return { kind: "followed", id: result.value as string };
  },
});
```

**Breaking-change check:** the return type changes from `string` to `{kind, id}`. Run `grep -rn "gateway.social.follow\b\|social.followMember" apps/web/src packages/` — the only mutation consumer must be `follow-button.tsx` (rewritten in Task 11). If anything else consumes the return value, update it in this task.

- [ ] **Step 5: The three resolution mutations**

`packages/backend/convex/social/approveFollowRequest.ts`:

```typescript
import { makeApproveFollowRequest, toFollowRequestId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { convexFollowRequestRepository } from "./adapters/convexFollowRequestRepository";
import { followIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root: the acting member approves a follow request they received. The actor
// ACL (must be the request's target) is enforced in the use case against the loaded
// aggregate. Returns what the UI needs to offer a one-tap follow-back.
export const approveFollowRequest = mutation({
  args: { requestId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ requesterId: string; alreadyFollowsBack: boolean }> => {
    const actorId = await requireMember(ctx);
    const useCase = makeApproveFollowRequest({
      requests: convexFollowRequestRepository(ctx),
      follows: convexFollowRepository(ctx),
      followIds: followIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await useCase({
      requestId: toFollowRequestId(args.requestId),
      actorId,
    });
    if (result.isErr) throw toConvexError(result.error);
    return {
      requesterId: result.value.requesterId as string,
      alreadyFollowsBack: result.value.alreadyFollowsBack,
    };
  },
});
```

`packages/backend/convex/social/declineFollowRequest.ts`:

```typescript
import { makeDeclineFollowRequest, toFollowRequestId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexFollowRequestRepository } from "./adapters/convexFollowRequestRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root: the acting member declines a follow request they received. Silent by
// design: no notification is emitted anywhere downstream.
export const declineFollowRequest = mutation({
  args: { requestId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const actorId = await requireMember(ctx);
    const useCase = makeDeclineFollowRequest({
      requests: convexFollowRequestRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await useCase({
      requestId: toFollowRequestId(args.requestId),
      actorId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
```

`packages/backend/convex/social/cancelFollowRequest.ts`:

```typescript
import { makeCancelFollowRequest, toFollowRequestId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexFollowRequestRepository } from "./adapters/convexFollowRequestRepository";
import { toConvexError } from "./errors";

// Composition root: the acting member withdraws a follow request they sent.
export const cancelFollowRequest = mutation({
  args: { requestId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const actorId = await requireMember(ctx);
    const useCase = makeCancelFollowRequest({
      requests: convexFollowRequestRepository(ctx),
    });
    const result = await useCase({
      requestId: toFollowRequestId(args.requestId),
      actorId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
```

- [ ] **Step 6: The two reads**

`packages/backend/convex/social/getFollowRelation.ts`:

```typescript
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { profileVisibilityOf } from "./privacy";

// Re-declared here rather than imported from the domain: the read side is outside the
// hexagon and must not couple to application-layer constants. Keep in sync with
// COOLDOWN_MS in request-follow.ts (7 days).
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// Read side: the composite relation state the FollowButton needs for a target member.
// SILENT-DECLINE MASKING: a declined request still inside its cooldown is reported as
// pending — the requester must not be able to distinguish a decline from no answer,
// including by probing this query.
export const getFollowRelation = query({
  args: { memberId: v.id("users") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    following: boolean;
    followsYou: boolean;
    targetIsPrivate: boolean;
    pendingRequest: { requestId: string; requestedAt: number } | null;
  }> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;

    const edge = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", me).eq("followeeId", args.memberId),
      )
      .first();
    const reverse = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", args.memberId).eq("followeeId", me),
      )
      .first();
    const visibility = await profileVisibilityOf(ctx, args.memberId);

    const request = await ctx.db
      .query("followRequests")
      .withIndex("by_requester_target", (q) =>
        q.eq("requesterId", me).eq("targetId", args.memberId),
      )
      .first();

    const now = Date.now();
    const pendingRequest =
      request &&
      (request.status === "pending" ||
        (request.status === "declined" &&
          request.respondedAt !== undefined &&
          now - request.respondedAt < COOLDOWN_MS))
        ? { requestId: request.aggregateId, requestedAt: request.createdAt }
        : null;

    return {
      following: edge !== null,
      followsYou: reverse !== null,
      targetIsPrivate: visibility === "private",
      pendingRequest,
    };
  },
});
```

`packages/backend/convex/social/listIncomingFollowRequests.ts`:

```typescript
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toMemberView } from "../identity/toMemberView";
import type { Id } from "../_generated/dataModel";

// Read side: the acting member's pending incoming follow requests, joined with the
// requester's member view and whether the member already follows them back (drives the
// "Approve & follow back" affordance). Requesters of a request addressed TO you are by
// definition allowed to be shown to you — no extra projection needed.
export const listIncomingFollowRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;

    const rows = await ctx.db
      .query("followRequests")
      .withIndex("by_target", (q) => q.eq("targetId", me))
      .collect();
    const pending = rows.filter((r) => r.status === "pending");

    const result = [];
    for (const row of pending) {
      const requester = await toMemberView(ctx, row.requesterId);
      if (!requester) continue;
      const followsBack = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", me).eq("followeeId", row.requesterId),
        )
        .first();
      result.push({
        requestId: row.aggregateId,
        requestedAt: row.createdAt,
        requester,
        alreadyFollowing: followsBack !== null,
      });
    }
    return result.sort((a, b) => b.requestedAt - a.requestedAt);
  },
});
```

**Verify `toMemberView`'s exact signature first** (`packages/backend/convex/identity/toMemberView.ts`) — if it takes `(ctx, userId)` and returns a view or null, the above is right; adapt the call if its shape differs (e.g. takes a `Doc<"users">`).

- [ ] **Step 7: Hand-register the five new modules in `_generated/api.d.ts`**

Per the setup note: five import lines + five `fullApi` entries (`social/approveFollowRequest`, `social/cancelFollowRequest`, `social/declineFollowRequest`, `social/getFollowRelation`, `social/listIncomingFollowRequests`), alphabetical among the existing `social/*` entries.

- [ ] **Step 8: Typecheck**

Run: `pnpm exec nx run-many -t type-check --skip-nx-cache --projects=@jigswap/domain,@jigswap/backend`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
pnpm exec prettier --write packages/backend/convex/social packages/backend/convex/_generated/api.d.ts
git add -A packages/backend && git commit -m "feat(backend): visibility-aware follow + follow-request mutations and reads"
```

---

### Task 8 — Sync point 3: Notifications subscriber (TDD via backend test)

**Files:**

- Test: `packages/backend/convex/followRequests.test.ts` (created here, extended in Task 9)
- Modify: `packages/backend/convex/notifications/subscriber.ts`

- [ ] **Step 1: Write the failing backend test (subscriber slice)**

`packages/backend/convex/followRequests.test.ts` — seed helpers mirror `adminReviewNotifications.test.ts` exactly (same `modules` glob, `flushScheduled`, `notificationsFor`):

```typescript
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Hybrid follow model: public target → instant follow (+ new_follower notification);
// private target → pending request (+ follow_request_received); approval creates the edge
// (+ follow_request_approved to the requester, and NO new_follower to the approver — the
// approval suppression); decline is silent end-to-end.

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
    const alice = await mkUser("clerk_alice", "Alice");
    const bob = await mkUser("clerk_bob", "Bob");
    const carol = await mkUser("clerk_carol", "Carol");
    // Bob's profile is PRIVATE; alice and carol have no profile row (= public by default).
    await ctx.db.insert("profiles", {
      aggregateId: "profile-bob",
      memberId: bob,
      displayName: "Bob",
      visibility: "private",
      updatedAt: now,
    });
    return { alice, bob, carol };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asCarol = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_carol" });

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

const followEdges = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("follows").collect());

describe("follow notifications", () => {
  test("instant follow of a public member notifies them (new_follower)", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol } = await seedMembers(t);

    const result = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: carol },
    );
    expect(result.kind).toBe("followed");
    await flushScheduled(t);

    const carolNotifications = await notificationsFor(t, carol);
    expect(carolNotifications.map((n) => n.type)).toEqual(["new_follower"]);
    const aliceNotifications = await notificationsFor(t, alice);
    expect(aliceNotifications).toHaveLength(0);
  });

  test("following a private member creates a request and notifies the target (follow_request_received), no edge yet", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);

    const result = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    expect(result.kind).toBe("requested");
    await flushScheduled(t);

    expect(await followEdges(t)).toHaveLength(0);
    const bobNotifications = await notificationsFor(t, bob);
    expect(bobNotifications.map((n) => n.type)).toEqual([
      "follow_request_received",
    ]);
  });

  test("approval creates the edge, notifies the requester, and does NOT new_follower-notify the approver", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedMembers(t);

    const requested = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    await flushScheduled(t);

    const approval = await asBob(t).mutation(
      api.social.approveFollowRequest.approveFollowRequest,
      { requestId: requested.id },
    );
    expect(approval.alreadyFollowsBack).toBe(false);
    await flushScheduled(t);

    const edges = await followEdges(t);
    expect(edges).toHaveLength(1);
    expect(edges[0].followerId).toBe(alice);
    expect(edges[0].followeeId).toBe(bob);

    const aliceNotifications = await notificationsFor(t, alice);
    expect(aliceNotifications.map((n) => n.type)).toEqual([
      "follow_request_approved",
    ]);
    // Approval suppression: bob got follow_request_received earlier and must NOT also get
    // new_follower for the edge his own approval created.
    const bobNotifications = await notificationsFor(t, bob);
    expect(bobNotifications.map((n) => n.type)).toEqual([
      "follow_request_received",
    ]);
  });

  test("decline is silent: no new notifications for anyone", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedMembers(t);

    const requested = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    await flushScheduled(t);

    await asBob(t).mutation(
      api.social.declineFollowRequest.declineFollowRequest,
      { requestId: requested.id },
    );
    await flushScheduled(t);

    const aliceNotifications = await notificationsFor(t, alice);
    expect(aliceNotifications).toHaveLength(0);
    const bobNotifications = await notificationsFor(t, bob);
    expect(bobNotifications.map((n) => n.type)).toEqual([
      "follow_request_received",
    ]);
    expect(await followEdges(t)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm --filter @jigswap/backend exec vitest run convex/followRequests.test.ts`
Expected: FAIL — the follow currently produces no notifications (`new_follower` cases missing).

- [ ] **Step 3: Add the subscriber cases (sync point 3 of 5)**

In `packages/backend/convex/notifications/subscriber.ts`, inside `translate()`'s switch, add a `// --- Social ---` section before `default:`:

```typescript
    // --- Social ---
    case "MemberFollowed": {
      // Approval suppression: when this edge came from approving a follow request, the
      // followee IS the approver — they already got follow_request_received and just acted
      // on it. Suppress only when the approval is fresh (10 min) so a stale approved row
      // never permanently mutes a later, genuine re-follow of the same pair.
      const followerId = p.followerId as string;
      const followeeId = p.followeeId as string;
      const request = await ctx.db
        .query("followRequests")
        .withIndex("by_requester_target", (q) =>
          q
            .eq("requesterId", followerId as Id<"users">)
            .eq("targetId", followeeId as Id<"users">),
        )
        .first();
      const occurredAt = p.occurredAt as number;
      if (
        request?.status === "approved" &&
        request.respondedAt !== undefined &&
        Math.abs(occurredAt - request.respondedAt) < 10 * 60 * 1000
      ) {
        return [];
      }
      return [
        cmd(
          followeeId,
          "new_follower",
          "New follower",
          "Someone started following you",
          followerId, // the follower's users _id; the UI deep-links to /people
        ),
      ];
    }
    case "FollowRequested": {
      return [
        cmd(
          p.targetId as string,
          "follow_request_received",
          "Follow request",
          "Someone asked to follow you",
          p.requesterId as string,
        ),
      ];
    }
    case "FollowRequestApproved": {
      return [
        cmd(
          p.requesterId as string,
          "follow_request_approved",
          "Request approved",
          "Your follow request was approved",
          p.targetId as string,
        ),
      ];
    }
    // FollowRequestDeclined: DELIBERATELY unmapped — decline is silent (spec).
```

**Verify the payload shape first:** confirm in `packages/backend/convex/events/` (the `makeEventPublisher`/`recordAndSchedule` path) that event data fields are serialised as branded-id strings + epoch-millis `occurredAt`. If `occurredAt` is not in the payload, use the `domainEvents` row's own timestamp field instead (check `event.occurredAt` / `event._creationTime`).

- [ ] **Step 4: Run — must pass**

Run: `pnpm --filter @jigswap/backend exec vitest run convex/followRequests.test.ts`
Expected: PASS (4 tests). Also run `pnpm --filter @jigswap/backend exec vitest run convex/adminReviewNotifications.test.ts` — still PASS.

- [ ] **Step 5: Verify the preference matrix tolerates the new types**

Run: `grep -n "NOTIFICATION_TYPES" packages/backend/convex/notifications/adapters/makeNotify.ts packages/backend/convex/notifications/*.ts`
Check how unknown/unset per-type preferences default (expected: enabled). If defaults are seeded from the domain `NOTIFICATION_TYPES` array, Task 6 already covered it. Note the finding in the commit message.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/backend/convex/notifications/subscriber.ts packages/backend/convex/followRequests.test.ts
git add -A packages/backend && git commit -m "feat(backend): follow/follow-request notification translation with approval suppression"
```

---

### Task 9 — Backend lifecycle + privacy tests (extend `followRequests.test.ts`)

**Files:**

- Modify: `packages/backend/convex/followRequests.test.ts`

- [ ] **Step 1: Append the lifecycle/privacy describe block**

```typescript
describe("follow request lifecycle", () => {
  test("re-following a private member while a request is pending is idempotent (one row)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);

    const first = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    const second = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    expect(second).toEqual(first);
    const rows = await t.run((ctx) => ctx.db.query("followRequests").collect());
    expect(rows).toHaveLength(1);
  });

  test("private target that already follows the actor gets an INSTANT follow (follow-back exception)", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedMembers(t);
    // Bob (private) follows alice first (alice is public → instant).
    await asBob(t).mutation(api.social.followMember.followMember, {
      followeeId: alice,
    });

    const result = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    expect(result.kind).toBe("followed");
    expect(await followEdges(t)).toHaveLength(2);
  });

  test("cancel removes the pending request", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const requested = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );

    await asAlice(t).mutation(
      api.social.cancelFollowRequest.cancelFollowRequest,
      { requestId: requested.id },
    );
    const rows = await t.run((ctx) => ctx.db.query("followRequests").collect());
    expect(rows).toHaveLength(0);
  });

  test("only the target can approve/decline; only the requester can cancel", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const requested = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );

    await expect(
      asCarol(t).mutation(
        api.social.approveFollowRequest.approveFollowRequest,
        { requestId: requested.id },
      ),
    ).rejects.toThrow();
    await expect(
      asCarol(t).mutation(
        api.social.declineFollowRequest.declineFollowRequest,
        { requestId: requested.id },
      ),
    ).rejects.toThrow();
    await expect(
      asBob(t).mutation(api.social.cancelFollowRequest.cancelFollowRequest, {
        requestId: requested.id,
      }),
    ).rejects.toThrow();
  });

  test("getFollowRelation masks a fresh decline as still-pending (silent decline)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const requested = await asAlice(t).mutation(
      api.social.followMember.followMember,
      { followeeId: bob },
    );
    await asBob(t).mutation(
      api.social.declineFollowRequest.declineFollowRequest,
      { requestId: requested.id },
    );

    const relation = await asAlice(t).query(
      api.social.getFollowRelation.getFollowRelation,
      { memberId: bob },
    );
    expect(relation.pendingRequest).not.toBeNull();
    expect(relation.pendingRequest?.requestId).toBe(requested.id);
    expect(relation.following).toBe(false);
    expect(relation.targetIsPrivate).toBe(true);
  });

  test("going private does not retroactively remove followers", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol } = await seedMembers(t);
    // Alice follows carol while carol is public (instant edge).
    await asAlice(t).mutation(api.social.followMember.followMember, {
      followeeId: carol,
    });
    // Carol then goes private.
    await asCarol(t).mutation(
      api.social.setProfileVisibility.setProfileVisibility,
      { visibility: "private" },
    );

    expect(await followEdges(t)).toHaveLength(1);
    const relation = await asAlice(t).query(
      api.social.getFollowRelation.getFollowRelation,
      { memberId: carol },
    );
    expect(relation.following).toBe(true);
    expect(relation.targetIsPrivate).toBe(true);
  });

  test("incoming list shows pending requests with requester view, newest first", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    await asAlice(t).mutation(api.social.followMember.followMember, {
      followeeId: bob,
    });
    await asCarol(t).mutation(api.social.followMember.followMember, {
      followeeId: bob,
    });

    const incoming = await asBob(t).query(
      api.social.listIncomingFollowRequests.listIncomingFollowRequests,
      {},
    );
    expect(incoming).toHaveLength(2);
    expect(incoming.map((r) => r.requester.name).sort()).toEqual([
      "Alice",
      "Carol",
    ]);
    expect(incoming[0].alreadyFollowing).toBe(false);
  });
});
```

**Check `setProfileVisibility`'s args first** (`packages/backend/convex/social/setProfileVisibility.ts`) — if the member has no profile row yet it may error or upsert; if it requires an existing profile, seed carol a public profile row in `seedMembers` and adjust. Adjust the args shape (`{ visibility: "private" }`) to the actual signature.

- [ ] **Step 2: Run — must pass**

Run: `pnpm --filter @jigswap/backend exec vitest run convex/followRequests.test.ts`
Expected: PASS (11 tests total).

- [ ] **Step 3: Full backend suite**

Run: `pnpm --filter @jigswap/backend exec vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write packages/backend/convex/followRequests.test.ts
git add -A packages/backend && git commit -m "test(backend): follow-request lifecycle, silent decline, and privacy invariants"
```

---

### Task 10 — Sync points 4+5: web notification meta + locales

**Files:**

- Modify: `apps/web/src/components/notifications/notification-meta.ts`
- Modify: `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json`

- [ ] **Step 1: KIND_META (sync point 4 of 5)**

In `notification-meta.ts`:

1. Union: append `| "new_follower" | "follow_request_received" | "follow_request_approved"`.
2. `NOTIFICATION_TYPES` array: append the same three strings.
3. Imports: add `UserCheck, UserPlus` to the lucide-react import.
4. `notificationIcon` switch, before `default`:

```typescript
    case "new_follower":
    case "follow_request_received":
      return UserPlus;
    case "follow_request_approved":
      return UserCheck;
```

5. `notificationAccent` switch: add `case "follow_request_approved":` to the existing green group (`text-green-600`), and add:

```typescript
    case "new_follower":
    case "follow_request_received":
      return "text-blue-500";
```

6. `notificationHref` switch, before `default`:

```typescript
    // Follow activity resolves on the People page (requests strip + network grid).
    case "new_follower":
    case "follow_request_received":
    case "follow_request_approved":
      return "/people";
```

(`ADMIN_NOTIFICATION_TYPES` is untouched — none of these are admin-only.)

- [ ] **Step 2: Locale copy (sync point 5 of 5) — en.json**

Three blocks per file. In `apps/web/locales/en.json` under `notifications`:

`types` (after `"goal_achieved"`):

```json
      "new_follower": "New followers",
      "follow_request_received": "Follow requests",
      "follow_request_approved": "Follow request approved"
```

`copy` (after the `goal_achieved` object):

```json
      "new_follower": {
        "title": "New follower",
        "message": "Someone started following you."
      },
      "follow_request_received": {
        "title": "Follow request",
        "message": "Someone asked to follow you."
      },
      "follow_request_approved": {
        "title": "Request approved",
        "message": "Your follow request was approved."
      }
```

`typeDesc` (after `"goal_achieved"`):

```json
      "new_follower": "When someone starts following you.",
      "follow_request_received": "When someone asks to follow you.",
      "follow_request_approved": "When a follow request you sent is approved."
```

(Mind the commas on the previous last entries in all three blocks.)

- [ ] **Step 3: nl.json**

Same three blocks, same positions:

```json
      "new_follower": "Nieuwe volgers",
      "follow_request_received": "Volgverzoeken",
      "follow_request_approved": "Volgverzoek goedgekeurd"
```

```json
      "new_follower": {
        "title": "Nieuwe volger",
        "message": "Iemand volgt je nu."
      },
      "follow_request_received": {
        "title": "Volgverzoek",
        "message": "Iemand wil je graag volgen."
      },
      "follow_request_approved": {
        "title": "Verzoek goedgekeurd",
        "message": "Je volgverzoek is goedgekeurd."
      }
```

```json
      "new_follower": "Wanneer iemand je begint te volgen.",
      "follow_request_received": "Wanneer iemand vraagt om je te volgen.",
      "follow_request_approved": "Wanneer een volgverzoek dat je stuurde wordt goedgekeurd."
```

- [ ] **Step 4: source.json**

Mirror the en.json additions verbatim in the same three blocks of `apps/web/locales/source.json`.

- [ ] **Step 5: Five-sync-point verification sweep (some are NOT type-enforced)**

Run and eyeball each:

```bash
grep -c "new_follower" packages/domain/src/notifications/domain/notification-type.ts  # expect 2 (union + array)
grep -c "new_follower" packages/backend/convex/schema.ts                              # expect 1
grep -c "new_follower" packages/backend/convex/notifications/subscriber.ts            # expect ≥1
grep -c "new_follower" apps/web/src/components/notifications/notification-meta.ts     # expect ≥3 (union, array, icon/accent/href)
grep -c "new_follower" apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json  # expect 3 each
```

Repeat the greps for `follow_request_received` and `follow_request_approved` (same expectations, except subscriber `follow_request_approved` ≥1 and no decline literal anywhere).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm exec nx run-many -t type-check --skip-nx-cache` (ignore known `routeTree.gen.ts` noise only).

```bash
pnpm exec prettier --write apps/web/src/components/notifications/notification-meta.ts apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json
git add -A apps/web && git commit -m "feat(web): follow notification meta + en/nl locale copy"
```

---

### Task 11 — Web: gateway entries + FollowButton rewrite

**Files:**

- Modify: `packages/gateway/src/operations.ts` (social block, ~line 244)
- Modify: `apps/web/src/components/social/follow-button.tsx`

- [ ] **Step 1: Gateway entries**

In the `social:` block of `packages/gateway/src/operations.ts`, after `isFollowing`:

```typescript
    followRelation: api.social.getFollowRelation.getFollowRelation,
    approveFollowRequest:
      api.social.approveFollowRequest.approveFollowRequest,
    declineFollowRequest:
      api.social.declineFollowRequest.declineFollowRequest,
    cancelFollowRequest: api.social.cancelFollowRequest.cancelFollowRequest,
    incomingFollowRequests:
      api.social.listIncomingFollowRequests.listIncomingFollowRequests,
```

- [ ] **Step 2: Rewrite FollowButton**

`isFollowing` stays in the gateway (other callers may use it), but the button switches to the composite read. Full replacement of `apps/web/src/components/social/follow-button.tsx`:

```typescript
"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { gateway, Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";

const STALE_REQUEST_MS = 48 * 60 * 60 * 1000;

// Follow/unfollow/request toggle for a target member, driven by the composite
// followRelation read. Public target: Follow ⇄ Unfollow, as before. Private target:
// "Request to follow" → "Requested" (a dropdown offering Cancel request); after ~48h
// with no answer the label admits it ("hasn't responded yet"). The server decides
// instant-vs-request — this component only renders what the relation says.
// `memberName` (optional) personalises the stale-request label.
export function FollowButton({
  memberId,
  size = "default",
  memberName,
}: {
  memberId: Id<"users">;
  size?: "default" | "sm";
  memberName?: string;
}) {
  const { data: relation } = useQuery(
    convexQuery(gateway.social.followRelation, { memberId }),
  );
  const follow = useMutation({
    mutationFn: useConvexMutation(gateway.social.follow),
  });
  const unfollow = useMutation({
    mutationFn: useConvexMutation(gateway.social.unfollow),
  });
  const cancelRequest = useMutation({
    mutationFn: useConvexMutation(gateway.social.cancelFollowRequest),
  });
  const pending =
    follow.isPending || unfollow.isPending || cancelRequest.isPending;

  if (relation === undefined) {
    return (
      <Button variant="outline" size={size} disabled>
        <UserPlus className="mr-2 h-4 w-4" />
        Follow
      </Button>
    );
  }

  const handleFollow = async () => {
    try {
      const result = await follow.mutateAsync({ followeeId: memberId });
      toast.success(
        result.kind === "requested" ? "Request sent" : "Following",
      );
    } catch {
      toast.error("Could not update follow status");
    }
  };

  const handleUnfollow = async () => {
    try {
      await unfollow.mutateAsync({ followeeId: memberId });
      toast.success("Unfollowed");
    } catch {
      toast.error("Could not update follow status");
    }
  };

  const handleCancel = async () => {
    if (!relation.pendingRequest) return;
    try {
      await cancelRequest.mutateAsync({
        requestId: relation.pendingRequest.requestId,
      });
      toast.success("Request cancelled");
    } catch {
      toast.error("Could not cancel the request");
    }
  };

  if (relation.following) {
    return (
      <Button
        variant="outline"
        size={size}
        onClick={handleUnfollow}
        disabled={pending}
      >
        <UserMinus className="mr-2 h-4 w-4" />
        Unfollow
      </Button>
    );
  }

  if (relation.pendingRequest) {
    const stale =
      Date.now() - relation.pendingRequest.requestedAt > STALE_REQUEST_MS;
    const label = stale
      ? `Requested — ${memberName ?? "they"} hasn't responded yet`
      : "Requested";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size} disabled={pending}>
            <Clock className="mr-2 h-4 w-4" />
            {label}
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleCancel}>
            Cancel request
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const requestMode = relation.targetIsPrivate && !relation.followsYou;
  return (
    <Button
      variant="default"
      size={size}
      onClick={handleFollow}
      disabled={pending}
    >
      <UserPlus className="mr-2 h-4 w-4" />
      {requestMode ? "Request to follow" : "Follow"}
    </Button>
  );
}
```

Notes for the implementer: the hardcoded English strings match the component's existing style (it was already unlocalised — do not introduce i18n here unilaterally). Verify `@/components/ui/dropdown-menu` exists (`ls apps/web/src/components/ui/dropdown-menu.tsx`); if the project lacks it, use the same primitive the app's other menus use (grep `DropdownMenuTrigger` for an example) — do not add a new dependency.

- [ ] **Step 3: Check remaining `isFollowing` consumers still compile**

Run: `grep -rn "gateway.social.follow\b\|gateway.social.isFollowing" apps/web/src`
Expected: `follow-button.tsx` only (plus the gateway map itself). Fix any other call site that awaited a string from `follow`.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm exec nx run-many -t type-check --skip-nx-cache --projects=@jigswap/web` (ignore `routeTree.gen.ts` noise only).

```bash
pnpm exec prettier --write packages/gateway/src/operations.ts apps/web/src/components/social/follow-button.tsx
git add -A packages/gateway apps/web && git commit -m "feat(web): request-aware FollowButton with cancel + stale-request label"
```

---

### Task 12 — Web: incoming-requests strip on the People page

**Files:**

- Create: `apps/web/src/components/social/follow-requests-strip.tsx`
- Modify: `apps/web/src/routes/_dashboard/people.tsx`
- Modify: `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json` (`people` namespace)

- [ ] **Step 1: Locale keys**

In all three locale files, inside the existing `people` namespace object (en shown; place after `"followsYou"`):

```json
    "requests": {
      "title": "Follow requests",
      "subtitle": "{count, plural, one {# member wants} other {# members want}} to follow you",
      "approve": "Approve",
      "approveAndFollowBack": "Approve & follow back",
      "decline": "Decline",
      "approved": "Request approved",
      "declined": "Request declined",
      "error": "Something went wrong. Please try again."
    }
```

nl.json:

```json
    "requests": {
      "title": "Volgverzoeken",
      "subtitle": "{count, plural, one {# lid wil} other {# leden willen}} je volgen",
      "approve": "Goedkeuren",
      "approveAndFollowBack": "Goedkeuren & terugvolgen",
      "decline": "Weigeren",
      "approved": "Verzoek goedgekeurd",
      "declined": "Verzoek geweigerd",
      "error": "Er ging iets mis. Probeer het opnieuw."
    }
```

source.json mirrors en.json.

- [ ] **Step 2: The strip component**

`apps/web/src/components/social/follow-requests-strip.tsx` — before writing, read `apps/web/src/components/social/member-tile.tsx` and reuse its avatar/name presentation idiom (Avatar component, fallback initial). Reference implementation:

```typescript
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Pending incoming follow requests, shown as a strip ABOVE the network grid on the People
// page (Phase 4 moves the count onto a tab badge). Approve creates the edge; the second
// button also follows back in the same gesture (mutuality is what unlocks content for the
// requester). Decline is silent for the requester. Renders nothing when there are none.
export function FollowRequestsStrip() {
  const t = useTranslations("people");
  const { data: requests } = useQuery(
    convexQuery(gateway.social.incomingFollowRequests, {}),
  );
  const approve = useMutation({
    mutationFn: useConvexMutation(gateway.social.approveFollowRequest),
  });
  const decline = useMutation({
    mutationFn: useConvexMutation(gateway.social.declineFollowRequest),
  });
  const followBack = useMutation({
    mutationFn: useConvexMutation(gateway.social.follow),
  });
  const busy =
    approve.isPending || decline.isPending || followBack.isPending;

  if (!requests || requests.length === 0) return null;

  const handleApprove = async (
    requestId: string,
    alsoFollowBack: boolean,
  ) => {
    try {
      const result = await approve.mutateAsync({ requestId });
      if (alsoFollowBack && !result.alreadyFollowsBack) {
        await followBack.mutateAsync({
          followeeId: result.requesterId as never,
        });
      }
      toast.success(t("requests.approved"));
    } catch {
      toast.error(t("requests.error"));
    }
  };

  const handleDecline = async (requestId: string) => {
    try {
      await decline.mutateAsync({ requestId });
      toast.success(t("requests.declined"));
    } catch {
      toast.error(t("requests.error"));
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" />
          <span className="font-medium">{t("requests.title")}</span>
          <span className="text-sm text-muted-foreground">
            {t("requests.subtitle", { count: requests.length })}
          </span>
        </div>
        <ul className="space-y-2">
          {requests.map((request) => (
            <li
              key={request.requestId}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="font-medium">{request.requester.name}</span>
              <span className="flex gap-2">
                {!request.alreadyFollowing && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => handleApprove(request.requestId, true)}
                  >
                    {t("requests.approveAndFollowBack")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleApprove(request.requestId, false)}
                >
                  {t("requests.approve")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => handleDecline(request.requestId)}
                >
                  {t("requests.decline")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
```

Adapt the row rendering to include the avatar exactly as `MemberTile` does it (same Avatar import/idiom); adjust the `requester` field access to the actual `toMemberView` shape (check what it returns — likely `{ name, username, avatar, ... }`). The `as never` cast on `followeeId` bridges the member-view id string to `Id<"users">` — replace with the project's established cast idiom if one exists in the file you copied the avatar pattern from.

- [ ] **Step 3: Mount it on the People page**

In `apps/web/src/routes/_dashboard/people.tsx`: import `{ FollowRequestsStrip } from "@/components/social/follow-requests-strip"` and render `<FollowRequestsStrip />` as the FIRST child of the page's content container, above the network-grid section. (Find the outermost content wrapper in `PeoplePage`'s JSX and insert at the top; do not restructure anything else.)

- [ ] **Step 4: Typecheck + manual verification note**

Run: `pnpm exec nx run-many -t type-check --skip-nx-cache` — clean (except known `routeTree.gen.ts` noise).
Browser verification is unavailable in this environment (no Chrome); the backend behavior is covered by `followRequests.test.ts`. Note in the PR description that `/people` needs a manual smoke test: request → strip appears → approve & follow back → both edges exist.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/web/src/components/social/follow-requests-strip.tsx apps/web/src/routes/_dashboard/people.tsx apps/web/locales/en.json apps/web/locales/nl.json apps/web/locales/source.json
git add -A apps/web && git commit -m "feat(web): incoming follow-requests strip on the People page"
```

---

### Task 13 — Full verification sweep + PR

- [ ] **Step 1: Everything, CI-faithful**

```bash
pnpm --filter @jigswap/domain exec vitest run
pnpm --filter @jigswap/backend exec vitest run
pnpm exec nx run-many -t type-check --skip-nx-cache
pnpm exec nx run-many -t lint --skip-nx-cache 2>/dev/null || true   # if a lint target exists
pnpm exec prettier --check .
```

Expected: all green (only pre-existing `routeTree.gen.ts` type noise tolerated; `prettier --check` must be fully clean).

- [ ] **Step 2: Spec-coverage self-check**

Confirm against the spec's Phase 2 section: hybrid model ✓ (Task 7), pair-unique aggregate + events ✓ (Tasks 2–5), table + indexes ✓ (Task 6), idempotent request ✓, approve creates edge + follow-back offer ✓, silent decline + 7-day cooldown + honest button copy ✓ (Tasks 4/8/11), three notification types × five sync points ✓ (Tasks 6/8/10 + grep sweep), strip above grid ✓ (Task 12), going-private keeps followers ✓ (Task 9), Phase 3 contract note: `approveFollowRequest` + visibility-aware `followMember` (with its follow-back exception) are exactly what `redeemInvite` will compose server-side.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/follow-requests
gh pr create --title "feat(social): follow requests for private profiles + follow notifications" --body "$(cat <<'EOF'
Phase 2 of the friend-discovery spec (docs/superpowers/specs/2026-07-11-friend-discovery-and-public-catalog-design.md).

- Hybrid follow model: public profiles unchanged (instant follow); private profiles get request → approve/decline, with a follow-back exception when the private target initiated contact
- FollowRequest aggregate (pending → approved | declined), silent decline with 7-day cooldown masked as pending
- 3 new notification types (new_follower, follow_request_received, follow_request_approved) across all five sync points; approval suppression prevents double-notifying approvers
- Request-aware FollowButton (Request to follow / Requested ▾ Cancel / stale-request label) + incoming-requests strip on /people

Manual smoke test needed on /people (no browser in dev env): request → approve & follow back → mutual edges.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (performed at plan-writing time)

- **Spec coverage:** every Phase 2 bullet maps to a task (see Task 13 Step 2). The spec's "notification carries approve/decline actions" is deliberately narrowed to deep-linking `/people` where the strip acts — noted as a scope guardrail.
- **Placeholder scan:** no TBDs; every code step has complete code. Steps that depend on unverified neighbouring signatures (`toMemberView`, `setProfileVisibility`, dropdown-menu availability, event payload `occurredAt`) carry explicit verify-first instructions instead of guesses.
- **Type consistency:** `FollowRequestId`/`toFollowRequestId` (Tasks 1–7), `COOLDOWN_MS` exported from `request-follow.ts` and re-declared (with sync note) in `getFollowRelation.ts`, `{kind, id}` return of `followMember` consumed by `FollowButton` (Task 11) and asserted in tests (Tasks 8–9), `alreadyFollowsBack` spelled identically in port, mutation, strip.
