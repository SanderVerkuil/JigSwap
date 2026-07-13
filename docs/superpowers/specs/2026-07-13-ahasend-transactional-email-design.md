# Transactional Email via AhaSend + Localized Notifications

**Date:** 2026-07-13
**Status:** Approved

## Goal

Deliver transactional email for high-value notifications through AhaSend (Dutch EU
provider, REST API, jigswap.site domain already verified), and localize notification
copy (en/nl) across both email and in-app channels.

## Decisions made during brainstorming

- **Provider:** AhaSend (`POST /v2/accounts/{account_id}/messages`, Bearer auth,
  `Idempotency-Key` header, `sandbox` flag for safe testing).
- **Scope:** Subset of notification types is email-eligible (12 types):
  `trade_request`, `trade_accepted`, `trade_declined`, `trade_completed`,
  `trade_cancelled`, `message_received`, `new_follower`, `follow_request_received`,
  `follow_request_approved`, `review_received`, `puzzle_favorited`, `goal_achieved`.
  Moderation/admin/dispute types stay in-app/push only.
- **Templates:** react-email components in a new `packages/email` package.
- **Localization:** Approach A — notifications store structured `type` + `params`
  and are rendered at the edges: web renders in the viewer's current locale via
  `use-intl`; email renders at send time in the recipient's `preferredLanguage`
  (en/nl, default en).
- **No digest/batching, no retry component (workpool)** — out of scope.

## Architecture

```
domain event ──> subscriber.translate()
                   produces { recipientId, type, params, relatedId }
                        │
                        ▼
                 notify-member use case (domain)
                   loads preferences, filters channels
                   email additionally gated by EMAIL_ELIGIBLE_TYPES
                        │
          ┌─────────────┼──────────────┐
          ▼             ▼              ▼
      inApp channel   email channel   push channel
      persists row    schedules       (unchanged)
      {type, params}  sendEmail action
          │                │
          ▼                ▼
      web renders via   action renders react-email template in
      use-intl in       recipient's preferredLanguage, sends
      viewer's locale   via AhaSend adapter (fetch)
```

## Data model & domain changes

- `notifications` table (`packages/backend/convex/schema.ts`): add
  `params: v.optional(v.record(v.string(), v.string()))`; make `title` and
  `message` optional. New rows store `type` + `params` only; legacy rows keep
  their strings. No data migration.
- Params are flat string maps per type (e.g. `trade_request` →
  `{ actorName, puzzleTitle }`). The domain package defines a per-type params
  contract so subscriber and renderers agree, type-enforced where practical.
- `NotifyMemberCommand` drops `title`/`message`, carries `type` + `params`.
- New domain constant `EMAIL_ELIGIBLE_TYPES` (the 12 types above); the
  notify-member use case only considers the email channel for eligible types,
  regardless of stored preferences.
- `packages/backend/convex/notifications/subscriber.ts` stops rendering English
  strings and emits `params` instead.
- **Push channel dependency:** `pushChannel` currently forwards `title`/`message`
  to `sendWebPush`. The English copy moves out of the subscriber into a small
  backend renderer `renderNotificationText(type, params)` (plain string table
  covering all 21 types); the push channel calls it at schedule time. Push stays
  English-only (localizing push copy is out of scope).

## Email pipeline

### `packages/email` (new package)

- react-email templates: one shared layout (logo, heading, body, CTA button,
  footer with "manage email preferences" link) + one template per eligible type.
- Copy as plain TS objects `{ en: {...}, nl: {...} }` per type (subject, body,
  CTA label). Hand-maintained; Crowdin integration is future work.
- Exports `renderEmail(type, params, locale) → { subject, html, text }`.
- CTA URLs built from a base URL + per-type path mapping using `relatedId`
  (e.g. `/trades/{id}`).
- react-email preview server (`email dev`) available for authoring.

### Send action

