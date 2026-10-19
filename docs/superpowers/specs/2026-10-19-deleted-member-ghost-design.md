# Deleted member: ghost identity and the rest of their data

Date: 2026-10-19. Status: approved policy, design for implementation.

## Problem

`users.deleteUser` hard-deletes the `users` row (or tombstones it with `isActive: false` while a
CSAM escalation is open) and schedules `conversation/purgeMemberMessagingData`, a batched purge
(100-row pages, one phase per run, cursor reschedule). That purge covers messaging, invites, offers,
follows, follow requests, notifications, redemptions, invite links, settings, inbox, email and
household invites.

Everything else the member left stays, still keyed by their id:

- Their **library copies** stay in `ownedPuzzles`, so Browse and circle shares can still list them.
- Their **photos** stay in `ownedPuzzleImages` / `completionImages` and in file storage.
- Their **goals**, collections and personal categories stay.
- **Circles they own** keep a departed owner nobody can replace; their **household** keeps them as
  a member (or admin).
- `domainEvents` payloads keep their id and any names copied into the payload.
- Content that should stay (reviews, comments, trade history, catalog contributions, messages)
  renders inconsistently: "Deleted member" in messages, "Former member" in notifications, trade
  cards and circle seats, and in some lists a nameless member view.

## Policy

