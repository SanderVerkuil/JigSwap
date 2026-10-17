# Quick start: a first-sign-in setup members can choose to follow

**Date:** 2026-10-17
**Status:** Draft for review (PR Q1, spec only). The visual section (§5) has been through UI review.
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
| D9  | The progress bar is **four segments**, not a continuous bar with a ring, so its binding contrast is 4.24:1 dark, not 3.16:1.   | §5.6    |

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
body, then the footer `border-t bg-muted/40`. The primary button uses the
highlight's `bg-jigsaw-primary text-white` look, and focus starts on it. The
exact classes are in §5.1.

**Copy.**

| Element | en                                                                                                             | nl                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Title   | Welcome to JigSwap!                                                                                            | Welkom bij JigSwap!                                                                                  |
| Body    | Shall we set up your shelf? Add the puzzles you own, the ones you've finished, and the people you puzzle with. | Zullen we je plank inrichten? Voeg je puzzels toe, welke je al hebt afgemaakt en met wie je puzzelt. |
| Line 1  | Add the puzzles on your shelf                                                                                  | Voeg de puzzels op je plank toe                                                                      |
| Line 2  | Mark the ones you've finished                                                                                  | Vink aan welke je al hebt afgemaakt                                                                  |
| Line 3  | Find the people you puzzle with                                                                                | Vind de mensen met wie je puzzelt                                                                    |
| Time    | Takes about 3 minutes. You can stop at any time.                                                               | Duurt ongeveer 3 minuten. Je kunt altijd stoppen.                                                    |
| Primary | Start quick setup                                                                                              | Snel instellen                                                                                       |
| Ghost   | Explore on my own                                                                                              | Zelf rondkijken                                                                                      |

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
- **Layout:** a stepper header, the step body (titled by an `h2`; `PageHead`
  owns the `h1`), and a sticky footer `border-t bg-card` with `Skip` (ghost)
  and `Continue` (primary). Below `md` the footer docks above the sticky
  `MobileTabBar` instead of at `bottom-0` (§5.3). There is also a "Finish
  later" link in the header back to `/dashboard`.
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

- **Active:** a card-free `<section>`, like `ShelfSection`. A `SectionHead`
  with a `ListChecks` icon, the title "Quick setup", meta "2 of 4", and a ghost
  icon button `X` labelled "Hide quick setup". Then a four-segment progress
  bar and one row per step (§5.2). Each row links to `/welcome?step=<id>`.
- **All required steps done or skipped:** for the rest of that browser
  session (sessionStorage key `jigswap.quickStart.doneShown`), the card shrinks
  to one row: "Your shelf is set up ✓ · Hide". On a later session it is gone.
  "Hide" calls `dismissCard`.
- **Hidden:** "Hide quick setup" calls `recordQuickStart({ kind: "dismissCard" })`,
  focus moves to the Shelf section's heading (§5.7), and a toast says it can be reopened
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

| #   | Step id     | Title (en / nl)                                              | Done when (derived)                                                                                                   | Row meta when done      |
| --- | ----------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | `puzzles`   | Add your puzzles / Voeg je puzzels toe                       | ≥ **3** `ownedPuzzles` rows with `ownerId = me` (D3)                                                                  | "7 added"               |
| 2   | `solves`    | Log puzzles you finished / Leg vast wat je al hebt afgemaakt | ≥ 1 `completions` row with `userId = me`, `isCompleted = true`, any precision                                         | "3 logged"              |
| 3   | `people`    | Find your people / Vind je puzzelmaatjes                     | ≥ 1 `follows` row with `followerId = me`, **or** ≥ 1 pending `followRequests` row with `requesterId = me`             | "Following 2"           |
| 4   | `household` | Household / Huishouden (optional)                            | a `householdMembers` row with `memberId = me`                                                                         | "You're in a household" |
| 5   | `profile`   | Make it yours / Maak het persoonlijk                         | `users.location` is set, **or** the member's `profiles.visibility` is explicitly set (absent means public by default) | "Profile set"           |

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
- Location: a text input labelled with the existing `profile.location` ("Location"; meant for a city; optional, at most 80 characters) saved with the new
  `identity.setLocation`.
- Profile visibility: `SegmentedPills` "Everyone" / "Only people you approve",
  saved with the existing `social.setProfileVisibility`. Saving either value
  writes it explicitly, which marks the step done. A small "What others see"
  preview reuses `MemberTile` with the chosen visibility. Private profiles add
  friction to connecting, so the copy is plain and neutral and the current
  value (public) is preselected.

**Done** (`?step=done`): a centred panel. The member's `PuzzlePlank` shows the
new copies sliding in (60 ms stagger), then "Your shelf is ready" and a
summary ("7 puzzles · 3 finished · 2 following") announced through
`role="status"`. One `Puzzle` icon scales from 0.9 to 1 with one ring pulse.
No confetti. Every animation is `motion-safe:` only, so under reduced motion
the panel renders static (§5.5). Buttons: "Go to my shelf" (primary) and "Show
me around" (the tour hand-off, §2.8).

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

