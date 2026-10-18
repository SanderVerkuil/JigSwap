# Group (circle) threads, typing indicator and presence: design spec

Status: APPROVED, in implementation. Date: 2026-10-18. Shepherd: Project Shepherd.
Originally drafted against `origin/main` at 54bca7c156; updated to `main` at 3aa836ce90 (see "Status on main").
Designed around: `2026-10-18-messaging-attachments-safety-design.md` (blocks/reports, photos and locations), issue #152 (a shared circle counts as an identity reveal), PR #144 (per-trade reveal).
Items marked **[LAWYER]** need counsel.

User request: "Regarding the DM's, maybe it would be interesting to allow to create thread groups as wel, e.g. have an open conversation with a friend circle, where we can write messages amongst ourselves, where everyone could reply. Ideally it would also be great to show a 'typing' indicator and whether a user is online or not (if possible), and potentially a online/away/offline override as well."

## Status on main (2026-10-18)

Already shipped, not redone by this plan:

- **G0** presence roster leak: #161 (`presence:list` returns `[]`, bounded heartbeat input).
- **G1** append-only Thread aggregate, read receipts and unread state on `threadParticipants`, denormalised inbox, latest-20 pagination with scroll-up loading: #166, #174.
- **G2** leave circle, `MemberLeftCircle`, the 50-member cap: #165.
- **C1–C3** circle invitations, invitation UI, circle deletion: #182, #183, #187; circle Admins #198; name rules #199.
- Blocking and reporting (attachments spec A1–A6): #167–#172. Photos and locations (PRs 9–13): #176, #227–#230, including the account-deletion messaging purge.
- The #160 `isMine` message contract; the account-deletion purges #237, #247.

