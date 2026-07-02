# Admin redesign — shell integration, moderation console, profile-edit de-carding (design)

**Date:** 2026-07-02
**Status:** approved design, pre-implementation
**Handoff source:** Claude Design "JigSwap Application" → `app/admin.jsx`, saved verbatim at
`docs/superpowers/design-reference/admin/admin.jsx` (reference only; translated into shadcn +
TanStack routes, never shipped as-is — same convention as the add-puzzle handoff).

## Goals

1. Admin lives inside the regular dashboard shell with proper left-hand navigation (UX Architect
   verdict: integrate; the separate admin shell is a rotting stub with an empty sidebar and no
   mobile path at all).
2. The moderation page becomes the handoff's console: KPI week row, three tabs (Submissions /
   Flagged Images / Activity Log), list+detail split, Approve & Publish / Edit & Approve /
   Reject.
3. Cards only where information warrants a card: the admin landing, contact, feedback, and
   categories pages de-card into list rows; the `/people` ProfileEditor card becomes a dialog.
4. Riders: post-sign-in lands on `/dashboard`; the missing `shell.pages.puzzles.description`
   i18n key is fixed.

## Locked decisions

| Decision              | Choice                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Admin shell           | Integrate under `_dashboard`; URLs stay `/admin/*`; separate shell deleted                       |
| Admin nav (desktop)   | Gated third sidebar group `ADMIN_GROUP` (separate constant, NOT in `NAV_GROUPS`)                 |
| Admin nav (mobile)    | No tab; `/admin` landing is the hub (list of links), top-bar back-chevron, user-menu Shield      |
| Nav gate source       | Backend `gateway.identity.isAdmin` (same source as routes; no Clerk-metadata divergence)         |
| Moderation scope v1   | Submissions + Flagged Images + KPIs + Activity Log + Edit & Approve (all in)                     |
| Flagged Images source | Automated pipeline: `ownedPuzzleImages.moderationStatus === "rejected"` (false-positive review)  |
| Activity/KPI source   | New `moderationActions` table stamped directly by admin mutations (domain events carry no actor) |
| "Warn user" mapping   | Confirm-removal notifies the uploader via a new `photo_removed` notification type                |
| Profile editor        | Dialog opened from `/people`; the sidebar-column card is removed                                 |

## IA & shell integration

- **Routes:** delete `routes/admin.tsx`; move pages to `routes/_dashboard/admin/` with a
  `route.tsx` containing only `beforeLoad: requireAdmin` + `<Outlet/>`. `_dashboard`'s
  `requireAuth` composes first (parent-then-child). `AdminNotFound` folds into `AppNotFound`.
- **route-meta.ts:** extend `ShellGroupKey` with `"admin"`; add `ADMIN_GROUP` (label "Admin" →
  `/admin`; items Moderation, Categories, Contact, Feedback) kept out of `NAV_GROUPS` so nothing
  renders it unconditionally; `ROUTE_META` entries for all five paths; `getNavGroup` resolves
  `"admin"` (mind the existing `as ShellNavGroup` cast).
- **app-sidebar.tsx:** render `ADMIN_GROUP` behind an `isAdmin` gate (one `gateway.identity.isAdmin`
  query, messages-badge pattern) with a `SidebarSeparator` above. Command palette gets the same
  gated entries. The desktop `user-footer` Shield badge is removed as redundant;
  `shell-user-button.tsx` gains a gated Admin link (mobile reach).
- **Page heads:** admin pages drop hand-rolled `<h1>` blocks; titles/subtitles come from
  `ROUTE_META` (`shell.pages.admin*`, `shell.groups.admin` ×3 catalogs).
- **De-carding:** landing becomes a list of section links (mobile hub); contact + feedback become
  bordered list rows (activity-log style, not Cards); categories keeps its form but the category
  grid becomes a list, and the ~360-line file splits into form + list components.

## Categories page v2 (amendment, approved 2026-07-02)

Supersedes the categories portion above after the initial de-carding landed:

- **Page:** header (title + description + primary "Add category") over one bordered list panel.
- **Rows:** drag handle (GripVertical, dnd-kit sortable — new deps `@dnd-kit/core` +
  `@dnd-kit/sortable`; keyboard-accessible, no sortOrder number shown), 9x9 color swatch, both
  locale names (EN semibold, NL muted), truncated description line; inactive rows dimmed with an
  "Inactive" badge (active rows get no badge); actions: Edit, Deactivate (destructive tone,
  active rows) or Reactivate (no confirm — safe direction, inactive rows). Legacy rows without
  aggregateId keep actions disabled.
- **Reorder:** drag commits via the existing `gateway.adminCatalog.reorder` op (full
  {catalogCategoryId, sortOrder} list); optimistic order during drag, revert + toast on error.
- **CategoryDialog:** one Dialog, create/edit modes (edit-approve-dialog pattern, RHF + zod,
  re-seed on open); 2-col EN/NL names (required), stacked optional descriptions, ColorPicker.
  `sortOrder` and `isActive` removed from the form — create appends at max+1; activation is a
  row-level action only, so deactivation always passes the confirm.