| Function                                                       | Kind          | PR  | Authz and contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `library/acquireCopies:acquireCopies`                          | mutation      | Q4  | `requireMember`; owner = actor. Args `{ puzzleDefinitionIds: string[] (1–25, deduplicated), condition? (default "good") }`. Loops the same `makeAcquireCopy` use case as `acquireCopy`, so the same catalogue rules apply (approved definitions, or the actor's own pending submission). Availability stays at the domain default (all off). All or nothing: any refusal throws and nothing is written. Returns `{ copyIds: string[] }`. One call is one batch: each copy emits `CopyAcquired` with a shared `batchId`, and the copy row stores it as `acquisitionBatchId` (§9, Q3). |
| `catalog/lookupPuzzleByBarcode:lookupPuzzleByBarcode`          | query         | Q4  | `requireMember`. Args `{ code: string }` (8, 12 or 13 digits, else `null`). Wraps the internal `findPuzzleByBarcode` and returns only what the picker may show: an approved definition, or the actor's own pending submission. Returns the picker row shape or `null`.                                                                                                                                                                                                                                                                                                               |
| `solving/recordPastCompletions:recordPastCompletions`          | mutation      | Q5  | `requireMember`. Args `{ items: { copyId: string, datePrecision: "day" \| "year" \| "unknown", date?: number, year?: number }[] }`, 1–25. Per item, the same copy gate as `recordCompletion` (owner, current holder, or `copyAccessOf ≠ "none"`) and the same snapshot write. `date` is required iff `day`, `year` iff `year`. All or nothing. Returns `{ completionIds: string[] }`.                                                                                                                                                                                                |
| `social/createHouseholdInviteLink:createHouseholdInviteLink`   | mutation      | Q6  | `requireMember`; the actor must be the admin of their household (`HouseholdError.notHouseholdAdmin`). Rate limits per §3.4 (`invite_rate_limited`). Returns `{ token, expiresAt }`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `social/revokeHouseholdInviteLinks:revokeHouseholdInviteLinks` | mutation      | Q6  | `requireMember`; revokes only the actor's own open household links. Returns `{ revoked: number }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `onboarding/getQuickStart:getQuickStart`                       | query         | Q7a | `requireMember`; reads only the actor's own rows. Returns `{ eligible, showWelcome, cardVisible, steps: { id, status: "todo" \| "done" \| "skipped", optional: boolean, count?: number, pendingInvite?: boolean }[], requiredDone: number, requiredTotal: 4 }`. Derivation per §2.4 is a pure domain function; the query gathers the facts with bounded index reads.                                                                                                                                                                                                                 |
| `onboarding/recordQuickStart:recordQuickStart`                 | mutation      | Q7a | `requireMember`; writes only the actor's own row. Args: a validator union `{ kind: "skipStep" \| "unskipStep", step: StepId } \| { kind: "dismissWelcome" \| "dismissCard" \| "restoreCard" }`. Step ids are validated as literals. Idempotent. Returns `null`.                                                                                                                                                                                                                                                                                                                      |
| `identity/setLocation:setLocation`                             | mutation      | Q8  | `requireMember`; patches only the actor's `users.location`. Trimmed; empty clears it; at most 80 characters (`invalid_location`). Returns `null`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `onboarding/activationReport:activationReport`                 | internalQuery | Q8  | Internal only; never in the gateway. Args `{ from, to }` (≤ 31 days). Returns aggregates only (§1.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Changed

| Function                                     | PR      | Change                                                                                                                                                                                                                                             |
| -------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solving/recordCompletion`                   | Q5      | Optional `datePrecision` (default `"day"`) and `year`. `endDate` is still required for a finished solve at `day` precision; for `year`/`unknown` the sentinel is computed server-side and `endDate`/`completionTimeMinutes` must be absent.        |
| `solving/editCompletion`                     | Q5      | A full date on a `year`/`unknown` row upgrades it to `"day"`; the edit window is unchanged.                                                                                                                                                        |
| Completion repository `countCompletedByUser` | Q5      | Excludes `unknown` (decision 4).                                                                                                                                                                                                                   |
| `insights/getCompletionTrends`               | Q5      | Passes only `day` rows to `computeCompletionTrends`.                                                                                                                                                                                               |
| `social/getActivityFeed`                     | Q4, Q5  | Skips `CompletionRecorded` whose payload `datePrecision` is `year`/`unknown` (Q5), and groups `CopyAcquired` events sharing a `batchId` into ONE `acquisitionBatch` entry with the count and up to 4 covers of the copies the viewer may see (Q4). |
| `social/listProfileCompletions`              | Q5      | Returns `datePrecision`; `unknown` rows sort last.                                                                                                                                                                                                 |
| `insights/exportUserData`                    | Q5, Q7a | Includes `datePrecision` and the `memberOnboarding` row.                                                                                                                                                                                           |
| `social/getMyInviteLink`, `resetInviteLink`  | Q6      | Only rows with `context === undefined` count as the network link.                                                                                                                                                                                  |
| `social/getInviteContext`                    | Q6      | Returns `{ valid, kind }`; expiry and consumption make it invalid.                                                                                                                                                                                 |
| `social/acceptQrFollow`                      | Q6      | No-op for household links.                                                                                                                                                                                                                         |
| `social/redeemInvite`                        | Q6      | Household branch per §3.4; return gains `householdInvite?`.                                                                                                                                                                                        |
| `whatsNew/recordTourProgress`                | Q8      | Also accepts `STANDALONE_TOUR_IDS`.                                                                                                                                                                                                                |

No change to `household.acceptInvite` / `declineInvite`; the pending invite a
household link creates is an ordinary `householdInvites` row.

---

## 5. Visual section

Everything here uses existing pieces only: the `globals.css` tokens,
`font-heading`, the `ui/` primitives (`Dialog`, `Button`, `Badge`, `Command`,
`Checkbox`), `SectionHead`, `SegmentedPills`, `MemberTile`, `PuzzlePlank`,
`UnreadDot`, and the anatomy of the What's new highlight modal and the tour
card. No new tokens, so `.dark` works as is. The contrast numbers are in §5.6.

**Shared conventions** (taken from `highlight-dialog.tsx` and
`tour-layer.tsx`, so the three surfaces read as one family):

- **Primary action look.** Every primary action in this track uses the look
  the highlight modal and the tour card already use:
  `<Button className="bg-jigsaw-primary hover:bg-jigsaw-primary/90 text-white">`,
  not the default `bg-primary` variant. That covers the welcome dialog's "Start
  quick setup", the flow's Continue and submit buttons ("Add 3 puzzles", "Log 1
  puzzle"), "Share invite link", "Turn on notifications", Accept, and the done
  panel's "Go to my shelf". This look is 4.48:1 in dark mode; the default
  variant is 3.80:1 (§5.6, §9 Q8).
- **Eyebrow.** Step labels ("Step 2 of 4") use the tour and highlight eyebrow:
  `text-muted-foreground font-mono text-[11px] tracking-[0.09em] uppercase`.
- **Motion.** Entrances use `motion-safe:animate-in motion-safe:fade-in-0 …`,
  as the tour layer does. Radix dialog content gets `motion-reduce:animate-none`,
  as the highlight does. Transitions get `motion-reduce:transition-none`.
- **Touch targets.** Icon buttons are `size-9 pointer-coarse:size-11`, as
  `FollowButton` is. Text buttons get `pointer-coarse:min-h-11`, as the tour
  card's buttons do on touch.

### 5.1 Welcome dialog

It copies `highlight-dialog.tsx` class for class:

- `DialogContent className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 motion-reduce:animate-none sm:max-w-md"`.
- **Header band**, `aria-hidden`: `bg-jigsaw-primary-tint flex h-28 items-center justify-center`.
  It holds the tile `bg-card text-jigsaw-primary flex size-14 items-center justify-center rounded-2xl shadow-sm`
  with a `Puzzle` icon (`size-7`).
- **Body** `flex flex-col gap-2 p-6 pt-5`, in this order:
  - `DialogTitle className="font-heading text-left text-2xl leading-tight font-semibold"`.
  - `DialogDescription className="text-muted-foreground text-left"` for the body copy.
  - The three lines as `<ol role="list">`, with `text-sm` labels and
    `aria-hidden` number markers (`size-6 rounded-full border-2 border-border text-xs font-semibold`).
    The explicit `role` keeps the list semantics that Safari drops under `list-none`.
  - The time line in `text-sm text-muted-foreground`.
- **Footer** `DialogFooter className="bg-muted/40 border-t px-6 py-4"`. The
  primitive is already `flex-col-reverse sm:flex-row sm:justify-end`, so the
  primary is on top on mobile. It holds the ghost "Explore on my own", then the
  primary, both `w-full sm:w-auto`.
- **Focus.** `onOpenAutoFocus` focuses the primary (marked
  `data-quickstart-primary`), not the close X, as the highlight does. Tab
  order follows the DOM (X, ghost, primary). On mobile the visual order is
  reversed, the same trade-off the highlight already makes.

At 360 px the dialog is 328 px wide. The title fits on one line in both
locales, and the footer buttons stack full width.

### 5.2 Dashboard checklist (`QuickSetupCard`)

The dashboard is card-free (`dashboard.tsx`: "whitespace-separated blocks").
So despite its name, `QuickSetupCard` is a plain `<section>`, like
`ShelfSection`: a `SectionHead` and content directly on `bg-background`, with
no bordered box. It sits in the page's `flex-col gap-6 md:gap-10`, between
`<BriefingHero />` and `<ShelfSection />`.

```
☰ Quick setup ───────────────────────────── 2 of 4  ✕
[■■■■■■■■■■] [■■■■■■■■■■] [··········] [··········]
(✓) Add your puzzles                               ›
    7 added
(✓) Log puzzles you finished                       ›
    3 logged
(3) Find your people                               ›
(–) Household  [Optional]                          ›
    Skipped · Do it now
(5) Make it yours                                  ›
```

- **Head:** `SectionHead` with `title="Quick setup"`, `icon={ListChecks}` and
  `meta="2 of 4"`. Its `action` is a ghost icon `Button` with an `X`,
  `aria-label="Hide quick setup"`, `size-9 pointer-coarse:size-11`.
- **Progress:** four equal segments, one per required step, in `flex gap-1`.
  This is the tour card's step-dot pattern, stretched. Each segment is
  `h-1.5 flex-1 rounded-full`: done segments are `bg-primary` and the others
  `bg-muted`, with `transition-colors motion-reduce:transition-none`. The bar is
  segmented, not continuous, for contrast (§5.6).
- **Rows:** an `<ol>`. Each row follows ShelfSection's `StatRow` pattern:
  - One `Link` per row: `group flex min-h-11 items-center gap-3.5 border-t py-3 first:border-t-0`.
  - The marker, then `min-w-0 flex-1` holding the label (`block text-sm font-semibold`)
    and the sub-line (`text-muted-foreground mt-px block text-xs`).
  - `ChevronRight` in `text-muted-foreground group-hover:text-foreground size-4`.
  - The row link is the only interactive element. There is no nested button.

| State                      | Marker (`size-6 shrink-0 rounded-full`, centred icon or number)                                   | Label and sub-line                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| todo                       | `border-2 border-border`, number in `text-xs font-semibold text-foreground`                       | `font-semibold`; no sub-line                                        |
| in progress                | `border-2 border-primary`, number in **`text-primary dark:text-foreground`**                      | sub-line "Continue · 2 of 3"                                        |
| done                       | **`bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200`**, `Check` (`size-3.5`)  | label in `text-muted-foreground`; sub-line is the count ("7 added") |
| skipped                    | `border-2 border-dashed border-muted-foreground`, `Minus` in `text-muted-foreground`              | sub-line "Skipped · Do it now", plain text (the row is the link)    |
| optional (household)       | as its state, plus `Badge variant="secondary"` "Optional" after the label                         | never counted in "x of 4"                                           |
| pending invite (household) | todo marker with the existing `UnreadDot` (`-top-0.5 -right-0.5 size-2.5 ring-2 ring-background`) | sub-line "Invitation waiting"                                       |

- **Done is never `text-jigsaw-secondary` on `bg-jigsaw-secondary-tint`.**
  That pair is 2.13:1 in light mode and 4.18:1 in dark mode, and both fail
  4.5:1. It is also `AvailabilityChips`' "on" look, so that look is not copied
  anywhere in this track. The Tailwind green pill (6.45:1 light, 11.27:1 dark)
  is used instead. No strike-through.
- **"In progress"** means the step was opened in this session, or it has a
  partial count (for example 2 of 3 copies). The dark-mode number uses
  `text-foreground`, because `text-primary` on the page background is 4.24:1
  there, too low for a 12 px numeral. The `border-primary` ring (4.24:1) still
  meets the 3:1 non-text rule.
- **Todo ring.** The todo marker's `border-border` ring is 1.27:1 and purely
  decorative. The numeral and the label carry the state.
- **Never colour alone.** Each state has its own icon or numeral, its own text,
  and an `sr-only` state word (§5.7).
- **"Do it now" is not a separate button.** A `link`-variant button inside the
  row link would nest one interactive element in another. It would also fail
  in dark mode (`text-primary` 4.24:1).
- **All required steps done:** the section shrinks to one `min-h-11` row: a
  done marker, "Your shelf is set up" and a ghost `size="sm"` "Hide" button.
  There is no `SectionHead` and no progress bar.

**Mobile (360 px).** The section is 328 px wide. The head fits: "Snel
instellen" (the `h2` is `whitespace-nowrap`), "2 van 4" and the 44 px `X`. The
sub-line already sits under the label, so long Dutch labels ("Leg vast wat je
al hebt afgemaakt") wrap inside `min-w-0 flex-1` and the chevron stays put.

### 5.3 `/welcome` layout and stepper

- **Heading levels.** `PageHead` already renders the route-meta title ("Quick
  setup") as the page `h1` on `md` and up. Each step title is therefore an
  `h2`: `font-heading text-xl font-semibold`, `tabIndex={-1}` and
  `focus-visible:outline-none`, as the tour card's title is. A step change
  moves focus to it.
- **Mobile stepper:**
  - Compact and sticky: `sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 bg-background py-2`.
    This docks it under the `MobileTopBar`, which is `h-14` plus the safe area.
  - One `truncate` eyebrow line, "Step 2 of 4 · Log puzzles you finished".
    The household step reads "Optional step · Household".
  - Below it, the four-segment progress from §5.2.
- **`md` and up:** an `<ol>` of the checklist's markers with the step titles,
  and `aria-current="step"` on the current one. It is not sticky.
- **Sticky footer** `border-t bg-card px-4 py-3`. `Skip` (ghost) sits on the
  left, and `Continue` or the step's submit (primary look) on the right.
  - **Below `md`:** the `MobileTabBar` is itself `sticky bottom-0`: a 56 px
    bar with a raised centre button that rises 22 px, plus a 4 px ring, above
    it. A `bottom-0` footer would sit underneath it. So the footer is
    `sticky bottom-14 z-20 pb-[30px]`: it docks on top of the tab bar, and its
    buttons clear the centre button's overhang.
  - There is no `env(safe-area-inset-bottom)` pad. The shell deliberately
    leaves the bottom unpadded (see the comment in `mobile-tab-bar.tsx`).
  - `Continue` is `flex-1`; `Skip` keeps its natural width.
  - **`md` and up:** `sticky bottom-0` inside the shell's scroll container.
- **Vertical budget at 360 × 640:** top bar 56 + stepper about 40 + footer
  about 90 + tab bar 56 ≈ 242 px of chrome, which leaves about 400 px for the
  step. That is acceptable. The on-screen keyboard is an open question (§9,
  Q11).
- **Focus order:** stepper → step `h2` → step body → footer (Skip, then
  Continue). The footer is last in the DOM even though it is sticky.

### 5.4 Per-step sketches (360 px)

**Add puzzles.**

```
┌ Search brand, title or barcode… 🔍 ┐
│ [img] Ravensburger                │
│       Mountain Lake · 1000   (+)  │  ← (+) → (✓): row turns bg-jigsaw-primary-tint
│ [img] Jumbo · Cats · 500     (✓)  │
│ ── Can't find it? ─────────────── │
│ [+ Register "Cats at nig…"]       │  → /my-puzzles/add/new?…&returnTo=…
└───────────────────────────────────┘
 Picked (3)  [Mountain Lake ×][Cats ×]…
 Added puzzles are not offered for swap or loan…
 [ Skip ]          [ Add 3 puzzles      ]
```

- Each result row is an `aria-pressed` toggle with the `AvailabilityChips`
  shape (`Plus` → `Check`) but **not** its "on" colours (see §5.2).
- A picked row is `bg-jigsaw-primary-tint` with `text-foreground` (17.78:1
  light, 10.39:1 dark).
- The check icon is `text-jigsaw-primary dark:text-foreground`. The brand
  violet on its own tint is 5.16:1 in light mode but only 2.57:1 in dark mode,
  below 3:1 even for an icon.
- The toggle's accessible name is "Add Mountain Lake" / "Remove Mountain Lake",
  and a polite live region announces "3 picked".
- The tray chips are removable. Each × is a button named "Remove
  {title}", sized `pointer-coarse:size-11`.

**Past solves.**

```
☑ Mountain Lake · 1000
   When?  (● I don't remember) (○ Which year) (○ Pick a date)
          [ 2023 ▾ ]   or   [ 2026-03-14 ]
☐ Cats · 500
 [ Skip ]          [ Log 1 puzzle       ]
```

The three `SegmentedPills` wrap onto two lines at 360 px (`flex-wrap`), which
is fine.

**Find people.** "People you may know" as `MemberTile` cards with the compact
icon `FollowButton`, then `FindPeople`, then the share sheet
(`InviteShareActions`):

```
 Invite someone who isn't on JigSwap yet
 Share your invite link. When they sign up, you'll follow each other.
 [ ⇪ Share invite link                 ]    primary look; only if navigator.share
 [⧉ Copy link] [✉ Email] [💬 WhatsApp]       outline, flex-wrap gap-2
 JigSwap doesn't see or store who you send this to.
 ┌ 🔔 Want a notification when someone follows you back? ┐  inline, §2.7
 │ [Turn on notifications]  [Not now]                     │
 └────────────────────────────────────────────────────────┘
```

- **Share button.** "Share invite link" uses `Share2` and is `w-full sm:w-auto`.
- **Fallback buttons.** These are outline `Button`s:
  - "Copy link" uses `Copy`, which swaps to `Check` and "Copied!", exactly as
    in `qr-dialog.tsx`.
  - "Email" uses `Mail`, and "WhatsApp" uses `MessageCircle` (no brand
    icons).
  - They sit in `flex flex-wrap gap-2`, so "Link kopiëren · E-mail · WhatsApp"
    wraps instead of overflowing 328 px. Each gets `pointer-coarse:min-h-11`.
- **Privacy line** in `text-xs text-muted-foreground`.
- **Push card.** `rounded-xl border bg-card p-4` with a `Bell` icon, the
  primary-look "Turn on notifications" and a ghost "Not now". It is inserted
  directly after the triggering action in the DOM, so it is next in tab order.
  Focus is not moved, because the card is not modal.

**Household.**

- **Pending invite.** It reuses `BriefingHero`'s pending-request banner look:
  `border-jigsaw-primary/20 bg-jigsaw-primary/5 rounded-xl border px-4 py-3`
  with an `Avatar` (`size-10`). It shows "<name> invited you to their
  household", the explainer, and Accept (primary look) / Decline (ghost).
- **Otherwise:** `SegmentedPills` "Create a household" / "I puzzle alone",
  then the `HouseholdInvitePanel`. That panel has the "Invite with a link"
  block, the same share buttons as above, and the "works once, expires in 14
  days" note in `text-xs text-muted-foreground`.

**Make it yours.** The avatar with "Change photo" (outline), the location input
(the existing `profile.location` label), the visibility `SegmentedPills` and a
"What others see" `MemberTile` preview.

### 5.5 Done panel

- **Layout:** a centred `flex flex-col items-center gap-4 text-center`, like
  the QR dialog's body.
- **Animation** (always `motion-safe:`, so under reduced motion the panel
  renders static):
  - The `PuzzlePlank` copies use `motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2`,
    with a 60 ms `animation-delay` stagger.
  - The `Puzzle` icon tile uses `motion-safe:zoom-in-90`, and its ring pulses
    once (`motion-safe:animate-ping [animation-iteration-count:1]`).
- **Text:** the title "Your shelf is ready" is an `h2` that takes focus on
  arrival, as a step title does. The summary line is in `role="status"`.
- **Buttons:** "Go to my shelf" (primary look) and "Show me around" (outline,
  with the `Compass` icon the highlight uses for tours).

### 5.6 Contrast, computed from the real theme values

The values come from `apps/web/src/styles/globals.css` (`:root` and `.dark`):

- OKLCH tokens are converted to sRGB.
- `color-mix(in oklab, …)` tints are mixed in OKLab, exactly as the CSS
  declares them.
- Tailwind `/NN` alpha is blended over the surface underneath.
- Tailwind v4's green palette supplies the pill.

The dashboard and `/welcome` content sit on **`--background`**, not `--card`,
so the checklist pairs are measured against the background. That surface is
darker than the card in dark mode. Ratios are WCAG 2.x relative-luminance
contrast. They were re-run in UI review.

| Pair                                                                                                | Light      | Dark       | Needed | Verdict                                             |
| --------------------------------------------------------------------------------------------------- | ---------- | ---------- | ------ | --------------------------------------------------- |
| `text-jigsaw-secondary` on `bg-jigsaw-secondary-tint` (also `AvailabilityChips` "on"); rejected     | **2.13:1** | **4.18:1** | 4.5    | fails both: not used                                |
| Done pill: `text-green-800` on `bg-green-100` / `text-green-200` on `bg-green-900/40` over the page | 6.45:1     | 11.27:1    | 4.5    | pass                                                |
| **Progress segment `bg-primary` vs page `bg-background` (each segment's edge)**                     | **5.92:1** | **4.24:1** | 3.0    | pass: the binding pair                              |
| Progress segment `bg-primary` vs a `bg-muted` segment (not adjacent: 4 px gap)                      | 5.42:1     | 3.16:1     | 3.0    | pass; no longer the boundary that shows the value   |
| In-progress ring `border-primary` vs page                                                           | 5.92:1     | 4.24:1     | 3.0    | pass                                                |
| In-progress numeral `text-primary` on page                                                          | 5.92:1     | 4.24:1     | 4.5    | dark fails: `dark:text-foreground` (14.96:1)        |
| Label and todo numeral `text-foreground` on page                                                    | 19.86:1    | 14.96:1    | 4.5    | pass                                                |
| Sub-line and meta `text-muted-foreground` on page                                                   | 4.75:1     | 6.63:1     | 4.5    | pass                                                |
| Dialog time line `text-muted-foreground` on `card`                                                  | 4.82:1     | 5.80:1     | 4.5    | pass                                                |
| Skipped ring `border-muted-foreground` vs page                                                      | 4.75:1     | 6.63:1     | 3.0    | pass                                                |
| Pending `UnreadDot` (`jigsaw-primary-accent`) vs page                                               | 3.47:1     | 4.70:1     | 3.0    | pass (the text "Invitation waiting" carries it too) |
| `SectionHead` icon `text-jigsaw-primary` on page                                                    | 5.76:1     | 3.70:1     | 3.0    | pass                                                |
| Picked row `text-foreground` on `bg-jigsaw-primary-tint`                                            | 17.78:1    | 10.39:1    | 4.5    | pass                                                |
| Picked check `text-jigsaw-primary` on `bg-jigsaw-primary-tint`                                      | 5.16:1     | 2.57:1     | 3.0    | dark fails: `dark:text-foreground` (10.39:1)        |
| "Optional" `Badge variant="secondary"`                                                              | 11.68:1    | 11.16:1    | 4.5    | pass                                                |
| "Do it now" as a `link` button (`text-primary` on page); rejected                                   | 5.92:1     | 4.24:1     | 4.5    | dark fails: plain sub-line text instead             |
| Primary look `text-white` on `bg-jigsaw-primary` (What's new, tour, this track)                     | 5.85:1     | **4.48:1** | 4.5    | dark misses by 0.02: pre-existing (§9, Q8)          |
| Default `Button` and `SegmentedPills` "on": `primary-foreground` on `primary`                       | 5.75:1     | **3.80:1** | 4.5    | dark fails: pre-existing (§9, Q8)                   |

Resolved sRGB values for reference:

- light: background `#fdfdff`, card `#ffffff`, primary `#574be2`, muted
  `#f2f2fb`, jigsaw-primary `#6048e8`, primary-tint `#eef0ff`, secondary-tint
  `#e6f8e4`
- dark: background `#1d1c34`, card `#282642`, primary `#786cfe`, muted
  `#33324e`, jigsaw-primary `#7560f0`, primary-tint `#373365`, secondary-tint
  `#2e4746`

**The progress-bar decision.** A continuous bar would rest on its dark
fill-to-track pair, `bg-primary` against `bg-muted`. That pair is 3.16:1: a
pass with no margin, which any later tweak to `--muted` could break. Two
options were rejected:

- **A mandatory `ring-1 ring-primary/40` on the track** does not change the
  fill-to-track pair, so it adds nothing where the value is read.
- **A stronger fill token.** `--sidebar-accent-foreground` would give 7.42:1,
  but it ties the checklist to sidebar chrome. `bg-jigsaw-primary` is weaker
  (2.76:1).

The bar is therefore segmented instead (§5.2). Each done segment is bounded by
the page background, at 4.24:1 dark and 5.92:1 light. The `ring-1` option is
dropped. The meta "2 of 4" and the `progressbar` values are the text
equivalent.

### 5.7 Accessibility

- **Progress.** The segment row is one element with `role="progressbar"`,
  labelled by the section's `h2`:
  - `aria-valuemin={0}`, `aria-valuemax={4}`, `aria-valuenow={done}`.
  - `aria-valuetext="2 of 4 steps done"` (`card.progressLabel`).
  - The segments are `aria-hidden`.
  - The mobile stepper's bar uses the same markup.
- **Rows.** The rows are an `<ol>`, because step order is meaningful.
  - Each link's name is the label, an `sr-only` state word (`card.state.*`) and
    the sub-line, for example "Add your puzzles, done, 7 added".
  - Marker icons are `aria-hidden`.
  - The section is not a live region: it shows server state on load, and the
    changes happen on other pages.
- **Hide.** Hiding the checklist moves focus to the Shelf section's heading.
  `SectionHead` gains an optional `headingProps` passthrough, so that `h2` can
  take `tabIndex={-1}`.
- **Keyboard:**
  - arrows and Enter in `Command`;
  - the arrow-key radiogroup that `SegmentedPills` already has;
  - Backspace in an empty search removes the last picked chip.

  Nothing needs hover.

- **Announcements**, all polite, one `sr-only` region per surface:
  - "3 picked" in the picker;
  - "Copied!" after "Copy link";
  - the done summary.
- **Motion:** see the shared conventions. Under `prefers-reduced-motion` the
  welcome dialog, the push card and the done panel appear without animation,
  and the segments change without a transition.
- **Forced colours:** the segments may flatten. The meta text and the
  `progressbar` values carry the state, and each marker keeps its icon or
  numeral.
- **Touch targets:** at least 44 px on coarse pointers (`min-h-11` rows,
  `pointer-coarse:size-11` icon buttons).

---

## 6. i18n keys

New keys go in **all three** locale files (`apps/web/locales/en.json`,
`nl.json`, and `source.json`, which mirrors en). New namespace `quickStart`
unless noted. ICU plurals follow the existing style.

| Key                                                 | en                                                                                                             | nl                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `welcome.title`                                     | Welcome to JigSwap!                                                                                            | Welkom bij JigSwap!                                                                                             |
| `welcome.body`                                      | Shall we set up your shelf? Add the puzzles you own, the ones you've finished, and the people you puzzle with. | Zullen we je plank inrichten? Voeg je puzzels toe, welke je al hebt afgemaakt en met wie je puzzelt.            |
| `welcome.stepPuzzles`                               | Add the puzzles on your shelf                                                                                  | Voeg de puzzels op je plank toe                                                                                 |
| `welcome.stepSolves`                                | Mark the ones you've finished                                                                                  | Vink aan welke je al hebt afgemaakt                                                                             |
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
| `card.state.todo`                                   | to do                                                                                                          | nog te doen                                                                                                     |
| `card.state.inProgress`                             | in progress                                                                                                    | bezig                                                                                                           |
| `card.state.done`                                   | done                                                                                                           | klaar                                                                                                           |
| `card.state.skipped`                                | skipped                                                                                                        | overgeslagen                                                                                                    |
| `card.allDone`                                      | Your shelf is set up                                                                                           | Je plank is ingericht                                                                                           |
| `card.hideDone`                                     | Hide                                                                                                           | Verbergen                                                                                                       |
| `menu.quickSetup`                                   | Quick setup                                                                                                    | Snel instellen                                                                                                  |
| `steps.puzzles.title`                               | Add your puzzles                                                                                               | Voeg je puzzels toe                                                                                             |
| `steps.puzzles.count`                               | {count} added                                                                                                  | {count} toegevoegd                                                                                              |
| `steps.puzzles.partial`                             | {count} of 3                                                                                                   | {count} van 3                                                                                                   |
| `steps.solves.title`                                | Log puzzles you finished                                                                                       | Leg vast wat je al hebt afgemaakt                                                                               |
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
| `solves.lead`                                       | Did you finish any of these?                                                                                   | Heb je een van deze al afgemaakt?                                                                               |
| `solves.finished`                                   | I finished {title}                                                                                             | Ik heb {title} afgemaakt                                                                                        |
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
| `profile.locationHint`                              | Optional. Shown on your profile.                                                                               | Optioneel. Zichtbaar op je profiel.                                                                             |
| `profile.visibility`                                | Who can see your profile?                                                                                      | Wie kan je profiel zien?                                                                                        |
| `profile.public`                                    | Everyone                                                                                                       | Iedereen                                                                                                        |
| `profile.private`                                   | Only people you approve                                                                                        | Alleen mensen die je toelaat                                                                                    |
| `profile.preview`                                   | What others see                                                                                                | Wat anderen zien                                                                                                |
| `push.title`                                        | Want a notification when someone follows you back?                                                             | Wil je een melding als iemand je terugvolgt?                                                                    |
| `push.enable`                                       | Turn on notifications                                                                                          | Meldingen aanzetten                                                                                             |
| `push.notNow`                                       | Not now                                                                                                        | Niet nu                                                                                                         |
| `done.title`                                        | Your shelf is ready                                                                                            | Je plank staat klaar                                                                                            |
| `done.summary`                                      | {copies, plural, one {# puzzle} other {# puzzles}} · {solves} finished · {following} following                 | {copies, plural, one {# puzzel} other {# puzzels}} · {solves} afgemaakt · {following} gevolgd                   |
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
`profile.location` (Location / Locatie, the field's label on the profile page),
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
| **Q4**  | Q1               | `library.acquireCopies` (with a `batchId` on `CopyAcquired` and the copies, and the grouped feed entry), the `CataloguePicker` (with barcode lookup), and `returnTo` on `/my-puzzles/add/new`. The picker is usable on its own from `/my-puzzles/add`.                                                          | Q1; uses Q2's search once Q2 is on `main` (soft) |
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

## 9. Resolved questions (user decisions, 2026-10-17)

These were open questions with conservative defaults. The user has answered all of them; the answers are final. Where an answer changes the default, the implementing PR is named.

1. **`year` solves count toward goals.** Unchanged from the default. Revisit if goals gain a start date.
2. **`year` solves stay hidden from the activity feed.** Unchanged (D4).
3. **Bulk adds are GROUPED in the feed, not hidden.** _Changed; implemented in Q4 (#105)._
   - One `acquireCopies` call is a batch, with a batch id carried on its events and copies.
   - The feed shows one entry per batch, e.g. "Sander added 10 puzzles", with a few covers, linking to the member's profile puzzles.
   - Covers and the count respect each viewer's copy visibility, and the entry is dropped if nothing is visible.
   - Single adds are unchanged.
   - en/nl plurals.
   - **Bulk past solves (Q5, #107):** the user asked for the same grouping, while still hiding `year`/`unknown` precision. The shepherd chose to hide grouped past-solves entries entirely, because they are all backfill. Q5 keeps them out of the feed, explicitly and with tests.
4. **Dating an undated solve later:** a follow-up. The 24-hour edit window stays.
5. **An existing member opening a household link gets a landing with Accept/Decline.** _Changed; implemented in Q6 (#108)._
   - The landing reads "<Inviter> invited you to their household <name>".
   - Accept joins through the same domain path as accepting a pending invite: the one-household rule, the single-use token consumed, the admin notified via `household_invite_accepted`.
   - No auto-follow.
   - A member already in a household is shown why they can't join.
   - The token stays single-use with 14-day expiry, validated server-side.
   - Decline behaviour (leave the token unused or expire it) is decided and justified in Q6.
   - New members are unchanged: redeeming creates a PENDING invite.
6. **The 15-minute new-member redeem window** is fine. Unchanged.
7. **Step 1 threshold: 3 copies.** Unchanged (D3).
8. **Dark-mode primary contrast is fixed in this stack.** _Changed; implemented in Q7b._
   - The dark-theme tokens are adjusted in lightness only, keeping the brand hue, so that `--primary-foreground` on `--primary` (including the `SegmentedPills` "on" state) and `text-white` on `--jigsaw-primary` both reach ≥ 4.5:1.
   - Hover/active states and focus rings are re-checked.
   - Before/after ratios for both themes are reported in the PR.
9. **Long-ago members with 0 copies see the card** (no welcome dialog) and can hide it. Unchanged.
10. **Activation's household link.** _Changed; implemented in Q8._
    - It counts when the new member created or joined a household within their 7-day window, and that household has at least one other member, whenever that member joined.
    - Activation can therefore flip to true after day 7, when a second member joins later. The activation report documents this.
11. **The sticky `/welcome` footer stays sticky, but is collapsible on mobile.** _Changed; implemented in Q7b._ Q7b picks the simplest mechanism, e.g. hiding it while a text input in the step has focus, and states which.
