# Change Proposals — Polish Round Implementation Plan (PR 5, stacked)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four owner-feedback items: (1) admins get in-app/push notifications when there is something to review (a new change proposal, a new definition submission); (2) the admin puzzle-definition detail page drops from 9 bounded card surfaces to 4 (UI-designer memo); (3) `/copies/<id>` highlights the right sidebar item (ownership-dependent, via a new `activeNavKey` page-header-slot override); (4) navigating collection → copy shows a contextual `My Library › Collections › [Collection] › [Copy]` breadcrumb via a typed `?from=collection:<id>` search param (UX-architect memo: canonical by default, contextual only when the link carries explicit context — collection membership is many-to-many so no canonical parent exists).

**Architecture:** The notification work introduces the first role-targeted fan-out: a `by_role` index on `users` (the Clerk role mirror — display + notification targeting ONLY, never authorization, which stays JWT-based via `isAdmin`), two admin-facing `NotificationType`s (`admin_proposal_filed`, `admin_definition_submitted`) run through the full sync-point checklist, subscriber cases for `ChangeProposalFiled`/`PuzzleDefinitionSubmitted` fanning out to admins (excluding the actor), and first `/admin/*` deep links in both href resolvers. It also fixes the ROOT CAUSE preference gap: `NotificationPreference.allows()` treats a type absent from a stored toggles map as OFF, silently suppressing every newly added type for members with pre-existing preference rows — changed to fall back to the type's default toggles (this also retroactively fixes `proposal_approved`/`proposal_rejected` for existing members). Admin-only types are hidden from non-admins' preference matrix. Items 2-4 are web-only and follow the two specialist memos verbatim.

**Tech Stack:** Convex (convex-test), vitest, TanStack Router `validateSearch`, use-intl EN/NL.

---

## Executor setup & non-negotiable constraints

- [ ] **The worktree already exists** — work in `/home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/change-proposals-polish`, branch `feat/change-proposals-polish`, branched from `feat/change-proposals-image-editor` at `552ad5487`. Deps installed.
- [ ] First commit: this plan (`docs: change-proposals polish plan (PR 5)`).

**STACKED-PR RULES:** base = `feat/change-proposals-image-editor`; controller opens the PR with that base.

**Baselines:** web 127 / backend 589 / domain 1101, all green at `552ad5487`. Backend tests at `convex/` root; web pure-helper tests only (node env). `_generated/api.d.ts` hand-edits required for any NEW Convex function modules (none planned — verify before assuming). routeTree regenerates via web vitest.

**Guardrails:**

- Authorization is NEVER gated on `users.role` — it stays display + notification-targeting; every admin surface keeps its JWT `isAdmin` gate. Update the schema comment to say exactly that.
- `ChangeProposalEdited` does NOT notify (noise; the queue reflects edits live).
- The admin fan-out excludes the acting member (an admin filing a proposal must not self-notify).
- Items 2-4 must not change any data reads/mutations — layout/navigation only.

---

### Task 1 — Preference-gap fix: absent type ⇒ default toggles (domain, TDD)

**Files:**

- Modify: `packages/domain/src/notifications/domain/notification-preference.ts` (`allows()`)
- Modify: its colocated spec (find it: `notification-preference.spec.ts`)

**Steps:**

- [ ] Read `notification-preference.ts` fully. Current: `allows(type, channel)` returns `this.state.toggles[type]?.[channel] === true` — a stored row created before a type existed suppresses that type forever.
- [ ] Write the failing test in the spec (mirror its existing style): rehydrate/construct a preference whose `toggles` map LACKS a type (e.g. only `trade_request` present), then assert `allows("puzzle_approved", "inApp") === true` (the default for every type is `{ inApp: true, email: false, push: false }` per `defaultToggles()`), and `allows("puzzle_approved", "email") === false`. Also assert an EXPLICITLY disabled stored toggle still wins (`toggles: { puzzle_approved: { inApp: false, ... } }` → false).
- [ ] Run → fail. Implement: in `allows()`, fall back to the default when the type is absent from the stored map:

```ts
  allows(type: NotificationType, channel: Channel): boolean {
    const stored = this.state.toggles[type];
    if (stored) return stored[channel] === true;
    // A type added AFTER this preference row was created has no stored entry; absent
    // means "never asked", not "opted out" — fall back to the type's default toggles.
    return defaultToggles()[type][channel] === true;
  }
```

(adapt names to the real code; `defaultToggles` may be module-private — it is defined in this file.)

- [ ] Run: spec green; full domain suite (1101 + new = report). Any other spec asserting the old absent⇒false behavior must be updated deliberately (report which).
- [ ] Prettier; commit: `fix(domain): absent notification-preference types fall back to default toggles`

