# AhaSend Transactional Email + Localized Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver transactional email for 12 high-value notification types through AhaSend, with notifications storing structured `type` + `params` rendered at the edges (web in viewer locale, email in recipient's en/nl `preferredLanguage`).

**Architecture:** Notifications stop persisting pre-rendered English `title`/`message`; the subscriber emits structured `params` instead. A new `@jigswap/email` package renders react-email templates per type/locale; a new AhaSend adapter behind the existing `EmailSender` port sends via `fetch`. Push keeps English copy via a backend string table. Spec: `docs/superpowers/specs/2026-07-13-ahasend-transactional-email-design.md`.

**Tech Stack:** Convex (packages/backend/convex), pure-TS domain (packages/domain), react-email + @react-email/render (new packages/email), TanStack Start web app (apps/web), vitest, Nx + pnpm workspace.

**Repo conventions that apply to every task:**

- Run `pnpm prettier --write <changed files>` before every commit (CI runs `format:check` first).
- Nx caching hides fresh failures: verification commands use `--skip-nx-cache`.
- Backend has NO `test` Nx target — its vitest target is `coverage`. Single-file runs: `pnpm --filter @jigswap/backend exec vitest run <file>`.
- Backend tsconfig has `noPropertyAccessFromIndexSignature`: access `Record<string, string>` values with brackets (`p["actorName"]`), never dots.
- Never name a backend local `use[A-Z]…` (trips react-hooks lint).
- All work happens in this worktree: `/home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/phase-1-member-profile`.

**Deviation from spec, agreed rationale:** instead of 12 near-identical react-email component files, `packages/email` has ONE shared `NotificationEmail` component + a per-type/per-locale copy catalog. Same per-type output, far less duplication.

---

### Task 1: Domain — `params` on Notification and NotifyMemberCommand

`title`/`message` become optional (legacy rows still rehydrate); `params` is added everywhere. Removal of `title`/`message` from the create path happens in Task 10, after the backend has migrated — this keeps every intermediate commit compiling.

**Files:**

- Modify: `packages/domain/src/notifications/domain/notification.ts`
- Modify: `packages/domain/src/notifications/application/ports/in/notify-member.port.ts`
- Modify: `packages/domain/src/notifications/application/use-cases/notify-member.ts`
- Test: `packages/domain/src/notifications/domain/notification.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `describe` in `packages/domain/src/notifications/domain/notification.spec.ts` (match the file's existing fixture style — it already creates notifications; copy an existing `Notification.create({...})` call and extend it):

```ts
it("carries params through create/toState/rehydrate", () => {
  const notification = Notification.create({
    id: toNotificationId("n-1"),
    userId: toMemberId("alice"),
    type: "trade_request",
    params: { actorName: "Bob" },
    channel: "inApp",
    now: new Date("2026-06-08T10:00:00Z"),
  });
  expect(notification.toState().params).toEqual({ actorName: "Bob" });
  const rehydrated = Notification.rehydrate(notification.toState());
  expect(rehydrated.toState().params).toEqual({ actorName: "Bob" });
});
```

(If the spec file's existing create fixtures pass `title`/`message`, leave those fixtures untouched — the fields stay accepted until Task 10.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jigswap/domain exec vitest run src/notifications/domain/notification.spec.ts`
Expected: FAIL — TS error: `params` does not exist / `title` is missing in `CreateNotificationProps`.

- [ ] **Step 3: Implement**

In `packages/domain/src/notifications/domain/notification.ts`:

```ts
// Input to Notification.create(): the structured notification plus its addressing. `params` carries
// the render-ready values for this type's copy (e.g. actorName, puzzleTitle); rendering happens at
// the EDGES (web in the viewer's locale, email in the recipient's language) — never here.
// `title`/`message` are transitional (legacy pre-rendered copy) and are removed once the backend
// subscriber emits params. `relatedId` points at the upstream entity as an opaque string.
export interface CreateNotificationProps {
  readonly id: NotificationId;
  readonly userId: MemberId;
  readonly type: NotificationType;
  readonly title?: string;
  readonly message?: string;
  readonly params?: Readonly<Record<string, string>>;
  readonly relatedId?: string;
  readonly channel: Channel;
  readonly now: Date;
}
```

In `NotificationState`, change `title`/`message` to optional and add `params` (legacy rows carry strings, new rows carry params):

```ts
  readonly title?: string;
  readonly message?: string;
  readonly params?: Readonly<Record<string, string>>;
```

In `Notification.create`, thread the new field through (title/message stay pass-through until Task 10):

```ts
const notification = new Notification({
  id: props.id,
  userId: props.userId,
  type: props.type,
  title: props.title,
  message: props.message,
  params: props.params,
  relatedId: props.relatedId,
  channel: props.channel,
  isRead: false,
  createdAt: props.now,
});
```

In `packages/domain/src/notifications/application/ports/in/notify-member.port.ts`, make `title`/`message` optional and add `params`:

```ts
export interface NotifyMemberCommand {
  readonly memberId: MemberId;
  readonly type: NotificationType;
  readonly title?: string;
  readonly message?: string;
  readonly params?: Readonly<Record<string, string>>;
  readonly relatedId?: string;
  readonly channels?: readonly Channel[];
}
```

In `packages/domain/src/notifications/application/use-cases/notify-member.ts`, extend the `Notification.create` call:

```ts
const notification = Notification.create({
  id: deps.notificationIds.next(),
  userId: cmd.memberId,
  type: cmd.type,
  title: cmd.title,
  message: cmd.message,
  params: cmd.params,
  relatedId: cmd.relatedId,
  channel,
  now,
});
```

- [ ] **Step 4: Run domain tests**

Run: `pnpm nx test @jigswap/domain --skip-nx-cache`
Expected: PASS (all existing specs still compile because title/message are optional, new spec passes).

- [ ] **Step 5: Type-check backend (must still compile — nothing removed yet)**

Run: `pnpm nx type-check @jigswap/backend --skip-nx-cache`
Expected: PASS.

- [ ] **Step 6: Format and commit**

```bash
pnpm prettier --write packages/domain/src/notifications
git add packages/domain/src/notifications
git commit -m "feat(domain): notifications carry structured params; title/message optional"
```

---

### Task 2: Domain — EMAIL_ELIGIBLE_TYPES and email-channel gating

**Files:**

- Modify: `packages/domain/src/notifications/domain/notification-type.ts`
- Modify: `packages/domain/src/notifications/application/use-cases/notify-member.ts`
- Test: `packages/domain/src/notifications/application/use-cases/notify-member.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `notify-member.spec.ts` (uses the file's existing fixtures — `alice`, `NOW`, `prefId`, `deps`, `cmd`):

```ts
it("never delivers email for a type outside EMAIL_ELIGIBLE_TYPES, even when opted in", async () => {
  const pref = NotificationPreference.createDefault(prefId(), alice, NOW);
  pref.enable("puzzle_approved", "email", NOW);
  pref.pullEvents();
  await preferences.save(pref);

  const notifyMember = makeNotifyMember(deps);
  const result = await notifyMember(cmd({ type: "puzzle_approved" as const }));

  expect(result.isOk).toBe(true);
  // Only inApp delivers — email is ineligible for moderation outcomes regardless of preference.
  expect(delivery.channels()).toEqual(["inApp"]);
});

