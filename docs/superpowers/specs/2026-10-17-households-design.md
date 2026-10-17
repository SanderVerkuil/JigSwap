# Households: a shared library with per-copy permission

**Date:** 2026-10-17
**Status:** Draft for review (ticket T5)
**Lands on:** `feat/households`, stacked on `chore/deps-latest`.

## Problem

Members who live together (typically a couple) own one physical puzzle
collection but JigSwap models every copy as belonging to exactly one member.
The partner who did not add a copy cannot see it in "My puzzles", cannot log a
solve against it, and cannot manage it (edit, put it up for lending/swap,
recall a loan). Households let members pool their libraries without moving
ownership.

## User decisions (recorded in the ticket)

1. **Shared library, per-copy permission.** Copies stay owned by the member
   who added them. Every household member sees all household copies in their
   own "My puzzles", marked as household copies with the owner shown. The
   owner decides per copy whether the household may **manage** it (act as if
   co-owner) or only **view** it.
2. **Completions stay personal.** Each member logs their own solves/reviews
   on household copies; nothing about completions is shared or merged.
3. **Membership is invite-based** via the notification system. A member is
   in at most one household. Anyone can leave; their copies leave with them.

## Decisions made in this spec

### D1. Default per-copy permission: `manage`

An absent `ownedPuzzles.householdPermission` means `manage`.

Why `manage`:

- The motivating case is people who already share the physical shelf; a
  household is an explicit, mutually accepted trust relationship (the
  invitee must accept, and only the household admin can invite). Out of the
  box the feature should do what the ticket describes ("as if co-owner")
  without the owner having to flip every copy.
- No backfill: every existing copy behaves as `manage` the moment its owner
  joins a household, and the owner can narrow any copy to `view`.
- The irreversible, owner-identity actions stay owner-only even under
  `manage` (deleting the copy, changing the household permission itself,
  sharing to circles, collections, the profile shelf — see the matrix), so
  the default cannot cost the owner the record of their copy.

**Resolved (household-wide default, user decision):** a household carries an
optional `defaultCopyPermission: "manage" | "view"` (absent = `manage`, so
no backfill). A copy's effective permission is resolved at read time, by the
single domain helper `resolveHouseholdCopyPermission(stored, householdDefault)`,
in this order:

1. the copy's explicit `ownedPuzzles.householdPermission`, if set;
2. else the owner's household `defaultCopyPermission`, if set;
3. else `manage` (`DEFAULT_HOUSEHOLD_COPY_PERMISSION`).

Every reader (copy access / co-manager policy, the exchange co-manager list,
the copy view, the household listings and the bulk editor) goes through that
helper; a guard test (`householdPermissionFallback.test.ts`) fails on any
other `householdPermission ?? …` fallback.

- Only the household **admin** changes the default
  (`household/setDefaultCopyPermission`), like invite/remove. The change
  applies immediately to every member copy without an explicit value; the
  settings card shows that count (computed server-side across all members)
  and asks for confirmation. No notifications.
- Owners keep control: an explicit per-copy value always wins. The copy-page
  select and the bulk editor offer "Use household default (currently: X)",
  "Can manage" and "View only"; "Use household default" clears the explicit
  value. An explicit choice is written even when it equals what the copy
  inherits today, so it is pinned against later default changes.
- The default belongs to the household, not to the copies: a member who
  leaves takes their copies out of it, and those copies then follow whatever
  household the owner joins next (or none).

### D2. Roles: one `admin` (the creator) and `member`s

- The creator is the household **admin**. Only the admin may invite and may
  remove other members. Rationale: a new member immediately sees (and by
  default may manage) everyone's copies, so adding people is a decision that
  affects every member's property; keep it with one accountable person.
- **Admin leaves while others remain:** the longest-standing remaining member
  (earliest `joinedAt`) is promoted to admin automatically. No explicit
  "transfer admin" action (not requested).
- **Removal:** the admin may remove any other member. The removed member's
  copies leave the household with them (membership is derived, see D4). The
  admin cannot remove themselves — they leave instead.
