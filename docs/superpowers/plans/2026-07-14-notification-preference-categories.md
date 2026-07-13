# Notification Preference Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the 21-type notification preferences matrix into 5 categories with per-category tri-state toggle-all controls per channel, backed by one atomic bulk mutation.

**Architecture:** A `NOTIFICATION_CATEGORIES` list in the web meta module drives a sectioned matrix (category header row with tri-state Checkboxes + existing type rows). Header clicks call a new `setNotificationPreferences` bulk mutation backed by a new plural domain use case (load aggregate once → apply all → save once). Spec: `docs/superpowers/specs/2026-07-14-notification-preferences-categories-design.md`.

**Tech Stack:** Pure-TS domain (packages/domain), Convex backend (packages/backend/convex), TanStack Start web (apps/web) with shadcn Checkbox + sonner, vitest, Stryker (domain gate 95).

**Branch/PR:** land directly on `feat/ahasend-transactional-email` (PR #64), worktree `/home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/ahasend-email`.

**Repo conventions (every task):** prettier before commit; Nx with `--skip-nx-cache`; backend vitest target is `coverage`; domain tests `.spec.ts` colocated, backend `.test.ts` at `convex/` root; `noPropertyAccessFromIndexSignature` in backend/domain tsconfigs (bracket access on index signatures); commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; never name backend locals `use[A-Z]…`.

---

### Task A1: Domain — plural update-notification-preferences use case

**Files:**

- Create: `packages/domain/src/notifications/application/ports/in/update-notification-preferences.port.ts`
- Create: `packages/domain/src/notifications/application/use-cases/update-notification-preferences.ts`
- Test: `packages/domain/src/notifications/application/use-cases/update-notification-preferences.spec.ts`
- Modify: the application barrel(s) that export the singular use case/port (find with `grep -rn "update-notification-preference" packages/domain/src/notifications --include="index.ts"`) — add the plural exports alongside.

READ FIRST: `packages/domain/src/notifications/application/use-cases/update-notification-preference.ts` (the singular one), its port, and its spec — the plural versions mirror their shape, deps (`preferences`, `preferenceIds`, `events`, `clock`), and error contract exactly.

- [ ] **Step 1: Write the failing spec** — `update-notification-preferences.spec.ts`, mirroring the singular spec's fixtures (in-memory preference repository, `RecordingEventPublisher`, `FixedClock`, `SequentialPreferenceIdGenerator` from `../testing`):

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId, toNotificationPreferenceId } from "../../../shared-kernel";
import { NotificationPreference } from "../../domain";
import {
  FixedClock,
  InMemoryNotificationPreferenceRepository,
  RecordingEventPublisher,
  SequentialPreferenceIdGenerator,
} from "../testing";
import { makeUpdateNotificationPreferences } from "./update-notification-preferences";

const alice = toMemberId("alice");
const NOW = new Date("2026-07-14T10:00:00Z");

let preferences: InMemoryNotificationPreferenceRepository;
let events: RecordingEventPublisher;

const deps = () => ({
  preferences,
  preferenceIds: new SequentialPreferenceIdGenerator(),
  events,
  clock: new FixedClock(NOW),
});

beforeEach(() => {
  preferences = new InMemoryNotificationPreferenceRepository();
  events = new RecordingEventPublisher();
});

