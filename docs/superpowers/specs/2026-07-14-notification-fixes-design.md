# Notification Preference Integrity, Email Locale Sync, Catalogue Image Fit

**Date:** 2026-07-14
**Status:** Approved

Three small fixes, one PR off main (post-#64).

## Fix 1 — preference toggles: absent ≠ off

Bugs (verified in `packages/domain/src/notifications/domain/notification-preference.ts`
and `packages/backend/convex/notifications/getMyPreferences.ts`):

- `set()` seeds a missing type entry from `emptyChannelToggles()` (all-off), so the
  first email/push enable on an untouched type silently disables its in-app delivery.
  Note: that seeding always wrote FULL triples with an explicit `inApp: false` — never
  partial entries.
- `allows()` gives stored entries absolute precedence with `stored[channel] === true`,
  so a channel key absent from a stored entry reads as off instead of falling back to
  its default (a latent hazard for channels added after a row was written).
- `getMyPreferences` returns RAW stored toggles: types absent from older rows render
  as all-off in the matrix while deliveries follow defaults — and clicking in-app on
  is a domain no-op, matching the reported "can only enable in-app after email/push".

Fix (domain + one query; no migration):

- `allows()` falls back PER CHANNEL: `stored[type]?.[channel] ?? defaultToggles()[type][channel]`.
  The fallback's genuine role is type-level absence (untouched types, or types added
  after the row was written) and forward-compat for channels added later. Rows already
  corrupted pre-fix carry an explicit `inApp: false` indistinguishable from a deliberate
  email-only configuration, so NO migration can repair them without clobbering
  legitimate choices — accepted loss, mitigated because the in-app toggle now works and
  affected members can re-enable themselves.
- `set()` seeds missing entries from `defaultToggles()[type]`.
- New `resolvedToggles()` on the aggregate: full 21-type map, stored values winning
  per channel over defaults. `getMyPreferences` returns it in both branches (stored
  row → rehydrated aggregate; no row → default aggregate).
- TDD: failing specs reproduce both bugs first; mutation gate ≥95 on the file;
  backend test: a stored row missing newer types yields the resolved map.

## Fix 2 — email locale never reaches the backend

`users.preferredLanguage` is hardcoded `"en"` on creation and only written by
`updateUserProfile`; the app's language lives in the `jigswap-intl` cookie. Emails
localize from `preferredLanguage` → everyone gets English.

Fix: a `SyncPreferredLanguage` null-component mounted in the dashboard shell — when
authenticated and `useLocale()` differs from the member's `preferredLanguage`, call
`gateway.identity.updateProfile({ preferredLanguage: locale })` once per mismatch
(guard against loops/spam with a ref). Switcher-agnostic; self-heals existing users
on next app load.

## Fix 3 — catalogue puzzle images contained

`PuzzleCardShell` already supports `imageFit: "cover" | "contain"` (default cover);
only my-puzzles passes `contain`. Pass `imageFit="contain"` at the puzzle-catalogue
call sites (browse / puzzles listing). Enumerate remaining `cover` surfaces in the
implementation report for a later product decision; do not change them.

## Out of scope

Data migration — corrupted rows are indistinguishable from deliberate email-only
configs; self-service repair via the now-working toggle. Changing other image
surfaces; per-switcher locale wiring (the shell sync covers all of them).

## Fix 4 — completion duration semantics (added same day)

- `Completion.resolveDuration` (record/finish/edit paths): when no explicit
  duration is given and `startDate.getTime() === endDate.getTime()` (date-only
  inputs → same local midnight), derive 1 day (1440 minutes) instead of
  `undefined`. Larger spans keep deriving the actual difference.
- `SolveDuration.ofMinutes`: round BEFORE validating so a tiny positive span
  yields 1 minute, never a stored 0 (current order can store 0 for <30s spans).
  `between` inherits the fix.