- `packages/backend/convex/notifications/sendEmail.ts` signature becomes
  `{ to, toName, type, params, locale, relatedId, idempotencyKey }`.
- Renders via `renderEmail`, passes `{ to, toName, subject, html, text,
idempotencyKey }` to the `EmailSender` port (port stays render-agnostic).
- Risk to validate first: `@react-email/render` in Convex's default runtime;
  if it fails, mark the action `"use node"`.
- Idempotency key: `{domainEventId}:{recipientId}` so a retried dispatch
  cannot double-send.

### AhaSend adapter

- New `packages/backend/convex/notifications/adapters/ahasendEmailSender.ts`:
  single `fetch` to
  `POST https://api.ahasend.com/v2/accounts/{AHASEND_ACCOUNT_ID}/messages` with
  `Authorization: Bearer {AHASEND_API_KEY}`, `Idempotency-Key`, body
  `{ from: {email, name}, recipients: [{email, name}], subject, html_content,
text_content }`.
- `makeEmailSenderFromEnv` branches: both `AHASEND_API_KEY` and
  `AHASEND_ACCOUNT_ID` set → AhaSend adapter; otherwise existing no-op (dev and
  preview deployments keep dropping emails safely). Env read lazily inside
  handlers per repo convention; adapter takes injectable `env` for tests.

### Configuration

> **Superseded (2026-07-13 follow-up):** EMAIL_FROM now defaults to no-reply@jigswap.site (optional), AHASEND_SANDBOX defaults to true — production sets AHASEND_SANDBOX=false. The env commands below reflect the original design.

Env vars set via `npx convex env set`, documented in
`packages/backend/.env.example` (stale `KNOCK_*` entries removed):

| Var                  | Example                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `AHASEND_API_KEY`    | `aha-sk-…`                                                                                                                       |
| `AHASEND_ACCOUNT_ID` | account UUID                                                                                                                     |
| `EMAIL_FROM`         | `notifications@jigswap.site`                                                                                                     |
| `EMAIL_FROM_NAME`    | `JigSwap`                                                                                                                        |
| `EMAIL_BASE_URL`     | web app origin for CTA links, e.g. `https://jigswap.site` (new var — no existing web-origin var exists on the Convex deployment) |

## Web app changes

- Notification components render from `type` + `params` via `use-intl` keys
  (`notifications.types.<type>.title` / `.message`) added to `en.json`,
  `nl.json`, `source.json` (flows through Crowdin). Legacy rows without
  `params` fall back to stored `title`/`message`.
- Preferences channel matrix disables the email checkbox for non-eligible
  types with a hint.

## Error handling

- AhaSend non-2xx / network error → action throws. Scheduled actions run at
  most once, so that email is dropped — accepted: the in-app notification
  already exists, and retry infrastructure (workpool) is explicitly out of
  scope.
- Failures logged via existing `lib/logEvent` (Axiom) with type + recipient so
  misconfiguration (bad key, unverified domain) is visible.
- Missing env vars → no-op sender with a log line, never a crash.

## Testing

Repo conventions: domain `.spec.ts`, backend `.test.ts` at `convex/` root.

- **Domain:** notify-member gates email by `EMAIL_ELIGIBLE_TYPES` ×
  preferences; per-type params contracts.
- **Backend:** subscriber emits correct `type`/`params` per event; AhaSend
  adapter builds correct request and handles error responses (mocked `fetch`);
  `makeEmailSenderFromEnv` branching.
- **Email package:** `renderEmail` content tests for en + nl (subject, param
  interpolation, CTA URL).
- **Live verification:** send with AhaSend `sandbox: true` from the dev
  deployment; confirm HTTP 202 with `queued` status.

## Out of scope

- Digest/batching of rapid-fire notifications.
- Retry/durability component (`@convex-dev/workpool`).
- Localizing push notification copy.
- Crowdin integration for email copy.
- Email verification state; addresses come from Clerk and are trusted.