it("still delivers email for an eligible type when opted in", async () => {
  const pref = NotificationPreference.createDefault(prefId(), alice, NOW);
  pref.enable("message_received", "email", NOW);
  pref.pullEvents();
  await preferences.save(pref);

  const notifyMember = makeNotifyMember(deps);
  await notifyMember(cmd({ type: "message_received" as const }));
  expect(delivery.channels().sort()).toEqual(["email", "inApp"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jigswap/domain exec vitest run src/notifications/application/use-cases/notify-member.spec.ts`
Expected: first new test FAILS (email is delivered for puzzle_approved).

- [ ] **Step 3: Implement**

Append to `packages/domain/src/notifications/domain/notification-type.ts`:

```ts
// Types that may be delivered by EMAIL. Deliberately a subset: only high-value, act-on-it
// notifications (trade lifecycle, messages, social) earn an inbox interruption; moderation and
// admin outcomes stay in-app/push. NotifyMember gates the email channel on this set REGARDLESS of
// stored preferences, so widening email coverage is an explicit product decision here — the web
// preference matrix mirrors this set (apps/web notification-meta.ts) to grey out the switches.
export const EMAIL_ELIGIBLE_TYPES: ReadonlySet<NotificationType> = new Set([
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_completed",
  "trade_cancelled",
  "message_received",
  "review_received",
  "puzzle_favorited",
  "goal_achieved",
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
]);
```

In `notify-member.ts`, import `EMAIL_ELIGIBLE_TYPES` from `../../domain` and gate the filter:

```ts
const candidates: readonly Channel[] = cmd.channels ?? CHANNELS;
const allowed = candidates.filter(
  (channel) =>
    (channel !== "email" || EMAIL_ELIGIBLE_TYPES.has(cmd.type)) &&
    preference.allows(cmd.type, channel),
);
```

- [ ] **Step 4: Run domain tests**

Run: `pnpm nx test @jigswap/domain --skip-nx-cache`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm prettier --write packages/domain/src/notifications
git add packages/domain/src/notifications
git commit -m "feat(domain): gate email channel to EMAIL_ELIGIBLE_TYPES"
```

---

### Task 3: Backend — schema `params` column + mapper

**Files:**

- Modify: `packages/backend/convex/schema.ts` (notifications table, ~line 712)
- Modify: `packages/backend/convex/notifications/adapters/notificationMapper.ts`
- Test: `packages/backend/convex/notificationsParams.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/convex/notificationsParams.test.ts` (pure mapper round-trip; no convex-test needed):

```ts
import { Notification, toMemberId, toNotificationId } from "@jigswap/domain";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import { toDomain, toRow } from "./notifications/adapters/notificationMapper";

const NOW = new Date("2026-07-13T10:00:00Z");

describe("notificationMapper params", () => {
  it("round-trips params through toRow/toDomain", () => {
    const notification = Notification.create({
      id: toNotificationId("n-1"),
      userId: toMemberId("user-1"),
      type: "trade_request",
      params: { actorName: "Bob" },
      relatedId: "exchange-1",
      channel: "inApp",
      now: NOW,
    });
    const row = toRow(notification);
    expect(row.params).toEqual({ actorName: "Bob" });
    expect(row.title).toBeUndefined();

    const doc = {
      ...row,
      _id: "doc-1" as Id<"notifications">,
      _creationTime: NOW.getTime(),
    } as Doc<"notifications">;
    expect(toDomain(doc).toState().params).toEqual({ actorName: "Bob" });
  });

  it("rehydrates a legacy row (title/message strings, no params)", () => {
    const doc = {
      _id: "doc-2" as Id<"notifications">,
      _creationTime: NOW.getTime(),
      aggregateId: "n-2",
      userId: "user-1" as Id<"users">,
      type: "trade_request",
      title: "New Exchange Request",
      message: "Someone wants to trade for one of your puzzles",
      channel: "inApp",
      isRead: false,
      createdAt: NOW.getTime(),
    } as Doc<"notifications">;
    const state = toDomain(doc).toState();
    expect(state.title).toBe("New Exchange Request");
    expect(state.params).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jigswap/backend exec vitest run convex/notificationsParams.test.ts`
Expected: FAIL — `params` not on `NotificationRow` / type error.

- [ ] **Step 3: Implement schema change**

In `packages/backend/convex/schema.ts`, in the `notifications` table replace:

```ts
    title: v.string(),
    message: v.string(),
```

with:

```ts
    // Legacy pre-rendered English copy. Optional since notifications went structured: new rows
    // store `params` and the edges render copy (web via i18n keys, email via @jigswap/email).
    title: v.optional(v.string()),
    message: v.optional(v.string()),
    // Render-ready values for the type's copy (e.g. actorName, puzzleTitle). Flat string map;
    // the per-type key contract lives with the subscriber (notifications/copy.ts documents it).
    params: v.optional(v.record(v.string(), v.string())),
```

- [ ] **Step 4: Implement mapper change**

In `notificationMapper.ts`, add `params` to both directions:

In `toDomain`'s `NotificationState`:

```ts
    title: row.title,
    message: row.message,
    params: row.params,
```

In `toRow`'s return:

```ts
    title: state.title,
    message: state.message,
    params: state.params,
```

(Convex strips `undefined` fields on write, so new rows simply omit title/message — see the value-normalization note in CLAUDE-adjacent memory: never compare stored vs in-memory objects without canonicalizing.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @jigswap/backend exec vitest run convex/notificationsParams.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check backend and web**

Run: `pnpm nx run-many -t type-check -p @jigswap/backend @jigswap/web --skip-nx-cache`
Expected: PASS backend. If `@jigswap/web` fails because `notification-meta.ts`'s `NotificationRow` declares `title: string` against now-optional doc fields, that fix lands in Task 11 — only acceptable failure is in web; note it and continue. (web type-check also emits known routeTree.gen noise — ignore per repo convention.)

- [ ] **Step 7: Format and commit**

```bash
pnpm prettier --write packages/backend/convex/schema.ts packages/backend/convex/notifications packages/backend/convex/notificationsParams.test.ts
git add packages/backend/convex/schema.ts packages/backend/convex/notifications packages/backend/convex/notificationsParams.test.ts
git commit -m "feat(backend): notifications store structured params; title/message optional"
```

---

### Task 4: Backend — English copy table (`renderNotificationText`)

The push channel (and nothing else) still needs server-rendered English strings. The literals move from the subscriber into one table covering all 21 types.

**Files:**

- Create: `packages/backend/convex/notifications/copy.ts`
- Test: `packages/backend/convex/notificationsCopy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/convex/notificationsCopy.test.ts`:

```ts
import { NOTIFICATION_TYPES } from "@jigswap/domain";
import { describe, expect, it } from "vitest";
import { renderNotificationText } from "./notifications/copy";

describe("renderNotificationText", () => {
  it("covers every notification type with a non-empty title and message", () => {
    for (const type of NOTIFICATION_TYPES) {
      const { title, message } = renderNotificationText(type, {});
      expect(title.length, type).toBeGreaterThan(0);
      expect(message.length, type).toBeGreaterThan(0);
    }
  });

  it("interpolates params", () => {
    expect(
      renderNotificationText("goal_achieved", { goalTitle: "100 puzzles" })
        .message,
    ).toBe('You reached your goal "100 puzzles"!');
    expect(
      renderNotificationText("trade_request", { actorName: "Bob" }).message,
    ).toBe("Bob wants to trade for one of your puzzles");
  });

  it("falls back gracefully when params are missing", () => {
    expect(renderNotificationText("trade_request", {}).message).toBe(
      "Someone wants to trade for one of your puzzles",
    );
    expect(renderNotificationText("proposal_rejected", {}).message).toBe(
      "Your suggested edit was declined",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jigswap/backend exec vitest run convex/notificationsCopy.test.ts`
Expected: FAIL — module `./notifications/copy` not found.

- [ ] **Step 3: Implement**

Create `packages/backend/convex/notifications/copy.ts`. The strings reproduce the pre-params subscriber wording exactly, upgraded with params where the subscriber provides them (params contract is documented per type):

```ts
import type { NotificationType } from "@jigswap/domain";

// English render table for notification copy, used ONLY where a server-side plain string is
// needed today: the push channel payload. Web renders localized copy from i18n keys; email
// renders localized copy in @jigswap/email. Push stays English by design (spec: localizing push
// is out of scope).
//
// Params contract (what the subscriber puts in `params`, all optional at render time):
//   actorName   — trade_request (initiator), message_received (author), new_follower (follower),
//                 follow_request_received (requester), follow_request_approved (target)
//   puzzleTitle — puzzle_approved/rejected, proposal_approved/rejected, admin_proposal_filed,
//                 admin_definition_submitted
//   goalTitle   — goal_achieved
//   reason      — proposal_rejected (moderator-entered, may be absent)

export interface NotificationText {
  readonly title: string;
  readonly message: string;
}

type Params = Readonly<Record<string, string>>;

const COPY: Record<NotificationType, (p: Params) => NotificationText> = {
  trade_request: (p) => ({
    title: "New Exchange Request",
    message: `${p["actorName"] ?? "Someone"} wants to trade for one of your puzzles`,
  }),
  trade_accepted: () => ({
    title: "Exchange Accepted",
    message: "Your trade request has been accepted!",
  }),
  trade_declined: () => ({
    title: "Exchange Declined",
    message: "Your trade request has been declined",
  }),
  trade_completed: () => ({
    title: "Exchange Completed",
    message: "Exchange has been marked as completed",
  }),
  trade_cancelled: () => ({
    title: "Exchange Cancelled",
    message: "Exchange request has been cancelled",
  }),
  message_received: (p) => ({
    title: "New message",
    message: p["actorName"]
      ? `${p["actorName"]} sent you a message`
      : "You have a new message",
  }),
  review_received: () => ({
    title: "New Review",
    message: "You received a new partner review",
  }),
  puzzle_favorited: () => ({
    title: "Puzzle Favorited",
    message: "Someone added one of your puzzles to their favorites",
  }),
  goal_achieved: (p) => ({
    title: "Goal Achieved",
    message: p["goalTitle"]
      ? `You reached your goal "${p["goalTitle"]}"!`
      : "You reached your goal!",
  }),
  puzzle_approved: (p) => ({
    title: "Puzzle Approved",
    message: p["puzzleTitle"]
      ? `Your submission "${p["puzzleTitle"]}" was approved`
      : "Your puzzle submission was approved",
  }),
  puzzle_rejected: (p) => ({
    title: "Puzzle Rejected",
    message: p["puzzleTitle"]
      ? `Your submission "${p["puzzleTitle"]}" was rejected`
      : "Your puzzle submission was rejected",
  }),
  photo_removed: () => ({
    title: "Photo Removed",
    message: "A moderator removed one of your puzzle photos",
  }),
  exchange_proposed: (p) => ({
    title: "New Exchange Request",
    message: `${p["actorName"] ?? "Someone"} wants to trade for one of your puzzles`,
  }),
  exchange_disputed: () => ({
    title: "Exchange Disputed",
    message: "The other party has flagged an issue with your exchange",
  }),
  proposal_approved: (p) => ({
    title: "Suggestion Applied",
    message: p["puzzleTitle"]
      ? `Your suggested edit to "${p["puzzleTitle"]}" was approved`
      : "Your suggested edit was approved",
  }),
  proposal_rejected: (p) => {
    const base = p["puzzleTitle"]
      ? `Your suggested edit to "${p["puzzleTitle"]}" was declined`
      : "Your suggested edit was declined";
    return {
      title: "Suggestion Declined",
      message: p["reason"] ? `${base}: ${p["reason"]}` : base,
    };
  },
  admin_proposal_filed: (p) => ({
    title: "Suggestion to Review",
    message: p["puzzleTitle"]
      ? `A member suggested an edit to "${p["puzzleTitle"]}"`
      : "A member suggested an edit to a catalogue puzzle",
  }),
  admin_definition_submitted: (p) => ({
    title: "Submission to Moderate",
    message: p["puzzleTitle"]
      ? `"${p["puzzleTitle"]}" awaits moderation`
      : "A new puzzle submission awaits moderation",
  }),
  new_follower: (p) => ({
    title: "New follower",
    message: p["actorName"]
      ? `${p["actorName"]} started following you`
      : "Someone started following you",
  }),
  follow_request_received: (p) => ({
    title: "Follow request",
    message: p["actorName"]
      ? `${p["actorName"]} asked to follow you`
      : "Someone asked to follow you",
  }),
  follow_request_approved: () => ({
    title: "Request approved",
    message: "Your follow request was approved",
  }),
};

export const renderNotificationText = (
  type: NotificationType,
  params: Params = {},
): NotificationText => COPY[type](params);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jigswap/backend exec vitest run convex/notificationsCopy.test.ts`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm prettier --write packages/backend/convex/notifications/copy.ts packages/backend/convex/notificationsCopy.test.ts
git add packages/backend/convex/notifications/copy.ts packages/backend/convex/notificationsCopy.test.ts
git commit -m "feat(backend): English notification copy table for server-side rendering"
```

---

### Task 5: Backend — push channel renders from the copy table

Must land BEFORE the subscriber stops writing `title`/`message` (Task 9), so push never sees empty strings.

**Files:**

- Modify: `packages/backend/convex/notifications/adapters/channels/pushChannel.ts`

- [ ] **Step 1: Implement**

Replace the scheduling body in `pushChannel.ts`:

```ts
import type { Notification } from "@jigswap/domain";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { renderNotificationText } from "../../copy";

// Web Push channel: schedules the out-of-band send (notifications/sendWebPush) after commit, which
// fans the notification out to every active push subscription of the recipient via VAPID. Copy is
// rendered HERE from the structured type+params (English-only by design — push localization is out
// of scope); the notification row itself carries no pre-rendered strings anymore. No-ops downstream
// when push is unconfigured or the member has no subscriptions.
export const pushChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
    const { title, message } = renderNotificationText(
      state.type,
      state.params ?? {},
    );
    await ctx.scheduler.runAfter(0, internal.notifications.sendWebPush.send, {
      userId: state.userId as unknown as Id<"users">,
      type: state.type as string,
      title,
      message,
      relatedId: state.relatedId,
    });
  };
```

- [ ] **Step 2: Type-check + run backend notification tests**

Run: `pnpm nx type-check @jigswap/backend --skip-nx-cache && pnpm --filter @jigswap/backend exec vitest run convex/notificationsCopy.test.ts convex/notificationsParams.test.ts`
Expected: PASS. Also run any existing push-related tests: `pnpm --filter @jigswap/backend exec vitest run convex/ --testNamePattern push` — expected PASS (rendered strings equal the old literals for events without params).

- [ ] **Step 3: Format and commit**

```bash
pnpm prettier --write packages/backend/convex/notifications/adapters/channels/pushChannel.ts
git add packages/backend/convex/notifications/adapters/channels/pushChannel.ts
git commit -m "feat(backend): push channel renders copy from type+params"
```

---### Task 6: New `@jigswap/email` package — react-email rendering

**Files:**

- Create: `packages/email/package.json`
- Create: `packages/email/project.json`
- Create: `packages/email/tsconfig.json`
- Create: `packages/email/vite.config.ts`
- Create: `packages/email/src/index.ts`
- Create: `packages/email/src/copy.ts`
- Create: `packages/email/src/urls.ts`
- Create: `packages/email/src/notification-email.tsx`
- Create: `packages/email/src/render.tsx`
- Test: `packages/email/src/render.test.ts`

- [ ] **Step 1: Scaffold the package**

`packages/email/package.json` (main points at src, matching `@jigswap/domain`; react pinned to the workspace version 19.2.7):

```json
{
  "name": "@jigswap/email",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`packages/email/project.json` (tagged `type:backend-adapter` so the backend may import it under `@nx/enforce-module-boundaries` — backend-adapter may only depend on domain/contracts/backend-adapter):

```json
{
  "name": "@jigswap/email",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "packages/email/src",
  "projectType": "library",
  "tags": ["type:backend-adapter", "scope:backend"],
  "targets": {
    "type-check": {
      "executor": "nx:run-commands",
      "options": { "command": "pnpm run type-check", "cwd": "packages/email" }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": { "command": "pnpm run test", "cwd": "packages/email" }
    },
    "coverage": {
      "executor": "nx:run-commands",
      "outputs": ["{workspaceRoot}/coverage/packages/email"],
      "options": { "command": "vitest run --coverage", "cwd": "packages/email" }
    }
  }
}
```

`packages/email/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "es2022",
    "jsx": "react-jsx",
    "noEmit": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

`packages/email/vite.config.ts`:

```ts
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { defineConfig } from "vite";

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/packages/email",
  plugins: [nxViteTsPaths()],
  test: {
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/packages/email",
      provider: "v8" as const,
      reporter: ["text", "html", "json-summary"],
    },
  },
}));
```

Install deps (exact react version matters — workspace runs one react):

```bash
pnpm --filter @jigswap/email add react@19.2.7 @react-email/components @react-email/render
pnpm --filter @jigswap/email add -D vitest @types/react
```

- [ ] **Step 2: Write the failing test**

Create `packages/email/src/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EMAIL_TYPES } from "./copy";
import { isEmailType, renderEmail } from "./render";

