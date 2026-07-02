# Conversation Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `conversation` bounded context end-to-end — generalize `Thread` to exchange + DM subjects, add Convex persistence/adapters/read-models, expose a gateway namespace, replace the mock `/messages` page, and migrate the legacy exchange chat.

**Architecture:** Hexagonal, matching the existing contexts: pure domain in `packages/domain/src/conversation/`, thin Convex composition roots in `packages/backend/convex/conversation/`, view DTOs in `@jigswap/contracts`, a single gateway chokepoint, and event integration through the `domainEvents` dispatcher. Spec: `docs/superpowers/specs/2026-07-02-conversation-messaging-design.md`.

**Tech Stack:** TypeScript, Convex (+convex-test), Vitest, TanStack Start/Router, Clerk, use-intl.

**Branch:** all work on the existing `feat/conversation-messaging` branch (spec already committed there). Rebase onto latest `main` first — PRs #29 and #31 merged after it was cut.

**Worktree caveats (if executing in a worktree):** write via the worktree's own paths; Convex codegen needs a deployment, so hand-edit `packages/backend/convex/_generated/api.d.ts` to register new function modules (mirror existing entries). Run prettier on changed files before every commit (CI runs `format:check` first). Verify with `--skip-nx-cache`.

---

### Task 0: Rebase the branch

- [ ] **Step 0.1:** `git fetch origin && git rebase origin/main` on `feat/conversation-messaging`. Expected: only the spec commit replays; no conflicts (it adds one new file).

---

### Task 1: Domain — `ThreadSubject` and the generalized `Thread`

**Files:**

- Modify: `packages/domain/src/conversation/domain/thread.ts`
- Modify: `packages/domain/src/conversation/domain/events.ts`
- Modify: `packages/domain/src/conversation/domain/errors.ts`
- Modify: `packages/domain/src/conversation/domain/thread.spec.ts`
- Modify: `packages/domain/src/conversation/domain/index.ts` (export `ThreadSubject`)

- [ ] **Step 1.1: Write the failing specs** — add to `thread.spec.ts` (keep all existing specs; update their construction to `Thread.openForExchange`):

```ts
describe("Thread subjects", () => {
  it("openForExchange yields an exchange-subject thread", () => {
    const t = Thread.openForExchange(threadId("t1"), exchangeId("e1"), [
      m("a"),
      m("b"),
    ]);
    expect(t.subject).toEqual({
      kind: "exchange",
      exchangeId: exchangeId("e1"),
    });
  });

  it("openDm yields a dm-subject thread with exactly two participants", () => {
    const r = Thread.openDm(threadId("t1"), [m("a"), m("b")]);
    expect(r.isOk).toBe(true);
    expect(r.value.subject).toEqual({ kind: "dm" });
  });

  it("openDm rejects duplicate participants", () => {
    const r = Thread.openDm(threadId("t1"), [m("a"), m("a")]);
    expect(r.isErr).toBe(true);
    expect(r.error.code).toBe("DmRequiresTwoParticipants");
  });

  it("MessagePosted carries the subject", () => {
    const t = Thread.openDm(threadId("t1"), [m("a"), m("b")]).value;
    t.postMessage({
      id: msgId("m1"),
      authorId: m("a"),
      kind: "text",
      body: "hi",
      sentAt: NOW,
    });
    const [event] = t.pullEvents() as MessagePosted[];
    expect(event.subject).toEqual({ kind: "dm" });
  });
});
```

