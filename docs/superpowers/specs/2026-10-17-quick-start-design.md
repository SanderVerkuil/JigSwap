# Quick start: a first-sign-in setup members can choose to follow

**Date:** 2026-10-17
**Status:** Draft for review (PR Q1, spec only). The visual section (§5) goes to UI review first.
**Lands on:** `docs/quick-start-spec`, stacked on the What's new stack (`feat/whats-new-tours`, which follows #89, #95 and #96). It will be rebased onto `main` once that stack merges.

## Problem

A new member lands on an empty dashboard. JigSwap only becomes useful once a
member has **inventory** (their copies) and **a peer** (someone whose shelf and
solves they can see). Today every step towards that is a separate trip through
flows that were built for one item at a time:

- Adding puzzles is one round trip per box through `/my-puzzles/add/new`, and
  the catalogue search only filters the 20 rows already loaded, so boxes that
  have not been paged in look missing. That pushes people to register
  duplicates. (Q2 fixes the search separately.)
- A past solve cannot be logged honestly. Start and end both default to today,
  and clearing the end turns the record into an in-progress solve. "I solved it
  once, I don't know when" cannot be expressed, so members either enter false
  dates (which skew trends, goals and the feed) or skip the step.
- Someone who knows nobody's handle hits a dead end in people search. The invite
  link and QR exist but are not offered at that moment.
- Households can only invite existing members, found by name. Family members
  are often not on JigSwap yet.

The request: a first-sign-in "Quick setup" the member can choose to follow,
covering adding puzzles, logging past solves, adding friends (with invites for
people not on JigSwap yet) and optionally a household.

## Sources

This spec synthesises five research memos (shared brief, UX research, growth,
UX architecture, UI) and the user's decisions. The memos live outside the repo,
so their load-bearing content is restated here. Where a memo and a user
decision disagree, the decision wins. The main overrides:

- "Add friends to their circle" means the **network** (follows, `/people`),
  not Circles. Circles are out of scope.
- **No server-sent email invites.** The memos proposed an `emailInvites` table,
  an AhaSend template, reminders and email matching on sign-up. All of that is
  dropped: invites are a share link sent from the member's own device.
- Completion dates gain a `"year"` precision as well as `"unknown"`.
- The stepper lives at `/welcome?step=`, not `/setup/<step>` (UI memo).

## User decisions (final)

1. **"Add friends" = the network** (follows, `/people`). Circles are out of
   scope.
2. **Non-member invites are a share link sent from the device only.** Use the
   Web Share API, with copy-link, `mailto:` and WhatsApp fallbacks. JigSwap
   never stores third-party email addresses: no `emailInvites` table and no
   server-sent invite emails. Build on the existing invite tokens
   (`social/redeemInvite.ts`, `inviteLinks`, `InviteRedeemer`), which already
   give attribution and a mutual follow. Extend the token with an optional
   context. A household invite creates a **pending** household invite on
   redeem, which the invitee must accept; never auto-join. Keep or add
   per-inviter rate limits and expiry. The invite landing page must survive
   Clerk sign-up.
3. **Completion date precision: `"day" | "year" | "unknown"`.** `"year"`
   ("sometime in 2023") feeds yearly stats. `"unknown"` is excluded from trends,
   time averages, "this year", the activity feed (so a bulk backfill doesn't
   flood followers) and goals. Every precision counts in lifetime totals and on
   profiles, labelled "Date unknown" / "In 2023". The in-progress invariant must
   keep working.
4. **Undated solves do not count toward goals.**
5. **Activation metric:** ≥3 copies plus (≥1 completion or ≥1 mutual
   connection/household link) within 7 days of sign-up, computed from Convex
   data by an internal query (PostHog only has consent-gated pageviews).

The converged pattern is also fixed: a one-time welcome dialog that wins
surface-busy priority over the What's new highlight; step pages at
`/welcome?step=`; a persistent, dismissible `QuickSetupCard` between
`BriefingHero` and `ShelfSection` with server-side state; step "done" derived
from real data, with only "skipped"/"dismissed" stored; five steps (Add
puzzles, Past solves, Find people, Household (optional), Make it yours); push
prompt only after the first connection or invite; tours only as a hand-off at
the end.

## Decisions made in this spec

| #   | Decision                                                                                                                       | Section |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| D1  | The intent question is **a follow-up, not in Q2–Q8**.                                                                          | §2.6    |
| D2  | Tour hand-off: a **registered set of standalone tour ids** in `@jigswap/contracts`, accepted by `recordTourProgress`.          | §2.8    |
| D3  | Step 1 is done at **3 copies**, which matches the activation threshold.                                                        | §2.4    |
| D4  | `"year"` solves are excluded from the **monthly** trend chart and from the activity feed, as well as `"unknown"` solves.       | §3.2    |
| D5  | Household invite tokens are **single-use, expire after 14 days**, at most 5 open and 10 created per rolling 24 h.              | §3.4    |
| D6  | Pending household invites are handled **inside step 4**, not as a separate "step 0".                                           | §2.4    |
| D7  | `InviteRedeemer`'s loop-QR dialog and fallback toast are **suppressed while the quick start is eligible**; step 3 covers both. | §2.1    |
| D8  | Q7 is **split into Q7a (backend) and Q7b (web)** to keep each diff reviewable.                                                 | §7      |

---

## 1. Goals and the activation metric

### 1.1 Goals

- A new member gets their first puzzles on the shelf within about a minute and
  reaches "inventory plus a peer" in one sitting if they want to.
- Nothing is forced: the member can explore on their own, skip any step, hide
  the checklist, and resume on another device.
- Reuse the real flows and data. A step done outside the quick start ticks
  itself off, because "done" is derived from data.
- Stay honest with data: no fake solve dates and no silent "for trade" listings.
- Stay private: no third-party addresses stored, no contact import, no email
  matching.

### 1.2 Activation (decision 5)

**Definition.** A member is _activated_ when, within 7 days of sign-up
(`users.createdAt` to `createdAt + 7 × 24 h`, inclusive):

1. they own **≥ 3 copies**: `ownedPuzzles` rows with `ownerId = member` and
   `createdAt` inside the window. Copies deleted since then are gone and do not
   count. That is accepted, because deletion inside a week is rare and the
   report is directional. Household copies owned by someone else do not count.
2. **and** at least one of:
   - **≥ 1 completion**: a `completions` row with `userId = member`,
     `isCompleted = true` and `createdAt` inside the window, at **any**
     precision. Activation measures that the member logged something, not when
     they solved it. In-progress solves do not count.
   - **≥ 1 mutual connection**: some `X` where both `follows(member → X)` and
     `follows(X → member)` exist with `createdAt` inside the window. The
     connection counts from the later of the two rows.
   - **≥ 1 household link**: the member's `householdMembers` row has `joinedAt`
     inside the window **and** the household has at least one other member who
     joined inside the window too. A household of one is not a connection.

**Computation.** `onboarding/activationReport.ts` exports
`activationReport`, an `internalQuery`. It is not exposed through the gateway
and is run by an operator (`npx convex run onboarding/activationReport:activationReport '{"from":…,"to":…}'`).

- Args: `{ from: number, to: number }`. These are cohort bounds on sign-up
  time, at most 31 days apart.
- Scans `users` through the built-in `by_creation_time` index for the cohort.
  For each member it does the bounded index reads above: `ownedPuzzles.by_owner`,
  `completions.by_user_completed`, `follows.by_follower` plus
  `follows.by_follower_followee` for the reverse edge, and
  `householdMembers.by_member` / `by_household`.
- Returns **aggregates only**, never member ids:
  `{ cohortSize, activated, rate, windowClosed, breakdown: { copies3, completion, mutual, household } }`.
  `windowClosed` is `to + 7 d <= now`. An open cohort is reported but marked
  as such.
- The predicate is a pure function, `isActivated(facts, signupAt)` in the
  domain, so the thresholds are unit-tested and the Convex query only gathers
  facts.
- If a cohort ever exceeds a single query's read budget, wrap it in an
  `internalAction` that pages the cohort through the same query. This is not
  needed at today's volume.

**Secondary signal.** "Engaged" means ≥ 1 completion within 14 days. It is
reported by the same query (`breakdown.completion14d`) but is not part of
activation.

**Revisit** the threshold (3 vs 5 copies) against D30 retention after 4–6
weeks of data (growth memo).

---

## 2. UX flow

### 2.1 The welcome dialog

**When.** It shows on the first `/dashboard` load for an **eligible** member:

- the account is less than 7 days old (`now - users.createdAt < 7 d`, the
  activation window), and
- `memberOnboarding.welcomeDismissedAt` is absent.

Existing, older members never see it. It is never shown on other routes: a new
member who deep-links elsewhere sees it the next time they open the dashboard.

**Anatomy.** Same as the What's new highlight modal (`highlight-dialog.tsx`):
`DialogContent p-0 sm:max-w-md`, a header band `h-28 bg-jigsaw-primary-tint`
with a `Puzzle` icon tile, `DialogTitle className="font-heading text-2xl"`, the
body, then the footer `border-t bg-muted/40`.

**Copy.**