---

### Task 2 — Admin notification types end-to-end (backend, TDD)

**Files:**

- Modify: `packages/backend/convex/schema.ts` (users `by_role` index + role-field comment; `notifications.type` union)
- Modify: `packages/domain/src/notifications/domain/notification-type.ts` (+ its spec)
- Modify: `packages/backend/convex/notifications/updateNotificationPreference.ts` (validator)
- Modify: `packages/backend/convex/notifications/subscriber.ts` (2 new cases + admin fan-out helper)
- Modify: `packages/backend/convex/notifications/adapters/webPush.ts` (admin URLs)
- Create: `packages/backend/convex/adminReviewNotifications.test.ts`

**Steps:**

- [ ] `schema.ts` users table: add `.index("by_role", ["role"])` after `by_username`, and extend the role-field comment's last line to: `// ... DISPLAY + NOTIFICATION TARGETING only: authorization always reads the JWT via identity/isAdmin — never gate on this field.`
- [ ] Add the two types through every sync point (kinds in this order, after `proposal_rejected`): `admin_proposal_filed`, `admin_definition_submitted`.
  1. Domain union + `NOTIFICATION_TYPES` array (+ comments: `// Catalog: ChangeProposalFiled — admins are asked to review a suggested edit` / `// Catalog: PuzzleDefinitionSubmitted — admins are asked to moderate a new submission`).
  2. `notification-type.spec.ts` hardcoded array.
  3. `schema.ts` `notifications.type` union.
  4. `updateNotificationPreference.ts` validator.
- [ ] Subscriber: add a helper above `translate` and two cases in the Catalog section:

```ts
// Fan a review-request out to every admin except the acting member. Reads the users
// table's Clerk role MIRROR via by_role — acceptable for informational notifications
// (authorization stays JWT-only); a drifted mirror can only mis-route a notification,
// never grant access.
const adminRecipients = async (
  ctx: MutationCtx,
  excludeUserId: string,
): Promise<Doc<"users">[]> => {
  const admins = await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "admin"))
    .collect();
  return admins.filter((admin) => (admin._id as string) !== excludeUserId);
};
```

cases:

```ts
    case "ChangeProposalFiled": {
      const puzzle = await loadPuzzle(ctx, p.puzzleDefinitionId as string);
      const admins = await adminRecipients(ctx, p.proposedBy as string);
      return admins.map((admin) =>
        cmd(
          admin._id,
          "admin_proposal_filed",
          "Suggestion to Review",
          puzzle
            ? `A member suggested an edit to "${puzzle.title}"`
            : "A member suggested an edit to a catalogue puzzle",
          p.changeProposalId as string, // the review route's param — no lookup needed
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
          "Submission to Moderate",
          puzzle
            ? `"${puzzle.title}" awaits moderation`
            : "A new puzzle submission awaits moderation",
          puzzle?._id ?? (p.puzzleDefinitionId as string),
        ),
      );
    }
```

- [ ] `webPush.ts` `notificationUrl`: add before the default:

```ts
    // Admin review deep links (first /admin destinations in this switch).
    case "admin_proposal_filed":
      return relatedId
        ? `/admin/puzzles/proposals/${relatedId}`
        : "/admin/puzzles/proposals";
    case "admin_definition_submitted":
      return "/admin/moderation";
```

(and extend the existing `webPush.test.ts` `notificationUrl` describe with the two cases, mirroring its style.)

