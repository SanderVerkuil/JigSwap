# Content-Width Conformance & Full-Width Page Designs

**Date:** 2026-07-14
**Status:** Approved (concepts selected via visual companion; all UI-Designer recommendations accepted except group landings, where the tile grid was deliberately chosen)

## Background

The dashboard shell applies the user's content-width preference centrally:
`ContentArea` (`apps/web/src/components/dashboard-layout/shell.tsx`) adds
`mx-auto max-w-[1180px]` only in centered mode; full-width is the default
(`ShellPreferencesProvider`, Clerk `unsafeMetadata.shellPrefs.fullWidth`).
A page conforms by NOT self-centering. The shell also owns the page header
(`PageHead`: breadcrumbs from `ROUTE_META` + title/subtitle + top-right actions
published via `usePageHeaderActions`/`usePageHeader`).

Audit found non-conformers: `/notifications` + `/notifications/preferences`
(hardcoded `container mx-auto max-w-3xl`, duplicate in-page headers, missing
`ROUTE_META` for preferences), `goals` (860px centered, width-jumping
skeleton), `borrowed` (`container mx-auto`, in-page header), the three
`GroupLanding` pages (820px capped, left-aligned), and the three form/detail
pages (`suggest-edit`, admin puzzle `edit`, proposal `$proposalId` — centered
2xl/3xl).

## Cross-cutting rules (apply to every redesigned page)

1. **No self-centering, ever.** Pages drop `container` / `mx-auto` / page-level
   `max-w-*`. Any width cap is left-aligned and applies to a COLUMN, not the page.
2. **Readable measure:** prose, form field stacks, and notification message text
   cap at `max-w-[42rem]`; surplus width goes to companion regions (rails,
   panels, extra grid columns), never stretched text/inputs.
3. **Breakpoint ladder:** reflow at `sm:`/`md:`; two-region splits at `lg:`/`xl:`
   with fixed rail tracks (`280–300px`) + `minmax(0,1fr)` mains; third grid
   columns only at `2xl:` so the 1180px centered mode always gets a complete
   layout. Region gaps `gap-6 lg:gap-10`; item grids `gap-4`/`gap-[18px]`.
4. **Shell-owned headers:** every page deletes in-page h1/subtitle blocks and
   publishes count-meta + primary actions top-right via `usePageHeaderActions`
   (or `usePageHeader` for dynamic crumbs). Back-buttons are replaced by shell
   breadcrumbs.
5. **Sticky asides** use `sticky` + `self-start` with the shell head offset and
   re-inline (never hide) their content below their breakpoint.

## Per-page designs (selected concepts)

### /notifications — "Grouped feed with filter rail"

`xl:grid-cols-[minmax(0,1fr)_280px]`. Feed: date-grouped sections
(Today/Yesterday/Earlier) of columnar rows (icon | title+message | category
badge | tabular relative time | mark-read action). Sticky right rail: unread
stat, category filter pills (from `NOTIFICATION_CATEGORIES`), unread-only
toggle, push-status line + link to preferences. Mobile: rail becomes a
horizontal pill row above the feed; rows stack as today. Header slot: title/
subtitle from ROUTE_META; actions top-right = Preferences (outline, links to
`/notifications/preferences`) + Mark all read. Duplicate in-page header
removed. Filters are client-side state over the already-loaded list.

### /notifications/preferences — "Sticky aside plus matrix"

`lg:grid-cols-[300px_minmax(0,1fr)]`. Left sticky aside: `PushDeviceSection`,
the `channelsNote` explainer, category jump links (anchors per category
section). Right: `ChannelMatrix` unchanged internally, capped `max-w-[880px]`
left-aligned. Mobile: single column (push first, stacked matrix as today).
NEW `ROUTE_META` entry for `/notifications/preferences` (group: notifications;
`shell.pages.notificationPreferences` i18n) so breadcrumbs read
Notifications › Preferences and the shell title is correct; the in-page
back-link and h1 are removed.

### /goals — "Goal tile grid, achieved shelf"

Drop `mx-auto max-w-[860px]`. Goals tile in `grid gap-x-10 gap-y-8
md:grid-cols-2 2xl:grid-cols-3` (card-free block per goal as today). Two
`SectionHead` sections: Active, then Achieved. Skeleton uses the same grid
(fixes the load width-jump). Existing header-slot actions unchanged.

### /borrowed — "Loan card grid"

Drop `container mx-auto` + in-page header. `grid gap-4 sm:grid-cols-2
xl:grid-cols-3` of restructured loan cards: header (package chip + title +
piece badge), meta (lender, opened-ago), divider, action footer (Log solve /
Return). Header slot: borrowed-count meta.

### Group landings (library / community / admin) — "Launcher tile grid"

(Deliberate pick over the row-directory recommendation: these should feel like
a "home" surface.) `GroupLanding` renders bordered tiles `grid gap-4
sm:grid-cols-2 xl:grid-cols-3`: icon chip, title, 2-line clamped description,
hover chevron. Left-alignment bug disappears with the cap. Accepted caveat:
introduces card tiles into an otherwise card-free shell language; 4-item
groups leave an unbalanced last row.

### suggest-edit + admin puzzle edit — "Form with sticky context panel"

Replace `mx-auto max-w-2xl` with `lg:grid-cols-[minmax(0,42rem)_minmax(280px,22rem)]
gap-10`. Left: field stack unchanged. Right sticky panel: large cover-image
preview with state label + Replace/Edit controls, live "changes to be
submitted" summary (derived from the existing `buildProposalArgs`/dirty
logic), and the Cancel/Submit row. Below `lg:` everything re-inlines to
today's single column.

### admin proposal detail — "Diff table with review rail"

Replace `mx-auto max-w-3xl`. Main: diff rows become
`md:grid-cols-[minmax(140px,200px)_1fr_1fr]` (field+conflict badge | current |
proposed), image thumbnails in the same columns with Compare under proposed,
conflict notes spanning the value columns. Right rail at
`xl:grid-cols-[minmax(0,1fr)_300px]` (sticky): proposer, date, status badge,
comment, rejection reason, conflict count, Back/Reject/Approve. Mobile: falls
back to today's stacked lines with actions at the bottom.

## Testing / verification

- Existing suites stay green (`notification-meta` test etc.); no backend
  changes anywhere in this spec.
- Per-page visual verification on the preview deployment in BOTH width modes
  (toggle via avatar menu → preferences) and mobile widths.
- Grep gate: no `mx-auto`/`container` at any `_dashboard` route root after the
  change (narrow caps allowed only on columns per rule 2).

## Out of scope

- Any behavioral/backend change (filters are client-side only).
- Messages pages, admin tables, and other already-conforming pages.
- Persisting notification-feed filter state.
