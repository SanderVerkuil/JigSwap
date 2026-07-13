# Presence-Aware Message Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppress bell/email/push for `message_received` when the recipient is on the messages page, replacing them with an in-tab toast.

**Architecture:** `@convex-dev/presence` (the repo's FIRST Convex component) heartbeats a `"messages"` room from the `/messages` route layout; the `MessagePosted` subscriber drops recipients who are online in that room via a fail-open gate; a client-side watcher toasts for messages landing in non-active threads. Spec: `docs/superpowers/specs/2026-07-14-presence-aware-message-notifications-design.md`.

**Tech Stack:** `@convex-dev/presence` (+ `/react` hook), Convex components (`convex.config.ts`), TanStack Router layout route, sonner.

**Branch/PR:** land on `feat/ahasend-transactional-email` (PR #64), worktree `/home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/ahasend-email`. Same repo conventions as the categories plan (prettier, `--skip-nx-cache`, backend `coverage` target, Co-Authored-By trailer).

**Component API facts (verified against get-convex/presence source):**

- `new Presence(components.presence)`; methods take `ctx` first.
- `heartbeat(ctx, roomId, userId, sessionId, interval) → {roomToken, sessionToken}`
- `list(ctx, roomToken, limit?) → Array<{userId, online, lastDisconnected, data?}>`
- `listUser(ctx, userId, onlineOnly?, limit?) → Array<{roomId, online, lastDisconnected}>`
- `disconnect(ctx, sessionToken) → null`
- React: `usePresence(presenceApi, roomId, userId)` from `@convex-dev/presence/react`, where `presenceApi` is an object exposing `heartbeat`, `list`, `disconnect` function references.

---

### Task B1: Component setup + auth-gated presence module

**Files:**

- Modify: `packages/backend/package.json` (add `@convex-dev/presence`)
- Create: `packages/backend/convex/convex.config.ts`
- Create: `packages/backend/convex/presence.ts`
- Modify: `packages/backend/convex/_generated/*` via codegen (see Step 3)
- Modify: `packages/gateway/src/operations.ts` (new `presence` group)

- [ ] **Step 1: Install** — `pnpm --filter @jigswap/backend add @convex-dev/presence` (report the resolved version).

- [ ] **Step 2: Register the component** — `packages/backend/convex/convex.config.ts`:

```ts
import presence from "@convex-dev/presence/convex.config.js";
import { defineApp } from "convex/server";

// The repo's first Convex component. Presence powers ONE thing today: suppressing
// message_received notifications for members who are already on the messages page
// (see notifications/presenceGate.ts and the design spec).
const app = defineApp();
app.use(presence);

export default app;
```

- [ ] **Step 3: Codegen** — from `packages/backend`: `pnpm exec convex codegen`. This must add the `components` export to `_generated`. If codegen refuses to run without a configured deployment, try `pnpm exec convex codegen --init` style flags per `--help`; if it genuinely cannot run offline, STOP and report BLOCKED with the exact error (the coordinator will run it against the dev deployment) — do NOT hand-fabricate component types.

- [ ] **Step 4: Presence module** — `packages/backend/convex/presence.ts`:

```ts
import { Presence } from "@convex-dev/presence";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./identity/requireMember";

// The one presence room JigSwap uses: "member is somewhere on /messages". Presence exists to
// suppress out-of-band message notifications for people already looking at the messages surface —
// not as a general who's-online feature (YAGNI).
export const MESSAGES_ROOM = "messages";

export const presence = new Presence(components.presence);

// Heartbeat from the messages layout. The member id comes from auth — the client-supplied
// userId is only validated against it so the shared usePresence hook keeps working; nobody can
// heartbeat someone else into invisibility of notifications.
export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  handler: async (ctx, { roomId, userId, sessionId, interval }) => {
    const memberId = await requireMember(ctx);
    if (roomId !== MESSAGES_ROOM)
      throw new ConvexError("Unknown presence room");
    if (userId !== (memberId as string))
      throw new ConvexError("Presence user mismatch");
    return presence.heartbeat(
      ctx,
      roomId,
      memberId as string,
      sessionId,
      interval,
    );
  },
});

// Room-token-scoped read used by the usePresence hook; the token is the capability.
export const list = query({
  args: { roomToken: v.string() },
  handler: (ctx, { roomToken }) => presence.list(ctx, roomToken),
});

// Graceful disconnect via sendBeacon; the session token is the capability (no auth context
// available on beacons).
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: (ctx, { sessionToken }) => presence.disconnect(ctx, sessionToken),
});
```

- [ ] **Step 5: Gateway** — in `packages/gateway/src/operations.ts` add a top-level group (alphabetical placement consistent with the file):

```ts
  // Presence (messages page): heartbeat/list/disconnect consumed by @convex-dev/presence's
  // usePresence hook; used to suppress message notifications for members already viewing.
  presence: {
    heartbeat: api.presence.heartbeat,
    list: api.presence.list,
    disconnect: api.presence.disconnect,
  },
```

- [ ] **Step 6: Verify** — `pnpm nx run-many -t type-check -p @jigswap/backend @jigswap/gateway --skip-nx-cache` → PASS; full backend suite `pnpm nx run @jigswap/backend:coverage --skip-nx-cache` → PASS (convex-test may need the component registered — if any EXISTING test now fails because of `convex.config.ts`, investigate `convexTest(...).registerComponent` per convex-test docs and report what was needed).

- [ ] **Step 7: Format + commit**

```bash
pnpm prettier --write packages/backend/convex packages/gateway/src packages/backend/package.json
git add packages/backend packages/gateway/src pnpm-lock.yaml
git commit -m "feat(backend): @convex-dev/presence component with auth-gated messages-room wrappers"
```

---

### Task B2: Fail-open presence gate + MessagePosted suppression

**Files:**

- Create: `packages/backend/convex/notifications/presenceGate.ts`
- Modify: `packages/backend/convex/notifications/subscriber.ts` (MessagePosted case only)
- Test: `packages/backend/convex/presenceGate.test.ts`

- [ ] **Step 1: Failing test** — `presenceGate.test.ts` (pure unit test with an injected lister; no convex-test needed):

```ts
import { describe, expect, it, vi } from "vitest";
import { isViewingMessages } from "./notifications/presenceGate";

const ctx = {} as never;

describe("isViewingMessages", () => {
  it("true when the user is online in the messages room", async () => {
    const lister = vi
      .fn()
      .mockResolvedValue([
        { roomId: "messages", online: true, lastDisconnected: 0 },
      ]);
    expect(await isViewingMessages(ctx, "user-1", lister)).toBe(true);
  });

  it("false when online only in other rooms or offline", async () => {
    const lister = vi
      .fn()
      .mockResolvedValue([
        { roomId: "other", online: true, lastDisconnected: 0 },
      ]);
    expect(await isViewingMessages(ctx, "user-1", lister)).toBe(false);
    const offline = vi.fn().mockResolvedValue([]);
    expect(await isViewingMessages(ctx, "user-1", offline)).toBe(false);
  });

  it("fails open: a presence error means NOT viewing (deliver notifications)", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("component down"));
    expect(await isViewingMessages(ctx, "user-1", boom)).toBe(false);
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement** — `presenceGate.ts`:

```ts
import type { MutationCtx } from "../_generated/server";
import { MESSAGES_ROOM, presence } from "../presence";

type RoomEntry = { roomId: string; online: boolean; lastDisconnected: number };
type Lister = (ctx: MutationCtx, userId: string) => Promise<RoomEntry[]>;

const componentLister: Lister = (ctx, userId) =>
  presence.listUser(ctx, userId, true);

// Is this member currently on the messages page? Powers the message_received suppression
// (design spec 2026-07-14): a present recipient gets NO bell/email/push — the open tab's live
// UI + toast is the notification. FAIL-OPEN: any presence hiccup answers "no", because a
// spurious notification beats a silently swallowed one, and a throw here would poison the
// dispatch transaction (retried forever).
export const isViewingMessages = async (
  ctx: MutationCtx,
  userId: string,
  lister: Lister = componentLister,
): Promise<boolean> => {
  try {
    const rooms = await lister(ctx, userId);
    return rooms.some((room) => room.roomId === MESSAGES_ROOM && room.online);
  } catch (error) {
    console.warn(
      `presence check failed (${String(error)}); delivering notifications`,
    );
    return false;
  }
};
```

- [ ] **Step 3: Wire the subscriber** — in `subscriber.ts`'s `MessagePosted` case, after building the recipient list and author params, drop present recipients (keep everything else identical):

```ts
    case "MessagePosted": {
      const authorId = p.authorId as string | null;
      if (authorId === null || authorId === undefined) return [];
      const thread = await loadThread(ctx, p.threadId as string);
      if (!thread) return [];
      const author = await memberName(ctx, authorId);
      const recipients = thread.participants.filter(
        (participant) => (participant as string) !== authorId,
      );
      // Presence suppression: a recipient already on /messages sees the message live (plus an
      // in-tab toast) — creating a bell row or emailing them would double-notify. Fail-open:
      // a presence error delivers normally.
      const absent: typeof recipients = [];
      for (const participant of recipients) {
        if (!(await isViewingMessages(ctx, participant as string))) {
          absent.push(participant);
        }
      }
      return absent.map((participant) =>
        cmd(participant, "message_received", thread.aggregateId, author),
      );
    }
```

Import `isViewingMessages` from `./presenceGate`.

- [ ] **Step 4: Existing-test impact** — run `pnpm nx run @jigswap/backend:coverage --skip-nx-cache`. Tests that assert a `message_received` notification is created will now hit the real `componentLister` inside convex-test. If the component isn't registered in the harness, the call will throw → fail-open → tests keep passing (the gate answers "not viewing"). If instead convex-test errors hard on the unknown component reference, register the component in the test harness (see convex-test's `registerComponent`) or report exactly what breaks as DONE_WITH_CONCERNS. Do not weaken existing assertions.

- [ ] **Step 5: Format + commit**

```bash
pnpm prettier --write packages/backend/convex
git add packages/backend/convex
git commit -m "feat(backend): suppress message notifications for members on the messages page"
```

---

### Task B3: Web — presence heartbeat + toast watcher on the messages layout

**Files:**

- Create: `apps/web/src/routes/_dashboard/messages/route.tsx` (layout route with `<Outlet />`)
- Possibly create: a tiny backend query + gateway entry for the member's own id IF none exists (see Step 1)
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json` (toast copy)

READ FIRST: `apps/web/src/routes/_dashboard/messages/index.tsx` and `$threadId.tsx` in full (thread-list query shape, route params, how names are displayed), plus `packages/gateway/src/operations.ts`'s identity/social groups.

- [ ] **Step 1: Member id source** — the presence hook needs the member's users `_id` as a string. Grep the gateway (`grep -n "identity\|viewer\|me:" packages/gateway/src/operations.ts`) for an existing "current member" query returning it. If none returns the raw `_id`, create `packages/backend/convex/identity/myMemberId.ts`:

```ts
import { query } from "../_generated/server";
import { requireMember } from "./requireMember";

// The caller's member id (users._id) as an opaque string — exists for client libraries that
// need a stable self-identifier (the presence hook); everything authorization-related keeps
// deriving the member server-side.
export const myMemberId = query({
  args: {},
  handler: async (ctx) => (await requireMember(ctx)) as string,
});
```

plus codegen/api entry and a gateway entry `identity: { ..., myMemberId: api.identity.myMemberId.myMemberId }` (match the existing identity group's naming).

- [ ] **Step 2: Layout route** — `apps/web/src/routes/_dashboard/messages/route.tsx` (TanStack Router: a `route.tsx` in a directory wraps that directory's routes; verify against an existing layout route in the repo — `grep -rln "createFileRoute" apps/web/src/routes/_dashboard | head` and mirror conventions):

```tsx
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { usePresence } from "@convex-dev/presence/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/messages")({
  component: MessagesLayout,
});

function MessagesLayout() {
  const memberId = useQuery(convexQuery(gateway.identity.myMemberId, {})).data;
  return (
    <>
      {memberId ? <MessagesPresence memberId={memberId} /> : null}
      <MessageToastWatcher />
      <Outlet />
    </>
  );
}

// Isolated so the hook only runs once the member id is known (hooks can't be conditional).
function MessagesPresence({ memberId }: { memberId: string }) {
  usePresence(gateway.presence, "messages", memberId);
  return null;
}
```

(Adapt `gateway.identity.myMemberId` to whatever Step 1 resolved. If the router's generated route tree complains, run the dev route-gen step the repo uses — check how routeTree.gen.ts is produced, likely automatic via the vite plugin during `pnpm nx build/dev @jigswap/web`; type-check noise from routeTree.gen is a known ignorable.)

- [ ] **Step 3: Toast watcher** — same file. Behavioral contract (adapt to the actual thread-list query read in READ FIRST):

1. Subscribe to the same thread-list query the messages index uses.
2. Keep a `useRef<Map<threadId, latestMessageStamp>>`; on every update, compare against the previous map, SKIPPING the first load (ref empty ⇒ just populate).
3. For each thread whose stamp advanced AND whose latest message is not authored by the viewer AND whose id ≠ the currently open thread (`useParams` from the `$threadId` route, undefined on the index), fire `toast(t("newMessageToast", { name }))` with sonner's `action: { label: t("newMessageToastOpen"), onClick: () => navigate(...) }` navigating to `/messages/$threadId`.
4. Then update the ref map.

- [ ] **Step 4: Locale keys** — under `notifications` in en/nl/source:

```json
"newMessageToast": "New message from {name}",
"newMessageToastOpen": "Open"
```

nl: `"newMessageToast": "Nieuw bericht van {name}", "newMessageToastOpen": "Openen"`.

- [ ] **Step 5: Verify** — `pnpm nx run-many -t type-check lint -p @jigswap/web --skip-nx-cache` → PASS; locale JSON validity check; `pnpm nx build @jigswap/web --skip-nx-cache 2>&1 | tail -5` (build success; Clerk prerender noise is a known local condition).

- [ ] **Step 6: Format + commit**

```bash
pnpm prettier --write apps/web/src apps/web/locales
git add apps/web/src apps/web/locales packages/backend/convex packages/gateway/src
git commit -m "feat(web): messages-page presence heartbeat and in-tab new-message toast"
```

---

### Task B4: Feature B verification sweep + push + PR

- [ ] Full gates (same list as the categories plan's Task A5) — all PASS.
- [ ] Push: `git push` (branch already tracks origin; PR #64).
- [ ] Watch CI: `gh pr checks 64 --watch` (or poll) until green; diagnose and fix any failure (note: the Vercel preview build runs `convex deploy` against the preview — the new component deploys there; a component-related deploy failure surfaces in the Vercel check).
- [ ] Update the PR body: append a "Notification UX follow-ups" section summarizing both features (categories matrix + presence suppression/toast), the new `@convex-dev/presence` dependency (first Convex component, `convex.config.ts`), and the new specs/plans under docs/superpowers/.
