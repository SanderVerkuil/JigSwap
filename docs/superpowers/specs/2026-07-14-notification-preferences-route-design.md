# Notification Preferences: Dedicated Route

**Date:** 2026-07-14
**Status:** Approved

## Problem

The "Notification preferences" button on `/notifications` calls Clerk's imperative
`openUserProfile()`, which opens the GENERIC profile modal — without the custom
tabs (`UserButton.UserProfilePage`, incl. the notification preferences panel)
that only exist on the avatar-menu `<UserButton>` modal. Clerk cannot deep-link
the imperative modal to a custom page at all.

## Design

- New route `/_dashboard/notifications/preferences` rendering the existing
  self-contained `NotificationPreferencesPanel` as a normal dashboard page,
  reusing the existing `notifications.preferencesTitle` / `preferencesSubtitle`
  / `backToNotifications` i18n keys.
- The `/notifications` button becomes a router `Link` to that route — it opens
  directly on the preferences panel by default.
- The Clerk avatar-menu modal keeps its custom tabs unchanged; both surfaces
  render the same panel component, so they cannot drift.
- `packages/email`'s footer "Manage notification preferences" link changes from
  `{baseUrl}/notifications` to `{baseUrl}/notifications/preferences` (test
  updated to assert the exact URL).

## Out of scope

Making the imperative Clerk modal carry custom pages (vanilla-JS mount API,
still cannot open on a custom tab).