- **Last member leaves:** the household is **dissolved** — the household row
  is deleted and its still-pending invites are deleted with it. A household
  with one member (the creator, before anyone accepts) is valid.

### D3. Invites

- `pending → accepted | declined`. One pending invite per (household,
  invitee). Invitee must not be the inviter.
- "At most one household" is checked at **invite** time (cheap early
  feedback) and again at **accept** time (authoritative: the invitee may have
  joined or created another household in between). Creating a household also
  requires not already being in one.
- Accepting requires the household to still exist (it may have dissolved).
- Decline is silent to the inviter (mirrors follow requests).
- Accepting one invite leaves the member's other pending invites in place;
  any later accept of those fails with `AlreadyInHousehold`.
- No revoke/cancel of a sent invite (not requested; open question).

Notifications (two new `NotificationType`s, category `social`, in-app + push,
**not** email-eligible — widening email is an explicit product decision in
`EMAIL_ELIGIBLE_TYPES`, so it is left as an open question):

| Type                        | Event                     | Recipient | params                | relatedId    | Deep link    |
| --------------------------- | ------------------------- | --------- | --------------------- | ------------ | ------------ |
| `household_invite_received` | `HouseholdInviteSent`     | invitee   | `actorName` = inviter | invite id    | `/household` |
| `household_invite_accepted` | `HouseholdInviteAccepted` | inviter   | `actorName` = invitee | household id | `/household` |

Both fan out to every sync point (domain union + arrays + spec, schema
`notifications.type`, `preferenceValidators`, push copy table, `webPush`
deep-link, web `notification-meta`, the three locale files).

### D4. Membership drives visibility; nothing is copied

Household copies are not duplicated or re-owned: "B sees A's copy" is
computed at read time from `householdMembers`. Consequently leaving,
removal, and dissolution need no copy writes — the copies simply stop being
reachable through the household rule.

## Domain model (`packages/domain/src/household`)

New bounded context, same hexagonal layout as `social`/`sharing`.

- `HouseholdId`, `HouseholdInviteId`, `MemberId` (branded).
- `HouseholdCopyPermission = "manage" | "view"`,
  `DEFAULT_HOUSEHOLD_COPY_PERMISSION = "manage"`,
  `resolveHouseholdCopyPermission(stored?)`.
- `householdCopyAccess({ ownerId, householdPermission }, actorId,
sharesHousehold)` → `"owner" | "manage" | "view" | "none"` and
  `canManageCopy(access)` (true for owner/manage). Pure; the single place the
  rule lives.
- `Household` aggregate: `{ id, members: [{ memberId, role, joinedAt }],
createdAt }`. `found(id, founder, now)`, `admit(memberId, now)`,
  `leave(memberId, now)` → `{ dissolved: boolean }` (with admin promotion),
  `remove(by, target, now)` (admin-only, not self), `isAdmin(memberId)`.
  Events: `HouseholdFounded`, `HouseholdMemberJoined`, `HouseholdMemberLeft`,
  `HouseholdMemberRemoved`, `HouseholdDissolved`.
- `HouseholdInvite` aggregate: `send(...)` (rejects self-invite), `accept(by,
now)`, `decline(by, now)` (only the invitee; only while pending). Events:
  `HouseholdInviteSent`, `HouseholdInviteAccepted`, `HouseholdInviteDeclined`.
- Use cases (ports: `HouseholdRepository`, `HouseholdInviteRepository`, id
  generators, events, clock): `createHousehold`, `inviteToHousehold`,
  `acceptHouseholdInvite`, `declineHouseholdInvite`, `leaveHousehold`,
  `removeHouseholdMember`. In-memory repositories for specs.

### Library: co-management port