| What                                                                                   | Outcome                                                                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Reviews, comments, trade history, catalog contributions, message history               | Keep, attributed to the ghost **Deleted member**                                            |
| Circle memberships' historical traces, thread metadata                                 | Keep, ghost                                                                                 |
| History entries on copies now owned by someone else (transfers, completions, loans)    | Keep the rows unchanged; the deleted member renders as the ghost                            |
| Library copies they currently own                                                      | Delete (with collection memberships, copy reviews on them, circle shares, photos)           |
| Their photos (copy photos and completion photos, everywhere), with the storage files   | Delete, except quarantined / evidence-held photos (same rule as message attachments)        |
| Goals, collections, personal categories                                                | Delete                                                                                      |
| Their completions on their own copies and completions with no copy                     | Delete (personal activity, goes with the copy)                                              |
| Their completions on copies now owned by someone else                                  | Keep (part of that copy's history), ghost; photos removed                                   |
| Circles they own                                                                       | Transfer to longest-standing active Admin, else longest-standing active member, else delete |
| Their household                                                                        | Leave it: the existing leave rule promotes the longest-standing member, or dissolves it     |
| `domainEvents` payloads                                                                | Scrub: their id becomes the ghost token, copied personal fields are dropped                 |
| Admin, CSAM and moderation records (`moderationActions`, `csamEscalations`, `reports`) | Unchanged                                                                                   |

User clarification (2026-10-19): a copy they **sold, traded or gave away** is not theirs any more
and must stay whole, with its full History. Their entries in that History stay and render as
"Deleted member" (no name, avatar or link). Deleting their own copies must never cascade into a copy
another member owns now (deletion selects by `ownedPuzzles.by_owner = memberId` only, and the
custody/completion/loan rows of other copies are never touched).

Decision (flagged to the user): photos the deleted member uploaded to a copy that now belongs to
someone else are **deleted**, following "delete their photos". The History entry they hang off stays.

## Ghost: render-time projection, not a sentinel row

**Decision: reuse the existing `departed` branch of `projectMemberIdentity` (social/privacy.ts).**
It already returns `{ anonymous: true, anonRef, departed: true }` when the target's `users` row is
missing or `isActive === false`, before any reveal rule. No sentinel `users` row:

- A sentinel row would be a real `users` row every query could reveal, count, search or link to; it
  needs its own exclusions everywhere (people search, member counts, admin lists).
- Rewriting every foreign key to it is a write fan-out over every table, and loses the per-copy
  `anonRef` stability that keeps two deleted members distinguishable in one timeline.
- The departed branch costs nothing at write time and already covers tombstoned accounts.

What this PR stack adds on top:

1. **One label.** The web app renders a departed member as **Deleted member** / **Verwijderd lid**
   everywhere (today "Former member" / "Voormalig lid" in notifications, trade cards, circle seats,
   copy history). No name, avatar or profile link.
2. **No bypasses.** Surfaces that look a member up themselves instead of through
   `projectMemberIdentity` (review and comment lists, catalog contributor, activity feed, trade
   party, public review authors) must yield the departed state for a missing or inactive row, never
   a name, avatar or link.

## Purge phases (extend the existing pattern)

New phases appended to `PHASES` in `conversation/purgeMemberMessagingData.ts`, same contract: one
phase per run, at most `PURGE_BATCH_SIZE` rows, reschedule with the cursor until done.

Order matters: open trades and loans are settled before copies go, copies before photos.

1. `exchangesOpen`: their `proposed` / `accepted` exchanges (both sides) are cancelled, so nothing
   reserves a copy that is about to go. Completed / rejected / cancelled / `disputed` stay (trade
   history): `disputed` is terminal and can follow a settlement whose copies already moved, so it
   is not cancelled. The cancellation is silent: no event, so the other party gets no notification
   or thread message; they see the exchange as cancelled.
2. `loansOpen`: open loans where they lend or borrow are closed (`returned`, `closedAt`), and a
   borrowed copy's `heldBy` is cleared so it is back with its owner. Loan rows stay as history.
3. `copies`: `ownedPuzzles.by_owner = memberId`: each copy goes with its collection memberships,
   copy reviews, circle shares, its photos and their storage files (quarantined / evidence-held
   photos kept, as for attachments), and the completions on it.
4. `copyPhotos`: their remaining `ownedPuzzleImages` (by uploader) on other members' copies, with
   storage files, same keep rule.
5. `completions`: their remaining completions: kept when the copy belongs to someone else (photos
   removed, `completionImages` rows and storage files deleted), deleted otherwise.
6. `goals`, `collections`, `categories`: their rows.
7. `circlesOwned`: each circle they own: hand ownership to the longest-standing active Admin, else
   the longest-standing active member (an active member is one whose `users` row exists and is
   active), else delete it through the existing delete path (`purgeDeletedCircle` cleans up). Their
   own seat stays as a departed seat (historical trace).
8. `household`: run the household leave use case for them (promotes / dissolves). Co-members whose
   accounts are already gone leave first through the same use case, so the promotion never lands
   on a departed member and a household with nobody active left is dissolved.
9. `domainEvents` (last): page through `domainEvents`, rewrite every payload that mentions them:
   their id becomes `"deleted-member"`, and personal fields copied into such a payload (names,
   usernames, avatars, emails) are removed. Only events that have finished dispatch
   (`processedAt` or `failedAt` set) are rewritten; a run still pending is skipped by the cursor
   (it is processed within seconds; the backfill below picks up stragglers).

The domain needs one new operation: `Circle.handOverOwnership(to, now)` (owner becomes `to`, `to`
must be a current member; the old owner's seat stays). The household leave rule already exists.

## Already-deleted accounts (backfill, not run here)

`backfillDeletedMemberData` (internal mutation, `dryRun` default `true`): pages through every table
the phases above clean up (`exchanges`, `loans`, `ownedPuzzles`, `ownedPuzzleImages`, `completions`,
`goals`, `collections`, `categories`, `circles`, `householdMembers`), collects member ids whose
`users` row is missing or inactive, and returns them (dry run) or schedules `purgeMemberMessagingData` for each starting at
`exchangesOpen` (real run). It must be run by an operator with approval; nothing in these PRs runs
it.

## Stack

1. Spec + ghost projection (label, bypass audit, tests).
2. Deletion and transfer phases 1-8 + backfill, with tests, including: A sells a copy to B, A
   deletes their account, B still sees the copy with full History and A as "Deleted member".
3. `domainEvents` scrub phase, with tests.

User docs (`docs/user/{en,nl}`), the privacy page's "When you delete your account" list and a What's
new entry (user-visible: Browse no longer lists deleted accounts' copies) land with PR 2.