| Element | en                                                                                                             | nl                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Title   | Welcome to JigSwap!                                                                                            | Welkom bij JigSwap!                                                                             |
| Body    | Shall we set up your shelf? Add the puzzles you own, the ones you've finished, and the people you puzzle with. | Zullen we je plank inrichten? Voeg je puzzels toe, wat je al gelegd hebt en met wie je puzzelt. |
| Line 1  | Add the puzzles on your shelf                                                                                  | Voeg de puzzels op je plank toe                                                                 |
| Line 2  | Mark the ones you've finished                                                                                  | Vink aan welke je al gelegd hebt                                                                |
| Line 3  | Find the people you puzzle with                                                                                | Vind de mensen met wie je puzzelt                                                               |
| Time    | Takes about 3 minutes. You can stop at any time.                                                               | Duurt ongeveer 3 minuten. Je kunt altijd stoppen.                                               |
| Primary | Start quick setup                                                                                              | Snel instellen                                                                                  |
| Ghost   | Explore on my own                                                                                              | Zelf rondkijken                                                                                 |

The three lines are an `<ol>` with numbered markers. On mobile the primary
button sits on top (`flex-col-reverse sm:flex-row`).

**Behaviour.**

- "Start quick setup" navigates to `/welcome` (first step that is not done).
  There is no forced redirect anywhere.
- "Explore on my own", Esc, the X and the overlay all close it. Every close is
  final: it calls `recordQuickStart({ kind: "dismissWelcome" })`. The dashboard
  card stays, so setup can be resumed.
- **Priority over the What's new highlight**, using W2's store
  `apps/web/src/components/whats-new/surface-busy.ts`:
  - `WelcomeDialog` calls `useReportSurfaceBusy("quickstart-welcome", busy)`
    where `busy = quickStart === undefined || quickStart.showWelcome`. The
    signal is reported **while the onboarding query is still loading**. That is
    the important part: the highlight checks `isSurfaceBusy()` once, after its
    600 ms `OPEN_DELAY_MS` timer, and the welcome dialog can only open after the
    query resolves. Without the loading-time report, a slow query would let the
    highlight win the race.
  - Once the welcome dialog is open, `isAnyDialogOpen()` also blocks the
    highlight. The highlight does not queue; it retries on the next route
    change, by which time the welcome is dismissed.
  - Mount `WelcomeDialog` in `routes/_dashboard/dashboard.tsx` (it is
    dashboard-only), which renders inside the same providers as
    `WhatsNewHighlight`.
- **InviteRedeemer (D7).** While the member is eligible (same rule as above,
  and the card not dismissed), `InviteRedeemer` still redeems the token but
  skips the loop-closure QR dialog and the "Did someone invite you?" toast.
  Step 3 offers both the member's own link and people search. This avoids two
  dialogs competing on the first dashboard load.

### 2.2 The `/welcome?step=` pages

- **Route:** `apps/web/src/routes/_dashboard/welcome.tsx`, under the `_dashboard`
  layout (auth, shell, `TourProvider`). `validateSearch` accepts
  `step ∈ { puzzles, solves, people, household, profile, done }`. A missing or
  unknown step resolves to the first required step that is neither done nor
  skipped, or `done` if there is none.