describe("makeUpdateNotificationPreferences", () => {
  it("applies every update atomically against one loaded aggregate", async () => {
    const update = makeUpdateNotificationPreferences(deps());
    const result = await update({
      memberId: alice,
      updates: [
        { type: "trade_request", channel: "email", enabled: true },
        { type: "trade_accepted", channel: "email", enabled: true },
        { type: "trade_request", channel: "push", enabled: true },
      ],
    });

    expect(result.isOk).toBe(true);
    expect(preferences.size()).toBe(1);
    const stored = await preferences.findByMember(alice);
    expect(stored?.allows("trade_request", "email")).toBe(true);
    expect(stored?.allows("trade_accepted", "email")).toBe(true);
    expect(stored?.allows("trade_request", "push")).toBe(true);
    // Untouched toggles keep their defaults.
    expect(stored?.allows("trade_declined", "email")).toBe(false);
  });

  it("disables in bulk on an existing preference", async () => {
    const pref = NotificationPreference.createDefault(
      toNotificationPreferenceId("seed"),
      alice,
      NOW,
    );
    pref.enable("trade_request", "email", NOW);
    pref.enable("trade_accepted", "email", NOW);
    pref.pullEvents();
    await preferences.save(pref);

    const update = makeUpdateNotificationPreferences(deps());
    await update({
      memberId: alice,
      updates: [
        { type: "trade_request", channel: "email", enabled: false },
        { type: "trade_accepted", channel: "email", enabled: false },
      ],
    });

    const stored = await preferences.findByMember(alice);
    expect(stored?.allows("trade_request", "email")).toBe(false);
    expect(stored?.allows("trade_accepted", "email")).toBe(false);
  });

  it("an empty updates list is a no-op that still succeeds", async () => {
    const update = makeUpdateNotificationPreferences(deps());
    const result = await update({ memberId: alice, updates: [] });
    expect(result.isOk).toBe(true);
  });
});
```

(Adjust imports/fixture names to what the singular spec actually uses — mirror it exactly; if it materialises a default preference for missing members inside the use case, the plural must too.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @jigswap/domain exec vitest run src/notifications/application/use-cases/update-notification-preferences.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Implement port** — `update-notification-preferences.port.ts` (mirror the singular port's style):

```ts
import { Result } from "../../../../shared-kernel";
import { Channel, MemberId, NotificationType } from "../../../domain";

// One (type, channel) toggle inside a bulk update.
export interface PreferenceUpdate {
  readonly type: NotificationType;
  readonly channel: Channel;
  readonly enabled: boolean;
}

// The bulk command behind the preference matrix's category toggle-all controls: the whole batch
// applies against ONE loaded aggregate and ONE save, so a header click is atomic.
export interface UpdateNotificationPreferencesCommand {
  readonly memberId: MemberId;
  readonly updates: readonly PreferenceUpdate[];
}

export interface UpdateNotificationPreferences {
  (cmd: UpdateNotificationPreferencesCommand): Promise<Result<void, never>>;
}
```

(Match the singular port's actual `Result` error type — if the singular returns `Result<void, never>` keep that; if it has an error channel, mirror it.)

- [ ] **Step 4: Implement use case** — `update-notification-preferences.ts`: copy the singular use case's structure: same deps interface, load-or-create-default preference (reuse its `loadPreference`-style helper logic), then

```ts
for (const u of cmd.updates) {
  if (u.enabled) preference.enable(u.type, u.channel, now);
  else preference.disable(u.type, u.channel, now);
}
await deps.preferences.save(preference);
// PreferenceChanged is a leaf event — same drop-or-publish behavior as the singular use case.
```

(One `save` for the whole batch. Mirror whatever the singular does with `pullEvents()`/publishing exactly.)

- [ ] **Step 5: Export from barrels** — add the new port + use case to the same `index.ts` files that export the singular ones.

- [ ] **Step 6: Verify** — `pnpm nx test @jigswap/domain --skip-nx-cache` → PASS. Then the mutation gate on the new file: `cd packages/domain && npx stryker run --mutate "src/notifications/application/use-cases/update-notification-preferences.ts"` → ≥95 (add killing tests if not; likely the empty-list and default-vs-existing branches).

- [ ] **Step 7: Format + commit**

```bash
pnpm prettier --write packages/domain/src/notifications
git add packages/domain/src/notifications
git commit -m "feat(domain): bulk update-notification-preferences use case"
```

---

### Task A2: Backend — setNotificationPreferences mutation + shared validators

**Files:**

- Create: `packages/backend/convex/notifications/preferenceValidators.ts`
- Create: `packages/backend/convex/notifications/setNotificationPreferences.ts`
- Modify: `packages/backend/convex/notifications/updateNotificationPreference.ts` (import the shared validators instead of its inline copies)
- Modify: `packages/backend/convex/_generated/api.d.ts` ONLY IF `pnpm exec convex codegen` (run from `packages/backend`) is unavailable — repo memory: in worktrees, new function modules may need a hand-added entry mirroring existing ones. Try codegen first.
- Modify: `packages/gateway/src/operations.ts` (add `setPreferences` under `notifications`)
- Test: `packages/backend/convex/setNotificationPreferences.test.ts`

READ FIRST: `packages/backend/convex/notifications/updateNotificationPreference.ts` (inline `notificationType`/`channel` validators + how it wires the singular use case with `requireMember`, `convexNotificationPreferenceRepository`, `notificationPreferenceIdGenerator`, `systemClock`, `noopEvents`), and one existing backend `.test.ts` that exercises a mutation via `convex-test` (e.g. `packages/backend/convex/notifications.test.ts`) for harness conventions.

- [ ] **Step 1: Extract shared validators** — `preferenceValidators.ts`: move the `notificationType` and `channel` `v.union(v.literal(...))` validators out of `updateNotificationPreference.ts` verbatim, export both (`export const notificationTypeValidator = ...; export const channelValidator = ...;`) with the existing sync-comment; update `updateNotificationPreference.ts` to import them (no behavior change).

- [ ] **Step 2: Write the failing test** — `setNotificationPreferences.test.ts` using the repo's convex-test conventions (mirror an existing test's identity/seeding helpers):

```ts
// Shape (adapt helpers to the harness conventions you find):
it("applies a bulk update atomically", async () => {
  // seed a user + identity, then:
  await asMember.mutation(api.notifications.setNotificationPreferences.setNotificationPreferences, {
    updates: [
      { type: "trade_request", channel: "email", enabled: true },
      { type: "trade_accepted", channel: "email", enabled: true },
    ],
  });
  const prefs = await asMember.query(api.notifications.getMyPreferences.getMyPreferences, {});
  expect(prefs["trade_request"]?.email).toBe(true);
  expect(prefs["trade_accepted"]?.email).toBe(true);
});

