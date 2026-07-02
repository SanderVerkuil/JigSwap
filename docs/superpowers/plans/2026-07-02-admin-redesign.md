# Admin Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the admin area into the dashboard shell with a gated sidebar group, rebuild `/admin/moderation` as the Claude Design console (KPIs, Submissions / Flagged Images / Activity tabs), de-card the admin pages and the `/people` profile editor, plus two riders (sign-in → `/dashboard`, missing i18n key).

**Architecture:** Spec at `docs/superpowers/specs/2026-07-02-admin-redesign-design.md`; design reference at `docs/superpowers/design-reference/admin/admin.jsx` (translate to shadcn + `--jigsaw-*` tokens, never copy inline styles). New `moderationActions` table stamped directly by admin composition roots powers KPIs + activity. Flagged Images = classifier-rejected `ownedPuzzleImages`.

**Tech Stack:** TypeScript, Convex (+convex-test), TanStack Start/Router, shadcn/ui, use-intl (en/nl/source catalogs must stay key-identical).

**Branch:** `feat/admin-redesign` (already cut from main with the spec committed).

**Worktree caveats (if executing in a worktree):** write via worktree paths; hand-edit `packages/backend/convex/_generated/api.d.ts` for new function modules (no codegen); prettier changed files before each commit; verify with `--skip-nx-cache`.

---

### Task 0: Branch state check

- [ ] `git fetch origin && git rebase origin/main` on `feat/admin-redesign`. Then check whether PR #32 (messaging) has merged: `git log origin/main --oneline -5 | grep -i "conversation messaging"`. If merged, note that `app-sidebar.tsx` already contains the messages unread badge — integrate around it. If NOT merged, `app-sidebar.tsx` edits here will conflict with #32 later; proceed anyway (this plan's sidebar change is additive) and note it in the PR body.

---

### Task 1: Riders — sign-in redirect + missing i18n descriptions

**Files:** Modify `apps/web/src/routes/sign-in.$.tsx`, `apps/web/src/routes/sign-up.$.tsx` (if it exists — check), locale catalogs ×3.

- [ ] **1.1:** Add `fallbackRedirectUrl="/dashboard"` to the `<SignIn ...>` component (and `<SignUp>` similarly). Clerk still honors an explicit `redirect_url` query param (used by `lib/require-auth.ts`), so deep-link returns keep working — add a one-line comment saying exactly that.
- [ ] **1.2:** Add `shell.pages.puzzles.description` to `apps/web/locales/{en,nl,source}.json`. Then audit: for every `key` in `NAV_GROUPS`/`DASHBOARD_ITEM` (`apps/web/src/components/dashboard-layout/route-meta.ts`), verify `shell.pages.<key>.description` exists in all three catalogs (`group-landing.tsx:37` renders it for every group item). Add any other missing ones (EN text + real NL translation). Verify parity: all three catalogs key-identical (quick python set-compare).
- [ ] **1.3:** `pnpm nx run-many -t type-check lint test -p @jigswap/web --skip-nx-cache` → green. Prettier. Commit: `fix(web): sign-in lands on /dashboard; add missing shell page descriptions`.

---

### Task 2: Backend — `moderationActions` table + stamping

**Files:** Modify `packages/backend/convex/schema.ts`; Create `packages/backend/convex/admin/stampModerationAction.ts` (helper, not a public function); Modify `packages/backend/convex/catalog/approvePuzzleDefinition.ts`, `rejectPuzzleDefinition.ts`, `packages/backend/convex/library/moderatePhoto.ts`; Test `packages/backend/convex/moderationActions.test.ts`.

- [ ] **2.1 Schema** (additive, after `adminCategories`):