const BASE = "https://jigswap.site";

describe("renderEmail", () => {
  it("renders every eligible type in both locales", async () => {
    for (const type of EMAIL_TYPES) {
      for (const locale of ["en", "nl"] as const) {
        const email = await renderEmail({
          type,
          params: {},
          locale,
          baseUrl: BASE,
        });
        expect(email.subject.length, `${type}/${locale}`).toBeGreaterThan(0);
        expect(email.html, `${type}/${locale}`).toContain("JigSwap");
        expect(email.text.length, `${type}/${locale}`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolates params into subject and body", async () => {
    const email = await renderEmail({
      type: "message_received",
      params: { actorName: "Anna" },
      locale: "en",
      baseUrl: BASE,
      relatedId: "thread-1",
    });
    expect(email.subject).toBe("New message from Anna on JigSwap");
    expect(email.html).toContain("Anna");
    expect(email.html).toContain("https://jigswap.site/messages/thread-1");
  });

  it("falls back to a locale-appropriate default for a missing actorName", async () => {
    const en = await renderEmail({
      type: "new_follower",
      params: {},
      locale: "en",
      baseUrl: BASE,
    });
    expect(en.subject).toContain("Someone");
    const nl = await renderEmail({
      type: "new_follower",
      params: {},
      locale: "nl",
      baseUrl: BASE,
    });
    expect(nl.subject).toContain("Iemand");
  });

  it("builds the CTA from the base URL and per-type path", async () => {
    const email = await renderEmail({
      type: "trade_request",
      params: {},
      locale: "en",
      baseUrl: BASE,
    });
    expect(email.html).toContain(`${BASE}/trades`);
    // Footer always links to notification preferences.
    expect(email.html).toContain(`${BASE}/notifications`);
  });

  it("isEmailType narrows correctly", () => {
    expect(isEmailType("trade_request")).toBe(true);
    expect(isEmailType("admin_proposal_filed")).toBe(false);
  });
});
```

Run: `pnpm --filter @jigswap/email exec vitest run`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement the copy catalog**

Create `packages/email/src/copy.ts`. This is the localized (en/nl) copy for the 12 email-eligible types. Placeholders use `{param}`; missing params fall back per-locale (see DEFAULT_PARAMS):

```ts
// Localized email copy for the EMAIL-ELIGIBLE notification types. Kept in sync with the domain's
// EMAIL_ELIGIBLE_TYPES (packages/domain notification-type.ts) — a type listed there and missing
// here would fail renderEmail's exhaustive Record type. Hand-maintained (not Crowdin) per spec.
export const EMAIL_TYPES = [
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_completed",
  "trade_cancelled",
  "message_received",
  "review_received",
  "puzzle_favorited",
  "goal_achieved",
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
] as const;

export type EmailType = (typeof EMAIL_TYPES)[number];
export type EmailLocale = "en" | "nl";

export interface EmailCopy {
  readonly subject: string;
  readonly heading: string;
  readonly body: string;
  readonly cta: string;
}

// Locale-appropriate fallbacks merged UNDER params at render time, so copy may reference
// {actorName} even though a legacy or degenerate event carries none.
export const DEFAULT_PARAMS: Record<EmailLocale, Record<string, string>> = {
  en: { actorName: "Someone", goalTitle: "your goal", puzzleTitle: "a puzzle" },
  nl: { actorName: "Iemand", goalTitle: "je doel", puzzleTitle: "een puzzel" },
};

export const FOOTER: Record<EmailLocale, { text: string; linkLabel: string }> =
  {
    en: {
      text: "You are receiving this because email notifications are enabled for your JigSwap account.",
      linkLabel: "Manage notification preferences",
    },
    nl: {
      text: "Je ontvangt deze e-mail omdat e-mailmeldingen aanstaan voor je JigSwap-account.",
      linkLabel: "Meldingsvoorkeuren beheren",
    },
  };

export const EMAIL_COPY: Record<EmailType, Record<EmailLocale, EmailCopy>> = {
  trade_request: {
    en: {
      subject: "New trade request on JigSwap",
      heading: "New trade request",
      body: "{actorName} wants to trade for one of your puzzles.",
      cta: "View trade requests",
    },
    nl: {
      subject: "Nieuw ruilverzoek op JigSwap",
      heading: "Nieuw ruilverzoek",
      body: "{actorName} wil ruilen voor een van je puzzels.",
      cta: "Bekijk ruilverzoeken",
    },
  },
  trade_accepted: {
    en: {
      subject: "Your trade request was accepted",
      heading: "Trade request accepted",
      body: "Good news — your trade request has been accepted! Time to arrange the exchange.",
      cta: "View trades",
    },
    nl: {
      subject: "Je ruilverzoek is geaccepteerd",
      heading: "Ruilverzoek geaccepteerd",
      body: "Goed nieuws — je ruilverzoek is geaccepteerd! Tijd om de ruil te regelen.",
      cta: "Bekijk ruilen",
    },
  },
  trade_declined: {
    en: {
      subject: "Your trade request was declined",
      heading: "Trade request declined",
      body: "Unfortunately your trade request has been declined.",
      cta: "View trades",
    },
    nl: {
      subject: "Je ruilverzoek is afgewezen",
      heading: "Ruilverzoek afgewezen",
      body: "Helaas is je ruilverzoek afgewezen.",
      cta: "Bekijk ruilen",
    },
  },
  trade_completed: {
    en: {
      subject: "Your trade is complete",
      heading: "Trade completed",
      body: "Your exchange has been marked as completed. Enjoy the puzzle!",
      cta: "View trades",
    },
    nl: {
      subject: "Je ruil is afgerond",
      heading: "Ruil afgerond",
      body: "Jullie ruil is gemarkeerd als afgerond. Veel puzzelplezier!",
      cta: "Bekijk ruilen",
    },
  },
  trade_cancelled: {
    en: {
      subject: "A trade was cancelled",
      heading: "Trade cancelled",
      body: "A trade request involving you has been cancelled.",
      cta: "View trades",
    },
    nl: {
      subject: "Een ruil is geannuleerd",
      heading: "Ruil geannuleerd",
      body: "Een ruilverzoek waar jij bij betrokken bent is geannuleerd.",
      cta: "Bekijk ruilen",
    },
  },
  message_received: {
    en: {
      subject: "New message from {actorName} on JigSwap",
      heading: "New message",
      body: "{actorName} sent you a message on JigSwap.",
      cta: "Read message",
    },
    nl: {
      subject: "Nieuw bericht van {actorName} op JigSwap",
      heading: "Nieuw bericht",
      body: "{actorName} heeft je een bericht gestuurd op JigSwap.",
      cta: "Lees bericht",
    },
  },
  review_received: {
    en: {
      subject: "You received a new review",
      heading: "New review",
      body: "A trade partner left you a review.",
      cta: "View your profile",
    },
    nl: {
      subject: "Je hebt een nieuwe beoordeling ontvangen",
      heading: "Nieuwe beoordeling",
      body: "Een ruilpartner heeft een beoordeling voor je achtergelaten.",
      cta: "Bekijk je profiel",
    },
  },
  puzzle_favorited: {
    en: {
      subject: "Someone favorited your puzzle",
      heading: "Your puzzle was favorited",
      body: "A member added one of your puzzles to their favorites.",
      cta: "View puzzle",
    },
    nl: {
      subject: "Iemand heeft je puzzel als favoriet gemarkeerd",
      heading: "Je puzzel is favoriet gemaakt",
      body: "Een lid heeft een van je puzzels aan zijn favorieten toegevoegd.",
      cta: "Bekijk puzzel",
    },
  },
  goal_achieved: {
    en: {
      subject: "Goal achieved on JigSwap",
      heading: "Goal achieved",
      body: "You reached your goal “{goalTitle}”. Congratulations!",
      cta: "View goals",
    },
    nl: {
      subject: "Doel behaald op JigSwap",
      heading: "Doel behaald",
      body: "Je hebt je doel “{goalTitle}” behaald. Gefeliciteerd!",
      cta: "Bekijk doelen",
    },
  },
  new_follower: {
    en: {
      subject: "{actorName} started following you on JigSwap",
      heading: "New follower",
      body: "{actorName} started following you on JigSwap.",
      cta: "View people",
    },
    nl: {
      subject: "{actorName} volgt je nu op JigSwap",
      heading: "Nieuwe volger",
      body: "{actorName} is je gaan volgen op JigSwap.",
      cta: "Bekijk leden",
    },
  },
  follow_request_received: {
    en: {
      subject: "{actorName} wants to follow you on JigSwap",
      heading: "Follow request",
      body: "{actorName} asked to follow you. You can approve or decline the request.",
      cta: "Review request",
    },
    nl: {
      subject: "{actorName} wil je volgen op JigSwap",
      heading: "Volgverzoek",
      body: "{actorName} heeft gevraagd om je te volgen. Je kunt het verzoek goedkeuren of afwijzen.",
      cta: "Beoordeel verzoek",
    },
  },
  follow_request_approved: {
    en: {
      subject: "Your follow request was approved",
      heading: "Follow request approved",
      body: "{actorName} approved your follow request. You can now see their profile and puzzles.",
      cta: "View people",
    },
    nl: {
      subject: "Je volgverzoek is goedgekeurd",
      heading: "Volgverzoek goedgekeurd",
      body: "{actorName} heeft je volgverzoek goedgekeurd. Je kunt nu hun profiel en puzzels bekijken.",
      cta: "Bekijk leden",
    },
  },
};
```

- [ ] **Step 4: Implement CTA path mapping**

Create `packages/email/src/urls.ts` (mirrors `notificationHref` in apps/web notification-meta.ts for the eligible types):

```ts
import type { EmailType } from "./copy";

// Web-app path the email CTA deep-links to, mirroring the in-app notificationHref mapping
// (apps/web/src/components/notifications/notification-meta.ts). relatedId semantics per type are
// set by the backend subscriber: thread aggregateId for messages, puzzle id for favorites.
export const ctaPath = (type: EmailType, relatedId?: string): string => {
  switch (type) {
    case "trade_request":
    case "trade_accepted":
    case "trade_declined":
    case "trade_completed":
    case "trade_cancelled":
      return "/trades";
    case "message_received":
      return relatedId ? `/messages/${relatedId}` : "/messages";
    case "review_received":
      return "/profile";
    case "puzzle_favorited":
      return relatedId ? `/puzzles/${relatedId}` : "/puzzles";
    case "goal_achieved":
      return "/goals";
    case "new_follower":
    case "follow_request_received":
    case "follow_request_approved":
      return "/people";
  }
};
```

- [ ] **Step 5: Implement the shared email component**

Create `packages/email/src/notification-email.tsx`:

```tsx
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export interface NotificationEmailProps {
  readonly heading: string;
  readonly body: string;
  readonly ctaLabel: string;
  readonly ctaUrl: string;
  readonly footerText: string;
  readonly footerLinkLabel: string;
  readonly footerLinkUrl: string;
}

const styles = {
  body: {
    backgroundColor: "#f5f5f4",
    fontFamily: "Helvetica, Arial, sans-serif",
  },
  container: {
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    margin: "24px auto",
    padding: "32px",
    maxWidth: "480px",
  },
  brand: { fontSize: "20px", fontWeight: 700 as const, margin: "0 0 24px" },
  heading: { fontSize: "18px", fontWeight: 600 as const, margin: "0 0 12px" },
  text: {
    fontSize: "14px",
    lineHeight: "22px",
    color: "#333333",
    margin: "0 0 24px",
  },
  button: {
    backgroundColor: "#1d4ed8",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 600 as const,
    padding: "10px 20px",
    textDecoration: "none",
  },
  hr: { borderColor: "#e7e5e4", margin: "32px 0 16px" },
  footer: {
    fontSize: "12px",
    lineHeight: "18px",
    color: "#78716c",
    margin: "0",
  },
};

// The single shared layout for all JigSwap notification emails: brand line, heading, one body
// paragraph, one CTA button, and the mandatory preferences footer. Per-type variation lives in
// the copy catalog, not in components.
export const NotificationEmail = (props: NotificationEmailProps) => (
  <Html>
    <Head />
    <Preview>{props.body}</Preview>
    <Body style={styles.body}>
      <Container style={styles.container}>
        <Text style={styles.brand}>🧩 JigSwap</Text>
        <Heading as="h1" style={styles.heading}>
          {props.heading}
        </Heading>
        <Text style={styles.text}>{props.body}</Text>
        <Section>
          <Button href={props.ctaUrl} style={styles.button}>
            {props.ctaLabel}
          </Button>
        </Section>
        <Hr style={styles.hr} />
        <Text style={styles.footer}>
          {props.footerText}{" "}
          <Link href={props.footerLinkUrl}>{props.footerLinkLabel}</Link>
        </Text>
      </Container>
    </Body>
  </Html>
);
```

- [ ] **Step 6: Implement renderEmail**

Create `packages/email/src/render.tsx`:

```tsx
import { render } from "@react-email/render";
import {
  DEFAULT_PARAMS,
  EMAIL_COPY,
  EMAIL_TYPES,
  type EmailLocale,
  type EmailType,
  FOOTER,
} from "./copy";
import { NotificationEmail } from "./notification-email";
import { ctaPath } from "./urls";

export const isEmailType = (type: string): type is EmailType =>
  (EMAIL_TYPES as readonly string[]).includes(type);

export interface RenderEmailInput {
  readonly type: EmailType;
  readonly params: Readonly<Record<string, string>>;
  readonly locale: EmailLocale;
  readonly baseUrl: string;
  readonly relatedId?: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

const interpolate = (
  template: string,
  values: Readonly<Record<string, string>>,
): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

export const renderEmail = async (
  input: RenderEmailInput,
): Promise<RenderedEmail> => {
  const copy = EMAIL_COPY[input.type][input.locale];
  const values = { ...DEFAULT_PARAMS[input.locale], ...input.params };
  const footer = FOOTER[input.locale];

  const element = (
    <NotificationEmail
      heading={interpolate(copy.heading, values)}
      body={interpolate(copy.body, values)}
      ctaLabel={copy.cta}
      ctaUrl={new URL(
        ctaPath(input.type, input.relatedId),
        input.baseUrl,
      ).toString()}
      footerText={footer.text}
      footerLinkLabel={footer.linkLabel}
      footerLinkUrl={new URL("/notifications", input.baseUrl).toString()}
    />
  );

  return {
    subject: interpolate(copy.subject, values),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
};
```

Create `packages/email/src/index.ts`:

```ts
export {
  DEFAULT_PARAMS,
  EMAIL_TYPES,
  type EmailLocale,
  type EmailType,
} from "./copy";
export {
  isEmailType,
  renderEmail,
  type RenderedEmail,
  type RenderEmailInput,
} from "./render";
```

- [ ] **Step 7: Run tests + type-check**

Run: `pnpm --filter @jigswap/email exec vitest run && pnpm nx type-check @jigswap/email --skip-nx-cache`
Expected: PASS. If `@react-email/components` typing conflicts with react 19.2.7 types, align `@types/react` with the version apps/web uses (`grep '"@types/react"' apps/web/package.json`).

- [ ] **Step 8: Format and commit**

```bash
pnpm prettier --write packages/email
git add packages/email pnpm-lock.yaml
git commit -m "feat(email): @jigswap/email package — localized react-email rendering"
```

---

### Task 7: Backend — EmailSender port reshape + AhaSend adapter

**Files:**

- Modify: `packages/backend/convex/notifications/adapters/email.ts`
- Create: `packages/backend/convex/notifications/adapters/ahasendEmailSender.ts`
- Test: `packages/backend/convex/ahasendEmailSender.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/convex/ahasendEmailSender.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ahaSendEmailSender } from "./notifications/adapters/ahasendEmailSender";
import { makeEmailSenderFromEnv } from "./notifications/adapters/email";

const MESSAGE = {
  to: "anna@example.com",
  toName: "Anna",
  subject: "New trade request on JigSwap",
  html: "<p>hi</p>",
  text: "hi",
  idempotencyKey: "n-1",
};

const okResponse = () =>
  new Response(JSON.stringify({ object: "list", data: [] }), { status: 202 });

describe("ahaSendEmailSender", () => {
  it("POSTs the AhaSend v2 message shape with auth and idempotency headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const sender = ahaSendEmailSender({
      apiKey: "aha-sk-test",
      accountId: "acc-1",
      from: "notifications@jigswap.site",
      fromName: "JigSwap",
      sandbox: false,
      fetchImpl: fetchMock,
    });
    await sender.send(MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.ahasend.com/v2/accounts/acc-1/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer aha-sk-test");
    expect(headers["Idempotency-Key"]).toBe("n-1");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      from: { email: "notifications@jigswap.site", name: "JigSwap" },
      recipients: [{ email: "anna@example.com", name: "Anna" }],
      subject: "New trade request on JigSwap",
      html_content: "<p>hi</p>",
      text_content: "hi",
    });
  });

  it("adds sandbox: true when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const sender = ahaSendEmailSender({
      apiKey: "aha-sk-test",
      accountId: "acc-1",
      from: "notifications@jigswap.site",
      fromName: "JigSwap",
      sandbox: true,
      fetchImpl: fetchMock,
    });
    await sender.send(MESSAGE);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.sandbox).toBe(true);
  });

  it("throws with status and response text on a non-2xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("unverified domain", { status: 403 }));
    const sender = ahaSendEmailSender({
      apiKey: "aha-sk-test",
      accountId: "acc-1",
      from: "notifications@jigswap.site",
      fromName: "JigSwap",
      sandbox: false,
      fetchImpl: fetchMock,
    });
    await expect(sender.send(MESSAGE)).rejects.toThrow(
      /AhaSend 403.*unverified domain/,
    );
  });
});