- Display (`completions/index.tsx` `formatTime` and any sibling formatter):
  day-aware — whole days render as "N day(s)" (nl "dag(en)"), day+hour+minute
  composition for mixed spans; sub-day formatting unchanged. New locale keys in
  en/nl/source.
- Existing rows are not migrated; a stray 1-minute row is user-editable.

## Fix 5 — nl terminology: voltooiing, not oplossing

Align the solve-logging/completions/insights/export strings in `nl.json`
(~20 occurrences of "oplossing*") to the "voltooiing*" family the marketing
pages already use. Per-string grammatical rewrites (e.g. "Voltooiing
vastleggen", "Voltooiing afronden", "Moeilijkste voltooiing", "Voltooiingen
per maand" — never a blind replace). `en.json`/`source.json` untouched except
where a key is display-shared. Only genuinely solve-related strings change;
unrelated uses of "oplossing" (if any) stay.

## Fix 6 — preferences panel/matrix adapt to CONTAINER width

The `NotificationPreferencesPanel` + `ChannelMatrix` render both on the
dedicated page and inside the Clerk profile modal; their viewport breakpoints
(`lg:` aside split, `sm:` matrix desktop/stacked split) overflow the narrow
modal on wide screens. Fix with Tailwind v4 container queries (pattern already
in the repo, `card.tsx`):

- Panel root: named container `@container/prefs`; the aside grid + sticky
  variants move from `lg:` to `@4xl/prefs:` (~56rem actual width).
- Matrix: own named container `@container/matrix`; the desktop-grid vs stacked
  split moves from `sm:`/`sm:hidden` to `@2xl/matrix:` (~42rem — what the
  switch columns + labels genuinely need). Jump-to links already resolve the
  visible branch at click time — unchanged.
- Accepted consequence: layouts respond to actual available space (e.g. a
  ~1024px window with the sidebar gets single-column on the dedicated page
  until the aside genuinely fits).

## Fix 7 — matrix is a table at EVERY container width (supersedes the stacked variant)

Owner decision after seeing Fix 6 on small viewports: the stacked per-type
mobile variant looks off; the matrix renders as ONE table everywhere:

| icon+name / description | In-app | Email | Push |

- Single grid branch at all container sizes; the `@2xl/matrix:hidden` stacked
  branch is DELETED (large net deletion). Category header rows unchanged.
- Column recipe: name cell `minmax(0,1fr)` (icon + name, description beneath,
  truncation-safe); channel columns `3rem` below the `@2xl/matrix` container
  threshold, `5.5rem` above it. Channel header labels shrink accordingly
  (smaller text size on narrow containers; never dropped).
- Jump-to links revert to plain `id="category-<key>"` anchors (single branch —
  the duplicate-id/offsetParent workaround is obsolete and removed).
- A11y grid roles unchanged; the `@container/matrix` wrapper stays (it now
  only drives column widths).

## Fix 8 — fastest-finish stats: stored duration wins; day-aware profile display

`finishMinutesOf` (`packages/backend/convex/library/getCopyInstanceView.ts`)
prefers `(endDate - startDate)` OVER the stored `completionTimeMinutes` —
inverted precedence vs the domain (explicit/stored duration always wins).
Same-day rows derive 0; post-Fix-4 rows storing 1440 are ignored.

- Fix precedence: stored `completionTimeMinutes` first; date-diff fallback only
  for legacy rows without one; a zero/negative fallback result returns null
  (unknown), never 0. Applies to both consumers (per-solver `finishMinutes`
  and `fastestFinishMinutes`).
- Profile records display (`profile-body.tsx`, `members.profile.minutesValue`):
  day-aware — whole-day values render as days ("1 dag"), mixed as day+hour,
  sub-day unchanged (reuse the Fix 4 key pattern in the `members.profile`
  namespace).
- Backend test pinning: same-day row with stored 1440 → fastest = 1440;
  legacy row without stored duration and equal dates → excluded (null).
- NOT fixed by design: existing rows storing a literal 1 from pre-fix testing
  (edit/delete the completion to clear them).
