# Notification Preferences: Category Grouping with Toggle-All

**Date:** 2026-07-14
**Status:** Approved
**Depends on:** the AhaSend transactional-email PR (#64) — `EMAIL_ELIGIBLE_TYPES`, the email column gating, and the current `channel-matrix.tsx` shape.

## Goal

The notification preferences page lists 21 type rows and has become hard to scan.
Group the types into five categories with per-category toggle-all controls per
channel (in-app / email / push), keeping every per-type switch visible
(sectioned-matrix layout, chosen from mockups).

## Categories

Defined in `apps/web/src/components/notifications/notification-meta.ts` as
`NOTIFICATION_CATEGORIES: readonly { key; types }[]` (order = display order):

| Key           | Types (in current display order)                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `trades`      | trade_request, trade_accepted, trade_declined, trade_completed, trade_cancelled, exchange_proposed, exchange_disputed |
| `messages`    | message_received                                                                                                      |
| `social`      | new_follower, follow_request_received, follow_request_approved, puzzle_favorited, review_received, goal_achieved      |
| `submissions` | puzzle_approved, puzzle_rejected, proposal_approved, proposal_rejected, photo_removed                                 |
| `admin`       | admin_proposal_filed, admin_definition_submitted — hidden for non-admins exactly as today                             |

Every `NotificationType` appears in exactly one category (pinned by a test).
Category labels + one-line descriptions come from new i18n keys
`notifications.categories.<key>.title` / `.description` in `en.json`,
`nl.json`, `source.json`.

## UI (`channel-matrix.tsx`)

Sectioned matrix: the existing type rows stay as-is, grouped under a header row
per category.

- **Header controls are tri-state checkboxes** (shadcn/Radix `Checkbox`, which
  supports `indeterminate` — `Switch` does not): checked = all controllable
  types in the category enabled for that channel; unchecked = none;
  indeterminate = mixed.
- **Click semantics:** mixed or unchecked → enable all; checked → disable all.
- **Email eligibility:** header email checkboxes act only on
  `EMAIL_ELIGIBLE_TYPES` members and are disabled with the existing
  `emailUnavailable` hint when the category has zero eligible types
  (`submissions`, `admin`). Per-type email switches keep their current gating.
- **Mobile:** the stacked layout gains a category heading with the same three
  labelled header controls per group; per-type stacks unchanged beneath.
- Desktop a11y mirrors the current pattern (`role="grid"`, header checkboxes
  labelled by category row + channel column).

## Backend

New mutation `packages/backend/convex/notifications/setNotificationPreferences.ts`:

- Args: `{ updates: Array<{ type: <literal union>, channel: <literal union>, enabled: boolean }> }`,
  validated with the same literal validators as the existing single-toggle
  mutation; hard cap 63 entries (21 types × 3 channels).
- Auth via `requireMember`; backed by a new domain use case
  `update-notification-preferences` (plural) that loads the member's
  `NotificationPreference` aggregate once, applies every update via the
  existing `enable`/`disable` methods, saves once (atomic), drops the leaf
  `PreferenceChanged` events as today.
- The existing single-toggle mutation and per-type switches stay unchanged.
- The client sends one bulk call per header-checkbox click (only the
  channel-eligible types of that category), with optimistic update of the
  whole category, mirroring the current optimistic pattern.

## Error handling

Bulk mutation is atomic (single aggregate save); a failure leaves preferences
untouched and surfaces the existing `preferencesError` toast. Unknown
type/channel values are rejected by validators.

## Testing

- Domain: spec for the new plural use case (applies all updates, single save,
  no partial state); mutation-testing gates apply (package break threshold 95).
- Backend: `.test.ts` for the mutation (auth, bulk apply, cap).
- Web meta: test pinning that `NOTIFICATION_CATEGORIES` covers all 21 types
  exactly once.
- Visual verification on the preview deployment.

## Out of scope

- Any change to notification delivery or the presence feature (separate spec:
  `2026-07-14-presence-aware-message-notifications-design.md`).
- Migrating stored preferences; category state is always derived from per-type
  toggles.