- **Deactivate confirm:** new shadcn `ui/alert-dialog.tsx` primitive (+
  `@radix-ui/react-alert-dialog`) — no-outside-dismiss semantics for destructive confirms,
  reusable. Copy names the effect and the escape hatch. Replaces window.confirm and the
  page's raw `text-red-600` class.
- **Empty state:** dashed panel, Shapes icon, inline Add button.
- **Future consideration (recorded, not built):** at tens/hundreds of categories the page needs
  search; drag-reorder must be disabled while a search filter is active (reordering a filtered
  subset is ambiguous).

## Moderation backend

- **`moderationActions` table** (additive): `actorId` (`v.id("users")` or the literal `"system"`),
  `kind` (`definition_approved | definition_rejected | definition_edited_approved |
photo_restored | photo_removal_confirmed | photo_auto_rejected`), `targetLabel` (denormalized
  display title), `targetId`, `at`; index `by_at`. Stamped directly by the admin composition
  roots — the catalog domain events (`PuzzleDefinitionApproved/Rejected`) deliberately carry no
  actor, so an events projection cannot attribute "who". The photo pipeline's auto-rejections
  stamp `system` rows so "flags cleared" is complete.
- **`admin/getModerationStats`** (admin-gated query): trailing-7-day counts per kind from `by_at`
  plus average review time for definitions (decision `at` minus puzzle `createdAt` — an
  approximation, documented in code).
- **`admin/getModerationActivity`** (admin-gated query): newest-first page of `moderationActions`
  joined with actor display names.
- **Flagged Images:** `admin/listRejectedPhotos` over `ownedPuzzleImages` where
  `moderationStatus === "rejected"` (one new index), returning photo URL, classifier
  label/score, uploader, puzzle title. Mutations: `restorePhoto` (→ approved; stamps
  `photo_restored`) and `confirmPhotoRemoval` (deletes stored file + row; stamps; notifies the
  uploader with new notification type literal `photo_removed`). All server-side admin-gated.
- **Edit & Approve:** existing catalog update mutation runs first, then approve; stamping records
  `definition_edited_approved`. No new backend beyond the stamp.

## Console UI (`/admin/moderation`)

Per the handoff, translated to shadcn + `--jigsaw-*` tokens:

- ADMIN banner: shield pill + static subtitle. (Amended during implementation: the design's
  "you and N other moderators" roster needs a `listAdmins` query, but adminship lives only in
  each caller's Clerk JWT — no role is synced to the `users` table. Building webhook role-sync
  for a decorative line failed YAGNI; the roster is cut. Follow-up option: sync
  `publicMetadata.role` via the Clerk webhook if a real need appears.)
- KPI row: four stat tiles (approved / rejected / flags cleared / avg review time, "this week").
- Underline tabs with count pills — shadcn `tabs` added via the CLI (currently absent).
- Submissions tab: 360px queue list (active row: violet left rule + tint; "Possible dup" badge
  when the submission matches an existing title — reuse the catalog's existing
  suggestion/barcode lookup for the check) + detail pane (cover, metadata grid, submitter note,
  dup warning banner, actions: Approve & Publish / Edit & Approve — pre-filled Dialog reusing
  the definition form fields / Reject right-aligned in destructive tone).
- Flagged Images tab: severity via classifier score bands; blur-until-reveal guard over the
  image; two actions — Restore Photo (false positive; the design's "Dismiss Flag" collapses into
  this) and Confirm Removal (notifies uploader).
- Activity Log tab: bordered list rows (icon per kind, "who did what", relative time).
- Empty states: dashed "All clear" panels as designed. Mobile: list→detail stacking.

## Profile-edit dialog (`/people`)

`ProfileEditor`'s card leaves the page; a compact "Edit profile" button near the activity
`SectionHead` opens the same two fields (displayName, bio) in a `Dialog`, same save flow and
toasts. The freed right column lets the activity feed span full width.

## Riders

1. **Post-sign-in redirect:** `SignIn`/`SignUp` components get `fallbackRedirectUrl="/dashboard"`
   (explicit `redirect_url` params keep winning, so require-auth deep-link returns still work).
2. **Missing i18n key:** add `shell.pages.puzzles.description` ×3 catalogs (group-landing renders
   it for every group item today, showing the raw key on mobile) and audit sibling page keys for
   other missing `.description` entries.

## Testing

- Backend `.test.ts` (convex root): non-admin rejection for every new query/mutation; stats math
  over seeded actions; restore/confirm flows including the `photo_removed` notification; stamp
  rows written by approve/reject/edited-approve.
- Web: pure-helper tests for new mapping logic (severity bands, stat formatting) per repo
  convention; i18n parity ×3 verified.

## Delivery

New branch off `main`, one PR. `feat/conversation-messaging` (PR #32) also touches
`app-sidebar.tsx`: land this after #32 merges, or rebase over it. Production note: none — all
schema changes are additive and the feature is admin-only.

## Out of scope

- User-reported flags (reports/reasons/severity from members) — the design's report counts are
  mocked; v1 severity derives from classifier score.
- Moderator roles/permissions beyond the existing single admin role.
- The designer-pass restyle of the rest of the app.