```ts
// Admin moderation audit trail: one row per decision, stamped directly by the admin
// composition roots (catalog approve/reject domain events carry no actor) and by the
// photo pipeline's auto-rejections (actorId absent = system). Powers the moderation
// console's KPI week-stats and activity log.
moderationActions: defineTable({
  actorId: v.optional(v.id("users")), // absent = automated pipeline
  kind: v.union(
    v.literal("definition_approved"),
    v.literal("definition_rejected"),
    v.literal("definition_edited_approved"),
    v.literal("photo_restored"),
    v.literal("photo_removal_confirmed"),
    v.literal("photo_auto_rejected"),
  ),
  targetLabel: v.string(), // denormalized display title at decision time
  targetId: v.string(),
  at: v.number(),
}).index("by_at", ["at"]),
```

- [ ] **2.2 Helper** `admin/stampModerationAction.ts`:

```ts
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type ModerationKind =
  | "definition_approved"
  | "definition_rejected"
  | "definition_edited_approved"
  | "photo_restored"
  | "photo_removal_confirmed"
  | "photo_auto_rejected";

// One-liner used by every moderation decision point so the audit trail can't drift.
export const stampModerationAction = (
  ctx: MutationCtx,
  a: {
    actorId?: Id<"users">;
    kind: ModerationKind;
    targetLabel: string;
    targetId: string;
  },
) => ctx.db.insert("moderationActions", { ...a, at: Date.now() });
```

- [ ] **2.3 TDD:** `moderationActions.test.ts` — approve a seeded pending definition as admin → one `definition_approved` row with the admin's actorId and the puzzle title as targetLabel; reject → `definition_rejected`; the photo pipeline's auto-reject path (drive `moderatePhoto` the way `addCopyPhoto.test.ts` / existing moderation tests do, forcing a reject decision) → `photo_auto_rejected` row with NO actorId. Verify FAIL first, then wire the stamps: in `approvePuzzleDefinition.ts`/`rejectPuzzleDefinition.ts` after `runDefinitionAction` succeeds (load the definition row for its title — `runDefinitionAction` already resolves it; check its return or re-query by aggregateId); in `moderatePhoto.ts` where it patches `moderationStatus: "rejected"`.
- [ ] **2.4:** Full backend targets green (`--skip-nx-cache`). Prettier, register nothing in api.d.ts (helper is internal). Commit: `feat(backend): moderation audit trail stamped by decision points`.

---

### Task 3: Backend — stats, activity, listAdmins

**Files:** Create `packages/backend/convex/admin/getModerationStats.ts`, `getModerationActivity.ts`, `packages/backend/convex/identity/listAdmins.ts`; Modify `_generated/api.d.ts`; Test extend `moderationActions.test.ts`.

- [ ] **3.1 TDD tests:** stats over seeded rows (2 approved this week, 1 rejected, 1 photo_removal_confirmed + 1 photo_auto_rejected → flagsCleared 2; one action 8 days old excluded); avgReviewMins = mean of (decision at − puzzle createdAt) over definition decisions this week, minutes, rounded; non-admin → Forbidden for all three; activity returns newest-first with actor display name (absent actor → null, UI renders "System").
- [ ] **3.2 Implement.** `getModerationStats` (admin-gated like `listPendingPuzzleDefinitions` — `requireMember` + `isAdmin` Forbidden): `by_at` range `gte(Date.now() - 7*24*3600*1000)`, reduce counts: `approved` = definition_approved + definition_edited_approved, `rejected` = definition_rejected, `flagsCleared` = photo_restored + photo_removal_confirmed + photo_auto_rejected, `avgReviewMins` as tested (null when no definition decisions). `getModerationActivity({ limit: v.optional(v.number()) })`: `by_at` desc `.take(limit ?? 30)`, join actor names via `ctx.db.get`. `identity/listAdmins`: query users with admin role — read how `isAdmin` decides (role field/metadata) and filter the same way; return `{ _id, name }[]`; admin-gated.
- [ ] **3.3:** Green, prettier, api.d.ts entries for the three modules. Commit: `feat(backend): moderation stats, activity, and admin-list read models`.

---

### Task 4: Backend — flagged photos queue

