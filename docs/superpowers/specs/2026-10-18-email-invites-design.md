# Email invitations for people not on JigSwap yet

Status: APPROVED SCOPE (user, 2026-10-18). Tracking: #222.
Code basis: `origin/main` at 3aa836ce90. That includes confirm-first connection offers (#197), household invite links, circle invitations and circle deletion (#182, #183, #187), blocking (#167–#172), and the account-deletion purges for invites, offers and follows (#237, #247).

Scope, as decided by the user:

- Clerk's invitation system keeps track of invitations, but **we own the email**: `createInvitation({ notify: false })`, and we send one email of our own through `packages/email`.
- Only for people who are **not on JigSwap yet**, in two places:
  - **E1**: the find/follow-friends flow ("Invite by email").
  - **E2**: adding someone to your household.
- **Not for circles.** Circle invites go to existing members through the in-app flow that already shipped (#182/#183).
- Confirm-first, as in #197. An invitation never follows anyone automatically.

## E.0 Clerk facts

Sources: `@clerk/backend@3.25.0` (installed: `api/endpoints/InvitationApi.d.ts`, `api/resources/Invitation.d.ts`, `api/resources/Webhooks.d.ts`) and the Clerk docs for create-invitation, users/invitations and backend-invitation.

- `createInvitation({ emailAddress, redirectUrl?, publicMetadata?, notify? (default true), ignoreExisting? (default false), expiresInDays? (default 30), templateSlug? })`.
- `notify: false` sends no Clerk email.
- Without `ignoreExisting`, Clerk returns an error when the address was already invited or already has an account. We never pass `ignoreExisting`.
- The returned `Invitation` has `id`, `emailAddress`, `publicMetadata`, `status`, `url?`, `revoked?`, `createdAt`, `updatedAt`. It has no `expiresAt`, so we keep our own expiry.
- On sign-up, the invitation's `publicMetadata` becomes the user's public metadata. Only the Backend API can write public metadata, so a client can't forge it.
- Revoking blocks the link. It does not stop the person from signing up on their own.
- There are **no webhooks for application invitations** (the `WebhookEvent` union only has `organizationInvitation.*`). Acceptance is seen through `user.created`, which carries `public_metadata`, in our svix-verified handler (`convex/http.ts`). We drive revoke and expiry ourselves.
- Clerk rate-limits invitation creation (100/hour, application-wide). Our per-inviter limit is far below that, and a deployment-wide budget (`CLERK_INVITES_HOURLY_CAP`, default 60/hour) keeps all inviters together below it.
- `deleteInvitation(id)` exists (installed d.ts): it "permanently deletes the given invitation and the copies of the invitation email Clerk stored for its recipient", for any status. We revoke and then delete every invitation we retire.

**TO VERIFY (open; the user tests this on the Clerk dev instance; agents never call the Clerk API):**

1. Does `createInvitation` return `invitation.url` when `notify: false`?
2. Does a `redirectUrl` of `<site>/sign-up` consume the ticket with the TanStack Start Clerk `<SignUp />`?
3. Does Clerk keep a revoked or expired invitation, with its address, and does `deleteInvitation` remove it (and is a revoke before the delete still needed)?

Everything below is built behind an `InvitationGateway` port, tested with a fake, and stays inert until it's switched on (see E.1, "Switch").

- If (1) is **no**, our own email can't carry the link. E1/E2 stop for a product decision. The real adapter treats a missing `url` as a failure: it revokes best-effort and sends nothing.
- If (2) is **no**, only the `redirectUrl` constant changes.

## E.1 Shared mechanism (`convex/invitations/`)

### Switch

The feature is on only when both `INVITE_EMAIL_HMAC_KEY` and `CLERK_SECRET_KEY` are set in the Convex env. Otherwise:

- `sendEmailInvite` refuses with `EmailInvitesUnavailable`;
- the query `getEmailInviteAvailability` returns `false`;
- the web hides the entry points.

Setting the key on a deployment is a coordinator step, done after the TO VERIFY items pass.

### `invitations/sendEmailInvite({ kind: "follow" | "household", email })` (action)

1. **Member-gated.** The inviter is always the authenticated member.
   - For `household`, the inviter must be the admin of a household. Otherwise the action refuses with the existing household error. That error is about the inviter, never about the invitee.
2. **Normalise the address:** trim, lowercase, HTML-spec email syntax, at most 254 characters. Otherwise `InvalidEmail`.
3. **Per-inviter rate limit:** `emailInvite`, 10 per day, shared by E1 and E2.
   - It uses the in-house limiter (`lib/rateLimits`) in its own mutation, before any other work, so it commits even when a later step fails.
   - Refused: `RateLimited` with `retryAfterMs`.
4. **One local reference row** is always written, whatever happens next, so the inviter's pending list looks the same in every case: `emailInvites { aggregateId, kind, inviterId, householdId?, clerkInvitationId?, fallback?, createdAt, expiresAt = +14 d }`.
   - It stores **no email address**. The pending list shows "Invitation sent {date}" without one.
5. **Per-address cap:** 1 invitation email per 30 days across all inviters.
   - The address is kept only as `HMAC-SHA256(INVITE_EMAIL_HMAC_KEY, email)` in `emailInviteSendLog { emailHmac, sentAt }`. Rows older than 30 days are ignored and deleted by a scheduled cleanup.
   - Over the cap: nothing more happens, and the action still answers `sent`.
6. **Existing member?** An internal query on `users.by_email` (our verified-email mirror).
   - If one exists, take the kind's **in-app fallback** (E1/E2 below) and answer `sent`. No email goes to an existing member, and no Clerk call is made.
7. **Otherwise call** `gateway.create({ email, redirectUrl: <EMAIL_BASE_URL>/sign-up, expiresInDays: 14, publicMetadata: { jsInvite: { kind, ref: aggregateId } } })`.
   - The metadata carries only our opaque row id, never names.
   - First charge the deployment-wide Clerk budget. Spent: no Clerk call, no email, answer `sent`, and log `rateLimit.refused`.
   - "Already exists" or "already invited" from Clerk (a race with our mirror): no email, answer `sent`.
   - A missing `url`: revoke and delete best-effort, no email, answer `sent`, and log `emailInvite.no_url`.
8. **Send one email** through `packages/email` with the new `invite` template:
   - in the inviter's locale (the invitee has none yet);
   - it names the inviter by their display name (length-capped, newlines, control and bidi/format characters stripped) and states the purpose: following each other, or joining their household;
   - it is sent from "JigSwap", never from the inviter's name;
   - **no free-text note.**
   - The subject contains no user text other than the inviter's name.
   - The footer says who invited them and that, if they ignore it, JigSwap doesn't keep their address and the invitation stops working after 14 days. It claims nothing about the sign-in provider.
   - Then record the send in the send log.
9. **The response is always `{ status: "sent" }`** for a well-formed address within the limits, whether or not the address has an account (no enumeration).
   - Once step 4 has committed, every outcome (capped, existing member, any Clerk answer, sent, any failure, a throw included) answers `sent` no sooner than 2500 ms plus up to 500 ms of jitter after the call started, so the timing says nothing about the address either.

**No reminders.** One email only.

### Other functions

- **`invitations/listMyEmailInvites({ kind })` (query):** the inviter's own rows, as `{ inviteRef, kind, createdAt, expiresAt }`. Lapsed rows are filtered on read.
- **`invitations/revokeEmailInvite({ inviteRef })` (action):**
  - Only the inviter can revoke. Any other ref gets the same generic `EmailInviteUnavailable`.
  - It revokes and deletes the Clerk invitation best-effort, withdraws a still-pending in-app fallback (see E1/E2), and deletes the row.
- **Expiry:** a scheduled `expireEmailInvite` at `expiresAt` withdraws a still-pending in-app fallback, revokes and deletes the Clerk invitation best-effort, and deletes the row. Reads also check `expiresAt`.
- **Sign-up:** in `convex/http.ts` `user.created`, after `updateOrCreateUser`, if `public_metadata.jsInvite` is well-formed, call internal `invitations/applySignupInvite({ clerkUserId, kind, ref })`.
  - It loads the row by `ref`. If the row is missing (revoked, expired, purged) or the kind doesn't match, it does nothing.
  - Otherwise it applies the kind's semantics (E1/E2), deletes the row, and schedules a best-effort clear of `jsInvite` from the Clerk user's public metadata, so ids don't linger.
  - The webhook trusts only svix-verified events and our own `ref`.
- **Logging:** wide events never carry the address or its HMAC. They log the kind, the outcome and the reason codes.

### Account deletion

`conversation/purgeMemberMessagingData` gets a phase `emailInvitesOut` for the inviter's rows. Each row is deleted, its Clerk invitation is revoked and deleted best-effort (scheduled), and a pending fallback is withdrawn.

- The new `emailInvite` rate-limit key is covered by the existing `rateLimits` phase.
- `emailInviteSendLog` holds no member id, only address HMACs on a 30-day TTL.
- Connection offers (E1) and household invites (E2) that came from an invite are covered by the purges that already exist for them.

### Privacy

- **Lawful basis:** 6(1)(f), the inviter's legitimate interest in inviting a contact. Safeguards: one email, no reminders, no stored address, a 14-day expiry, deletion on resolution, and a 30-day HMAC log for anti-abuse. Clerk is already a listed processor.
- **Privacy page:** one factual sentence. "When a member invites you by email, we send you one invitation and keep no copy of your address; our sign-in provider holds the invitation until it expires after 14 days."
- **Terms:** one sentence. Only invite people you know, and only with their address.

## E1: follow invite from the find/follow-friends flow

- **Entry point:** an "Invite by email" field next to the profile invite link (find people / quick-start people step), with a pending list and revoke.
- **On sign-up through the link:** `offerConnection(fromId: inviter, toId: new member, source: "emailInvite")`. This is the #197 aggregate with a new source, and the domain already anticipates it.
  - The new member sees the existing connection-offer prompt and chooses [Follow each other] or [Not now].
  - Nothing is followed until they accept. Accepting goes through `establishMutualFollow`, whose `new_follower` notifications tell the inviter.
  - We add **no new notification type**; the original `invite_accepted` is dropped as redundant. The offer expires after 30 days, as all offers do.
  - `connectionOffers.inviteLinkId` stays empty for this source.
- **Existing member (in-app fallback):** the same `offerConnection` with `source: "emailInvite"`. It is gated by blocks either way, the decline cooldown and an existing mutual follow; a gated offer is silently skipped.
  - The inviter learns nothing until the member accepts, and then only by the member's consent.
  - The row's `fallback.connectionOfferId` lets a revoke withdraw a still-pending offer.
- The offer copy for `emailInvite` must read correctly for both a new and an existing member.

## E2: household invite for someone not on JigSwap

- **Entry point:** "Invite by email" on the household page, for the admin, next to the household invite link, with a pending list and revoke.
- **On sign-up through the link:** a **pending household invite** through the domain `makeInviteToHousehold`, the same aggregate the in-app and link paths use. The new member accepts in-app.
  - The inviter must still be the admin of the household in `householdId`. Otherwise nothing happens.
  - **No follow is created.**
- **Existing member (in-app fallback):** a normal in-app household invite, but only if `isBlockedEitherWay` is false and `makeInviteToHousehold`'s own rules pass. Otherwise nothing happens.
  - The invite row gets `viaEmail: true`. `getMyHousehold`'s pending list leaves those rows out, so the admin sees one "Invitation sent {date}" entry from `listMyEmailInvites`, exactly as for a new address. Showing the invitee's name there would reveal that the address has an account.
  - The row's `fallback.householdInviteId` lets a revoke withdraw a still-pending invite.

## E.2 Security review focus

- **No existence oracle:**
  - **Response:** always `sent`.
  - **Timing:** every outcome after the first mutation answers after the same floor (2500 ms plus up to 500 ms of jitter).
  - **Pending list:** one row in every case, with no address or name.
  - **Errors:** the only refusals are about the inviter or the input (`InvalidEmail`, `RateLimited`, `EmailInvitesUnavailable`, the household-admin error).
- **Server-side auth on every function.** Revoke and list are inviter-only. `applySignupInvite`, the gateway calls and the cleanup functions are internal.
- **Rate limits can't be bypassed by a rollback:** the counter commits in its own mutation before the work.
- **Metadata tampering:** metadata is written server-side through the Backend API only. The webhook is svix-verified and resolves only our own `ref`.
- **`redirectUrl`** is a fixed internal path, so there's no open redirect.
- **Email injection:** the email is React-rendered and escaped, and the subject's only user text is the capped, newline-stripped inviter name.
- **Blocks:**
  - At sign-up, a brand-new member can't have a block yet.
  - The fallbacks and the later accept re-check blocks either way (`offerConnection`, `acceptConnection`, the household gate).
- **Expiry and revocation** at 14 days. **Purge** on account deletion.
- **Logging:** addresses are never logged or returned. The HMAC key is server-only.

## E.3 PR plan (one linear `gh stack`)

| #   | PR                                                                                                                                                                                   | Notes                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| E0a | feat(invitations): email-invite mechanism (gateway port and Clerk adapter, send log, local refs, rate limit, send, list, revoke, expiry, `invite` email template, purge) + this spec | inert without `INVITE_EMAIL_HMAC_KEY` and `CLERK_SECRET_KEY` |
| E0b | feat(invitations): sign-up linking and in-app fallbacks (webhook, `applySignupInvite`, E1 connection offer with source `emailInvite`, E2 pending household invite with `viaEmail`)   | E0a                                                          |
| W   | feat(web): invite by email from find-people and the household page; privacy and Terms sentences                                                                                      | E0b                                                          |
| D   | docs: What's new `email-invites` (en/nl, notify false) and the user guide (people-and-following, households); closes #222                                                            | W                                                            |

## E.4 Decisions (defaults applied)

- **EQ1:** E1 is a pending connection that the new member confirms. No auto-follow.
- **EQ2:** an existing member gets the kind's normal in-app path, gated as usual. The inviter always sees "Invitation sent".
- **EQ3:** no address is stored or shown.
- **EQ4:** link redemption is already confirm-first (#197). Nothing to do.
- **EQ5:** 10 invites per day per inviter; 1 email per address per 30 days; a 14-day expiry.
- **EQ6:** no free-text note.
- **EQ7:** the Clerk TO VERIFY items above block switching the feature on, not building it.
- **Shepherd decision (reversible):** no `invite_accepted` notification type. The inviter hears through the `new_follower` that follows the member's own accept.