- [ ] Create `packages/backend/convex/adminReviewNotifications.test.ts` (helper block copied from `changeProposalNotifications.test.ts` incl. `flushScheduled` + `notificationsFor`; seed a THIRD user with `role: "admin"` directly in the seed helper — note `asAdmin` identity impersonation doesn't write the role mirror; the seeded users row must carry `role: "admin"` explicitly for the fan-out to find it). Tests:
  1. Filing a proposal notifies the seeded admin (`admin_proposal_filed`, message contains the puzzle title, `relatedId` = the proposal aggregate id) and does NOT notify the proposer or another regular member.
  2. Submitting a definition notifies the admin (`admin_definition_submitted`) and not the submitter.
  3. Actor exclusion: when the ADMIN user themself submits a definition, no `admin_definition_submitted` lands for them.
  4. Editing a pending proposal produces NO admin notification.
- [ ] Run: new file green; full backend suite (589 + additions = report; webPush.test grows by 2); domain suite green (spec array updated).
- [ ] Prettier; commit: `feat(backend): notify admins when proposals or submissions await review`

---

### Task 3 — Admin notifications: web rendering + preference-matrix scoping

**Files:**

- Modify: `apps/web/src/components/notifications/notification-meta.ts`
- Modify: `apps/web/src/components/notifications/channel-matrix.tsx`
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json`

**Steps:**

- [ ] `notification-meta.ts`: add both types to the union + `NOTIFICATION_TYPES` (tail, matching the file's append convention); `notificationIcon`: `admin_proposal_filed` → `Lightbulb` (import if absent), `admin_definition_submitted` → `Inbox` (import if absent — check what the moderation console uses and reuse); `notificationAccent`: both → the accent used by informational types (check `trade_request`'s accent and match); `notificationHref`:

```ts
    case "admin_proposal_filed":
      return relatedId
        ? `/admin/puzzles/proposals/${relatedId}`
        : "/admin/puzzles/proposals";
    case "admin_definition_submitted":
      return "/admin/moderation";
```

Also export the audience set:

```ts
// Types only admins ever receive; hidden from non-admin preference matrices.
export const ADMIN_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  "admin_proposal_filed",
  "admin_definition_submitted",
]);
```

- [ ] `channel-matrix.tsx`: read the file; it iterates `NOTIFICATION_TYPES` for the rows. Add an `isAdmin` query (`convexQuery(gateway.identity.isAdmin, {})` — the same op the admin route gate uses; verify its gateway name) and filter: `const visibleTypes = NOTIFICATION_TYPES.filter((type) => !ADMIN_NOTIFICATION_TYPES.has(type) || isAdmin === true);` used by both the desktop and mobile renderings. While `isAdmin` is loading treat as false (rows appear when it resolves).
- [ ] Locales (three parallel maps × three files, after `proposal_rejected`):
  - `notifications.types`: en+source `"admin_proposal_filed": "Suggestion to review"`, `"admin_definition_submitted": "Submission to moderate"`; nl `"Voorstel om te beoordelen"`, `"Inzending om te modereren"`.
  - `notifications.copy`: en+source `admin_proposal_filed: { title: "Suggestion to review", message: "A member suggested an edit to a catalogue puzzle." }`, `admin_definition_submitted: { title: "Submission to moderate", message: "A new puzzle submission awaits moderation." }`; nl `{ "title": "Voorstel om te beoordelen", "message": "Een lid heeft een wijziging voor een cataloguspuzzel voorgesteld." }`, `{ "title": "Inzending om te modereren", "message": "Een nieuwe puzzelinzending wacht op moderatie." }`.
  - `notifications.typeDesc`: en+source `"When a member suggests an edit that needs review (admins only)."`, `"When a new puzzle submission awaits moderation (admins only)."`; nl `"Wanneer een lid een wijziging voorstelt die beoordeling vereist (alleen beheerders)."`, `"Wanneer een nieuwe puzzelinzending op moderatie wacht (alleen beheerders)."`.
- [ ] Verify: web vitest 127; web tsc clean; JSON parse + en==source.
- [ ] Prettier; commit: `feat(web): render admin review notifications + scope them to admin preference matrices`

---

### Task 4 — Admin detail page: 9 cards → 4 (UI-designer memo, verbatim)

**Files:**

- Modify: `apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId/index.tsx`

**Steps:**

- [ ] Apply the designer's AFTER skeleton exactly:
  1. Header (currently `rounded-xl border bg-card p-6`): drop the card classes — plain `<div>`; inner flex-wrap row (image / identity block / actions) UNCHANGED; the dates row becomes `mt-4 flex flex-wrap gap-4 border-t pt-4 text-xs text-muted-foreground` (hairline rule, not a card).
  2. Stats: replace the 5× `StatTile` grid with ONE `rounded-xl border bg-card p-4` panel containing `grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5`, each cell `\n<div><div className="text-2xl font-semibold tabular-nums">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>` for owners / copies.total / forTrade / forSale / forLend with the existing `t("detail.stats.*")` keys. Remove the now-orphaned `StatTile` import (the component file itself is untouched — the users page still uses it).
  3. Owners / Proposals / Audit sections: UNTOUCHED.
- [ ] No i18n changes, no query/action changes — verify by diff that only layout classes/JSX structure moved.
- [ ] Verify: web vitest 127; tsc clean; lint no new.
- [ ] Prettier; commit: `refactor(web): flatten admin puzzle detail to four bounded surfaces`

---

### Task 5 — Sidebar highlight override (`activeNavKey`, UX memo Q1)

**Files:**

- Modify: `apps/web/src/components/dashboard-layout/page-header-slot.tsx`
- Modify: `apps/web/src/components/dashboard-layout/app-sidebar.tsx`
- Modify: `apps/web/src/routes/_dashboard/copies/$id.tsx`

**Steps:**

- [ ] `page-header-slot.tsx`: add to `PageHeaderContent`:

```ts
  /** Overrides the sidebar's pathname-based highlight with this nav item key. */
  activeNavKey?: string;