it("rejects more than 63 updates", async () => {
  const updates = Array.from({ length: 64 }, () => ({
    type: "trade_request" as const, channel: "email" as const, enabled: true,
  }));
  await expect(asMember.mutation(..., { updates })).rejects.toThrow(/too many/i);
});

it("rejects unauthenticated callers", async () => {
  await expect(t.mutation(..., { updates: [] })).rejects.toThrow();
});
```

Run → FAIL (module missing).

- [ ] **Step 3: Implement the mutation** — `setNotificationPreferences.ts`:

```ts
import { makeUpdateNotificationPreferences } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexNotificationPreferenceRepository } from "./adapters/convexNotificationPreferenceRepository";
import { notificationPreferenceIdGenerator } from "./adapters/idGenerators";
import { systemClock } from "./adapters/systemClock";
import {
  channelValidator,
  notificationTypeValidator,
} from "./preferenceValidators";

// PreferenceChanged is a leaf event (no downstream subscriber); drop it.
const noopEvents = { async publish(): Promise<void> {} };

// 21 types × 3 channels — anything larger is a client bug, not a bigger matrix.
const MAX_UPDATES = 63;

// Bulk (type, channel) toggle for the caller — one aggregate load, one save, so a category
// header click in the preferences matrix is atomic (no partial category state on failure).
export const setNotificationPreferences = mutation({
  args: {
    updates: v.array(
      v.object({
        type: notificationTypeValidator,
        channel: channelValidator,
        enabled: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.updates.length > MAX_UPDATES) {
      throw new ConvexError("Too many updates in one call");
    }
    const memberId = await requireMember(ctx);
    const update = makeUpdateNotificationPreferences({
      preferences: convexNotificationPreferenceRepository(ctx),
      preferenceIds: notificationPreferenceIdGenerator,
      events: noopEvents,
      clock: systemClock,
    });
    const result = await update({ memberId, updates: args.updates });
    if (!result.isOk) throw new ConvexError("Preference update failed");
    return null;
  },
});
```

(Mirror the singular mutation's exact result-handling/return conventions — read it first; if its use-case result has no error channel, drop the `!result.isOk` branch to match.)

- [ ] **Step 4: Codegen/api entry** — from `packages/backend`: `pnpm exec convex codegen` if it runs offline; otherwise hand-add the module to `_generated/api.d.ts` mirroring the `updateNotificationPreference` entry. Verify `pnpm nx type-check @jigswap/backend --skip-nx-cache` passes.

- [ ] **Step 5: Gateway** — in `packages/gateway/src/operations.ts` under `notifications`, add:

```ts
    setPreferences:
      api.notifications.setNotificationPreferences.setNotificationPreferences,
```

- [ ] **Step 6: Verify** — targeted test run then full: `pnpm --filter @jigswap/backend exec vitest run convex/setNotificationPreferences.test.ts` → PASS; `pnpm nx run @jigswap/backend:coverage --skip-nx-cache` → all PASS; `pnpm nx run-many -t type-check -p @jigswap/backend @jigswap/gateway --skip-nx-cache` → PASS.

- [ ] **Step 7: Format + commit**

```bash
pnpm prettier --write packages/backend/convex packages/gateway/src
git add packages/backend/convex packages/gateway/src
git commit -m "feat(backend): atomic bulk setNotificationPreferences mutation"
```

---

### Task A3: Web — NOTIFICATION_CATEGORIES + category i18n keys

**Files:**

- Modify: `apps/web/src/components/notifications/notification-meta.ts`
- Modify: `apps/web/locales/en.json`, `apps/web/locales/nl.json`, `apps/web/locales/source.json`
- Test: `apps/web/src/components/notifications/notification-meta.test.ts` (new — check `apps/web/package.json` has a vitest `test` script; it does. If no vitest config exists for apps/web, check for `vite.config.ts` test section; if genuinely absent, report DONE_WITH_CONCERNS and skip the test file, noting why.)

- [ ] **Step 1: Failing test**:

```ts
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
} from "./notification-meta";

describe("NOTIFICATION_CATEGORIES", () => {
  it("covers every notification type exactly once", () => {
    const all = NOTIFICATION_CATEGORIES.flatMap((c) => c.types);
    expect(all.sort()).toEqual([...NOTIFICATION_TYPES].sort());
    expect(new Set(all).size).toBe(all.length);
  });
});
```

- [ ] **Step 2: Implement** — in `notification-meta.ts`, next to `ADMIN_NOTIFICATION_TYPES`:

```ts
export type NotificationCategoryKey =
  "trades" | "messages" | "social" | "submissions" | "admin";

export interface NotificationCategory {
  readonly key: NotificationCategoryKey;
  readonly types: readonly NotificationType[];
}

// Display grouping for the preferences matrix. Every NotificationType appears in EXACTLY one
// category (pinned by notification-meta.test.ts). `admin` stays hidden for non-admins via the
// existing ADMIN_NOTIFICATION_TYPES filtering.
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  {
    key: "trades",
    types: [
      "trade_request",
      "trade_accepted",
      "trade_declined",
      "trade_completed",
      "trade_cancelled",
      "exchange_proposed",
      "exchange_disputed",
    ],
  },
  { key: "messages", types: ["message_received"] },
  {
    key: "social",
    types: [
      "new_follower",
      "follow_request_received",
      "follow_request_approved",
      "puzzle_favorited",
      "review_received",
      "goal_achieved",
    ],
  },
  {
    key: "submissions",
    types: [
      "puzzle_approved",
      "puzzle_rejected",
      "proposal_approved",
      "proposal_rejected",
      "photo_removed",
    ],
  },
  {
    key: "admin",
    types: ["admin_proposal_filed", "admin_definition_submitted"],
  },
];
```

- [ ] **Step 3: Locale keys** — inside the `notifications` object of all three locale files, add a `categories` object (en shown; source.json = en; nl translated):

```json
"categories": {
  "trades": { "title": "Trades", "description": "Requests, accepts, declines, completions and disputes" },
  "messages": { "title": "Messages", "description": "Direct messages from other members" },
  "social": { "title": "Social", "description": "Followers, follow requests, reviews, favorites and goals" },
  "submissions": { "title": "My submissions", "description": "Outcomes of your puzzle submissions and suggested edits" },
  "admin": { "title": "Admin", "description": "Items awaiting moderation or review" }
}
```

nl:

```json
"categories": {
  "trades": { "title": "Uitwisselingen", "description": "Verzoeken, acceptaties, afwijzingen, afrondingen en geschillen" },
  "messages": { "title": "Berichten", "description": "Directe berichten van andere leden" },
  "social": { "title": "Sociaal", "description": "Volgers, volgverzoeken, beoordelingen, favorieten en doelen" },
  "submissions": { "title": "Mijn inzendingen", "description": "Uitkomsten van je puzzelinzendingen en voorgestelde wijzigingen" },
  "admin": { "title": "Beheer", "description": "Items die wachten op moderatie of beoordeling" }
}
```

- [ ] **Step 4: Verify** — run the new test (`pnpm --filter @jigswap/web exec vitest run src/components/notifications/notification-meta.test.ts`), `pnpm nx run-many -t type-check lint -p @jigswap/web --skip-nx-cache`, and locale JSON validity (`python3 -c "import json; [json.load(open(f'apps/web/locales/{f}.json')) for f in ['en','nl','source']]"`).

- [ ] **Step 5: Format + commit**

```bash
pnpm prettier --write apps/web/src/components/notifications apps/web/locales
git add apps/web/src/components/notifications apps/web/locales
git commit -m "feat(web): notification category model + localized labels"
```

---

### Task A4: Web — sectioned matrix with tri-state header controls

**Files:**

- Modify: `apps/web/src/components/notifications/channel-matrix.tsx`
- Modify: `apps/web/src/components/notifications/notification-preferences-panel.tsx`

READ FIRST: both files in full, plus `apps/web/src/components/ui/checkbox.tsx` (confirm it accepts `checked: boolean | "indeterminate"` — Radix Checkbox does).

- [ ] **Step 1: Panel — bulk handler** (`notification-preferences-panel.tsx`): keep `handleToggle`; add alongside it:

```tsx
const setPreferences = useMutation({
  mutationFn: useConvexMutation(gateway.notifications.setPreferences),
});