**Files:** Modify `packages/backend/convex/schema.ts` (index), `packages/backend/convex/notifications/` type plumbing (only the schema union literal + wherever the domain NotificationType union is declared — grep `"puzzle_rejected"` in `packages/domain/src/notifications/` and add `"photo_removed"` beside it); Create `packages/backend/convex/admin/listRejectedPhotos.ts`, `restorePhoto.ts`, `confirmPhotoRemoval.ts`; Test `packages/backend/convex/adminFlaggedPhotos.test.ts`.

- [ ] **4.1:** Add index to `ownedPuzzleImages`: `.index("by_moderation_status", ["moderationStatus"])`. Add `v.literal("photo_removed")` to the `notifications.type` union in schema.ts and `"photo_removed"` to the domain `NotificationType` (mirror how `puzzle_rejected` appears in both).
- [ ] **4.2 TDD tests:** seed rejected + approved + pending photo rows (raw `t.run` inserts with storage ids from `t.run` file writes, or follow how existing photo tests fabricate storage); `listRejectedPhotos` returns only rejected, with uploader name + puzzle title + score/label; non-admin Forbidden on all three functions; `restorePhoto` → row `moderationStatus: "approved"` + `photo_restored` stamp; `confirmPhotoRemoval` → row gone, stored file deleted (`ctx.storage.getUrl` null afterwards), `photo_removal_confirmed` stamp, and one `photo_removed` notification for the uploader.
- [ ] **4.3 Implement** the three functions (admin-gated). `confirmPhotoRemoval` deletes storage via `ctx.storage.delete(fileId)` then the row, stamps, and inserts the notification the way other backend code creates notifications (grep `makeNotify` usage in a mutation context, or insert via the notifications adapter used by `notifications/subscriber.ts` — reuse `NotifyMember`, honoring preferences).
- [ ] **4.4:** Green, prettier, api.d.ts. Commit: `feat(backend): flagged-photo review queue with restore/remove + uploader notification`.

---

### Task 5: Shell integration

**Files:** Delete `apps/web/src/routes/admin.tsx`; Create `apps/web/src/routes/_dashboard/admin/route.tsx`; Move `apps/web/src/routes/admin/{index,categories,moderation,contact,feedback}.tsx` → `apps/web/src/routes/_dashboard/admin/`; Modify `route-meta.ts`, `app-sidebar.tsx`, `command-palette.tsx`, `user-footer.tsx`, `shell-user-button.tsx`, locale catalogs ×3; delete `AdminNotFound` (grep `components/` for it) in favor of `AppNotFound`.

- [ ] **5.1 route.tsx:**

```tsx
import { requireAdmin } from "@/lib/require-admin";
import { createFileRoute, Outlet } from "@tanstack/react-router";

// Admin pages render inside the dashboard shell; this pathless-child group only
// adds the admin gate. _dashboard's requireAuth already ran (parent-then-child).
export const Route = createFileRoute("/_dashboard/admin")({
  beforeLoad: ({ location }) => requireAdmin({ location }),
  component: Outlet,
});
```