describe("makeEmailSenderFromEnv", () => {
  it("returns the no-op when AhaSend env vars are missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sender = makeEmailSenderFromEnv({});
    await sender.send(MESSAGE); // must not throw
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns the AhaSend adapter when fully configured", () => {
    const sender = makeEmailSenderFromEnv({
      AHASEND_API_KEY: "aha-sk-test",
      AHASEND_ACCOUNT_ID: "acc-1",
      EMAIL_FROM: "notifications@jigswap.site",
    });
    // The no-op logs-and-drops; the real adapter throws on network failure in this
    // fetch-less test env — distinguishable behavior proves the branch.
    expect(sender).not.toBeNull();
    expect(typeof sender.send).toBe("function");
  });
});
```

Run: `pnpm --filter @jigswap/backend exec vitest run convex/ahasendEmailSender.test.ts`
Expected: FAIL — modules/exports missing.

- [ ] **Step 2: Implement the adapter**

Create `packages/backend/convex/notifications/adapters/ahasendEmailSender.ts`:

```ts
import type { EmailMessage, EmailSender } from "./email";

export interface AhaSendConfig {
  readonly apiKey: string;
  readonly accountId: string;
  readonly from: string;
  readonly fromName: string;
  readonly sandbox: boolean;
  // Injectable for tests; defaults to the runtime fetch.
  readonly fetchImpl?: typeof fetch;
}