const handleToggleCategory = async (
  types: readonly (typeof NOTIFICATION_TYPES)[number][],
  channel: NotificationChannel,
  enabled: boolean,
) => {
  try {
    await setPreferences.mutateAsync({
      updates: types.map((type) => ({ type, channel, enabled })),
    });
  } catch {
    toast.error(t("preferencesError"));
  }
};
```

Pass `onToggleCategory={handleToggleCategory}` into `<ChannelMatrix />`.

- [ ] **Step 2: Matrix rework** (`channel-matrix.tsx`) — behavioral requirements (adapt to the file's existing structure; keep every existing per-type row, switch, a11y attribute, and the email-eligibility gating exactly as they are):

1. Import `NOTIFICATION_CATEGORIES`, `EMAIL_ELIGIBLE_TYPES` and the shadcn `Checkbox`.
2. Replace the flat `visibleTypes.map(...)` with `NOTIFICATION_CATEGORIES.map((category) => ...)`, where each category's visible types are `category.types.filter((t) => visibleTypes.includes(t))`; skip categories whose visible list is empty (hides `admin` for non-admins).
3. Per category, controllable types per channel: `email` → `visible.filter((t) => EMAIL_ELIGIBLE_TYPES.has(t))`; other channels → all visible.
4. Header state per channel: `checked` when every controllable type has `preferences[type]?.[channel] === true`; `"indeterminate"` when some do; `false` when none. Zero controllable types (email on submissions/admin) → render the checkbox `disabled` with `title={t("emailUnavailable")}` and unchecked.
5. Header click: `onToggleCategory(controllableTypes, channel, headerState !== true)` (mixed/off → enable all; on → disable all).
6. Desktop: category header row spans the grid — left cell shows `t(`categories.${category.key}.title`)` bold + `t(`categories.${category.key}.description`)` muted; three centered header Checkboxes under the channel columns, `aria-label={`${t(`categories.${category.key}.title`)} — ${channelLabel[channel]}`}`.
7. Mobile (stacked branch): a category heading (title + description) before each group, with the same three labelled header Checkboxes in a row beneath it, then the existing per-type stacks.
8. Component signature gains `onToggleCategory: (types: readonly NotificationType[], channel: NotificationChannel, enabled: boolean) => void`.

- [ ] **Step 3: Verify** — `pnpm nx run-many -t type-check lint -p @jigswap/web --skip-nx-cache` → PASS; `pnpm --filter @jigswap/web exec vitest run src/components/notifications/notification-meta.test.ts` still PASS.

- [ ] **Step 4: Format + commit**

```bash
pnpm prettier --write apps/web/src/components/notifications
git add apps/web/src/components/notifications
git commit -m "feat(web): sectioned preferences matrix with category toggle-all"
```

---

### Task A5: Feature A verification sweep

- [ ] Run all gates:

```bash
pnpm nx run-many -t type-check lint --skip-nx-cache
pnpm nx test @jigswap/domain --skip-nx-cache
pnpm nx run @jigswap/backend:coverage --skip-nx-cache
pnpm --filter @jigswap/email exec vitest run
cd packages/domain && pnpm run mutation && cd ../..
pnpm prettier --check .
```

All PASS (domain mutation exit 0 against the 95 gate). Fix anything red before reporting. No commit needed unless fixes were required.