```

- [ ] `app-sidebar.tsx`: find the `NavLink` active computation (`pathname === item.href || pathname.startsWith(...)`). Read the component structure first — the override must come from `usePageHeaderContent()` (the sidebar renders inside the provider; verified in `shell.tsx`):

```ts
const { activeNavKey } = usePageHeaderContent();
const active = activeNavKey
  ? activeNavKey === item.key
  : pathname === item.href || pathname.startsWith(`${item.href}/`);
```

(if `NavLink` doesn't receive `item.key`, thread it — read how items are mapped.)

- [ ] `copies/$id.tsx`: in the existing `usePageHeader` call (its deps already include `copy.viewerIsOwner`), add `activeNavKey: copy.viewerIsOwner ? "myPuzzles" : "browse",` (keys as they appear in `NAV_GROUPS` — verify both key strings in `route-meta.ts`).
- [ ] Verify: web vitest 127; tsc clean. Grep that no OTHER page publishes `activeNavKey` accidentally (only copies).
- [ ] Prettier; commit: `feat(web): ownership-aware sidebar highlight for copy pages`

---

### Task 6 — Contextual collection crumbs (`?from=collection:<id>`, UX memo Q2; TDD for the parser)

**Files:**

- Create: `apps/web/src/components/dashboard-layout/nav-context.ts` + `nav-context.test.ts`
- Modify: `apps/web/src/routes/_dashboard/copies/$id.tsx`
- Modify: `apps/web/src/components/ui/puzzle-card.tsx` (optional `viewSearch` prop)
- Modify: `apps/web/src/routes/_dashboard/collections/$id/index.tsx` (pass it)

**Steps:**

- [ ] TDD the tiny parser. `nav-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseNavContext } from "./nav-context";

describe("parseNavContext", () => {
  it("parses a collection context", () => {
    expect(parseNavContext("collection:abc123")).toEqual({
      kind: "collection",
      id: "abc123",
    });
  });
  it.each(["", "collection:", "puzzle:x", "collection", undefined])(
    "returns null for %s",
    (value) => {
      expect(parseNavContext(value)).toBeNull();
    },
  );
});
```

`nav-context.ts`:

```ts
// Typed parser for the `?from=` navigation-context search param (UX: breadcrumbs are
// canonical by default and contextual ONLY when the arriving link carries explicit
// context — see the copies page). Currently only collections; extend the union as
// new contexts appear.
export interface NavContext {
  kind: "collection";
  id: string;
}

export const parseNavContext = (
  value: string | undefined,
): NavContext | null => {
  if (!value) return null;
  const [kind, id] = value.split(":", 2);
  if (kind === "collection" && id) return { kind, id };
  return null;
};
```

- [ ] `copies/$id.tsx`: add `validateSearch` to the route options (mirror `my-puzzles/add/new.tsx`'s pattern) returning `{ from?: string }`; parse via `parseNavContext`; when it yields a collection, `convexQuery` the collection (find the existing by-id read the collections detail page uses — likely `gateway.collections.byId` or similar; verify in `packages/gateway/src/operations.ts`; pass `"skip"` when no context — check how the repo skips conditional convexQuery calls, e.g. other pages' patterns, and mirror). In the existing `usePageHeader`, branch: valid resolved collection ⇒ `crumbs: [ {tShell("groups.library.label") → "/library"}, {tShell("pages.collections.title") → "/collections"}, {collection.name → `/collections/${id}`} ]` + `activeNavKey: "collections"`; otherwise the existing owned/non-owned logic (+ Task 5's ownership `activeNavKey`). Deps extended with the context id + collection name.
- [ ] `puzzle-card.tsx`: add optional `viewSearch?: string` appended to the internally built view href (read how `imageHref`/`viewBasePath` compose; append verbatim when provided). Only the collections page passes it.
- [ ] `collections/$id/index.tsx`: pass `viewSearch={`?from=collection:${id}`}` to its `PuzzleCard`s.
- [ ] Verify: web vitest 127 + 2 new = 129; tsc clean; deep-link fallback sanity (no `from` → behavior identical; malformed → canonical). Lint no new.
- [ ] Prettier; commit: `feat(web): contextual collection breadcrumbs on copy pages via typed from-param`

---

### Task 7 — Full sweep

- [ ] Standard sweep (`nx run-many -t type-check|test|lint --skip-nx-cache`, `prettier --check .`, backend suite, web suite, domain suite) — report all counts. The controller pushes and opens the stacked PR.
