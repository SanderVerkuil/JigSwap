# Household improvements: page redesign, household name, leave-and-join

Date: 2026-10-19. Three stacked PRs: (1) page redesign, (2) household name, (3) leave your
household to join another. Design input came from the UX Researcher, the UX Architect and the UI
Designer agents. Their findings are summarised here.

## 1. Page redesign (web only)

### Problem

`/household` was one long page with seven intents on it. It had an explainer, the member list,
three invite methods stacked with three explanations, a pending list, settings, the bulk access
editor and Leave. Members and admins saw the same wall. Accepting an invite and creating a
household had equal weight. There was no header identity.

### Intents (ranked)

- **No household:** accept an incoming invite, then create your own.
- **Member:** see who's in it, then set your own puzzles' household access (occasional, long
  list), then read the default, then leave (rare).
- **Admin**, in addition: invite (frequent early on), see pending invites, remove a member, change
  the default, rename (ticket 2).
- **In a household with an incoming invite** (ticket 3): understand the conflict, then switch or
  decline.

### Information architecture

- **Page head** (shell `usePageHeader`): the title, then the household name from ticket 2. Admins
  get a single primary **Invite** action (icon-only below `sm`, 44px, `data-tour="household-invite"`).
- **Identity strip:** avatar stack (reuses `CircleAvatarStack`), "N members", and your role badge.
- **Underline tabs** (same pattern as People; `?tab=`, default has no param, `replace`, scroll kept):
  1. **Members** (default): the member list. Remove sits behind a per-row `⋯` menu, admin only.
     Below it the admin sees "Waiting for a response". Members see "Only the household admin can
     invite people."
  2. **My puzzles** (`?tab=puzzles`, "Puzzles" on phones): one line with the household default,
     then the bulk editor, unchanged.
  3. **Settings** (`?tab=settings`): the explainer, the settings card (default access, plus the
     name from ticket 2), and a red danger zone holding **Leave household**.
- **Invite dialog** (admin): "Find a member", "Invite with a link" and "Invite by email", in order
  of likelihood. The existing components are re-housed unchanged; the quick start keeps using them
  directly. Email is hidden when the deployment has it switched off.
- **No household:** with no invites, the existing empty state and Create. With invites, invite
  cards come first ("<name> invited you to their household", Accept / Decline). A quiet "Or start
  your own household" with an outline Create follows.
- **Tour anchors:** `household-main` sits on Create, the invites section or the members list.
  `household-invite` sits on the header Invite button, or on the member note for members.
  `household-my-copies` sits on the always-mounted My puzzles tab trigger, because tour routes
  can't carry a search string. The tour copy is updated to match.

Out of scope: merging the in-app and email pending lists (the email list stays inside the dialog).

## 2. Household name

- `households.name` is optional. The admin sets it, following the same rule as the other
  household settings (`setDefaultCopyPermission`). `null` clears it.
- Names are normalised like circle names: control characters become spaces, invisible format
  characters are removed (ZWJ/ZWNJ are kept), whitespace is collapsed and the result trimmed. A
  name must have 1–100 characters and at least one visible character, otherwise
  `InvalidHouseholdName`. The normaliser moved to the shared kernel (`normaliseDisplayName`), so
  circles and households share it.
- **Members only.** Only `household.mine` returns the name, behind the viewer's own membership.
  Invite lists, link landings, notifications and every other read never include it. Tests cover
  the invitee, the link holder and an ex-member.
- **UI.** The name is the page-head title when set. It is edited in the Settings card
  (admin), and members see it read-only. The invite dialog title uses it.

## 3. Leave your household and join another

### Directions found in the code

- **Inviter in a household, invitee in another one.** Previously `inviteToHousehold` refused with
  `InviteeAlreadyInHousehold`. The inviter got a dead-end notice, which also revealed that the
  person was in a household. The invitee never knew.
- **Invite link, opened by a member who is already in a household.** The landing page showed
  "you can't join" with no actions.
- **Invite accepted after the invitee joined another household.** Refused with
  `AlreadyInHousehold`.
- The reverse case, where the inviter is in no household, can't happen: only household admins
  invite.

### Decision

The person blocked by the one-household rule is the one who resolves it.

- **Invites reach members of other households.** Only an invitee who is already in _this_
  household is refused (`AlreadyMember`). The inviter sees "Invite sent" as for anyone else, so
  inviting no longer reveals household membership.
- **Accept takes `leaveCurrentHousehold`.** This applies to `acceptHouseholdInvite`,
  `acceptHouseholdLinkInvite` and the domain's `joinHouseholdByLink`. Without it, an invitee in
  another household is refused (`AlreadyInHousehold`) and nothing changes. With it, they leave
  their household and join the new one in one step, following the existing leave rules:
  - As the last member, the household is dissolved and its pending invites are cancelled.
  - As admin with housemates, the longest-standing member becomes admin.
  - Their puzzles leave with them.

  There are no adult/child or managed-member rules in the household model to respect.

- **Atomicity.** Every check runs before any write: invite still pending and addressed to them,
  target household still exists, not already a member. The Convex mutation throws on any refusal,
  so the transaction never leaves the member in zero or two households. Domain specs and backend
  tests cover the switch, the refusals, and a member staying in exactly one household.
- **Confirm first.** A notification for a viewer in another household offers only Decline inline.
  The row links to `/household`, where the switch is confirmed. Both the household page (an
  invite card above the tabs) and the invite-link landing offer "Leave and join" with a
  confirmation that names the consequences. The confirmation states whether the current
  household will be deleted (last member) or handed over (admin).
- A member who is already in a household may now also **Decline** a household link.

### Request to join

Not built. The invite already is the request, and accepting it is the join. A separate "ask to
join a household" flow would need a new request aggregate, a notification type (see
enum-literal sync points) and an admin approval UI. That is listed as an open question.
