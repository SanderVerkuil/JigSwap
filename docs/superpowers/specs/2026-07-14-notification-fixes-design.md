# Notification Preference Integrity, Email Locale Sync, Catalogue Image Fit

**Date:** 2026-07-14
**Status:** Approved

Three small fixes, one PR off main (post-#64).

## Fix 1 — preference toggles: absent ≠ off

Bugs (verified in `packages/domain/src/notifications/domain/notification-preference.ts`
and `packages/backend/convex/notifications/getMyPreferences.ts`):

- `set()` seeds a missing type entry from `emptyChannelToggles()` (all-off), so the
  first email/push enable on an untouched type silently disables its in-app delivery.
- `allows()` gives stored entries absolute precedence with `stored[channel] === true`,
  so the corrupted entries (absent `inApp` key) read as off.
- `getMyPreferences` returns RAW stored toggles: types absent from older rows render
  as all-off in the matrix while deliveries follow defaults — and clicking in-app on
  is a domain no-op, matching the reported "can only enable in-app after email/push".

Fix (domain + one query; no migration):

- `allows()` falls back PER CHANNEL: `stored[type]?.[channel] ?? defaultToggles()[type][channel]`.
  Deliberate disables always wrote an explicit `false`, so an absent channel key only
  exists via the seeding bug — this heals corrupted rows retroactively.
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
`gateway.users.updateProfile({ preferredLanguage: locale })` once per mismatch
(guard against loops/spam with a ref). Switcher-agnostic; self-heals existing users
on next app load.

## Fix 3 — catalogue puzzle images contained

`PuzzleCardShell` already supports `imageFit: "cover" | "contain"` (default cover);
only my-puzzles passes `contain`. Pass `imageFit="contain"` at the puzzle-catalogue
call sites (browse / puzzles listing). Enumerate remaining `cover` surfaces in the
implementation report for a later product decision; do not change them.

## Out of scope

Data migration (fix 1 heals in place); changing other image surfaces; per-switcher
locale wiring (the shell sync covers all of them).