Library use cases that currently check `copy.ownerId !== actingMemberId`
gain an optional `managers: CopyManagerPolicy` dependency
(`canManage(copyId, ownerId, actorId): Promise<boolean>`). Rule:
`owner OR policy.canManage(...)`. Absent policy ⇒ owner-only (the
conservative behaviour; every composition root that should allow household
managers wires the Convex adapter explicitly). `recallLoan`: a manager may
recall on the lender's behalf (the loan's lender stays the owner).

### Exchange: offered copy

`CopyView` gains optional `coManagerIds`. When proposing a swap, the offered
copy must be owned by the initiator **or** list the initiator in
`coManagerIds`; in addition the offered copy must not belong to the recipient
(otherwise a manager could "swap" the owner's copy with the owner).
Settlement already transfers the offered copy from its actual owner (custody
records the real previous owner), so no settlement change is needed beyond
clearing `householdPermission` when ownership moves.

## Schema

```ts
households: { aggregateId, createdAt,
              defaultCopyPermission?: "manage" | "view" } // index by_aggregate_id; absent = "manage"
householdMembers: { householdId: string /* HouseholdId */, memberId: Id<"users">,
                    role: "admin" | "member", joinedAt }
                  // indexes by_member (memberId), by_household (householdId)
householdInvites: { aggregateId, householdId, inviterId, inviteeId,
                    status: "pending" | "accepted" | "declined",
                    createdAt, respondedAt? }
                  // indexes by_aggregate_id, by_invitee_status, by_household
ownedPuzzles.householdPermission?: "manage" | "view"  // absent = household default, else "manage"
notifications.type += household_invite_received | household_invite_accepted
```

Migration impact: additive only. New tables start empty; the new copy field
is optional and absent means the default, so **no backfill**. No index on
existing tables changes.

## Authorization

Every new Convex function calls `requireMember` unconditionally first and
never trusts a client-supplied member id. Backend helper
`household/copyAccess.ts`: `householdMateIds(ctx, memberId)` (other members
of the actor's household) and `copyAccessOf(ctx, actorId, copy)` /
`canManageCopy(ctx, actorId, copy)` built on the domain rule.

`canViewCopy` / `canViewCopyWithContext` gain rule 5: the viewer shares a
household with the copy's owner (any permission). The context form carries a
`householdMateIds` set built once per request.

### Copy-mutation matrix

| Function                                                        | Before                        | After                                                                                                                                                       |
| --------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library/updateCopyDetails` (domain `updateCopyDetails`)        | owner                         | owner or manage                                                                                                                                             |
| `library/changeCopyCondition` (domain `changeCopyCondition`)    | owner                         | owner or manage                                                                                                                                             |
| `library/updateCopySharing` (domain `updateCopySharing`)        | owner                         | owner or manage (this is how a manager offers a copy for lend/swap/sale)                                                                                    |
| `library/addCopyImage` (domain `addCopyImage`)                  | owner                         | owner or manage                                                                                                                                             |
| `library/setCopyCover` (domain `setCopyCover`)                  | owner                         | owner or manage                                                                                                                                             |
| `library/addCopyPhoto`                                          | owner                         | owner or manage                                                                                                                                             |
| `library/removeCopyPhoto`                                       | owner                         | owner or manage                                                                                                                                             |
| `library/recallLoan` (domain `recallLoan`)                      | lender                        | lender, or manage member of the lent copy                                                                                                                   |
| `exchange/propose` (domain `proposeExchange`, offered copy)     | initiator owns offered copy   | initiator owns or manages it; offered copy not owned by recipient                                                                                           |
| `solving/recordCompletion`, `solving/startCompletion`           | owner or holder               | owner, holder, or any household member (view or manage) — the solve is the logger's own                                                                     |
| `library/deleteCopy`                                            | owner                         | **unchanged, owner-only** (irreversible; see open questions)                                                                                                |
| `library/setCopyHouseholdPermission` (new)                      | —                             | owner-only                                                                                                                                                  |
| `sharing/shareCopyToCircle`                                     | owner                         | unchanged (sharing outside the household is the owner's call)                                                                                               |
| `library/addCopyToCollection` / `removeCopyFromCollection`      | collection owner + copy owner | unchanged (collections are personal)                                                                                                                        |
| `social/arrangeShelf`                                           | owner                         | unchanged (profile shelf is personal)                                                                                                                       |
| `social/postPuzzleComment` (copy notes)                         | owner                         | unchanged (copy comments are the owner's notes)                                                                                                             |
| `exchange/accept/decline/cancel/confirmCompletion/raiseDispute` | party                         | unchanged: exchanges stay person-to-person negotiations (thread, partner reviews, reputation). Incoming requests on a household copy still go to its owner. |
| `library/returnLoan`                                            | borrower                      | unchanged                                                                                                                                                   |

### Reads

| Read                                     | Change                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canViewCopy` (+context form)            | household mates may view                                                                                                                                                |
| `library/getCopyInstanceView`            | adds `viewerCanManage` and `household` (`{ permission, viewerAccess }` or null); owner-only fields (`notes`, acquisition) included for manage members, as for co-owners |
| `household/listHouseholdCopies` (new)    | the other members' copies for "My puzzles", each with owner name + permission + `viewerCanManage`                                                                       |
| `library/getLentOutLoans`                | also returns open loans of copies the viewer manages via the household (so the Recall action is reachable)                                                              |
| `household/getMyHousehold` (new)         | members (name/avatar via `toMemberView` — members accepted each other), roles, the admin's pending sent invites                                                         |
| `household/listMyHouseholdInvites` (new) | the viewer's incoming pending invites with inviter name                                                                                                                 |
| `solving/listMyCompletions`              | unchanged — personal (pinned by a test)                                                                                                                                 |

Member identity: household members see each other's names; an invitee sees
the inviter's name (the inviter initiated contact, as with follow requests).
The admin sees the names of people they invited.

## UI entry points (apps/web)

- New route **`/household`** (nav: My Library → Household). States: no
  household (create button + incoming invites with Accept/Decline); in a
  household (member list with roles, Leave, admin-only Remove and an invite
  picker using the existing member search).
- **My puzzles** lists household copies after the member's own, with a
  "Household · {owner}" badge; Edit/Delete actions follow
  `viewerCanManage`/ownership; Log/Start solve is offered for all.
- **Copy page**: management controls render on `viewerCanManage`; the owner
  (when in a household) gets a "Household access: Can manage / View only"
  select. The `/my-puzzles/$id` gate admits household members.
- Notifications: icon/accent/href for the two new types; preference matrix
  rows in the Social category.

All new strings in `en.json`, `nl.json`, `source.json`.

## Test plan

Domain specs: permission resolution + access matrix; Household aggregate
(found/admit/leave/promotion/dissolve/remove rules); HouseholdInvite
lifecycle; every use case incl. at-most-one-household at create/invite/
accept; library use cases with a manager policy (manage allowed, non-manager
denied, no policy ⇒ owner-only); propose-exchange offered-copy rules;
notification-type arrays.

Backend convex-tests (`convex/households.test.ts` and additions to the
existing suites):

- invite → accept; invite → decline (silent, no membership).
- at most one household (create while member; accept while member; invite
  someone already in a household).
- leave removes the leaver's copies from the others' library and copy
  visibility; dissolve on last leave (household + pending invites gone).
- admin removal, admin promotion on admin leave, non-admin cannot invite or
  remove.
- view-only member cannot update details/condition/sharing, add/remove photo,
  set cover, recall, offer the copy in a swap; manage member can; nobody but
  the owner can delete or change the household permission.
- non-member cannot see household-only (private, closed) copies; a member can.
- completions are not shared: a member can log their own solve on a household
  copy; it does not appear in the owner's `listMyCompletions` and vice versa.
- notifications are emitted for invite received / accepted.

Web: notification-meta tests updated for the two types; route-meta entry.

## Out of scope

Household names/avatars, invite revoke,
admin transfer, intra-household exchanges guard beyond the offered-copy rule,
email delivery of household notifications, Browse filtering of household
copies.