// The REAL email adapter: one fetch to AhaSend's v2 create-message endpoint
// (https://ahasend.com/docs/api-reference/messages/create-message). The Idempotency-Key header
// makes a replayed send return the cached response instead of double-delivering. `sandbox: true`
// (AHASEND_SANDBOX) makes AhaSend accept-but-not-deliver — used for live verification. Throws on
// any non-2xx; the sendEmail action catches, logs a wide event, and drops (fail-open).
export const ahaSendEmailSender = (cfg: AhaSendConfig): EmailSender => ({
  async send(message: EmailMessage): Promise<void> {
    const doFetch = cfg.fetchImpl ?? fetch;
    const res = await doFetch(
      `https://api.ahasend.com/v2/accounts/${cfg.accountId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: { email: cfg.from, name: cfg.fromName },
          recipients: [{ email: message.to, name: message.toName }],
          subject: message.subject,
          html_content: message.html,
          text_content: message.text,
          ...(cfg.sandbox ? { sandbox: true } : {}),
        }),
      },
    );
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      throw new Error(`AhaSend ${res.status}: ${detail}`);
    }
  },
});
```

- [ ] **Step 3: Reshape the port**

Replace the contents of `packages/backend/convex/notifications/adapters/email.ts`:

```ts
import { ahaSendEmailSender } from "./ahasendEmailSender";

// Pluggable email-sender port. The message arrives fully RENDERED (subject/html/text via
// @jigswap/email) so adapters stay render-agnostic. The configured adapter is AhaSend
// (EU provider, jigswap.site domain); with the env unset this is a fail-open no-op so dev and
// preview deployments drop email harmlessly while the in-app feed keeps working.

export interface EmailMessage {
  readonly to: string;
  readonly toName: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  // Stable per-notification key (the Notification aggregateId): a replayed send is deduplicated
  // by the provider instead of double-delivering.
  readonly idempotencyKey: string;
}

// Outbound port. An adapter MAY throw on failure — the sendEmail action is the single caller and
// catches everything into a wide event (fail-open: a dropped email never breaks anything else).
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

// The default: no provider configured. Logs and drops, so opting a member into the email channel is
// harmless until the AhaSend env vars are set on the deployment.
export const noopEmailSender = (reason: string): EmailSender => ({
  async send(message) {
    console.warn(
      `email disabled (${reason}); dropping "${message.subject}" email to ${message.to}.`,
    );
  },
});

// Select the email adapter from env (read lazily per repo convention — never at module scope).
// AHASEND_SANDBOX=true keeps real API calls but suppresses delivery (AhaSend accepts and discards).
export const makeEmailSenderFromEnv = (
  env: Record<string, string | undefined> = process.env,
): EmailSender => {
  const apiKey = env["AHASEND_API_KEY"];
  const accountId = env["AHASEND_ACCOUNT_ID"];
  const from = env["EMAIL_FROM"];
  if (!apiKey || !accountId || !from) {
    return noopEmailSender(
      "AhaSend not configured: set AHASEND_API_KEY, AHASEND_ACCOUNT_ID, EMAIL_FROM",
    );
  }
  return ahaSendEmailSender({
    apiKey,
    accountId,
    from,
    fromName: env["EMAIL_FROM_NAME"] ?? "JigSwap",
    sandbox: env["AHASEND_SANDBOX"] === "true",
  });
};
```

Note: `sendEmail.ts` still calls the old shape and now fails type-check — Task 8 fixes it immediately. Verify ONLY the new tests here:

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jigswap/backend exec vitest run convex/ahasendEmailSender.test.ts`
Expected: PASS.

- [ ] **Step 5: Format and commit (single commit with Task 8 if you prefer green type-check per commit — otherwise commit now, Task 8 lands seconds later)**

```bash
pnpm prettier --write packages/backend/convex/notifications/adapters packages/backend/convex/ahasendEmailSender.test.ts
git add packages/backend/convex/notifications/adapters packages/backend/convex/ahasendEmailSender.test.ts
git commit -m "feat(backend): AhaSend email adapter behind reshaped EmailSender port"
```

---

### Task 8: Backend — sendEmail action renders and sends; emailChannel passes structure

**Files:**

- Modify: `packages/backend/convex/notifications/sendEmail.ts`
- Modify: `packages/backend/convex/notifications/adapters/channels/emailChannel.ts`
- Modify: `packages/backend/package.json` (add `@jigswap/email`)

- [ ] **Step 1: Add the workspace dependency**

```bash
pnpm --filter @jigswap/backend add '@jigswap/email@workspace:^'
```

- [ ] **Step 2: Rewrite the send action**

Replace `packages/backend/convex/notifications/sendEmail.ts`. It becomes `"use node"`: react-email's renderer is guaranteed there, and the axiom wide-event helper (`lib/axiom.ts`) is itself `"use node"` so a default-runtime module could not import it. This mirrors `sendWebPush.ts` exactly:

```ts
"use node";
import { type EmailLocale, isEmailType, renderEmail } from "@jigswap/email";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";
import { logEvent, type WideEvent } from "../lib/logEvent";
import { makeEmailSenderFromEnv } from "./adapters/email";

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

// Out-of-band email delivery for ONE notification, scheduled (runAfter 0) by the email channel
// after the originating mutation commits. Renders the localized react-email template here (the
// recipient's language travels with the args) and hands the rendered message to the configured
// EmailSender (AhaSend, or the no-op when unconfigured). FAIL-OPEN: any failure is logged as a
// wide event and dropped — the in-app row already exists, and Convex-scheduled actions run at
// most once (no retry), which the spec accepts for notification email.
export const send = internalAction({
  args: {
    to: v.string(),
    toName: v.string(),
    type: v.string(),
    params: v.record(v.string(), v.string()),
    locale: v.string(),
    relatedId: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (_ctx, args) => {
    const startedAt = Date.now();
    const event: WideEvent = {
      event: "notifications.email",
      outcome: "success",
      request_id: crypto.randomUUID(),
      type: args.type,
    };
    const flush = async () => {
      event.duration_ms = Date.now() - startedAt;
      await ingestToAxiom(logEvent(event));
    };

    try {
      if (!isEmailType(args.type)) {
        // Defense in depth: the domain already gates on EMAIL_ELIGIBLE_TYPES.
        event.skipped = true;
        event.skip_reason = "ineligible_type";
        await flush();
        return;
      }
      const locale: EmailLocale = args.locale === "nl" ? "nl" : "en";
      const baseUrl = process.env["EMAIL_BASE_URL"] ?? "https://jigswap.site";
      const rendered = await renderEmail({
        type: args.type,
        params: args.params,
        locale,
        baseUrl,
        relatedId: args.relatedId,
      });
      await makeEmailSenderFromEnv().send({
        to: args.to,
        toName: args.toName,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: args.idempotencyKey,
      });
    } catch (error) {
      event.outcome = "error";
      event.error = { code: "Unexpected", detail: errMsg(error) };
    } finally {
      await flush();
    }
  },
});
```

(If `WideEvent` requires a `user_id` field or rejects extra keys, mirror the exact field set used in `sendWebPush.ts` — same file family, same conventions.)

- [ ] **Step 3: Rewrite the email channel**

Replace the scheduling body in `packages/backend/convex/notifications/adapters/channels/emailChannel.ts`:

```ts
import type { Notification } from "@jigswap/domain";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

// Email channel: resolves the recipient's email/name/language and schedules the out-of-band send
// (notifications/sendEmail) after commit. The action renders the localized template — this channel
// only forwards structure (type + params + locale). Scheduling keeps the delivering mutation
// transactional; a mutation rollback also rolls the schedule back, so the notification's
// aggregateId doubles as a safe idempotency key.
export const emailChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
    const user = await ctx.db.get(state.userId as unknown as Id<"users">);
    if (!user) return;
    await ctx.scheduler.runAfter(0, internal.notifications.sendEmail.send, {
      to: user.email,
      toName: user.name,
      type: state.type as string,
      params: (state.params ?? {}) as Record<string, string>,
      locale: user.preferredLanguage === "nl" ? "nl" : "en",
      relatedId: state.relatedId,
      idempotencyKey: state.id as string,
    });
  };
```

- [ ] **Step 4: Verify**

Run: `pnpm nx type-check @jigswap/backend --skip-nx-cache && pnpm --filter @jigswap/backend exec vitest run convex/ahasendEmailSender.test.ts convex/notificationsCopy.test.ts convex/notificationsParams.test.ts`
Expected: PASS. Then run the full backend suite to catch anything referencing the old sendEmail args: `pnpm nx run @jigswap/backend:coverage --skip-nx-cache` — expected PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm prettier --write packages/backend/convex/notifications packages/backend/package.json
git add packages/backend/convex/notifications packages/backend/package.json pnpm-lock.yaml
git commit -m "feat(backend): sendEmail renders localized react-email and sends via AhaSend"
```

---

### Task 9: Backend — subscriber emits params instead of English strings

**Files:**

- Modify: `packages/backend/convex/notifications/subscriber.ts`

- [ ] **Step 1: Rewrite the command builder and every `cmd(...)` call**

In `subscriber.ts`, replace the `cmd` helper (bottom of file):

```ts
// Build a NotifyMemberCommand. `recipient` is a user id (string or Convex Id); relatedId points at
// the upstream entity's Convex `_id` (opaque to Notifications). `params` carries the render-ready
// values for this type's copy (contract documented in notifications/copy.ts); rendering happens at
// the edges (web i18n, email templates, push copy table) — never here.
const cmd = (
  recipient: string | Id<"users">,
  type: NotifyMemberCommand["type"],
  relatedId: string,
  params: Record<string, string> = {},
): NotifyMemberCommand => ({
  memberId: asMember(recipient as string),
  type,
  params,
  relatedId,
});
```

Add a name-resolver helper next to the other loaders (a `null` user or missing name yields no param; renderers fall back to "Someone"/"Iemand"):

```ts
// Resolve a member's display name for copy params. Missing user/name ⇒ no param (renderers have
// locale-appropriate fallbacks), never a thrown error — copy must not break delivery.
const memberName = async (
  ctx: MutationCtx,
  id: string | Id<"users">,
): Promise<Record<string, string>> => {
  const user = await ctx.db.get(id as Id<"users">);
  return user?.name ? { actorName: user.name } : {};
};
```

Then update every `case` in `translate` — same recipients, same types, same relatedIds, strings dropped, params added:

```ts
    case "ExchangeProposed": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [
        cmd(
          row.recipientId,
          "trade_request",
          row._id,
          await memberName(ctx, row.initiatorId),
        ),
      ];
    }
    case "ExchangeAccepted": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [cmd(row.initiatorId, "trade_accepted", row._id)];
    }
    case "ExchangeRejected": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [cmd(row.initiatorId, "trade_declined", row._id)];
    }
    case "ExchangeCancelled": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      return [cmd(row.recipientId, "trade_cancelled", row._id)];
    }
    case "ExchangeCompleted": {
      const row = await loadExchange(ctx, p.exchangeId as string);
      if (!row) return [];
      // The event carries no actor; notify both parties (each gets "the other party" signal).
      return [
        cmd(row.initiatorId, "trade_completed", row._id),
        cmd(row.recipientId, "trade_completed", row._id),
      ];
    }
    case "DisputeRaised": {
      // ... keep the counterparty resolution exactly as-is, then:
      return [cmd(counterparty, "exchange_disputed", row._id)];
    }
```

```ts
    case "MessagePosted": {
      const authorId = p.authorId as string | null;
      if (authorId === null || authorId === undefined) return [];
      const thread = await loadThread(ctx, p.threadId as string);
      if (!thread) return [];
      const author = await memberName(ctx, authorId);
      return thread.participants
        .filter((participant) => (participant as string) !== authorId)
        .map((participant) =>
          cmd(participant, "message_received", thread.aggregateId, author),
        );
    }
```

```ts
    case "GoalAchieved": {
      const goal = await loadGoal(ctx, p.goalId as string);
      if (!goal) return [];
      return [
        cmd(goal.userId, "goal_achieved", goal._id, { goalTitle: goal.title }),
      ];
    }

    case "PartnerReviewSubmitted": {
      return [
        cmd(p.revieweeId as string, "review_received", p.reviewId as string),
      ];
    }
```

Catalog cases keep their existing puzzle loads and produce `{ puzzleTitle: puzzle.title }` (plus `reason` for rejections):

```ts
    case "PuzzleDefinitionApproved": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(puzzle.submittedBy, "puzzle_approved", puzzle._id, {
          puzzleTitle: puzzle.title,
        }),
      ];
    }
    case "PuzzleDefinitionRejected": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(puzzle.submittedBy, "puzzle_rejected", puzzle._id, {
          puzzleTitle: puzzle.title,
        }),
      ];
    }
    case "ChangeProposalApproved": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      return [
        cmd(p.proposedBy as string, "proposal_approved", puzzle._id, {
          puzzleTitle: puzzle.title,
        }),
      ];
    }
    case "ChangeProposalRejected": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      if (!puzzle) return [];
      const reason = p.reason as string | undefined;
      return [
        cmd(p.proposedBy as string, "proposal_rejected", puzzle._id, {
          puzzleTitle: puzzle.title,
          ...(reason ? { reason } : {}),
        }),
      ];
    }
    case "ChangeProposalFiled": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      const admins = await adminRecipients(ctx, p.proposedBy as string);
      return admins.map((admin) =>
        cmd(
          admin._id,
          "admin_proposal_filed",
          p.changeProposalId as string,
          puzzle ? { puzzleTitle: puzzle.title } : {},
        ),
      );
    }
    case "PuzzleDefinitionSubmitted": {
      const admins = await adminRecipients(ctx, p.submittedBy as string);
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      return admins.map((admin) =>
        cmd(
          admin._id,
          "admin_definition_submitted",
          puzzle?._id ?? (p.puzzleDefinitionId as string),
          puzzle ? { puzzleTitle: puzzle.title } : {},
        ),
      );
    }
```

Social cases (keep the MemberFollowed suppression block exactly as-is):

```ts
      // (after the suppression check in MemberFollowed:)
      return [
        cmd(
          followeeId,
          "new_follower",
          followerId,
          await memberName(ctx, followerId),
        ),
      ];
    }
    case "FollowRequested": {
      return [
        cmd(
          p.targetId as string,
          "follow_request_received",
          p.requesterId as string,
          await memberName(ctx, p.requesterId as string),
        ),
      ];
    }
    case "FollowRequestApproved": {
      return [
        cmd(
          p.requesterId as string,
          "follow_request_approved",
          p.targetId as string,
          await memberName(ctx, p.targetId as string),
        ),
      ];
    }
```

- [ ] **Step 2: Verify — full backend suite**

Run: `pnpm nx type-check @jigswap/backend --skip-nx-cache && pnpm nx run @jigswap/backend:coverage --skip-nx-cache`
Expected: PASS. Existing subscriber/dispatch integration tests that asserted stored `title`/`message` strings will fail — update those assertions to check `type` + `params` instead (the copy moved to the render edges; asserting params is the new equivalent).

- [ ] **Step 3: Format and commit**

```bash
pnpm prettier --write packages/backend/convex
git add packages/backend/convex
git commit -m "feat(backend): subscriber emits structured params; copy rendered at the edges"
```

---

### Task 10: Domain cleanup — drop title/message from the create path

**Files:**

- Modify: `packages/domain/src/notifications/domain/notification.ts`
- Modify: `packages/domain/src/notifications/application/ports/in/notify-member.port.ts`
- Modify: `packages/domain/src/notifications/application/use-cases/notify-member.ts`
- Modify: `packages/domain/src/notifications/application/use-cases/notify-member.spec.ts` (and any other spec passing title/message to `create`/commands)

- [ ] **Step 1: Remove the transitional fields**

- `CreateNotificationProps`: delete `title?` and `message?` (keep `params?`). `NotificationState` KEEPS optional `title`/`message` — legacy rows rehydrate through it forever.
- `Notification.create`: stop copying `title`/`message` (new state simply omits them).
- `NotifyMemberCommand`: delete `title?` and `message?`.
- `notify-member.ts`: remove `title: cmd.title, message: cmd.message,` from the create call.

- [ ] **Step 2: Fix the specs**

In `notify-member.spec.ts`, the `cmd` fixture drops the strings:

```ts
const cmd = (
  overrides: Partial<Parameters<ReturnType<typeof makeNotifyMember>>[0]> = {},
) => ({
  memberId: alice,
  type: "trade_request" as const,
  params: { actorName: "Bob" },
  ...overrides,
});
```

Fix any other domain spec that passes `title`/`message` to `Notification.create` the same way (run the type-checker to find them all: `pnpm nx type-check @jigswap/domain --skip-nx-cache`).

- [ ] **Step 3: Verify domain + backend**

Run: `pnpm nx run-many -t type-check -p @jigswap/domain @jigswap/backend --skip-nx-cache && pnpm nx test @jigswap/domain --skip-nx-cache && pnpm nx run @jigswap/backend:coverage --skip-nx-cache`
Expected: PASS everywhere — the backend already stopped using the fields in Task 9.

- [ ] **Step 4: Format and commit**

```bash
pnpm prettier --write packages/domain/src/notifications
git add packages/domain/src/notifications
git commit -m "refactor(domain): drop pre-rendered title/message from the notification create path"
```

---

### Task 11: Web — optional legacy fields + email column gating + locale keys

**Files:**

- Modify: `apps/web/src/components/notifications/notification-meta.ts`
- Modify: `apps/web/src/components/notifications/channel-matrix.tsx`
- Modify: `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json`

- [ ] **Step 1: notification-meta.ts**

Make the legacy fields optional and add `params` on `NotificationRow`:

```ts
export interface NotificationRow {
  _id: string;
  aggregateId?: string;
  type: string;
  title?: string;
  message?: string;
  params?: Record<string, string>;
  relatedId?: string;
  channel?: string;
  isRead: boolean;
  createdAt: number;
}
```

Harden the legacy fallback in `notificationCopy` (new rows of a known type keep using the i18n keys; only unknown legacy types hit the fallback):

```ts
return { title: row.title ?? "", message: row.message ?? "" };
```

Add the email-eligibility mirror next to `ADMIN_NOTIFICATION_TYPES` (this is a NEW enum-literal sync point — same family as the KIND_META/locale sync points already documented for this repo):

```ts
// Types the backend will actually deliver by email (mirror of the domain's EMAIL_ELIGIBLE_TYPES —
// packages/domain/src/notifications/domain/notification-type.ts; keep in sync by hand). The matrix
// greys out the email switch for everything else: the server ignores the toggle regardless, this
// just keeps the UI honest.
export const EMAIL_ELIGIBLE_TYPES: ReadonlySet<NotificationType> = new Set([
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_completed",
  "trade_cancelled",
  "message_received",
  "review_received",
  "puzzle_favorited",
  "goal_achieved",
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
]);
```

- [ ] **Step 2: channel-matrix.tsx**

Import `EMAIL_ELIGIBLE_TYPES` from notification-meta. In BOTH the desktop grid and the mobile stacked branch, compute per-switch:

```tsx
const emailUnavailable = channel === "email" && !EMAIL_ELIGIBLE_TYPES.has(type);
```

and render the switch as:

```tsx
<Switch
  checked={!emailUnavailable && row[channel] === true}
  disabled={emailUnavailable}
  onCheckedChange={(checked) => onToggle(type, channel, checked)}
  aria-labelledby={`row-${type} col-${channel}`}
  title={emailUnavailable ? t("emailUnavailable") : undefined}
/>
```

(Mobile branch: keep its `id={id}` prop and add the same `checked`/`disabled`/`title` logic.)

- [ ] **Step 3: locale keys**

In `apps/web/locales/en.json` under the `notifications` object (alongside `channelsNote`):

```json
"emailUnavailable": "Email is not available for this notification type"
```

In `apps/web/locales/nl.json`:

```json
"emailUnavailable": "E-mail is niet beschikbaar voor dit meldingstype"
```

In `apps/web/locales/source.json`: add the same key/value as en.json, following the structure the file uses for the other `notifications` keys (it is the Crowdin source).

- [ ] **Step 4: Verify**

Run: `pnpm nx run-many -t type-check lint -p @jigswap/web --skip-nx-cache`
Expected: PASS (routeTree.gen tsc noise is known and ignorable per repo convention). Visual check is deferred to Task 12's dev-deploy verification (no local browser available in this environment).

- [ ] **Step 5: Format and commit**

```bash
pnpm prettier --write apps/web/src/components/notifications apps/web/locales
git add apps/web/src/components/notifications apps/web/locales
git commit -m "feat(web): email column gated to eligible types; notifications carry params"
```

---

### Task 12: Config, docs, full verification, live sandbox check

**Files:**

- Modify: `packages/backend/.env.example`

- [ ] **Step 1: Replace the stale Knock env docs**

In `packages/backend/.env.example`, replace the whole `# Optional: Knock (knock.app)…` block (including `KNOCK_API_KEY` and `KNOCK_WORKFLOW_KEY`) with:

```bash
# Optional: AhaSend (ahasend.com) — transactional email delivery (EU provider).
# Set these on the Convex deployment (npx convex env set). When unset, email notifications are
# dropped with a log; the in-app feed keeps working regardless. Only EMAIL_ELIGIBLE_TYPES
# (domain notification-type.ts) are ever emailed, gated further by per-member preferences.
#   AHASEND_API_KEY:    aha-sk-… API key with send permission for the jigswap.site domain.
#   AHASEND_ACCOUNT_ID: the AhaSend account UUID (part of the v2 API URL).
#   EMAIL_FROM:         verified from-address, e.g. notifications@jigswap.site
#   EMAIL_FROM_NAME:    display name, default "JigSwap".
#   EMAIL_BASE_URL:     web-app origin for CTA/preferences links, e.g. https://jigswap.site
#   AHASEND_SANDBOX:    "true" ⇒ AhaSend accepts but does NOT deliver (safe live verification).
AHASEND_API_KEY=aha-sk-your-ahasend-api-key
AHASEND_ACCOUNT_ID=your-ahasend-account-uuid
EMAIL_FROM=notifications@jigswap.site
EMAIL_FROM_NAME=JigSwap
EMAIL_BASE_URL=https://jigswap.site
AHASEND_SANDBOX=false
```

- [ ] **Step 2: Full CI-mirroring verification**

```bash
pnpm nx run-many -t type-check test lint --skip-nx-cache
pnpm nx run @jigswap/backend:coverage --skip-nx-cache
pnpm prettier --check .
```

Expected: all PASS (accepting the documented routeTree.gen noise on web type-check). Fix anything red before proceeding.

- [ ] **Step 3: Commit**

```bash
pnpm prettier --write packages/backend/.env.example
git add packages/backend/.env.example
git commit -m "docs: AhaSend env vars replace stale Knock entries"
```

- [ ] **Step 4: Configure the dev deployment (needs the user's AhaSend credentials)**

From `packages/backend/` with the logged-in Convex CLI (per the EU-migration runbook conventions, use explicit `--deployment` flags if targeting a non-default deployment):

```bash
npx convex env set AHASEND_API_KEY aha-sk-…            # user provides
npx convex env set AHASEND_ACCOUNT_ID …                # user provides
npx convex env set EMAIL_FROM notifications@jigswap.site
npx convex env set EMAIL_FROM_NAME JigSwap
npx convex env set EMAIL_BASE_URL https://jigswap.site
npx convex env set AHASEND_SANDBOX true                # keep sandbox ON until verified
```

If the credentials aren't available in the session, STOP and ask the user to run these — do not invent values.

- [ ] **Step 5: Live verification (sandbox)**

1. Deploy/push to the dev deployment (`pnpm nx dev @jigswap/backend` syncs functions in dev).
2. In the web app (dev server, port 3001), enable email for `message_received` in notification preferences for a test account, then send that account a message from another account.
3. Watch the Convex dashboard logs for `notifications.email` wide events: expect `outcome: "success"` and NO `skipped`.
4. Check the AhaSend dashboard: the message should appear as accepted (sandbox), with the localized subject.
5. Flip `AHASEND_SANDBOX` to `false` on the deployment only after the user confirms the sandbox run looks right; optionally send one real email to the user's own address as final confirmation.

- [ ] **Step 6: Production rollout note (user decision)**

Production env vars (`npx convex env set --prod …` or dashboard) are set the same way. The email channel stays dark for members until they opt in via preferences, so deploying the code first and configuring env later is safe.

---

## Self-review notes (already applied)

- **Push channel** consumes `title`/`message` today — handled by Task 5 landing before Task 9, with the copy table (Task 4) reproducing the exact current literals.
- **Every commit compiles**: optionality first (Task 1), removal last (Task 10); the port reshape (Task 7) and its only caller (Task 8) are adjacent.
- **Spec coverage**: schema/params ✓ (T3), EMAIL_ELIGIBLE_TYPES gate ✓ (T2), subscriber params ✓ (T9), react-email package + en/nl copy + CTA paths ✓ (T6), AhaSend adapter + env branching + idempotency + sandbox ✓ (T7), send action `"use node"` + wide-event logging + fail-open ✓ (T8), web matrix gating + legacy fallback ✓ (T11), .env.example Knock cleanup ✓ (T12), live sandbox verification ✓ (T12).
- **In-app localization** already existed via `notifications.copy.<type>` i18n keys; the plan deliberately leaves web copy static (params flow to the client for future enrichment but aren't interpolated yet — avoids MISSING_VALUE rendering for legacy rows).