- **Route meta:** add a `route-meta` entry (title "Quick setup" / "Snel
  instellen", no breadcrumb parent).
- **Surface busy:** the page calls `useReportSurfaceBusy("quickstart", true)`,
  and `canOpenHighlight` (`components/whats-new/logic.ts`) also treats
  `/welcome` like `/whats-new` (a pathname exclusion), so the highlight never
  opens over the flow even between steps.
- **Layout:** a stepper header, the step body, and a sticky footer
  `border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]` with
  `Skip` (ghost) and `Continue` (primary). There is also a "Finish later" link
  in the header back to `/dashboard`.
  - **Skip** calls `recordQuickStart({ kind: "skipStep", step })` and moves to
    the next step.
  - **Continue** moves to the next step without writing anything. Done-ness is
    derived, so there is nothing to store.
  - The browser back button walks back through steps, because each step is a
    URL.
- **Order:** puzzles → solves → people → household → profile → done. Any step
  can be opened directly from the card.
- There are no dialogs inside the flow, so nothing stacks. Sub-actions are
  inline (pickers, rows, inline cards).

### 2.3 The `QuickSetupCard`

**Placement:** `routes/_dashboard/dashboard.tsx`, between `<BriefingHero />` and
`<ShelfSection />`.

**Visibility** (computed server-side in `getQuickStart.cardVisible`):

- `memberOnboarding.cardDismissedAt` is absent, **and**
- not every required step is done or skipped (the "all done" state below is
  handled client-side for one session), **and**
- the account is less than 30 days old, **or** the member owns 0 copies. This
  covers existing members with empty shelves without nagging established
  members.

**States:**

- **Active:** `SectionHead` with a `ListChecks` icon, the title "Quick setup",
  meta "2 of 4", and a ghost icon button `X` labelled "Hide quick setup". Then
  a progress bar and one row per step (§5.2). Each row links to
  `/welcome?step=<id>`.
- **All required steps done or skipped:** for the rest of that browser
  session (sessionStorage key `jigswap.quickStart.doneShown`), the card shrinks
  to one row: "Your shelf is set up ✓ · Hide". On a later session it is gone.
  "Hide" calls `dismissCard`.
- **Hidden:** "Hide quick setup" calls `recordQuickStart({ kind: "dismissCard" })`,
  focus moves to the next section heading, and a toast says it can be reopened
  from the account menu. The account menu always has a "Quick setup" item that
  opens `/welcome` and, if the card was dismissed, calls
  `recordQuickStart({ kind: "restoreCard" })`. Dismissal is stored on the
  server, so it carries across devices.

The count "x of 4" covers the four **required** steps (puzzles, solves, people,
profile). Household is shown with an "Optional" badge and is never counted.

### 2.4 The five steps

All "done" rules are evaluated server-side in `getQuickStart` from real rows.
`memberOnboarding` stores only `skippedSteps`, `welcomeDismissedAt` and
`cardDismissedAt`. A skipped step that later becomes done shows as done: done
wins.

| #   | Step id     | Title (en / nl)                                           | Done when (derived)                                                                                                   | Row meta when done      |
| --- | ----------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | `puzzles`   | Add your puzzles / Voeg je puzzels toe                    | ≥ **3** `ownedPuzzles` rows with `ownerId = me` (D3)                                                                  | "7 added"               |
| 2   | `solves`    | Log puzzles you finished / Leg vast wat je al gelegd hebt | ≥ 1 `completions` row with `userId = me`, `isCompleted = true`, any precision                                         | "3 logged"              |
| 3   | `people`    | Find your people / Vind je puzzelmaatjes                  | ≥ 1 `follows` row with `followerId = me`, **or** ≥ 1 pending `followRequests` row with `requesterId = me`             | "Following 2"           |
| 4   | `household` | Household / Huishouden (optional)                         | a `householdMembers` row with `memberId = me`                                                                         | "You're in a household" |
| 5   | `profile`   | Make it yours / Maak het persoonlijk                      | `users.location` is set, **or** the member's `profiles.visibility` is explicitly set (absent means public by default) | "Profile set"           |

Counts are read with a cap (`take(51)`, shown as "50+"), so the query stays
bounded.

**Step 1: Add puzzles** (`?step=puzzles`, built in Q4)

- A `CataloguePicker`: a `Command`-based search over the catalogue. It uses the
  server-side search from Q2 once that lands; until then it uses the existing
  `catalog.listAll` search. A query of 8, 12 or 13 digits is also looked up with
  the barcode index (`by_ean`/`by_upc`, `catalog/findPuzzleByBarcode.ts`), because every
  box has a barcode printed on it. `findPuzzleByBarcode` is an
  `internalQuery` today, so Q4 adds a thin public wrapper (§4).
- Each result row is a toggle button (`aria-pressed`). Picked items collect in
  a tray of removable chips. The footer's primary button becomes "Add 3
  puzzles" and calls `library.acquireCopies` once.
- Setup defaults: condition `good`, no acquisition details, and **availability
  all off**. That is the domain default (`SharingSetting` defaults `forTrade`
  to `false`), unlike the `/my-puzzles/add/new` form, which pre-ticks
  `forTrade`. A one-line note says so: "Added puzzles are not offered for swap
  or loan. You can change that per puzzle later."
- "Can't find it? Register '<query>'" links to `/my-puzzles/add/new` with the
  query prefilled and a new `returnTo=/welcome?step=puzzles` search param, so
  the member comes back to the picker. A pending submission is a real copy and
  counts toward the 3 (moderation lag doesn't block anyone); it shows the
  existing "Pending review" badge.
- Copies already owned are marked as such in results ("On your shelf"), not
  hidden.

**Step 2: Past solves** (`?step=solves`, built in Q5)

- The lead is "Did you finish any of these?". Rows list the member's own copies
  that have no completion yet, newest first, capped at 25 with "Show more".
- Each row: a `Checkbox` "I finished <title>". When it is ticked, a
  `SegmentedPills` "When?" appears with **I don't remember** (default), **Which
  year** (a year `<select>`, current year down to 1950), and **Pick a date**
  (`type="date"`, max today).
- Submit calls `solving.recordPastCompletions` once with the ticked rows. It
  never fakes a date. Time, photos and reviews are not asked here; they can be
  added later through the existing edit flow, within its window (§9).
- It does **not** reuse `LogSolveDialog`, whose success path chains the
  follow-up and duration prompts once per solve.
- Empty state (no copies): "Add a puzzle first, then come back to log it",
  with a link to step 1.

**Step 3: Find people** (`?step=people`, built in Q7b on top of Q6)

- "People you may know" are `MemberTile` cards with the compact `FollowButton`.
  Suggestions come only from existing ties: followers I don't follow back
  (`listFollowers` minus `listFollowees`) and household members. Never from
  contacts or email matches. If there are none, the section is hidden.
- `FindPeople` search (`components/social/find-people.tsx`), reused as is.
- "Invite someone who isn't on JigSwap yet": `InviteShareActions` (new, Q6)
  around the member's existing network link (`social.getMyInviteLink`):
  - If `navigator.share` exists: one primary "Share invite link" button calling
    `navigator.share({ title, text, url })`.
  - Always: "Copy link", "Email" (`mailto:?subject=…&body=…` with no address,
    so the member picks the recipient in their own mail app), and "WhatsApp"
    (`https://wa.me/?text=…`).
  - The line "JigSwap doesn't see or store who you send this to."
  - The link needs a username, so this reuses the existing "Set a username
    first" state from the QR dialog.
- The push prompt can appear here (§2.7).

**Step 4: Household (optional)** (`?step=household`, Q7b on top of Q6)

- **Pending invite first (D6).** If `household.myInvites` (`listMyHouseholdInvites`) returns
  a pending invite (for example, the member arrived through a household link,
  §3.4), the step opens with "<name> invited you to their household", the
  existing household explainer, and Accept / Decline (`household.acceptInvite`
  / `declineInvite`). The card row shows "Invitation waiting". This replaces
  the architecture memo's separate "step 0": the five-step list is fixed, and a
  pending invite is a household matter.
- **Already in a household:** the step is done and shows the household members
  and the invite panel below (for admins).
- **Otherwise:** `SegmentedPills` "Create a household" / "I puzzle alone".
  "I puzzle alone" is the same as Skip. Before creating, one line of the
  existing `household.explainer` copy explains the shared shelf and per-copy
  permission, because that is the part that worries people (UX memo). Then
  `household.create`.
- **Invite panel** (admins only), extracted from `routes/_dashboard/household.tsx`
  into `HouseholdInvitePanel` and reused on the household page:
  - "Invite a member": the existing member search plus
    `household.invite`.
  - "Invite with a link": `social.createHouseholdInviteLink` (Q6), then the
    same `InviteShareActions` with the household message. Note: "The link works
    once and expires in 14 days."

**Step 5: Make it yours** (`?step=profile`, built in Q8)

- Avatar: a "Change photo" button opening Clerk's profile UI (the avatar is
  Clerk-owned and synced by the webhook). It is not part of the done rule,
  because Clerk always provides a generated image.
- City: a text input (optional, at most 80 characters) saved with the new
  `identity.setLocation`.
- Profile visibility: `SegmentedPills` "Everyone" / "Only people you approve",
  saved with the existing `social.setProfileVisibility`. Saving either value
  writes it explicitly, which marks the step done. A small "What others see"
  preview reuses `MemberTile` with the chosen visibility. Private profiles add
  friction to connecting, so the copy is plain and neutral and the current
  value (public) is preselected.

**Done** (`?step=done`): a centred panel. The member's `PuzzlePlank` shows the
new copies sliding in (`fade-in-0 slide-in-from-bottom-2`, 60 ms stagger), then
"Your shelf is ready" and a summary ("7 puzzles · 3 finished · 2 following")
announced through `role="status"`. One `Puzzle` icon scales from 0.9 to 1 with
one ring pulse. No confetti. `motion-reduce:animate-none` everywhere. Buttons:
"Go to my shelf" (primary) and "Show me around" (the tour hand-off, §2.8).

### 2.5 Exit and resume

- "Finish later", Skip, or just leaving: the card stays on the dashboard, and
  the account menu item reopens `/welcome` at the first open step.
- State lives on the server (`memberOnboarding`), not in `localStorage`, so it
  survives device changes. The only client-side keys are the per-session "all
  done" collapse and the per-device push-prompt guard (§2.7).

### 2.6 The intent question (D1: a follow-up, not in this track)

The memos suggested an optional first question ("What brings you here?
catalogue / friends / swap / family") that reorders and highlights steps. It
is **left out of Q2–Q8** and recorded as a follow-up:

- **Little value without data.** The flow is a non-linear checklist: every step
  is reachable from the card, and Skip is one tap. Reordering five steps saves
  at most a couple of taps.
- **It is not small.** It needs a fourth decision before any value (the welcome
  dialog already asks one), four option labels in three locale files, either a
  stored field (beyond the "only skipped/dismissed are stored" rule) or
  session-only state that is lost across devices, a per-intent ordering table,
  and tests for each order.
- **It should be an experiment, not a guess.** The growth memo already proposes
  testing "Connect before Add puzzles". Once Q8's activation report exists, an
  intent question can be tested against the default order with a real metric.

### 2.7 Push-prompt timing

- The prompt appears **only** inside `/welcome`, right after the member's first
  social action there: a successful follow or follow request in step 3, or a
  share, copy, mail or WhatsApp action in step 3 or step 4.
- **Conditions:** push is supported (`"Notification" in window` and
  `"PushManager" in window`), `Notification.permission === "default"`, the
  backend has a VAPID key (`notifications.pushConfig`), and the per-device key
  `jigswap.quickStart.pushAsked` is not set.
- **Form:** an inline card under the action, not a dialog: "Want a notification
  when someone follows you back?" with "Turn on notifications" and "Not now".
  Only "Turn on" calls `Notification.requestPermission()`, through a
  `usePushSubscription()` hook extracted from
  `components/notifications/push-device-section.tsx` so the settings page and
  the prompt share one implementation. Either choice sets the per-device key.
- Push permission is per device, so the guard is per device too. Nothing is
  stored server-side.

### 2.8 The tour hand-off (D2)

The done panel offers "Show me around", which starts a new **`getting-started`**
tour through the existing `useTourLauncher().startTour("getting-started")`.

**The problem.** `whatsNew/recordTourProgress.ts` rejects any `tourId` that no
What's new manifest entry references (`unknown_tour`). The tour definitions
live in the web app (`components/tour/definitions.ts`), which the backend
cannot import.

**Resolution: a registered set of standalone tour ids.**

- Add `packages/contracts/src/whats-new/tours.ts`:
  `export const STANDALONE_TOUR_IDS = ["getting-started"] as const;`.
  Contracts is already shared by the backend and the web app.
- `recordTourProgress` accepts a tour id if a manifest entry references it
  **or** it is in `STANDALONE_TOUR_IDS`. Everything else (step validation,
  last-write-wins, the `whatsNewTourProgress` row) is unchanged.
- `components/tour/definitions.test.ts` asserts that every `TOURS` id is
  either referenced by a manifest entry or listed in `STANDALONE_TOUR_IDS`, and
  that every standalone id has a definition. So the "fails silently at runtime"
  class of bug stays covered.
- Update the comments in `definitions.ts` and in the gateway (`whatsNew`
  section of `packages/gateway/src/operations.ts`).

**Why not a manifest entry.** Manifest entries are release notes. A "Getting
started" entry would appear in the What's new list and badge for every
existing member as if it were a new feature, and could become the highlight
candidate. For new members it is pre-read by definition, because entries
published before the account existed are never unread. Its lifetime would also
be tied to a release note that can be pruned. A tour that isn't news should
not need a news item.

**The tour** reuses existing anchors where possible:

1. `shelf`: `/dashboard`, target `dashboard-shelf` (new `data-tour` on
   `ShelfSection`).
2. `solving-now`: `/dashboard`, target `solving-now` (exists).
3. `people`: `/people`, target `people-network` (exists).
4. `account-menu`: `/dashboard`, target `account-menu` (exists), explaining
   that Quick setup and settings live there.

The runner's paused message says a tour can be resumed from What's new, which
is not true for a standalone tour. Add `tour.pausedStandalone` ("You can resume
it from Quick setup") and pick the message by whether the tour id is
standalone. The done panel's button reads "Resume the tour" when progress is
`in_progress`, which the existing `tour-button` label logic already handles.

---

## 3. Data model

### 3.1 `memberOnboarding` (Q7a)

```ts
memberOnboarding: defineTable({
  memberId: v.id("users"),
  // Steps the member chose to skip. Done-ness is never stored: it is derived from data.
  skippedSteps: v.array(
    v.union(
      v.literal("puzzles"),
      v.literal("solves"),
      v.literal("people"),
      v.literal("household"),
      v.literal("profile"),
    ),
  ),
  welcomeDismissedAt: v.optional(v.number()),
  cardDismissedAt: v.optional(v.number()),
  updatedAt: v.number(),
}).index("by_member", ["memberId"]),
```

- At most one row per member. It is created lazily by the first
  `recordQuickStart` call; no row means nothing is skipped or dismissed.
- No `startedAt`, `lastStepId` or `completedAt` (architecture memo): "where to
  resume" is the first open step, and "completed" is derived.
- The member's data export (`insights/exportUserData.ts`) includes the row.
  Account deletion removes it with the member's other rows.

### 3.2 Completion `datePrecision` (Q5)

**Schema.** `completions` gains
`datePrecision: v.optional(v.union(v.literal("day"), v.literal("year"), v.literal("unknown")))`.

**Backfill rule: absent = `"day"`.** No migration. Writers store the field
only when it is not `"day"`, so legacy rows and new dated rows are
indistinguishable, and every reader uses `c.datePrecision ?? "day"`.

**Domain.** `CompletionState`, `RecordCompletionProps` and the
`CompletionRecorded` event gain
`datePrecision: "day" | "year" | "unknown"` (non-optional in the domain; the
mapper maps absent to `"day"`). The event payload carries it only when it is
not `"day"`, so old event rows read as `"day"`.

**Storage and the in-progress invariant.** The architecture memo's approach is
kept: an undated or year-only solve is stored as a **finished** completion with
both dates set to a sentinel, so every existing invariant holds:

| Precision | `startDate` = `endDate`                                   | `completionTimeMinutes` | `isCompleted` |
| --------- | --------------------------------------------------------- | ----------------------- | ------------- |
| `day`     | as entered (unchanged)                                    | as today                | `true`        |
| `year`    | `min(Date.UTC(year, 6, 1, 12), now)` (mid-year, UTC noon) | **absent**              | `true`        |
| `unknown` | `createdAt`                                               | **absent**              | `true`        |

- In-progress is still "`isCompleted = false`, `endDate` undefined", so
  `listMyInProgress`, the Solving-now section and `finishCompletion` are
  untouched. `endDate ≥ startDate` holds trivially.
- `Completion.record` skips the duration derivation for `year` and `unknown`
  (today a same-day record derives 1440 minutes) and rejects a supplied
  `completionTimeMinutes` for them (`SolvingError.durationNotAllowed`).
- `year` must be an integer from 1900 to the current UTC year. The mid-year
  sentinel keeps the stored instant inside that year in every timezone. The
  `min(…, now)` keeps a current-year solve out of the future.
- `startCompletion` and `finishCompletion` always produce `"day"`.
- `editCompletion`: setting a full start or end date on a `year`/`unknown` row
  upgrades it to `"day"`. This stays within the existing 24-hour edit window
  (§9, Q4).

**Effect on consumers (decisions 3 and 4):**

| Consumer                                                                            | `day`                    | `year`                                                            | `unknown`                            |
| ----------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------- | ------------------------------------ |
| Lifetime totals (`computePersonalStats.completionsCount`, profile counts)           | counted                  | counted                                                           | counted                              |
| Time averages / total solve minutes (`computePersonalStats`)                        | counted                  | excluded (no minutes)                                             | excluded (no minutes)                |
| "This year" (`routes/_dashboard/completions/index.tsx` stat)                        | counted                  | counted when `year` = current year (the sentinel is in that year) | **excluded**                         |
| Monthly trend chart (`insights/getCompletionTrends.ts` → `computeCompletionTrends`) | counted                  | **excluded** (D4: it cannot be placed in a month)                 | **excluded**                         |
| Goals (`countCompletedByUser`, used by `recompute-goal-progress`)                   | counted                  | counted                                                           | **excluded** (decision 4)            |
| Activity feed (`social/getActivityFeed.ts`, `CompletionRecorded` case)              | shown                    | **hidden** (D4)                                                   | **hidden** (decision 3)              |
| Profile completions (`social/listProfileCompletions.ts`, `profile-listings.tsx`)    | date                     | labelled "In 2023", sorted by its sentinel                        | labelled "Date unknown", sorted last |
| My completions list (`/completions`)                                                | date                     | "In 2023"                                                         | "Date unknown"                       |
| Data export                                                                         | field included as stored |                                                                   |                                      |

Why D4 goes slightly beyond the decision for `year`:

- **Monthly trends:** a `year` solve has no month. Placing it at the July
  sentinel would invent a spike. "Yearly stats" means anything keyed by year,
  such as "this year", where it counts.
- **Feed:** the feed shows what someone did recently. A year-precision solve is
  a backfill by definition, and a backfill of twenty "in 2023" solves floods
  followers exactly like the undated case the decision guards against.

These are listed as open questions (§9) in case the user wants `year` solves in
the feed. Goals keep counting `year` solves, as the decision says; see §9, Q1.

Formatting lives in `apps/web/src/lib/completion-format.ts`: a new
`formatCompletionDate(t, completion)` returns the date, "In {year}" or "Date
unknown".

### 3.3 The in-progress invariant (summary)

Undated and year-only solves are finished completions with sentinel dates. They
are never in-progress, never have a duration, and are filtered by precision at
each consumer above. No consumer infers precision from the dates.

### 3.4 Invite-token context for households (decision 2, Q6)

**Schema.** `inviteLinks` gains:

```ts
// Absent = the member's network link (one active per member, permanent until reset).
context: v.optional(v.object({ kind: v.literal("household"), householdId: v.string() })),
expiresAt: v.optional(v.number()),   // household links only: createdAt + 14 d
consumedAt: v.optional(v.number()),  // household links are single-use
consumedBy: v.optional(v.id("users")),
```

No new index: the per-inviter reads use `by_owner`, and redemption uses
`by_token`.

**Network link (unchanged behaviour).** `getMyInviteLink` and `resetInviteLink`
only consider rows with `context === undefined` when finding or revoking "the
active link", so household links never replace or revoke it.

**Household link.**

- **Create:** `social.createHouseholdInviteLink`. The actor must be the admin of
  their household (the same rule `makeInviteToHousehold` enforces). Each call
  mints a fresh opaque token (`crypto.randomUUID()` hex, like today) with
  `context = { kind: "household", householdId }` and
  `expiresAt = now + 14 d`.
- **Share:** `/members/<inviter-handle>?invite=<token>`, the same landing as the
  network link, sent from the device (§2.4).
- **Redeem:** in `redeemInvite`, after the existing new-member window, ledger
  and mutual-follow steps:
  - A household link that is expired or consumed is treated as **invalid as a
    whole**: no ledger row, no follow, `{ redeemed: false }`.
  - Otherwise it stamps `consumedAt`/`consumedBy` (single use) and runs
    `makeInviteToHousehold` with `actorId = link.ownerId` and
    `inviteeId = member`. That re-checks, at redeem time, that the inviter is
    still the admin, that the invitee is in no household, and that there is no
    duplicate. It creates a **pending** `householdInvites` row and emits
    `HouseholdInviteSent`, so the invitee gets the existing in-app notification.
    The invitee must accept: never auto-join.
  - Any domain refusal is swallowed into `householdInvite: "skipped"`. The
    follow and attribution still stand. The link stays consumed, and the
    inviter can make a new one.
  - Return: `{ redeemed, inviterId?, householdInvite?: "pending" | "skipped" }`.
- **Other token readers:**
  - `getInviteContext` returns `{ valid, kind: "network" | "household" }`, with
    `valid = false` for revoked, expired or consumed rows. It still returns no
    owner data and no household data (households have no name).
  - `acceptQrFollow` (the signed-in "follow each other" prompt) **ignores**
    household links and no-ops, so a household token's only effect is the
    redeem path above.
  - `recordInviteLanding` counts landings for any valid token (unchanged).

**Rate limits and expiry (D5).** There is no rate-limit component in the repo
today; these are plain bounded counts over `inviteLinks.by_owner` inside the
mutation:

- Household links expire **14 days** after creation and are **single-use**.
- At most **5 open** household links per inviter (not revoked, not consumed,
  not expired).
- At most **10 created per rolling 24 h** per inviter.
- Over either limit, `createHouseholdInviteLink` throws
  `ConvexError({ code: "invite_rate_limited" })`, which the UI shows as a
  toast.
- `social.revokeHouseholdInviteLinks` revokes all of the actor's open
  household links (a "Revoke open links" action on the household page).
- The network link is unchanged: one active row per member, no expiry (it is
  printed as a QR on profiles), reset on demand. Because only one can be active,
  it can't be multiplied.
- Redemption stays limited by the existing 15-minute new-member window and the
  one-redemption-per-member ledger (`inviteRedemptions.by_new_member`).

### 3.5 Landing-page survival across Clerk sign-up (Q6)

What already works: `/members/$handle?invite=<token>` stores the token in
`localStorage` (`jigswap.invite`) for a signed-out visitor on a live invite.
The sign-up CTA carries the same URL as `redirect_url`, and `InviteRedeemer`
(mounted in the `_dashboard` layout) redeems it once the `users` row exists.

Gaps, and how they are closed:

1. **Clerk returns to the landing, not the dashboard.** The signed-in
   `/members/$handle` page renders `DashboardShell` directly, outside the
   `_dashboard` layout, so `InviteRedeemer` does not run there. Today the
   member sees the "follow each other" prompt instead.
   - **Fix:** the signed-in landing checks whether the token is valid and the
     member is new (`createdAt` within the 15-minute window). If so, it stores
     the token and navigates to `/dashboard`, where `InviteRedeemer` redeems
     it. For a household token, the redeemer's success path then navigates to
     `/welcome?step=household`, where the pending invite is waiting.
2. **Storage lost across the redirect** (blocked storage, a different tab):
   because of fix 1, the `?invite=` that rides on `redirect_url` re-seeds the
   token on return, so `localStorage` is no longer the only carrier.
3. **Household context on the landing:**
   - Signed out: "<name> invited you to join their household on JigSwap. Sign
     up first. You'll then choose whether to join; nothing is shared until you
     accept."
   - An existing (not new) member on a household link: "You already have an
     account. Ask <name> to invite you from their household page." See §9, Q5.
   - Expired or used: "This invite link has expired or was already used." The
     plain profile teaser still renders below.
4. **Cross-device** (opened on a phone, signed up on a laptop): not
   recoverable without storing something server-side keyed to the visitor.
   That is accepted, as today. The inviter can still invite the new member by
   search.

---

## 4. API surface

All public functions call `requireMember` unconditionally, derive the actor
from auth, never trust a client-supplied member id, and are exposed through
`packages/gateway/src/operations.ts`. New public functions also need their
`_generated/api.d.ts` entries in a worktree.

### New

| Function                                                       | Kind          | PR  | Authz and contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library/acquireCopies:acquireCopies`                          | mutation      | Q4  | `requireMember`; owner = actor. Args `{ puzzleDefinitionIds: string[] (1–25, deduplicated), condition? (default "good") }`. Loops the same `makeAcquireCopy` use case as `acquireCopy`, so the same catalogue rules apply (approved definitions, or the actor's own pending submission). Availability stays at the domain default (all off). All or nothing: any refusal throws and nothing is written. Returns `{ copyIds: string[] }`. Each copy emits `CopyAcquired` with `bulk: true` (§9, Q3). |
| `catalog/lookupPuzzleByBarcode:lookupPuzzleByBarcode`          | query         | Q4  | `requireMember`. Args `{ code: string }` (8, 12 or 13 digits, else `null`). Wraps the internal `findPuzzleByBarcode` and returns only what the picker may show: an approved definition, or the actor's own pending submission. Returns the picker row shape or `null`.                                                                                                                                                                                                                              |
| `solving/recordPastCompletions:recordPastCompletions`          | mutation      | Q5  | `requireMember`. Args `{ items: { copyId: string, datePrecision: "day" \| "year" \| "unknown", date?: number, year?: number }[] }`, 1–25. Per item, the same copy gate as `recordCompletion` (owner, current holder, or `copyAccessOf ≠ "none"`) and the same snapshot write. `date` is required iff `day`, `year` iff `year`. All or nothing. Returns `{ completionIds: string[] }`.                                                                                                               |
| `social/createHouseholdInviteLink:createHouseholdInviteLink`   | mutation      | Q6  | `requireMember`; the actor must be the admin of their household (`HouseholdError.notHouseholdAdmin`). Rate limits per §3.4 (`invite_rate_limited`). Returns `{ token, expiresAt }`.                                                                                                                                                                                                                                                                                                                 |
| `social/revokeHouseholdInviteLinks:revokeHouseholdInviteLinks` | mutation      | Q6  | `requireMember`; revokes only the actor's own open household links. Returns `{ revoked: number }`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `onboarding/getQuickStart:getQuickStart`                       | query         | Q7a | `requireMember`; reads only the actor's own rows. Returns `{ eligible, showWelcome, cardVisible, steps: { id, status: "todo" \| "done" \| "skipped", optional: boolean, count?: number, pendingInvite?: boolean }[], requiredDone: number, requiredTotal: 4 }`. Derivation per §2.4 is a pure domain function; the query gathers the facts with bounded index reads.                                                                                                                                |
| `onboarding/recordQuickStart:recordQuickStart`                 | mutation      | Q7a | `requireMember`; writes only the actor's own row. Args: a validator union `{ kind: "skipStep" \| "unskipStep", step: StepId } \| { kind: "dismissWelcome" \| "dismissCard" \| "restoreCard" }`. Step ids are validated as literals. Idempotent. Returns `null`.                                                                                                                                                                                                                                     |
| `identity/setLocation:setLocation`                             | mutation      | Q8  | `requireMember`; patches only the actor's `users.location`. Trimmed; empty clears it; at most 80 characters (`invalid_location`). Returns `null`.                                                                                                                                                                                                                                                                                                                                                   |
| `onboarding/activationReport:activationReport`                 | internalQuery | Q8  | Internal only; never in the gateway. Args `{ from, to }` (≤ 31 days). Returns aggregates only (§1.2).                                                                                                                                                                                                                                                                                                                                                                                               |

### Changed

| Function                                     | PR      | Change                                                                                                                                                                                                                                      |
| -------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solving/recordCompletion`                   | Q5      | Optional `datePrecision` (default `"day"`) and `year`. `endDate` is still required for a finished solve at `day` precision; for `year`/`unknown` the sentinel is computed server-side and `endDate`/`completionTimeMinutes` must be absent. |
| `solving/editCompletion`                     | Q5      | A full date on a `year`/`unknown` row upgrades it to `"day"`; the edit window is unchanged.                                                                                                                                                 |
| Completion repository `countCompletedByUser` | Q5      | Excludes `unknown` (decision 4).                                                                                                                                                                                                            |
| `insights/getCompletionTrends`               | Q5      | Passes only `day` rows to `computeCompletionTrends`.                                                                                                                                                                                        |
| `social/getActivityFeed`                     | Q4, Q5  | Skips `CompletionRecorded` whose payload `datePrecision` is `year`/`unknown` (Q5), and `CopyAcquired` with `bulk: true` (Q4).                                                                                                               |
| `social/listProfileCompletions`              | Q5      | Returns `datePrecision`; `unknown` rows sort last.                                                                                                                                                                                          |
| `insights/exportUserData`                    | Q5, Q7a | Includes `datePrecision` and the `memberOnboarding` row.                                                                                                                                                                                    |
| `social/getMyInviteLink`, `resetInviteLink`  | Q6      | Only rows with `context === undefined` count as the network link.                                                                                                                                                                           |
| `social/getInviteContext`                    | Q6      | Returns `{ valid, kind }`; expiry and consumption make it invalid.                                                                                                                                                                          |
| `social/acceptQrFollow`                      | Q6      | No-op for household links.                                                                                                                                                                                                                  |
| `social/redeemInvite`                        | Q6      | Household branch per §3.4; return gains `householdInvite?`.                                                                                                                                                                                 |
| `whatsNew/recordTourProgress`                | Q8      | Also accepts `STANDALONE_TOUR_IDS`.                                                                                                                                                                                                         |

No change to `household.acceptInvite` / `declineInvite`; the pending invite a
household link creates is an ordinary `householdInvites` row.

---

## 5. Visual section

Everything here uses existing pieces only: the `globals.css` tokens,
`font-heading`, the `ui/` primitives (`Dialog`, `Button`, `Badge`, `Command`,
`Checkbox`), `SectionHead`, `SegmentedPills`, `AvailabilityChips`, `MemberTile`,
`PuzzlePlank`, and the What's new modal anatomy. No new tokens, so `.dark`
works as is. The two contrast rules from the decisions are enforced with the
numbers in §5.5.

### 5.1 Welcome dialog

As §2.1. Header band `h-28 bg-jigsaw-primary-tint` with a `Puzzle` tile
(`size-14 rounded-2xl bg-card text-jigsaw-primary shadow-sm`, as in the
highlight modal), title `font-heading text-2xl`, numbered lines with
`size-6 rounded-full border-2 border-border text-foreground` markers, the time
line in `text-sm text-muted-foreground`, footer `border-t bg-muted/40 p-4`.

### 5.2 Dashboard card

```
Quick setup ─────────────────────────── 2 of 4  ✕
[■■■■■■■■□□□□□□□□]   h-1.5 rounded-full bg-muted, fill bg-primary
(✓) Add your puzzles              7 added
(✓) Log puzzles you finished      3 logged
(3) Find your people                     ›
(·) Household  [Optional]   Skipped · Do it now
(5) Make it yours                        ›
```

| State                      | Marker (`size-6 rounded-full`, centred icon or number)                                    | Row text                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| todo                       | `border-2 border-border`, step number in `text-foreground`                                | `font-semibold`, chevron                                  |
| in progress                | `border-2 border-primary`, number in **`text-primary dark:text-foreground`**              | sub-line "Continue · 2 of 3" in `text-muted-foreground`   |
| done                       | **`bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200`**, `Check` icon  | `text-muted-foreground` with the count; no strike-through |
| skipped                    | `border-2 border-dashed border-muted-foreground`, `Minus` icon in `text-muted-foreground` | "Skipped" plus a `link`-variant button "Do it now"        |
| optional                   | as its state, plus `Badge variant="secondary"` "Optional"                                 | never counted in "x of 4"                                 |
| pending invite (household) | todo marker plus a `bg-jigsaw-primary` 8 px dot                                           | "Invitation waiting"                                      |

- **Done is never `text-jigsaw-secondary` on `bg-jigsaw-secondary-tint`**
  (2.13:1 light, 4.18:1 dark; both fail 4.5:1). The measured Tailwind green
  pill is used instead (6.45:1 / 10.29:1).
- **"In progress"** = the step was opened in this session, or it has a partial
  count (e.g. 2 of 3 copies). The dark-mode number uses `text-foreground`,
  because `text-primary` on `card` is only 3.71:1 there, too low for a
  12–14 px numeral. The `border-primary` ring (3.71:1) still meets the 3:1
  non-text rule, so the state stays visible.
- The todo marker's `border-border` ring is only 1.29:1. It is decorative: the
  numeral (20.17:1) and the row label carry the state. State is never shown by
  colour alone; each state has its own icon or numeral and its own text.
- Rows are at least 44 px high (`min-h-11`), the whole row is the link, and the
  `X` is `size-9 pointer-coarse:size-11`.

**Mobile.** Same card, full width. The meta "2 of 4" stays in the head and the
counts wrap under the label.

### 5.3 Stepper inside `/welcome`

- **Mobile:** a sticky header "Step 2 of 4 · Past solves" above the same
  progress bar (only the 4 required steps are numbered; the household step
  reads "Optional step").
- **`md` and up:** an `<ol>` of markers using the card's marker styles, with
  `aria-current="step"` on the current one.
- **Sticky footer:** `border-t bg-card p-4`, padded for the safe area, with
  `Skip` (ghost) and `Continue` (primary). On mobile `Continue` is full width
  and `Skip` sits to its left as a text button.
- A step change moves focus to that step's `h1`.

### 5.4 Per-step sketches (360 px)

**Add puzzles.**

```
┌ Search brand, title or barcode… 🔍 ┐
│ ▢ [img] Ravensburger              │
│   Mountain Lake · 1000      (+)   │  ← (+) → (✓) on bg-jigsaw-primary-tint
│ ▣ [img] Jumbo · Cats · 500   ✓    │
│ ── Can't find it? ─────────────── │
│ [+ Register "Cats at nig…"]       │  → /my-puzzles/add/new?…&returnTo=…
└───────────────────────────────────┘
 Picked (3)  [Mountain Lake ×][Cats ×]…
 Added puzzles are not offered for swap or loan…
 [ Skip ]               [ Add 3 puzzles ]
```

A picked row is `bg-jigsaw-primary-tint` with `text-foreground` (17.78:1 light,
10.39:1 dark). The check icon is `text-jigsaw-primary dark:text-foreground`:
the brand violet on its own tint is 5.16:1 in light mode but only 2.57:1 in
dark mode, below 3:1 even for an icon. The toggle button's accessible name is
"Add Mountain Lake" / "Remove Mountain Lake", and a polite live region
announces "3 picked".

**Past solves.**

```
☑ Mountain Lake · 1000
   When?  (● I don't remember) (○ Which year) (○ Pick a date)
          [ 2023 ▾ ]   or   [ 2026-03-14 ]
☐ Cats · 500
 [ Skip ]               [ Log 1 puzzle ]
```

**Find people.** "People you may know" as `MemberTile` cards with the compact
icon `FollowButton`, then `FindPeople`, then the invite block:

```
 Invite someone who isn't on JigSwap yet
 Share your invite link. When they sign up, you'll follow each other.
 [ Share invite link ]                       (Web Share API)
 [Copy link] [Email] [WhatsApp]              (outline buttons)
 JigSwap doesn't see or store who you send this to.
 ┌ Want a notification when someone follows you back? ┐   (inline, §2.7)
 │ [Turn on notifications]  [Not now]                 │
 └────────────────────────────────────────────────────┘
```

**Household.** A pending invite card (avatar, "<name> invited you to their
household", the explainer, Accept primary / Decline ghost), or
`SegmentedPills` "Create a household" / "I puzzle alone", then
`HouseholdInvitePanel` with the "Invite with a link" block and the "works once,
expires in 14 days" note in `text-muted-foreground`.

**Make it yours.** The avatar with "Change photo", the "City" input, the
visibility `SegmentedPills` and a "What others see" `MemberTile` preview.

### 5.5 Contrast, computed from the real theme values

Values come from `apps/web/src/styles/globals.css` (`:root` and `.dark`):
OKLCH tokens are converted to sRGB, `color-mix(in oklab, …)` tints are mixed in
OKLab exactly as the CSS declares them, Tailwind `/NN` alpha is blended over
`--card`, and Tailwind v4's green palette supplies the pill. Ratios are WCAG
2.x relative-luminance contrast.

| Pair                                                                                            | Light      | Dark       | Needed | Verdict                                          |
| ----------------------------------------------------------------------------------------------- | ---------- | ---------- | ------ | ------------------------------------------------ |
| `text-jigsaw-secondary` on `bg-jigsaw-secondary-tint` (rejected)                                | **2.13:1** | **4.18:1** | 4.5    | fails both: not used                             |
| Done pill: `text-green-800` on `bg-green-100` / `text-green-200` on `bg-green-900/40` over card | 6.45:1     | 10.29:1    | 4.5    | pass                                             |
| **Progress fill `bg-primary` vs track `bg-muted`**                                              | **5.42:1** | **3.16:1** | 3.0    | pass both                                        |
| Progress fill `bg-primary` vs `card` (bar edge)                                                 | 6.01:1     | 3.71:1     | 3.0    | pass                                             |
| In-progress ring `border-primary` vs `card`                                                     | 6.01:1     | 3.71:1     | 3.0    | pass                                             |
| In-progress numeral `text-primary` on `card`                                                    | 6.01:1     | 3.71:1     | 4.5    | dark fails: use `dark:text-foreground`           |
| Row meta `text-muted-foreground` on `card`                                                      | 4.82:1     | 5.80:1     | 4.5    | pass                                             |
| Skipped ring `border-muted-foreground` vs `card`                                                | 4.82:1     | 5.80:1     | 3.0    | pass                                             |
| Todo numeral `text-foreground` on `card`                                                        | 20.17:1    | n/a        | 4.5    | pass                                             |
| Picked row `text-foreground` on `bg-jigsaw-primary-tint`                                        | 17.78:1    | 10.39:1    | 4.5    | pass                                             |
| Picked check `text-jigsaw-primary` on `bg-jigsaw-primary-tint`                                  | 5.16:1     | 2.57:1     | 3.0    | dark fails: use `dark:text-foreground` (10.39:1) |
| "Optional" `Badge variant="secondary"`                                                          | 11.68:1    | 11.16:1    | 4.5    | pass                                             |
| Primary button text on `bg-primary`                                                             | 5.75:1     | 3.80:1     | 4.5    | dark fails: pre-existing, system-wide (§9, Q8)   |

Resolved sRGB values for reference:

- light: primary `#574be2`, muted `#f2f2fb`, card `#ffffff`,
  secondary-tint `#e6f8e4`, primary-tint `#eef0ff`
- dark: primary `#786cfe`, muted `#33324e`, card `#282642`,
  secondary-tint `#2e4746`, primary-tint `#373365`

The dark progress fill passes with little margin (3.16:1). If UI review wants
more headroom, a 1 px `ring-1 ring-primary/40` on the track is the option that
changes no token.

### 5.6 Accessibility

- The progress bar is `role="progressbar"` with `aria-valuemin=0`,
  `aria-valuemax=4`, `aria-valuenow`, and `aria-valuetext="2 of 4 steps done"`.
- The card's rows are a list. Each link's name includes its state ("Add your
  puzzles, done, 7 added").
- Keyboard: arrows and Enter in `Command`, the arrow-key radiogroup in
  `SegmentedPills`, Backspace removes a picked chip. Nothing needs hover.
- Every animation has `motion-reduce:animate-none`.
- Touch targets are at least 44 px (`pointer-coarse:size-11`).

---

## 6. i18n keys

New keys go in **all three** locale files (`apps/web/locales/en.json`,
`nl.json`, and `source.json`, which mirrors en). New namespace `quickStart`
unless noted. ICU plurals follow the existing style.

| Key                                                 | en                                                                                                             | nl                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `welcome.title`                                     | Welcome to JigSwap!                                                                                            | Welkom bij JigSwap!                                                                                             |
| `welcome.body`                                      | Shall we set up your shelf? Add the puzzles you own, the ones you've finished, and the people you puzzle with. | Zullen we je plank inrichten? Voeg je puzzels toe, wat je al gelegd hebt en met wie je puzzelt.                 |
| `welcome.stepPuzzles`                               | Add the puzzles on your shelf                                                                                  | Voeg de puzzels op je plank toe                                                                                 |
| `welcome.stepSolves`                                | Mark the ones you've finished                                                                                  | Vink aan welke je al gelegd hebt                                                                                |
| `welcome.stepPeople`                                | Find the people you puzzle with                                                                                | Vind de mensen met wie je puzzelt                                                                               |
| `welcome.time`                                      | Takes about 3 minutes. You can stop at any time.                                                               | Duurt ongeveer 3 minuten. Je kunt altijd stoppen.                                                               |
| `welcome.start`                                     | Start quick setup                                                                                              | Snel instellen                                                                                                  |
| `welcome.explore`                                   | Explore on my own                                                                                              | Zelf rondkijken                                                                                                 |
| `card.title`                                        | Quick setup                                                                                                    | Snel instellen                                                                                                  |
| `card.progress`                                     | {done} of {total}                                                                                              | {done} van {total}                                                                                              |
| `card.progressLabel`                                | {done} of {total} steps done                                                                                   | {done} van {total} stappen klaar                                                                                |
| `card.hide`                                         | Hide quick setup                                                                                               | Snel instellen verbergen                                                                                        |
| `card.hiddenToast`                                  | Quick setup is hidden. You can reopen it from your account menu.                                               | Snel instellen is verborgen. Je kunt het weer openen via je accountmenu.                                        |
| `card.optional`                                     | Optional                                                                                                       | Optioneel                                                                                                       |
| `card.skipped`                                      | Skipped                                                                                                        | Overgeslagen                                                                                                    |
| `card.doItNow`                                      | Do it now                                                                                                      | Nu doen                                                                                                         |
| `card.continue`                                     | Continue · {progress}                                                                                          | Verder · {progress}                                                                                             |
| `card.allDone`                                      | Your shelf is set up                                                                                           | Je plank is ingericht                                                                                           |
| `card.hideDone`                                     | Hide                                                                                                           | Verbergen                                                                                                       |
| `menu.quickSetup`                                   | Quick setup                                                                                                    | Snel instellen                                                                                                  |
| `steps.puzzles.title`                               | Add your puzzles                                                                                               | Voeg je puzzels toe                                                                                             |
| `steps.puzzles.count`                               | {count} added                                                                                                  | {count} toegevoegd                                                                                              |
| `steps.puzzles.partial`                             | {count} of 3                                                                                                   | {count} van 3                                                                                                   |
| `steps.solves.title`                                | Log puzzles you finished                                                                                       | Leg vast wat je al gelegd hebt                                                                                  |
| `steps.solves.count`                                | {count} logged                                                                                                 | {count} vastgelegd                                                                                              |
| `steps.people.title`                                | Find your people                                                                                               | Vind je puzzelmaatjes                                                                                           |
| `steps.people.count`                                | Following {count}                                                                                              | {count} gevolgd                                                                                                 |
| `steps.household.title`                             | Household                                                                                                      | Huishouden                                                                                                      |
| `steps.household.done`                              | You're in a household                                                                                          | Je zit in een huishouden                                                                                        |
| `steps.household.pending`                           | Invitation waiting                                                                                             | Uitnodiging wacht op je                                                                                         |
| `steps.profile.title`                               | Make it yours                                                                                                  | Maak het persoonlijk                                                                                            |
| `steps.profile.done`                                | Profile set                                                                                                    | Profiel ingesteld                                                                                               |
| `flow.title`                                        | Quick setup                                                                                                    | Snel instellen                                                                                                  |
| `flow.stepOf`                                       | Step {step} of {total}                                                                                         | Stap {step} van {total}                                                                                         |
| `flow.optionalStep`                                 | Optional step                                                                                                  | Optionele stap                                                                                                  |
| `flow.skip`                                         | Skip                                                                                                           | Overslaan                                                                                                       |
| `flow.continue`                                     | Continue                                                                                                       | Doorgaan                                                                                                        |
| `flow.finishLater`                                  | Finish later                                                                                                   | Later afmaken                                                                                                   |
| `picker.searchPlaceholder`                          | Search brand, title or barcode…                                                                                | Zoek op merk, titel of streepjescode…                                                                           |
| `picker.add`                                        | Add {title}                                                                                                    | {title} toevoegen                                                                                               |
| `picker.remove`                                     | Remove {title}                                                                                                 | {title} verwijderen                                                                                             |
| `picker.picked`                                     | {count} picked                                                                                                 | {count} gekozen                                                                                                 |
| `picker.onShelf`                                    | On your shelf                                                                                                  | Op je plank                                                                                                     |
| `picker.notListed`                                  | Can't find it?                                                                                                 | Niet gevonden?                                                                                                  |
| `picker.register`                                   | Register "{query}"                                                                                             | "{query}" registreren                                                                                           |
| `picker.submit`                                     | {count, plural, one {Add # puzzle} other {Add # puzzles}}                                                      | {count, plural, one {# puzzel toevoegen} other {# puzzels toevoegen}}                                           |
| `picker.availabilityNote`                           | Added puzzles are not offered for swap or loan. You can change that per puzzle later.                          | Toegevoegde puzzels worden niet aangeboden om te ruilen of uit te lenen. Dat kun je later per puzzel aanpassen. |
| `solves.lead`                                       | Did you finish any of these?                                                                                   | Heb je een van deze al gelegd?                                                                                  |
| `solves.finished`                                   | I finished {title}                                                                                             | Ik heb {title} gelegd                                                                                           |
| `solves.when`                                       | When?                                                                                                          | Wanneer?                                                                                                        |
| `solves.dontRemember`                               | I don't remember                                                                                               | Weet ik niet meer                                                                                               |
| `solves.whichYear`                                  | Which year                                                                                                     | Welk jaar                                                                                                       |
| `solves.pickDate`                                   | Pick a date                                                                                                    | Kies een datum                                                                                                  |
| `solves.showMore`                                   | Show more                                                                                                      | Meer tonen                                                                                                      |
| `solves.empty`                                      | Add a puzzle first, then come back to log it.                                                                  | Voeg eerst een puzzel toe en kom dan terug om hem vast te leggen.                                               |
| `solves.submit`                                     | {count, plural, one {Log # puzzle} other {Log # puzzles}}                                                      | {count, plural, one {# puzzel vastleggen} other {# puzzels vastleggen}}                                         |
| `people.suggested`                                  | People you may know                                                                                            | Mensen die je misschien kent                                                                                    |
| `people.inviteTitle`                                | Invite someone who isn't on JigSwap yet                                                                        | Nodig iemand uit die nog niet op JigSwap zit                                                                    |
| `people.inviteBody`                                 | Share your invite link. When they sign up, you'll follow each other.                                           | Deel je uitnodigingslink. Als ze zich aanmelden, volgen jullie elkaar.                                          |
| `share.share`                                       | Share invite link                                                                                              | Uitnodigingslink delen                                                                                          |
| `share.email`                                       | Email                                                                                                          | E-mail                                                                                                          |
| `share.whatsapp`                                    | WhatsApp                                                                                                       | WhatsApp                                                                                                        |
| `share.subject`                                     | Join me on JigSwap                                                                                             | Kom ook op JigSwap                                                                                              |
| `share.message`                                     | Join me on JigSwap, where I keep track of my puzzles: {url}                                                    | Kom ook op JigSwap, daar houd ik mijn puzzels bij: {url}                                                        |
| `share.householdMessage`                            | Join our household on JigSwap so we can share one puzzle shelf: {url}                                          | Word lid van ons huishouden op JigSwap, dan delen we één puzzelplank: {url}                                     |
| `share.privacy`                                     | JigSwap doesn't see or store who you send this to.                                                             | JigSwap ziet en bewaart niet naar wie je dit stuurt.                                                            |
| `household.lead`                                    | Live with someone who puzzles? Share one shelf.                                                                | Woon je samen met iemand die puzzelt? Deel één plank.                                                           |
| `household.create`                                  | Create a household                                                                                             | Een huishouden aanmaken                                                                                         |
| `household.alone`                                   | I puzzle alone                                                                                                 | Ik puzzel alleen                                                                                                |
| `household.inviteMember`                            | Invite a member                                                                                                | Een lid uitnodigen                                                                                              |
| `household.inviteLink`                              | Invite with a link                                                                                             | Uitnodigen met een link                                                                                         |
| `household.linkNote`                                | The link works once and expires in 14 days.                                                                    | De link werkt één keer en verloopt na 14 dagen.                                                                 |
| `household.revokeLinks`                             | Revoke open links                                                                                              | Open links intrekken                                                                                            |
| `household.pendingTitle`                            | {name} invited you to their household                                                                          | {name} heeft je uitgenodigd voor hun huishouden                                                                 |
| `profile.lead`                                      | Help people recognise you.                                                                                     | Help anderen je te herkennen.                                                                                   |
| `profile.changePhoto`                               | Change photo                                                                                                   | Foto wijzigen                                                                                                   |
| `profile.city`                                      | City                                                                                                           | Woonplaats                                                                                                      |
| `profile.cityHint`                                  | Optional. Shown on your profile.                                                                               | Optioneel. Zichtbaar op je profiel.                                                                             |
| `profile.visibility`                                | Who can see your profile?                                                                                      | Wie kan je profiel zien?                                                                                        |
| `profile.public`                                    | Everyone                                                                                                       | Iedereen                                                                                                        |
| `profile.private`                                   | Only people you approve                                                                                        | Alleen mensen die je toelaat                                                                                    |
| `profile.preview`                                   | What others see                                                                                                | Wat anderen zien                                                                                                |
| `push.title`                                        | Want a notification when someone follows you back?                                                             | Wil je een melding als iemand je terugvolgt?                                                                    |
| `push.enable`                                       | Turn on notifications                                                                                          | Meldingen aanzetten                                                                                             |
| `push.notNow`                                       | Not now                                                                                                        | Niet nu                                                                                                         |
| `done.title`                                        | Your shelf is ready                                                                                            | Je plank staat klaar                                                                                            |
| `done.summary`                                      | {copies, plural, one {# puzzle} other {# puzzles}} · {solves} finished · {following} following                 | {copies, plural, one {# puzzel} other {# puzzels}} · {solves} gelegd · {following} gevolgd                      |
| `done.goToShelf`                                    | Go to my shelf                                                                                                 | Naar mijn plank                                                                                                 |
| `done.tour`                                         | Show me around                                                                                                 | Geef me een rondleiding                                                                                         |
| `errors.inviteRateLimited`                          | You've created a lot of invite links today. Try again tomorrow.                                                | Je hebt vandaag veel uitnodigingslinks gemaakt. Probeer het morgen opnieuw.                                     |
| `invite.householdInvitedYou` (existing `invite` ns) | {name} invited you to join their household on JigSwap                                                          | {name} heeft je uitgenodigd voor hun huishouden op JigSwap                                                      |
| `invite.householdExplainer`                         | Sign up first. You'll then choose whether to join; nothing is shared until you accept.                         | Meld je eerst aan. Daarna kies je of je meedoet; er wordt niets gedeeld tot je accepteert.                      |
| `invite.householdExistingMember`                    | You already have an account. Ask {name} to invite you from their household page.                               | Je hebt al een account. Vraag {name} om je uit te nodigen via de huishoudenpagina.                              |
| `invite.linkExpired`                                | This invite link has expired or was already used.                                                              | Deze uitnodigingslink is verlopen of al gebruikt.                                                               |
| `solving.completions.dateUnknown`                   | Date unknown                                                                                                   | Datum onbekend                                                                                                  |
| `solving.completions.inYear`                        | In {year}                                                                                                      | In {year}                                                                                                       |
| `tour.pausedStandalone`                             | Tour paused. You can resume it from Quick setup.                                                               | Rondleiding gepauzeerd. Je kunt verder gaan via Snel instellen.                                                 |
| `tours.getting-started.steps.shelf.title`           | Your shelf                                                                                                     | Je plank                                                                                                        |
| `tours.getting-started.steps.shelf.body`            | Every puzzle you add lands here. Open one to log a solve or offer it for a swap.                               | Elke puzzel die je toevoegt komt hier. Open er een om een oplossing vast te leggen of hem te ruilen.            |
| `tours.getting-started.steps.solving-now.title`     | Solving now                                                                                                    | Nu aan het puzzelen                                                                                             |
| `tours.getting-started.steps.solving-now.body`      | Start a puzzle to keep track of how long it takes. It shows up here until you finish.                          | Start een puzzel om bij te houden hoe lang je erover doet. Hij staat hier tot je klaar bent.                    |
| `tours.getting-started.steps.people.title`          | Your network                                                                                                   | Je netwerk                                                                                                      |
| `tours.getting-started.steps.people.body`           | People you follow each other with. Their shelves and solves show up for you.                                   | Mensen met wie je elkaar volgt. Hun planken en oplossingen zie je hier.                                         |
| `tours.getting-started.steps.account-menu.title`    | Settings and quick setup                                                                                       | Instellingen en snel instellen                                                                                  |
| `tours.getting-started.steps.account-menu.body`     | Your profile, notifications and Quick setup live here.                                                         | Je profiel, meldingen en Snel instellen vind je hier.                                                           |

Existing keys reused as is: `invite.copyLink`, `invite.copied`,
`invite.needUsernameTitle`/`Body`, `household.explainer`,
`household.invites.accept`/`decline`, and the existing "Pending review" badge
copy.

---

## 7. PR breakdown

The order follows the decisions file. Q2 and Q3 are small PRs off `main`. Q4–Q8
stack on this spec (Q1), which stacks on the What's new stack and will be
rebased onto `main` when that merges.

| PR      | Base             | Content                                                                                                                                                                                                                                                                                                         | Depends on                                       |
| ------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Q1**  | What's new stack | This spec.                                                                                                                                                                                                                                                                                                      | #99                                              |
| **Q2**  | `main`           | Catalogue search fix: search on the server instead of filtering the loaded 20-row slice.                                                                                                                                                                                                                        | none                                             |
| **Q3**  | `main`           | Clerk sync uses the verified **primary** email (`primary_email_address_id`) instead of `email_addresses[0]`. Hygiene only: nothing in this track matches on email any more.                                                                                                                                     | none                                             |
| **Q4**  | Q1               | `library.acquireCopies` (with `bulk: true` on `CopyAcquired`, and the feed skip), the `CataloguePicker` (with barcode lookup), and `returnTo` on `/my-puzzles/add/new`. The picker is usable on its own from `/my-puzzles/add`.                                                                                 | Q1; uses Q2's search once Q2 is on `main` (soft) |
| **Q5**  | Q4               | `datePrecision` across domain, schema, mapper and events; `recordCompletion`/`editCompletion` changes; `recordPastCompletions`; every consumer in §3.2; `formatCompletionDate`; the bulk "I've solved these" rows component.                                                                                    | Q4 (stack order only)                            |
| **Q6**  | Q5               | Invite-link context: schema, `createHouseholdInviteLink`, `revokeHouseholdInviteLinks`, the changed token readers, the redeem branch, rate limits, landing changes (§3.5), `InviteShareActions`, and `HouseholdInvitePanel` extracted on the household page.                                                    | Q5 (stack order only)                            |
| **Q7a** | Q6               | `memberOnboarding`, `getQuickStart` (pure derivation in the domain), `recordQuickStart`, gateway entries, tests.                                                                                                                                                                                                | Q6 (stack order only)                            |
| **Q7b** | Q7a              | Welcome dialog with surface-busy priority, the `canOpenHighlight` `/welcome` exclusion, the `/welcome?step=` route and stepper, `QuickSetupCard`, the account-menu item, steps 1–4 wired to Q4/Q5/Q6, the push prompt (with `usePushSubscription` extracted), the done panel, and `InviteRedeemer` suppression. | Q7a, Q4, Q5, Q6                                  |
| **Q8**  | Q7b              | `activationReport` (internal) with the pure `isActivated`; consent-gated funnel events; step 5 "Make it yours" with `identity.setLocation`; `STANDALONE_TOUR_IDS`, the `recordTourProgress` change and the `getting-started` tour with its `dashboard-shelf` anchor.                                            | Q7b                                              |

**Adjustments to the decisions file and why:**

- **Q7 is split into Q7a and Q7b (D8).** As one PR it would hold a new table,
  two functions, the welcome dialog, a route with five steps, the card and the
  push prompt. That is too much to verify in one review. The backend half is
  self-contained and fully testable with convex-test.
- **The tour hand-off goes in Q8**, with "Make it yours", because both touch the
  end of the flow and the tour change is small. Until Q8 lands, the done panel
  shows only "Go to my shelf".
- **Funnel events (Q8)** are a handful of PostHog `capture` calls behind the
  existing analytics consent (`lib/analytics-consent.ts`): `qs_welcome_shown`,
  `qs_started`, `qs_step_skipped{step}`, `qs_completed`, `invite_shared{channel,context}`,
  `household_link_created`. They undercount by design; the activation report is
  the source of truth.
- **Q2 is a soft dependency of Q4,** not a hard one. Q4 can merge before Q2;
  the picker then switches to the server search when the stack is rebased on a
  `main` that has Q2.

---

## 8. Test plan and out of scope

### 8.1 Tests (TDD: failing test first in each PR)

- **Domain (`*.spec.ts`):**
  - `Completion.record` with each precision: sentinels, no derived duration, a
    rejected duration for `year`/`unknown`, year bounds, and `CompletionRecorded`
    carrying the precision.
  - `computeCompletionTrends` and `computePersonalStats` with mixed precisions.
  - The goal recompute with `unknown` excluded and `year` counted.
  - The quick-start step derivation (every row of §2.4, including skipped plus
    done = done).
  - `isActivated` boundaries: exactly 3 copies, the 7-day edge, a mutual
    follow whose second edge lands after the window, a household of one.
- **Backend (convex-test, at the `convex/` root):**
  - `acquireCopies.test.ts`: authz, the 25 cap, all-or-nothing, availability
    off, the feed skip.
  - `pastCompletions.test.ts`: the copy gate, the feed hides `year`/`unknown`,
    goals, profile sort and labels.
  - `householdInviteLinks.test.ts`: admin only, both rate limits, expiry,
    single use, pending (not joined) on redeem, a refusal still keeps the
    follow, `getMyInviteLink`/`resetInviteLink` ignore household rows,
    `acceptQrFollow` no-op, `getInviteContext` kinds.
  - `onboarding.test.ts`: derivation from real rows, own-row-only writes,
    literal validation, idempotency.
  - `activationReport.test.ts`: aggregates only, cohort bounds.
  - `whatsNew.test.ts`: a standalone id is accepted, other unknown ids are
    still rejected.
- **Web (component and logic tests):**
  - `canOpenHighlight` with `/welcome`.
  - The welcome dialog reports busy while loading and while shown.
  - `QuickSetupCard` in each state of §5.2.
  - Step pages: Skip writes, Continue doesn't.
  - The push prompt conditions.
  - `InviteShareActions` with and without `navigator.share`.
  - `definitions.test.ts` with the standalone ids.
  - Locale parity across en, nl and source.
- **CI gate:** the full gate (format, lint, type-check, tests, build,
  architecture check, backend coverage) with no cache, per the repo
  conventions. Convex code is type-checked separately.
- **Manual:** browser automation is unavailable in this environment, so each
  web PR states what was not visually verified (SSR render check plus
  component tests). The usability test from the UX memo should run before the
  activation threshold is tuned: 5–6 remote sessions, at least 2 on phones and
  1 in Dutch, with the tasks "add 10 puzzles from a shelf photo", "mark 3 as
  done, dates unknown", "get your partner on JigSwap" and "quit and resume".

### 8.2 Out of scope

- **Circles** (sharing groups), including "put them in a circle" follow-ups.
- **Server-sent email invites** of any kind: no `emailInvites` table, no AhaSend
  invite template, no reminders, no email-match materialisation on sign-up, no
  contact or address-book import.
- Nudge emails or in-app nudges for members who stop part-way (growth memo).
- The intent question (D1) and the step-order experiment.
- An "Inviter" badge or other invite rewards.
- Fixing the existing dark-mode primary button contrast (§9, Q8).

---

## 9. Open questions

Each has the conservative default this spec builds on, so implementation is
not blocked.

1. **Should `year` solves count toward goals?** A backfill of "in 2023" solves
   makes a fresh goal start partly done. The decisions only exclude `unknown`.
   _Default: count them, as decided._ Revisit if goals gain a start date.
2. **Should `year` solves appear in the activity feed?** _Default: hidden (D4)_,
   because they are backfills by definition.
3. **Bulk adds flooding the feed.** `acquireCopies` of 25 copies would put 25
   "acquired" entries in followers' feeds, often the inviter's. _Default: Q4
   tags batch-created copies `bulk: true` and the feed skips them._ Single adds
   still show.
4. **Dating an undated solve later.** The domain's 24-hour edit window means an
   undated backfill can't be dated a week later. _Default: keep the window._ A
   follow-up could exempt "add a date to an undated solve" from it.
5. **An existing member opens a household link.** Redemption is new-member-only
   (15-minute window). _Default: no household invite and no follow; the
   landing tells them to ask for an in-app invite_, which already works by
   member search.
6. **The 15-minute new-member window** may be short for a slow Clerk
   verification. _Default: keep it_; the in-app invite is the fallback.
7. **Step 1 threshold: 3 copies or 1?** _Default: 3 (D3)_, so the checklist
   drives what activation measures. The row shows "2 of 3" until then.
8. **The dark-mode primary button is 3.80:1** (`--primary-foreground` on
   `--primary`), below 4.5:1 for its label. It is pre-existing and affects
   every primary button. _Default: out of scope here_; flagged for a separate
   theme PR.
9. **Card visibility for existing members** with 0 copies who signed up long
   ago. _Default: show the card (no welcome dialog)_; they can hide it.
10. **Activation's household link** requires the other member to join inside
    the window too. _Default: yes_; a household of one isn't a connection.
