# Content-Width Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every non-conforming dashboard page respect the shell-owned content-width preference with designs that genuinely use wide viewports, per the selected concepts in `docs/superpowers/specs/2026-07-14-content-width-conformance-design.md` (READ THE SPEC FIRST — it is the design authority for every task).

**Architecture:** Pure-frontend. Pages drop self-centering wrappers and in-page headers; the shell's `ContentArea` decides width and `PageHead` renders titles/actions published via `usePageHeaderActions`/`usePageHeader`. Each page family gets the spec's selected layout (rails/panels/grids per the cross-cutting rules).

**Tech Stack:** TanStack Start/Router, shadcn + Tailwind, `use-intl`, existing dashboard-layout slot system. No backend changes.

**Branch/PR:** `feat/ahasend-transactional-email` (PR #64), worktree `/home/sander/Documenten/Projects/SanderVerkuil/JigSwap/.claude/worktrees/ahasend-email`.

**Conventions for EVERY task:**

- READ the spec's "Cross-cutting rules" section and your task's per-page section before coding; READ every file you modify in full first.
- Grid recipes come from the spec verbatim (e.g. `xl:grid-cols-[minmax(0,1fr)_280px]`); do not invent alternatives.
- Sticky asides: `className="lg:sticky lg:top-<shell offset> self-start"` — find the offset other sticky elements use (`grep -rn "sticky top-" apps/web/src/components` and mirror).
- Verification per task (unless stated otherwise): `pnpm nx run-many -t type-check lint -p @jigswap/web --skip-nx-cache` clean; `pnpm --filter @jigswap/web exec vitest run` green; visual sanity is deferred to the preview (no local browser).
- `routeTree.gen.ts` is gitignored — never commit it.
- Locale changes always hit `en.json` + `nl.json` + `source.json` (source = en); validate JSON after editing.
- Prettier before each commit; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task W1: Notifications feed + filter rail

**Files:**

- Modify: `apps/web/src/routes/_dashboard/notifications/index.tsx` (full rework)
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json` (rail strings)

READ FIRST: the route file, `apps/web/src/components/notifications/notification-meta.ts` (`NOTIFICATION_CATEGORIES`, icon/accent/href helpers, `notificationCopy`), `notification-bell.tsx` (row anatomy), `apps/web/src/components/dashboard-layout/page-header-slot.tsx` (`usePageHeaderActions`), `my-puzzles/index.tsx` (header-slot usage example), `push-device-section.tsx` (how push subscription state is read).

- [ ] **Step 1: Header-slot adoption.** Delete the in-page h1/subtitle block AND the `container mx-auto max-w-3xl` root. Root becomes `flex w-full flex-col gap-6`. Publish via `usePageHeaderActions`: a muted unread-count meta span + Preferences button (outline, `Link` to `/notifications/preferences`, keep the `Settings2` icon) + Mark-all-read button (existing handler/disabled logic). Title/subtitle come from the existing `ROUTE_META["/notifications"]` — verify the shell now shows exactly ONE header.

- [ ] **Step 2: Feed layout.** Wrap content in `grid gap-6 lg:gap-10 xl:grid-cols-[minmax(0,1fr)_280px]`. Feed column: group the (filtered) notifications into date sections — Today / Yesterday / Earlier, computed from `createdAt` vs start-of-today/yesterday — each with the repo's section-heading style (`grep -rn "SectionHead" apps/web/src/components/dashboard-home` and reuse). Rows at `md:` become a columnar grid `grid md:grid-cols-[36px_minmax(0,1fr)_auto_auto_36px]`: icon chip | title (font-medium) + message (muted, `max-w-[42rem] truncate`-friendly) | category badge (`Badge variant="outline"`, label `t(\`categories.${key}.title\`)`resolved via a`typeToCategory`lookup built from`NOTIFICATION_CATEGORIES`) | relative time (`tabular-nums text-muted-foreground text-xs`) | mark-read action. Below `md:`keep today's stacked row anatomy. Preserve ALL existing behavior: unread highlight,`notificationHref` navigation on click, mark-read on click, aria labels.

- [ ] **Step 3: Filter rail.** Right column, sticky at `xl:`: (a) unread stat (count + label, large numeral); (b) category filter pills — All + one per category with visible types (reuse the app's pill/FilterBar styling; `aria-pressed` on active); (c) unread-only `Switch` row; (d) push-status line: reuse the subscription-state read from `push-device-section.tsx` to render "Push: on/off on this device" + a muted `Link` to `/notifications/preferences`. Below `xl:` the rail renders ABOVE the feed as a horizontal wrap row (pills + unread toggle; stat and push line hidden below `xl:` — they're glanceable extras, not controls). Filters are `useState` over the loaded list: `category` (`"all" | NotificationCategoryKey`) and `unreadOnly` (boolean); filtering composes with the date grouping. Empty-filter-result state reuses the page's existing empty-state copy pattern with a "clear filters" button.

- [ ] **Step 4: Locale keys** — add under `notifications` in all three files: `"unreadStat": "Unread"`, `"filterAll": "All"`, `"unreadOnly": "Unread only"`, `"pushOnDevice": "Push on this device: {state}"`, `"clearFilters": "Clear filters"`, `"today": "Today"`, `"yesterday": "Yesterday"`, `"earlier": "Earlier"` (nl: `"Ongelezen"`, `"Alle"`, `"Alleen ongelezen"`, `"Push op dit apparaat: {state}"`, `"Filters wissen"`, `"Vandaag"`, `"Gisteren"`, `"Eerder"`). Reuse existing on/off strings if present (`grep -n '"on"\|"off"' apps/web/locales/en.json` under common) else add `"pushStateOn"/"pushStateOff"` pairs.

- [ ] **Step 5: Verify + commit.** Standard gates. `git add apps/web/src/routes/_dashboard/notifications/index.tsx apps/web/locales && git commit -m "feat(web): notifications feed with filter rail, shell-owned header"`.

---

### Task W2: Notification preferences aside + ROUTE_META

**Files:**

- Modify: `apps/web/src/routes/_dashboard/notifications/preferences.tsx`
- Modify: `apps/web/src/components/notifications/notification-preferences-panel.tsx`
- Modify: `apps/web/src/components/dashboard-layout/route-meta.ts`
- Modify: `apps/web/locales/en.json`, `nl.json`, `source.json`

READ FIRST: all four code files, plus `route-meta.ts`'s existing entry shape and one `shell.pages.*` i18n block.

- [ ] **Step 1: ROUTE_META.** Add `"/notifications/preferences"` entry with `pageKey: "notificationPreferences"` and the same `group` as `"/notifications"` (read its entry). Add `shell.pages.notificationPreferences: { title, subtitle }` to all three locale files (en: "Notification preferences" / reuse the existing `notifications.preferencesSubtitle` text; nl: "Meldingsvoorkeuren" / its existing nl subtitle text). Breadcrumbs must now read Notifications › Notification preferences (via the group/prefix mechanics — verify against how other child routes crumb).

- [ ] **Step 2: Page slim-down.** `preferences.tsx` drops the in-page back-link button, h1/subtitle block, and `container mx-auto max-w-3xl`; root becomes `flex w-full flex-col`; body is just `<NotificationPreferencesPanel />`. (The shell breadcrumb replaces "Back to notifications" — leave the now-unused `backToNotifications` locale key in place; other locales reference it via Crowdin history, and dead-key cleanup is not this task.)

- [ ] **Step 3: Panel layout.** In `notification-preferences-panel.tsx`, restructure to `grid gap-6 lg:gap-10 lg:grid-cols-[300px_minmax(0,1fr)]`. Left aside (sticky at `lg:`): `PushDeviceSection`, then the `channelsNote` paragraph, then a "Jump to" anchor list — links per visible category to `#category-<key>` anchors. Right: the existing preferences section with `ChannelMatrix`, wrapped `max-w-[880px]` (NO `mx-auto`). Give each category block in `channel-matrix.tsx` an `id={\`category-${category.key}\`}`and`scroll-mt-*`matching the sticky header offset — this is the ONLY matrix change (add to both desktop and mobile branches). Below`lg:`: single column, push section first (today's order).

- [ ] **Step 4: Locale keys** — `notifications.jumpTo: "Jump to"` (nl `"Ga naar"`) in all three files.

- [ ] **Step 5: Verify + commit.** Standard gates + `pnpm --filter @jigswap/web exec vitest run src/components/notifications/notification-meta.test.ts`. Commit `feat(web): preferences page aside layout + proper route meta`.

---

### Task W3: Goals tile grid

**Files:**

- Modify: `apps/web/src/routes/_dashboard/goals.tsx`

READ FIRST: the whole file (goal block markup, skeleton, header-slot usage, create dialog).

- [ ] **Step 1:** Remove `mx-auto` + `max-w-[860px]` from the loaded root; root `flex w-full flex-col gap-[26px]`. Split goals into `active` / `achieved` arrays (whatever flag the data already carries — read it). Render two sections with the repo's section-heading style: Active (with count) then Achieved (only when non-empty, Trophy-toned per existing achieved styling). Each section body: `grid gap-x-10 gap-y-8 md:grid-cols-2 2xl:grid-cols-3`, goal block markup unchanged inside.
- [ ] **Step 2:** Make the loading skeleton use the SAME root + grid classes (kills the width jump).
- [ ] **Step 3:** Verify (standard gates) + commit `feat(web): goals tile grid with achieved shelf`.

---

### Task W4: Borrowed loan card grid

**Files:**

- Modify: `apps/web/src/routes/_dashboard/borrowed.tsx`

READ FIRST: the whole file + `my-puzzles/index.tsx` (header-slot meta pattern) + one PuzzleCard-family card for visual language.

- [ ] **Step 1:** Remove `container mx-auto` and the in-page h1/subtitle; root `flex w-full flex-col gap-6`. Publish borrowed-count meta via `usePageHeaderActions` (muted span, mirroring goals/my-puzzles).
- [ ] **Step 2:** Cards into `grid gap-4 sm:grid-cols-2 xl:grid-cols-3`; restructure each card: header row (existing package icon chip + title + piece-count `Badge`), meta lines (lender with avatar/name as currently shown, opened-ago), divider (`border-t`), footer row with the existing Log solve (outline) + Return (default) buttons right-aligned. Keep ALL existing handlers/dialog wiring. Empty state spans full width unchanged.
- [ ] **Step 3:** Verify + commit `feat(web): borrowed page loan card grid`.

---

### Task W5: GroupLanding launcher tiles

**Files:**

- Modify: `apps/web/src/components/dashboard-layout/group-landing.tsx`

READ FIRST: the component + one consumer (`library.tsx`) + `route-meta.ts`'s `getNavGroup`.

- [ ] **Step 1:** Replace the `max-w-[820px]` row list with tiles: container `grid w-full gap-4 sm:grid-cols-2 xl:grid-cols-3`; each item a bordered, rounded `Link` tile (`rounded-xl border p-5 transition-colors hover:bg-accent/50 group`): icon chip top-left (existing sidebar-accent chip styling), title `font-medium`, description `text-muted-foreground text-sm line-clamp-2`, `ChevronRight` bottom-right with the existing hover-translate effect. Keep keyboard focus styles (`focus-visible:ring` per the repo's Link/Button conventions).
- [ ] **Step 2:** Verify all three consumers render via type-check; standard gates; commit `feat(web): group landings as launcher tile grid`.

---

### Task W6: Edit forms with sticky context panel

**Files:**

- Modify: `apps/web/src/routes/_dashboard/puzzles/$id/suggest-edit.tsx`
- Modify: `apps/web/src/routes/_dashboard/admin/puzzles/$puzzleId/edit.tsx`
- Possibly create: a small shared `apps/web/src/components/catalog/form-context-panel.tsx` IF the two pages' panels are near-identical after reading them (DRY judgment — report the call you made)

READ FIRST: both route files IN FULL (they share `PuzzleDefinitionFields`; note where the image control lives, what `buildProposalArgs`/dirty logic exists, what the submit/cancel rows look like), plus `image-editor-dialog` usage.

- [ ] **Step 1:** Both pages: replace `mx-auto max-w-2xl` root with `grid gap-10 lg:grid-cols-[minmax(0,42rem)_minmax(280px,22rem)]`. Left column: the existing field stack/form UNCHANGED except the cover-image field and the submit/cancel row move out at `lg:` (see step 2) — below `lg:` they stay exactly where they are today (render the panel content inline in its current positions using a `hidden lg:block` / `lg:hidden` split, NOT conditional logic duplication — extract shared fragments as local components so each piece is defined once).
- [ ] **Step 2:** Right sticky panel (at `lg:`): large cover-image preview (current-vs-proposed label where the page distinguishes), Replace/Edit photo controls (the existing ones, relocated), a "Changes (N)" list derived from the page's existing dirty/`buildProposalArgs` logic showing human-readable field names of pending changes (empty state: "No changes yet" muted), and the Cancel/Submit button row (existing handlers/disabled/pending states).
- [ ] **Step 3:** Field-name labels for the changes list reuse the form's existing field labels (same i18n keys) — no new locale keys expected; if any label is unavailable, add keys to all three locale files and report.
- [ ] **Step 4:** Verify (standard gates; exercise both pages' type paths) + commit `feat(web): edit forms gain sticky context panel`.

---

### Task W7: Proposal review diff table + rail

**Files:**

- Modify: `apps/web/src/routes/_dashboard/admin/puzzles/proposals/$proposalId.tsx`

READ FIRST: the whole file (`fieldDiffRows`, conflict rendering, `ImageDiffDialog`, approve/reject dialogs, `usePageHeader` usage).

- [ ] **Step 1:** Replace `mx-auto max-w-3xl` root with `grid gap-6 lg:gap-10 xl:grid-cols-[minmax(0,1fr)_300px]`. Main region: diff rows become `md:grid-cols-[minmax(140px,200px)_1fr_1fr]` — label cell (field name + conflict `Badge` when conflicted), current-value cell, proposed-value cell (`font-medium`); add a one-time column header row (Field / Current / Proposed, muted uppercase-xs). Image row: thumbnails in the current/proposed cells, Compare button under the proposed thumbnail. Conflict "was when proposed" note spans the two value columns (`col-span-2`). Below `md:` keep today's stacked current:/proposed: rendering.
- [ ] **Step 2:** Right rail, sticky at `xl:`: proposer identity block (existing avatar/name/date markup relocated), status `Badge`, proposer comment, rejection reason (when present), conflict count line, then the action stack: Back (ghost/outline — keep even though breadcrumbs exist; admins mid-queue use it), Reject (destructive outline, existing dialog), Approve (default, existing confirm flow). Below `xl:`: rail content renders where it lives today (meta above the table, actions at the bottom) via the same `hidden xl:block`/`xl:hidden` shared-fragment technique as W6.
- [ ] **Step 3:** Verify + commit `feat(web): proposal review diff table with review rail`.

---

### Task W8: Conformance sweep, gates, push, PR update

- [ ] **Step 1: Grep gate** — from the worktree root:

```bash
grep -rn "container mx-auto\|mx-auto max-w\|max-w-\[820px\]\|max-w-\[860px\]" apps/web/src/routes/_dashboard apps/web/src/components/dashboard-layout/group-landing.tsx
```

Expected: NO route-root hits remain (column-level caps like the form's `minmax(0,42rem)` track or the matrix's `max-w-[880px]` are fine and won't match these patterns; investigate anything that does match).

- [ ] **Step 2: Full gates** — `pnpm nx run-many -t type-check lint --skip-nx-cache`; `pnpm nx test @jigswap/domain --skip-nx-cache`; `pnpm nx run @jigswap/backend:coverage --skip-nx-cache`; `pnpm --filter @jigswap/email exec vitest run`; `pnpm --filter @jigswap/web exec vitest run`; `pnpm nx build @jigswap/web --skip-nx-cache` (Clerk prerender noise ignorable); `pnpm prettier --check .` — all PASS.
- [ ] **Step 3:** `git push`; watch PR #64 checks to green; append a "Layout conformance" section to the PR body (pages fixed, the five cross-cutting rules, the deliberate tile-grid choice for landings, and a reviewer note to visually verify both width modes on the preview).
