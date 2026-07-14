# Presence-Aware Message Notifications

**Date:** 2026-07-14
**Status:** Approved
**Depends on:** the AhaSend transactional-email PR (#64) — params-based subscriber and
notification pipeline. Independent of (and separate from) the preferences-categories spec.

## Goal

When the recipient of a new message is already on the messages page, don't
notify them out-of-band — no email, no push, and no bell (in-app) row. Instead
the open tab shows a toast (no sound). Rationale: they are already looking at
the surface where the message lands.

## Decisions (from brainstorming)

- **Presence scope:** anywhere on `/messages` (thread list or any thread) — not
  just the receiving thread.
- **Suppression scope:** ALL channels for `message_received`, including the
  in-app bell row. The live message + toast is the notification.
- **Pling:** toast only, no sound. Toast appears only when the new message
  lands in a thread other than the one on screen; the active thread just
  renders the message live.
- **Presence mechanism:** the official `@convex-dev/presence` component — the
  repo's FIRST Convex component (introduces `convex.config.ts`).

## Architecture

```
web /messages layout ──heartbeat──> presence component (room "messages")
                                            │
MessagePosted event ─> subscriber ──isViewingMessages(recipient)?──┐
                                            │yes                   │no
                                   drop recipient entirely   notify as today
                                   (no bell/email/push)      (bell + opted-in email/push)
```

### Backend

- `packages/backend/convex/convex.config.ts` (new): registers the presence
  component. NOTE: first component in the repo — `_generated` output changes
  shape; the implementation plan must address codegen in worktrees.
- `packages/backend/convex/presence.ts` (new): thin auth-gated wrappers around
  the component's heartbeat/disconnect API. Room id is the constant
  `"messages"`; the presence user id is the member's user `_id`
  (`requireMember` inside — never client-supplied).
- Subscriber gate (`notifications/subscriber.ts`, `MessagePosted` case only):
  after resolving recipients, drop every recipient for whom
  `isViewingMessages(ctx, userId)` is true. The check lives behind a small
  injectable seam so subscriber tests stub it without booting the component.
- **Fail-open:** any presence-check error means "not viewing" — a presence
  hiccup must never block or duplicate notification delivery, and must never
  throw inside the dispatch mutation.

### Web

- The `/messages` route layout mounts the component's React presence hook
  (heartbeat while mounted, including on the thread list; the component
  handles tab close/disconnect promptly, keeping the staleness window small).
- Toast watcher in the messages layout: the existing live thread-list
  subscription is diffed client-side; a new message in a thread OTHER than the
  active one shows a toast via the app's existing toast system — "New message
  from {name}", click navigates to that thread. New i18n keys (en/nl/source).

## Accepted trade-offs

- If the user leaves `/messages` in the small window between their last
  heartbeat expiring server-side and a message landing, they may get neither
  an out-of-band notification nor a bell row; the unread state on the messages
  page is then the only trace. Accepted by design (chosen over double-notifying
  people who are actively reading).
- Multi-device: presence on ANY device suppresses notifications for all
  devices. Accepted — matches the "they're reading it" intent.

## Error handling

- Presence wrappers are auth-gated; heartbeat failures are non-fatal to the UI.
- Subscriber seam is fail-open (deliver on error) and never throws into the
  dispatch transaction.

## Testing

- Backend: subscriber tests with the seam stubbed (present → zero commands for
  that recipient; absent → unchanged behavior; error → unchanged behavior).
- Web: toast watcher logic unit-tested where practical; end-to-end via preview
  deployment (two accounts, one on /messages).
- Existing suites must stay green; mutation gates unchanged (domain untouched).

## Out of scope

- Sound, browser Notification API, unread-count changes on the messages page.
- Presence for any other page or notification type (the gate is
  `message_received`-only).
- The preferences-categories redesign (separate spec).