(`threadId`/`exchangeId`/`m`/`msgId` are the spec file's existing branded-cast helpers — reuse them.)

- [ ] **Step 1.2:** Run `pnpm nx test @jigswap/domain --skip-nx-cache -- conversation` — expected FAIL (`openForExchange`/`openDm`/`subject` do not exist).

- [ ] **Step 1.3: Implement.** In `thread.ts`:

```ts
// A thread's subject: what the conversation is about. Exchange threads are opened by the
// system when an exchange is proposed; DM threads are member-opened, exactly two participants.
export type ThreadSubject =
  | { readonly kind: "exchange"; readonly exchangeId: ExchangeId }
  | { readonly kind: "dm" };
```

- `ThreadState`: replace `exchangeId: ExchangeId` with `subject: ThreadSubject`.
- Replace `static open(...)` with `static openForExchange(id, exchangeId, participants)` (same body, `subject: { kind: "exchange", exchangeId }`) and add:

```ts
// Open a member-to-member DM. The pair rule (exactly two distinct members) is the aggregate's
// own invariant; the connection gate is an application concern (see makeOpenDmThread).
static openDm(
  id: ThreadId,
  participants: readonly [MemberId, MemberId],
): Result<Thread, ConversationError> {
  if (participants[0] === participants[1]) {
    return err(ConversationError.dmRequiresTwoParticipants());
  }
  return ok(
    new Thread({
      id,
      subject: { kind: "dm" },
      participants: [...participants],
      messages: [],
      readReceipts: [],
    }),
  );
}
```

- Replace the `exchangeId` getter with `get subject(): ThreadSubject`; update `rehydrate`/`toState`/private state/`append` accordingly.
- In `events.ts`, `MessagePosted`: replace `readonly exchangeId: ExchangeId` with `readonly subject: ThreadSubject` (import from `./thread`).
- In `errors.ts`, add code `"DmRequiresTwoParticipants"` and:

```ts
// A DM thread is a pair: exactly two distinct members. (Group DMs are out of scope.)
static dmRequiresTwoParticipants(): ConversationError {
  return new ConversationError(
    "DmRequiresTwoParticipants",
    "A DM thread requires exactly two distinct participants",
  );
}
```

- Export `ThreadSubject` from `domain/index.ts`.

- [ ] **Step 1.4:** Run the same command — expected PASS (including all pre-existing thread/message specs, updated for `openForExchange`).

- [ ] **Step 1.5: Commit** — `feat(domain): generalize Thread to exchange+dm subjects`.

---

### Task 2: Domain — `ConnectionPolicy` port, repository pair-lookup, `openDmThread` use case

**Files:**

- Create: `packages/domain/src/conversation/application/ports/out/connection-policy.ts`
- Create: `packages/domain/src/conversation/application/ports/in/open-dm-thread.port.ts`
- Create: `packages/domain/src/conversation/application/use-cases/open-dm-thread.ts`
- Create: `packages/domain/src/conversation/application/use-cases/open-dm-thread.spec.ts`
- Modify: `packages/domain/src/conversation/application/ports/out/thread.repository.ts` (+`findDmByParticipants`)
- Modify: `packages/domain/src/conversation/application/errors.ts` (+`notConnected`)
- Modify: `packages/domain/src/conversation/application/testing/in-memory-thread.repository.ts` (implement the new lookup; check actual filename in `application/testing/`)
- Modify: the `index.ts` barrels beside each (ports/in, ports/out, use-cases)
- Modify: `packages/domain/src/conversation/application/use-cases/open-thread.ts` (rename call to `Thread.openForExchange`)

- [ ] **Step 2.1: Write the failing spec** (`open-dm-thread.spec.ts`) — cases: opens a fresh DM and returns its id; is idempotent for the same pair (either argument order); rejects when `canMessage` is false with `NotConnected`; rejects self-DM with `DmRequiresTwoParticipants`. Use the in-memory repository plus a stub policy:

```ts
const allow: ConnectionPolicy = { canMessage: async () => true };
const deny: ConnectionPolicy = { canMessage: async () => false };
```

- [ ] **Step 2.2:** Run `pnpm nx test @jigswap/domain --skip-nx-cache -- open-dm-thread` — expected FAIL.

- [ ] **Step 2.3: Implement.**

`connection-policy.ts`:

```ts
import { MemberId } from "../../../domain";

// Outbound policy port: may `initiator` open a DM with `recipient`? The Convex adapter answers
// "connected" = mutual follow, shared circle, or any existing thread between the pair. Mirrors
// the VisibilityPolicy pattern: the domain never queries follows/circles itself.
export interface ConnectionPolicy {
  canMessage(initiator: MemberId, recipient: MemberId): Promise<boolean>;
}
```

`open-dm-thread.port.ts`:

```ts
import { Result } from "../../../../shared-kernel";
import { ConversationError, MemberId, ThreadId } from "../../../domain";
import { ConversationApplicationError } from "../../errors";

export interface OpenDmThreadCommand {
  readonly initiatorId: MemberId; // resolved from auth by the transport adapter
  readonly recipientId: MemberId;
}

// Inbound port: ensure a DM thread exists between the pair. Idempotent per pair.
export interface OpenDmThread {
  (
    cmd: OpenDmThreadCommand,
  ): Promise<
    Result<ThreadId, ConversationError | ConversationApplicationError>
  >;
}
```

`errors.ts` — add code `"NotConnected"` + factory `notConnected()` ("You can only message members you are connected with"), following the file's existing shape.

`open-dm-thread.ts`:

```ts
export const makeOpenDmThread =
  (deps: {
    threads: ThreadRepository;
    threadIds: ThreadIdGenerator;
    connections: ConnectionPolicy;
  }): OpenDmThread =>
  async (cmd) => {
    const opened = Thread.openDm(deps.threadIds.next(), [
      cmd.initiatorId,
      cmd.recipientId,
    ]);
    if (opened.isErr) return err(opened.error); // self-DM: fail before any I/O

    if (
      !(await deps.connections.canMessage(cmd.initiatorId, cmd.recipientId))
    ) {
      return err(ConversationApplicationError.notConnected());
    }
    const existing = await deps.threads.findDmByParticipants(
      cmd.initiatorId,
      cmd.recipientId,
    );
    if (existing) return ok(existing.id);

    await deps.threads.save(opened.value);
    return ok(opened.value.id);
  };
```

`thread.repository.ts` — add `findDmByParticipants(a: MemberId, b: MemberId): Promise<Thread | null>;` (order-insensitive). Implement in the in-memory repo (sort the pair, compare against dm threads' participants).

- [ ] **Step 2.4:** Run — expected PASS. Also run the full conversation suite (open-thread spec now uses `openForExchange`).
- [ ] **Step 2.5: Commit** — `feat(domain): openDmThread use case with ConnectionPolicy gate`.

---

### Task 3: Schema — `threads`, `threadMessages`, `threadParticipants`

**Files:**

- Modify: `packages/backend/convex/schema.ts` (add after `messages`; leave `messages` untouched until cutover)

- [ ] **Step 3.1: Add the tables:**

```ts
// Conversation context. One row per Thread aggregate; messages are companion rows (long chats
// must not brush the document size limit). participantsKey = the two user _ids sorted and
// joined with "|" — every thread is a pair in v1, and this backs both the one-DM-per-pair rule
// and the ConnectionPolicy's "existing thread between the pair" check.
threads: defineTable({
  aggregateId: v.string(),
  subjectKind: v.union(v.literal("exchange"), v.literal("dm")),
  exchangeId: v.optional(v.id("exchanges")), // set iff subjectKind === "exchange"
  participants: v.array(v.id("users")),
  participantsKey: v.string(),
  readReceipts: v.array(
    v.object({ memberId: v.id("users"), lastReadAt: v.number() }),
  ),
  lastMessageAt: v.optional(v.number()), // denormalized for inbox ordering
  createdAt: v.number(),
})
  .index("by_aggregate_id", ["aggregateId"])
  .index("by_exchange", ["exchangeId"])
  .index("by_subject_participants", ["subjectKind", "participantsKey"])
  .index("by_participants_key", ["participantsKey"]),

threadMessages: defineTable({
  threadAggregateId: v.string(),
  messageId: v.string(),
  authorId: v.optional(v.id("users")), // absent for system messages
  kind: v.union(v.literal("text"), v.literal("image"), v.literal("system")),
  body: v.string(),
  sentAt: v.number(),
})
  .index("by_thread_sent", ["threadAggregateId", "sentAt"])
  .index("by_message_id", ["messageId"]),

// Member-lookup projection of threads.participants, kept in sync by the repository on every
// save (same pattern as circleMembers — Convex cannot index embedded arrays).
threadParticipants: defineTable({
  threadAggregateId: v.string(),
  memberId: v.id("users"),
})
  .index("by_member", ["memberId"])
  .index("by_thread", ["threadAggregateId"]),
```

- [ ] **Step 3.2:** `pnpm nx run @jigswap/backend:type-check --skip-nx-cache` — expected PASS.
- [ ] **Step 3.3: Commit** — `feat(backend): threads/threadMessages/threadParticipants tables`.

---

### Task 4: Backend — mapper, `convexThreadRepository`, support adapters

**Files:**

- Create: `packages/backend/convex/conversation/adapters/threadMapper.ts`
- Create: `packages/backend/convex/conversation/adapters/convexThreadRepository.ts`
- Create: `packages/backend/convex/conversation/adapters/idGenerators.ts` (uuid-backed, copy the solving pattern)
- Create: `packages/backend/convex/conversation/adapters/systemClock.ts` + `inProcessEventPublisher.ts` (copy the one-liner solving adapters, pointing at `events/makeEventPublisher`)
- Test: `packages/backend/convex/threadRepository.test.ts`

- [ ] **Step 4.1: Write the failing test** (convex-test, at `convex/` root per convention). Exercise the repository through a tiny internal test harness OR through the Task 5 mutations if you prefer; minimum cases:
  - save a fresh DM thread → rows in `threads` + `threadParticipants` (2) exist; `participantsKey` is the sorted pair.
  - save after `postMessage` → exactly the new row lands in `threadMessages`; `lastMessageAt` patched; posting again inserts one more row (no duplicates of earlier messages).
  - `findDmByParticipants` finds the thread regardless of argument order; `findByExchange` finds exchange threads; `findById` round-trips state (receipts included).

- [ ] **Step 4.2:** Run `pnpm nx test @jigswap/backend --skip-nx-cache -- threadRepository` — expected FAIL.

- [ ] **Step 4.3: Implement.** Mapper: field-for-field, `MemberId` ⇄ `Id<"users">` casts (`as unknown as`), `Date` ⇄ epoch ms, `authorId: null` ⇄ column absent. Repository (over `MutationCtx`):
  - `save`: upsert thread row keyed on `by_aggregate_id`; compute `participantsKey = [...participants].sort().join("|")`; resolve `exchangeId` document id from the subject's aggregateId via `exchanges.by_aggregate_id` (fall back to raw `_id` like `convexCompletionRepository.resolvePuzzleId`); insert only `threadMessages` rows whose `messageId` is not yet present (query `by_thread_sent`, diff by id); replace `readReceipts` wholesale; sync `threadParticipants` (insert missing, delete removed); patch `lastMessageAt` from the newest message.
  - `findById`/`findByExchange`/`findDmByParticipants` (via `by_subject_participants` with `subjectKind: "dm"`): load thread row + `by_thread_sent` messages, `Thread.rehydrate(toDomain(...))`.

- [ ] **Step 4.4:** Run — expected PASS.
- [ ] **Step 4.5: Commit** — `feat(backend): conversation thread repository + adapters`.

---

### Task 5: Backend — `connectionPolicy` adapter and the three mutations

**Files:**

- Create: `packages/backend/convex/conversation/adapters/connectionPolicy.ts`
- Create: `packages/backend/convex/conversation/openDmThread.ts`, `postMessage.ts`, `markThreadRead.ts`, `errors.ts`
- Modify: `packages/backend/convex/_generated/api.d.ts` (register the modules)
- Test: `packages/backend/convex/conversationMutations.test.ts`

- [ ] **Step 5.1: Write the failing tests:**
  - `openDmThread`: mutual followers can open (returns threadId; second call returns the same id); circle-mates can open; a pair with an existing exchange thread can open; strangers get `NotConnected` (ConvexError); unauthenticated rejected; self-DM rejected.
  - `postMessage`: participant posts (row visible); non-participant rejected; empty body rejected; unauthenticated rejected.
  - `markThreadRead`: updates only the caller's receipt.

- [ ] **Step 5.2:** Run — expected FAIL.

- [ ] **Step 5.3: Implement.** `connectionPolicy.ts`:

```ts
// "Connected" = mutual follow, shared circle, or any existing thread between the pair (exchange
// threads are opened on proposal, so "we have an exchange together" reduces to a pair lookup).
export const convexConnectionPolicy = (ctx: MutationCtx): ConnectionPolicy => ({
  async canMessage(initiator, recipient) {
    const a = initiator as unknown as Id<"users">;
    const b = recipient as unknown as Id<"users">;

    const follows = async (x: Id<"users">, y: Id<"users">) =>
      (await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", x).eq("followeeId", y),
        )
        .unique()) !== null;
    if ((await follows(a, b)) && (await follows(b, a))) return true;

    const key = [a as string, b as string].sort().join("|");
    const pairThread = await ctx.db
      .query("threads")
      .withIndex("by_participants_key", (q) => q.eq("participantsKey", key))
      .first();
    if (pairThread) return true;

    const mine = await ctx.db
      .query("circleMembers")
      .withIndex("by_member", (q) => q.eq("memberId", a))
      .collect();
    for (const cm of mine) {
      const shared = await ctx.db
        .query("circleMembers")
        .withIndex("by_circle_member", (q) =>
          q.eq("circleAggregateId", cm.circleAggregateId).eq("memberId", b),
        )
        .unique();
      if (shared) return true;
    }
    return false;
  },
});
```

Mutations follow the `recordCompletion` composition-root shape exactly: `requireMember(ctx)` → build use case (`makeOpenDmThread`/`makePostMessage`/`makeMarkThreadRead` with the repository, id generators, `inProcessEventPublisher`, `systemClock`, and for openDm the policy) → `if (result.isErr) throw toConvexError(result.error)` → return the id string. `errors.ts` maps `ConversationError`/`ConversationApplicationError` codes to `ConvexError` (copy `solving/errors.ts`'s shape). Register all modules in `_generated/api.d.ts`.

- [ ] **Step 5.4:** Run — expected PASS.
- [ ] **Step 5.5: Commit** — `feat(backend): conversation mutations (openDm, post, markRead)`.

---

### Task 6: Backend — exchange lifecycle subscriber (system messages)

**Files:**

- Create: `packages/backend/convex/conversation/subscriber.ts`
- Modify: `packages/backend/convex/events/dispatch.ts` (register it)
- Test: `packages/backend/convex/conversationSubscriber.test.ts`

- [ ] **Step 6.1: Failing tests:** dispatch an `ExchangeProposed` domainEvents row (mirror how existing subscriber tests fabricate rows) → a thread with `subjectKind: "exchange"` exists for the exchange, participants = initiator+recipient, one system message ("proposal" wording); `ExchangeAccepted`/`ExchangeCancelled`/`ExchangeCompleted`/`ExchangeRejected` each append a system message to the existing thread; events for other contexts are ignored; a second delivery of the same proposal does not duplicate the thread (idempotent via `findByExchange`).

- [ ] **Step 6.2:** Run — expected FAIL.

- [ ] **Step 6.3: Implement** `subscriber.ts` with `export const handleDomainEvent = async (ctx, event) => {...}`: switch on `event.name`; for the five exchange lifecycle events load the exchange row by aggregateId (copy `loadExchange` from `notifications/subscriber.ts`), run `makeOpenThread` (idempotent) with `[initiatorId, recipientId]` cast to `MemberId`, then `makePostSystemMessage` with fixed English bodies ("Exchange proposed", "Exchange accepted", "Exchange rejected", "Exchange cancelled", "Exchange completed" — the UI renders system messages via i18n keyed on body later if desired; keep bodies stable). Register in `dispatch.ts` after the notification handler:

```ts
import { handleDomainEvent as handleConversationEvent } from "../conversation/subscriber";
...
await handleConversationEvent(ctx, event);
```

- [ ] **Step 6.4:** Run — expected PASS. Also re-run the full backend suite (dispatch is shared).
- [ ] **Step 6.5: Commit** — `feat(backend): exchange lifecycle opens threads + system messages`.

---

### Task 7: Backend — notify on `MessagePosted`

**Files:**

- Modify: `packages/backend/convex/notifications/subscriber.ts` (new `MessagePosted` case in `translate`)
- Modify (only if missing): `packages/domain/src/notifications/...` NotificationType — grep for `"message_received"`; the schema union already has it.
- Test: extend `packages/backend/convex/conversationSubscriber.test.ts` or the existing notifications subscriber test file.

- [ ] **Step 7.1: Failing test:** member A posts to a thread with B → B (and only B) gets a `message_received` notification whose `relatedId` is the thread aggregateId; a system message notifies both participants? **No** — decision: system messages produce NO notification (exchange lifecycle already emits its own exchange\_\* notifications; double-notifying is noise). Assert that.

- [ ] **Step 7.2:** Run — FAIL. **Step 7.3: Implement:** in `translate`, on `MessagePosted` with non-null `authorId`, load the thread row by aggregateId, recipients = participants minus author, one `NotifyMemberCommand` per recipient with `type: "message_received"`, title "New message", message "You have a new message", `relatedId` = thread aggregateId. **Step 7.4:** Run — PASS. **Step 7.5: Commit** — `feat(backend): message_received notifications from MessagePosted`.

---

### Task 8: Backend read models + contracts

**Files:**

- Create: `packages/backend/convex/conversation/getMyInbox.ts`, `getThreadMessages.ts`, `getThreadByExchange.ts`, `canMessage.ts`, `getUnreadTotal.ts` (queries)
- Create: `packages/contracts/src/conversation/views.ts` (+ barrel exports, mirroring another contracts folder)
- Modify: `packages/backend/convex/_generated/api.d.ts`
- Test: `packages/backend/convex/conversationReads.test.ts`

- [ ] **Step 8.1: Contracts first** (pure types, no test):

```ts
import type { ProjectedMember } from "../identity/views"; // match the real import path used by other contracts

export interface ThreadMessageView {
  readonly id: string;
  readonly authorId: string | null; // null = system
  readonly kind: "text" | "image" | "system";
  readonly body: string;
  readonly sentAt: number;
}

export type InboxThreadSubjectView =
  | {
      readonly kind: "exchange";
      readonly exchangeId: string;
      readonly exchangeType: "trade" | "sale" | "loan";
      readonly puzzleTitle: string | null;
    }
  | { readonly kind: "dm"; readonly otherMember: ProjectedMember };

export interface InboxThreadView {
  readonly threadId: string;
  readonly subject: InboxThreadSubjectView;
  readonly lastMessage: ThreadMessageView | null;
  readonly unreadCount: number;
  readonly updatedAt: number;
}
```

- [ ] **Step 8.2: Failing tests:** `getMyInbox` returns the caller's threads ordered by `updatedAt` desc with correct `unreadCount` (messages after the caller's receipt, authored by others); non-participant sees nothing; `getThreadMessages` pages ascending and rejects non-participants; `getThreadByExchange` resolves participants' thread and rejects outsiders; `canMessage` mirrors the policy; `getUnreadTotal` sums unread across threads.

- [ ] **Step 8.3:** Run — FAIL. **Step 8.4: Implement** as plain queries (read models bypass the aggregate): inbox walks `threadParticipants.by_member` → thread rows → last message via `by_thread_sent` (take last) → unread = count of messages with `sentAt > myReceipt` and `authorId !== me` (cap the scan: `.take(50)` newest is fine for v1 badge accuracy); enrich subject (exchange row title via requested puzzle snapshot, or the other member through the same projection mapper `toMemberView` used by `packages/backend/convex/library/readViews.ts` — reuse, don't reimplement). All gated by `requireMember` + participant checks. `canMessage` wraps `convexConnectionPolicy` in a `query` (it only reads).

- [ ] **Step 8.5:** Run — PASS. **Step 8.6: Commit** — `feat(backend): conversation read models + contracts`.

---

### Task 9: Gateway namespace

**Files:**

- Modify: `packages/gateway/src/operations.ts`

- [ ] **Step 9.1:** Add (keep the legacy `sendMessage`/`messages` lines for now — removed in Task 12):

```ts
conversation: {
  openDmThread: api.conversation.openDmThread.openDmThread,
  postMessage: api.conversation.postMessage.postMessage,
  markThreadRead: api.conversation.markThreadRead.markThreadRead,
  getMyInbox: api.conversation.getMyInbox.getMyInbox,
  getThreadMessages: api.conversation.getThreadMessages.getThreadMessages,
  getThreadByExchange: api.conversation.getThreadByExchange.getThreadByExchange,
  canMessage: api.conversation.canMessage.canMessage,
  getUnreadTotal: api.conversation.getUnreadTotal.getUnreadTotal,
},
```

- [ ] **Step 9.2:** `pnpm nx run-many -t type-check -p @jigswap/gateway @jigswap/backend --skip-nx-cache` — PASS. **Step 9.3: Commit** — `feat(gateway): conversation namespace`.

---

### Task 10: Web — real `/messages`

**Files:**

- Delete: `apps/web/src/routes/_dashboard/messages.tsx`
- Create: `apps/web/src/routes/_dashboard/messages/index.tsx` (inbox; on desktop renders list + empty state pane)
- Create: `apps/web/src/routes/_dashboard/messages/$threadId.tsx` (inbox + active thread)
- Create: `apps/web/src/components/messaging/thread-list.tsx`, `thread-view.tsx`, `message-composer.tsx`
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json` (namespace `messages.*` — reuse existing keys from the mock page where present; keep all three catalogs key-identical)
- Modify: the dashboard nav component that renders the Messages item (grep `messages` in `apps/web/src/components/dashboard-layout/`) — unread badge from `gateway.conversation.getUnreadTotal`

- [ ] **Step 10.1:** Read the mock page first and reuse its layout skeleton (two-pane, mobile list→detail) and its i18n keys. Core wiring:

```tsx
// thread-list.tsx (essentials)
const inbox = useQuery(convexQuery(gateway.conversation.getMyInbox, {}));
// each row: subject title (dm → otherMember.displayName; exchange → t("messages.exchangeThread", { title: puzzleTitle })),
// lastMessage preview, unreadCount badge, Link to /messages/$threadId

// thread-view.tsx (essentials)
const messages = useQuery(
  convexQuery(gateway.conversation.getThreadMessages, { threadId }),
);
const markRead = useMutation({
  mutationFn: useConvexMutation(gateway.conversation.markThreadRead),
});
useEffect(() => {
  if (messages) markRead.mutate({ threadId });
}, [threadId, messages?.length]);
// system messages render centered/muted; own messages right-aligned — follow the mock's styling

// message-composer.tsx (essentials)
const post = useMutation({
  mutationFn: useConvexMutation(gateway.conversation.postMessage),
});
// optimistic: append to a local pending list keyed by client uuid, cleared when the query catches up;
// submit → post.mutate({ threadId, kind: "text", body })
```

Match the exact query/mutation hook idioms used by `apps/web/src/routes/_dashboard/notifications/index.tsx` (read that file and copy its convex+react-query integration style rather than inventing one).

- [ ] **Step 10.2:** `pnpm nx run-many -t type-check lint test -p @jigswap/web --skip-nx-cache` — PASS (`routeTree.gen.ts` regenerates via the dev/build tooling; noise there is a known artifact). Verify all new i18n keys exist in the three catalogs with a quick script or grep.
- [ ] **Step 10.3: Commit** — `feat(web): real /messages inbox + thread view on the conversation gateway`.

**Note:** this layout is explicitly provisional per the spec — a UI Designer / UX Architect pass may restyle it later; keep all data access inside the three components so a restyle swaps presentation only.

---

### Task 11: Web — entry points (profiles + trades)

**Files:**

- Modify: the people/profile card component (grep for where profiles render actions in `apps/web/src/routes/_dashboard/people.tsx` and profile view components) — add a "Message" button: enabled per `gateway.conversation.canMessage`, on click `openDmThread` → `navigate({ to: "/messages/$threadId", params: { threadId } })`; disabled state gets a tooltip `t("messages.notConnected")`.
- Modify: `apps/web/src/routes/_dashboard/trades.tsx` — replace the legacy exchange-chat panel (it calls the old gateway `sendMessage`/`messages` ops) with `getThreadByExchange` + the same `ThreadView`/`MessageComposer` components.
- Modify: locale catalogs (new keys ×3).

- [ ] **Step 11.1:** Implement both entry points. **Step 11.2:** type-check/lint/test web with `--skip-nx-cache` — PASS. **Step 11.3: Commit** — `feat(web): message entry points on profiles and trades`.

---

### Task 12: Backfill + cutover

**Files:**

- Create: `packages/backend/convex/conversation/backfill.ts`
- Delete: `packages/backend/convex/exchanges.ts` (only `sendExchangeMessage` remains in it)
- Delete: `packages/backend/convex/exchange/getExchangeMessages.ts`
- Modify: `packages/gateway/src/operations.ts` (remove the two legacy ops)
- Modify: `packages/backend/convex/_generated/api.d.ts`
- Test: `packages/backend/convex/conversationBackfill.test.ts`

- [ ] **Step 12.1: Failing test:** seed legacy `messages` rows for two exchanges (text + system kinds) → run backfill (`internalMutation`) → one thread per exchange with `subjectKind: "exchange"`, messages converted in `sentAt` order (`senderId`→`authorId`, `messageType`→`kind`, `content`→`body`, `createdAt`→`sentAt`), `threadParticipants` populated, and **read receipts stamped for both participants at the newest message's instant** (no stale unread wall); running twice is idempotent (skip exchanges that already have a thread).

- [ ] **Step 12.2:** Run — FAIL. **Step 12.3: Implement** `backfill.ts` as a paginated `internalMutation` (follow `solving/backfillCompletionPuzzleId.ts`'s manual-run shape). **Step 12.4:** Run — PASS.

- [ ] **Step 12.5: Cutover:** delete the legacy mutation/query files, remove the gateway ops, remove their `api.d.ts` entries, and confirm no web caller remains (`grep -rn "sendMessage\|getExchangeMessages" apps/web packages/gateway`). **Do NOT drop the `messages` table** — it is dropped in a follow-up commit after the production backfill has been run manually (call this out in the PR body).

- [ ] **Step 12.6:** Full suite: `pnpm nx run-many -t lint test type-check arch-check --skip-nx-cache` — all green. **Step 12.7: Commit** — `feat(backend)!: backfill exchange chat into threads and retire legacy path`.

---

### Task 13: Final verification + PR

- [ ] **Step 13.1:** `pnpm nx format:check` (prettier) and the full `run-many` from 12.6 once more from a clean state.
- [ ] **Step 13.2:** Push and open the PR against `main`, titled `feat: conversation messaging — threads, DMs, and exchange chat migration`. Body: link the spec, summarize per layer, and include a **"Post-merge manual step"** section: run `conversation/backfill` against production, verify thread counts match legacy exchange counts, then a follow-up commit drops the `messages` table. End with:

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## Self-review notes (done at planning time)

- **Spec coverage:** domain subject union (T1), DM policy port (T2), tables (T3), repository (T4), mutations + policy adapter (T5), exchange lifecycle system messages (T6), MessagePosted notifications (T7), read models + contracts + canMessage (T8), gateway (T9), /messages UI + deep link + unread badge (T10), entry points (T11), backfill + cutover + deferred table drop (T12), delivery (T13). Image-message upload UI, blocking/reporting, group DMs: out of scope per spec.
- **Consistency:** `openForExchange`/`openDm` naming used throughout; `findDmByParticipants` (not `findByParticipants`) everywhere; notification type is the pre-existing `message_received` literal — no schema union change needed.
- **Known judgment calls encoded:** system messages don't notify (exchange\_\* notifications already exist); unread counts scan capped at 50 newest messages; `participantsKey` doubles as the "exchange together" connection check.