(Adapt `requireAdmin`'s exact call signature from `lib/require-admin.ts`; keep redirect behavior unchanged.)

- [ ] **5.2 route-meta.ts:** `ShellGroupKey = "library" | "community" | "admin"`. New exported `ADMIN_GROUP: ShellNavGroup` (icon `Shield`; href `/admin`; items: moderation `/admin/moderation` icon `Gavel` or `ShieldCheck`, categories `/admin/categories` icon `Tags`, contact `/admin/contact` icon `Mail`, feedback `/admin/feedback` icon `ThumbsUp`) — NOT added to `NAV_GROUPS`. `getNavGroup` handles `"admin"` (return `ADMIN_GROUP` explicitly; remove the unsafe cast by exhaustive lookup). `ROUTE_META` entries: `"/admin": { pageKey: "admin", variant: "landing" }`, plus `adminModeration`/`adminCategories`/`adminContact`/`adminFeedback` with `group: "admin"`.
- [ ] **5.3 app-sidebar.tsx:** after the existing groups, render `ADMIN_GROUP` behind the gate — one `useQuery(gateway.identity.isAdmin, me ? {} : "skip")` (identical idiom to the messages badge query in this file/NavLink) and a `SidebarSeparator` above the group. Reuse the exact group-rendering JSX by extracting the current `NAV_GROUPS.map` body into a local `renderGroup(group)` if that keeps it DRY.
- [ ] **5.4 command-palette.tsx:** add gated admin entries (same isAdmin query result — lift or duplicate the small query; prefer passing down if trivial) mapping ADMIN_GROUP items into the existing "Go to" list. **user-footer.tsx:** remove the Shield admin badge. **shell-user-button.tsx:** add a gated "Admin" menu item linking `/admin`.
- [ ] **5.5 Pages adopt the shell head:** in all five moved pages delete the `<h1>`/subtitle header blocks (shell page-head now renders titles from ROUTE_META). i18n: add `shell.groups.admin.{label,blurb}` and `shell.pages.{admin,adminModeration,adminCategories,adminContact,adminFeedback}.{title,subtitle,description}` ×3 catalogs. Landing page (`admin/index.tsx`): replace the card grid with the shell's group-landing pattern — since `/admin` is registered as `variant: "landing"`, check whether `group-landing.tsx` renders automatically for it (it maps `getNavGroup(group).items`); if the landing component is generic, the index route may simply reuse it — read `routes/_dashboard/library.tsx` and copy its approach exactly.
- [ ] **5.6:** Delete `AdminNotFound`, point anything referencing it at the dashboard's `AppNotFound`. Regenerate route tree (dev boot). Full web targets green. Manual grep: no `routes/admin.tsx` references left. Prettier. Commit: `feat(web): admin area inside the dashboard shell with gated nav group`.

---

### Task 6: De-card contact + feedback

**Files:** Modify `apps/web/src/routes/_dashboard/admin/contact.tsx`, `feedback.tsx`; locale catalogs if wording changes.

- [ ] **6.1:** Replace the per-item `Card`s with a single bordered list container (`rounded-xl border bg-card` wrapper; rows `flex items-center gap-3 py-3 border-b last:border-0` — the design's activity-log pattern). Contact rows keep: name, subject, status badge, date, expandable/inline message body, mark-handled button. Feedback rows keep: slug, thumbs badge, date, comment. Empty states: the dashed "All clear" panel (build it once as `apps/web/src/components/admin/queue-empty.tsx` with `icon`/`title`/`label` props — Task 8 reuses it).
- [ ] **6.2:** Web targets green, prettier. Commit: `refactor(web): contact + feedback triage as list rows, not cards`.

---

### Task 7: Categories split + de-card

**Files:** Split `apps/web/src/routes/_dashboard/admin/categories.tsx` (~360 lines) into Create `apps/web/src/components/admin/category-form.tsx` + `category-list.tsx`; route file keeps wiring only.

- [ ] **7.1:** Move the create/edit form (fields, validation, save/cancel handlers) into `category-form.tsx` (props: `initial?`, `onSaved`) — the form may keep a bordered container but drop `Card` chrome (plain `section` + `SectionHead`-style label). Move the category grid into `category-list.tsx` rendering list rows (name en/nl, sortOrder, active badge, edit/activate buttons) instead of Cards. Behavior identical — this is a mechanical extraction; move code, don't rewrite logic.
- [ ] **7.2:** Web targets green (typecheck catches wiring slips), prettier. Commit: `refactor(web): split admin categories into form + list, de-carded`.

---

### Task 8: Moderation console — submissions

**Files:** Add shadcn tabs: `pnpm dlx shadcn@latest add tabs` (into `apps/web/src/components/ui/tabs.tsx`; if the CLI misbehaves offline, vendor the standard shadcn tabs source manually). Create `apps/web/src/components/admin/moderation/{kpi-row.tsx,admin-banner.tsx,queue-list.tsx,submission-detail.tsx,edit-approve-dialog.tsx,severity.ts}`; Rewrite `apps/web/src/routes/_dashboard/admin/moderation.tsx`; Test `apps/web/src/components/admin/moderation/severity.test.ts`; locale keys ×3.

- [ ] **8.1 Pure helpers first (TDD):** `severity.ts` — `severityBand(score: number | undefined): "high" | "medium" | "low"` (≥0.9 high, ≥0.7 medium, else low — thresholds as constants) and `formatAvgReview(mins: number | null)` (`null → "—"`, `47 → "47m"`, `95 → "1h 35m"`). Colocated test: band boundaries (0.9/0.89/0.7/0.69/undefined) + formatting cases. Green, commit rolls into 8.4.
- [ ] **8.2 Console shell:** `moderation.tsx` renders: `AdminBanner` (shield pill + `t("adminPage.moderators", { count })` from `gateway.identity.listAdmins`, stacked `Avatar`s), `KpiRow` (four tiles from `gateway.admin.getModerationStats` — icon chip in a tinted rounded square, big number, muted caption; use semantic tokens: green = existing success token, destructive, primary, muted — NO raw hex), `Tabs` (underline style via the shadcn tabs styled to match: `border-b` list, active `border-b-2 border-primary`; count pills as small rounded badges).
- [ ] **8.3 Submissions tab:** `QueueList` (generic: `items`, `selectedId`, `onSelect`, `renderRow` — 360px column on `lg:`, stacks above the detail pane below `lg` where selecting scrolls to the pane) over `gateway.catalog.listPendingPuzzleDefinitions` (check its DTO for title/brand/pieceCount/submitter/date fields; possible-dup: check whether the DTO or catalog suggestions query exposes a title-match — if a cheap existing query exists (`getSuggestions`/search index) call it per selected item ONLY (not per row) and show the dup banner in the detail pane; if nothing suitable exists, drop the per-row badge and keep the detail-pane check). `SubmissionDetail`: cover (existing cover/gradient component if one exists — check `puzzle-card.tsx`'s cover handling), title + id badge, metadata grid (submitted by/when, difficulty, year), submitter note (italic, quoted), actions row: primary "Approve & Publish" (`gateway.catalog.approve...`), outline "Edit & Approve" (opens `EditApproveDialog`), ghost destructive "Reject" right-aligned. After any action: optimistic removal from the queue + toast (sonner) matching the design's copy ("Approved "X" — N submissions left in queue.").
- [ ] **8.4 EditApproveDialog:** Dialog pre-filled from the selected definition, reusing the field components of the existing definition edit form (grep how `puzzle-form-content.tsx` or the catalog edit surface renders fields; reuse, don't fork). Save = `gateway.catalog.update...` then approve mutation, single "Edited & approved" toast. The backend `definition_edited_approved` stamp: the edit+approve flow calls approve — pass nothing extra; instead add an optional `edited: v.optional(v.boolean())` arg to `approvePuzzleDefinition` that switches the stamp kind (update Task 2's mutation + one test case accordingly — do it in this task if not already done).
- [ ] **8.5:** i18n keys (`adminPage.*` or extend existing `admin*` namespaces — follow whatever namespace Task 5 established) ×3; web green; prettier. Commit: `feat(web): moderation console — KPIs, tabs, submissions queue`.

---

### Task 9: Moderation console — flagged images + activity

**Files:** Create `apps/web/src/components/admin/moderation/{flag-detail.tsx,activity-log.tsx}`; Modify `moderation.tsx`; locale keys ×3.

- [ ] **9.1 Flagged tab:** `QueueList` reuse over `gateway.admin.listRejectedPhotos` (row: severity dot from `severityBand(score)`, classifier label, puzzle title, uploader, relative time). `FlagDetail`: image with blur-until-reveal guard (a `group` div: `img` + absolutely-positioned backdrop-blur overlay with eye-off icon and "hover/tap to reveal", `group-hover:opacity-0` + click-to-toggle for touch), severity badge, metadata grid (on puzzle / uploaded by / label / score), actions: destructive "Confirm Removal" (`gateway.admin.confirmPhotoRemoval`, confirm via the app's existing destructive-confirm pattern if one exists — grep for AlertDialog usage; else a simple two-step button state) and outline "Restore Photo" (`gateway.admin.restorePhoto`). Toasts + optimistic queue removal as in submissions.
- [ ] **9.2 Activity tab:** bordered list rows from `gateway.admin.getModerationActivity`: kind icon + tone (approved green check, rejected destructive x, removal destructive trash, restore muted check), "**who** did-what **target**" sentence via i18n with interpolation (actor null → t("system")), relative time. Reuse `QueueEmpty` for the empty state.
- [ ] **9.3 Gateway:** add the `admin` namespace ops used above (`getModerationStats`, `getModerationActivity`, `listRejectedPhotos`, `restorePhoto`, `confirmPhotoRemoval`) and `identity.listAdmins` to `packages/gateway/src/operations.ts` (do this in whichever of Tasks 3/4 lands first if the implementer prefers — just don't leave it later than this task).
- [ ] **9.4:** Web + backend green, i18n parity, prettier. Commit: `feat(web): flagged-images review + moderation activity log`.

---

### Task 10: Profile-edit dialog on /people

**Files:** Modify `apps/web/src/components/social/profile-editor.tsx` (reshape as dialog content), `apps/web/src/routes/_dashboard/people.tsx`; locale keys if needed.

- [ ] **10.1:** Convert `ProfileEditor` to `ProfileEditDialog`: same two fields (displayName, bio), same `gateway.social.profile` query + `editProfile` mutation + toasts, wrapped in `Dialog` with `DialogTrigger asChild` on a compact outline "Edit profile" (Pencil) button. Remove the Card chrome entirely; the read-only display state disappears (the dialog always opens in edit mode, seeded from the query).
- [ ] **10.2:** `people.tsx`: drop the `lg:grid-cols-3` split — activity feed spans full width under the member grid; place the dialog trigger beside the activity `SectionHead` (check `section-head.tsx` for an actions slot; else a flex row).
- [ ] **10.3:** Web green, prettier. Commit: `refactor(web): profile editing moves to a dialog; people page de-carded`.

---

### Task 11: Final verification + PR

- [ ] **11.1:** `pnpm nx format:check` (mind: every tracked file, including docs) and `pnpm nx run-many -t type-check lint test arch-check -p @jigswap/backend @jigswap/domain @jigswap/gateway @jigswap/web @jigswap/contracts --skip-nx-cache` — all green from a clean state.
- [ ] **11.2:** Push `-u`, open PR titled `feat(admin): dashboard-shell integration + moderation console redesign`. Body: link spec + plan + design reference, per-area summary (shell, backend audit trail, console, de-carding, riders), test counts, screenshots note (no browser locally — reviewer should check the Vercel/preview build), and a note if PR #32 was unmerged at rebase time (sidebar conflict warning). Footer:

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## Self-review notes (planning time)

- **Spec coverage:** shell integration (T5), nav gate via backend isAdmin (T5.3), moderationActions + stamps (T2), stats/activity/listAdmins (T3), flagged photos + photo_removed notification (T4), console UI all three tabs + Edit & Approve (T8-9), de-carding landing/contact/feedback/categories (T5.5, T6, T7), profile dialog (T10), riders (T1), testing + delivery (throughout, T11). No gaps found.
- **Type consistency:** `stampModerationAction` kinds match the schema union everywhere; `severityBand`/`formatAvgReview` names consistent across T8/T9; `ADMIN_GROUP` naming consistent T5.
- **Deliberate judgment calls encoded:** possible-dup check runs per selected item only (or drops if no cheap query exists); `edited` flag on approve switches the stamp kind; landing page reuses the group-landing pattern rather than bespoke UI.