Remaining work (issues #251–#258, #266), shipped as one linear `gh stack`, bottom to top:

| #   | Issue | PR                                                                                                                                                                                                                                      |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G3  | #251  | conversation domain: circle subject, participant entries with `joinedAt`, add/remove, join/leave system events, `openCircleThread` / `syncCircleParticipant`, `CircleRoster` port                                                       |
| G4  | #252  | circle threads backend (schema, sync on circle events, deletion purge, joinedAt floor, `projectThreadMember`, blocking in circles, mute, inbox subject, contracts)                                                                      |
| G5  | #253  | per-thread grouping of `message_received`, push tag + throttle, `circle_message_received` with delayed email digest, mute on all channels                                                                                               |
| G6  | #254  | circle chat web UI                                                                                                                                                                                                                      |
| G6b | #266  | circle detail page `/circles/$circleId`: header with members, shared puzzles (through `canViewCopy`), latest chat preview (joinedAt floor, blocks), link into the chat, existing manage/leave/invite actions; non-members get not-found |
| G7  | #255  | typing indicators, backend + web                                                                                                                                                                                                        |
| G8  | #256  | presence visibility rule, preferences, rooms, `getPresenceOf`                                                                                                                                                                           |
| G9  | #257  | presence web UI                                                                                                                                                                                                                         |
| G10 | #258  | privacy page, user guide, What's new                                                                                                                                                                                                    |

Account-deletion purges of the new rows ship with the PR that introduces each table (G4 participant rows, G7 typing rows, G8 presence preferences and component rows), rather than in G10.

---

## R. Resolved decisions (user, 2026-10-18). These supersede anything below that conflicts.

1. **All recommendations accepted:**
   - circle-only v1;
   - the Convex presence component (two rooms, 30 s heartbeats);
   - hand-rolled typing;
   - blocking inside circles as in §5.3;
   - grouped notifications as in §5.5;
   - the cost model.
2. **Q1–Q21: "yes" to every default**, with these refinements:
   - **Q4:** new members see only messages sent after they joined. This is a strict `sentAt > joinedAt` floor, and it also applies after a re-join.
   - **Q17:** join/leave system rows project the subject member through the viewer's identity rules. Specifically:
     - Name the member only if the viewer could otherwise see them: the viewer is a current co-member and the subject is a current co-member (circle reveal, #152), or `projectMemberIdentity` reveals them.
     - Otherwise render "A member joined" / "A member left".
     - Never name who removed someone. "Removed" and "left" render with the same neutral text: "{name} is no longer in the circle" / "{name} zit niet meer in de kring".
   - **Q19:** prod is on Convex **Starter**, and the roughly $18/month overage is accepted. Keep heartbeats and typing writes as lean as designed, and track bandwidth: add a wide-event counter per presence/typing write, and review it in Axiom after rollout.
3. **G0 now:** the roster-leak fix ships first, standalone on `main`, small, with a test.
4. **Circle invitations replace blind adds (expands Q6; new PRs C1/C2).** Members are invited and must accept. See §2.5.
   - **Security amendment (C1 review, shepherd decision, reversible):** "may contact" means **not blocked either way AND mutual follow**. The pair-thread clause is dropped, because a pair thread can be manufactured without the target's consent: a DM opened through a shared circle, or an exchange proposal on any visible copy.
   - After a decline or revoke, the same (circle, invitee) can't be re-invited for 7 days.
   - An inviter's pending invites are revoked when they leave or lose Admin.
   - An Admin may invite only someone they may contact: the ConnectionPolicy **without** the shared-circle clause, so not blocked either way, and a mutual follow or an existing pair thread.
   - The invite is a pending state with accept, decline, revoke (by an inviter or Admin) and expiry (14 days).
   - Invites are notified by in-app, push and email.
   - **Pending invites are not membership.** They grant nothing: no circle reveal (#152), no ConnectionPolicy unlock, no copy visibility, no chat. This has to be coordinated with the privacy shepherd's #152 work through the coordinator.
   - **Leaving a circle is required** (G2).
5. **Circle deletion is built now (new PR C3; supersedes Q18 "when built").**
   - Only the owner can delete, after a confirm where they type the circle's name.
   - It deletes the circle, its memberships, pending invites, copy-share links, the circle thread, its messages, participant rows and typing rows.
   - Attachments and messages under `evidenceHold` are kept (detached, reachable only via reports), and report snapshots survive.
   - The deletion is a scheduled, paginated job.
   - Members are notified neutrally ("{circle} was deleted").
6. **Performance (G1, standard chat-app patterns):**
   - The thread view loads the **latest 20** messages, then older pages as the user scrolls up (cursor on `by_thread_sent`), and **keeps the scroll position** when older pages are prepended.
   - Posting and read receipts never load history.
   - Read receipts move to `threadParticipants`.
   - The inbox reads a **denormalised** last message and unread state, so no per-row message scans. See §2.6.
7. **Process:**
   - one worktree per PR;
   - `Intent:` trailers;
   - `gh stack` linear stacks;
   - never merge;
   - backfills only as runbook entries in `docs/deployment/one-shot-migrations.md`, run by the coordinator with the user's approval;
   - a Security/AppSec review on every authz PR.

**Updated PR list** (replaces §7 where they conflict):

| #      | PR                                                                                                                                                                                                                                       | Depends on                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| G0     | fix(presence): roster leak + 30 s heartbeat                                                                                                                                                                                              | — (now)                                                         |
| G1     | perf(conversation): append-only aggregate, receipts on participant rows, denormalised inbox state, 20-message pagination with scroll anchoring; backfill runbook                                                                         | —                                                               |
| G2     | feat(sharing): leave circle + `MemberLeftCircle`                                                                                                                                                                                         | —                                                               |
| C1     | feat(sharing): circle invitations backend: `circleInvites` table, invite/accept/decline/revoke/expire, contact gate, `circle_invite_received`/`circle_invite_accepted` notifications; `addMember` becomes internal (used only by accept) | G2, A2 (block helper)                                           |
| C2     | feat(web): circle invitation UI (invite picker limited to contactable members, pending list with revoke, accept/decline from the notification and the circles page)                                                                      | C1                                                              |
| C3     | feat(sharing): circle deletion (owner only, typed-name confirm, scheduled purge incl. the chat, evidence holds respected) + web                                                                                                          | C1 (G4 when the chat exists; C3 deletes thread rows if present) |
| G3–G10 | as in §7                                                                                                                                                                                                                                 | as in §7, plus G4 depends on C1                                 |

### R.1 Denormalised inbox state (G1 detail)

- **`threads`:** `lastMessageAt`, plus a `lastMessage` summary `{ messageId, authorId?, kind, snippet (≤ 140 chars, body-derived; "" for media), sentAt }`. This is written by the post path, the same transaction that inserts the row.
- **`threadParticipants`:**
  - `lastReadAt` (moved from `threads.readReceipts`);
  - `unreadCount` (capped at 50 for display; incremented for every other participant on post, reset to 0 on `markThreadRead`; the author's own posts don't increment);
  - `lastActivityAt` (= the thread's `lastMessageAt`, copied so the inbox can be one ordered index read `by_member_activity [memberId, lastActivityAt]`).
- **Write amplification:** a post patches N−1 participant rows. That is fine for pairs and for the cap of 50.
- **Reads:** `getMyInbox` and `getUnreadTotal` read only `threadParticipants` (plus `threads` for the subject); there are no `threadMessages` scans except the existing context-copy probes.
- **Migration:** one-shot `conversation/backfillParticipantState` (internal, paginated, idempotent) computes `lastReadAt`, `unreadCount`, `lastActivityAt` and `lastMessage`.
  - Reads fall back to the old computation while a row lacks the fields, so it is safe before the backfill runs.
  - It is documented in `docs/deployment/one-shot-migrations.md`.
  - Removing `threads.readReceipts` is a later PR after the backfill is confirmed.
- **Thread view:** `getThreadMessages` already pages newest-first with a `before` cursor. The web switches the default page to 20 and adds an "older" loader triggered by an IntersectionObserver sentinel at the top. Prepending restores `scrollTop += newScrollHeight − oldScrollHeight` in a layout effect. The bottom-follow rule is unchanged.

### 2.5 Circle invitations (C1)

```ts
circleInvites: {
  circleAggregateId: v.string(), inviteeId: v.id("users"), inviterId: v.id("users"),
  permission: "ViewOnly" | "Exchange" | "Admin",
  status: "pending" | "accepted" | "declined" | "revoked" | "expired",
  createdAt, decidedAt?, expiresAt,                     // expiresAt = createdAt + 14 d
}.index("by_invitee_status", ["inviteeId","status"]).index("by_circle_status", ["circleAggregateId","status"])
 .index("by_circle_invitee", ["circleAggregateId","inviteeId"])
```

- **Domain:** a `CircleInvite` value or aggregate in `sharing`, with `invite`, `accept`, `decline`, `revoke` and `expire` transitions, enforced by the domain (Stryker-covered).
- **Invite rules:**
  - The actor is an Admin of the circle.
  - The invitee is not already a member and has no pending invite for this circle (a repeat is idempotent).
  - The invitee is not the actor.
  - `canInvite(actor, invitee)` = not blocked either way ∧ (mutual follow ∨ existing pair thread).
  - The cap counts members plus pending invites against 50.
  - Rate limit: 30 invites per day per inviter.
- **Accepting:**
  - Only the invitee can accept, and only while the invite is pending and not past `expiresAt`. The block re-check must still pass.
  - Accepting calls the `Circle.addMember` domain path in the same transaction, which emits `MemberJoinedCircle`.
- **Declining** is silent to the inviter: they see the invite disappear from the pending list, with no "declined" notification.
- **Revoking:** the inviter or any Admin can revoke.
- **Expiry:** lazy, by `expiresAt` checked on read, plus a scheduled `expireInvite` at `expiresAt`. No cron.
- **Visibility before accepting:**
  - The invitee sees the circle name, the inviter (via `projectMemberIdentity`, since the inviter is contactable) and the member count. They do not see the member list or the shared copies.
  - The circle sees the invitee only in the Admins' pending list, projected through `projectMemberIdentity`.
- **Notifications:**
  - `circle_invite_received` (in-app, push, email-eligible), subject `{kind: "circleInvite", inviteId}` (a new subject kind);
  - `circle_invite_accepted` to the inviter (in-app).
  - Full enum fan-out.
- **`sharing/addMember`** stops being a public mutation and becomes internal (accept only). The web "add member" turns into "Invite".
- **Existing memberships are unaffected.** No backfill is needed.

---

## 0. Findings that come before this feature

1. **Presence leak today (urgent, independent).** `convex/presence.ts` exports `list({roomToken})` and the web heartbeats one shared room, `"messages"`. The component hands every heartbeating member the same room token, and `presence:list` returns up to 104 `{userId, online, lastDisconnected}` rows for that room. So any signed-in member who opens /messages can list the Convex user ids of everyone currently or recently on /messages, with last-disconnect times. That includes private profiles. Profile handles fall back to the raw `_id` (`profileHandleOf`), so the ids are linkable to people.
   → **PR G0:** `list` returns `[]`. The hook ignores the result, and no UI reads it; `presenceGate` uses `listUser` server-side. Also raise the heartbeat interval to 30 s (see §4.4).
2. **Adding someone to a circle needs no consent and no connection.** `Circle.addMember` is gated only on the actor being an Admin; the web adds members picked from `identity.search`. The ConnectionPolicy already treats a shared circle as a DM unlock, and a circle chat would also drop the added person into a group conversation with strangers. There is also **no way to leave a circle** (only an Admin can remove a member) and **no circle deletion**. Groups need at least "leave" (PR G2). See Q6 for tightening adds.
3. **The Thread aggregate hydrates the full message history on every post and every read receipt** (`convexThreadRepository.messagesOf(...).collect()`, twice per save). No invariant reads that history. In groups this cost grows with traffic, and read receipts embedded on the `threads` row make every `markThreadRead` re-run every participant's inbox and badge query, and contend with posts. Fix it before groups (PR G1).
4. **`message_received` is not batched:** one bell row, one push and possibly one email per message (no `groupKey`). That is tolerable for DMs and a flood in a 10-person circle. Fix it in PR G5, for DMs as well.

---

## 1. Scope

**v1 (recommended):**

- **Circle threads only:** one conversation per friend circle, all current members, everyone may post. Ad-hoc groups are deferred (Q1).
- **Typing indicator** in every thread kind (DM, exchange, circle).
- **Presence:** Online / Away / Offline, visible to mutual followers only, opt-in. Override options: Automatic / Away / Appear offline.

**Deferred** (explicitly not v1):

- ad-hoc groups;
- group exchanges;
- @mentions and per-mention notifications;
- reactions and replies/quotes;
- timed mute ("for 8 hours") and Do-not-disturb;
- "last seen" timestamps;
- read-by lists ("seen by Anna, Bas");
- per-message "delivered" ticks;
- a toggle to disable chat per circle;
- invite/accept flow for circle membership (recommended soon after, Q6);
- presence on profile pages, people lists and search;
- typing in the inbox row;
- circle avatars/images;
- group rename from the chat (the name comes from the circle).

---

## 2. Data model and domain changes

### 2.1 Conversation domain (`packages/domain/src/conversation`)

- `ThreadSubject` gains `{ kind: "circle"; circleId: CircleId }`. `CircleId` is a foreign branded id in `domain/ids.ts`, like `ExchangeId`.
- Participants become entries rather than bare ids: `ParticipantState { memberId, joinedAt }`. Pair threads keep exactly two (`joinedAt` = thread creation for legacy rows).
- `Thread.openForCircle(id, circleId, members: {memberId, joinedAt}[])` allows at least one participant; a circle with only its owner can still have a thread.
- `addParticipant(memberId, now)` / `removeParticipant(memberId, now)`:
  - Allowed **only for circle subjects**. On a pair thread they return a new `ConversationError.participantsFixed()`.
  - `addParticipant` is idempotent (a re-join resets `joinedAt` to `now`; see Q4).
  - Each records the new event `ParticipantJoined` or `ParticipantLeft`.
- `postMessage` is unchanged in rules (author must be a current participant; body rules). It gains nothing group-specific. The block gate stays in the application layer, as in the attachments spec.
- A system message may carry a structured `systemEvent?: { kind: "joined" | "left"; memberId }` (with an empty-string-safe body such as `"member_joined"`), so join and leave rows render with the viewer's identity projection rather than a snapshotted name. `postSystemMessage` accepts it.
- **History leaves the aggregate.** `ThreadState.messages` becomes "messages appended in this unit of work". `rehydrate` starts with `[]`, and the `messages` getter is removed or renamed to `appended`. No invariant used history (verified). The repository computes `lastMessageAt = max(stored, appended)`.
- **Read receipts** stay a domain concept (`markRead` only touches the caller), but persistence moves to `threadParticipants` (2.3). `ThreadState.readReceipts` is loaded only for the calling member; the use case passes the member to a `findForMember` repository method, or the repository simply loads all participant rows, which is bounded by the cap of 50.
- New application use cases, each with a port and a spec:
  - `openCircleThread({circleId, actorId})`. It needs a new outbound port `CircleRoster.membersOf(circleId) → {memberId, joinedAt}[] | null`. It is idempotent via `ThreadRepository.findByCircle(circleId)`, and the actor must be in the roster.
  - `syncCircleParticipant({circleId, memberId, change: "joined"|"left", at})`. If there is no thread it does nothing, because lazy creation seeds from the roster. It posts the join or leave system message.
- Stryker ≥ 95%: every new branch gets a `.spec.ts` case (pair rejects add/remove, idempotent add, removal of a non-participant, empty circle, system event body).

### 2.2 Sharing domain (`packages/domain/src/sharing`)

- `Circle.leave(memberId)`: a non-owner member may remove themself; the owner gets `cannotRemoveOwner`, a non-member gets `notAMember`.
- A new event `MemberLeftCircle(circleId, memberId, reason: "left" | "removed")` is recorded by both `leave` and `removeMember`. Today `removeMember` records nothing.
- A new use case is `leave-circle`, with the backend mutation `sharing/leaveCircle`.
- Circle deletion does not exist and is not added here. The rule for when it is built is in Q18.
- The block gate on `addMember` is already in Milestone A3. The connection gate on add (Q6) would be a policy port here.

### 2.3 Convex schema

```ts
threads: {
  subjectKind: "exchange" | "dm" | "circle",        // + "circle"
  circleId: v.optional(v.string()),                 // CircleId aggregateId, iff circle
  participants: v.array(v.id("users")),             // kept (≤ 50) for cheap gates
  participantsKey: v.string(),                      // circle threads: `circle:<circleId>`
  readReceipts: v.optional(...),                    // DEPRECATED: read only during migration, then removed
  lastMessageAt, createdAt, aggregateId, exchangeId
}.index("by_circle", ["circleId"])                  // + new

threadParticipants: {                               // becomes the per-member state row
  threadAggregateId, memberId,
  joinedAt: v.optional(v.number()),                 // absent = since thread start (legacy)
  lastReadAt: v.optional(v.number()),               // moved off threads.readReceipts
  muted: v.optional(v.boolean()),
  lastPushedAt: v.optional(v.number()),             // push throttle (G5)
  emailPendingUntil: v.optional(v.number()),        // email delay dedupe (G5)
}.index("by_member", ...).index("by_thread", ...)
 .index("by_thread_member", ["threadAggregateId","memberId"])   // + new

threadMessages: { ..., systemEvent: v.optional(v.object({ kind: v.union(v.literal("joined"), v.literal("left")), memberId: v.id("users") })) }

// Typing (hand-rolled, §4.3). At most one row per (thread, member), patched in place.
typingIndicators: { threadAggregateId: v.string(), memberId: v.id("users"), updatedAt: v.number() }
  .index("by_thread", ["threadAggregateId"])
  .index("by_thread_member", ["threadAggregateId","memberId"])
  .index("by_member", ["memberId"])                 // account-deletion purge

// Presence settings (federated settings: owned by a small "presence" area in social/).
presencePreferences: {
  memberId: v.id("users"),
  share: v.optional(v.boolean()),                   // tri-state like shareInProgress: undefined = never asked
  override: v.union(v.literal("auto"), v.literal("away"), v.literal("invisible")),
  updatedAt: v.number(),
}.index("by_member", ["memberId"])
```

- **Migration (G1):**
  - Backfill `threadParticipants.lastReadAt` from `threads.readReceipts` with a one-off internal mutation, paginated.
  - Reads use `participant.lastReadAt ?? threads.readReceipts[me]` until the backfill is confirmed, then a follow-up PR drops the field. Watch the Convex value normalisation pitfall: compare after canonicalising.
- **Group size cap:** 50 participants per circle thread (Q7). Enforce it in `Circle.addMember` as a circle cap, since a circle bigger than its chat would be confusing.

### 2.4 Contracts (`packages/contracts/src/conversation/views.ts`)

- `InboxThreadSubjectView` gains:
  `{ kind: "circle"; circleId; name; memberCount; memberPreview: ProjectedMember[] /* ≤3, newest posters first */; }`
- `InboxThreadView` gains `muted: boolean`. Its `lastMessage` gains an `author?: ProjectedMember` for circle threads, because the row shows "Anna: …".
- `ThreadMessageView` gains:
  - `author?: ProjectedMember` (circle threads; DMs keep using the subject's `otherMember`);
  - `authorBlockedByMe?: true`;
  - `systemEvent?: { kind; member: ProjectedMember }`.
- New `TypingView { member: ProjectedMember; ageMs: number }[]`.
- New `PresenceView { memberId; status: "online" | "away" }`. Offline and hidden are both simply absent, so "hidden" and "offline" can't be told apart.

---

## 3. Authorisation rules per function (all server-side)

Shared helpers:

- `requireMember`;
- `requireParticipant(ctx, thread, me)` (a `threadParticipants` row exists; uses `by_thread_member`);
- `isBlockedEitherWay` / `blockedEitherWaySet` (Milestone A2);
- `projectMemberIdentity` (with the circle rule from #152);
- `areMutualFollowers`.

**Circle thread author projection:** `projectThreadMember(ctx, viewer, target, thread)`.

- If the thread is a circle thread and the target is a **current** co-participant, the target is revealed. This is the #152 circle rule, applied here even when a block exists, so the blocked side can't infer the block from one anonymised author (Q8).
- Otherwise it falls through to `projectMemberIdentity` with salt = thread id. Former members fall through here and may become anonymous.

| Function                                                             | Kind     | Rule                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversation/openCircleThread({circleId})`                          | mutation | Member; caller is in `circleMembers` for the circle (else `CircleNotFound`, never "not a member"). Idempotent. Rate limit shared with messages.                                                                                                                                                                                                                                                                           |
| `conversation/postMessage` (existing)                                | mutation | As today, plus for circle threads: the caller must still be in `circleMembers` (defence in depth over the sync). **No pair-block refusal in circle threads** (the A2 `assertPairNotBlocked` only applies to `dm`/`exchange`). Deletes the caller's `typingIndicators` row in the same transaction. Copy attachment uses the existing `isAttachable` (owner is a participant and every participant `canViewCopy`).         |
| `conversation/getThreadMessages` (existing)                          | query    | Participant. For circle threads, rows with `sentAt < joinedAt` are excluded (the index range starts at `joinedAt`). Authors go through `projectThreadMember`, and messages from a member the viewer blocked get `authorBlockedByMe`. Removed members get `NotParticipant` (the thread vanishes from their inbox).                                                                                                         |
| `conversation/getMyInbox` / `getUnreadTotal` (existing)              | query    | As today. Unread is computed from `threadParticipants.lastReadAt` and floored at `joinedAt`. Muted threads are excluded from `getUnreadTotal` (Q9). Messages authored by members the viewer blocked are not counted as unread.                                                                                                                                                                                            |
| `conversation/markThreadRead` (existing)                             | mutation | Participant; patches **only** the caller's `threadParticipants` row. It no longer saves the aggregate.                                                                                                                                                                                                                                                                                                                    |
| `conversation/setThreadMuted({threadId, muted})`                     | mutation | Participant; own row only.                                                                                                                                                                                                                                                                                                                                                                                                |
| `conversation/canMessage` / ConnectionPolicy                         | —        | Unchanged by groups. The shared-circle clause stays, behind the block short-circuit from A2.                                                                                                                                                                                                                                                                                                                              |
| `sharing/leaveCircle({circleId})`                                    | mutation | Member; non-owner; emits `MemberLeftCircle`.                                                                                                                                                                                                                                                                                                                                                                              |
| `sharing/addMember` / `removeMember` (existing)                      | mutation | As today plus A3 block refusal; optional connection gate (Q6); cap of 50.                                                                                                                                                                                                                                                                                                                                                 |
| Conversation subscriber on `MemberJoinedCircle` / `MemberLeftCircle` | internal | Runs `syncCircleParticipant`. On leave it also deletes the member's typing row and their `threadParticipants` row.                                                                                                                                                                                                                                                                                                        |
| `conversation/setTyping({threadId})`                                 | mutation | Member + participant. **No-op** (returns without writing) when: the caller's override is `invisible` (Q13); a DM/exchange pair is blocked; or the caller's row was updated less than 2 s ago (server-side throttle). Never throws on these, so typing can't be used as a probe.                                                                                                                                           |
| `conversation/clearTyping({threadId})`                               | mutation | Own row only; delete. Called on blur or when the input is emptied; a send clears it through `postMessage`.                                                                                                                                                                                                                                                                                                                |
| `conversation/getTyping({threadId})`                                 | query    | Participant. Returns rows with `now - updatedAt < 6 s`, excluding self and members blocked either way with the viewer, projected with `projectThreadMember`, plus `ageMs`.                                                                                                                                                                                                                                                |
| `presence:heartbeat` (existing, extended)                            | mutation | Member; `userId` must equal auth (as today). Rooms allowlisted: `messages`, `app:online`, `app:away`.                                                                                                                                                                                                                                                                                                                     |
| `presence:list` (existing)                                           | query    | **Returns `[]`** (G0).                                                                                                                                                                                                                                                                                                                                                                                                    |
| `presence:disconnect` (existing)                                     | mutation | Session token is the capability (unchanged).                                                                                                                                                                                                                                                                                                                                                                              |
| `presence/setPresencePreferences({share?, override?})`               | mutation | Member; own row.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `presence/getMyPresenceSettings`                                     | query    | Member; own row.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `presence/getPresenceOf({memberIds})`                                | query    | Member; at most 50 ids. Per target the rule `canSeePresence` (pure domain function, §5.1) must hold: not self, not blocked either way, mutual followers, target `share === true`, target override ≠ invisible, and the **viewer** also shares (reciprocity, Q11). Status: Away if the override is away, or the target is in `app:away` but not `app:online`; Online if in `app:online`. Never returns `lastDisconnected`. |
| `notifications/presenceGate.isViewingMessages` (existing)            | internal | Unchanged (internal only; works regardless of the share setting or invisibility).                                                                                                                                                                                                                                                                                                                                         |

Error hygiene: every refusal in a circle context uses the existing generic codes (`ThreadNotFound`, `CircleNotFound`, "can't reply"), never "you were removed" or "you are blocked".

---

## 4. Presence and typing mechanism, and cost

### 4.1 Options evaluated

|                   | `@convex-dev/presence` (already mounted, v0.4.0)                                                                                                                                          | Hand-rolled heartbeat table                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Session lifecycle | Done: per-session deadline (2.5× interval), batch-worker sweeper, `sendBeacon` disconnect on unload, disconnect on hidden tab, multi-tab aggregation (a user is online if any session is) | We build the sweeper (cron or scheduled per session), multi-tab aggregation, beacon endpoint, and tests |
| Read invalidation | Heartbeats write `sessions`; reads hit the `presence` table, which changes **only on online/offline transitions**. So readers are not invalidated per heartbeat.                          | Must copy the same two-table split, or every heartbeat invalidates every viewer                         |
| Away / idle       | No concept. Modelled as two rooms (below), no custom data writes                                                                                                                          | Free-form                                                                                               |
| Per-call overhead | Heartbeat also reads/writes room and session token docs (~4 small docs)                                                                                                                   | ~2 docs                                                                                                 |
| Risk              | Already in prod for the notification gate; small API; pre-1.0                                                                                                                             | New code on a hot path                                                                                  |

**Recommendation: keep the component** for connection lifecycle, wrapped by our own thin layer (`convex/presence.ts` allowlist plus `presence/getPresenceOf`). Hand-roll only **typing**, which is per-thread, short-lived and needs no sessions.

### 4.2 Presence model

- **Rooms:**
  - `app:online`, mounted while a dashboard tab is **visible and active**;
  - `app:away`, mounted while visible but idle for 5 minutes or more with no pointer or key input;
  - only one is mounted per tab at a time;
  - `messages` (existing) stays, mounted on /messages, for the notification gate.
  - The stock `usePresence` hook is used and switched by conditional mounting (unmount → disconnect). No forked hook.
- **Automatic status:** online if any session is in `app:online`; else away if any is in `app:away`; else offline. A hidden tab or backgrounded PWA disconnects (stock hook behaviour), so it reads as offline after a few seconds (graceful) or about 75 s (crash or network loss).
- **Override** (`presencePreferences.override`):
  - `auto`: as computed above.
  - `away`: shown as Away whenever the member is not offline.
  - `invisible` ("Appear offline"): never shown; no typing emitted (Q13).
  - There is no "Online" override: the server can't honestly claim someone is online when they have no session, and "Automatic" already shows online when active (Q12). The override persists until changed.
- **Sharing:** `share` is tri-state (undefined = never asked → a one-time prompt on /messages), like `shareInProgress`. With `share !== true`, nobody sees your status and you see nobody's (reciprocity).
- **Where it shows (v1):** the DM inbox row avatar, the DM thread header, and the circle members sheet with an "N online" count in the circle header. It is not shown on exchange threads with non-mutuals (the rule already hides it).

### 4.3 Typing model

- **Client:**
  - On input with a non-empty value, call `setTyping` at most once per 4 s (leading edge).
  - Stop after 5 s without keystrokes, then call `clearTyping` (or skip it and let the 6 s TTL lapse; clearing is optional and saves nothing).
  - Sending clears it inside `postMessage`.
  - Only while the thread view is mounted and the tab is visible.
- **Server:** `setTyping` upserts the single row (patch `updatedAt`) and skips the write if the last write was under 2 s ago.
- **Expiry:** `getTyping` returns `ageMs`, computed with `Date.now()` at execution. The client hides each entry when `ageMs + elapsed ≥ 6 s` on a local timer, so there is no clock-skew issue and no scheduled deletes.
- Rows are deleted on send, on leaving the thread or circle, and on account deletion. Stale rows are bounded (one per thread-member) and harmless; no cron.

### 4.4 Cost estimate

**Basis:** Convex plans as found on convex.dev/plans via search (verify before deciding):

- Free: about 1M function calls/month, with hard limits on overage.
- Starter: $2.20 per 1M calls over.
- Professional: $25 per developer per month, including 25M calls, then $2 per 1M.
- Assumed: the component's internal calls are billed (worst case: each heartbeat counts as 2 calls), and each subscription re-run counts as a call.

**Scenario:** 100 daily active members. Each has a dashboard tab visible 45 min/day, with 15 min of that on /messages, sends 15 messages/day (about 10 s of typing each), and has about 3 open subscribers watching their presence. Circle threads average 6 members.

| Stream                                                                 | Calls/day | Calls/month         |
| ---------------------------------------------------------------------- | --------- | ------------------- |
| `app:online`/`app:away` heartbeats at 30 s (90 per DAU) ×2 (component) | 18,000    | 540k                |
| `messages` heartbeats at 30 s (30 per DAU; today 10 s = 90) ×2         | 6,000     | 180k (today ≈ 540k) |
| Disconnect worker and beacons (~10 per DAU)                            | 1,000     | 30k                 |
| `getPresenceOf` re-runs on transitions (~10 transitions × 3 watchers)  | 3,000     | 90k                 |
| `setTyping` writes (~3 per message after throttle)                     | 4,500     | 135k                |
| `getTyping` re-runs (~1.5 open viewers per write)                      | 6,750     | 200k                |
| **Net added** (after the `messages` interval saving)                   |           | **≈ 0.8M/month**    |

- Linear scale: about 8M/month at 1,000 DAU. That is within Professional's included 25M; at Starter rates about $18/month.
- **Bandwidth:** about 1–1.5 KB read/written per heartbeat and about 1 KB per typing write gives roughly 0.5–0.8 GB/month at 100 DAU. That matters against a free-tier 1 GB DB bandwidth cap, and is negligible on Professional (50 GB).
- **Hand-rolled saving:** about 25–35% on heartbeat calls (no token docs, one stream), minus a fixed sweeper cost of about 43k calls/month for a 1/min cron, plus build and test cost. Not worth it at this scale.
- **Levers if needed:**
  - `app:away` interval to 60 s;
  - drop the separate `messages` room by deriving "on messages" from a route-tagged `app:online` room (`app:online:messages`);
  - typing throttle to 5 s;
  - presence only in thread headers (not inbox rows).
- **Q19:** which plan is prod on? On Free, this feature uses most of the monthly call allowance at 100 DAU.

---

## 5. Privacy, blocking and GDPR

### 5.1 Presence visibility rules (pure domain function, Stryker-covered)

`canSeePresence({ viewerId, targetId, mutual, blockedEitherWay, targetShare, targetOverride, viewerShare })`
= viewer ≠ target ∧ ¬blocked ∧ mutual ∧ targetShare === true ∧ targetOverride ≠ "invisible" ∧ viewerShare === true.

Consistency notes:

- This mirrors "currently solving": opt-in AND mutual followers.
- A public profile does **not** make presence public.
- A shared circle reveals identity (#152) but **not** live activity: circle-mates who are not mutual followers don't see each other's presence, even in the circle thread.
- Exchange partners who aren't mutual don't either.
- Hidden and offline render identically (absent from `getPresenceOf`).

### 5.2 Typing visibility

Typing is scoped to one conversation the viewer is already in, so it shows to the other participants, whether or not they are mutual followers. That is how WhatsApp and Signal behave in groups. Exceptions:

- blocked pairs (either way): never;
- an `invisible` typer emits nothing.
  Typing is not tied to the presence `share` setting (Q14).

### 5.3 Groups and blocking (A blocked B; both in circle C)

| Concern                    | A (blocker) sees                                                                                                                                 | B (blocked) sees                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B's messages in C's thread | Collapsed placeholder "Message from a member you blocked · Show" (per message group); not counted as unread; no notification                     | n/a                                                                                                                                                           |
| A's messages               | n/a                                                                                                                                              | **Normal**, named via the circle rule, so the block stays silent (hiding them or anonymising A would reveal the block to B and confuse the rest of the group) |
| Posting                    | A can post                                                                                                                                       | B can post (the circle is shared context; the block doesn't remove anyone from it)                                                                            |
| Typing / presence          | Never across the pair                                                                                                                            | Never across the pair                                                                                                                                         |
| Notifications              | Subscriber drops B-authored `message_received` for A (A2 already drops commands whose actor is blocked either way)                               | A's messages notify B normally                                                                                                                                |
| Attachments                | B's photos stay collapsed even after "Show" on the text; image report is available                                                               | Normal (the non-mutual blur applies, since the block deleted the follows)                                                                                     |
| Copy cards                 | `canViewCopy` with block context: B's copies show as "no longer available" for A                                                                 | Likewise for A's copies                                                                                                                                       |
| Block confirm copy (A5)    | Adds: "You're both in {circle}. You'll still see that you're in the group, and their messages will be hidden for you. You can leave the circle." | —                                                                                                                                                             |

DM threads between A and B stay read-only as in the attachments spec. A blocked pair in a circle never unlocks a DM (A2 short-circuits the ConnectionPolicy).

### 5.4 Reports, attachments, unread, membership changes, deletion

- **Reports:** "Report message" is available on any other member's message in a circle thread.
  - The evidence snapshot (target plus up to 10 preceding messages) includes third-party authors. That is acceptable, since the reporter could see them, but it is noted in the DPIA.
  - `targetKind: "message"` works unchanged. "Report {name}" is in the members sheet.
  - Reporting the circle itself is deferred.
- **Attachments** (ask the attachments shepherd to build these as **per-viewer** rules in PRs 10–12, so groups need no retrofit):
  - Screening is unchanged; a pending image is hidden from **all** other participants.
  - The non-mutual blur is computed **per viewer** (sender not a mutual follower of _this viewer_ → blurred for this viewer).
  - Location: the exact "current location" option is offered only if the sender is mutual with **every** participant, else the precision is approximate.
  - The consent copy gets a group variant: "Share this spot with the {count} members of {circle}…" / "Deel deze plek met de {count} leden van {circle}…".
  - New members see attachments only from their `joinedAt`.
- **Unread per member:** `threadParticipants.lastReadAt`, floored at `joinedAt`, capped at 50 as today. Muted threads show a grey count in the row and are left out of the shell badge.
- **Join:** a new member sees history from `joinedAt` only (Q4). A system row "Anna joined" is visible to everyone.
- **Leave or removal:**
  - the participant row is deleted;
  - the thread disappears from their inbox;
  - they get no access to history;
  - their typing row is deleted;
  - pending notifications for that thread are left as they are, and clicking one lands on `/messages` because the subject is unavailable (`viewRules` already handles this).
  - Their past messages stay for the group. They are projected by standard rules once they're no longer a co-member, and may render as "Former member" (Q5).
  - A system row "Anna left" / "Anna was removed" does not name who removed them.
- **Re-join:** a new `joinedAt`; the history between leave and re-join stays hidden.
- **Circle deletion** (when built, Q18): the thread and its messages and attachments are deleted with the circle, after a confirm that names it; items under `evidenceHold` and report snapshots survive by design.
- **Account deletion** (extends the attachments spec's `purgeMemberMessagingData`):
  - delete their `threadParticipants`, `typingIndicators`, `presencePreferences` and component presence rows (`presence.removeRoomUser` for each allowlisted room);
  - circle messages stay with the author shown as "deleted member";
  - circle membership removal belongs to the general cascade ticket, and emitting `MemberLeftCircle` there keeps the chat in sync.

### 5.5 Notifications and batching

- **In-app:** generalise `inAppChannel` grouping (today only `new_follower`) to `message_received` with `groupKey = thread:<threadId>`. One unread row per thread, with `actorIds` (distinct authors, newest first) and `actorCount`. A merge re-inserts the row so it surfaces at the top. This applies to DMs too: "Anna and 2 others wrote in Puzzle Club" / "Anna en 2 anderen schreven in Puzzelclub".
- **Push:** Web Push `tag = thread:<threadId>` (the OS replaces instead of stacking), plus a server throttle of at most 1 push per thread per member per 2 min (`threadParticipants.lastPushedAt`). No body preview, as today.
- **Email:** never per message in circle threads.
  - On the first unread circle message after a member's last read, set `emailPendingUntil = now + 30 min` and schedule `maybeEmailThreadDigest(threadId, memberId)`.
  - At fire time, send one email only if the member is still unread and hasn't been active on /messages. One per thread per 6 h at most.
  - DMs keep current behaviour (Q10).
- **Type:** a new `circle_message_received` notification type (in-app + push on, email **off** by default), so members can keep DM email but silence circle mail.
  - It needs the full enum fan-out from the memory note: `schema.ts`, domain `notification-type.ts` (plus `EMAIL_ELIGIBLE_TYPES`), contracts views, `notifications/{copy,viewRules,preferenceValidators}.ts`, `webPush.ts`, `backfillRefs.ts` if needed, web `notification-meta.ts` / `notification-sentence.tsx`, and en/nl/source.
  - `subject: { kind: "thread" }` is reused.
- **Mute:** `threadParticipants.muted` → the subscriber skips all channels for that member and thread.
- **Presence suppression:** the existing `messages`-room gate stays.
- **Fan-out bound:** with at most 50 participants, one subscriber transaction does at most 50 presence lookups and notify calls. That is fine; past 50, move to a scheduled per-recipient fan-out.

### 5.6 GDPR notes

- **Presence:**
  - Live behavioural data about a person.
  - Lawful basis: 6(1)(f), legitimate interest in social features, with safeguards: opt-in by default (Art. 25), mutual-only, reciprocity, appear-offline, no last-seen, no history.
  - Alternatively frame the opt-in as consent, 6(1)(a) **[LAWYER]**. Recommend 6(1)(f) with opt-in, so withdrawing is just switching it off.
- **Retention:**
  - Component `sessions` rows are deleted on disconnect.
  - The component's `presence` rows keep a `lastDisconnected` per user and room indefinitely. It is never exposed, but it is a last-seen record: purge it on account deletion. A periodic purge of offline rows older than 30 days is deferred (a small cron).
  - `typingIndicators` live until the next send, leave or account deletion.
- **Logs:** never log presence transitions or typing with member ids at info level; never log message bodies (as in the attachments spec).
- **Groups:**
  - A member's messages are disclosed to the circle's current and future members, but only messages after a member's own join. That limits disclosure to people who joined later.
  - Data-subject access: a member's export includes their own circle messages. Other members' messages are third-party data and are excluded, except in context the member is entitled to **[LAWYER]**.
- **Privacy page / Terms:**
  - Add "online status (opt-in, mutual followers)", "typing indicators" and "group chats in circles (visible to current members; new members don't see earlier messages)".
  - No new processors (Convex only).
- **DPIA:** add presence and groups to the light DPIA already planned in the attachments spec.

---

## 6. UI (desktop + mobile)

Fits the #138–#140 message center: compact 68 px rows, a header with avatar, title, puzzle stack and quick links, grouped bubbles, and the `+` composer from the attachments spec.

### 6.1 Inbox row

```
DM with presence                     Circle thread
┌──────────────────────────────┐    ┌──────────────────────────────────┐
│ (A)● Anna de Vries     14:02 │    │ (◐◑) Puzzle Club          13:40 │
│      [cov] Sounds good!   (2)│    │       Bas: Who has the Wasgij? ③ │
└──────────────────────────────┘    └──────────────────────────────────┘
 ● = online (green, ring); away = amber half-dot; offline = none
 (◐◑) = up to 2 overlapping member avatars (memberPreview), or a Users icon
 muted: bell-off icon before the time, count pill grey
```

- The snippet prefix is the author's projected name ("You: …" for own).
- The dot has an sr-only label ("Online" / "Away"). Colour is never the only cue: away uses a half-filled shape.

### 6.2 Thread header and members sheet

```
Desktop (md+)
┌──────────────────────────────────────────────────────────────────────┐
│ (◐◑) Puzzle Club              [cov][cov]        [Circle] [⋯]         │
│      6 members · 2 online  ← button, opens members panel             │
└──────────────────────────────────────────────────────────────────────┘
 ⋯ menu: Mute / Unmute · Members · Open circle · Leave circle · Report…
Members panel (desktop: right-side Sheet 360px; mobile: bottom Sheet)
┌ Members (6) ───────────────────┐
│ (A)● Anna de Vries   Admin     │
│ (B)  Bas             ·         │
│ (C)◐ Chris           ·         │
│ (?)  Former/anonymous …        │
│ ─────────────────────────────  │
│ [Mute conversation]            │
│ [Leave circle]   (destructive) │
└────────────────────────────────┘
```

- The "N online" count only counts members the viewer may see (§5.1). When it's 0 or presence is not shared, it shows "6 members" only.
- The quick link "Circle" goes to `/circles?circle=<id>` (the existing circles page).
- Leave uses an AlertDialog: "Leave {circle}? You'll lose access to this conversation and the circle's shared puzzles." / "{circle} verlaten? Je verliest de toegang tot dit gesprek en de gedeelde puzzels van de kring."

### 6.3 Thread body

```
                Anna joined · 12 Oct                       (system, centered, muted)
 (A) Anna
     ┌──────────────────────┐
     │ Who has the Wasgij?  │
     └──────────────────────┘
     ┌──────────────┐
     │ I can lend it│ 13:38
     └──────────────┘
 (B) Bas
     ┌──────────────────────────────────────────────┐
     │ ⦸ Message from a member you blocked · Show    │   (blocker's view only)
     └──────────────────────────────────────────────┘
                                   ┌──────────────┐
                                   │ Me too!      │ 13:40   (own, right, purple)
                                   └──────────────┘
 · · ·  Anna is typing…                                   (above composer)
┌──────────────────────────────────────────────────────┐
│ [+] Write to Puzzle Club…                     [Send] │
└──────────────────────────────────────────────────────┘
```

- In circle threads, others' message runs show the author's name above the first bubble and a 24 px avatar beside it (32 px tap target on mobile; tapping opens the profile when not anonymous). DMs keep the current look.
- Grouping key: author plus the existing time window, unchanged from `groupThreadMessages`.
- **Typing line text:**
  - "{name} is typing…"
  - "{a} and {b} are typing…"
  - "Several people are typing…" (3 or more)
  - nl: "{name} typt…", "{a} en {b} typen…", "Meerdere mensen typen…"
  - It reserves its height (no layout jump) and animates the dots only with `prefers-reduced-motion: no-preference`. It is **not** announced in the live region (noise); it has `aria-hidden` plus a polite announcement only for new messages, which is the existing behaviour.
- **Live region:** circle announcements say "{author} in {circle}: {body}".
- **Composer placeholder:** "Write to {circle}…" / "Schrijf aan {circle}…".
- **Copy attach in circles:** the "theirs" tab is hidden (several owners); there is one tab, "My puzzles", plus "Shared in this circle" (copies in `circleCopyShares` that every participant can view). The tab is deferred if it complicates G6.

### 6.4 Entry points

- **Circles page:** an "Open group chat" button on each circle card/detail (`openCircleThread` → navigate).
- **Inbox:** the "New" button becomes a menu (Message a member / Circle chat → circle picker). On mobile a bottom Sheet.
- The inbox shows a circle thread only once it has at least one message or the viewer opened it (Q21).

### 6.5 Presence controls

- **Status menu** in the shell user button (Clerk `UserButton` custom menu items next to Preferences):
  - "Status: Automatic ✓ / Away / Appear offline"
  - nl "Status: Automatisch / Afwezig / Offline weergeven"
  - Shows a small dot on the user's own avatar.
  - Hidden until sharing has been chosen.
- **"Privacy & safety" page** (created by A5): toggle "Show when I'm online to people I follow mutually. If off, you won't see others' status either." / "Laat zien wanneer ik online ben aan mensen die we wederzijds volgen. Als dit uit staat, zie jij ook niet of anderen online zijn."
- **One-time prompt** on /messages when `share === undefined`, as an inline card above the inbox list with [Share] [Not now]. "Not now" stores `false`; it can be changed in settings.

### 6.6 Mobile specifics

- Thread routes stay immersive (shell bars hidden). The header is one line: back, avatar, title, and a second muted line "6 members · 2 online" (tap → bottom Sheet).
- The members sheet uses snap points 50% and 90%.
- The typing line sits above the composer and inside the safe-area padding.
- Long-press on a message opens the action sheet (Report), with a visible overflow button as the non-gesture path (WCAG 2.5.1), as in the attachments spec.
- Every target below md is at least 44 px.

---

## 7. PR plan

Each PR is verified with `pnpm format:check` + `turbo run lint type-check test build arch:check --force`, plus domain Stryker for domain PRs. The PRs are atomic, carry Intent trailers, and are left for user review. Stacks are linear (gh stack); several stacks can be open at once.

**Dependencies on the attachments stack:**

- A2 (blocks core + `isBlockedEitherWay` + the subscriber actor filter) and A3 (block visibility, `projectMemberIdentity` block branch) come **before** G4/G7/G8.
- A5 (Privacy & safety page) comes before G9.
- #152 (circle reveal in `projectMemberIdentity`) comes before G4.
- PRs 10–12 (images/location) should adopt the per-viewer rules in §5.4. If groups land first, G4 adds a short checklist to their PR bodies; if they land first, G4 includes the small adaptation.
- G1 touches `threadMapper`/repository, which PR 9/10 also touch (`attachmentId`), so G1 should merge before PR 9.

| #   | PR                                                                                                                                                                                                                                                                                                                                     | Depends on                                          | Verification                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G0  | **fix(presence): stop leaking the messages room roster**: `presence:list` returns `[]`; heartbeat interval 30 s; comment explaining why                                                                                                                                                                                                | — (merge now)                                       | New `presence.test.ts`: two members heartbeat, `list(roomToken)` returns `[]`; `presenceGate` tests still green                                                                                                                                                                      |
| G1  | **perf(conversation): Thread aggregate stops hydrating history; read receipts move to `threadParticipants`** (+ `joinedAt`, `by_thread_member`, backfill mutation, dual-read)                                                                                                                                                          | — (before attachments PR 9)                         | Domain specs (append-only state); `conversationMutations`/`conversationReads` green; new test: `markThreadRead` patches only the participant row (thread row `_creationTime`/fields unchanged); backfill test                                                                        |
| G2  | **feat(sharing): leave circle + `MemberLeftCircle` event** (leave and remove), circle member cap 50, web "Leave circle" on the circles page                                                                                                                                                                                            | —                                                   | `circle.spec.ts` (owner can't leave, non-member, event reason); backend `sharing` tests                                                                                                                                                                                              |
| G3  | **feat(conversation): domain circle subject, participant add/remove, join/leave system events, `openCircleThread`/`syncCircleParticipant` use cases + `CircleRoster` port**                                                                                                                                                            | G1                                                  | Domain specs, Stryker ≥ 95% on `conversation`                                                                                                                                                                                                                                        |
| G4  | **feat(conversation): circle threads backend**: schema (`subjectKind: circle`, `by_circle`, `systemEvent`, `muted`), `openCircleThread`, subscriber sync on circle events, joinedAt floors, `projectThreadMember`, block-in-group behaviour (`authorBlockedByMe`, unread exclusion), `setThreadMuted`, inbox circle subject, contracts | G2, G3, A2, A3, #152                                | New `circleThreads.test.ts`: member-only open; idempotent; non-member/ex-member get `ThreadNotFound`/`NotParticipant`; history floor at join; removal hides thread; re-join floor; blocked-author collapse for blocker only; B still sees A named; muted excluded from badge; 50 cap |
| G5  | **feat(notifications): per-thread grouping of `message_received`, push tag + throttle, `circle_message_received` type with delayed email digest, mute honoured** (full enum fan-out)                                                                                                                                                   | G4                                                  | Grouping tests (merge within window, actorCount), throttle test with fake clock, scheduled digest fires once and is skipped when read, mute suppresses all channels, blocked actor dropped                                                                                           |
| G6  | **feat(web): circle chat UI**: inbox row, header line, members Sheet, author labels/avatars in runs, system rows, blocked-author placeholder, entry points (circles page, inbox New menu), mute/leave; en/nl/source                                                                                                                    | G4 (G5 for mute copy)                               | Component tests (row snippet prefix, header count, placeholder Show); manual on dev :3001 at 375 px and desktop (Docker CDP per memory)                                                                                                                                              |
| G7  | **feat(conversation): typing indicators** backend (`typingIndicators`, `setTyping`/`clearTyping`/`getTyping`, clear in `postMessage`, block/invisible no-ops) + web line with throttle                                                                                                                                                 | G1, A2 (G4 for circle projection, or ship DM-first) | `typing.test.ts`: participant-only, 2 s server throttle no-write, blocked pair no-op, invisible no-op, ageMs, cleared on send; hook unit test with fake timers                                                                                                                       |
| G8  | **feat(presence): visibility rule + settings**: domain `canSeePresence` + `effectiveStatus` (Stryker), `presencePreferences`, rooms `app:online`/`app:away` allowlist, `getPresenceOf`, `setPresencePreferences`                                                                                                                       | G0, A2                                              | Domain specs (every clause); backend tests: non-mutual sees nothing, private profile, blocked, invisible, reciprocity, away override, 50-id cap, no `lastDisconnected` in output                                                                                                     |
| G9  | **feat(web): presence UI**: activity-aware `usePresence` mounting, dots on DM rows/header/members sheet, status menu, sharing toggle on Privacy & safety, one-time prompt; en/nl/source                                                                                                                                                | G8, A5                                              | Component tests (dot labels, idle switch with fake timers); manual multi-tab check                                                                                                                                                                                                   |
| G10 | **docs(privacy): privacy page, Terms and DPIA entries; account-deletion purge of participant/typing/presence data**                                                                                                                                                                                                                    | G4, G7, G8, attachments PR 13                       | Purge test (rows gone, component rows removed, circle messages show deleted member)                                                                                                                                                                                                  |

**Stacks:**

- **S1 (groups):** G1 → G3 → G4 → G5 → G6. G2 is a separate one-PR stack that must merge before G4. S1 waits for A2/A3 and #152 before G4.
- **S2 (live signals):** G0 (merge now) → G8 → G7 → G9. G7 can go DM-first right after G1 and A2; it then only needs circle projection once G4 lands, a one-line follow-up.
- G10 closes both.

**Suggested order** to keep each review small:

1. G0
2. G1
3. G2
4. (A2, A3, #152 land)
5. G3
6. G4
7. G7
8. G8
9. G5
10. G6
11. G9
12. G10

---

## 8. Open product questions (each with a recommended default; the defaults are applied above)

1. **v1 circle-only?** Yes. Ad-hoc groups need an invite/accept model and their own identity-reveal rule; defer.
2. **Who may post in a circle thread?** Every member, whatever their permission level (ViewOnly/Exchange/Admin govern copies, not chat).
3. **Chat on by default for every circle?** Yes, created lazily on first open or post. No per-circle toggle in v1.
4. **History for newly added members:** from their join time only (also after re-joining).
5. **Leaving or being removed:** lose access to the whole thread. Their past messages stay for the group, shown by standard identity rules (possibly "Former member").
6. **Adding people to circles without consent:** v1 ships "Leave circle" and "Mute". Also recommended: limit `addMember` to people the admin is already connected to by mutual follow (not the circle clause), to stop stranger-adds into a group chat. An invite/accept flow follows later.
7. **Group size cap:** 50 members per circle.
8. **Blocking inside a shared circle:** the blocker sees the blocked member's messages collapsed ("Show"), gets no unread or notifications from them, and sees no typing or presence. The blocked member sees everything normally (the block stays silent), and the circle rule keeps the blocker's name visible to them.
9. **Muted threads in the shell unread badge:** excluded. The row shows a grey count.
10. **Notifications for circle messages:** a new type `circle_message_received`, in-app + push on, email off by default; when on, a delayed digest (30 min, at most one per thread per 6 h). In-app rows are grouped per thread for DMs too.
11. **Presence visibility:** mutual followers only, opt-in (one-time prompt), reciprocal (don't share → don't see). Circle membership alone does not reveal presence.
12. **Override options:** Automatic / Away / Appear offline. No forced "Online". Persistent until changed.
13. **Does "Appear offline" also suppress typing?** Yes.
14. **Typing visibility:** shown to every participant of the thread (including non-mutual exchange partners and circle-mates), never across a block. It doesn't need presence sharing.
15. **"Last seen":** not shown in v1, and never stored beyond the component's internal row (purged on account deletion).
16. **Automatic away/offline:** Away after 5 min idle on a visible tab; Offline when the tab is hidden or the app backgrounded (~75 s on a crash).
17. **Join/leave system rows in the circle thread:** yes ("Anna joined", "Anna left" / "Anna was removed", without naming the remover).
18. **Circle deletion** (not built yet): when built, it deletes the chat with the circle after a named confirmation; evidence holds and report snapshots survive.
19. **Convex plan:** which plan is prod on? On Free, the ~0.8M extra calls/month at 100 DAU (plus ~0.5–0.8 GB bandwidth) use most of the allowance. Recommended: Professional, or keep presence to thread headers only.
20. **Exchange threads:** stay strictly two-party; no group trades.
21. **When does a circle thread appear in the inbox?** Once it has a message (or the viewer opened it). The circles page always offers "Open group chat".

---

## E. Email invitations

Out of scope for this design; tracked separately.
