# Conversation messaging — wire the context end-to-end (design)

**Date:** 2026-07-02
**Status:** approved design, pre-implementation

## Problem

The `/messages` page runs entirely on hard-coded `mockUsers`/`mockMessages` arrays
(`apps/web/src/routes/_dashboard/messages.tsx`) — sent messages vanish on reload. Meanwhile a
complete `conversation` bounded context exists in `packages/domain/src/conversation/`
(Thread/Message aggregates, four use-cases, ports, in-memory repo, specs) but has **no Convex
adapter, no threads table, and no gateway namespace**. Exchange chat still runs on the legacy
`sendExchangeMessage` mutation (`packages/backend/convex/exchanges.ts`) writing the raw
`messages` table.

## Decisions (made with the owner)

1. **Generalize threads to DMs too** — a thread is either exchange-bound or member-to-member.
2. **DM policy: connected members** — you may DM a member iff you mutually follow each other,
   share a circle, or have an exchange together in any status (a proposal already opens an
   exchange thread between you, so counting all statuses keeps the two gates consistent).
3. **Migrate + backfill the legacy exchange chat** — the new tables become the only path; the
   legacy mutation, query, and `messages` table are dropped after cutover.

## Domain

Replace the hard-wired `exchangeId` with a subject discriminator:

```ts
type ThreadSubject =
  | { kind: "exchange"; exchangeId: ExchangeId } // opened by the system on exchange proposal
  | { kind: "dm" }; // opened by a member; exactly 2 participants
```

- `ThreadState.exchangeId` → `ThreadState.subject`. All existing invariants stay (only
  participants post; non-empty bodies; members cannot author system messages; mark-read touches
  only the caller's receipt). New invariant: a DM thread has exactly two distinct participants.
- **Uniqueness per subject:** one thread per exchange (idempotent `openThread`, as today); one DM
  thread per member pair (idempotent `openDmThread` returns the existing thread). The
  `ThreadRepository` port grows `findByParticipants(a, b)` alongside `findByExchange`.
- **New use-case `openDmThread`** with a new outbound policy port `ConnectionPolicy`
  (`canMessage(initiator, recipient): Promise<boolean>`), mirroring the `VisibilityPolicyPort`
  pattern. The domain never queries follows/circles/exchanges itself. Not-connected yields a
  typed `ConversationError`.
- `MessagePosted` carries the `subject` instead of `exchangeId`, so subscribers route
  notifications without loading the thread. System messages remain exchange-only in practice.
- Existing colocated `.spec.ts` files are updated for the subject change; new specs cover DM
  invariants and the policy gate.

## Backend (Convex)

**Schema — additive, two tables** (aggregate row + companion rows, like circles):

- `threads`: `aggregateId`, `subjectKind` (`"exchange" | "dm"`), optional indexed `exchangeId`,
  `participants`, indexed `participantsKey` (sorted `"memberA|memberB"`) for the one-DM-per-pair
  lookup, embedded `readReceipts`.
- `threadMessages`: one row per message (`threadId`, `messageId`, nullable `authorId`, `kind`,
  `body`, `sentAt`), indexed by `threadId + sentAt`. Messages live outside the thread row so long
  conversations never hit the document-size limit.

`convexThreadRepository` composes `ThreadState` from both tables on load; on save it inserts only
new message rows and patches thread metadata/receipts (field-for-field mapper, per the
aggregate's own comment).

**Write adapters** (thin composition roots, one file per mutation, matching `solving/` and
`exchange/`): `conversation/openDmThread.ts` (runs the `ConnectionPolicy` Convex adapter — a
query over `follows`, `circleMembers`, `exchanges`), `conversation/postMessage.ts`,
`conversation/markThreadRead.ts`.

**Events, both directions:**

- _Inbound:_ a conversation subscriber on the `domainEvents` dispatcher reacts to exchange
  lifecycle events — proposal opens the thread with both participants plus a system message;
  accepted/completed/cancelled post system messages. Exchange adapters never call conversation
  code directly.
- _Outbound:_ `MessagePosted` → the Notifications subscriber notifies the other participant(s),
  honoring `notificationPreferences`. Requires one new notification `type` value (`"message"`) in
  the schema union and the preference matrix.

**Read models** (bypass the aggregate, like the existing `readViews`): `getMyInbox` (other
participant or exchange summary, last-message preview, unread count from receipts) and
`getThreadMessages` (paginated; server-side participant gate).

**Migration/backfill:** one-shot `conversation/backfill.ts` groups legacy `messages` rows by
`exchangeId` into threads + threadMessages, marking backfilled threads read for both parties (no
wall of stale unread badges). During cutover `sendExchangeMessage`/`getExchangeMessages` re-point
at the new path; after the UI switch, the legacy mutation, query, and `messages` table are
dropped.

## Contracts & gateway

- `@jigswap/contracts`: `InboxThreadView` (thread id; subject = exchange summary **or** other
  member as `ProjectedMember`; last-message preview; unread count; updated-at) and
  `ThreadMessageView`.
- Gateway `conversation` namespace: `openDmThread`, `postMessage`, `markThreadRead`,
  `getMyInbox`, `getThreadMessages`, `canMessage` (lets the UI disable the button instead of
  catching errors). Legacy `sendMessage`/`messages` operations are removed at cutover.

## Web

- `/messages` keeps the mock's two-pane layout (thread list + active conversation; list→detail on
  mobile) but on gateway queries — Convex reactivity makes it live; sends are optimistic; opening
  a thread marks it read. Deep-link route `/messages/$threadId` for notification landings.
- Entry points v1: a "Message" button on member profiles / people cards (disabled with tooltip
  when `canMessage` is false) and the trades page, whose exchange chat panel switches to the same
  thread components.
- Unread total badges the Messages nav item. All strings via `en.json`/`nl.json`/`source.json`.
- **Provisional UI:** the visual layout may be redesigned with the UI Designer / UX Architect
  agents during the web phase to better match the rest of the application. That pass swaps
  presentation only; the gateway contract and everything below it are unaffected.

## Testing

- Domain: updated + new colocated `.spec.ts` (subject union, DM invariants, policy gate).
- Backend `.test.ts` (convex-test, at `convex/` root): repository round-trip (open → post →
  receipts), authz (non-participant reads/posts rejected; DM policy enforced server-side),
  backfill correctness on legacy fixtures, inbox unread-count math.
- Web stays light in this feature; the broader route-test effort is its own backlog item.

## Delivery

Branch `feat/conversation-messaging`, commits staged domain → backend adapters →
gateway/contracts → web → backfill/cutover, one PR. CI auto-deploys Convex dev on the PR; the
**production backfill is a deliberate manual step after merge**, called out in the PR body.

## Out of scope

- Blocking/reporting members (spec'd under Community; not built yet — the connected-members gate
  is the v1 spam control).
- Image messages end-to-end (the domain supports `kind: "image"`; upload UI ships later).
- Group DMs (threads with >2 members outside exchanges).
- The visual redesign pass itself (may run during the web phase, presentation-only).

## Parallel tracks (context)

This spec covers only the messaging slice. Running alongside as independent PRs: Track B (admin
gating audit + requireAdmin + admin i18n + contact/doc-feedback triage) and Track C (favorites
v1; EN/NL legal copy draft).
